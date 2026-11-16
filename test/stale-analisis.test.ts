import { describe, expect, it } from "vitest";
import { avisosDelCambio, avisosDelMapa, coincide, leerElMapa, type Cambio } from "../src/stale.ts";

const CARPETA = ".supcoflow/knowledge";
const doc = (nombre: string, sources: string[], extra = "") => ({
  nombre,
  texto: `---\ntitle: ${nombre}\nsources:\n${sources.map((s) => `  - ${s}`).join("\n")}\n---${extra}\n## A\nWhat it's for: x\nWhat users can do: y\n`,
});
const M = (c: string[]): Cambio[] => c.map((ruta) => ({ ruta, estado: "M" }));

describe("coincide: los globs de `sources`", () => {
  const casos: [string, string, boolean][] = [
    ["app/billing/**", "app/billing/invoice.ts", true],
    ["app/billing/**", "app/billing/a/b/c.ts", true],
    ["app/billing/**", "app/billingx/a.ts", false],
    ["app/billing/**", "src/app/billing/a.ts", false],
    ["app/*.ts", "app/a.ts", true],
    ["app/*.ts", "app/x/a.ts", false],
    ["**/*.test.ts", "a/b/c.test.ts", true],
    ["**/*.test.ts", "c.test.ts", true],
    ["src/{a,b}/**", "src/b/x.ts", true],
    ["src/{a,b}/**", "src/c/x.ts", false],
    ["src/{a,{b,c}}/x.ts", "src/c/x.ts", true],
    ["app/page-?.tsx", "app/page-1.tsx", true],
    ["app/page-?.tsx", "app/page-12.tsx", false],
    ["app/[ab].ts", "app/b.ts", true],
    ["app/[!ab].ts", "app/b.ts", false],
    ["app/billing", "app/billing/invoice.ts", true], // una carpeta sin `/**` vale por todo lo que tiene adentro
    ["app/billing/", "app/billing/invoice.ts", true],
    ["app/billing", "app/billing.ts", false],
    ["./app/billing/**", "app/billing/invoice.ts", true],
    ["/app/billing/**", "app/billing/invoice.ts", true],
    ["app/a.b/**", "app/axb/c.ts", false], // el punto es un punto
    ["app/(x)/**", "app/(x)/c.ts", true], // los paréntesis no son un grupo de regex
    ["App/**", "app/a.ts", false], // sensible a mayúsculas, como git
    ["app/{a/**", "app/{a/x.ts", true], // una llave sin cerrar es literal
    ["**", "cualquier/cosa.ts", true],
    ["app/facturación/**", "app/facturación/a.ts", true],
    ["app/*/", "app/billing/invoice.ts", true], // con comodines y `/` al final también es una carpeta
    ["app/billing/**/", "app/billing/a/b.ts", true],
    ["app/*/", "app/a.ts", false],
  ];
  for (const [patron, ruta, esperado] of casos) it(`${patron} ${esperado ? "coincide con" : "no coincide con"} ${ruta}`, () => expect(coincide(patron, ruta)).toBe(esperado));
});

describe("leerElMapa", () => {
  it("lee las fuentes de cada documento, en orden de nombre, con su ruta", () => {
    const m = leerElMapa(CARPETA, [doc("b.md", ["app/b/**"]), doc("a.md", ["app/a/**", "src/a/**"])]);
    expect(m.map((d) => [d.ruta, d.sources, d.errores])).toEqual([
      [`${CARPETA}/a.md`, ["app/a/**", "src/a/**"], []],
      [`${CARPETA}/b.md`, ["app/b/**"], []],
    ]);
  });
  it("una cabecera mal armada queda como errores del documento, sin fuentes parciales que engañen", () => {
    const [d] = leerElMapa(CARPETA, [{ nombre: "x.md", texto: "---\nsource: app/**\n---\n## A\n" }]);
    expect(d).toMatchObject({ ruta: `${CARPETA}/x.md`, sources: [], errores: [{ linea: 2 }] });
  });
  it("tolera BOM y \\r\\n como el motor", () => {
    const [d] = leerElMapa(CARPETA, [{ nombre: "x.md", texto: "﻿---\r\nsources: app/**\r\n---\r\n## A\r\n" }]);
    expect(d!.sources).toEqual(["app/**"]);
    expect(d!.errores).toEqual([]);
  });
});

describe("avisosDelMapa: lo que se ve sin mirar ningún cambio", () => {
  it("un mapa sano y fuentes que coinciden: nada", () => {
    const mapa = leerElMapa(CARPETA, [doc("a.md", ["app/a/**"])]);
    expect(avisosDelMapa(mapa, ["app/a/x.ts"])).toEqual([]);
  });
  it("sin carpeta o sin documentos: mapa_vacio, y dice que no hay nada que comparar", () => {
    const [a] = avisosDelMapa([], ["a.ts"]);
    expect(a).toMatchObject({ tipo: "mapa_vacio", severidad: "aviso" });
    expect(a!.mensaje).toMatch(/no documents/i);
  });
  it("documentos sin ninguna fuente: mapa_vacio (hay carpeta pero no hay mapa)", () => {
    const mapa = leerElMapa(CARPETA, [{ nombre: "a.md", texto: "## A\nWhat it's for: x\nWhat users can do: y\n" }]);
    expect(avisosDelMapa(mapa, ["a.ts"]).map((a) => a.tipo)).toEqual(["mapa_vacio"]);
  });
  it("una cabecera rota: mapa_roto por documento, con línea y motivo", () => {
    const mapa = leerElMapa(CARPETA, [doc("ok.md", ["app/a/**"]), { nombre: "roto.md", texto: "---\nsource: app/**\n---\n## A\n" }]);
    const avisos = avisosDelMapa(mapa, ["app/a/x.ts"]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: "mapa_roto", severidad: "aviso", documento: `${CARPETA}/roto.md`, errores: [{ linea: 2, motivo: "unknown header key «source» (allowed: title, summary, sources)" }] });
    expect(avisos[0]!.mensaje).toContain("line 2");
  });
  it("todo roto: mapa_roto por cada uno y además mapa_vacio (no queda mapa usable)", () => {
    const mapa = leerElMapa(CARPETA, [{ nombre: "r.md", texto: "---\nhola\n---\n## A\n" }]);
    expect(avisosDelMapa(mapa, ["a.ts"]).map((a) => a.tipo)).toEqual(["mapa_roto", "mapa_vacio"]);
  });
  it("una fuente que no coincide con ningún archivo (movido o borrado): fuente_sin_archivos, una por patrón", () => {
    const mapa = leerElMapa(CARPETA, [doc("a.md", ["app/vieja/**", "app/a/**", "src/nada.ts"])]);
    const avisos = avisosDelMapa(mapa, ["app/a/x.ts"]);
    expect(avisos.map((a) => [a.tipo, a.patron])).toEqual([["fuente_sin_archivos", "app/vieja/**"], ["fuente_sin_archivos", "src/nada.ts"]]);
    expect(avisos[0]).toMatchObject({ severidad: "aviso", documento: `${CARPETA}/a.md` });
    expect(avisos[0]!.mensaje).toMatch(/matches no file/);
  });
  it("sin la lista de archivos del repo no se afirma nada de los patrones (no se inventa)", () => {
    const mapa = leerElMapa(CARPETA, [doc("a.md", ["app/vieja/**"])]);
    expect(avisosDelMapa(mapa, null)).toEqual([]);
  });
  it("un documento sin fuentes entre otros que sí las tienen: una nota, no un aviso", () => {
    const mapa = leerElMapa(CARPETA, [doc("a.md", ["app/a/**"]), { nombre: "b.md", texto: "## B\nWhat it's for: x\nWhat users can do: y\n" }]);
    expect(avisosDelMapa(mapa, ["app/a/x.ts"])).toMatchObject([{ tipo: "documento_sin_fuentes", severidad: "nota", documento: `${CARPETA}/b.md` }]);
  });
});

describe("avisosDelCambio: los casos negativos preparados (criterios C2)", () => {
  const mapa = leerElMapa(CARPETA, [doc("billing.md", ["app/billing/**"]), doc("payments.md", ["app/payments/**"])]);

  it("actualización omitida: toqué el código y no el documento → documento_sin_tocar, con lo que toqué", () => {
    const { avisos } = avisosDelCambio(mapa, M(["app/billing/invoice.ts", "app/billing/pay.ts"]));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: "documento_sin_tocar", severidad: "aviso", documento: `${CARPETA}/billing.md`, archivos: ["app/billing/invoice.ts", "app/billing/pay.ts"], patrones: ["app/billing/**"] });
    expect(avisos[0]!.mensaje).toContain("app/billing/invoice.ts");
    expect(avisos[0]!.mensaje).toContain(`${CARPETA}/billing.md`);
  });
  it("documento equivocado: toqué payments.md pero el código es de billing → avisa por billing.md", () => {
    const { avisos } = avisosDelCambio(mapa, M(["app/billing/invoice.ts", `${CARPETA}/payments.md`]));
    expect(avisos.map((a) => [a.tipo, a.documento])).toEqual([["documento_sin_tocar", `${CARPETA}/billing.md`]]);
    expect(avisos[0]!.documentos_tocados).toEqual([`${CARPETA}/payments.md`]);
  });
  it("el documento correcto actualizado: nada que avisar", () => {
    const r = avisosDelCambio(mapa, M(["app/billing/invoice.ts", `${CARPETA}/billing.md`]));
    expect(r.avisos).toEqual([]);
    expect(r).toMatchObject({ cambiados: 1, cubiertos: 1, sin_cubrir: 0 });
  });
  it("cambio cosmético: tocar el documento sólo con espacios no cuenta → cambio_cosmetico", () => {
    const cambios: Cambio[] = [{ ruta: "app/billing/invoice.ts", estado: "M" }, { ruta: `${CARPETA}/billing.md`, estado: "M", soloEspacios: true }];
    const { avisos } = avisosDelCambio(mapa, cambios);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: "cambio_cosmetico", severidad: "aviso", documento: `${CARPETA}/billing.md` });
  });
  it("el límite que se dice y no se promete: un texto equivocado pero distinto de los espacios deja el detector en verde", () => {
    // Sin IA no se sabe si el texto es verdadero o suficiente: sólo la estructura (qué se tocó y qué no).
    expect(avisosDelCambio(mapa, M(["app/billing/invoice.ts", `${CARPETA}/billing.md`])).avisos).toEqual([]);
  });
  it("función nueva fuera del mapa: un archivo AGREGADO que ninguna fuente cubre → fuera_del_mapa (nota)", () => {
    const r = avisosDelCambio(mapa, [{ ruta: "app/reports/page.tsx", estado: "A" }, { ruta: "app/reports/chart.tsx", estado: "A" }]);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ tipo: "fuera_del_mapa", severidad: "nota", archivos: ["app/reports/chart.tsx", "app/reports/page.tsx"] });
    expect(r).toMatchObject({ cambiados: 2, cubiertos: 0, sin_cubrir: 2 });
  });
  it("un archivo modificado fuera del mapa no avisa (sería ruido: tests, configs), pero cuenta como sin cubrir", () => {
    const r = avisosDelCambio(mapa, M(["package.json", "README.md"]));
    expect(r.avisos).toEqual([]);
    expect(r).toMatchObject({ cambiados: 2, sin_cubrir: 2 });
  });
  it("archivo movido o borrado: el viejo camino cuenta como cambio del código que el documento explicaba", () => {
    const { avisos } = avisosDelCambio(mapa, [{ ruta: "app/billing/invoice.ts", estado: "D" }, { ruta: "app/invoices/invoice.ts", estado: "A" }]);
    expect(avisos.map((a) => a.tipo)).toEqual(["documento_sin_tocar", "fuera_del_mapa"]);
    expect(avisos[0]!.mensaje).toMatch(/deleted|removed|moved/);
  });
  it("lo de .supcoflow/ no es código del producto: no dispara nada ni cuenta", () => {
    const r = avisosDelCambio(mapa, [{ ruta: ".supcoflow/guide.md", estado: "A" }, { ruta: `${CARPETA}/nuevo.md`, estado: "A" }, { ruta: ".supcoflow/proyecto.json", estado: "M" }]);
    expect(r).toMatchObject({ avisos: [], cambiados: 0 });
  });
  it("un archivo que explican dos documentos avisa por el que no se tocó", () => {
    const dos = leerElMapa(CARPETA, [doc("a.md", ["app/**"]), doc("b.md", ["app/shared/**"])]);
    const { avisos } = avisosDelCambio(dos, M(["app/shared/x.ts", `${CARPETA}/a.md`]));
    expect(avisos.map((a) => a.documento)).toEqual([`${CARPETA}/b.md`]);
  });
  it("un documento roto se saltea (ya lo dice mapa_roto) y no inventa avisos", () => {
    const roto = leerElMapa(CARPETA, [{ nombre: "r.md", texto: "---\nhola\n---\n## A\n" }]);
    expect(avisosDelCambio(roto, M(["app/a.ts"])).avisos).toEqual([]);
  });
  it("el orden de los avisos es estable: por documento y después los de fuera del mapa", () => {
    const { avisos } = avisosDelCambio(mapa, [{ ruta: "app/payments/p.ts", estado: "M" }, { ruta: "app/billing/b.ts", estado: "M" }, { ruta: "x/nuevo.ts", estado: "A" }]);
    expect(avisos.map((a) => a.documento ?? a.tipo)).toEqual([`${CARPETA}/billing.md`, `${CARPETA}/payments.md`, "fuera_del_mapa"]);
  });
});

describe("avisosDelCambio: la cobertura que el cambio quitó (el mapa de la base)", () => {
  const base = leerElMapa(CARPETA, [doc("billing.md", ["app/billing/**"]), doc("payments.md", ["app/payments/**"])]);

  it("borró el documento y tocó su código → cobertura_quitada (aviso), aunque el mapa de ahora no lo cubra", () => {
    const ahora = leerElMapa(CARPETA, [doc("payments.md", ["app/payments/**"])]);
    const r = avisosDelCambio(ahora, [{ ruta: "app/billing/invoice.ts", estado: "M" }, { ruta: `${CARPETA}/billing.md`, estado: "D" }], base);
    expect(r.avisos).toMatchObject([{ tipo: "cobertura_quitada", severidad: "aviso", documento: `${CARPETA}/billing.md`, patrones: ["app/billing/**"], archivos: ["app/billing/invoice.ts"] }]);
    expect(r.avisos[0]!.mensaje).toContain("You deleted");
    expect(r.avisos[0]!.mensaje).toContain("which no document covers now");
  });
  it("quitó el patrón de `sources` y tocó su código → cobertura_quitada (aviso)", () => {
    const ahora = leerElMapa(CARPETA, [doc("billing.md", ["app/other/**"]), doc("payments.md", ["app/payments/**"])]);
    const r = avisosDelCambio(ahora, M(["app/billing/invoice.ts", `${CARPETA}/billing.md`]), base);
    expect(r.avisos).toMatchObject([{ tipo: "cobertura_quitada", severidad: "aviso", documento: `${CARPETA}/billing.md`, patrones: ["app/billing/**"], archivos: ["app/billing/invoice.ts"] }]);
    expect(r.avisos[0]!.mensaje).toContain("You removed");
  });
  it("quitó cobertura sin tocar ese código → nada (no afirma nada de código que el cambio no tocó)", () => {
    const ahora = leerElMapa(CARPETA, [doc("payments.md", ["app/payments/**"])]);
    const r = avisosDelCambio(ahora, [{ ruta: `${CARPETA}/billing.md`, estado: "D" }], base);
    expect(r.avisos).toEqual([]);
  });
  it("borró un documento cuyo código otro documento más amplio sigue cubriendo → no es cobertura quitada", () => {
    const conAmplio = leerElMapa(CARPETA, [doc("billing.md", ["app/billing/**"]), doc("overview.md", ["app/**"])]);
    const ahora = leerElMapa(CARPETA, [doc("overview.md", ["app/**"])]);
    const r = avisosDelCambio(ahora, [{ ruta: `${CARPETA}/billing.md`, estado: "D" }, { ruta: "app/billing/invoice.ts", estado: "M" }], conAmplio);
    expect(r.avisos.map((a) => a.tipo)).not.toContain("cobertura_quitada");
  });
  it("una cabecera rota ahora no es «cobertura quitada» (ya lo dice mapa_roto)", () => {
    const ahora = leerElMapa(CARPETA, [{ nombre: "billing.md", texto: "---\ntitle: billing\nsources: [app/billing/**\n---\n## A\n" }, doc("payments.md", ["app/payments/**"])]);
    expect(ahora[0]!.errores.length).toBeGreaterThan(0);
    const r = avisosDelCambio(ahora, M(["app/billing/invoice.ts", `${CARPETA}/billing.md`]), base);
    expect(r.avisos.map((a) => a.tipo)).not.toContain("cobertura_quitada");
  });
  it("un patrón movido a otro documento (o un documento renombrado) no quita cobertura", () => {
    const ahora = leerElMapa(CARPETA, [doc("cobros.md", ["app/billing/**"]), doc("payments.md", ["app/payments/**"])]);
    const r = avisosDelCambio(ahora, [{ ruta: "app/billing/invoice.ts", estado: "M" }, { ruta: `${CARPETA}/billing.md`, estado: "D" }, { ruta: `${CARPETA}/cobros.md`, estado: "A" }], base);
    expect(r.avisos).toEqual([]);
  });
  it("un patrón reescrito que todavía cubre el código tocado: no es un aviso", () => {
    const ahora = leerElMapa(CARPETA, [doc("billing.md", ["app/billing"]), doc("payments.md", ["app/payments/**"])]);
    const r = avisosDelCambio(ahora, M(["app/billing/invoice.ts", `${CARPETA}/billing.md`]), base);
    expect(r.avisos).toEqual([]);
  });
});
