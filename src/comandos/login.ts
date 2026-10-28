// El login por dispositivo partido en dos (§4.5): `--start` pide el código y sale 5; `--wait` sondea
// un tramo y sale 5 mientras la persona no confirme. Así ningún comando espera más de 90 s, y quien
// lo llama (una persona o un asistente) decide cuándo volver a llamar.
import type { Canje, PedidoDeCodigo } from "../api.ts";
import { FalloDeLaTerminal, resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { NOMBRE_DE_LA_FUENTE, type Guardado, type Pendiente } from "../guardado/index.ts";
import { PLAZO_MINIMO_MS, RESERVA_PARA_CERRAR_MS, sondearUnTramo, TRAMO_MAXIMO_MS } from "../sondeo.ts";

export type DepsDeLogin = {
  api: URL;
  guardado: Guardado;
  maquina: string;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  pedirCodigo: (api: URL, maquina: string) => Promise<PedidoDeCodigo>;
  canjear: (api: URL, deviceCode: string, plazoMs: number) => Promise<Canje>;
  revocarPropia: (api: URL, clave: string, plazoMs: number) => Promise<"revocada" | "ya_no_valia">;
  avisar: (s: string) => void;
  tramoMs?: number;
};

const TECHO_DE_UN_PASO_MS = 5_000;
const VOLVER_A_EMPEZAR = "Start over with `supcoflow login --start`.";

const fallo = (codigo: Resultado["codigo"], error: string, message: string, extra: Record<string, unknown> = {}): Resultado => ({
  codigo, json: { ok: false, error, message, ...extra }, texto: message,
});

// Un error crudo del sistema (fs, el llavero) puede traer cualquier cosa: se tapa antes de mostrarlo.
const motivo = (e: unknown): string =>
  e instanceof FalloDeLaTerminal ? e.message : taparSecretos(e instanceof Error ? e.message : String(e));

// Lo único que el reintento usa: así `logout`, que no pide códigos ni sondea, lo llama sin armar
// las dependencias enteras del login.
export type DepsDelReintento = Pick<DepsDeLogin, "api" | "guardado" | "ahora" | "revocarPropia" | "avisar">;

// Las claves que un login o logout anterior no pudo revocar (Review Focus 14). Nunca lanza: es
// limpieza de lo de antes y no puede trabar un login nuevo.
export async function reintentarPorRevocar(d: DepsDelReintento, limite: number): Promise<{ revocadas: number; quedan: number | null }> {
  const origen = d.api.origin;
  const noSe = () => {
    d.avisar("I couldn't read the whole list of keys waiting to be revoked (the keychain didn't respond); I'll try again next time.");
  };
  let lectura: { claves: string[]; completa: boolean };
  try {
    lectura = await d.guardado.leerPorRevocar(origen);
  } catch {
    noSe();
    return { revocadas: 0, quedan: null };
  }
  // «Cuántas quedan» sólo es un número si se pudo comprobar entero (Review Focus 15): con un
  // almacén que no respondió puede haber claves que no se vieron, y decir 0 sería mentir.
  let sabido = lectura.completa;
  let revocadas = 0;
  for (const clave of lectura.claves) {
    const queda = limite - d.ahora();
    if (queda < PLAZO_MINIMO_MS) break;
    try {
      await d.revocarPropia(d.api, clave, Math.min(TECHO_DE_UN_PASO_MS, queda));
    } catch {
      continue; // sigue anotada; el próximo login o logout la reintenta
    }
    revocadas++;
    try {
      if (!(await d.guardado.quitarPorRevocar(origen, clave)).completo) sabido = false;
    } catch {
      sabido = false;
    }
  }
  if (!sabido) {
    noSe();
    return { revocadas, quedan: null };
  }
  return { revocadas, quedan: lectura.claves.length - revocadas };
}

export async function loginStart(d: DepsDeLogin, flags: { dryRun: boolean }): Promise<Resultado> {
  const origen = d.api.origin;
  if (flags.dryRun) {
    const haria = `ask ${origen} for a device code`;
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `With --dry-run I do nothing; without it: ${haria}.` };
  }
  await reintentarPorRevocar(d, d.ahora() + 15_000);
  let c: PedidoDeCodigo;
  try {
    c = await d.pedirCodigo(d.api, d.maquina);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  // Sólo el pendiente, en su propia cuenta: la clave vigente sigue sirviendo hasta que la nueva
  // quede guardada (Review Focus 7), así un login rechazado o abandonado no deja a nadie sin sesión.
  const pendiente: Pendiente = {
    deviceCode: c.deviceCode, userCode: c.userCode, verificationUriComplete: c.verificationUriComplete,
    venceEn: d.ahora() + c.expiresIn * 1000, intervaloS: c.interval, ultimoSondeoEn: null,
  };
  try {
    await d.guardado.guardarPendiente(origen, pendiente);
  } catch (e) {
    return fallo(SALIDA.inesperado, e instanceof FalloDeLaTerminal ? e.error : "no_se_pudo_guardar",
      `I couldn't save the login in progress: ${motivo(e)}`);
  }
  return {
    codigo: SALIDA.esperandoAUnaPersona,
    json: {
      ok: false, esperando: "persona", verification_uri: c.verificationUri,
      verification_uri_complete: c.verificationUriComplete, user_code: c.userCode, expires_in: c.expiresIn,
    },
    texto: `Open ${c.verificationUriComplete} and confirm the code ${c.userCode}. Then run \`supcoflow login --wait\`.`,
  };
}

export async function loginWait(d: DepsDeLogin): Promise<Resultado> {
  const origen = d.api.origin;
  const inicio = d.ahora();
  const tramo = d.tramoMs ?? TRAMO_MAXIMO_MS;
  const limite = inicio + tramo;
  // La proporción sólo pesa con el tramo corto de las pruebas; con 90 s la reserva es la entera.
  const finDeSondeos = limite - Math.min(RESERVA_PARA_CERRAR_MS, tramo / 3);
  const techo = () => Math.max(0, Math.min(TECHO_DE_UN_PASO_MS, limite - d.ahora()));

  const p = await d.guardado.leerPendiente(origen);
  if (p === null) {
    return fallo(SALIDA.entradaInvalida, "sin_login_en_curso", "There is no login in progress: start with `supcoflow login --start`.");
  }
  // La anterior se lee ANTES de sondear, así no consume la reserva del cierre. Se pide por
  // `leerClaveCompleta` para saber de paso si SUPCOFLOW_TOKEN está definida (sin costo: la variable
  // se devuelve sin tocar los almacenes); en ese caso la anterior es la GUARDADA, nunca la del
  // entorno, que no es de este login y no se revoca acá.
  const vigente = await d.guardado.leerClaveCompleta(origen);
  const conVariable = vigente.valor?.fuente === "env";
  const lectura = conVariable ? await d.guardado.leerClaveGuardadaCompleta(origen) : vigente;
  // Un llavero que no contestó no es «no había clave» (Review Focus 12 y 14): seguir guardaría la
  // nueva encima de la anterior sin revocarla, viva y olvidada. Se corta antes de canjear el código
  // y sin borrar el pendiente, así el mismo `--wait` sirve cuando el llavero vuelva.
  if (!lectura.completa) {
    const salida = conVariable
      ? "unlock the keychain and run `supcoflow login --wait` again."
      : "unlock the keychain and run `supcoflow login --wait` again (or, without logging in, export SUPCOFLOW_TOKEN with a valid key).";
    return fallo(SALIDA.inesperado, "no_pude_leer_la_clave",
      `I couldn't read your saved key (the keychain didn't respond), and without knowing which one it is I can't replace it without leaving it active: ${salida}`);
  }
  const anterior = lectura.valor;

  let fin;
  try {
    fin = await sondearUnTramo(p, {
      ahora: d.ahora, dormir: d.dormir, finDeSondeos,
      canjear: (deviceCode, plazoMs) => d.canjear(d.api, deviceCode, plazoMs),
      persistir: (q, techoMs) => d.guardado.guardarPendiente(origen, q, techoMs),
    });
  } catch (e) {
    // El progreso de los sondeos anteriores ya quedó guardado: el próximo `--wait` sigue de ahí.
    return resultadoDeFallo(e);
  }

  switch (fin.tipo) {
    case "sigue":
      return {
        codigo: SALIDA.esperandoAUnaPersona,
        json: { ok: false, esperando: "persona", user_code: fin.pendiente.userCode, verification_uri_complete: fin.pendiente.verificationUriComplete },
        texto: `Not confirmed yet. Open ${fin.pendiente.verificationUriComplete} and confirm the code ${fin.pendiente.userCode}; then run \`supcoflow login --wait\` again.`,
      };
    case "token": {
      const r = await reemplazarClave(d, { clave: fin.clave, equipo: fin.equipo }, anterior?.clave ?? null, limite);
      // Va acá y no adentro de `reemplazarClave` porque es acá donde se supo, antes de sondear, sin
      // gastar reserva: preguntarlo al final costaría otra lectura lenta del guardado.
      if (conVariable && r.json.guardada_en !== undefined) {
        d.avisar("SUPCOFLOW_TOKEN is set and takes priority over the key I just saved.");
      }
      return r;
    }
    case "rechazado":
      await d.guardado.borrarPendiente(origen, techo());
      return fallo(SALIDA.haceFaltaUnaPersona, "acceso_rechazado", "Access was denied in the console; your previous session, if there was one, is unchanged.");
    case "vencido":
      await d.guardado.borrarPendiente(origen, techo());
      return fallo(SALIDA.faltaLogin, "codigo_vencido", `The code has expired. ${VOLVER_A_EMPEZAR}`);
    case "invalido":
      await d.guardado.borrarPendiente(origen, techo());
      return fallo(SALIDA.faltaLogin, "codigo_invalido", `The code is no longer valid. ${VOLVER_A_EMPEZAR}`);
  }
}

// El login de una persona frente a la terminal: los mismos dos pasos, encadenados. Sin TTY (o con
// `--json`) no pide código: nadie iba a ver la URL, y un pedido que nadie aprueba sólo gasta el tope
// de pedidos por IP del motor. A un asistente le corresponde el camino partido.
const PAUSA_ENTRE_TRAMOS_MS = 1_000;

export async function loginInteractivo(
  d: DepsDeLogin & { esTty: boolean; mostrar: (s: string) => void }, flags: { json: boolean; dryRun: boolean },
): Promise<Resultado> {
  if (!d.esTty || flags.json) {
    return fallo(SALIDA.entradaInvalida, "hace_falta_tty",
      "Without an interactive terminal, use `supcoflow login --start --json` and then `supcoflow login --wait --json`.");
  }
  const inicio = await loginStart(d, flags);
  if (inicio.codigo !== SALIDA.esperandoAUnaPersona) return inicio;
  // El texto de `--start` le dice a la persona que corra `--wait`; acá eso lo hace el comando solo.
  const { verification_uri_complete: url, user_code: codigo } = inicio.json;
  d.mostrar(`Open ${String(url)} and confirm the code ${String(codigo)}. I'll wait here...`);
  // Cada tramo termina por su cuenta (≤ 90 s) y el código vence a los pocos minutos, así que el
  // bucle tiene fin aunque la persona nunca conteste: termina en `codigo_vencido`.
  let r: Resultado;
  do {
    r = await loginWait(d);
    // Un `loginWait` que devuelve 5 sin haber sondeado (el intervalo era más largo que la ventana
    // que quedaba) volvería a girar sin esperar nada: este segundo evita quemar CPU en el vacío.
    if (r.codigo === SALIDA.esperandoAUnaPersona) await d.dormir(PAUSA_ENTRE_TRAMOS_MS);
  } while (r.codigo === SALIDA.esperandoAUnaPersona);
  return r;
}

// Por qué este orden (guardar → revocar → anotar → borrar el pendiente), Review Focus 13 y 14:
// la nueva se guarda primero porque es la única copia; la anterior se revoca recién con la nueva a
// salvo (si no, un fallo al guardar dejaba a la persona sin ninguna); si no se pudo revocar, se anota
// para no olvidarla viva; y el borrado del pendiente va último y no lanza, porque ubicado antes era el
// que podía impedir revocar la anterior, y un pendiente viejo es inofensivo.
export async function reemplazarClave(
  d: DepsDeLogin, nueva: { clave: string; equipo: string }, anterior: string | null, limite: number,
): Promise<Resultado> {
  const origen = d.api.origin;
  const queda = () => limite - d.ahora();
  const techo = () => Math.max(0, Math.min(TECHO_DE_UN_PASO_MS, queda()));

  // 1. Guardar la nueva. Con el techo agotado el guardado salta el llavero y escribe el archivo, que
  // es local: la clave se guarda igual aunque el tramo esté por vencer.
  let guardadaEn: "llavero" | "archivo";
  try {
    guardadaEn = (await d.guardado.guardarClave(origen, nueva.clave, techo())).donde;
  } catch (e) {
    // Una clave que nadie guardó no puede quedar viva: se revoca, aunque haga falta un plazo mínimo
    // más allá del tramo, porque nadie más la va a poder revocar.
    let revocada = true;
    try {
      await d.revocarPropia(d.api, nueva.clave, Math.min(TECHO_DE_UN_PASO_MS, Math.max(PLAZO_MINIMO_MS, queda())));
    } catch {
      revocada = false;
    }
    const despues = revocada
      ? "I revoked it so it doesn't stay active; your previous session, if there was one, is as it was."
      : "I couldn't revoke it either: revoke it in the console, under \"Terminal access\".";
    return fallo(SALIDA.inesperado, "no_se_pudo_guardar", `I couldn't save the new key (${motivo(e)}). ${despues}`);
  }

  // 2. Revocar la anterior, o anotarla.
  let anteriorRevocada: boolean | null = null;
  let quedaPorRevocar = false;
  if (anterior !== null && anterior !== nueva.clave) {
    anteriorRevocada = false;
    if (queda() >= PLAZO_MINIMO_MS) {
      try {
        await d.revocarPropia(d.api, anterior, Math.min(TECHO_DE_UN_PASO_MS, queda()));
        anteriorRevocada = true;
      } catch {
        // cae a anotarla
      }
    }
    if (!anteriorRevocada) {
      try {
        await d.guardado.anotarPorRevocar(origen, anterior, techo());
        quedaPorRevocar = true;
        d.avisar("I couldn't revoke your previous key; it's noted down and I'll try again on the next login or logout.");
      } catch {
        const message = "I couldn't revoke or note down your previous key: revoke it in the console, under \"Terminal access\".";
        d.avisar(message);
        if (queda() >= PLAZO_MINIMO_MS) await d.guardado.borrarPendiente(origen, techo());
        // La nueva SÍ quedó guardada y anda: el json lo dice para que nadie vuelva a hacer login.
        return fallo(SALIDA.inesperado, "clave_anterior_sin_revocar", message, {
          equipo: nueva.equipo, guardada_en: guardadaEn, anterior_revocada: false, queda_por_revocar: false,
        });
      }
    }
  }

  // 3. Borrar el pendiente; su `false` no cambia nada.
  if (queda() >= PLAZO_MINIMO_MS) await d.guardado.borrarPendiente(origen, techo());

  const donde = guardadaEn === "llavero" ? NOMBRE_DE_LA_FUENTE.llavero : NOMBRE_DE_LA_FUENTE.archivo;
  return {
    codigo: SALIDA.ok,
    json: { ok: true, equipo: nueva.equipo, guardada_en: guardadaEn, anterior_revocada: anteriorRevocada, queda_por_revocar: quedaPorRevocar },
    texto: `Logged in to team ${nueva.equipo}; the key is saved in ${donde}.`,
  };
}
