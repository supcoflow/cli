// La guía del producto que vive en el repo del cliente. Sin dependencias: sólo `node:crypto`.
import { createHash } from "node:crypto";

// El nombre canónico desde la 0.8.0; `guia.md` es el viejo y se sigue leyendo SÓLO si `guide.md` no existe.
export const RUTA_DE_LA_GUIA = ".supcoflow/guide.md";
export const RUTA_VIEJA_DE_LA_GUIA = ".supcoflow/guia.md";
export const MAX_BYTES_DE_LA_GUIA = 64 * 1024;

// La misma regla que el motor (`src/guia/formato.ts`), copiada a propósito y clavada con los vectores
// de `test/vectores/huella.json` (idénticos en los dos repos). Se normaliza antes de hashear porque un
// editor de Windows pone BOM o \r\n, y si las dos puntas hashearan distinto, `guia_distinta` sería eterno.
export function normalizarGuia(texto: string): string {
  return texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}
export function huellaDeGuia(texto: string): string {
  return createHash("sha256").update(normalizarGuia(texto), "utf8").digest("hex");
}

// Los caracteres de control que el motor saca del texto antes de leerlo (lo que cuenta como «línea» para él).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
/** Las líneas de un documento tal como las lee el motor: normalizado y sin control. De ahí salen la cabecera y las secciones. */
export const lineasDeLaGuia = (texto: string): string[] => normalizarGuia(texto).replace(CONTROL, "").split("\n");

// ─── La carpeta `.supcoflow/knowledge/` (guía MVP 2/3) ───
// La regla del motor (`src/guia/conjunto.ts`, PR 197), copiada a propósito y clavada con los vectores de
// `test/vectores/huella-de-conjunto.json` y `motivos-de-la-carpeta.json` (idénticos en los dos repos). Si una punta
// cambia, la prueba gemela se rompe en vez de volverse un `guia_distinta` eterno con `publish --from-github`.
export const RUTA_DE_LA_CARPETA = ".supcoflow/knowledge";
/** Un documento por sección como mínimo, y las secciones son a lo sumo 60: los topes valen para el CONJUNTO. */
export const MAX_DOCUMENTOS = 60;
const MAX_LARGO_DE_NOMBRE = 200;
const MAX_ERRORES = 20;

/** Un documento de la carpeta: el nombre del archivo (sin la carpeta) y su texto tal cual. */
export type DocumentoDeLaGuia = { nombre: string; texto: string };
export type ErrorDeDocumento = { linea: number; motivo: string; documento: string };

/** Un `.md` directo de la carpeta: sin barras (no se mira adentro de subcarpetas) ni caracteres de control. */
export function esNombreDeDocumento(nombre: string): boolean {
  return nombre.length <= MAX_LARGO_DE_NOMBRE && /^[^/\\\p{Cc}\p{Cf}]+\.md$/u.test(nombre);
}

/**
 * «Es un `.md` de la carpeta que corresponde revisar»: cualquier archivo directo que termine en `.md`. Es DISTINTO de
 * `esNombreDeDocumento` («su nombre es admisible») a propósito, como en el motor: un `.md` de nombre inválido se
 * RECHAZA nombrándolo, nunca se omite en silencio. `.MD`, `.txt` y las subcarpetas no son candidatos.
 */
export const esCandidatoDeDocumento = (nombre: string): boolean => nombre.endsWith(".md");

export const MOTIVO_NOMBRE_INVALIDO = "the document name isn't a valid .md file name";

/** El orden de la guía: por nombre, comparando unidades de código UTF-16 (nunca `localeCompare`: no depende del idioma). */
export function ordenarDocumentos<T extends { nombre: string }>(documentos: readonly T[]): T[] {
  return [...documentos].sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
}

/** Un error por cada nombre inválido, nombrando el archivo y en orden de nombre. */
export function erroresDeNombres(nombres: readonly string[]): ErrorDeDocumento[] {
  return ordenarDocumentos(nombres.map((nombre) => ({ nombre })))
    .filter((d) => !esNombreDeDocumento(d.nombre))
    .map((d) => ({ linea: 1, motivo: MOTIVO_NOMBRE_INVALIDO, documento: d.nombre }))
    .slice(0, MAX_ERRORES);
}

/**
 * La huella del conjunto: SHA-256 de, por cada documento en orden de nombre, `<nombre>\n<huellaDeGuia(texto)>\n`. Cubre
 * los nombres Y los contenidos (renombrar un documento es otra versión). Un nombre no puede tener salto de línea, así
 * que la concatenación no es ambigua.
 */
export function huellaDeConjunto(documentos: readonly DocumentoDeLaGuia[]): string {
  const base = ordenarDocumentos(documentos).map((d) => `${d.nombre}\n${huellaDeGuia(d.texto)}\n`).join("");
  return createHash("sha256").update(base, "utf8").digest("hex");
}
