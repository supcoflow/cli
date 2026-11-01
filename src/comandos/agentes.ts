// `supcoflow agents show | set-key | check | remove | configure` — la cuenta de IA de cada agente (tanda 9 de «La IA la pone el cliente»,
// plan v2 §8; decisión D5: el lugar de la configuración es la pestaña Agents del dashboard, y la terminal sirve también).
//
// ─── Una regla manda sobre todo lo demás: la clave de IA del cliente es de SÓLO ESCRITURA ────────────────────────────────────────
//
// Entra por una terminal sin eco o por una variable de entorno que la persona NOMBRA (`--from-env NOMBRE`); nunca como argumento, ni
// por stdin. Viaja en el cuerpo de UN pedido (`PUT …/cuentas-de-ia/{agente}`) y no sale por ningún lado: ni la pantalla, ni `--json`, ni
// stderr, ni un error. Lo que impide que salga, de afuera hacia adentro:
//
//   1. No hay un flag que la reciba (un `--key` es `flag_desconocido`, y el error no repite el valor).
//   2. `--from-env` lleva un NOMBRE: si lo que se pegó ahí parece una clave, no se repite en el mensaje (`clave_como_nombre`).
//   3. Nada de lo que dice el motor llega a la pantalla como texto libre: cada error se dice con una frase FIJA de esta terminal, y de
//      la respuesta sólo pasan campos de una lista blanca (`cuentaPublica`): ids cortos, los últimos 4 caracteres y fechas.
//   4. Al final, todo lo que sale del comando que la manejó (`set-key`) se barre: la clave literal y todo lo que tenga forma de clave
//      se tapa, aunque el motor (por un bug) la repitiera.
//   5. No se guarda en ningún archivo (ni credenciales, ni idempotencia, ni pruebas): `PUT` es idempotente en intención y no usa clave de reintento.
//
// Los mensajes del motor ya no se imprimen en estos comandos: son castellano libre que no controla esta terminal. El `error` del motor sí
// se conserva (un identificador, validado), para que quien llama pueda decidir.
import type { Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { nombreDeVariableValido, normalizarClave, pareceUnaClave } from "../clave-sin-eco.ts";
import { FalloDeLaTerminal, resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { dryRun, fallo, rutaDe } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeAgentes = DepsDelProyectoDelRepo & {
  /** El entorno del proceso: de acá sale la clave con `--from-env`. */
  env: Record<string, string | undefined>;
  /** ¿Hay una terminal interactiva donde preguntar la clave sin eco? */
  esTty: boolean;
  /** Pregunta la clave SIN ECO. Devuelve `null` si la persona canceló; lanza si no puede ocultar lo que se escribe (entonces NO se pregunta). */
  leerClaveOculta(pregunta: string): Promise<string | null>;
  leerCuentas(api: URL, clave: string, proyectoId: string): Promise<Respuesta>;
  ponerCuenta(api: URL, clave: string, proyectoId: string, agente: string, cuerpo: { clave: string; proveedor: string }): Promise<Respuesta>;
  validarCuenta(api: URL, clave: string, proyectoId: string, agente: string): Promise<Respuesta>;
  quitarCuenta(api: URL, clave: string, proyectoId: string, agente: string): Promise<Respuesta>;
  configurarChat(api: URL, clave: string, proyectoId: string, cuerpo: { opcion: string; sin_guardado_de_datos: boolean }): Promise<Respuesta>;
  /** Reservado: estos comandos no escriben nada fuera de su resultado, y los tests lo comprueban mirando lo que llegó acá. */
  avisar: (s: string) => void;
};

type FlagsDeAgentes = Pick<Flags, "repo" | "dryRun" | "agent" | "fromEnv" | "provider" | "option" | "dataRetention">;
type Agente = "chat" | "triaje";

// ─── Los agentes ───────────────────────────────────────────────────────────────────────────────────────────────

// Cómo se escribe en la terminal (`--agent triage`) y cómo se llama en el motor (`triaje`). El motor acepta los dos nombres acá.
const AGENTE_DEL_FLAG: ReadonlyMap<string, Agente> = new Map<string, Agente>([["chat", "chat"], ["triage", "triaje"], ["triaje", "triaje"]]);
const COMO_SE_ESCRIBE: Record<Agente, string> = { chat: "chat", triaje: "triage" };
const COMO_SE_LLAMA: Record<Agente, string> = { chat: "chat", triaje: "triage agent" };

function elAgente(valor: string | null): { ok: true; agente: Agente } | { ok: false; resultado: Resultado } {
  if (valor === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_agente", "Say which agent: `--agent chat` or `--agent triage`.") };
  const agente = AGENTE_DEL_FLAG.get(valor);
  // El valor no se repite: alguien pudo pegar ahí otra cosa.
  if (agente === undefined) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "agente_invalido", "--agent is `chat` or `triage`.") };
  return { ok: true, agente };
}

// ─── Lo que se acepta del motor (lista blanca) ─────────────────────────────────────────────────────────────────

const ESTADOS = new Set(["lista", "rechazada", "sin_saldo", "falta"]);
// Identificadores cortos y en minúsculas. Una clave (con mayúsculas o con un prefijo conocido) no pasa por acá.
const idSeguro = (v: unknown, largo = 48): string | null =>
  typeof v === "string" && new RegExp(`^[a-z][a-z0-9_-]{0,${largo - 1}}$`).test(v) && !pareceUnaClave(v) ? v : null;
const fecha = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const ultimos4 = (v: unknown): string => (typeof v === "string" && /^[A-Za-z0-9_-]{0,4}$/.test(v) ? v : "");
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

type CuentaPublica = {
  proveedor: string | null; ultimos4: string; estado: string; codigo: string | null;
  validada_en: string | null; puesta_por: string | null; puesta_en: string | null;
};

/** Los siete campos que pasan de una cuenta del motor. Cualquier otro (aunque fuera la clave) se descarta. */
function cuentaPublica(v: unknown): CuentaPublica | null {
  const c = objeto(v);
  if (c === null) return null;
  const quien = typeof c.puesta_por === "string" && /^[A-Za-z0-9_.:@-]{1,128}$/.test(c.puesta_por) && !pareceUnaClave(c.puesta_por) ? c.puesta_por : null;
  return {
    proveedor: idSeguro(c.proveedor, 32),
    ultimos4: ultimos4(c.ultimos4),
    estado: ESTADOS.has(String(c.estado)) ? String(c.estado) : "desconocido",
    codigo: idSeguro(c.codigo),
    validada_en: fecha(c.validada_en),
    puesta_por: quien,
    puesta_en: fecha(c.puesta_en),
  };
}

const NOMBRE_DEL_PROVEEDOR: ReadonlyMap<string, string> = new Map([["ai_gateway", "AI Gateway"]]);
const proveedorEnTexto = (p: string | null) => (p === null ? "AI" : (NOMBRE_DEL_PROVEEDOR.get(p) ?? p));

const avisosSeguros = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => idSeguro(x, 64)).filter((x): x is string => x !== null) : []);
const TEXTO_DEL_AVISO: ReadonlyMap<string, string> = new Map([
  ["saldo_cero", "The key works, but the account has no balance loaded: the first chat or investigation would fail. Add balance at your provider."],
  ["verificacion_de_pago_pendiente", "The key works, but the provider still asks you to verify a payment method (the card) before it lets you use it."],
  ["tope_de_la_clave_no_verificable", "The account is ready again, but I can't check that the key's own spending cap went up: if it runs out again, raise it at your provider."],
]);
const textoDelAviso = (a: string) => TEXTO_DEL_AVISO.get(a) ?? "The provider returned a warning about the account: look at it in your provider's panel.";

// ─── Los errores del motor, con frases fijas ───────────────────────────────────────────────────────────────────

// Qué sale, por el `error` que manda el motor. Lo que no está acá se dice según el status. El texto es de esta terminal.
const ERRORES: ReadonlyMap<string, { codigo: Resultado["codigo"]; message: string }> = new Map(Object.entries({
  requiere_dueno: { codigo: SALIDA.haceFaltaUnaPersona, message: "Only a team Owner can set, replace or remove an AI account. You can see its state with `supcoflow agents show`." },
  requiere_persona: { codigo: SALIDA.haceFaltaUnaPersona, message: "This needs a person signed in with their own key (`supcoflow login`), not a read-only key." },
  clave_de_consulta: { codigo: SALIDA.haceFaltaUnaPersona, message: "This needs a person signed in with their own key (`supcoflow login`), not a read-only key." },
  clave_rechazada: { codigo: SALIDA.entradaInvalida, message: "The AI provider rejected that key. It was not saved." },
  clave_con_forma_invalida: { codigo: SALIDA.entradaInvalida, message: "That doesn't look like a key for that provider: check that you copied all of it. It was not saved." },
  proveedor_desconocido: { codigo: SALIDA.entradaInvalida, message: "That AI provider isn't available." },
  agente_desconocido: { codigo: SALIDA.entradaInvalida, message: "That agent doesn't have an AI account of its own: they are `chat` and `triage`." },
  invalid_body: { codigo: SALIDA.entradaInvalida, message: "The engine didn't accept the request." },
  invalid_json: { codigo: SALIDA.entradaInvalida, message: "The engine didn't accept the request." },
  opcion_sin_medicion: { codigo: SALIDA.entradaInvalida, message: "That option hasn't passed our measurement as a chat yet, so it can't be chosen." },
  sin_guardado_de_datos_no_disponible: { codigo: SALIDA.entradaInvalida, message: "That option can't guarantee that the provider doesn't keep data: choose `--data-retention allow` or another option." },
  proveedor_no_responde: { codigo: SALIDA.inesperado, message: "I couldn't reach the AI provider to check the key, so nothing was saved or changed. Try again in a while." },
  cuentas_no_disponibles: { codigo: SALIDA.inesperado, message: "The engine can't store AI accounts right now. It isn't your key's fault: try again later, or tell us if it keeps happening." },
  conflicto: { codigo: SALIDA.inesperado, message: "Someone else was setting this account at the same time: look at how it ended up (`supcoflow agents show`) and try again." },
  cuenta_cambio: { codigo: SALIDA.inesperado, message: "The account changed while I was checking it: look at how it ended up (`supcoflow agents show`) and check again." },
  error_interno: { codigo: SALIDA.inesperado, message: "Something failed on the engine's side. Nothing that can be assured changed: look at how the account ended up with `supcoflow agents show`." },
}));

function errorDelMotor(r: Respuesta, agente?: Agente): Resultado {
  const codigoDelMotor = idSeguro(r.cuerpo.error, 64);
  const conocido = codigoDelMotor === null ? undefined : ERRORES.get(codigoDelMotor);
  let error = codigoDelMotor ?? "rechazado";
  let message: string;
  let codigo: Resultado["codigo"];
  if (r.status === 404 && codigoDelMotor === "sin_cuenta") {
    const cual = agente === undefined ? "that agent" : `the ${COMO_SE_LLAMA[agente]}`;
    codigo = SALIDA.haceFaltaUnaPersona;
    message = `There's no AI account for ${cual} yet.${agente === undefined ? "" : ` Add one: \`supcoflow agents set-key --agent ${COMO_SE_ESCRIBE[agente]}\` (you type it yourself; it isn't shown), or in the Agents tab.`}`;
  } else if (conocido !== undefined) {
    ({ codigo, message } = conocido);
  } else if (r.status === 401) {
    codigo = SALIDA.faltaLogin;
    error = "clave_invalida";
    message = "The key is no longer valid: log in again.";
  } else if (r.status === 403) {
    codigo = SALIDA.haceFaltaUnaPersona;
    message = "This key can't do that. Sign in with your own key (`supcoflow login`), and ask a team Owner if it needs one.";
  } else if (r.status === 404) {
    codigo = SALIDA.entradaInvalida;
    message = "The engine doesn't know that project for your team.";
  } else if (r.status >= 500) {
    codigo = SALIDA.inesperado;
    error = "error_interno";
    message = `The engine answered ${r.status}; try again in a few minutes. If you were setting a key, look at how it ended up with \`supcoflow agents show\`.`;
  } else {
    codigo = SALIDA.entradaInvalida;
    message = `The engine rejected the request (${r.status}).`;
  }
  const proveedor = idSeguro(r.cuerpo.codigo, 48);
  const json: Record<string, unknown> = { ok: false, error, message };
  if (proveedor !== null) json.codigo = proveedor;
  return { codigo, json, texto: message };
}

/** Un pedido al motor: lo que lanza (la red, una clave que ya no vale…) sale como resultado, con su frase fija. */
async function alMotor(hacer: () => Promise<Respuesta>, siNoLlega: string): Promise<{ ok: true; r: Respuesta } | { ok: false; resultado: Resultado }> {
  try {
    return { ok: true, r: await hacer() };
  } catch (e) {
    if (e instanceof FalloDeLaTerminal && e.error === "motor_inalcanzable") {
      return { ok: false, resultado: fallo(SALIDA.inesperado, "motor_inalcanzable", siNoLlega === "" ? e.message : `${e.message} ${siNoLlega}`) };
    }
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
}

const ESTADO_EN_TEXTO: ReadonlyMap<string, string> = new Map([
  ["lista", "ready"], ["rechazada", "rejected by the provider"], ["sin_saldo", "out of balance"], ["falta", "missing"], ["desconocido", "in a state I don't know"],
]);
const estadoEnTexto = (e: string) => ESTADO_EN_TEXTO.get(e) ?? "not ready";

// ─── show ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function agentesVer(d: DepsDeAgentes, flags: FlagsDeAgentes): Promise<Resultado> {
  let filtro: Agente | null = null;
  if (flags.agent !== null) {
    const a = elAgente(flags.agent);
    if (!a.ok) return a.resultado;
    filtro = a.agente;
  }
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const pedido = await alMotor(() => d.leerCuentas(d.api, p.clave, p.proyecto.id), "");
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200) return errorDelMotor(r);
  const lista = r.cuerpo.cuentas;
  if (!Array.isArray(lista)) return fallo(SALIDA.inesperado, "respuesta_inesperada", "The engine answered without the list of AI accounts; try again in a while.");

  const agentes: { agente: Agente; estado: string; cuenta_lista: boolean; cuenta: CuentaPublica | null }[] = [];
  for (const x of lista) {
    const o = objeto(x);
    const agente = o === null ? undefined : AGENTE_DEL_FLAG.get(String(o.agente));
    if (o === null || agente === undefined || (filtro !== null && agente !== filtro)) continue;
    const estado = ESTADOS.has(String(o.estado)) ? String(o.estado) : "desconocido";
    agentes.push({ agente, estado, cuenta_lista: o.cuenta_lista === true, cuenta: cuentaPublica(o.cuenta) });
  }
  if (agentes.length === 0 || (filtro !== null && agentes.length !== 1)) {
    return fallo(SALIDA.inesperado, "respuesta_inesperada", "The engine answered without the AI account I asked about; try again in a while.");
  }

  const lineas = agentes.map((a) => {
    const nombre = COMO_SE_LLAMA[a.agente];
    const cuando = a.cuenta?.validada_en ?? null;
    const escribir = COMO_SE_ESCRIBE[a.agente];
    switch (a.estado) {
      case "lista":
        return `  ${nombre}: ready. ${proveedorEnTexto(a.cuenta?.proveedor ?? null)} key ending in ${a.cuenta?.ultimos4 || "(hidden)"}${cuando === null ? "" : `, checked ${cuando}`}.`;
      case "rechazada":
      case "sin_saldo":
        return `  ${nombre}: ${estadoEnTexto(a.estado)}. Fix it at your provider and check it again with \`supcoflow agents check --agent ${escribir}\`, or replace the key with \`supcoflow agents set-key --agent ${escribir}\`.`;
      case "falta":
        return `  ${nombre}: ${estadoEnTexto("falta")}. Add one in the project's Agents tab, or type \`supcoflow agents set-key --agent ${escribir}\` yourself in a terminal (it asks for the key without showing it).`;
      default:
        return `  ${nombre}: ${estadoEnTexto("desconocido")}. Look at it in the project's Agents tab; this version of the terminal may be out of date.`;
    }
  });
  const texto = [
    `AI accounts of ${p.proyecto.repo}:`,
    ...lineas,
    "The keys are write-only: once set they can't be shown or edited, only replaced (`agents set-key`) or removed (`agents remove`).",
  ].join("\n");
  return { codigo: SALIDA.ok, json: { ok: true, proyecto: p.proyecto.id, repo: p.proyecto.repo, agentes }, texto };
}

// ─── set-key ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function agentesPonerClave(d: DepsDeAgentes, flags: FlagsDeAgentes): Promise<Resultado> {
  let laClave: string | null = null;
  const r = await ponerLaClave(d, flags, (c) => { laClave = c; });
  // El barrido de abajo es la última defensa: pase lo que pase adentro, nada de lo que sale lleva la clave que se manejó.
  return laClave === null ? r : sinLaClave(r, laClave);
}

/** Cambia, en todo lo que sale, la clave literal (y su versión «sin los últimos 4», como la enmascaran algunos proveedores) y lo que tiene forma de clave. */
function sinLaClave(r: Resultado, clave: string): Resultado {
  const partes = [clave, clave.length > 8 ? clave.slice(0, -4) : ""].filter((x) => x !== "");
  const limpiar = (s: string): string => taparSecretos(partes.reduce((t, k) => t.split(k).join("[key]"), s));
  const profundo = (v: unknown): unknown => {
    if (typeof v === "string") return limpiar(v);
    if (Array.isArray(v)) return v.map(profundo);
    if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [limpiar(k), profundo(x)]));
    return v;
  };
  return { codigo: r.codigo, texto: limpiar(r.texto), json: profundo(r.json) as Record<string, unknown> };
}

async function ponerLaClave(d: DepsDeAgentes, flags: FlagsDeAgentes, manejada: (clave: string) => void): Promise<Resultado> {
  const a = elAgente(flags.agent);
  if (!a.ok) return a.resultado;
  const agente = a.agente;
  const nombre = COMO_SE_LLAMA[agente];

  const proveedor = (flags.provider ?? "ai_gateway").replace(/-/g, "_");
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(proveedor) || pareceUnaClave(proveedor)) {
    return fallo(SALIDA.entradaInvalida, "proveedor_invalido", "--provider is the provider's id, for example `ai_gateway`.");
  }

  // 1. De dónde saldría la clave, sin pedir nada todavía. Todo lo que se puede rechazar sin la red, se rechaza acá.
  let delEntorno: string | null = null;
  let fuente: string;
  if (flags.fromEnv !== null) {
    if (!nombreDeVariableValido(flags.fromEnv)) {
      // El valor NO se repite: lo más probable es que sea la clave, pegada donde va el nombre de la variable.
      if (pareceUnaClave(flags.fromEnv) || /^[A-Za-z_][A-Za-z0-9_]{23,}$/.test(flags.fromEnv)) {
        return fallo(SALIDA.entradaInvalida, "clave_como_nombre",
          "--from-env takes the NAME of an environment variable (for example AI_GATEWAY_API_KEY), not the key itself, and what you passed looks like a key. "
          + "A key typed in a command is exposed (shell history, process list): treat it as exposed and create a new one. "
          + "Then put the new one in an environment variable and pass its name.");
      }
      return fallo(SALIDA.entradaInvalida, "nombre_de_variable_invalido",
        "--from-env takes the NAME of an environment variable: letters, digits and underscores, for example AI_GATEWAY_API_KEY.");
    }
    const valor = d.env[flags.fromEnv];
    if (valor === undefined || valor.trim() === "") {
      return fallo(SALIDA.entradaInvalida, "variable_vacia", `The environment variable ${flags.fromEnv} isn't set or is empty. Set it in your shell and run this again.`);
    }
    delEntorno = valor;
    fuente = `the environment variable ${flags.fromEnv}`;
  } else {
    if (!d.esTty) {
      return fallo(SALIDA.haceFaltaUnaPersona, "sin_terminal",
        `I can't ask for the key here: there's no interactive terminal, and the key never goes as an argument or in the chat. `
        + `Type it yourself in a terminal: \`supcoflow agents set-key --agent ${COMO_SE_ESCRIBE[agente]}\` (it asks for the key without showing it). `
        + "Or put it in an environment variable and use `--from-env NAME`. Or set it in the project's Agents tab.");
    }
    fuente = "a hidden prompt";
  }
  let limpia: string | null = null;
  if (delEntorno !== null) {
    const n = normalizarClave(delEntorno);
    if (!n.ok) return laClaveNoSirve(n.motivo, `the environment variable ${flags.fromEnv}`);
    limpia = n.clave;
    manejada(limpia);
  }

  // 2. El proyecto, ANTES de preguntar: no se le pide la clave a quien no la va a poder usar.
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, `/cuentas-de-ia/${agente}`);
  if (flags.dryRun) return dryRun(`PUT ${ruta} {clave: <hidden>, proveedor: ${proveedor}}, with the key from ${fuente} (nothing is asked or sent)`);

  // 3. La clave, sin eco. Si no se puede ocultar lo que se escribe, no se pregunta: nunca se cae a pedirla con eco.
  if (limpia === null) {
    let leida: string | null;
    try {
      leida = await d.leerClaveOculta(`Paste the AI key for the ${nombre} (it won't be shown as you type): `);
    } catch {
      return fallo(SALIDA.haceFaltaUnaPersona, "sin_eco",
        "I can't hide what you type in this terminal, so I won't ask for the key. Put it in an environment variable and use `--from-env NAME`, or set it in the project's Agents tab.");
    }
    if (leida === null) return fallo(SALIDA.entradaInvalida, "cancelado", "Cancelled: nothing was changed.");
    const n = normalizarClave(leida);
    if (!n.ok) return laClaveNoSirve(n.motivo, "what you typed");
    limpia = n.clave;
    manejada(limpia);
  }

  // 4. Un pedido. Si no se sabe cómo terminó, se dice cómo mirar.
  const claveFinal: string = limpia;
  const pedido = await alMotor(
    () => d.ponerCuenta(d.api, p.clave, p.proyecto.id, agente, { clave: claveFinal, proveedor }),
    "I don't know whether the key was saved: look with `supcoflow agents show` before trying again.",
  );
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200) return errorDelMotor(r, agente);

  const cuenta = cuentaPublica(r.cuerpo.cuenta);
  if (cuenta === null) {
    return fallo(SALIDA.inesperado, "respuesta_inesperada", "The engine answered without the account. Look at how it ended up with `supcoflow agents show`.");
  }
  const reemplazo = r.cuerpo.reemplazo === true;
  const saldo = numero(r.cuerpo.saldo_usd);
  const avisos = avisosSeguros(r.cuerpo.avisos);
  const datos = { agente, cuenta, reemplazo, saldo_usd: saldo, avisos };
  const que = `${reemplazo ? "Replaced" : "Set"} the ${proveedorEnTexto(cuenta.proveedor)} key of the ${nombre} (ends in ${cuenta.ultimos4 || "(hidden)"})`;
  const avisosEnTexto = avisos.map(textoDelAviso);

  // Una clave que el proveedor acepta pero cuya cuenta no tiene saldo se guarda; no es «lista».
  if (cuenta.estado !== "lista") {
    const error = cuenta.estado === "sin_saldo" ? "cuenta_sin_saldo" : "cuenta_no_lista";
    const motivo = cuenta.estado === "sin_saldo" ? "the account is out of balance (or the key reached its cap)" : `the account is ${estadoEnTexto(cuenta.estado)}`;
    const message = `${que}, and it was saved, but ${motivo}. Add balance or raise the cap at your provider and then run \`supcoflow agents check --agent ${COMO_SE_ESCRIBE[agente]}\`.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error, message, guardada: true, ...datos }, texto: [message, ...avisosEnTexto].join("\n") };
  }
  const siguiente = agente === "chat"
    ? "Next: choose the chat's model with `supcoflow agents configure --agent chat --option standard --data-retention allow`, or in the Agents tab."
    : "Next: approve the triage agent's model in the project's Agents tab.";
  const texto = [
    `${que}. It works${saldo === null ? "" : `; the account balance is US$ ${saldo.toFixed(2)}`}. The key is stored encrypted and can't be shown again.`,
    ...avisosEnTexto,
    siguiente,
  ].join("\n");
  return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto };
}

function laClaveNoSirve(motivo: "vacia" | "espacios" | "larga", de: string): Resultado {
  if (motivo === "vacia") return fallo(SALIDA.entradaInvalida, "clave_vacia", `There's no key in ${de}.`);
  const por = motivo === "larga" ? "is too long to be a key" : "has spaces, line breaks or other characters that aren't part of a key (did you paste two things?)";
  return fallo(SALIDA.entradaInvalida, "clave_con_forma_invalida", `What's in ${de} ${por}. Copy only the key.`);
}

// ─── check ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function agentesValidar(d: DepsDeAgentes, flags: FlagsDeAgentes): Promise<Resultado> {
  const a = elAgente(flags.agent);
  if (!a.ok) return a.resultado;
  const agente = a.agente;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const pedido = await alMotor(() => d.validarCuenta(d.api, p.clave, p.proyecto.id, agente), "");
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200) return errorDelMotor(r, agente);
  const cuenta = cuentaPublica(r.cuerpo.cuenta);
  if (cuenta === null) return fallo(SALIDA.inesperado, "respuesta_inesperada", "The engine answered without the account; look at it with `supcoflow agents show`.");
  const avisos = avisosSeguros(r.cuerpo.avisos);
  const datos = { agente, cuenta, cambio_de_estado: r.cuerpo.cambio_de_estado === true, saldo_usd: numero(r.cuerpo.saldo_usd), avisos };
  const nombre = COMO_SE_LLAMA[agente];
  const avisosEnTexto = avisos.map(textoDelAviso);
  if (cuenta.estado === "lista") {
    const saldo = datos.saldo_usd === null ? "" : ` The account balance is US$ ${datos.saldo_usd.toFixed(2)}.`;
    return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: [`The AI account of the ${nombre} is ready: the provider accepts the key.${saldo}`, ...avisosEnTexto].join("\n") };
  }
  const arreglo = `Fix it at your provider and check again, or replace the key: \`supcoflow agents set-key --agent ${COMO_SE_ESCRIBE[agente]}\`.`;
  const rechazada = cuenta.estado === "rechazada";
  const error = rechazada ? "cuenta_rechazada" : cuenta.estado === "sin_saldo" ? "cuenta_sin_saldo" : "cuenta_no_lista";
  const que = rechazada ? "the provider rejects the key" : cuenta.estado === "sin_saldo" ? "the account is out of balance (or the key reached its cap)" : "the account is not ready";
  const message = `The AI account of the ${nombre} is not ready: ${que}. ${arreglo}`;
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error, message, ...datos }, texto: [message, ...avisosEnTexto].join("\n") };
}

// ─── remove ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function agentesQuitar(d: DepsDeAgentes, flags: FlagsDeAgentes): Promise<Resultado> {
  const a = elAgente(flags.agent);
  if (!a.ok) return a.resultado;
  const agente = a.agente;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) return dryRun(`DELETE ${rutaDe(p.proyecto, `/cuentas-de-ia/${agente}`)}`);
  const pedido = await alMotor(() => d.quitarCuenta(d.api, p.clave, p.proyecto.id, agente), "Look with `supcoflow agents show` before trying again.");
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  const nombre = COMO_SE_LLAMA[agente];
  // Quitar lo que no hay deja lo mismo que quitarlo: para quien lo pide, ya está hecho.
  if (r.status === 404 && r.cuerpo.error === "sin_cuenta") {
    return { codigo: SALIDA.ok, json: { ok: true, agente, sin_cuenta: true }, texto: `The ${nombre} had no AI account to remove.` };
  }
  if (r.status !== 200) return errorDelMotor(r, agente);
  return {
    codigo: SALIDA.ok,
    json: { ok: true, agente, cuenta: cuentaPublica(r.cuerpo.cuenta) },
    texto: `Removed the AI account of the ${nombre}: the key is deleted from Supcoflow. Add another with \`supcoflow agents set-key --agent ${COMO_SE_ESCRIBE[agente]}\` or in the Agents tab.`,
  };
}

// ─── configure ──────────────────────────────────────────────────────────────────────────────────────────────────

// Los ids de las opciones del menú del chat son los del motor; los nombres en inglés se aceptan también.
const OPCION_DEL_MENU: ReadonlyMap<string, string> = new Map([["agil", "agil"], ["agile", "agil"], ["estandar", "estandar"], ["standard", "estandar"], ["plus", "plus"]]);
const LOS_NOMBRES_DE_LAS_OPCIONES = "`agile`, `standard` or `plus`";

export async function agentesConfigurar(d: DepsDeAgentes, flags: FlagsDeAgentes): Promise<Resultado> {
  const a = elAgente(flags.agent);
  if (!a.ok) return a.resultado;
  if (a.agente !== "chat") {
    // Las rutas que aprueban el modelo del triage agent sólo aceptan una sesión de la consola (no una clave): no hay por dónde.
    return fallo(SALIDA.haceFaltaUnaPersona, "no_desde_la_terminal",
      "The triage agent's model is approved in the project's Agents tab: the engine doesn't take it from the terminal yet. The AI account (`agents set-key`) can be set from here.");
  }
  if (flags.option === null) return fallo(SALIDA.entradaInvalida, "falta_opcion", `Say the chat's menu option: \`--option\` ${LOS_NOMBRES_DE_LAS_OPCIONES}.`);
  const opcion = OPCION_DEL_MENU.get(flags.option.toLowerCase());
  if (opcion === undefined) return fallo(SALIDA.entradaInvalida, "opcion_invalida", `--option is ${LOS_NOMBRES_DE_LAS_OPCIONES}.`);
  if (flags.dataRetention === null) {
    // Sin una lectura de lo configurado, no se puede completar lo que falta: se dice, en vez de adivinar y cambiarlo sin querer.
    return fallo(SALIDA.entradaInvalida, "falta_retencion",
      "Say whether the provider may keep your data: `--data-retention allow` (any provider) or `--data-retention deny` (only providers that don't keep data).");
  }
  if (flags.dataRetention !== "allow" && flags.dataRetention !== "deny") {
    return fallo(SALIDA.entradaInvalida, "retencion_invalida", "--data-retention is `allow` or `deny`.");
  }
  const sinGuardado = flags.dataRetention === "deny";
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/agentes/chat");
  if (flags.dryRun) return dryRun(`PUT ${ruta} {opcion: ${opcion}, sin_guardado_de_datos: ${sinGuardado}}`);
  const pedido = await alMotor(() => d.configurarChat(d.api, p.clave, p.proyecto.id, { opcion, sin_guardado_de_datos: sinGuardado }), "");
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200) return errorDelMotor(r, "chat");
  if (r.cuerpo.sin_cambios === true) {
    const version = numero(r.cuerpo.version);
    return { codigo: SALIDA.ok, json: { ok: true, agente: "chat", sin_cambios: true, version }, texto: `The chat's configuration is already like that${version === null ? "" : ` (version ${version})`}: nothing changed.` };
  }
  const perfil = objeto(r.cuerpo.perfil);
  const version = numero(perfil?.version);
  if (perfil === null || version === null) return fallo(SALIDA.inesperado, "respuesta_inesperada", "The engine answered without the saved configuration; look at it in the Agents tab.");
  const modelo = typeof perfil.modelo_id === "string" && /^[a-z0-9][a-z0-9._/-]{0,99}$/.test(perfil.modelo_id) && !pareceUnaClave(perfil.modelo_id) ? perfil.modelo_id : null;
  const esfuerzo = idSeguro(perfil.esfuerzo, 24);
  const guardado = {
    version, opcion: idSeguro(perfil.opcion, 16) ?? opcion, modelo_id: modelo, esfuerzo, sin_guardado_de_datos: perfil.sin_guardado_de_datos === true,
  };
  return {
    codigo: SALIDA.ok,
    json: { ok: true, agente: "chat", perfil: guardado },
    texto: `Saved the chat's configuration (version ${version}): option ${guardado.opcion}${modelo === null ? "" : `, model ${modelo}`}; only providers that don't keep data: ${guardado.sin_guardado_de_datos ? "yes" : "no"}.`,
  };
}
