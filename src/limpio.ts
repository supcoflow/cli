// Texto que viene del motor, o de un repo (el de un documento, un nombre de archivo, un glob), y sale a la terminal de
// una persona o a un asistente: sin secretos y sin caracteres de control (C0, DEL, C1), que un ESC movería el cursor.
// Primero se quita el control y recién después se tapan los secretos: al revés, una clave partida por un control
// (U+0085, por ejemplo) quedaba entera al quitarlo y se imprimía sin tapar.
import { taparSecretos } from "./contrato.ts";

export const limpio = (t: string): string => taparSecretos(t.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""));
export const cadena = (v: unknown): string => (typeof v === "string" ? limpio(v) : "");

/** Lo mismo, para un valor JSON entero: cada cadena, en cualquier profundidad (las claves no llevan datos de afuera). */
export function limpiarTodo<T>(v: T): T {
  if (typeof v === "string") return limpio(v) as T;
  if (Array.isArray(v)) return v.map(limpiarTodo) as T;
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiarTodo(x)])) as T;
  return v;
}
