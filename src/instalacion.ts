// `.supcoflow/instalacion.json` (bloque 6, decisión 3; v2 en la 0.8.0; v3 en la 0.9.0): con qué versiones se hizo la instalación, anotado en el
// repo de quien instala. Supcoflow no lo guarda ni lo ve. Puro: recibe lo ya leído y arma el archivo.
//
// El archivo queda en el repo y se commitea: un secreto acá se publica con el primer `push`. Por eso se arma con
// una LISTA CERRADA de campos, cada uno validado por separado; nunca un `...configuracion` (la configuración del
// motor trae `fijado_por`, `publicada_por`, huellas y lo que el motor agregue mañana: nada de eso es de este archivo).
import { FalloDeLaTerminal, SALIDA, taparSecretos } from "./contrato.ts";

export const RUTA_DE_LA_INSTALACION = ".supcoflow/instalacion.json";
export const PAQUETE_DEL_CHAT = "@supcoflow/chat";

// Lo que devuelve `GET …/configuracion`, sin interpretar: la terminal lo recibe como `Record` (`leerConfiguracion`)
// y cada campo que se usa se valida acá.
export type Configuracion = Record<string, unknown>;

// v2 (0.8.0) sumó `archivo`: el archivo del chat que ya se instaló, para que re-correr el go lo actualice en su lugar
// y no monte un segundo chat. v3 (0.9.0, T8 del chat agnóstico al estilo) lo cambia por tres campos:
//   · `forma`: qué se instaló: el widget (`"widget"`) o una interfaz construida por el agente de código de la app con los
//     componentes de la app (`"interfaz_propia"`); `null` si no se sabe.
//   · `archivos`: los archivos de esa instalación (uno para el widget; varios para una interfaz propia), rutas relativas a
//     la raíz del repo.
//   · `contrato`: la versión del contrato de presentación que trae el paquete instalado (su `contract.json`), o `null` si
//     el paquete no lo trae (un `@supcoflow/chat` anterior al contrato).
// Un archivo v1 (sin `version` ni `archivo`) y uno v2 se leen igual: el `archivo` de la v2 sólo existió para el widget.
export type Forma = "widget" | "interfaz_propia";
export const FORMAS: readonly Forma[] = ["widget", "interfaz_propia"];
export const MAX_ARCHIVOS_ANOTADOS = 20;

export type Instalacion = {
  version: 3; skill: string; terminal: string;
  chat: { declarado: string | null; instalado: string | null };
  configuracion: {
    acuerdo_version: number | null; politica: "relevar" | "guardar";
    guia: { origen: "repo"; procedencia: "terminal" | "github"; commit: string | null } | { origen: "agente"; version: number } | null;
  };
  forma: Forma | null;
  archivos: string[];
  contrato: string | null;
};

// SemVer 2.0 tal cual, con tope de largo: la versión de la skill la escribe un asistente y queda en el repo.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const esSemver = (s: string): boolean => s.length <= 64 && SEMVER.test(s);

/** Compara `major.minor.patch` número a número (1.10.0 > 1.9.0); lo que sigue al guion (prerelease) o al `+` no cuenta. */
export function compararSemver(a: string, b: string): number {
  const partes = (v: string) => v.split(/[-+]/)[0]!.split(".").map(Number);
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

const ilegible = (message: string) => new FalloDeLaTerminal(SALIDA.inesperado, "paquete_ilegible", message);
const inesperada = (que: string) =>
  new FalloDeLaTerminal(SALIDA.inesperado, "configuracion_inesperada", `The engine answered the configuration with ${que} I don't understand; I'm not recording anything halfway. Try again in a while.`);

// Lo declarado en el `package.json` de la app lo escribió quien escribió el repo: puede ser un rango, un alias o
// cualquier cosa. Se copia tal cual sólo si es texto imprimible y corto; si no, no se adivina (`paquete_ilegible`).
// `taparSecretos` igual, por si alguien pegó una clave ahí: el archivo nuevo no la repite.
function declaradoEn(app: unknown): string | null {
  const a = objeto(app);
  if (a === null) return null;
  const v = objeto(a.dependencies)?.[PAQUETE_DEL_CHAT] ?? objeto(a.devDependencies)?.[PAQUETE_DEL_CHAT];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > 200 || !/^[\x20-\x7e]+$/.test(v)) {
    throw ilegible(`The version of ${PAQUETE_DEL_CHAT} in the app's package.json isn't understandable; I'm not recording it.`);
  }
  return taparSecretos(v);
}

// `null` es «no está instalado». Un archivo que existe pero sin versión válida NO es null: diría que no está.
function instaladoEn(paquete: unknown): string | null {
  if (paquete === null) return null;
  const v = objeto(paquete)?.version;
  if (typeof v !== "string" || !esSemver(v)) throw ilegible(`The installed package.json of ${PAQUETE_DEL_CHAT} has no version I understand.`);
  return v;
}

function acuerdoDe(c: Configuracion): number | null {
  if (c.acuerdo === null) return null;
  const a = objeto(c.acuerdo);
  // Ilegible es un estado conocido del motor (aplica cerrado), no «sin acuerdo»: anotarlo como null mentiría.
  if (a?.ilegible === true) {
    throw new FalloDeLaTerminal(SALIDA.haceFaltaUnaPersona, "acuerdo_ilegible", "The data agreement is set but can't be read: check it in the console and run again.");
  }
  if (a === null || !entero(a.version)) throw inesperada("an agreement");
  return a.version;
}

function politicaDe(c: Configuracion): "relevar" | "guardar" {
  const modo = objeto(c.politica)?.modo;
  if (modo !== "relevar" && modo !== "guardar") throw inesperada("a policy");
  return modo;
}

function guiaDe(c: Configuracion): Instalacion["configuracion"]["guia"] {
  if (c.guia === null) return null;
  const g = objeto(c.guia);
  if (g?.origen === "repo") {
    if (g.procedencia !== "terminal" && g.procedencia !== "github") throw inesperada("a guide");
    if (g.commit !== null && (typeof g.commit !== "string" || !/^[0-9a-f]{40}$/.test(g.commit))) throw inesperada("a guide");
    return { origen: "repo", procedencia: g.procedencia, commit: g.commit };
  }
  if (g?.origen === "agente" && entero(g.version)) return { origen: "agente", version: g.version };
  throw inesperada("a guide");
}

// El `contract.json` del paquete instalado (T1 del sdk): sólo se copia su `version`, nunca el resto. Ausente es null (un
// paquete anterior al contrato); presente sin una versión que se entienda NO es null: diría que no hay contrato.
function contratoDe(contrato: unknown): string | null {
  if (contrato === null || contrato === undefined) return null;
  const v = objeto(contrato)?.version;
  if (typeof v !== "string" || !esSemver(v)) throw ilegible(`The contract.json of ${PAQUETE_DEL_CHAT} has no version I understand.`);
  return v;
}

export function armarInstalacion(i: {
  skill: string; terminal: string; paqueteDeLaApp: unknown; paqueteInstalado: unknown; configuracion: Configuracion;
  forma?: Forma | null; archivos?: string[]; contrato?: unknown;
}): Instalacion {
  return {
    version: 3,
    skill: i.skill,
    terminal: i.terminal,
    chat: { declarado: declaradoEn(i.paqueteDeLaApp), instalado: instaladoEn(i.paqueteInstalado) },
    configuracion: { acuerdo_version: acuerdoDe(i.configuracion), politica: politicaDe(i.configuracion), guia: guiaDe(i.configuracion) },
    forma: i.forma ?? null,
    archivos: [...(i.archivos ?? [])],
    contrato: contratoDe(i.contrato),
  };
}

// ─── El archivo del chat (`install record --file`) ───
const MAX_LARGO_DEL_ARCHIVO = 300;

export type RutaDelChat = { ok: true; ruta: string } | { ok: false; motivo: string };

// Pura: una ruta RELATIVA a la raíz del repo, sin `..`, sin ruta absoluta. Se devuelve normalizada (separador `/`, sin
// `./` ni barras de más), que es como queda anotada. Que no sea un enlace simbólico lo mira el comando, con el disco.
export function validarElArchivoDelChat(crudo: string): RutaDelChat {
  if (crudo.length === 0 || crudo.length > MAX_LARGO_DEL_ARCHIVO || /[\u0000-\u001f\u007f]/.test(crudo)) {
    return { ok: false, motivo: `--file goes with a path of up to ${MAX_LARGO_DEL_ARCHIVO} printable characters.` };
  }
  if (crudo.startsWith("/") || crudo.startsWith("\\") || /^[A-Za-z]:/.test(crudo)) {
    return { ok: false, motivo: "--file is a path relative to the repo root, not an absolute one." };
  }
  const partes = crudo.split(/[\\/]/).filter((x) => x !== "" && x !== ".");
  if (partes.includes("..")) return { ok: false, motivo: "--file can't go out of the repo: no `..` in the path." };
  if (partes.length === 0) return { ok: false, motivo: "--file is the chat file, not a folder: say its path." };
  return { ok: true, ruta: partes.join("/") };
}

export type Anotado = { forma: Forma | null; archivos: string[]; contrato: string | null };
export type LecturaDeLaInstalacion = { estado: "ausente" } | { estado: "ilegible" } | ({ estado: "leida" } & Anotado);
const SIN_NADA: Anotado = { forma: null, archivos: [], contrato: null };

// Una lista de rutas anotadas: cada una tiene que ser válida Y estar ya normalizada (es como la escribe esta terminal); lo
// que no, se descarta de a una, sin error. Sin repetidas y con tope.
function rutasAnotadas(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const rutas: string[] = [];
  for (const a of v) {
    if (typeof a !== "string") continue;
    const r = validarElArchivoDelChat(a);
    if (r.ok && r.ruta === a && !rutas.includes(a) && rutas.length < MAX_ARCHIVOS_ANOTADOS) rutas.push(a);
  }
  return rutas;
}

/**
 * Lo que un `instalacion.json` ya existente dice de la forma, los archivos y el contrato. v1 y cualquier cosa ilegible o inválida
 * dan «nada»; una versión que esta terminal no conoce (4 o más) tampoco se adivina. Nunca un error.
 */
export function leerInstalacionAnotada(texto: string | null): LecturaDeLaInstalacion {
  if (texto === null) return { estado: "ausente" };
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return { estado: "ilegible" };
  }
  const o = objeto(v);
  if (o === null) return { estado: "ilegible" };
  // v1 se reconoce por `version: 1` (la 0.7.0) y no tiene archivo, aunque el campo aparezca.
  if (o.version === 2) {
    const a = typeof o.archivo === "string" ? validarElArchivoDelChat(o.archivo) : null;
    // El `archivo` de la v2 sólo existió para el widget.
    return a !== null && a.ok && a.ruta === o.archivo ? { estado: "leida", forma: "widget", archivos: [a.ruta], contrato: null } : { estado: "leida", ...SIN_NADA };
  }
  if (o.version === 3) {
    const forma = FORMAS.find((f) => f === o.forma) ?? null;
    const contrato = typeof o.contrato === "string" && esSemver(o.contrato) ? o.contrato : null;
    return { estado: "leida", forma, archivos: rutasAnotadas(o.archivos), contrato };
  }
  return { estado: "leida", ...SIN_NADA };
}

export function anotadoEn(texto: string | null): Anotado {
  const l = leerInstalacionAnotada(texto);
  return l.estado === "leida" ? { forma: l.forma, archivos: l.archivos, contrato: l.contrato } : SIN_NADA;
}

/** Valida y normaliza la lista de `--file`: cada ruta con `validarElArchivoDelChat`, sin repetidas, con tope. */
export function validarLosArchivos(crudos: string[]): { ok: true; rutas: string[] } | { ok: false; motivo: string } {
  const rutas: string[] = [];
  for (const crudo of crudos) {
    const r = validarElArchivoDelChat(crudo);
    if (!r.ok) return r;
    if (!rutas.includes(r.ruta)) rutas.push(r.ruta);
  }
  if (rutas.length > MAX_ARCHIVOS_ANOTADOS) return { ok: false, motivo: `--file goes up to ${MAX_ARCHIVOS_ANOTADOS} times: the files of the chat, not the whole app.` };
  return { ok: true, rutas };
}

// El orden de las claves es el de `armarInstalacion`: el mismo estado da los mismos bytes, y eso es `sin_cambios`.
export function serializar(x: Instalacion): string {
  return JSON.stringify(x, null, 2) + "\n";
}
