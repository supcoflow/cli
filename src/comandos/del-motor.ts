// Lo que `reports` y `gate` (etapa 2c) comparten para decir lo que contesta el motor: ninguna frase del motor llega a la pantalla (es castellano libre
// que esta terminal no controla, y podría llevar un dato del usuario final); cada error se dice con una frase FIJA de acá, y del cuerpo pasan sólo
// campos de una lista blanca (ids cortos, nombres de campo, huellas). El `error` del motor sí se conserva —un identificador, validado— para que
// quien llama decida. Un 401 o un 403 se dicen claro y la terminal no prueba con otra credencial: ningún comando de acá reintenta.
import type { Respuesta } from "../api.ts";
import { FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { pareceUnaClave } from "../clave-sin-eco.ts";

export type Traduccion = { codigo: Resultado["codigo"]; message: string };
export type Traducciones = ReadonlyMap<string, Traduccion>;

/** Quién habla: cambia lo que quiere decir un 401 y qué credencial se le pide a quien lee el error. */
export type Quien = "persona" | "agente";

// ─── Lo que se acepta del motor (lista blanca) ─────────────────────────────────────────────────────────────────

/** Un identificador corto en minúsculas (`ya_relevado`). Una clave (mayúsculas o prefijo conocido) no pasa. */
export const idSeguro = (v: unknown, largo = 64): string | null =>
  typeof v === "string" && new RegExp(`^[a-z][a-z0-9_-]{0,${largo - 1}}$`).test(v) && !pareceUnaClave(v) ? v : null;
/** Un id del motor con prefijo (`rpt_…`, `run_…`, `msg_…`, `ent_…`): letras, números, `_` y `-`. */
export const idDelMotor = (v: unknown, largo = 100): string | null =>
  typeof v === "string" && new RegExp(`^[A-Za-z][A-Za-z0-9]{0,11}_[A-Za-z0-9_-]{1,${largo}}$`).test(v) && !pareceUnaClave(v) ? v : null;
export const huellaSegura = (v: unknown): string | null => (typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v) ? v : null);
export const numeroEntero = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
export const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const fechaSegura = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** Los 422 del motor dicen el camino del campo y el código del problema (`diagnostico.titulo:too_big`), nunca el valor. Sólo ese formato pasa. */
const PROBLEMA = /^[A-Za-z0-9_.()\[\]-]{1,80}:[a-z_]{1,40}$/;
const NOMBRE_DE_CAMPO = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
function lista(v: unknown, vale: (x: string) => boolean, tope = 30): string[] | null {
  if (!Array.isArray(v)) return null;
  const salida = v.filter((x): x is string => typeof x === "string" && vale(x) && !pareceUnaClave(x)).slice(0, tope);
  return salida.length === 0 ? null : salida;
}

/** Lo que de un error del motor se puede repetir sin riesgo: todo lo demás se descarta. */
export function datosDelError(c: Record<string, unknown>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const validos = lista(c.validos, (x) => /^[a-z][a-z0-9_]{0,48}$/.test(x));
  if (validos !== null) d.validos = validos;
  const campos = lista(c.campos, (x) => NOMBRE_DE_CAMPO.test(x));
  if (campos !== null) d.campos = campos;
  const problemas = lista(c.problemas, (x) => PROBLEMA.test(x));
  if (problemas !== null) d.problemas = problemas;
  for (const k of ["huella_guardada", "huella_recibida"] as const) {
    const h = huellaSegura(c[k]);
    if (h !== null) d[k] = h;
  }
  const entrega = idDelMotor(c.entrega);
  if (entrega !== null && entrega.startsWith("ent_")) d.entrega = entrega;
  for (const k of ["tipo", "estado", "publicacion"] as const) {
    const x = idSeguro(c[k], 32);
    if (x !== null) d[k] = x;
  }
  return d;
}

// ─── Un pedido al motor ────────────────────────────────────────────────────────────────────────────────────────

/** Lo que lanza `api.ts` (red caída, respuesta que no es JSON) sale como resultado, con una frase de esta terminal; `siNoLlega` agrega qué hacer. */
export async function alMotor(
  hacer: () => Promise<Respuesta>, siNoLlega = "",
): Promise<{ ok: true; r: Respuesta } | { ok: false; resultado: Resultado }> {
  try {
    return { ok: true, r: await hacer() };
  } catch (e) {
    if (e instanceof FalloDeLaTerminal && e.error === "motor_inalcanzable") {
      const message = siNoLlega === "" ? e.message : `${e.message} ${siNoLlega}`;
      return { ok: false, resultado: { codigo: e.codigo, json: { ok: false, error: e.error, message }, texto: message } };
    }
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
}

// ─── Los errores del motor, con frases fijas ───────────────────────────────────────────────────────────────────

const SIN_VALIDEZ_PERSONA = "The key is no longer valid: log in again with `supcoflow login`.";
const SIN_VALIDEZ_AGENTE = "The agent's key isn't valid (it may have been revoked or replaced). Get a new key in the console: this command doesn't try another one.";

/**
 * Traduce una respuesta que no es la esperada. `tabla` trae las frases de cada `error` propio del comando; lo que no esté ahí se dice por el status.
 * 401 es «la clave no vale»; 403 es «esta clave no puede esto» (no «una persona hace falta»: el que lee es, muchas veces, otro agente). Nunca se repite
 * el `message` del motor.
 */
export function errorDelMotor(r: Respuesta, tabla: Traducciones, quien: Quien, comoReintentar = ""): Resultado {
  const codigoDelMotor = idSeguro(r.cuerpo.error);
  const conocido = codigoDelMotor === null ? undefined : tabla.get(codigoDelMotor);
  let error = codigoDelMotor ?? "rechazado";
  let codigo: Resultado["codigo"];
  let message: string;
  if (conocido !== undefined) {
    ({ codigo, message } = conocido);
  } else if (r.status === 401) {
    codigo = SALIDA.faltaLogin;
    error = codigoDelMotor === "clave_revocada" ? "clave_revocada" : "clave_invalida";
    message = quien === "persona" ? SIN_VALIDEZ_PERSONA : SIN_VALIDEZ_AGENTE;
  } else if (r.status === 403) {
    codigo = SALIDA.haceFaltaUnaPersona;
    message = quien === "persona"
      ? "This key can't do that. Sign in with your own key (`supcoflow login`), and ask a team Owner if it needs one."
      : "This agent's key can't do that: its type or its project don't allow it. This command doesn't try another key.";
  } else if (r.status === 404) {
    codigo = SALIDA.entradaInvalida;
    message = "The engine doesn't know that: check the id.";
  } else if (r.status === 413) {
    codigo = SALIDA.entradaInvalida;
    error = "cuerpo_demasiado_grande";
    message = "The engine says the body is too big (the limit is 256 KB).";
  } else if (r.status >= 500) {
    codigo = SALIDA.inesperado;
    error = "error_interno";
    message = `The engine answered ${r.status}; try again in a few minutes.${comoReintentar === "" ? "" : ` ${comoReintentar}`}`;
  } else if (r.status === 409) {
    codigo = SALIDA.haceFaltaUnaPersona;
    message = `The engine can't do that in the report's current state (${error}). Look at the report with \`${quien === "persona" ? "supcoflow reports show" : "supcoflow gate read"}\`.`;
  } else {
    codigo = SALIDA.entradaInvalida;
    message = `The engine rejected the request (${r.status}).`;
  }
  const json: Record<string, unknown> = { ok: false, error, message, ...datosDelError(r.cuerpo) };
  return { codigo, json, texto: [message, ...textoDeLosDatos(json)].join("\n") };
}

/** Las líneas que un 422 agrega al texto (qué campos, qué motivos son válidos): son nombres, nunca valores. */
function textoDeLosDatos(j: Record<string, unknown>): string[] {
  const lineas: string[] = [];
  if (Array.isArray(j.validos)) lineas.push(`Valid values: ${j.validos.join(", ")}.`);
  if (Array.isArray(j.campos)) lineas.push(`Fields the contract doesn't have: ${j.campos.join(", ")}.`);
  if (Array.isArray(j.problemas)) lineas.push(`Problems (field:code): ${j.problemas.join(", ")}.`);
  return lineas;
}
