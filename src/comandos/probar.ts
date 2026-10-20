// `supcoflow diagnosticar` y `supcoflow probar` (bloque 7, la prueba): ¿un problema que entra por el
// chat llega hasta un issue? El diagnóstico es gratis y sólo lee. La prueba gasta un relevamiento (techo
// del motor, hoy US$ 2): sin `--autorizo-gasto` no se manda nada que escriba (R6).
//
// El ciclo de la clave (hallazgo 5), en el orden en que se lee abajo:
//   1. Sin intento guardado: clave nueva, y el intento ENTERO guardado antes del POST (estricto).
//   2. Con intento guardado: es un reintento; misma clave, mismo mensaje, mismo techo. Otro `--mensaje`
//      sale 4 `intento_pendiente` sin mandar nada.
//   3. 202: la última prueba = la del motor y el intento cerrado, en una escritura (src/pruebas-guardadas.ts).
//      Si falla, sale 1 con el id y el intento sigue abierto: el próximo recibe la misma prueba.
//   4. Ambigua (sin respuesta, 5xx, pausa, otro intento en curso): el intento se conserva. Rechazo
//      definitivo: se cierra, el motor no creó nada con esa clave.
//   5. Una prueba nueva es `probar --autorizo-gasto` sin intento abierto: clave nueva aunque el mensaje
//      sea el mismo.
//
// `--wait` sigue la prueba por tramos (≤ 90 s el comando entero, como `login --wait`): el estado lo deriva
// el motor en cada llamada y acá sólo se traduce a un código de salida con la tabla de la prueba.
import type { Diagnostico, IntentoDePrueba, RespuestaDePrueba, Seguimiento } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { RegistroDePruebas } from "../pruebas-guardadas.ts";
import { PLAZO_MINIMO_DE_SONDEO_MS, TRAMO_MAXIMO_MS } from "../sondeo.ts";
import { fallo, rutaDe } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDePrueba = DepsDelProyectoDelRepo & {
  leerDiagnostico(api: URL, clave: string, proyectoId: string): Promise<Diagnostico>;
  pedirPrueba(api: URL, clave: string, proyectoId: string, intento: IntentoDePrueba): Promise<RespuestaDePrueba>;
  leerPrueba(api: URL, clave: string, proyectoId: string, pruebaId: string, plazoMs: number): Promise<Seguimiento>;
  pruebas: RegistroDePruebas;
  generar: () => string;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  avisar: (s: string) => void;
  tramoMs?: number;
};

type FlagsDeProbar = Pick<Flags, "repo" | "dryRun" | "wait" | "autorizoGasto" | "mensaje" | "prueba">;

// Las cotas de `BugReportSchema` del motor (D2): el mensaje es el cuerpo del reporte. Se mira acá para no
// gastar un pedido (ni guardar un intento que el motor va a rechazar); la regla de verdad es la del motor.
const MAX_MENSAJE = 20_000;
const ID_DE_PRUEBA = /^prb_[0-9a-f]{16}$/;
const INTERVALO_DE_SEGUIMIENTO_MS = 5_000;
const PLAZO_MAXIMO_DE_SONDEO_MS = 15_000;

// La tabla de la prueba (brief M7, «los estados»): qué código sale en cada estado. Lo que no está acá es
// un estado que esta terminal no conoce: sale 1, nunca se adivina.
const ABIERTOS = new Set(["en_curso", "creada"]);
const CON_DESENLACE_OK = new Set(["issue_creado", "guardado"]);
const PIDEN_UNA_PERSONA = new Set([
  "issue_con_cierre_anomalo", "fallido", "cierre_sin_evidencia", "reclamado_sin_run", "arranque_incierto", "esperando_cupo", "sin_despacho",
]);

const usd = (n: number) => `US$ ${n.toFixed(2)}`;
const usdONull = (n: number | null) => (n === null ? "sin medir" : usd(n));

function datosDelDiagnostico(g: Diagnostico) {
  return {
    listo: g.listo,
    puntos: g.puntos,
    politica: g.politica,
    techo_usd: g.techoUsd,
    saldo_usd: g.saldoUsd,
    tope_usd: g.topeUsd,
    comprometido_usd: g.comprometidoUsd,
    prueba_abierta: g.pruebaAbierta,
  };
}

const lineasDePuntos = (g: Diagnostico) => g.puntos.map((p) => `  [${p.ok ? "ok" : "falta"}] ${p.punto}: ${p.mensaje}`);

export async function diagnosticar(d: DepsDePrueba, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  let g: Diagnostico;
  try {
    g = await d.leerDiagnostico(d.api, p.clave, p.proyecto.id);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const datos = { proyecto: { id: p.proyecto.id, repo: p.proyecto.repo }, ...datosDelDiagnostico(g) };
  const resumen = `Saldo del mes ${usdONull(g.saldoUsd)} de ${usdONull(g.topeUsd)}; una prueba autoriza hasta ${usd(g.techoUsd)}. Política: ${g.politica}.`;
  if (g.listo) {
    return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: [`Todo listo para probar ${p.proyecto.repo}.`, ...lineasDePuntos(g), resumen].join("\n") };
  }
  const message = `Hay algo para arreglar antes de probar ${p.proyecto.repo}.`;
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "no_listo", message, ...datos }, texto: [message, ...lineasDePuntos(g), resumen].join("\n") };
}

export async function probar(d: DepsDePrueba, flags: FlagsDeProbar): Promise<Resultado> {
  // El reloj del tramo arranca con el comando: los 90 s son del comando entero, no sólo de los sondeos.
  const inicio = d.ahora();
  // Todo lo que se puede rechazar sin mirar nada, antes de tocar el motor o lo guardado.
  if (flags.wait && (flags.autorizoGasto || flags.mensaje !== null)) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles",
      "`probar --wait` sólo sigue una prueba: sin --autorizo-gasto ni --mensaje. Primero `supcoflow probar --autorizo-gasto` y después `supcoflow probar --wait`.");
  }
  if (!flags.wait && flags.prueba !== null) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles", "--prueba va con --wait: `supcoflow probar --wait --prueba prb_…`.");
  }
  if (flags.prueba !== null && !ID_DE_PRUEBA.test(flags.prueba)) {
    return fallo(SALIDA.entradaInvalida, "prueba_invalida", "--prueba es el id que dio `supcoflow probar` (prb_ y 16 caracteres).");
  }
  let mensaje: string | null = null;
  if (flags.mensaje !== null) {
    mensaje = flags.mensaje.trim();
    if (mensaje.length === 0 || mensaje.length > MAX_MENSAJE) {
      return fallo(SALIDA.entradaInvalida, "mensaje_invalido", `--mensaje va con texto, hasta ${MAX_MENSAJE} caracteres.`);
    }
  }

  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const proyecto = p.proyecto;
  const clave = p.clave;

  if (flags.wait) return seguir(d, clave, proyecto.id, flags.prueba, inicio);

  // ── Sin el flag, o con --dry-run: sólo el diagnóstico (gratis). Nada que escriba, ni acá ni en el motor.
  if (!flags.autorizoGasto || flags.dryRun) {
    let g: Diagnostico;
    try {
      g = await d.leerDiagnostico(d.api, clave, proyecto.id);
    } catch (e) {
      return resultadoDeFallo(e);
    }
    const datos = { proyecto: { id: proyecto.id, repo: proyecto.repo }, ...datosDelDiagnostico(g) };
    const gasto = g.politica === "guardar"
      ? `Con la política \`guardar\` la prueba llega hasta el caso guardado y no gasta; el techo que se autoriza igual es ${usd(g.techoUsd)}.`
      : `Una prueba corre un relevamiento que gasta hasta ${usd(g.techoUsd)} (saldo del mes ${usdONull(g.saldoUsd)} de ${usdONull(g.topeUsd)}).`;
    if (flags.dryRun) {
      // Lo guardado se mira sólo para decir qué haría; si no se puede leer, el dry-run igual contesta.
      let pendiente: boolean | null = null;
      try {
        pendiente = (await d.pruebas.leer(proyecto.id)).intento !== null;
      } catch {
        pendiente = null;
      }
      const ruta = rutaDe(proyecto, "/pruebas");
      const haria = pendiente
        ? `reenviaría el pedido guardado sin confirmar (POST ${ruta}, la misma Idempotency-Key)`
        : `POST ${ruta} {techo_usd: ${g.techoUsd}${mensaje !== null ? ", mensaje" : ""}} con una Idempotency-Key nueva`;
      return {
        codigo: SALIDA.ok,
        json: { ok: true, dry_run: true, autorizado: flags.autorizoGasto, intento_pendiente: pendiente, haria, ...datos },
        texto: `Con --dry-run no hago nada. ${flags.autorizoGasto ? "Sin --dry-run" : "Con --autorizo-gasto y sin --dry-run"}: ${haria} (proyecto ${proyecto.repo}, política ${g.politica}). ${gasto}`,
      };
    }
    const message = `${gasto} Para lanzarla: \`supcoflow probar --autorizo-gasto\`. Antes, \`supcoflow diagnosticar\` dice si está todo listo.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "falta_autorizacion", message, ...datos }, texto: message };
  }

  // ── Con --autorizo-gasto: el ciclo de la clave.
  let intento: IntentoDePrueba;
  try {
    const guardado = await d.pruebas.leer(proyecto.id);
    if (guardado.intento !== null) {
      if (mensaje !== null && mensaje !== guardado.intento.mensaje) {
        return fallo(SALIDA.haceFaltaUnaPersona, "intento_pendiente",
          "Hay una prueba pedida sin confirmar; repetí `supcoflow probar --autorizo-gasto` sin `--mensaje` para recuperarla.");
      }
      intento = guardado.intento;
    } else {
      // El techo que se autoriza es el que dice el motor ahora (D6), no uno escrito en la terminal.
      const g = await d.leerDiagnostico(d.api, clave, proyecto.id);
      if (g.pruebaAbierta !== null) return enCurso(g.pruebaAbierta);
      // No frena (el motor decide lo que acepta), pero quien autorizó tiene que ver lo que falta.
      for (const punto of g.puntos.filter((x) => !x.ok)) d.avisar(`Aviso (${punto.punto}): ${punto.mensaje}`);
      intento = { clave: d.generar(), mensaje, techoUsd: g.techoUsd };
      await d.pruebas.abrir(proyecto.id, intento);
    }
  } catch (e) {
    return resultadoDeFallo(e);
  }

  const r = await d.pedirPrueba(d.api, clave, proyecto.id, intento);
  if (r.tipo === "aceptada") {
    try {
      await d.pruebas.confirmar(proyecto.id, r.pruebaId);
    } catch {
      const message = `El motor aceptó la prueba ${r.pruebaId}, pero no pude guardarla en esta máquina. Repetí \`supcoflow probar --autorizo-gasto\` (recupera la misma) o seguila con \`supcoflow probar --wait --prueba ${r.pruebaId}\`.`;
      return { codigo: SALIDA.inesperado, json: { ok: false, error: "prueba_no_guardada", message, prueba_id: r.pruebaId, intento_pendiente: true }, texto: message };
    }
    return {
      codigo: SALIDA.esperandoAUnaPersona,
      json: { ok: false, esperando: "relevamiento", prueba_id: r.pruebaId, reporte_id: r.reporteId, estado: r.estado },
      texto: `Prueba ${r.pruebaId} pedida (${r.estado}). Seguila con \`supcoflow probar --wait\`.`,
    };
  }
  if (r.tipo === "ambigua") {
    const message = `${r.message} El pedido quedó guardado: repetí \`supcoflow probar --autorizo-gasto\` y retomo la misma prueba, sin pedir otra.`;
    return { codigo: SALIDA.inesperado, json: { ok: false, error: r.error, message, intento_pendiente: true }, texto: message };
  }

  // Un rechazo definitivo: el motor no creó nada con esta clave, así que el intento se cierra.
  try {
    await d.pruebas.descartar(proyecto.id);
  } catch {
    d.avisar("No pude cerrar el pedido guardado; el próximo `probar --autorizo-gasto` lo va a reenviar.");
  }
  return rechazo(r, d.avisar);
}

function enCurso(pruebaId: string): Resultado {
  const message = `Ya hay una prueba de este proyecto sin desenlace (${pruebaId}). Seguila con \`supcoflow probar --wait --prueba ${pruebaId}\`.`;
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "prueba_en_curso", message, prueba_id: pruebaId }, texto: message };
}

function rechazo(r: Extract<RespuestaDePrueba, { tipo: "rechazo" }>, avisar: (s: string) => void): Resultado {
  const c = r.cuerpo;
  switch (r.error) {
    case "prueba_en_curso":
      return typeof c.prueba_id === "string" ? enCurso(c.prueba_id) : fallo(SALIDA.haceFaltaUnaPersona, r.error, r.message);
    case "techo_distinto": {
      const message = `${r.message} Volvé a correr \`supcoflow probar\` para ver el techo vigente y autorizalo.`;
      return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: r.error, message, techo_usd: c.techo_usd ?? null }, texto: message };
    }
    case "tope_mensual":
      return {
        codigo: SALIDA.topeAlcanzado,
        json: { ok: false, error: r.error, message: r.message, comprometido_usd: c.comprometido_usd ?? null, tope_usd: c.tope_usd ?? null },
        texto: r.message,
      };
    case "requiere_api_key": {
      const message = `La prueba se pide con tu API key personal (la que deja \`supcoflow login\`), no con una clave de consulta ni con la sesión de la consola. ${r.message}`;
      return fallo(SALIDA.haceFaltaUnaPersona, r.error, message);
    }
    case "idempotency_key_reusada":
      // No debería pasar: siempre se reenvía lo guardado con su clave. Si pasa, la clave ya no sirve.
      avisar("El motor dice que la clave del pedido ya se usó con otro contenido; la descarté.");
      return fallo(SALIDA.inesperado, r.error, `${r.message} Volvé a correr \`supcoflow probar --autorizo-gasto\` para pedir una prueba nueva.`);
  }
  if (r.status === 401) return fallo(SALIDA.faltaLogin, "clave_invalida", r.message);
  if (r.status === 403 || r.error === "chat_deshabilitado") return fallo(SALIDA.haceFaltaUnaPersona, r.error, r.message);
  return fallo(SALIDA.entradaInvalida, r.error, r.message);
}

function textoDelCobro(c: Seguimiento["cobro"]): string | null {
  // Pendiente y perdido nunca se muestran como cero: el monto todavía no se sabe, la cota es el techo.
  if (c.estado === "leido" && c.usd !== null) return `Costo: ${usd(c.usd)}.`;
  if (c.estado === "pendiente") return `Cobro pendiente: se lee unos minutos después del cierre (hasta ${usd(c.techo_usd)}).`;
  if (c.estado === "perdido") return `Cobro perdido: no se pudo leer el gasto (hasta ${usd(c.techo_usd)}).`;
  if (c.estado === null) return null;
  return `Cobro: ${c.estado} (hasta ${usd(c.techo_usd)}).`;
}

function resultadoDelSeguimiento(s: Seguimiento): Resultado {
  const datos = {
    prueba_id: s.pruebaId, estado: s.estado, abierta: s.abierta, mensaje: s.mensaje,
    reporte: s.reporte, run: s.run, issue: s.issue, cobro: s.cobro,
  };
  const lineas = [
    `Prueba ${s.pruebaId}: ${s.estado}.${s.mensaje ? ` ${s.mensaje}` : ""}`,
    s.issue ? `Issue #${s.issue.numero}: ${s.issue.url}` : null,
    s.run?.motivo ? `Motivo del run: ${s.run.motivo}` : null,
    textoDelCobro(s.cobro),
  ];
  if (ABIERTOS.has(s.estado)) {
    lineas.push("Volvé a correr `supcoflow probar --wait`.");
    return { codigo: SALIDA.esperandoAUnaPersona, json: { ok: false, esperando: "relevamiento", ...datos }, texto: lineas.filter(Boolean).join("\n") };
  }
  if (CON_DESENLACE_OK.has(s.estado)) return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: lineas.filter(Boolean).join("\n") };
  if (PIDEN_UNA_PERSONA.has(s.estado)) {
    if (s.reporte) lineas.push(`El caso en la consola: ${s.reporte.url}`);
    const texto = lineas.filter(Boolean).join("\n");
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: s.estado, message: s.mensaje ?? texto, ...datos }, texto };
  }
  const message = `El motor dice que la prueba está en «${s.estado}», un estado que esta versión de la terminal no conoce. Actualizá supcoflow o mirala en la consola.`;
  return { codigo: SALIDA.inesperado, json: { ok: false, error: "estado_desconocido", message, ...datos }, texto: message };
}

async function seguir(d: DepsDePrueba, clave: string, proyectoId: string, elegida: string | null, inicio: number): Promise<Resultado> {
  let pruebaId = elegida;
  if (pruebaId === null) {
    try {
      const g = await d.pruebas.leer(proyectoId);
      // Un pedido sin confirmar gana sobre la última: seguir la anterior y salir 0 con SU issue se leería
      // como el desenlace de la prueba recién pedida. Con `--prueba` explícito no se llega acá.
      pruebaId = g.ultima;
      if (g.intento !== null) {
        return fallo(SALIDA.haceFaltaUnaPersona, "intento_pendiente",
          "Hay una prueba pedida sin confirmar; repetí `supcoflow probar --autorizo-gasto` sin `--mensaje` para recuperarla, y después `--wait`.");
      }
    } catch (e) {
      return resultadoDeFallo(e);
    }
    if (pruebaId === null) {
      return fallo(SALIDA.entradaInvalida, "sin_prueba", "No hay una prueba guardada en esta máquina para este proyecto: pedila con `supcoflow probar --autorizo-gasto`, o pasá `--prueba prb_…`.");
    }
  }
  // Se aparta lo que puede tardar un sondeo forzado (el primero siempre va, aunque quede poco): así el
  // comando entero no pasa de 90 s aunque resolver el proyecto haya tardado.
  const limite = inicio + Math.min(d.tramoMs ?? TRAMO_MAXIMO_MS, TRAMO_MAXIMO_MS) - PLAZO_MINIMO_DE_SONDEO_MS;
  let ultimo: Seguimiento | null = null;
  for (;;) {
    const plazoMs = Math.min(PLAZO_MAXIMO_DE_SONDEO_MS, limite - d.ahora());
    if (plazoMs < PLAZO_MINIMO_DE_SONDEO_MS && ultimo !== null) break;
    try {
      // Un fallo del motor a mitad del tramo sale 1 y no se reintenta en silencio (P13): quien llama decide.
      ultimo = await d.leerPrueba(d.api, clave, proyectoId, pruebaId, Math.max(plazoMs, PLAZO_MINIMO_DE_SONDEO_MS));
    } catch (e) {
      return resultadoDeFallo(e);
    }
    if (!ABIERTOS.has(ultimo.estado)) break;
    if (limite - (d.ahora() + INTERVALO_DE_SEGUIMIENTO_MS) < PLAZO_MINIMO_DE_SONDEO_MS) break;
    await d.dormir(INTERVALO_DE_SEGUIMIENTO_MS);
  }
  return resultadoDelSeguimiento(ultimo!);
}
