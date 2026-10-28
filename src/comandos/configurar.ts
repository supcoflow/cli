// src/comandos/configurar.ts
// Los comandos que configuran el proyecto del repo (spec de supcoflow go §5.4, §9). Cada uno resuelve el
// proyecto, manda UN pedido y traduce la respuesta a los códigos de §13. Lo que se valida acá (un --tema
// sin `=`, un --sitio que falta) se valida para no gastar un pedido; la regla de verdad es la del motor.
import path from "node:path";
import type { Fetch, Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeConfigurar = DepsDelProyectoDelRepo & {
  leerConfiguracion(api: URL, clave: string, proyectoId: string): Promise<Record<string, unknown>>;
  configurar(api: URL, clave: string, ruta: string, cuerpo: unknown, extra?: { idempotencyKey?: string }): Promise<Respuesta>;
  subirLogo(api: URL, clave: string, proyectoId: string, archivo: { bytes: Uint8Array; mime: string; nombre: string }): Promise<Respuesta>;
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  avisar: (s: string) => void;
};
export type { Fetch };

export const fallo = (codigo: Resultado["codigo"], error: string, message: string): Resultado => ({ codigo, json: { ok: false, error, message }, texto: message });
const PIDEN_UNA_PERSONA = new Set(["skill_no_aprobada"]);
const TRANSITORIOS = new Set(["sitios_cambiaron", "idempotency_en_curso"]);

export function desenlace(r: Respuesta, ok: (cuerpo: Record<string, unknown>) => Resultado): Resultado {
  if (r.status >= 200 && r.status < 300) return ok(r.cuerpo);
  // Propio de esta función (hoy `conClave` ya lo filtra antes): sin esto, un 401 o un 5xx caerían en el 3 de
  // «entrada inválida» y la persona (o el asistente) corregiría una entrada que estaba bien.
  if (r.status === 401) return fallo(SALIDA.faltaLogin, "clave_invalida", "The key is no longer valid: log in again.");
  if (r.status >= 500 || typeof r.cuerpo !== "object" || r.cuerpo === null) {
    return fallo(SALIDA.inesperado, "respuesta_inesperada", `The engine answered something I don't understand (${r.status}); try again in a while.`);
  }
  const error = typeof r.cuerpo.error === "string" ? r.cuerpo.error : "rechazado";
  const message = taparSecretos(typeof r.cuerpo.message === "string" ? r.cuerpo.message : `The engine rejected the request (${r.status}).`);
  if (PIDEN_UNA_PERSONA.has(error)) return fallo(SALIDA.haceFaltaUnaPersona, error, message);
  if (TRANSITORIOS.has(error)) return fallo(SALIDA.inesperado, error, message);
  return fallo(SALIDA.entradaInvalida, error, message);
}

export const rutaDe = (p: { id: string }, resto: string) => `/api/proyectos/${encodeURIComponent(p.id)}${resto}`;
export const dryRun = (haria: string): Resultado => ({ codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `With --dry-run I do nothing; without it: ${haria}.` });

export async function comandoConfiguracion(d: DepsDeConfigurar, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  try {
    const c = await d.leerConfiguracion(d.api, p.clave, p.proyecto.id);
    const chat = c.chat as { habilitado?: boolean };
    const sitiosLista = c.sitios as string[];
    // El acuerdo de datos frena lo que se guarda y lo que lee la IA que releva el repo; NO alcanza a lo
    // que ve la IA del propio chat mientras conversa (decisión 1b). Por eso el texto lo dice, y nunca
    // promete «ninguna IA» ni «toda IA». `acuerdo` puede ser null, un acuerdo o {ilegible: true}.
    const ac = c.acuerdo as { ilegible?: boolean } | null | undefined;
    const acuerdo = ac === null || ac === undefined
      ? "not set (everything gets through, as today)"
      : ac.ilegible === true
        ? "set but unreadable (check it in the console)"
        : "set";
    const alcance = ac === null || ac === undefined ? "" : " It limits what is saved and what the AI that investigates reads; it does not cover what the chat's AI sees while it talks.";
    return {
      codigo: SALIDA.ok,
      json: { ok: true, proyecto: p.proyecto.id, ...c },
      texto: [
        `${p.proyecto.id}: chat ${chat.habilitado ? "on" : "off"}, ${sitiosLista.length} site(s), data agreement ${acuerdo}.${alcance}`,
        `Problem policy: ${textoDePolitica(c.politica)}`,
        `Brand: ${textoDeMarca(c.marca)}`,
      ].join("\n"),
    };
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

// La política dicha en palabras llanas (decisión del dueño, 2026-10-16): «guardar» frena sólo lo automático
// del chat; una persona todavía puede pedir el relevamiento desde la consola, y eso gasta. Un motor viejo que
// no la manda no se adivina: se dice que no vino.
function textoDePolitica(v: unknown): string {
  const modo = (v as { modo?: unknown } | null | undefined)?.modo;
  if (modo === "relevar") return "investigate: every problem is investigated and an issue is created (this costs money).";
  if (modo === "guardar") return "save: the chat's problems are saved without investigating; from the console a person can still ask for the investigation (this costs money).";
  return "the engine didn't report it.";
}

// Título, saludo y tema los escribe quien configura el chat y llegan tal cual: un ESC en el título movería el
// cursor o cambiaría colores en la terminal de quien corre `configuracion`. En texto se quitan los caracteres
// de control (C0, DEL y C1); el JSON los conserva, porque ahí van escapados.
const limpio = (t: string) => t.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");

// `marca` es null (nunca se fijó: el chat usa la de fábrica) o {titulo, saludo, tema, logo_url}. Del tema se
// muestran las claves tal cual vinieron: el motor decide cuáles hay, la terminal no las reinterpreta.
function textoDeMarca(v: unknown): string {
  if (v === undefined) return "the engine didn't report it.";
  if (v === null) return "not set (the chat uses the default one).";
  const m = v as { titulo?: unknown; saludo?: unknown; tema?: unknown; logo_url?: unknown };
  const partes: string[] = [];
  if (typeof m.titulo === "string" && m.titulo !== "") partes.push(`title «${limpio(m.titulo)}»`);
  if (typeof m.saludo === "string" && m.saludo !== "") partes.push(`greeting «${limpio(m.saludo)}»`);
  if (typeof m.tema === "object" && m.tema !== null) {
    const colores = Object.entries(m.tema as Record<string, unknown>).filter(([, x]) => typeof x === "string").map(([k, x]) => `${limpio(k)} ${limpio(x as string)}`);
    if (colores.length > 0) partes.push(`theme ${colores.join(", ")}`);
  }
  partes.push(typeof m.logo_url === "string" && m.logo_url !== "" ? "with logo" : "no logo");
  return partes.join(", ") + ".";
}

export async function chatPrenderApagar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun">, habilitar: boolean): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/chat");
  if (flags.dryRun) return dryRun(`POST ${ruta} {habilitado: ${habilitar}}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, { habilitado: habilitar }), () => ({
    codigo: SALIDA.ok, json: { ok: true, habilitado: habilitar }, texto: habilitar ? "Chat turned on." : "Chat turned off.",
  }));
}

export async function sitios(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "site">, accion: "agregar" | "quitar"): Promise<Resultado> {
  if (flags.site === null) return fallo(SALIDA.entradaInvalida, "falta_sitio", `The site is missing: \`supcoflow sites ${accion === "agregar" ? "add" : "remove"} --site https://your-app.com\`.`);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/origenes");
  if (flags.dryRun) return dryRun(`POST ${ruta} {accion: ${accion}}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, { accion, origen: flags.site }), (c) => ({
    codigo: SALIDA.ok, json: { ok: true, sitios: c.origenes }, texto: `Sites: ${(c.origenes as string[]).join(", ") || "none"}.`,
  }));
}

export async function chatMarca(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "title" | "greeting" | "theme">): Promise<Resultado> {
  const tema: Record<string, string> = {};
  for (const t of flags.theme) {
    const i = t.indexOf("=");
    if (i <= 0 || i === t.length - 1) return fallo(SALIDA.entradaInvalida, "tema_invalido", `--theme goes as key=value (for example accent=#0a7); I got «${t}».`);
    const clave = t.slice(0, i);
    if (clave in tema) return fallo(SALIDA.entradaInvalida, "tema_invalido", `--theme ${clave} can only be given once.`);
    tema[clave] = t.slice(i + 1);
  }
  if (flags.title === null && flags.greeting === null && Object.keys(tema).length === 0) {
    return fallo(SALIDA.entradaInvalida, "marca_vacia", "Give at least one of --title, --greeting or --theme.");
  }
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  // ─── Se manda la marca ENTERA, mezclada con la guardada (revisión externa del 2026-10-16, hallazgo 5) ───
  // La route REEMPLAZA la marca (`escribirMarcaDelChat`: lo omitido queda NULL y el tema `{}`), porque así
  // la usa el formulario de la consola, que manda todo junto y vacía un campo dejándolo en blanco. Mandar
  // sólo `--titulo` borraba el saludo y los colores. La terminal lee lo guardado y cambia sólo lo nombrado.
  // Costo aceptado: dos ediciones a la vez (terminal y consola) pueden pisarse; es una persona configurando.
  // Borrar un campo desde la terminal no existe en este bloque: se hace en la consola.
  let actual: { titulo?: unknown; saludo?: unknown; tema?: unknown } | null;
  try {
    actual = (await d.leerConfiguracion(d.api, p.clave, p.proyecto.id)).marca as typeof actual;
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const cuerpo: Record<string, unknown> = {};
  const titulo = flags.title ?? (typeof actual?.titulo === "string" ? actual.titulo : null);
  const saludo = flags.greeting ?? (typeof actual?.saludo === "string" ? actual.saludo : null);
  if (titulo !== null) cuerpo.titulo = titulo;
  if (saludo !== null) cuerpo.saludo = saludo;
  const temaActual = typeof actual?.tema === "object" && actual.tema !== null ? (actual.tema as Record<string, string>) : {};
  const temaFinal = { ...temaActual, ...tema };
  if (Object.keys(temaFinal).length > 0) cuerpo.tema = temaFinal;
  const ruta = rutaDe(p.proyecto, "/chat/marca");
  if (flags.dryRun) return dryRun(`POST ${ruta}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, cuerpo), (c) => ({ codigo: SALIDA.ok, json: { ok: true, marca: c.marca }, texto: "Brand saved." }));
}

const MIMES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
// El tope del motor es 200 KB (`MAX_LOGO_BYTES`); acá se corta antes para no mandar de más. El motor decide.
const TOPE_DEL_LOGO = 200_000;

export async function chatLogo(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "file">): Promise<Resultado> {
  if (flags.file === null) return fallo(SALIDA.entradaInvalida, "falta_archivo", "The logo is missing: `supcoflow chat logo --file logo.png`.");
  const mime = MIMES[path.extname(flags.file).toLowerCase()];
  if (mime === undefined) return fallo(SALIDA.entradaInvalida, "logo_invalido", "The logo must be .png, .jpg or .webp.");
  const leido = d.leerArchivoChico(flags.file, TOPE_DEL_LOGO);
  if ("error" in leido) return fallo(SALIDA.entradaInvalida, "logo_ilegible", `I can't read ${flags.file}: ${leido.error}.`);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) return dryRun(`POST ${rutaDe(p.proyecto, "/chat/logo")} (${leido.bytes.length} bytes)`);
  return desenlace(
    await d.subirLogo(d.api, p.clave, p.proyecto.id, { bytes: leido.bytes, mime, nombre: path.basename(flags.file) }),
    (c) => ({ codigo: SALIDA.ok, json: { ok: true, logo_url: c.logo_url }, texto: "Logo uploaded." }),
  );
}
