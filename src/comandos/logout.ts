// `supcoflow logout`: cierra UNA credencial, la que se está usando, y nunca olvida una clave viva
// (Review Focus 9 y 14). Borrar sin revocar dejaría la clave sirviendo en el motor y sin nadie que
// la recuerde: por eso, si el motor no confirma, no se borra nada y el comando sale 1.
import { FalloDeLaTerminal, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";
import { reintentarPorRevocar } from "./login.ts";

const motivo = (e: unknown): string =>
  e instanceof FalloDeLaTerminal ? e.message : taparSecretos(e instanceof Error ? e.message : String(e));

export async function comandoLogout(
  d: {
    api: URL;
    guardado: Guardado;
    revocarPropia: (api: URL, clave: string, plazoMs?: number) => Promise<"revocada" | "ya_no_valia">;
    ahora: () => number;
    avisar: (s: string) => void;
  },
  flags: { dryRun: boolean },
): Promise<Resultado> {
  const origen = d.api.origin;
  // Sin nada legible y un almacén que no contestó, no se sabe si hay sesión: decir «no había»
  // dejaría creer que no queda ninguna clave viva (Review Focus 12).
  const noPudeLeer = (extra: Record<string, unknown> = {}): Resultado => {
    const message = "No pude leer la clave guardada (el llavero no respondió); no cerré nada. Probá de nuevo.";
    return { codigo: SALIDA.inesperado, json: { ok: false, error: "no_pude_leer_la_clave", message, ...extra }, texto: message };
  };

  if (flags.dryRun) {
    const lectura = await d.guardado.leerClaveCompleta(origen);
    const vigente = lectura.valor;
    if (vigente === null && !lectura.completa) return noPudeLeer({ dry_run: true });
    if (vigente === null) {
      return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, habia_sesion: false }, texto: "No hay sesión iniciada: no haría nada." };
    }
    const haria = `revocar la clave de ${vigente.fuente} en ${origen}` + (vigente.fuente !== "env" ? " y borrarla" : "");
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `Con --dry-run no hago nada; sin él, iría a ${haria}.` };
  }

  // Lo pendiente de antes va primero: un logout es justo cuando la persona espera que no quede
  // ninguna clave suya viva, y es la última oportunidad que tiene la terminal de revocarlas.
  const { quedan } = await reintentarPorRevocar(d, d.ahora() + 15_000);
  // `null` es «no lo pude comprobar» y se dice así: un 0 haría creer que no queda nada vivo.
  if (quedan === null) {
    d.avisar("No pude comprobar cuántas claves quedan por revocar; las que haya siguen anotadas y las reintento en el próximo login o logout.");
  } else if (quedan > 0) {
    d.avisar(`Quedan ${quedan} clave(s) anterior(es) sin revocar; siguen anotadas y las reintento en el próximo login o logout.`);
  }
  const lectura = await d.guardado.leerClaveCompleta(origen);
  const vigente = lectura.valor;
  if (vigente === null && !lectura.completa) return noPudeLeer({ quedan_por_revocar: quedan });
  const conPendientes = (json: Record<string, unknown>) =>
    ({ ...json, quedan_por_revocar: quedan, ...(lectura.completa ? {} : { lectura_completa: false }) });
  if (vigente === null) {
    await d.guardado.borrarPendiente(origen);
    return { codigo: SALIDA.ok, json: conPendientes({ ok: true, habia_sesion: false }), texto: "No había sesión iniciada." };
  }

  let revocada: boolean;
  try {
    revocada = (await d.revocarPropia(d.api, vigente.clave)) === "revocada";
  } catch (e) {
    const cual = vigente.fuente === "env" ? "la clave de SUPCOFLOW_TOKEN sigue viva" : "la clave sigue guardada";
    const message = `No pude revocar la clave, así que no cerré la sesión (${motivo(e)}); ${cual}. Probá de nuevo.`;
    const error = e instanceof FalloDeLaTerminal ? e.error : "inesperado";
    return { codigo: SALIDA.inesperado, json: conPendientes({ ok: false, error, message }), texto: message };
  }

  // La variable no es nuestra: se revoca la clave que trae, pero lo guardado es OTRA credencial,
  // que sólo se cierra revocándola a ella. Borrarla acá la dejaría viva y olvidada.
  if (vigente.fuente === "env") {
    d.avisar("Revoqué la clave de SUPCOFLOW_TOKEN; sacala de tu entorno.");
    // `undefined` = no se pudo leer: no se afirma que no haya, el json lleva `null` en vez de mentir.
    let guardada: { fuente: "llavero" | "archivo" } | null | undefined;
    try {
      const l = await d.guardado.leerClaveGuardadaCompleta(origen);
      guardada = l.valor ?? (l.completa ? null : undefined);
    } catch {
      guardada = undefined;
    }
    if (guardada) {
      d.avisar(`Sigue guardada otra clave en ${guardada.fuente}; para cerrarla, corré \`supcoflow logout\` sin SUPCOFLOW_TOKEN.`);
    }
    return {
      codigo: SALIDA.ok,
      json: conPendientes({ ok: true, revocada, fuente: "env", queda_clave_guardada: guardada === undefined ? null : guardada !== null }),
      texto: "Revoqué la clave de SUPCOFLOW_TOKEN.",
    };
  }

  // Con la lectura incompleta se borra sólo la copia que se leyó y se acaba de revocar: la del
  // almacén que no contestó puede ser otra clave, viva, y borrarla sin revocarla la olvidaría.
  if (!lectura.completa) {
    const otro = vigente.fuente === "archivo" ? "el llavero del sistema" : "el archivo de credenciales";
    d.avisar(`Cierro la clave de ${vigente.fuente}, pero no pude leer ${otro}: puede quedar otra copia guardada ahí; cuando responda, volvé a correr \`supcoflow logout\`.`);
  }
  try {
    if (lectura.completa) await d.guardado.borrarClave(origen);
    else await d.guardado.borrarClaveDe(origen, vigente.fuente);
  } catch (e) {
    // La clave ya no sirve en el motor, pero quedó escrita: el comando no puede decir que terminó bien.
    const message = `La clave quedó revocada pero no pude borrarla: ${motivo(e)}`;
    return { codigo: SALIDA.inesperado, json: conPendientes({ ok: false, error: "no_se_pudo_borrar", message }), texto: message };
  }
  await d.guardado.borrarPendiente(origen);
  return { codigo: SALIDA.ok, json: conPendientes({ ok: true, revocada }), texto: "Sesión cerrada." };
}
