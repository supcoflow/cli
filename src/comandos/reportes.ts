// `supcoflow reports list | show | investigate` — la bandeja de reportes del proyecto del repo, vista por una PERSONA (etapa 2c de la reestructura, «terminal y
// API», D9). Habla con las rutas `/api/v1/proyectos/{id}/reportes…` con la clave personal que dejó `login` (o la de consulta, para leer); nunca con la de un agente
// (eso es `gate`). El proyecto sale del repo, como en `agents`.
//
// Lo que NO hay, a propósito (opción A del dueño): «abrir igual» (publicar el issue sin investigar) y «cambiar de investigador». No existen en el motor, y con un
// reporte de afuera necesitan el pase para persona. Cuando existan van en su propio comando.
//
// El texto del reporte nunca pasa por acá: el motor no lo manda (sólo el título, que es `null` en un reporte de la puerta). Lo que el motor dice en prosa
// (`estado_texto`, el texto de los eventos, el aviso) es castellano libre: en el texto de la terminal se dice con frases fijas en inglés, y en `--json` sale
// limpio (sin controles ni secretos) como dato.
import type { ConsultaDeReportes, Diagnostico, Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { SALIDA, type Resultado } from "../contrato.ts";
import { cadena, limpio } from "../limpio.ts";
import { dryRun, fallo } from "./configurar.ts";
import { alMotor, errorDelMotor, fechaSegura, idDelMotor, idSeguro, numeroEntero, objeto, type Traducciones } from "./del-motor.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeReportes = DepsDelProyectoDelRepo & {
  listar(api: URL, clave: string, proyectoId: string, consulta: ConsultaDeReportes): Promise<Respuesta>;
  recorrido(api: URL, clave: string, proyectoId: string, reporteId: string): Promise<Respuesta>;
  investigar(api: URL, clave: string, proyectoId: string, reporteId: string): Promise<Respuesta>;
  /** El techo de una investigación: el número que la persona autoriza (`--ceiling`), el mismo que muestra `diagnose`. */
  leerDiagnostico(api: URL, clave: string, proyectoId: string): Promise<Diagnostico>;
  avisar: (s: string) => void;
};

type FlagsDeReportes = Pick<Flags, "repo" | "dryRun" | "full" | "filter" | "page" | "perPage" | "id" | "authorizeSpend" | "ceiling">;

export const ID_DE_REPORTE = /^rpt_[A-Za-z0-9_-]{1,100}$/;

// ─── Qué dice cada estado, en inglés ───────────────────────────────────────────────────────────────────────────

// Los doce desenlaces de la bandeja (`conteo` de la API). El que no se conozca se dice por su id: la terminal puede estar vieja.
const ESTADO_EN_TEXTO: ReadonlyMap<string, string> = new Map([
  ["con_issue", "issue created"],
  ["sin_issue", "no issue opened"],
  ["esperando", "waiting to start"],
  ["relevando", "being investigated"],
  ["sin_run", "no investigation started"],
  ["guardado", "saved"],
  ["arranque_incierto", "start uncertain (look at it in the console)"],
  ["reclamado_sin_run", "claimed, no investigation running"],
  ["esperando_a_tu_agente", "waiting for your agent"],
  ["tu_agente_no_contesto", "your agent didn't answer"],
  ["el_agente_fallo", "your agent reported a failure"],
  ["publicacion_a_revisar", "the publication needs a look"],
]);
const estadoEnTexto = (e: string | null): string => (e === null ? "unknown" : (ESTADO_EN_TEXTO.get(e) ?? e));

// Los filtros de la bandeja: el nombre en inglés y el id del motor que le corresponde.
const FILTROS: ReadonlyMap<string, string> = new Map([
  ["all", "todos"], ["needs-you", "necesitan"], ["in-progress", "curso"], ["with-issue", "con_issue"], ["saved", "guardados"],
]);
const FILTRO_EN_TEXTO: Record<string, string> = { todos: "all", necesitan: "needs-you", curso: "in-progress", con_issue: "with-issue", guardados: "saved" };

// ─── Los errores del motor ─────────────────────────────────────────────────────────────────────────────────────

const TABLA: Traducciones = new Map(Object.entries({
  clave_de_agente: { codigo: SALIDA.haceFaltaUnaPersona, message: "That is an agent's key, and this command is for a person. Log in with `supcoflow login` (an agent's key goes to `supcoflow gate`)." },
  clave_de_consulta: { codigo: SALIDA.haceFaltaUnaPersona, message: "A read-only key can read the reports but not ask for an investigation (it spends): sign in with your own key (`supcoflow login`)." },
  rol_insuficiente: { codigo: SALIDA.haceFaltaUnaPersona, message: "Your role in the team can read the reports but can't ask for an investigation (it spends). Ask a team Owner or Member." },
  proyecto_inexistente: { codigo: SALIDA.entradaInvalida, message: "The engine doesn't know that project for your team." },
  reporte_inexistente: { codigo: SALIDA.entradaInvalida, message: "The engine doesn't know that report in this project: check the id (`supcoflow reports list`)." },
  parametro_invalido: { codigo: SALIDA.entradaInvalida, message: "The engine didn't accept that page or page size." },
  ya_esta_con_el_agente: { codigo: SALIDA.haceFaltaUnaPersona, message: "The notice went out less than 2 hours ago: the connected agent still has time. If it doesn't answer you will be able to send it again." },
  el_agente_ya_fallo: { codigo: SALIDA.haceFaltaUnaPersona, message: "The agent reported it couldn't do this report, and an investigation has a single delivery: sending the notice again doesn't help. Opening the issue anyway and changing the investigator aren't available yet." },
  ya_tiene_resultado: { codigo: SALIDA.haceFaltaUnaPersona, message: "The agent already delivered its result: there is nothing to ask for again." },
  agente_no_disponible: { codigo: SALIDA.haceFaltaUnaPersona, message: "The agent assigned to this report is no longer active in the project: there is nobody to send the notice to." },
  proyecto_con_investigador_de_afuera: { codigo: SALIDA.haceFaltaUnaPersona, message: "This project has a connected agent as its investigator and this report is older than that: starting it would run Supcoflow's own agent against yours. Moving an existing report to the connected agent isn't available yet." },
  lo_investiga_un_agente_de_afuera: { codigo: SALIDA.haceFaltaUnaPersona, message: "A connected agent investigates this report, not Supcoflow's own." },
  ya_relevado: { codigo: SALIDA.haceFaltaUnaPersona, message: "This report already has an investigation: look at it with `supcoflow reports show`." },
  despachos_en_pausa: { codigo: SALIDA.inesperado, message: "Dispatches are paused for a moment (a deploy): nothing was started. Try again in a few minutes." },
  falta_ia_del_triaje: { codigo: SALIDA.haceFaltaUnaPersona, message: "The triage agent has no AI account ready, so it can't investigate. A person adds one: `supcoflow agents set-key --agent triage`, or the Agents tab." },
  tope_mensual: { codigo: SALIDA.topeAlcanzado, message: "A spending limit was reached: nothing was started." },
  evidencia_no_leida: { codigo: SALIDA.inesperado, message: "The engine couldn't read the report's evidence, so nothing was started. Try again in a while." },
  despacho_no_registrado: { codigo: SALIDA.inesperado, message: "The engine couldn't register the investigation. Look at the report with `supcoflow reports show` before trying again." },
}));

const conRepo = (repo: string | null) => (repo === null ? "" : ` --repo ${repo}`);
const usd = (n: number) => `US$ ${n.toFixed(2)}`;

// ─── Formas que se aceptan ─────────────────────────────────────────────────────────────────────────────────────

const urlSegura = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s\u0000-\u001f\u007f-\u009f]{1,300}$/.test(v) ? v : null);
const titulo = (v: unknown, tope = 200): string | null => (typeof v === "string" ? limpio(v).slice(0, tope) : null);

function aIssue(v: unknown): { numero: number; url: string | null } | null {
  const o = objeto(v);
  const numero = numeroEntero(o?.numero);
  return o === null || numero === null ? null : { numero, url: urlSegura(o.url) };
}

function aInvestigador(v: unknown): { tipo: string | null; agente_id: string | null } {
  const o = objeto(v);
  return { tipo: idSeguro(o?.tipo, 24), agente_id: idDelMotor(o?.agente_id) };
}

function aAcciones(v: unknown): { accion: string; via: string | null }[] {
  if (!Array.isArray(v)) return [];
  const salida: { accion: string; via: string | null }[] = [];
  for (const x of v) {
    const o = objeto(x);
    const accion = idSeguro(o?.accion, 48);
    if (o !== null && accion !== null) salida.push({ accion, via: idSeguro(o.via, 32) });
  }
  return salida;
}

function aConteo(v: unknown): Record<string, number> {
  const o = objeto(v) ?? {};
  const salida: Record<string, number> = {};
  for (const [k, n] of Object.entries(o)) {
    const clave = idSeguro(k, 48);
    const valor = numeroEntero(n);
    if (clave !== null && valor !== null) salida[clave] = valor;
  }
  return salida;
}

const inesperada = (donde: string): Resultado =>
  fallo(SALIDA.inesperado, "respuesta_inesperada", `The engine answered ${donde} without what I expected; try again in a while.`);

// ─── list ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function reportesListar(d: DepsDeReportes, flags: FlagsDeReportes): Promise<Resultado> {
  let filtro: string | null = null;
  if (flags.filter !== null) {
    filtro = FILTROS.get(flags.filter) ?? null;
    if (filtro === null) return fallo(SALIDA.entradaInvalida, "filtro_invalido", "--filter is `all`, `needs-you`, `in-progress`, `with-issue` or `saved`.");
  }
  let pagina: number | null = null;
  if (flags.page !== null) {
    if (!/^[1-9][0-9]{0,5}$/.test(flags.page)) return fallo(SALIDA.entradaInvalida, "parametro_invalido", "--page is a whole number from 1.");
    pagina = Number(flags.page);
  }
  let porPagina: number | null = null;
  if (flags.perPage !== null) {
    if (!/^[1-9][0-9]{0,2}$/.test(flags.perPage) || Number(flags.perPage) > 100) {
      return fallo(SALIDA.entradaInvalida, "parametro_invalido", "--per-page is a whole number from 1 to 100.");
    }
    porPagina = Number(flags.perPage);
  }

  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const pedido = await alMotor(() => d.listar(d.api, p.clave, p.proyecto.id, { filtro, pagina, porPagina }));
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200) return errorDelMotor(r, TABLA, "persona");
  const c = r.cuerpo;
  const filas = c.reportes;
  const total = numeroEntero(c.total);
  const paginaDevuelta = numeroEntero(c.pagina);
  const paginas = numeroEntero(c.paginas);
  const porPaginaDevuelta = numeroEntero(c.por_pagina);
  if (!Array.isArray(filas) || total === null || paginaDevuelta === null || paginas === null || porPaginaDevuelta === null) return inesperada("the list of reports");

  const reportes = filas.flatMap((x) => {
    const o = objeto(x);
    const id = idDelMotor(o?.reporte_id);
    if (o === null || id === null) return [];
    const base = {
      reporte_id: id, titulo: titulo(o.titulo), creado_en: fechaSegura(o.creado_en), estado: idSeguro(o.estado, 48) ?? "desconocido",
      te_necesitan: o.te_necesitan === true, issue: aIssue(o.issue), investigador: aInvestigador(o.investigador),
    };
    return [flags.full ? { ...base, origen: idSeguro(o.origen, 16), estado_texto: cadena(o.estado_texto) } : base];
  });
  if (reportes.length !== filas.length) return inesperada("a report without its id");

  const conteo = aConteo(c.conteo);
  const filtroEnTexto = FILTRO_EN_TEXTO[idSeguro(c.filtro, 16) ?? "todos"] ?? "all";
  const lineas = reportes.map((x) => {
    const issue = x.issue === null ? "" : `, issue #${x.issue.numero}`;
    const nombre = x.titulo === null || x.titulo === "" ? "" : `  "${x.titulo.slice(0, 80)}"`;
    return `  ${x.reporte_id}  ${x.creado_en === null ? "(no date)" : x.creado_en.slice(0, 10)}  ${estadoEnTexto(x.estado)}${issue}${x.te_necesitan ? "  [needs you]" : ""}${nombre}`;
  });
  const hayMas = paginaDevuelta < paginas;
  const texto = [
    `Reports of ${p.proyecto.repo} (filter ${filtroEnTexto}): ${total} in total, page ${paginaDevuelta} of ${Math.max(paginas, 1)}.`,
    ...(lineas.length === 0 ? ["  (none)"] : lineas),
    ...(hayMas ? [`More: \`supcoflow reports list --page ${paginaDevuelta + 1}${flags.filter === null ? "" : ` --filter ${flags.filter}`}${porPagina === null ? "" : ` --per-page ${porPagina}`}${conRepo(flags.repo)}\`.`] : []),
    "The text of a report isn't here: it is read in the console. See one's journey with `supcoflow reports show --id rpt_…`.",
  ].join("\n");
  const json: Record<string, unknown> = {
    ok: true, proyecto: p.proyecto.id, repo: p.proyecto.repo, filtro: idSeguro(c.filtro, 16) ?? "todos",
    total, pagina: paginaDevuelta, paginas, por_pagina: porPaginaDevuelta, conteo, reportes,
    ...(flags.full ? { ahora: fechaSegura(c.ahora) } : {}),
  };
  return { codigo: SALIDA.ok, json, texto };
}

// ─── show ───────────────────────────────────────────────────────────────────────────────────────────────────────

const ETIQUETA_DEL_EVENTO: ReadonlyMap<string, string> = new Map([
  ["reportado", "reported"], ["triaje", "triaged"], ["issue", "issue opened"],
]);

function elId(flags: Pick<FlagsDeReportes, "id">): { ok: true; id: string } | { ok: false; resultado: Resultado } {
  if (flags.id === null) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_id", "Say which report: `--id rpt_…` (`supcoflow reports list` shows them).") };
  // El valor no se repite: alguien pudo pegar ahí otra cosa.
  if (!ID_DE_REPORTE.test(flags.id)) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "id_invalido", "--id is the report's id, and it starts with rpt_.") };
  return { ok: true, id: flags.id };
}

type Recorrido = {
  reporte_id: string; titulo: string | null; creado_en: string | null; origen: string | null; estado: string; te_necesitan: boolean;
  investigador: { tipo: string | null; agente_id: string | null }; issue: { numero: number; url: string | null } | null;
  eventos: { clave: string | null; cuando: string | null; href: string | null; texto?: string }[];
  aviso: { tono: string | null; titulo: string; texto: string } | null;
  acciones: { accion: string; via: string | null }[]; enlace_a_la_consola: string | null;
  estado_texto: string; avisos: unknown[]; run: unknown;
};

function aRecorrido(c: Record<string, unknown>, esperado: string): Recorrido | null {
  const id = idDelMotor(c.reporte_id);
  if (id === null || id !== esperado || !Array.isArray(c.eventos)) return null;
  const eventos = c.eventos.flatMap((x) => {
    const o = objeto(x);
    return o === null ? [] : [{ clave: idSeguro(o.clave, 32), cuando: fechaSegura(o.cuando), href: urlSegura(o.href), texto: cadena(o.texto) }];
  });
  const a = objeto(c.aviso);
  const avisos = Array.isArray(c.avisos) ? c.avisos.flatMap((x) => {
    const o = objeto(x);
    const intentos = Array.isArray(o?.intentos) ? o.intentos.flatMap((i) => {
      const t = objeto(i);
      const respuesta = numeroEntero(t?.respuesta) ?? idSeguro(t?.respuesta, 32);
      return t === null ? [] : [{ intento: numeroEntero(t.intento), respuesta }];
    }) : [];
    return o === null ? [] : [{
      webhook_id: idDelMotor(o.webhook_id), ronda: numeroEntero(o.ronda), creado_en: fechaSegura(o.creado_en), vence_en: fechaSegura(o.vence_en),
      entrega: idSeguro(o.entrega, 32), resolucion: idSeguro(o.resolucion, 32), intentos,
    }];
  }) : [];
  const run = objeto(c.run);
  return {
    reporte_id: id, titulo: titulo(c.titulo), creado_en: fechaSegura(c.creado_en), origen: idSeguro(c.origen, 16),
    estado: idSeguro(c.estado, 48) ?? "desconocido", estado_texto: cadena(c.estado_texto), te_necesitan: c.te_necesitan === true,
    investigador: aInvestigador(c.investigador), issue: aIssue(c.issue), eventos,
    aviso: a === null ? null : { tono: idSeguro(a.tono, 16), titulo: cadena(a.titulo), texto: cadena(a.texto) },
    acciones: aAcciones(c.acciones), enlace_a_la_consola: urlSegura(c.enlace_a_la_consola), avisos,
    run: run === null ? null : { run_id: idDelMotor(run.run_id), estado: idSeguro(run.estado, 32), creado_en: fechaSegura(run.creado_en), terminado_en: fechaSegura(run.terminado_en) },
  };
}

async function leerElRecorrido(d: DepsDeReportes, flags: FlagsDeReportes, id: string): Promise<{ ok: true; p: { clave: string; proyecto: { id: string; repo: string } }; v: Recorrido } | { ok: false; resultado: Resultado }> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return { ok: false, resultado: p.resultado };
  const pedido = await alMotor(() => d.recorrido(d.api, p.clave, p.proyecto.id, id));
  if (!pedido.ok) return { ok: false, resultado: pedido.resultado };
  if (pedido.r.status !== 200) return { ok: false, resultado: errorDelMotor(pedido.r, TABLA, "persona") };
  const v = aRecorrido(pedido.r.cuerpo, id);
  if (v === null || idDelMotor(pedido.r.cuerpo.proyecto_id) !== p.proyecto.id) return { ok: false, resultado: inesperada("a report's journey") };
  return { ok: true, p, v };
}

const quienInvestiga = (i: Recorrido["investigador"]): string =>
  i.tipo === "agente" ? `your connected agent${i.agente_id === null ? "" : ` (${i.agente_id})`}` : "Supcoflow's own agent";

export async function reportesVer(d: DepsDeReportes, flags: FlagsDeReportes): Promise<Resultado> {
  const i = elId(flags);
  if (!i.ok) return i.resultado;
  const leido = await leerElRecorrido(d, flags, i.id);
  if (!leido.ok) return leido.resultado;
  const { p, v } = leido;

  const puede = v.acciones.some((a) => a.accion === "pedir_investigacion");
  const siguiente = puede ? `supcoflow reports investigate --id ${v.reporte_id}${conRepo(flags.repo)}` : null;
  const lineasDelRecorrido = v.eventos.map((e) => {
    const quien = e.clave === null ? "event" : (ETIQUETA_DEL_EVENTO.get(e.clave) ?? e.clave);
    return `    ${e.cuando ?? "(not yet)"}  ${quien}${e.href === null ? "" : `  ${e.href}`}`;
  });
  const lineasDeLosAvisos = !flags.full ? [] : (v.avisos as { ronda: number | null; entrega: string | null; resolucion: string | null; intentos: unknown[] }[]).map(
    (a) => `    round ${a.ronda ?? "?"}: delivery ${a.entrega ?? "unknown"}${a.resolucion === null ? "" : `, ${a.resolucion}`}, ${a.intentos.length} attempt(s)`);
  const texto = [
    `Report ${v.reporte_id} of ${p.proyecto.repo}${v.titulo === null || v.titulo === "" ? " (no title kept here)" : `: "${v.titulo.slice(0, 100)}"`}`,
    `  State: ${estadoEnTexto(v.estado)}${v.te_necesitan ? " (needs you)" : ""}.`,
    `  Investigated by: ${quienInvestiga(v.investigador)}.`,
    v.issue === null ? "  Issue: none yet." : `  Issue: #${v.issue.numero}${v.issue.url === null ? "" : ` ${v.issue.url}`}`,
    "  Journey:",
    ...(lineasDelRecorrido.length === 0 ? ["    (no events)"] : lineasDelRecorrido),
    ...(lineasDeLosAvisos.length === 0 ? [] : ["  Notices to the agent:", ...lineasDeLosAvisos]),
    siguiente === null ? "  Nothing to ask for from here right now." : `  You can ask for an investigation: \`${siguiente}\` (without --authorize-spend it sends nothing and shows the ceiling).`,
    ...(v.enlace_a_la_consola === null ? [] : [`  In the console: ${v.enlace_a_la_consola}`]),
  ].join("\n");

  const base = {
    ok: true, proyecto: p.proyecto.id, repo: p.proyecto.repo, reporte_id: v.reporte_id, titulo: v.titulo, creado_en: v.creado_en, origen: v.origen,
    estado: v.estado, te_necesitan: v.te_necesitan, investigador: v.investigador, issue: v.issue,
    eventos: v.eventos.map((e) => ({ clave: e.clave, cuando: e.cuando, href: e.href })),
    aviso: v.aviso, acciones: v.acciones, enlace_a_la_consola: v.enlace_a_la_consola, siguiente,
  };
  if (!flags.full) return { codigo: SALIDA.ok, json: { ...base, detalle: `supcoflow reports show --id ${v.reporte_id} --full${conRepo(flags.repo)} --json` }, texto };
  return {
    codigo: SALIDA.ok,
    json: { ...base, estado_texto: v.estado_texto, eventos: v.eventos, avisos: v.avisos, run: v.run },
    texto,
  };
}

// ─── investigate ────────────────────────────────────────────────────────────────────────────────────────────────

const comoSeAutoriza = (id: string, techo: number, repo: string | null) => `supcoflow reports investigate --id ${id} --authorize-spend --ceiling ${techo}${conRepo(repo)}`;

export async function reportesInvestigar(d: DepsDeReportes, flags: FlagsDeReportes): Promise<Resultado> {
  const i = elId(flags);
  if (!i.ok) return i.resultado;
  if (!flags.authorizeSpend && flags.ceiling !== null) {
    return fallo(SALIDA.entradaInvalida, "flags_incompatibles", "--ceiling goes with --authorize-spend: it says what you authorize.");
  }
  let autorizado: number | null = null;
  if (flags.authorizeSpend) {
    if (flags.ceiling === null) {
      return fallo(SALIDA.entradaInvalida, "falta_techo",
        `--authorize-spend needs --ceiling with the number you were shown. Do this: first run \`supcoflow reports investigate --id ${i.id}${conRepo(flags.repo)} --json\` (it sends nothing) to see the ceiling, ask the person to authorize it, and then repeat it with --authorize-spend and --ceiling.`);
    }
    if (!/^\d+(?:\.\d{1,4})?$/.test(flags.ceiling) || !(Number(flags.ceiling) > 0)) {
      return fallo(SALIDA.entradaInvalida, "techo_invalido", "--ceiling is a positive number of US dollars, for example 2 or 2.50.");
    }
    autorizado = Number(flags.ceiling);
  }

  // Se mira el recorrido ANTES de gastar nada: si por esta API no hay nada que pedir, no se manda el POST.
  const leido = await leerElRecorrido(d, flags, i.id);
  if (!leido.ok) return leido.resultado;
  const { p, v } = leido;
  const accion = v.acciones.find((a) => a.accion === "pedir_investigacion");
  if (accion === undefined) {
    const message = `There's nothing to ask for on ${v.reporte_id} from here right now (state: ${estadoEnTexto(v.estado)}). Look at its journey with \`supcoflow reports show --id ${v.reporte_id}${conRepo(flags.repo)}\`.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "nada_que_pedir", message, reporte_id: v.reporte_id, estado: v.estado }, texto: message };
  }
  const via = accion.via ?? "supcoflow";

  // El techo sale del diagnóstico (el mismo número que ve la persona en `diagnose`): lo lee `conClave`, que ya dice una clave rota o sin permiso.
  const lectura = await alMotor(async () => ({ status: 200, cuerpo: { techo: (await d.leerDiagnostico(d.api, p.clave, p.proyecto.id)).techoUsd } }));
  if (!lectura.ok) return lectura.resultado;
  const techo = lectura.r.cuerpo.techo as number;

  const quePasa = via === "agente_de_afuera"
    ? "sends the notice again to your connected agent (its investigation can spend on its own AI account)"
    : "starts Supcoflow's own investigation of the report";
  const ruta = `/api/v1/proyectos/${encodeURIComponent(p.proyecto.id)}/reportes/${encodeURIComponent(v.reporte_id)}/investigacion`;
  if (flags.dryRun) {
    const r = dryRun(`POST ${ruta}: ${quePasa}; up to ${usd(techo)}`);
    return { ...r, json: { ...r.json, reporte_id: v.reporte_id, via, techo_usd: techo, autorizado: autorizado !== null } };
  }

  if (autorizado === null) {
    const siguiente = comoSeAutoriza(v.reporte_id, techo, flags.repo);
    const message = `This ${quePasa}: up to ${usd(techo)}. Nothing was sent. Ask the person to authorize it, then run \`${siguiente}\`.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "falta_autorizacion", message, reporte_id: v.reporte_id, via, techo_usd: techo, siguiente }, texto: message };
  }
  // Lo que la persona vio es lo que viaja: si el techo cambió desde que se le mostró, no se manda nada.
  if (Math.abs(techo - autorizado) > 1e-9) {
    const message = `The ceiling is now ${usd(techo)} and you authorized ${usd(autorizado)}. Nothing was sent. Ask again with the new number: \`${comoSeAutoriza(v.reporte_id, techo, flags.repo)}\`.`;
    return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "techo_distinto", message, techo_usd: techo, autorizado_usd: autorizado }, texto: message };
  }

  const pedido = await alMotor(() => d.investigar(d.api, p.clave, p.proyecto.id, v.reporte_id),
    `I don't know whether it started: look with \`supcoflow reports show --id ${v.reporte_id}${conRepo(flags.repo)}\` before asking again.`);
  if (!pedido.ok) return pedido.resultado;
  const r = pedido.r;
  if (r.status !== 200 && r.status !== 202) {
    return errorDelMotor(r, TABLA, "persona", `Look at the report with \`supcoflow reports show --id ${v.reporte_id}${conRepo(flags.repo)}\` before asking again.`);
  }
  const que = idSeguro(r.cuerpo.investigacion, 24);
  if (que !== "arrancada" && que !== "aviso_reenviado") return inesperada("the investigation");
  const runId = idDelMotor(r.cuerpo.run_id);
  const webhookId = idDelMotor(r.cuerpo.webhook_id);
  const ronda = numeroEntero(r.cuerpo.ronda);
  const repetido = r.cuerpo.repetido === true;
  const datos = {
    reporte_id: v.reporte_id, investigacion: que, via: idSeguro(r.cuerpo.via, 32) ?? via,
    ...(runId === null ? {} : { run_id: runId }), ...(webhookId === null ? {} : { webhook_id: webhookId }), ...(ronda === null ? {} : { ronda }), ...(repetido ? { repetido: true } : {}),
  };
  const sigue = `Follow it with \`supcoflow reports show --id ${v.reporte_id}${conRepo(flags.repo)}\`.`;
  const texto = que === "arrancada"
    ? `Started the investigation of ${v.reporte_id}${runId === null ? "" : ` (run ${runId})`}; it can spend up to ${usd(techo)}. ${sigue}`
    : repetido
      ? `That notice was already sent (round ${ronda ?? "?"}): nothing new started. ${sigue}`
      : `Sent the notice again to your connected agent (round ${ronda ?? "?"}): it has 2 more hours to answer. ${sigue}`;
  return { codigo: SALIDA.ok, json: { ok: true, ...datos, techo_usd: techo }, texto };
}
