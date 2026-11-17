import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerCabecera } from "../src/cabecera.ts";
import { erroresDeNombres } from "../src/guia.ts";

// Los casos son los de `src/guia/cabecera.test.ts` del motor (PR 197): la terminal lee las MISMAS cabeceras que el
// motor y no puede entender menos ni más. Lo que el motor rechaza, el detector `stale` lo avisa como «mapa roto».
const lineas = (t: string) => t.split("\n");

describe("leerCabecera (copia declarada de la del motor)", () => {
  it("sin cabecera: hasta = 0 y nada que reportar", () => {
    expect(leerCabecera(lineas("# Título\n## A"))).toEqual({ hasta: 0, errores: [] });
    expect(leerCabecera(lineas(""))).toEqual({ hasta: 0, errores: [] });
  });
  it("lee title, summary y sources en lista; `hasta` es la línea que sigue al cierre", () => {
    expect(leerCabecera(lineas("---\ntitle: Billing\nsummary: Invoices and refunds.\nsources:\n  - app/billing/**\n  - src/billing/**\n---\n## A"))).toEqual({
      cabecera: { title: "Billing", summary: "Invoices and refunds.", sources: ["app/billing/**", "src/billing/**"] },
      hasta: 7, errores: [],
    });
  });
  it("acepta líneas en blanco antes de la apertura, sources en una línea, comillas y una sola fuente suelta", () => {
    expect(leerCabecera(lineas('\n\n---\ntitle: "Billing: all"\nsources: [app/a/**, "src/b/**"]\n---\n'))).toMatchObject({
      cabecera: { title: "Billing: all", sources: ["app/a/**", "src/b/**"] }, errores: [],
    });
    expect(leerCabecera(lineas("---\nsources: app/a/**\n---")).cabecera?.sources).toEqual(["app/a/**"]);
    expect(leerCabecera(lineas('---\nsources: [src/{a,b}/**, "x, y", c]\n---')).cabecera?.sources).toEqual(["src/{a,b}/**", "x, y", "c"]);
    expect(leerCabecera(lineas("---\nsources: [docs/don't/**, app/**]\n---")).cabecera?.sources).toEqual(["docs/don't/**", "app/**"]);
    expect(leerCabecera(lineas("---\nsources: []\n---")).cabecera?.sources).toEqual([]);
  });
  it("una cabecera vacía es válida: sin título, sin resumen, sin fuentes", () => {
    expect(leerCabecera(lineas("---\n---"))).toEqual({ cabecera: { sources: [] }, hasta: 2, errores: [] });
  });
  it("sin cerrar: un error en la línea de la apertura, y se come el resto", () => {
    const r = leerCabecera(lineas("---\ntitle: x\n## A"));
    expect(r.errores).toEqual([{ linea: 1, motivo: "the header opened with --- is never closed" }]);
    expect(r.hasta).toBe(3);
  });
  it.each([
    ["una línea que no es clave: valor", "---\nhola\n---", 2, "the header lines are «key: value» (title, summary, sources)"],
    ["una clave desconocida (la errata `source`)", "---\nsource: app/**\n---", 2, "unknown header key «source» (allowed: title, summary, sources)"],
    ["una clave repetida", "---\ntitle: a\ntitle: b\n---", 3, "the header key «title» is repeated"],
    ["un título vacío", "---\ntitle:\n---", 2, "the header key «title» is empty"],
    ["un resumen de 601", `---\nsummary: ${"s".repeat(601)}\n---`, 2, "the header key «summary» is over 600 characters"],
    ["un título de 121", `---\ntitle: ${"t".repeat(121)}\n---`, 2, "the header key «title» is over 120 characters"],
    ["una fuente vacía", "---\nsources:\n  - \n---", 3, "a «sources» entry is empty"],
    ["una comilla sin cerrar en la lista en línea", '---\nsources: ["app/**, src/**]\n---', 2, "a «sources» entry opens a quote it never closes"],
    ["una comilla sin cerrar en el valor solo", "---\nsources: 'app/**\n---", 2, "a «sources» entry opens a quote it never closes"],
    ["una comilla sin cerrar en la lista en bloque", '---\nsources:\n  - "app/**\n---', 3, "a «sources» entry opens a quote it never closes"],
    ["una lista en línea sin cerrar", "---\nsources: [app/**, src/**\n---", 2, "the «sources» list opened with [ is never closed"],
    ["una fuente de 201", `---\nsources: [${"a".repeat(201)}]\n---`, 2, "a «sources» entry is over 200 characters"],
    ["51 fuentes", `---\nsources:\n${"  - a/**\n".repeat(51)}---`, 2, "at most 50 «sources» per document"],
  ])("%s → error con su línea", (_n, texto, linea, motivo) => {
    expect(leerCabecera(lineas(texto)).errores[0]).toEqual({ linea, motivo });
  });
});

// El corpus de `motivo` que el motor publica para la carpeta (`vectores/motivos-de-la-carpeta.json`): ni la terminal
// dice un motivo que el motor no conoce, ni el motor suma uno que esta copia no revisó.
describe("el corpus de motivos de la carpeta (vectores compartidos con el motor)", () => {
  const corpus = JSON.parse(readFileSync(new URL("./vectores/motivos-de-la-carpeta.json", import.meta.url), "utf8")) as string[];
  const plantilla = (m: string) =>
    m
      .replace(/^(unknown header key «)[^»]+(».*)$/, "$1…$2")
      .replace(/^(the header key «)[^»]+(» is (?:empty|repeated))$/, "$1…$2")
      .replace(/^(the header key «)[^»]+(» is over )\d+( characters)$/, "$1…$2…$3");
  const casos = [
    "---\nhola\n---", "---\nsource: a\n---", "---\ntitle: a\ntitle: b\n---", "---\ntitle:\n---", `---\ntitle: ${"t".repeat(121)}\n---`,
    "---\nsources:\n  - \n---", '---\nsources: ["app/**]\n---', "---\nsources: [app/**\n---", `---\nsources: [${"a".repeat(201)}]\n---`,
    `---\nsources:\n${"  - a\n".repeat(51)}---`, "---\ntitle: x\n",
  ];
  const nuestros = new Set([
    ...casos.flatMap((c) => leerCabecera(lineas(c)).errores.map((e) => plantilla(e.motivo))),
    ...erroresDeNombres(["sin-extension.md/x"]).map((e) => e.motivo),
  ]);
  // Los que el motor dice al juntar el conjunto (no al leer una cabecera) y que la terminal deja al motor: nunca los
  // calcula, pero si llegan en una respuesta se imprimen tal cual.
  const SOLO_DEL_MOTOR = [
    "the folder has more than 60 sections in total (all the documents count together)",
    "the folder has no documents",
    "two documents have the same name",
  ];

  it("cada motivo que sale de esta copia está en el corpus del motor", () => {
    for (const m of nuestros) expect(corpus, m).toContain(m);
  });
  it("el corpus no tiene nada más que lo de esta copia y lo que es sólo del motor (ni uno de más ni de menos)", () => {
    expect([...nuestros, ...SOLO_DEL_MOTOR].sort()).toEqual([...corpus]);
  });
});
