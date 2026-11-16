// src/comandos/carpeta-de-la-guia.ts
// Lee la carpeta `.supcoflow/knowledge/` del clon (guía MVP 2/3) con la MISMA regla que el motor cuando la lee de GitHub
// (PR 197, `leer-del-repo.ts`): si la carpeta tiene al menos un `.md` directo, la guía es ese conjunto y rige sobre
// `guide.md`/`guia.md`; si no, todo sigue como antes. Un `.md` de nombre inválido se RECHAZA nombrándolo (nunca se omite
// en silencio y nunca se cae al archivo viejo por eso); otros formatos (`.txt`, `.MD`) y las subcarpetas no se miran.
// La terminal NO juzga el contenido de los documentos: eso lo hace el parser del motor.
import path from "node:path";
import { SALIDA, type Resultado } from "../contrato.ts";
import {
  erroresDeNombres, esCandidatoDeDocumento, lineasDeLaGuia, MAX_BYTES_DE_LA_GUIA, MAX_DOCUMENTOS, ordenarDocumentos,
  RUTA_DE_LA_CARPETA, RUTA_DE_LA_GUIA, RUTA_VIEJA_DE_LA_GUIA, type DocumentoDeLaGuia, type ErrorDeDocumento,
} from "../guia.ts";
import { leerCabecera } from "../cabecera.ts";
import { NO_LEIDO } from "../lectura.ts";
import { cadena, limpio } from "../limpio.ts";

export type EntradaDeCarpeta = { nombre: string; tipo: "archivo" | "enlace" | "otro" };
export type DepsDeCarpeta = {
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  /** Las entradas DIRECTAS de una carpeta, sin seguir enlaces (ni el de la carpeta). Un error trae el motivo (`NO_LEIDO`). */
  listarCarpeta(p: string): { entradas: EntradaDeCarpeta[] } | { error: string };
};

export type LecturaDeLaCarpeta =
  | { tipo: "sin_carpeta" }
  | { tipo: "carpeta"; documentos: DocumentoDeLaGuia[]; archivoIgnorado: boolean }
  | { tipo: "error"; resultado: Resultado };

const fallo = (error: string, message: string, extra: Record<string, unknown> = {}): Resultado =>
  ({ codigo: SALIDA.entradaInvalida, json: { ok: false, error, message, ...extra }, texto: message });

/** El error de `guia_mal_armada` con un `documento` por línea, como lo contesta el motor (422): JSON y texto de lo mismo. */
export function errorDeDocumentos(errores: readonly { linea?: unknown; motivo?: unknown; documento?: unknown }[], ruta: string): Resultado {
  const lineas = errores.map((x) => {
    const donde = typeof x.documento === "string" ? `${limpio(x.documento)}, ` : "";
    return `${donde}line ${typeof x.linea === "number" ? x.linea : "?"}: ${cadena(x.motivo)}`;
  });
  const message = [`${ruta} is badly formed:`, ...lineas].join("\n");
  const json = errores.map((x) => ({
    linea: x.linea ?? null, motivo: limpio(typeof x.motivo === "string" ? x.motivo : ""), ...(typeof x.documento === "string" ? { documento: limpio(x.documento) } : {}),
  }));
  return { codigo: SALIDA.entradaInvalida, json: { ok: false, error: "guia_mal_armada", message: limpio(message), errores: json }, texto: message };
}

export function leerLaCarpeta(d: DepsDeCarpeta, raiz: string): LecturaDeLaCarpeta {
  const carpeta = path.join(raiz, RUTA_DE_LA_CARPETA);
  const listado = d.listarCarpeta(carpeta);
  if ("error" in listado) {
    if (listado.error === NO_LEIDO.noExiste) return { tipo: "sin_carpeta" };
    return { tipo: "error", resultado: fallo("guia_ilegible", `I can't read ${RUTA_DE_LA_CARPETA}: ${limpio(listado.error)}.`) };
  }
  const candidatos = listado.entradas.filter((e) => esCandidatoDeDocumento(e.nombre) && e.tipo !== "otro");
  // Un enlace que se llama `.md` no es un archivo para el motor (GitHub lo lista como otro tipo) y la terminal no lo
  // sigue: se dice cuál es en vez de omitirlo (la guía que se subiría no sería la carpeta que ve la persona).
  const enlace = candidatos.find((e) => e.tipo === "enlace");
  if (enlace !== undefined) {
    return { tipo: "error", resultado: fallo("guia_ilegible", `I can't read ${RUTA_DE_LA_CARPETA}/${limpio(enlace.nombre)}: ${NO_LEIDO.esUnEnlace}. Replace it with the file itself.`) };
  }
  if (candidatos.length === 0) return { tipo: "sin_carpeta" };
  if (candidatos.length > MAX_DOCUMENTOS) {
    return { tipo: "error", resultado: fallo("guia_muy_grande", `${RUTA_DE_LA_CARPETA} has more than ${MAX_DOCUMENTOS} documents: the limits (${MAX_BYTES_DE_LA_GUIA / 1024} KB and ${MAX_DOCUMENTOS} documents) count for all of them together. Shorten or merge them.`) };
  }
  const nombres = candidatos.map((e) => e.nombre);
  const invalidos = erroresDeNombres(nombres);
  if (invalidos.length > 0) return { tipo: "error", resultado: errorDeDocumentos(invalidos, RUTA_DE_LA_CARPETA) };

  const documentos: DocumentoDeLaGuia[] = [];
  let bytes = 0;
  const enOrden: string[] = ordenarDocumentos(nombres.map((n) => ({ nombre: n }))).map((x) => x.nombre);
  for (const nombre of enOrden) {
    const leido = d.leerArchivoChico(path.join(carpeta, nombre), MAX_BYTES_DE_LA_GUIA);
    if ("error" in leido) {
      if (leido.error === NO_LEIDO.demasiadoGrande) return { tipo: "error", resultado: fallo("guia_muy_grande", `${RUTA_DE_LA_CARPETA}/${limpio(nombre)} is over ${MAX_BYTES_DE_LA_GUIA / 1024} KB, and the limit counts for all the documents together: shorten it.`) };
      return { tipo: "error", resultado: fallo("guia_ilegible", `I can't read ${RUTA_DE_LA_CARPETA}/${limpio(nombre)}: ${limpio(leido.error)}.`) };
    }
    bytes += leido.bytes.length;
    if (bytes > MAX_BYTES_DE_LA_GUIA) {
      return { tipo: "error", resultado: fallo("guia_muy_grande", `The documents of ${RUTA_DE_LA_CARPETA} are over ${MAX_BYTES_DE_LA_GUIA / 1024} KB in total (the limit counts for all of them together): shorten them.`) };
    }
    try {
      // ignoreBOM: el BOM se CONSERVA (quitarlo es regla de la huella). fatal: un byte inválido no se reemplaza en silencio,
      // porque la huella de GitHub no coincidiría nunca.
      documentos.push({ nombre, texto: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(leido.bytes) });
    } catch {
      return { tipo: "error", resultado: fallo("guia_ilegible", `${RUTA_DE_LA_CARPETA}/${limpio(nombre)} isn't valid UTF-8.`) };
    }
  }
  // Sólo se mira si están, para avisar que la carpeta los tapa (quien migra de archivo a carpeta no debe descubrir en
  // silencio que su `guide.md` dejó de regir): su contenido no se lee.
  const hay = (ruta: string) => {
    const r = d.leerArchivoChico(path.join(raiz, ruta), 1);
    return !("error" in r) || r.error !== NO_LEIDO.noExiste;
  };
  return { tipo: "carpeta", documentos, archivoIgnorado: hay(RUTA_DE_LA_GUIA) || hay(RUTA_VIEJA_DE_LA_GUIA) };
}

// ─── Nombres de sección repetidos entre documentos ───
// El chat busca una sección por su nombre y toma las primeras tres coincidencias (`buscar-seccion` del sdk), así que dos
// documentos con una sección que se llama igual hacen que una quede fuera de esa búsqueda. No es un error (ya era posible
// en un solo archivo): se avisa. Se compara como la búsqueda del chat: sin mayúsculas ni tildes.
const claveDeNombre = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Los nombres de las secciones (`## Nombre`) de un documento, como los ve el motor: después de la cabecera. */
export function nombresDeSecciones(texto: string): string[] {
  const lineas = lineasDeLaGuia(texto);
  return lineas.slice(leerCabecera(lineas).hasta).map((l) => l.trim()).filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
}

export type NombreRepetido = { nombre: string; documentos: string[] };
export function nombresRepetidos(documentos: readonly DocumentoDeLaGuia[]): NombreRepetido[] {
  const porClave = new Map<string, { nombre: string; documentos: Set<string> }>();
  for (const d of ordenarDocumentos(documentos)) {
    for (const nombre of nombresDeSecciones(d.texto)) {
      const k = claveDeNombre(nombre);
      const e = porClave.get(k) ?? { nombre, documentos: new Set<string>() };
      e.documentos.add(d.nombre);
      porClave.set(k, e);
    }
  }
  return [...porClave.values()].filter((e) => e.documentos.size > 1).map((e) => ({ nombre: e.nombre, documentos: [...e.documentos] }));
}
