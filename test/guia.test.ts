import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { huellaDeGuia, MAX_BYTES_DE_LA_GUIA, RUTA_DE_LA_GUIA } from "../src/guia.ts";

// R23: el MISMO archivo de vectores vive en el motor y acá. Si la regla de una punta cambia, esta
// prueba (o la gemela del motor) se rompe en vez de volverse un `guia_distinta` eterno en producción.
const { casos } = JSON.parse(readFileSync(new URL("./vectores/huella.json", import.meta.url), "utf8")) as {
  casos: { nombre: string; texto: string; huella: string }[];
};

describe("la huella de la guía", () => {
  it("hay vectores", () => expect(casos.length).toBeGreaterThan(0));
  for (const c of casos) it(`vector: ${c.nombre}`, () => expect(huellaDeGuia(c.texto)).toBe(c.huella));
  it("las constantes", () => {
    expect(RUTA_DE_LA_GUIA).toBe(".supcoflow/guia.md");
    expect(MAX_BYTES_DE_LA_GUIA).toBe(65536);
  });
});
