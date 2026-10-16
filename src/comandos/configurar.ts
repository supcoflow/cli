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
  if (r.status === 401) return fallo(SALIDA.faltaLogin, "clave_invalida", "La clave ya no vale: iniciá sesión de nuevo.");
  if (r.status >= 500 || typeof r.cuerpo !== "object" || r.cuerpo === null) {
    return fallo(SALIDA.inesperado, "respuesta_inesperada", `El motor contestó algo que no entiendo (${r.status}); probá de nuevo en un rato.`);
  }
  const error = typeof r.cuerpo.error === "string" ? r.cuerpo.error : "rechazado";
  const message = taparSecretos(typeof r.cuerpo.message === "string" ? r.cuerpo.message : `El motor rechazó el pedido (${r.status}).`);
  if (PIDEN_UNA_PERSONA.has(error)) return fallo(SALIDA.haceFaltaUnaPersona, error, message);
  if (TRANSITORIOS.has(error)) return fallo(SALIDA.inesperado, error, message);
  return fallo(SALIDA.entradaInvalida, error, message);
}

export const rutaDe = (p: { id: string }, resto: string) => `/api/proyectos/${encodeURIComponent(p.id)}${resto}`;
export const dryRun = (haria: string): Resultado => ({ codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `Con --dry-run no hago nada; sin él: ${haria}.` });

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
      ? "sin fijar (entra todo, como hoy)"
      : ac.ilegible === true
        ? "fijado pero ilegible (revisalo en la consola)"
        : "fijado";
    const alcance = ac === null || ac === undefined ? "" : " Frena lo que se guarda y lo que lee la IA que releva; no cubre lo que ve la IA del chat mientras conversa.";
    return {
      codigo: SALIDA.ok,
      json: { ok: true, proyecto: p.proyecto.id, ...c },
      texto: [
        `${p.proyecto.id}: chat ${chat.habilitado ? "prendido" : "apagado"}, ${sitiosLista.length} sitio(s), acuerdo de datos ${acuerdo}.${alcance}`,
        `Política de problemas: ${textoDePolitica(c.politica)}`,
        `Marca: ${textoDeMarca(c.marca)}`,
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
  if (modo === "relevar") return "relevar: cada problema se releva y nace el issue (gasta).";
  if (modo === "guardar") return "guardar: los problemas del chat se guardan sin relevar; desde la consola una persona puede pedir el relevamiento (gasta).";
  return "el motor no la informó.";
}

// `marca` es null (nunca se fijó: el chat usa la de fábrica) o {titulo, saludo, tema, logo_url}. Del tema se
// muestran las claves tal cual vinieron: el motor decide cuáles hay, la terminal no las reinterpreta.
function textoDeMarca(v: unknown): string {
  if (v === undefined) return "el motor no la informó.";
  if (v === null) return "sin fijar (el chat usa la de fábrica).";
  const m = v as { titulo?: unknown; saludo?: unknown; tema?: unknown; logo_url?: unknown };
  const partes: string[] = [];
  if (typeof m.titulo === "string" && m.titulo !== "") partes.push(`título «${m.titulo}»`);
  if (typeof m.saludo === "string" && m.saludo !== "") partes.push(`saludo «${m.saludo}»`);
  if (typeof m.tema === "object" && m.tema !== null) {
    const colores = Object.entries(m.tema as Record<string, unknown>).filter(([, x]) => typeof x === "string").map(([k, x]) => `${k} ${x}`);
    if (colores.length > 0) partes.push(`tema ${colores.join(", ")}`);
  }
  partes.push(typeof m.logo_url === "string" && m.logo_url !== "" ? "con logo" : "sin logo");
  return partes.join(", ") + ".";
}

export async function chatPrenderApagar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun">, habilitar: boolean): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/chat");
  if (flags.dryRun) return dryRun(`POST ${ruta} {habilitado: ${habilitar}}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, { habilitado: habilitar }), () => ({
    codigo: SALIDA.ok, json: { ok: true, habilitado: habilitar }, texto: habilitar ? "Chat prendido." : "Chat apagado.",
  }));
}

export async function sitios(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "sitio">, accion: "agregar" | "quitar"): Promise<Resultado> {
  if (flags.sitio === null) return fallo(SALIDA.entradaInvalida, "falta_sitio", `Falta el sitio: \`supcoflow sitios ${accion} --sitio https://tu-app.com\`.`);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/origenes");
  if (flags.dryRun) return dryRun(`POST ${ruta} {accion: ${accion}}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, { accion, origen: flags.sitio }), (c) => ({
    codigo: SALIDA.ok, json: { ok: true, sitios: c.origenes }, texto: `Sitios: ${(c.origenes as string[]).join(", ") || "ninguno"}.`,
  }));
}

export async function chatMarca(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "titulo" | "saludo" | "tema">): Promise<Resultado> {
  const tema: Record<string, string> = {};
  for (const t of flags.tema) {
    const i = t.indexOf("=");
    if (i <= 0 || i === t.length - 1) return fallo(SALIDA.entradaInvalida, "tema_invalido", `--tema va como clave=valor (por ejemplo acento=#0a7); recibí «${t}».`);
    const clave = t.slice(0, i);
    if (clave in tema) return fallo(SALIDA.entradaInvalida, "tema_invalido", `--tema ${clave} va una sola vez.`);
    tema[clave] = t.slice(i + 1);
  }
  if (flags.titulo === null && flags.saludo === null && Object.keys(tema).length === 0) {
    return fallo(SALIDA.entradaInvalida, "marca_vacia", "Pasá al menos --titulo, --saludo o --tema.");
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
  const titulo = flags.titulo ?? (typeof actual?.titulo === "string" ? actual.titulo : null);
  const saludo = flags.saludo ?? (typeof actual?.saludo === "string" ? actual.saludo : null);
  if (titulo !== null) cuerpo.titulo = titulo;
  if (saludo !== null) cuerpo.saludo = saludo;
  const temaActual = typeof actual?.tema === "object" && actual.tema !== null ? (actual.tema as Record<string, string>) : {};
  const temaFinal = { ...temaActual, ...tema };
  if (Object.keys(temaFinal).length > 0) cuerpo.tema = temaFinal;
  const ruta = rutaDe(p.proyecto, "/chat/marca");
  if (flags.dryRun) return dryRun(`POST ${ruta}`);
  return desenlace(await d.configurar(d.api, p.clave, ruta, cuerpo), (c) => ({ codigo: SALIDA.ok, json: { ok: true, marca: c.marca }, texto: "Marca guardada." }));
}

const MIMES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
// El tope del motor es 200 KB (`MAX_LOGO_BYTES`); acá se corta antes para no mandar de más. El motor decide.
const TOPE_DEL_LOGO = 200_000;

export async function chatLogo(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "archivo">): Promise<Resultado> {
  if (flags.archivo === null) return fallo(SALIDA.entradaInvalida, "falta_archivo", "Falta el logo: `supcoflow chat logo --archivo logo.png`.");
  const mime = MIMES[path.extname(flags.archivo).toLowerCase()];
  if (mime === undefined) return fallo(SALIDA.entradaInvalida, "logo_invalido", "El logo tiene que ser .png, .jpg o .webp.");
  const leido = d.leerArchivoChico(flags.archivo, TOPE_DEL_LOGO);
  if ("error" in leido) return fallo(SALIDA.entradaInvalida, "logo_ilegible", `No leo ${flags.archivo}: ${leido.error}.`);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) return dryRun(`POST ${rutaDe(p.proyecto, "/chat/logo")} (${leido.bytes.length} bytes)`);
  return desenlace(
    await d.subirLogo(d.api, p.clave, p.proyecto.id, { bytes: leido.bytes, mime, nombre: path.basename(flags.archivo) }),
    (c) => ({ codigo: SALIDA.ok, json: { ok: true, logo_url: c.logo_url }, texto: "Logo subido." }),
  );
}
