import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  erroresDeNombres, esCandidatoDeDocumento, esNombreDeDocumento, huellaDeConjunto, MAX_DOCUMENTOS, MOTIVO_NOMBRE_INVALIDO,
  ordenarDocumentos, RUTA_DE_LA_CARPETA, type DocumentoDeLaGuia,
} from "../src/guia.ts";

// Los MISMOS vectores que el motor (`src/guia/vectores/huella-de-conjunto.json`, PR 197): si la regla de una punta
// cambia, esta prueba (o la gemela del motor) se rompe en vez de volverse un `guia_distinta` eterno al publicar con
// `--from-github`.
const { casos } = JSON.parse(readFileSync(new URL("./vectores/huella-de-conjunto.json", import.meta.url), "utf8")) as {
  casos: { nombre: string; documentos: DocumentoDeLaGuia[]; huella: string }[];
};

describe("la huella del conjunto (vectores compartidos con el motor)", () => {
  it("hay vectores", () => expect(casos.length).toBe(7));
  for (const c of casos) it(`vector: ${c.nombre}`, () => expect(huellaDeConjunto(c.documentos)).toBe(c.huella));
  it("renombrar un documento cambia la huella aunque el texto no cambie", () => {
    const [a, b] = [casos[1]!, casos[4]!];
    expect(huellaDeConjunto(a.documentos)).not.toBe(huellaDeConjunto(b.documentos));
  });
  it("el orden es por unidades de código UTF-16, no por idioma: «B» antes que «a»", () => {
    expect(ordenarDocumentos([{ nombre: "a.md" }, { nombre: "B.md" }, { nombre: "Z.md" }]).map((d) => d.nombre)).toEqual(["B.md", "Z.md", "a.md"]);
  });
});

describe("qué es un documento de la carpeta (la misma regla que el motor)", () => {
  it("la carpeta y los topes", () => {
    expect(RUTA_DE_LA_CARPETA).toBe(".supcoflow/knowledge");
    expect(MAX_DOCUMENTOS).toBe(60);
  });
  it("candidato: cualquier nombre que termina en .md; otros formatos no", () => {
    expect(esCandidatoDeDocumento("a.md")).toBe(true);
    expect(esCandidatoDeDocumento(`${"x".repeat(300)}.md`)).toBe(true); // candidato, pero NO admisible: se rechaza, no se omite
    expect(esCandidatoDeDocumento("a.MD")).toBe(false);
    expect(esCandidatoDeDocumento("a.txt")).toBe(false);
    expect(esCandidatoDeDocumento("a.md.bak")).toBe(false);
  });
  it("admisible: .md sin barras ni caracteres de control, hasta 200", () => {
    expect(esNombreDeDocumento("facturación.md")).toBe(true);
    expect(esNombreDeDocumento(`${"x".repeat(197)}.md`)).toBe(true);
    expect(esNombreDeDocumento(`${"x".repeat(198)}.md`)).toBe(false);
    for (const malo of ["a/b.md", "a\\b.md", "a\nb.md", "a\u0000b.md", "a‮b.md", ".md.txt", "sin-extension"]) expect(esNombreDeDocumento(malo), malo).toBe(false);
  });
  it("un error por cada nombre inválido, nombrando el archivo, en orden de nombre y con el tope de 20", () => {
    const largo = `${"x".repeat(201)}.md`;
    expect(erroresDeNombres(["b\nb.md", "a.md", largo])).toEqual([
      { linea: 1, motivo: MOTIVO_NOMBRE_INVALIDO, documento: "b\nb.md" },
      { linea: 1, motivo: MOTIVO_NOMBRE_INVALIDO, documento: largo },
    ]);
    expect(erroresDeNombres(Array.from({ length: 30 }, (_, i) => `n${i}/.md`))).toHaveLength(20);
    expect(MOTIVO_NOMBRE_INVALIDO).toBe("the document name isn't a valid .md file name");
  });
});
