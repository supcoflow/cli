// `.supcoflow/instalacion.json` (bloque 6, decisión 3; v2 en la 0.8.0): con qué versiones se hizo la instalación, anotado en el
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

// v2 (0.8.0) suma `archivo`: el archivo del chat que ya se instaló, para que re-correr el go lo actualice en su
// lugar y no monte un segundo chat. Un archivo v1 (sin `version` ni `archivo`) se lee igual y da `archivo: null`.
export type Instalacion = {
  version: 2; skill: string; terminal: string;
  chat: { declarado: string | null; instalado: string | null };
  configuracion: {
    acuerdo_version: number | null; politica: "relevar" | "guardar";
    guia: { origen: "repo"; procedencia: "terminal" | "github"; commit: string | null } | { origen: "agente"; version: number } | null;
  };
  archivo: string | null;
};

// SemVer 2.0 tal cual, con tope de largo: la versión de la skill la escribe un asistente y queda en el repo.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const esSemver = (s: string): boolean => s.length <= 64 && SEMVER.test(s);

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

export function armarInstalacion(i: {
  skill: string; terminal: string; paqueteDeLaApp: unknown; paqueteInstalado: unknown; configuracion: Configuracion; archivo?: string | null;
}): Instalacion {
  return {
    version: 2,
    skill: i.skill,
    terminal: i.terminal,
    chat: { declarado: declaradoEn(i.paqueteDeLaApp), instalado: instaladoEn(i.paqueteInstalado) },
    configuracion: { acuerdo_version: acuerdoDe(i.configuracion), politica: politicaDe(i.configuracion), guia: guiaDe(i.configuracion) },
    archivo: i.archivo ?? null,
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

/** El `archivo` anotado en un `instalacion.json` ya existente: v1 y cualquier cosa ilegible o inválida dan null (nunca un error). */
export function archivoAnotado(texto: string | null): string | null {
  if (texto === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    return null;
  }
  const a = objeto(v)?.archivo;
  if (typeof a !== "string") return null;
  const r = validarElArchivoDelChat(a);
  return r.ok && r.ruta === a ? a : null;
}

// El orden de las claves es el de `armarInstalacion`: el mismo estado da los mismos bytes, y eso es `sin_cambios`.
export function serializar(x: Instalacion): string {
  return JSON.stringify(x, null, 2) + "\n";
}
