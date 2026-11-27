// `supcoflow gate status | read | pass | deliver | fail` — lo que hace un AGENTE con su clave (`scf_ag_…`) en la puerta de los agentes (etapa 2c de la reestructura,
// contrato de la puerta v1). El nombre `gate` no choca con `agents` (la cuenta de IA del cliente) ni con `reports` (la bandeja de una persona).
//
// ─── Una regla manda sobre todo lo demás: la clave del agente no se ve nunca ─────────────────────────────────────────────────────────────────────────────
//
// Entra por TRES caminos y sólo tres: la variable de entorno que `--from-env NOMBRE` nombra, `SUPCOFLOW_AGENT_KEY`, o escrita sin eco en una terminal (y no con `--json`:
// ningún comando pregunta con `--json`, salvo `agents set-key`). Nunca como
// argumento (no hay flag que la reciba: queda en el historial del shell y en la lista de procesos) ni por stdin. No se guarda en ningún lado (ni el llavero, ni un
// archivo de credenciales, ni un registro) y no es la clave de `login`: son dos credenciales distintas, y la terminal no prueba una con la otra. Viaja sólo en la
// cabecera `Authorization` de UN pedido, y al final todo lo que sale del comando se barre: la clave literal y todo lo que tenga su forma se tapa.
//
// Un 401 (la clave no vale) y un 403 (esta clave no puede esto) se dicen claro, con una frase fija de esta terminal, y NO se reintenta con otra credencial. El
// proyecto sale de la clave (D18): ningún comando de acá lleva `--repo` ni lee el repo.
//
// ─── El pase es lo único que se imprime a propósito ──────────────────────────────────────────────────────────────────────────────────────────────────────
//
// `gate pass` devuelve el pase (cinco minutos, un reporte, sólo leer) porque para eso se pide: quien lo corre lo manda en `Authorization` al almacén del cliente.
// Su forma se comprueba antes de mostrarlo, nunca sale en un error, y no se guarda.
import { createHash } from "node:crypto";
import type { Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { nombreDeVariableValido, normalizarClave, pareceUnaClave } from "../clave-sin-eco.ts";
import { SALIDA, type Resultado } from "../contrato.ts";
import { cadena, limpio } from "../limpio.ts";
import { dryRun, fallo } from "./configurar.ts";
import { alMotor, errorDelMotor, fechaSegura, huellaSegura, idDelMotor, idSeguro, numeroEntero, objeto, type Traducciones } from "./del-motor.ts";
import { ID_DE_REPORTE } from "./reportes.ts";

export type DepsDePuerta = {
  api: URL;
  /** El entorno del proceso: de acá sale la clave del agente. */
  env: Record<string, string | undefined>;
  /** ¿Hay una terminal interactiva donde preguntar la clave sin eco? */
  esTty: boolean;
  /** Pregunta la clave SIN ECO. `null` si la persona canceló; lanza si no puede ocultar lo que se escribe (entonces NO se pregunta). */
  leerClaveOculta(pregunta: string): Promise<string | null>;
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  estado(api: URL, clave: string): Promise<Respuesta>;
  leer(api: URL, clave: string, reporteId: string): Promise<Respuesta>;
  pase(api: URL, clave: string, reporteId: string): Promise<Respuesta>;
  entregar(api: URL, clave: string, reporteId: string, entregaId: string, cuerpo: string): Promise<Respuesta>;
  avisarFallo(api: URL, clave: string, reporteId: string, entregaId: string, cuerpo: string): Promise<Respuesta>;
  avisar: (s: string) => void;
};

type FlagsDePuerta = Pick<Flags, "dryRun" | "full" | "id" | "file" | "fromEnv" | "json">;

/** La variable que se mira cuando no se nombra otra. */
export const VARIABLE_DE_LA_CLAVE = "SUPCOFLOW_AGENT_KEY";
/** El motor corta el cuerpo en 256 KB (`MAX_CUERPO_BYTES`): más que eso no se manda. */
const TOPE_DEL_CUERPO = 256 * 1024;

// ─── La clave del agente ───────────────────────────────────────────────────────────────────────────────────────

async function laClave(d: DepsDePuerta, { fromEnv, json }: Pick<FlagsDePuerta, "fromEnv" | "json">): Promise<{ ok: true; clave: string } | { ok: false; resultado: Resultado }> {
  let crudo: string;
  let de: string;
  if (fromEnv !== null) {
    if (!nombreDeVariableValido(fromEnv)) {
      // El valor NO se repite: lo más probable es que sea la clave, pegada donde va el NOMBRE de la variable.
      if (pareceUnaClave(fromEnv) || /^[A-Za-z_][A-Za-z0-9_]{23,}$/.test(fromEnv)) {
        return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "clave_como_nombre",
          "--from-env takes the NAME of an environment variable (for example SUPCOFLOW_AGENT_KEY), not the key itself, and what you passed looks like a key. "
          + "A key typed in a command is exposed (shell history, process list): treat it as exposed and revoke it in the console. Then put the new one in an environment variable and pass its name.") };
      }
      return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "nombre_de_variable_invalido", "--from-env takes the NAME of an environment variable: letters, digits and underscores, for example SUPCOFLOW_AGENT_KEY.") };
    }
    const valor = d.env[fromEnv];
    if (valor === undefined || valor.trim() === "") {
      return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "variable_vacia", `The environment variable ${fromEnv} isn't set or is empty. Load it without typing the key in a command: \`read -rs ${fromEnv} && export ${fromEnv}\`, then run this again.`) };
    }
    crudo = valor;
    de = `the environment variable ${fromEnv}`;
  } else if ((d.env[VARIABLE_DE_LA_CLAVE] ?? "").trim() !== "") {
    crudo = d.env[VARIABLE_DE_LA_CLAVE]!;
    de = `the environment variable ${VARIABLE_DE_LA_CLAVE}`;
  } else if (d.esTty && !json) {
    // Con `--json` no se pregunta nada, aunque haya terminal (la regla de todos los comandos; la única excepción es `agents set-key`).
    let leida: string | null;
    try {
      leida = await d.leerClaveOculta("Paste the agent's key (it won't be shown as you type): ");
    } catch {
      return { ok: false, resultado: fallo(SALIDA.haceFaltaUnaPersona, "sin_eco",
        `I can't hide what you type in this terminal, so I won't ask for the key. Put it in the environment variable ${VARIABLE_DE_LA_CLAVE} (or another one, and pass its name with --from-env).`) };
    }
    if (leida === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "cancelado", "Cancelled: nothing was sent.") };
    crudo = leida;
    de = "what you typed";
  } else {
    return { ok: false, resultado: fallo(SALIDA.faltaLogin, "sin_clave_de_agente",
      `There's no agent key here. Put it in the environment variable ${VARIABLE_DE_LA_CLAVE} (or in another one and pass its name with \`--from-env NAME\`): it never goes as an argument, and it isn't the key \`supcoflow login\` leaves. The agent's key is created in the console.`) };
  }
  const n = normalizarClave(crudo);
  if (!n.ok) {
    const por = n.motivo === "vacia" ? "is empty" : n.motivo === "larga" ? "is too long to be a key" : n.motivo === "corta" ? "is too short to be a key" : "has spaces, line breaks or other characters that aren't part of a key (did you paste two things?)";
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, n.motivo === "vacia" ? "clave_vacia" : "clave_con_forma_invalida", `What's in ${de} ${por}. Copy only the key.`) };
  }
  if (!n.clave.startsWith("scf_ag_")) {
    // La clave de una persona (`scf_…` sin `ag`) y cualquier otra cosa se rechazan sin repetirse y sin mandarse a ningún lado.
    return { ok: false, resultado: n.clave.startsWith("scf_")
      ? fallo(SALIDA.entradaInvalida, "es_una_clave_de_persona", `What's in ${de} is a person's key (the kind \`supcoflow login\` leaves), and the gate takes only an agent's key (it starts with scf_ag_). Nothing was sent.`)
      : fallo(SALIDA.entradaInvalida, "no_es_una_clave_de_agente", `What's in ${de} doesn't look like an agent's key (it starts with scf_ag_). Nothing was sent.`) };
  }
  return { ok: true, clave: n.clave };
}

/** Cambia, en todo lo que sale, la clave literal y todo lo que tenga la forma de una clave de agente. NO toca el pase: es lo que `gate pass` vino a entregar. */
export function sinLaClaveDeAgente(r: Resultado, clave: string): Resultado {
  const limpiar = (s: string): string => s.split(clave).join("[key]").replace(/\bscf_ag_(?:[A-Za-z0-9_-]|\.(?=[A-Za-z0-9_-])){4,}/g, "scf_ag_…");
  const profundo = (v: unknown): unknown => {
    if (typeof v === "string") return limpiar(v);
    if (Array.isArray(v)) return v.map(profundo);
    if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [limpiar(k), profundo(x)]));
    return v;
  };
  return { codigo: r.codigo, texto: limpiar(r.texto), json: profundo(r.json) as Record<string, unknown> };
}

/** Lo común: validar lo que no necesita red, sacar la clave, correr y barrer lo que sale. */
async function conLaClave(d: DepsDePuerta, flags: Pick<FlagsDePuerta, "fromEnv" | "json">, hacer: (clave: string) => Promise<Resultado>): Promise<Resultado> {
  const c = await laClave(d, flags);
  if (!c.ok) return c.resultado;
  return sinLaClaveDeAgente(await hacer(c.clave), c.clave);
}

// ─── Los errores de la puerta, con frases fijas ────────────────────────────────────────────────────────────────

const TABLA: Traducciones = new Map(Object.entries({
  solo_agentes: { codigo: SALIDA.haceFaltaUnaPersona, message: "That is a person's key, and the gate takes only an agent's key (scf_ag_…), which is created in the console. This command doesn't try another key." },
  clave_de_agente: { codigo: SALIDA.haceFaltaUnaPersona, message: "The engine says an agent's key doesn't go there." },
  tipo_de_clave: { codigo: SALIDA.haceFaltaUnaPersona, message: "This agent's key is of another type: a chat key creates reports and verifies passes; an investigation key reads its reports, asks for the pass and delivers. This command doesn't try another key." },
  clave_revocada: { codigo: SALIDA.faltaLogin, message: "This agent's key was revoked (or the person who connected the agent was deactivated). Get a new key in the console: this command doesn't try another one." },
  reporte_inexistente: { codigo: SALIDA.entradaInvalida, message: "The engine doesn't know that report for this agent's project: check the id." },
  agente_inexistente: { codigo: SALIDA.inesperado, message: "The engine no longer finds this agent: it may have been removed while I asked. Try again." },
  no_asignado: { codigo: SALIDA.haceFaltaUnaPersona, message: "This report isn't assigned to this agent (another investigator has it, or nobody). Only the assigned investigator reads it, asks for the pass and delivers." },
  reporte_ya_tiene_entrega: { codigo: SALIDA.haceFaltaUnaPersona, message: "This report already has a delivery in this investigation, and there is only one (a result or a failure). Look at it with `supcoflow gate read`." },
  entrega_con_otro_contenido: { codigo: SALIDA.entradaInvalida, message: "That delivery id was already used with other content. Repeat the same file with the same id, or deliver nothing else: an investigation has a single delivery." },
  idempotency_key_invalida: { codigo: SALIDA.entradaInvalida, message: "The delivery id isn't valid: it has the form ent_… (letters, digits, `_` and `-`)." },
  cuerpo_invalido: { codigo: SALIDA.entradaInvalida, message: "The engine says the body isn't a JSON object." },
  identidad_incompleta: { codigo: SALIDA.entradaInvalida, message: "`agente.nombre` and `agente.version` are required: the delivery says who the agent is." },
  resultado_invalido: { codigo: SALIDA.entradaInvalida, message: "The result doesn't follow the contract. The problems below are `field:code`; nothing was published." },
  fallo_invalido: { codigo: SALIDA.entradaInvalida, message: "The failure notice doesn't follow the contract. The problems below are `field:code`." },
  motivo_desconocido: { codigo: SALIDA.entradaInvalida, message: "That `motivo` isn't in the closed list." },
  campo_no_permitido: { codigo: SALIDA.entradaInvalida, message: "The body has fields the contract doesn't have (the failure notice takes no free text). Nothing was recorded." },
  contenido_vencido: { codigo: SALIDA.haceFaltaUnaPersona, message: "The client's store no longer keeps this report's content, so there is no pass to give." },
  almacen_no_disponible: { codigo: SALIDA.haceFaltaUnaPersona, message: "This report has no store where its content can be read right now (the chat agent that created it has no active store address). A person fixes it in the console." },
  sin_direccion_propia: { codigo: SALIDA.inesperado, message: "The engine doesn't know its own address, so it can't say where to read the content. Try again later." },
  publicacion_no_disponible: { codigo: SALIDA.inesperado, message: "The engine couldn't start the publication. Repeat the same command (same delivery id): it is safe." },
  despachos_en_pausa: { codigo: SALIDA.inesperado, message: "The engine is paused for a moment (a deploy). Try again in a few minutes." },
}));

const idDelReporte = (flags: Pick<FlagsDePuerta, "id">): { ok: true; id: string } | { ok: false; resultado: Resultado } => {
  if (flags.id === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_id", "Say which report: `--id rpt_…`.") };
  // El valor no se repite: alguien pudo pegar ahí otra cosa.
  if (!ID_DE_REPORTE.test(flags.id)) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "id_invalido", "--id is the report's id, and it starts with rpt_.") };
  return { ok: true, id: flags.id };
};

const inesperada = (donde: string): Resultado =>
  fallo(SALIDA.inesperado, "respuesta_inesperada", `The engine answered ${donde} without what I expected; try again in a while.`);
const urlSegura = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s\u0000-\u001f\u007f-\u009f]{1,300}$/.test(v) ? v : null);

// ─── status ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function puertaEstado(d: DepsDePuerta, flags: Pick<FlagsDePuerta, "fromEnv" | "json">): Promise<Resultado> {
  return conLaClave(d, flags, async (clave) => {
    const pedido = await alMotor(() => d.estado(d.api, clave));
    if (!pedido.ok) return pedido.resultado;
    const r = pedido.r;
    if (r.status !== 200) return errorDelMotor(r, TABLA, "agente");
    const c = r.cuerpo;
    const agenteId = idDelMotor(c.agente_id);
    const proyectoId = idDelMotor(c.proyecto_id);
    const tipo = idSeguro(c.tipo, 24);
    const conectado = objeto(c.conectado_por);
    if (agenteId === null || proyectoId === null || tipo === null || typeof c.activo !== "boolean" || conectado === null) return inesperada("the agent's state");
    const aviso = objeto(c.ultimo_aviso);
    const tope = objeto(c.tope);
    const estado = {
      agente_id: agenteId, nombre: cadena(c.nombre), tipo, proyecto_id: proyectoId, activo: c.activo, es_el_investigador_activo: c.es_el_investigador_activo === true,
      conectado_por: { persona_id: idDelMotor(conectado.persona_id), nombre_visible: cadena(conectado.nombre_visible) },
      ultimo_aviso: aviso === null ? null : {
        webhook_id: idDelMotor(aviso.webhook_id), en: fechaSegura(aviso.en), intentos: numeroEntero(aviso.intentos), respuesta: numeroEntero(aviso.respuesta),
      },
      asignados_sin_entregar: numeroEntero(c.asignados_sin_entregar),
      tope: tope === null ? null : { avisos_por_hora: numeroEntero(tope.avisos_por_hora), usados_esta_hora: numeroEntero(tope.usados_esta_hora) },
    };
    const quien = estado.conectado_por.nombre_visible === "Alguien del equipo" ? "someone from the team" : estado.conectado_por.nombre_visible;
    const investiga = tipo === "investigacion";
    const lineas = [
      `This key is the ${investiga ? "investigation" : tipo === "chat" ? "chat" : tipo} agent «${estado.nombre}» (${agenteId}) of project ${proyectoId}, connected by ${quien === "" ? "someone" : quien}.`,
      `  Active: ${estado.activo ? "yes" : "no"}${investiga ? `; the project's active investigator: ${estado.es_el_investigador_activo ? "yes" : "no"}` : ""}.`,
    ];
    if (investiga) {
      const a = estado.ultimo_aviso;
      lineas.push(a === null
        ? "  Last notice: none yet."
        : `  Last notice: ${a.en ?? "(unknown time)"}, ${a.intentos ?? "?"} attempt(s), ${a.respuesta === null ? "no answer" : `answered ${a.respuesta}`}.`);
      lineas.push(`  Reports assigned to you and not delivered: ${estado.asignados_sin_entregar ?? "unknown"} (a failure notice counts as delivered).`);
      if (estado.tope !== null) lineas.push(`  Notices this hour: ${estado.tope.usados_esta_hora ?? "?"} of ${estado.tope.avisos_por_hora ?? "?"} (informative: nothing enforces the limit yet).`);
    } else {
      lineas.push("  A chat agent gets no notices and no assigned reports: those fields are null (not applicable).");
    }
    return { codigo: SALIDA.ok, json: { ok: true, ...estado }, texto: lineas.join("\n") };
  });
}

// ─── read ───────────────────────────────────────────────────────────────────────────────────────────────────────

const PUBLICACION_EN_TEXTO: ReadonlyMap<string, string> = new Map([
  ["publicando", "being published: look again in a moment"],
  ["publicado", "published"],
  ["publicacion_incierta", "uncertain (the engine isn't sure the issue went out; it checks by itself and never publishes twice)"],
  ["esperando_reenvio", "waiting for you to send the same result again"],
  ["necesita_persona", "a person has to look at it in the console"],
]);

export async function puertaLeer(d: DepsDePuerta, flags: FlagsDePuerta): Promise<Resultado> {
  const i = idDelReporte(flags);
  if (!i.ok) return i.resultado;
  return conLaClave(d, flags, async (clave) => {
    const pedido = await alMotor(() => d.leer(d.api, clave, i.id));
    if (!pedido.ok) return pedido.resultado;
    const r = pedido.r;
    if (r.status !== 200) return errorDelMotor(r, TABLA, "agente");
    const c = r.cuerpo;
    if (idDelMotor(c.reporte_id) !== i.id) return inesperada("another report");
    const inv = objeto(c.investigador);
    const pub = objeto(c.publicacion);
    const entrega = objeto(c.entrega);
    const issue = pub === null ? null : objeto(pub.issue);
    const publicacion = pub === null ? null : {
      estado: idSeguro(pub.estado, 40), entrega: idDelMotor(pub.entrega), huella: huellaSegura(pub.huella),
      issue: issue === null ? null : { numero: numeroEntero(issue.numero), url: urlSegura(issue.url) },
      desde: fechaSegura(pub.desde), proximo_paso: idSeguro(pub.proximo_paso, 24), buscar_desde: fechaSegura(pub.buscar_desde),
      reenvios_que_quedan: numeroEntero(pub.reenvios_que_quedan), necesita_persona: pub.necesita_persona === true ? true : undefined,
    };
    const costo = objeto(c.costo);
    const declarado = objeto(c.agente_declarado);
    const base = {
      ok: true, reporte_id: i.id, proyecto_id: idDelMotor(c.proyecto_id), creado_en: fechaSegura(c.creado_en), canal: idSeguro(c.canal, 24),
      investigador: { tipo: idSeguro(inv?.tipo, 24), agente_id: idDelMotor(inv?.agente_id) },
      estado: idSeguro(c.estado, 48), te_necesitan: typeof c.te_necesitan === "boolean" ? c.te_necesitan : undefined,
      decision: idSeguro(c.decision, 24), intencion: idSeguro(c.intencion, 32), necesita_persona: typeof c.necesita_persona === "boolean" ? c.necesita_persona : undefined,
      entrega: entrega === null ? undefined : { tipo: idSeguro(entrega.tipo, 16), entrega: idDelMotor(entrega.entrega), huella: huellaSegura(entrega.huella), motivo: idSeguro(entrega.motivo, 40) },
      publicacion: pub === null ? (c.publicacion === null ? null : undefined) : publicacion,
    };
    const detalle = !flags.full ? {} : {
      agente_declarado: declarado === null ? undefined : Object.fromEntries(["nombre", "version", "modelo", "cli", "prompt_version"].map((k) => [k, typeof declarado[k] === "string" ? cadena(declarado[k]) : null])),
      costo: costo === null ? undefined : (costo.desconocido === true ? { desconocido: true } : {
        declarado_por_el_agente: true, tokens_entrada: numeroEntero(costo.tokens_entrada), tokens_salida: numeroEntero(costo.tokens_salida), usd: typeof costo.usd === "number" && Number.isFinite(costo.usd) ? costo.usd : null,
      }),
      acciones: Array.isArray(c.acciones) ? c.acciones.filter((x): x is string => typeof x === "string").map(limpio).slice(0, 10) : undefined,
    };
    const conRuta = `supcoflow gate pass --id ${i.id}`;
    let cuerpo: string[];
    if (entrega !== null && base.entrega?.tipo === "fallo") {
      cuerpo = [`  You reported a failure (${base.entrega.motivo ?? "unknown reason"}), delivery ${base.entrega.entrega ?? "unknown"}. It is the only delivery of this investigation: the report is with a person now.`];
    } else if (publicacion !== null) {
      const e = publicacion.estado;
      cuerpo = [
        `  You delivered ${publicacion.entrega ?? "a result"}: decision ${base.decision ?? "unknown"}, intention ${base.intencion ?? "unknown"}${base.necesita_persona === true ? ", needs a person" : ""}.`,
        `  Publication: ${e === null ? "unknown" : (PUBLICACION_EN_TEXTO.get(e) ?? e)}.`,
        ...(publicacion.issue !== null ? [`  Issue: #${publicacion.issue.numero ?? "?"}${publicacion.issue.url === null ? "" : ` ${publicacion.issue.url}`}`] : []),
        ...(e === "esperando_reenvio" ? [`  Send exactly the same file again with \`supcoflow gate deliver --id ${i.id} --file <the same file>\`${publicacion.reenvios_que_quedan === null ? "" : ` (${publicacion.reenvios_que_quedan} resend(s) left)`}.`] : []),
        ...(e === "publicacion_incierta" ? [`  ${publicacion.proximo_paso === "esperar" ? `The engine waits until ${publicacion.buscar_desde ?? "later"} before looking for the issue` : "The engine is looking for the issue by itself"}: nothing to do, and never deliver again.`] : []),
      ];
    } else {
      cuerpo = [
        `  State: ${base.estado === "tu_agente_no_contesto" ? "your agent didn't answer in 2 hours (you can still deliver)" : "waiting for your result"}.`,
        `  Next: \`${conRuta}\` for the pass, read the content in the client's store with it, and then \`supcoflow gate deliver --id ${i.id} --file result.json\` (or \`gate fail\` if you can't).`,
      ];
    }
    const texto = [`Report ${i.id} (${base.canal ?? "unknown"} channel), assigned to ${base.investigador.agente_id ?? "an agent"}:`, ...cuerpo].join("\n");
    return { codigo: SALIDA.ok, json: { ...base, ...detalle }, texto };
  });
}

// ─── pass ───────────────────────────────────────────────────────────────────────────────────────────────────────

const FORMA_DEL_PASE = /^pse_[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_.-]{3,200}$/;
const urlDelAlmacen = (v: unknown): string | null => {
  if (typeof v !== "string" || /[\s\u0000-\u001f\u007f-\u009f]/.test(v) || v.length > 500) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? v : null;
  } catch {
    return null;
  }
};

export async function puertaPase(d: DepsDePuerta, flags: FlagsDePuerta): Promise<Resultado> {
  const i = idDelReporte(flags);
  if (!i.ok) return i.resultado;
  if (flags.dryRun) return dryRun(`POST /api/v1/reportes/${encodeURIComponent(i.id)}/pase with the agent's key (nothing is asked or sent)`);
  return conLaClave(d, flags, async (clave) => {
    const pedido = await alMotor(() => d.pase(d.api, clave, i.id));
    if (!pedido.ok) return pedido.resultado;
    const r = pedido.r;
    if (r.status !== 201 && r.status !== 200) return errorDelMotor(r, TABLA, "agente");
    const c = r.cuerpo;
    const contenido = objeto(c.contenido);
    const url = urlDelAlmacen(contenido?.url);
    const ref = typeof contenido?.ref === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(contenido.ref) ? contenido.ref : null;
    const pase = typeof c.pase === "string" && FORMA_DEL_PASE.test(c.pase) ? c.pase : null;
    const acuerdo = objeto(c.acuerdo);
    const para = objeto(c.para);
    // El acuerdo viaja entero: el agente lo aplica antes de pasarle nada al modelo, y una clave que esta terminal no conozca igual tiene que llegarle.
    const acuerdoSeguro: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(acuerdo ?? {})) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue;
      if (typeof v === "boolean") acuerdoSeguro[k] = v;
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) acuerdoSeguro[k] = v.slice(0, 50).map((x) => limpio(x as string).slice(0, 64));
    }
    if (pase === null || url === null || ref === null || acuerdo === null || idDelMotor(c.reporte_id) !== i.id || fechaSegura(c.vence_en) === null) return inesperada("the pass");
    const venceEn = fechaSegura(c.vence_en)!;
    const json = {
      ok: true, pase, audiencia: idDelMotor(c.audiencia) ?? idSeguro(c.audiencia, 24), contenido: { url, ref }, proyecto_id: idDelMotor(c.proyecto_id), reporte_id: i.id,
      para: { tipo: idSeguro(para?.tipo, 16), id: idDelMotor(para?.id) },
      permisos: Array.isArray(c.permisos) ? c.permisos.map((x) => idSeguro(x, 16)).filter((x): x is string => x !== null) : [], vence_en: venceEn, acuerdo: acuerdoSeguro,
    };
    const acuerdoEnTexto = Object.entries(acuerdoSeguro).map(([k, v]) => `${k} ${typeof v === "boolean" ? (v ? "yes" : "no") : `[${(v as string[]).join(", ")}]`}`).join(", ");
    const texto = [
      `Pass for ${i.id}: read-only, for this report only, until ${venceEn} (5 minutes).`,
      `  pass: ${pase}`,
      `  content: ${url}  (ref ${ref})`,
      `  data agreement (apply it before giving anything to the model): ${acuerdoEnTexto === "" ? "closed" : acuerdoEnTexto}.`,
      "Send the pass in the `Authorization: Bearer <pass>` header to the content address: never in the URL. It isn't saved anywhere; ask for another when it expires.",
    ].join("\n");
    return { codigo: SALIDA.ok, json, texto };
  });
}

// ─── deliver / fail ─────────────────────────────────────────────────────────────────────────────────────────────

/** El archivo, leído con las defensas de siempre (sin enlaces, sin FIFOs, con tope), como UN objeto JSON. El texto va tal cual al motor: él calcula la huella. */
function elCuerpo(d: DepsDePuerta, flags: Pick<FlagsDePuerta, "file">, que: string): { ok: true; texto: string; bytes: Uint8Array } | { ok: false; resultado: Resultado } {
  if (flags.file === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_archivo", `The ${que} is missing: \`--file path.json\` (a JSON object, as the contract says).`) };
  const leido = d.leerArchivoChico(flags.file, TOPE_DEL_CUERPO);
  if ("error" in leido) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "archivo_ilegible", `I can't read ${flags.file}: ${leido.error}.`) };
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(leido.bytes);
  } catch {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "archivo_invalido", `${flags.file} isn't UTF-8 text.`) };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "archivo_invalido", `${flags.file} isn't valid JSON.`) };
  }
  if (objeto(json) === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "archivo_invalido", `${flags.file} must hold ONE JSON object (the ${que}).`) };
  return { ok: true, texto, bytes: leido.bytes };
}

/**
 * El id de entrega (`ent_…`) se repite en todos los reintentos porque sale del contenido: el mismo archivo para el mismo reporte es siempre la misma
 * entrega (un reintento nunca publica dos veces), y otro archivo es otra entrega (el motor dirá que ya hay una). Nada se guarda.
 */
function elIdDeEntrega(tipo: "resultado" | "fallo", reporteId: string, bytes: Uint8Array): string {
  const h = createHash("sha256").update(`${tipo}\n${reporteId}\n`).update(bytes).digest("hex");
  return `ent_${h.slice(0, 32)}`;
}

const COMO_REPETIR = (id: string, reporteId: string) =>
  `If you don't know whether it arrived, repeat the same command (same file, delivery id ${id}): a repeat is safe and is never published twice. Or look first: \`supcoflow gate read --id ${reporteId}\`.`;

function entregaEn(r: Resultado, id: string): Resultado {
  return r.json.ok === false && r.json.entrega === undefined ? { ...r, json: { ...r.json, entrega: id } } : r;
}

async function entregar(d: DepsDePuerta, flags: FlagsDePuerta, tipo: "resultado" | "fallo"): Promise<Resultado> {
  const i = idDelReporte(flags);
  if (!i.ok) return i.resultado;
  const que = tipo === "resultado" ? "result" : "failure notice";
  const cuerpo = elCuerpo(d, flags, que);
  if (!cuerpo.ok) return cuerpo.resultado;
  const entrega = elIdDeEntrega(tipo, i.id, cuerpo.bytes);
  const ruta = `PUT /api/v1/reportes/${encodeURIComponent(i.id)}/${tipo} with Idempotency-Key ${entrega} (${cuerpo.bytes.length} bytes)`;
  if (flags.dryRun) {
    const r = dryRun(`${ruta}, with the agent's key (nothing is asked or sent)`);
    return { ...r, json: { ...r.json, reporte_id: i.id, entrega } };
  }
  return conLaClave(d, flags, async (clave) => {
    const pedir = tipo === "resultado" ? d.entregar : d.avisarFallo;
    const comoRepetir = COMO_REPETIR(entrega, i.id);
    const pedido = await alMotor(() => pedir(d.api, clave, i.id, entrega, cuerpo.texto), comoRepetir);
    if (!pedido.ok) return entregaEn(pedido.resultado, entrega);
    const r = pedido.r;
    if (r.status !== 200 && r.status !== 202) return entregaEn(errorDelMotor(r, TABLA, "agente", comoRepetir), entrega);
    const c = r.cuerpo;
    const recibida = idDelMotor(c.entrega);
    const huella = huellaSegura(c.huella);
    if (recibida !== entrega || huella === null) return entregaEn(inesperada(`the ${que}`), entrega);
    const repetido = c.repetido === true;
    const issue = objeto(c.issue);
    const filtrado = objeto(c.filtrado);
    const sinIssue = objeto(c.sin_issue);
    const campos = Array.isArray(filtrado?.campos_quitados) ? filtrado.campos_quitados.filter((x): x is string => typeof x === "string").map((x) => limpio(x).slice(0, 120)).slice(0, 50) : [];
    const datos = {
      reporte_id: i.id, entrega, huella,
      ...(idSeguro(c.publicacion, 32) === null ? {} : { publicacion: idSeguro(c.publicacion, 32) }),
      ...(idSeguro(c.estado, 32) === null ? {} : { estado: idSeguro(c.estado, 32) }),
      ...(typeof c.te_necesitan === "boolean" ? { te_necesitan: c.te_necesitan } : {}),
      ...(issue === null ? {} : { issue: { numero: numeroEntero(issue.numero), url: urlSegura(issue.url) } }),
      ...(filtrado === null ? {} : { filtrado: { campos_quitados: campos, lineas_quitadas: numeroEntero(filtrado.lineas_quitadas) ?? 0 } }),
      ...(sinIssue === null ? {} : { sin_issue: { registrado: sinIssue.registrado === true, issue_sale_igual: sinIssue.issue_sale_igual === true } }),
      ...(typeof c.necesita_persona === "boolean" ? { necesita_persona: c.necesita_persona } : {}),
      ...(repetido ? { repetido: true } : {}),
    };
    const sigue = `Look at how it ended with \`supcoflow gate read --id ${i.id}\`.`;
    const lineas: string[] = [];
    if (tipo === "fallo") {
      lineas.push(`${repetido ? "That failure notice was already recorded" : "Recorded the failure notice"} (delivery ${entrega}): the report is with a person now, and this investigation takes no other delivery.`);
    } else if (repetido) {
      lineas.push(`That delivery was already received (${entrega}, same content): nothing new was published.${issue === null ? "" : ` Issue #${numeroEntero(issue.numero) ?? "?"}.`}`);
    } else {
      lineas.push(`Delivered ${entrega} for ${i.id}: ${c.publicacion === "publicado" ? "published" : "publishing the issue"}.`);
    }
    if (campos.length > 0) lineas.push(`The project's data agreement removed: ${campos.join(", ")}${filtrado !== null && numeroEntero(filtrado.lineas_quitadas) ? ` (and ${numeroEntero(filtrado.lineas_quitadas)} line(s))` : ""}.`);
    if (sinIssue !== null && sinIssue.issue_sale_igual === true) lineas.push("«No issue» was recorded, but until that is turned on the issue is opened anyway.");
    if (tipo === "resultado") lineas.push(sigue);
    return { codigo: SALIDA.ok, json: { ok: true, ...datos }, texto: lineas.join("\n") };
  });
}

export const puertaEntregar = (d: DepsDePuerta, flags: FlagsDePuerta): Promise<Resultado> => entregar(d, flags, "resultado");
export const puertaFallo = (d: DepsDePuerta, flags: FlagsDePuerta): Promise<Resultado> => entregar(d, flags, "fallo");
