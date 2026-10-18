// `.supcoflow/instalacion.json` (bloque 6, decisión 3): con qué versiones se hizo la instalación, anotado en el
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

export type Instalacion = {
  version: 1; skill: string; terminal: string;
  chat: { declarado: string | null; instalado: string | null };
  configuracion: {
    acuerdo_version: number | null; politica: "relevar" | "guardar";
    guia: { origen: "repo"; procedencia: "terminal" | "github"; commit: string | null } | { origen: "agente"; version: number } | null;
  };
};

// SemVer 2.0 tal cual, con tope de largo: la versión de la skill la escribe un asistente y queda en el repo.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const esSemver = (s: string): boolean => s.length <= 64 && SEMVER.test(s);

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

const ilegible = (message: string) => new FalloDeLaTerminal(SALIDA.inesperado, "paquete_ilegible", message);
const inesperada = (que: string) =>
  new FalloDeLaTerminal(SALIDA.inesperado, "configuracion_inesperada", `El motor contestó la configuración con ${que} que no entiendo; no anoto nada a medias. Probá de nuevo en un rato.`);

// Lo declarado en el `package.json` de la app lo escribió quien escribió el repo: puede ser un rango, un alias o
// cualquier cosa. Se copia tal cual sólo si es texto imprimible y corto; si no, no se adivina (`paquete_ilegible`).
// `taparSecretos` igual, por si alguien pegó una clave ahí: el archivo nuevo no la repite.
function declaradoEn(app: unknown): string | null {
  const a = objeto(app);
  if (a === null) return null;
  const v = objeto(a.dependencies)?.[PAQUETE_DEL_CHAT] ?? objeto(a.devDependencies)?.[PAQUETE_DEL_CHAT];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > 200 || !/^[\x20-\x7e]+$/.test(v)) {
    throw ilegible(`La versión de ${PAQUETE_DEL_CHAT} en el package.json de la app no se entiende; no la anoto.`);
  }
  return taparSecretos(v);
}

// `null` es «no está instalado». Un archivo que existe pero sin versión válida NO es null: diría que no está.
function instaladoEn(paquete: unknown): string | null {
  if (paquete === null) return null;
  const v = objeto(paquete)?.version;
  if (typeof v !== "string" || !esSemver(v)) throw ilegible(`El package.json de ${PAQUETE_DEL_CHAT} instalado no trae una versión que entienda.`);
  return v;
}

function acuerdoDe(c: Configuracion): number | null {
  if (c.acuerdo === null) return null;
  const a = objeto(c.acuerdo);
  // Ilegible es un estado conocido del motor (aplica cerrado), no «sin acuerdo»: anotarlo como null mentiría.
  if (a?.ilegible === true) {
    throw new FalloDeLaTerminal(SALIDA.haceFaltaUnaPersona, "acuerdo_ilegible", "El acuerdo de datos está fijado pero no se lee: revisalo en la consola y volvé a correr.");
  }
  if (a === null || !entero(a.version)) throw inesperada("un acuerdo");
  return a.version;
}

function politicaDe(c: Configuracion): "relevar" | "guardar" {
  const modo = objeto(c.politica)?.modo;
  if (modo !== "relevar" && modo !== "guardar") throw inesperada("una política");
  return modo;
}

function guiaDe(c: Configuracion): Instalacion["configuracion"]["guia"] {
  if (c.guia === null) return null;
  const g = objeto(c.guia);
  if (g?.origen === "repo") {
    if (g.procedencia !== "terminal" && g.procedencia !== "github") throw inesperada("una guía");
    if (g.commit !== null && (typeof g.commit !== "string" || !/^[0-9a-f]{40}$/.test(g.commit))) throw inesperada("una guía");
    return { origen: "repo", procedencia: g.procedencia, commit: g.commit };
  }
  if (g?.origen === "agente" && entero(g.version)) return { origen: "agente", version: g.version };
  throw inesperada("una guía");
}

export function armarInstalacion(i: {
  skill: string; terminal: string; paqueteDeLaApp: unknown; paqueteInstalado: unknown; configuracion: Configuracion;
}): Instalacion {
  return {
    version: 1,
    skill: i.skill,
    terminal: i.terminal,
    chat: { declarado: declaradoEn(i.paqueteDeLaApp), instalado: instaladoEn(i.paqueteInstalado) },
    configuracion: { acuerdo_version: acuerdoDe(i.configuracion), politica: politicaDe(i.configuracion), guia: guiaDe(i.configuracion) },
  };
}

// El orden de las claves es el de `armarInstalacion`: el mismo estado da los mismos bytes, y eso es `sin_cambios`.
export function serializar(x: Instalacion): string {
  return JSON.stringify(x, null, 2) + "\n";
}
