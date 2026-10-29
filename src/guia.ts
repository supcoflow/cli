// La guía del producto que vive en el repo del cliente. Sin dependencias: sólo `node:crypto`.
import { createHash } from "node:crypto";

// El nombre canónico desde la 0.8.0; `guia.md` es el viejo y se sigue leyendo SÓLO si `guide.md` no existe.
export const RUTA_DE_LA_GUIA = ".supcoflow/guide.md";
export const RUTA_VIEJA_DE_LA_GUIA = ".supcoflow/guia.md";
export const MAX_BYTES_DE_LA_GUIA = 64 * 1024;

// La misma regla que el motor (`src/guia/formato.ts`), copiada a propósito y clavada con los vectores
// de `test/vectores/huella.json` (idénticos en los dos repos). Se normaliza antes de hashear porque un
// editor de Windows pone BOM o \r\n, y si las dos puntas hashearan distinto, `guia_distinta` sería eterno.
export function huellaDeGuia(texto: string): string {
  const normalizado = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(normalizado, "utf8").digest("hex");
}
