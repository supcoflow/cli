// `supcoflow diagnose` y `supcoflow test` (bloque 7, la prueba): ¿un problema que entra por el
// chat llega hasta un issue? El diagnóstico es gratis y sólo lee. La prueba gasta un relevamiento (techo
// del motor, hoy US$ 2): sin `--authorize-spend` no se manda nada que escriba (R6).
//
// Lo que la persona vio es lo que viaja (R5, 0.8.0): `--authorize-spend` exige `--ceiling` (el número que se le
// mostró) y `--expect-policy` (la política con la que se le ofreció) y manda esos dos valores; no relee el
// diagnóstico para elegirlos. El motor los compara con los de ahora: `techo_distinto` / `politica_distinta` salen
// 4 con los valores nuevos y sin reintentar, y la persona decide de nuevo. El alias viejo `probar --autorizo-gasto`
// exige también `--ceiling` (un alias no puede ampliar lo autorizado) pero no `--expect-policy`.
//
// El ciclo de la clave (hallazgo 5), en el orden en que se lee abajo:
//   1. Sin intento guardado: clave nueva, y el intento ENTERO guardado antes del POST (estricto).
//   2. Con intento guardado: es un reintento; misma clave, mismo mensaje, mismo techo, misma política. Otro
//      `--message`, otro `--ceiling` u otra `--expect-policy` sale 4 `intento_pendiente` sin mandar nada.
//   3. 202: la última prueba = la del motor y el intento cerrado, en una escritura (src/pruebas-guardadas.ts).
//      Si falla, sale 1 con el id y el intento sigue abierto: el próximo recibe la misma prueba.
//   4. Ambigua (sin respuesta, 5xx, pausa, otro intento en curso): el intento se conserva. Rechazo
//      definitivo: se cierra, el motor no creó nada con esa clave.
//   5. Una prueba nueva es `test --authorize-spend` sin intento abierto: clave nueva aunque el mensaje
//      sea el mismo.
//
// `--wait` sigue la prueba por tramos (≤ 90 s el comando entero, como `login --wait`): el estado lo deriva
// el motor en cada llamada y acá sólo se traduce a un código de salida con la tabla de la prueba.
import type { Diagnostico, IntentoDePrueba, RespuestaDePrueba, Seguimiento } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { agruparPuntos, contarBuenos, lineaDeLoRevisado, nombreDelPunto, puntoDeSesion, puntoDelRepo, TOTAL_DE_INSTALACION, type Punto } from "../diagnostico.ts";
import type { PoliticaEsperada, RegistroDePruebas } from "../pruebas-guardadas.ts";
import { leerRepoLocal } from "../repo-local.ts";
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

// `viejo` es true si el pedido llegó por `probar` o por `--autorizo-gasto`: ese alias no puede ampliar lo autorizado
// (exige `--ceiling`) pero tampoco exige la política, como la 0.7.0.
type FlagsDeProbar = Pick<Flags, "repo" | "dryRun" | "wait" | "authorizeSpend" | "message" | "testId" | "ceiling" | "expectPolicy"> & { viejo?: boolean };

// Las cotas de `BugReportSchema` del motor (D2): el mensaje es el cuerpo del reporte. Se mira acá para no
// gastar un pedido (ni guardar un intento que el motor va a rechazar); la regla de verdad es la del motor.
const MAX_MENSAJE = 20_000;
const ID_DE_PRUEBA = /^prb_[0-9a-f]{16}$/;
const TECHO = /^\d+(?:\.\d{1,4})?$/;
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
const usdONull = (n: number | null) => (n === null ? "unmeasured" : usd(n));

// La política como se dice en inglés; a la API siempre viaja la suya (`relevar` / `guardar`).
const POLITICA_EN_INGLES: Record<string, string> = { relevar: "investigate", guardar: "save" };
const enInglesLaPolitica = (p: string | null) => (p === null ? "none" : (POLITICA_EN_INGLES[p] ?? p));
const aLaPoliticaDeLaApi = (p: string): PoliticaEsperada | null =>
  p === "investigate" || p === "relevar" ? "relevar" : p === "save" || p === "guardar" ? "guardar" : null;

// El comando exacto para retomar un pedido guardado: con lo que se autorizó, no con lo que haya ahora.
const comandoDeReintento = (i: IntentoDePrueba) =>
  `supcoflow test --authorize-spend --ceiling ${i.techoUsd}${i.politicaEsperada !== null ? ` --expect-policy ${enInglesLaPolitica(i.politicaEsperada)}` : ""}`;

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

const lineasDePuntos = (puntos: Punto[], nombre = (p: string) => p) => puntos.map((p) => `  [${p.ok ? "ok" : "missing"}] ${nombre(p.punto)}: ${p.mensaje}`);

export async function diagnosticar(d: DepsDePrueba, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  let g: Diagnostico;
  try {
    g = await d.leerDiagnostico(d.api, p.clave, p.proyecto.id);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  // Los dos puntos que sólo la terminal puede ver: la llamada de arriba autenticó (si no, no se llega acá) y el
  // `origin` de esta carpeta es el repo del proyecto. Sin git o sin origin no se adivina: el punto sale no ok.
  let local: Awaited<ReturnType<typeof leerRepoLocal>>;
  try {
    local = await leerRepoLocal(d.git, d.cwd);
  } catch {
    local = { repo: null, raiz: null, motivo: "sin_git" };
  }
  const { instalacion, prueba } = agruparPuntos(g, [puntoDeSesion(), puntoDelRepo(local, p.proyecto.repo)]);
  const buenos = contarBuenos(instalacion);
  const listo = g.listo && instalacion.every((x) => x.ok || !["sign-in", "repo"].includes(x.punto));
  const datos = {
    proyecto: { id: p.proyecto.id, repo: p.proyecto.repo },
    ...datosDelDiagnostico(g),
    listo,
    puntos: [...instalacion, ...prueba],
    instalacion: { ok: buenos, total: TOTAL_DE_INSTALACION, puntos: instalacion },
    prueba: { listo: g.listo, puntos: prueba },
  };
  const resumen = `Monthly balance ${usdONull(g.saldoUsd)} of ${usdONull(g.topeUsd)}; a test authorizes up to ${usd(g.techoUsd)}. Policy: ${enInglesLaPolitica(g.politica)}.`;
  const motivos = [
    ...prueba.filter((x) => !x.ok).map((x) => x.mensaje),
    ...(buenos < TOTAL_DE_INSTALACION ? [`the installation isn't complete (${buenos} of ${TOTAL_DE_INSTALACION})`] : []),
  ];
  const listaParaProbar = listo ? "Ready for a test: yes." : `Ready for a test: no, because ${motivos.join("; ") || "the engine says it isn't ready"}`;
  const cuerpo = [
    lineaDeLoRevisado(buenos),
    ...lineasDePuntos(instalacion, nombreDelPunto),
    listaParaProbar,
    ...lineasDePuntos(prueba),
    resumen,
  ];
  if (listo) return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: cuerpo.join("\n") };
  const message = `Something needs fixing before testing ${p.proyecto.repo}.`;
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "no_listo", message, ...datos }, texto: [message, ...cuerpo].join("\n") };
}

export async function probar(d: DepsDePrueba, flags: FlagsDeProbar): Promise<Resultado> {
  // El reloj del tramo arranca con el comando: los 90 s son del comando entero, no sólo de los sondeos.
  const inicio = d.ahora();
  // Todo lo que se puede rechazar sin mirar nada, antes de tocar el motor o lo guardado.
  if (flags.wait && (flags.authorizeSpend || flags.message !== null || flags.ceiling !== null || flags.expectPolicy !== null)) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles",
      "`test --wait` only follows a test: no --authorize-spend, --ceiling, --expect-policy or --message. First `supcoflow test --authorize-spend --ceiling <usd> --expect-policy <policy>`, then `supcoflow test --wait`.");
  }
  if (!flags.wait && flags.testId !== null) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles", "--test-id goes with --wait: `supcoflow test --wait --test-id prb_…`.");
  }
  if (!flags.authorizeSpend && !flags.wait && (flags.ceiling !== null || flags.expectPolicy !== null)) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles", "--ceiling and --expect-policy go with --authorize-spend: they say what you authorize.");
  }
  if (flags.testId !== null && !ID_DE_PRUEBA.test(flags.testId)) {
    return fallo(SALIDA.entradaInvalida, "prueba_invalida", "--test-id is the id `supcoflow test` printed (prb_ and 16 characters).");
  }
  let mensaje: string | null = null;
  if (flags.message !== null) {
    mensaje = flags.message.trim();
    if (mensaje.length === 0 || mensaje.length > MAX_MENSAJE) {
      return fallo(SALIDA.entradaInvalida, "mensaje_invalido", `--message goes with text, up to ${MAX_MENSAJE} characters.`);
    }
  }
  // Lo que la persona autorizó: el techo y la política que vio. Sin eso no hay pedido que valga (R5).
  let autorizado: { techoUsd: number; politicaEsperada: PoliticaEsperada | null } | null = null;
  if (flags.authorizeSpend) {
    if (flags.ceiling === null) {
      const comoSeEscribe = "`supcoflow test --authorize-spend --ceiling <usd> --expect-policy investigate|save`";
      return fallo(SALIDA.entradaInvalida, "falta_techo", flags.viejo === true
        ? `\`probar --autorizo-gasto\` now needs --ceiling <usd>, the number you were shown: an alias can't widen what you authorized. Use ${comoSeEscribe}. (The old behaviour is in supcoflow 0.7.0.)`
        : `--authorize-spend needs --ceiling <usd>, the number you were shown: ${comoSeEscribe}.`);
    }
    if (!TECHO.test(flags.ceiling) || !(Number(flags.ceiling) > 0)) {
      return fallo(SALIDA.entradaInvalida, "techo_invalido", "--ceiling is a positive number of US dollars, for example 2 or 2.50.");
    }
    let politicaEsperada: PoliticaEsperada | null = null;
    if (flags.expectPolicy !== null) {
      politicaEsperada = aLaPoliticaDeLaApi(flags.expectPolicy);
      if (politicaEsperada === null) return fallo(SALIDA.entradaInvalida, "politica_invalida", "--expect-policy is `investigate` or `save`.");
    } else if (flags.viejo !== true) {
      return fallo(SALIDA.entradaInvalida, "falta_politica", "--authorize-spend needs --expect-policy investigate|save: the policy you were offered, so a yes to a test that won't investigate can't turn into a paid one.");
    }
    autorizado = { techoUsd: Number(flags.ceiling), politicaEsperada };
  }

  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const proyecto = p.proyecto;
  const clave = p.clave;

  if (flags.wait) return seguir(d, clave, proyecto.id, flags.testId, inicio);

  // ── Sin el flag, o con --dry-run: sólo el diagnóstico (gratis). Nada que escriba, ni acá ni en el motor.
  if (autorizado === null || flags.dryRun) {
    let g: Diagnostico;
    try {
      g = await d.leerDiagnostico(d.api, clave, proyecto.id);
    } catch (e) {
      return resultadoDeFallo(e);
    }
    const datos = { proyecto: { id: proyecto.id, repo: proyecto.repo }, ...datosDelDiagnostico(g) };
    const gasto = g.politica === "guardar"
      ? `With the \`save\` policy the test goes as far as the saved case and spends nothing; the ceiling it authorizes is still ${usd(g.techoUsd)}.`
      : `A test runs an investigation that spends up to ${usd(g.techoUsd)} (monthly balance ${usdONull(g.saldoUsd)} of ${usdONull(g.topeUsd)}).`;
    if (flags.dryRun) {
      // Lo guardado se mira sólo para decir qué haría; si no se puede leer, el dry-run igual contesta.
      let pendiente: boolean | null = null;
      try {
        pendiente = (await d.pruebas.leer(proyecto.id)).intento !== null;
      } catch {
        pendiente = null;
      }
      const ruta = rutaDe(proyecto, "/pruebas");
      const cuerpo = autorizado === null ? `techo_usd: ${g.techoUsd}` : `techo_usd: ${autorizado.techoUsd}${autorizado.politicaEsperada !== null ? `, politica_esperada: ${autorizado.politicaEsperada}` : ""}`;
      const haria = pendiente
        ? `would resend the saved request that was never confirmed (POST ${ruta}, the same Idempotency-Key)`
        : `would send POST ${ruta} {${cuerpo}${mensaje !== null ? ", mensaje" : ""}} with a new Idempotency-Key`;
      return {
        codigo: SALIDA.ok,
        json: { ok: true, dry_run: true, autorizado: flags.authorizeSpend, intento_pendiente: pendiente, haria, ...datos },
        texto: `With --dry-run I do nothing. ${flags.authorizeSpend ? "Without --dry-run, I" : "With --authorize-spend and without --dry-run, I"}${haria.replace(/^would/, "")} (project ${proyecto.repo}, policy ${enInglesLaPolitica(g.politica)}). ${gasto}`,
      };
    }
    const lanzar = `supcoflow test --authorize-spend --ceiling ${g.techoUsd} --expect-policy ${enInglesLaPolitica(g.politica)}`;
    const message = `${gasto} To launch it: \`${lanzar}\`. \`supcoflow diagnose\` first says whether everything is ready.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "falta_autorizacion", message, ...datos }, texto: message };
  }

  // ── Con --authorize-spend: el ciclo de la clave.
  let intento: IntentoDePrueba;
  try {
    const guardado = await d.pruebas.leer(proyecto.id);
    if (guardado.intento !== null) {
      const previo = guardado.intento;
      const igual = Math.abs(previo.techoUsd - autorizado.techoUsd) < 1e-9 && previo.politicaEsperada === autorizado.politicaEsperada;
      if (mensaje !== null && mensaje !== previo.mensaje) {
        return fallo(SALIDA.haceFaltaUnaPersona, "intento_pendiente",
          `There's a test request waiting for confirmation; repeat \`${comandoDeReintento(previo)}\` without --message to recover it.`);
      }
      if (!igual) {
        return fallo(SALIDA.haceFaltaUnaPersona, "intento_pendiente",
          `There's a test request waiting for confirmation, authorized with a ceiling of ${usd(previo.techoUsd)}; repeat it with exactly that to recover it: \`${comandoDeReintento(previo)}\`.`);
      }
      intento = previo;
    } else {
      // Lo que se manda es lo que la persona vio (R5): no se relee el diagnóstico para elegirlo. El motor compara
      // el techo y la política con los de ahora y rechaza si cambiaron.
      intento = { clave: d.generar(), mensaje, techoUsd: autorizado.techoUsd, politicaEsperada: autorizado.politicaEsperada };
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
      const message = `The engine accepted test ${r.pruebaId}, but I couldn't save it on this machine. Repeat \`${comandoDeReintento(intento)}\` (it recovers the same one) or follow it with \`supcoflow test --wait --test-id ${r.pruebaId}\`.`;
      return { codigo: SALIDA.inesperado, json: { ok: false, error: "prueba_no_guardada", message, prueba_id: r.pruebaId, intento_pendiente: true }, texto: message };
    }
    return {
      codigo: SALIDA.esperandoAUnaPersona,
      json: { ok: false, esperando: "relevamiento", prueba_id: r.pruebaId, reporte_id: r.reporteId, estado: r.estado },
      texto: `Test ${r.pruebaId} requested (${r.estado}). Follow it with \`supcoflow test --wait\`.`,
    };
  }
  if (r.tipo === "ambigua") {
    const message = `${r.message} The request was saved: repeat \`${comandoDeReintento(intento)}\` and I'll pick up the same test, without asking for another.`;
    return { codigo: SALIDA.inesperado, json: { ok: false, error: r.error, message, intento_pendiente: true }, texto: message };
  }

  // Un rechazo definitivo: el motor no creó nada con esta clave, así que el intento se cierra.
  try {
    await d.pruebas.descartar(proyecto.id);
  } catch {
    d.avisar("I couldn't close the saved request; the next `test --authorize-spend` will resend it.");
  }
  return rechazo(r, intento, d.avisar);
}

function enCurso(pruebaId: string): Resultado {
  const message = `This project already has a test with no outcome (${pruebaId}). Follow it with \`supcoflow test --wait --test-id ${pruebaId}\`.`;
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "prueba_en_curso", message, prueba_id: pruebaId }, texto: message };
}

function rechazo(r: Extract<RespuestaDePrueba, { tipo: "rechazo" }>, intento: IntentoDePrueba, avisar: (s: string) => void): Resultado {
  const c = r.cuerpo;
  switch (r.error) {
    case "prueba_en_curso":
      return typeof c.prueba_id === "string" ? enCurso(c.prueba_id) : fallo(SALIDA.haceFaltaUnaPersona, r.error, r.message);
    case "techo_distinto": {
      // Sin reintentar: lo que se autorizó ya no es lo que hay, y decidir de nuevo es de la persona (con el número nuevo).
      const nuevo = typeof c.techo_usd === "number" ? c.techo_usd : null;
      const message = `The ceiling for a test changed${nuevo !== null ? `: it's now ${usd(nuevo)}` : ""}, and you authorized ${usd(intento.techoUsd)}. Nothing was started. Ask again with the new number.`;
      return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: r.error, message, techo_usd: nuevo, autorizado_usd: intento.techoUsd }, texto: message };
    }
    case "politica_distinta": {
      const ahora = typeof c.politica === "string" ? c.politica : typeof c.politica_actual === "string" ? c.politica_actual : null;
      const message = `The project's policy changed${ahora !== null ? `: it's now \`${enInglesLaPolitica(ahora)}\`` : ""}, and you authorized a test under \`${enInglesLaPolitica(intento.politicaEsperada)}\`. Nothing was started. Ask again with the current policy.`;
      return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: r.error, message, politica: ahora, politica_esperada: intento.politicaEsperada }, texto: message };
    }
    case "tope_mensual":
      return {
        codigo: SALIDA.topeAlcanzado,
        json: { ok: false, error: r.error, message: r.message, comprometido_usd: c.comprometido_usd ?? null, tope_usd: c.tope_usd ?? null },
        texto: r.message,
      };
    case "requiere_api_key": {
      const message = `The test is requested with your personal API key (the one \`supcoflow login\` leaves), not with a read-only key or the console session. ${r.message}`;
      return fallo(SALIDA.haceFaltaUnaPersona, r.error, message);
    }
    case "idempotency_key_reusada":
      // No debería pasar: siempre se reenvía lo guardado con su clave. Si pasa, la clave ya no sirve.
      avisar("The engine says this request's key was already used with other content; I discarded it.");
      return fallo(SALIDA.inesperado, r.error, `${r.message} Run \`${comandoDeReintento(intento)}\` again to ask for a new test.`);
  }
  if (r.status === 401) return fallo(SALIDA.faltaLogin, "clave_invalida", r.message);
  if (r.status === 403 || r.error === "chat_deshabilitado") return fallo(SALIDA.haceFaltaUnaPersona, r.error, r.message);
  return fallo(SALIDA.entradaInvalida, r.error, r.message);
}

function textoDelCobro(c: Seguimiento["cobro"]): string | null {
  // Pendiente y perdido nunca se muestran como cero: el monto todavía no se sabe, la cota es el techo.
  if (c.estado === "leido" && c.usd !== null) return `Cost: ${usd(c.usd)}.`;
  if (c.estado === "pendiente") return `Charge pending: it's read a few minutes after the run closes (up to ${usd(c.techo_usd)}).`;
  if (c.estado === "perdido") return `Charge lost: the spend couldn't be read (up to ${usd(c.techo_usd)}).`;
  if (c.estado === null) return null;
  return `Charge: ${c.estado} (up to ${usd(c.techo_usd)}).`;
}

function resultadoDelSeguimiento(s: Seguimiento): Resultado {
  const datos = {
    prueba_id: s.pruebaId, estado: s.estado, abierta: s.abierta, mensaje: s.mensaje,
    reporte: s.reporte, run: s.run, issue: s.issue, cobro: s.cobro,
  };
  const lineas = [
    `Test ${s.pruebaId}: ${s.estado}.${s.mensaje ? ` ${s.mensaje}` : ""}`,
    s.issue ? `Issue #${s.issue.numero}: ${s.issue.url}` : null,
    s.run?.motivo ? `Run reason: ${s.run.motivo}` : null,
    textoDelCobro(s.cobro),
  ];
  if (ABIERTOS.has(s.estado)) {
    lineas.push("Run `supcoflow test --wait` again.");
    return { codigo: SALIDA.esperandoAUnaPersona, json: { ok: false, esperando: "relevamiento", ...datos }, texto: lineas.filter(Boolean).join("\n") };
  }
  if (CON_DESENLACE_OK.has(s.estado)) return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: lineas.filter(Boolean).join("\n") };
  if (PIDEN_UNA_PERSONA.has(s.estado)) {
    if (s.reporte) lineas.push(`The case in the console: ${s.reporte.url}`);
    const texto = lineas.filter(Boolean).join("\n");
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: s.estado, message: s.mensaje ?? texto, ...datos }, texto };
  }
  const message = `The engine says the test is in «${s.estado}», a state this version of the terminal doesn't know. Update supcoflow or look at it in the console.`;
  return { codigo: SALIDA.inesperado, json: { ok: false, error: "estado_desconocido", message, ...datos }, texto: message };
}

async function seguir(d: DepsDePrueba, clave: string, proyectoId: string, elegida: string | null, inicio: number): Promise<Resultado> {
  let pruebaId = elegida;
  if (pruebaId === null) {
    try {
      const g = await d.pruebas.leer(proyectoId);
      // Un pedido sin confirmar gana sobre la última: seguir la anterior y salir 0 con SU issue se leería
      // como el desenlace de la prueba recién pedida. Con `--test-id` explícito no se llega acá.
      pruebaId = g.ultima;
      if (g.intento !== null) {
        return fallo(SALIDA.haceFaltaUnaPersona, "intento_pendiente",
          `There's a test request waiting for confirmation; repeat \`${comandoDeReintento(g.intento)}\` without --message to recover it, and then \`--wait\`.`);
      }
    } catch (e) {
      return resultadoDeFallo(e);
    }
    if (pruebaId === null) {
      return fallo(SALIDA.entradaInvalida, "sin_prueba", "There's no saved test on this machine for this project: request one with `supcoflow test --authorize-spend --ceiling <usd> --expect-policy <policy>`, or pass `--test-id prb_…`.");
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
