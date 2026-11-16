// La lectura REAL de `.supcoflow/knowledge/` (disco de verdad): sin seguir enlaces, y de punta a punta con
// `guide check` y la huella del conjunto.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { leerLaCarpeta } from "../src/comandos/carpeta-de-la-guia.ts";
import { leerArchivoChico, listarCarpetaReal } from "../src/entorno.ts";
import { huellaDeConjunto } from "../src/guia.ts";
import { NO_LEIDO } from "../src/lectura.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "supcoflow-carpeta-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const nuevo = () => { const d = path.join(TMP, `c${n++}`); mkdirSync(d, { recursive: true }); return d; };
const SEC = "## A\nWhat it's for: x\nWhat users can do: y\n";
const deps = { leerArchivoChico, listarCarpeta: listarCarpetaReal };

describe("listarCarpetaReal", () => {
  it("lista archivos, enlaces y «otros» (subcarpetas) sin seguir ninguno", () => {
    const raiz = nuevo();
    const k = path.join(raiz, ".supcoflow/knowledge");
    mkdirSync(path.join(k, "sub.md"), { recursive: true });
    writeFileSync(path.join(k, "a.md"), SEC);
    symlinkSync(path.join(k, "a.md"), path.join(k, "enlace.md"));
    const r = listarCarpetaReal(k);
    expect("entradas" in r && Object.fromEntries(r.entradas.map((e) => [e.nombre, e.tipo]))).toEqual({ "a.md": "archivo", "enlace.md": "enlace", "sub.md": "otro" });
  });
  it("no existe, o no es una carpeta: «no existe» (como un 404 de GitHub)", () => {
    const raiz = nuevo();
    expect(listarCarpetaReal(path.join(raiz, ".supcoflow/knowledge"))).toEqual({ error: NO_LEIDO.noExiste });
    mkdirSync(path.join(raiz, ".supcoflow"));
    writeFileSync(path.join(raiz, ".supcoflow/knowledge"), "x");
    expect(listarCarpetaReal(path.join(raiz, ".supcoflow/knowledge"))).toEqual({ error: NO_LEIDO.noExiste });
  });
  it("la carpeta, o `.supcoflow`, es un enlace: se rechaza (no se sigue)", () => {
    const afuera = nuevo();
    writeFileSync(path.join(afuera, "secreto.md"), "x");
    const a = nuevo();
    mkdirSync(path.join(a, ".supcoflow"));
    symlinkSync(afuera, path.join(a, ".supcoflow/knowledge"));
    expect(listarCarpetaReal(path.join(a, ".supcoflow/knowledge"))).toEqual({ error: NO_LEIDO.esUnEnlace });
    const b = nuevo();
    mkdirSync(path.join(afuera, "knowledge"), { recursive: true });
    symlinkSync(afuera, path.join(b, ".supcoflow"));
    expect(listarCarpetaReal(path.join(b, ".supcoflow/knowledge"))).toEqual({ error: NO_LEIDO.esUnEnlace });
  });
});

describe("leerLaCarpeta sobre disco real", () => {
  it("lee los documentos en orden de nombre, con su huella de conjunto, y avisa que guide.md se ignora", () => {
    const raiz = nuevo();
    mkdirSync(path.join(raiz, ".supcoflow/knowledge"), { recursive: true });
    writeFileSync(path.join(raiz, ".supcoflow/knowledge/b.md"), `﻿${SEC.replace("## A", "## B")}`);
    writeFileSync(path.join(raiz, ".supcoflow/knowledge/a.md"), SEC.replace(/\n/g, "\r\n"));
    writeFileSync(path.join(raiz, ".supcoflow/guide.md"), SEC);
    const r = leerLaCarpeta(deps, raiz);
    expect(r.tipo).toBe("carpeta");
    if (r.tipo !== "carpeta") return;
    expect(r.documentos.map((d) => d.nombre)).toEqual(["a.md", "b.md"]);
    expect(r.archivoIgnorado).toBe(true);
    // El BOM y los \r\n se CONSERVAN al leer; quitarlos es regla de la huella.
    expect(r.documentos[1]!.texto.startsWith("﻿")).toBe(true);
    expect(huellaDeConjunto(r.documentos)).toBe(huellaDeConjunto([{ nombre: "a.md", texto: SEC }, { nombre: "b.md", texto: SEC.replace("## A", "## B") }]));
  });
  it("un enlace .md y una carpeta enlazada salen como error, nunca como «sin carpeta»", () => {
    const raiz = nuevo();
    mkdirSync(path.join(raiz, ".supcoflow/knowledge"), { recursive: true });
    writeFileSync(path.join(raiz, "afuera.md"), SEC);
    symlinkSync(path.join(raiz, "afuera.md"), path.join(raiz, ".supcoflow/knowledge/x.md"));
    expect(leerLaCarpeta(deps, raiz)).toMatchObject({ tipo: "error", resultado: { json: { error: "guia_ilegible" } } });
  });
  it("una carpeta vacía o sin .md es «sin carpeta»", () => {
    const raiz = nuevo();
    mkdirSync(path.join(raiz, ".supcoflow/knowledge"), { recursive: true });
    writeFileSync(path.join(raiz, ".supcoflow/knowledge/notas.txt"), "x");
    expect(leerLaCarpeta(deps, raiz)).toEqual({ tipo: "sin_carpeta" });
  });
});
