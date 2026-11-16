// `guide check` y `guide publish` sobre la carpeta `.supcoflow/knowledge/` (guía MVP 2/3), contra el contrato del motor
// del PR 197: la carpeta rige sobre `guide.md`, un `.md` inválido se rechaza nombrándolo (nunca se omite), los topes
// valen para el conjunto, la huella es la del conjunto, y los nombres de sección repetidos se avisan sin fallar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guiaPublicar, guiaRevisar, type DepsDeGuia } from "../src/comandos/guia.ts";
import type { EntradaDeCarpeta } from "../src/comandos/carpeta-de-la-guia.ts";
import { huellaDeConjunto, MOTIVO_NOMBRE_INVALIDO, type DocumentoDeLaGuia } from "../src/guia.ts";
import { NO_LEIDO } from "../src/lectura.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const F = { repo: null, dryRun: false, fromGithub: false };
const R = (status: number, cuerpo: unknown) => ({ status, cuerpo }) as never;
const SEC = (nombre: string) => `## ${nombre}\nWhat it's for: x\nWhat users can do: y\n`;
const CARPETA = "/w/r/.supcoflow/knowledge";

type Contenido = { bytes: Uint8Array } | { error: string };
const bytes = (t: string): Contenido => ({ bytes: new TextEncoder().encode(t) });

// `entradas`: lo que hay en la carpeta (nombre → texto, o un tipo especial). `archivos`: lo demás del clon (guide.md…).
function mundo(entradas: Record<string, string | EntradaDeCarpeta["tipo"] | Contenido> | null, archivos: Record<string, Contenido> = {}, o: Partial<DepsDeGuia> = {}) {
  const pedidos: { que: string; args: unknown[] }[] = [];
  const lecturas: string[] = [];
  const d: DepsDeGuia = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    listarCarpeta: (p) => {
      if (p !== CARPETA) return { error: NO_LEIDO.noExiste };
      if (entradas === null) return { error: NO_LEIDO.noExiste };
      return { entradas: Object.entries(entradas).map(([nombre, v]) => ({ nombre, tipo: typeof v === "string" && (v === "enlace" || v === "otro") ? v : "archivo" })) };
    },
    leerArchivoChico: (p) => {
      lecturas.push(p.replace("/w/r/", ""));
      if (p.startsWith(`${CARPETA}/`)) {
        const v = entradas?.[p.slice(CARPETA.length + 1)];
        return v === undefined ? { error: NO_LEIDO.noExiste } : typeof v === "string" ? bytes(v) : "bytes" in v || "error" in v ? v : { error: NO_LEIDO.noExiste };
      }
      return archivos[p.replace("/w/r/", "")] ?? { error: NO_LEIDO.noExiste };
    },
    fetch: (async () => { throw new Error("sin red"); }) as never,
    gitDeclarado: async (args) => ({ codigo: 0, stdout: args.includes("--abbrev-ref") ? "main\n" : `${HEAD}\n` }),
    revisar: async (...args) => { pedidos.push({ que: "revisar", args }); return R(200, { ok: true, secciones: 3, documentos: 2 }); },
    publicar: async (...args) => { pedidos.push({ que: "publicar", args }); return R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 3, ruta: ".supcoflow/knowledge" }, ya_publicada: false, reemplaza: null }); },
    ver: async () => R(200, {}), elegir: async () => R(200, {}), versiones: async () => R(200, {}),
    ...o,
  };
  return { d, pedidos, lecturas };
}
const DOS = { "billing.md": SEC("Invoices"), "account.md": SEC("Profile") };

describe("guide check con la carpeta", () => {
  it("manda el conjunto en la forma del motor ({documentos:[{nombre, texto}]}), en orden de nombre, y dice cuántos documentos", async () => {
    const { d, pedidos } = mundo(DOS);
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, secciones: 3, documentos: 2, ruta: ".supcoflow/knowledge" } });
    expect(r.texto).toBe("The guide is well formed: 3 sections in 2 documents.");
    expect(pedidos[0]!.args.slice(2, 3)).toEqual(["proj_r-1"]);
    expect(pedidos[0]!.args[3]).toEqual([{ nombre: "account.md", texto: SEC("Profile") }, { nombre: "billing.md", texto: SEC("Invoices") }]);
  });
  it("la carpeta RIGE sobre guide.md: se avisa que el archivo se ignora, y su contenido no se lee", async () => {
    const { d, pedidos, lecturas } = mundo(DOS, { ".supcoflow/guide.md": bytes("## Viejo\n") });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, aviso: "archivo_ignorado_por_la_carpeta" } });
    expect(r.texto).toContain("`.supcoflow/knowledge/` governs the guide");
    expect(pedidos[0]!.args[3]).toHaveLength(2);
    // Sólo se mira que exista: con que uno esté alcanza para avisar, y ninguno se lee para el contenido.
    expect(lecturas.filter((l) => l.endsWith("guide.md") || l.endsWith("guia.md"))).toEqual([".supcoflow/guide.md"]);
  });
  it("el nombre viejo guia.md también se avisa como ignorado", async () => {
    const { d } = mundo(DOS, { ".supcoflow/guia.md": bytes("## Viejo\n") });
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 0, json: { aviso: "archivo_ignorado_por_la_carpeta" } });
  });
  it("sin carpeta, o con una carpeta sin .md, todo sigue como antes: se lee guide.md y se manda el texto", async () => {
    for (const entradas of [null, { "notas.txt": "x", "LEEME.MD": "x", sub: "otro" as const }]) {
      const { d, pedidos } = mundo(entradas, { ".supcoflow/guide.md": bytes("## A\n") });
      const r = await guiaRevisar(d, F);
      expect(r.codigo).toBe(0);
      expect(pedidos[0]!.args[3]).toBe("## A\n");
    }
  });
  it("sólo mira los .md directos: otros formatos, .MD y subcarpetas no son documentos", async () => {
    const { d, pedidos } = mundo({ "a.md": SEC("A"), "b.txt": "x", "C.MD": "x", "dir.md": "otro" });
    await guiaRevisar(d, F);
    expect((pedidos[0]!.args[3] as DocumentoDeLaGuia[]).map((x) => x.nombre)).toEqual(["a.md"]);
  });
  it("un .md de nombre inválido se RECHAZA nombrándolo: sin pedido, sin caer a guide.md, sin omitirlo", async () => {
    const largo = `${"x".repeat(201)}.md`;
    const { d, pedidos } = mundo({ "a.md": SEC("A"), [largo]: SEC("B") }, { ".supcoflow/guide.md": bytes("## Viejo\n") });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { ok: false, error: "guia_mal_armada", errores: [{ linea: 1, motivo: MOTIVO_NOMBRE_INVALIDO, documento: largo }] } });
    expect(r.texto).toContain(largo);
    expect(pedidos).toEqual([]);
  });
  it("también con un único documento de nombre inválido (el caso que el motor corrigió en la revisión)", async () => {
    const { d, pedidos } = mundo({ [`${"y".repeat(250)}.md`]: SEC("A") }, { ".supcoflow/guide.md": bytes("## Viejo\n") });
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada" } });
    expect(pedidos).toEqual([]);
  });
  it("un enlace .md no se sigue ni se omite: 3 guia_ilegible nombrándolo", async () => {
    const { d, pedidos } = mundo({ "a.md": SEC("A"), "b.md": "enlace" });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
    expect(r.texto).toContain("b.md");
    expect(pedidos).toEqual([]);
  });
  it("la carpeta misma es un enlace, o no se puede leer: 3 guia_ilegible", async () => {
    for (const error of [NO_LEIDO.esUnEnlace, NO_LEIDO.noSePudoLeer]) {
      const { d, pedidos } = mundo(DOS, {}, { listarCarpeta: () => ({ error }) });
      expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
      expect(pedidos).toEqual([]);
    }
  });
  it("más de 60 documentos, o un documento o el conjunto sobre 64 KB: 3 guia_muy_grande, sin pedido", async () => {
    const muchos = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`d${i}.md`, SEC(`S${i}`)]));
    const dos = { "a.md": "x".repeat(40 * 1024), "b.md": "x".repeat(40 * 1024) };
    for (const entradas of [muchos, dos, { "a.md": { error: NO_LEIDO.demasiadoGrande } as Contenido }]) {
      const { d, pedidos } = mundo(entradas);
      expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_muy_grande" } });
      expect(pedidos).toEqual([]);
    }
  });
  it("un documento que no es UTF-8 válido: 3 guia_ilegible nombrándolo (no se reemplaza en silencio)", async () => {
    const { d, pedidos } = mundo({ "a.md": { bytes: new Uint8Array([0x23, 0xff, 0xfe]) } });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
    expect(r.texto).toContain("a.md");
    expect(pedidos).toEqual([]);
  });
  it("422 del motor con `documento`: una línea por error, con el documento, y el JSON lo conserva; sin control ni secretos", async () => {
    const { d } = mundo(DOS, {}, { revisar: async () => R(422, { error: "guia_mal_armada", message: "x", errores: [{ linea: 4, motivo: "missing «What it's for:»", documento: "billing.md" }, { linea: 1, motivo: `esc \u001b[31m ${CLAVE}`, documento: "a\u001bb.md" }] }) });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada", errores: [{ linea: 4, documento: "billing.md" }, { linea: 1, documento: "ab.md" }] } });
    expect(r.texto).toContain(".supcoflow/knowledge is badly formed:");
    expect(r.texto).toContain("billing.md, line 4: missing «What it's for:»");
    expect(r.texto).not.toContain(CLAVE);
    expect(r.texto.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(JSON.stringify(r.json)).not.toContain(CLAVE);
  });
  it("413 del motor sobre la carpeta se dice como lo dice el motor (nombra los dos topes)", async () => {
    const { d } = mundo(DOS, {}, { revisar: async () => R(413, { error: "guia_muy_grande", message: "Los documentos de la carpeta pasan de los topes, que valen para todos juntos." }) });
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_muy_grande" } });
  });
  it("--dry-run: dice qué mandaría (documentos y bytes) y no pide nada", async () => {
    const { d, pedidos } = mundo(DOS);
    const r = await guiaRevisar(d, { ...F, dryRun: true });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, dry_run: true, ruta: ".supcoflow/knowledge" } });
    expect(r.texto).toMatch(/POST \/api\/proyectos\/proj_r-1\/guia\/revisar \(2 documents, \d+ bytes, from \.supcoflow\/knowledge\)/);
    expect(pedidos).toEqual([]);
  });
});

describe("nombres de sección repetidos entre documentos: aviso, nunca fallo", () => {
  it("el mismo nombre en dos documentos, sin importar mayúsculas ni tildes, como la búsqueda del chat", async () => {
    const { d } = mundo({ "a.md": SEC("Configuración"), "b.md": `${SEC("CONFIGURACION")}${SEC("Otra")}`, "c.md": SEC("configuración") });
    const r = await guiaRevisar(d, F);
    expect(r.codigo).toBe(0);
    expect(r.json.nombres_repetidos).toEqual([{ nombre: "Configuración", documentos: ["a.md", "b.md", "c.md"] }]);
    expect(r.texto).toContain("Warning: the section name «Configuración» is in a.md and b.md and c.md");
  });
  it("el mismo nombre dentro de UN documento no es «entre documentos»; nombres distintos tampoco", async () => {
    const { d } = mundo({ "a.md": `${SEC("Pagos")}${SEC("Pagos")}`, "b.md": SEC("Cobros") });
    const r = await guiaRevisar(d, F);
    expect(r.codigo).toBe(0);
    expect("nombres_repetidos" in r.json).toBe(false);
    expect(r.texto).not.toContain("Warning");
  });
  it("la cabecera no se confunde con una sección; el título `# ` tampoco", async () => {
    const conCabecera = (t: string) => `---\ntitle: ${t}\n---\n# ${t}\n${SEC("Datos")}`;
    const { d } = mundo({ "a.md": conCabecera("Pagos"), "b.md": conCabecera("Cobros") });
    expect((await guiaRevisar(d, F)).json.nombres_repetidos).toEqual([{ nombre: "Datos", documentos: ["a.md", "b.md"] }]);
  });
  it("si el motor rechaza la guía no se agrega el aviso (el fallo manda)", async () => {
    const { d } = mundo({ "a.md": SEC("X"), "b.md": SEC("X") }, {}, { revisar: async () => R(422, { error: "guia_mal_armada", message: "x", errores: [{ linea: 1, motivo: "m", documento: "a.md" }] }) });
    const r = await guiaRevisar(d, F);
    expect(r.codigo).toBe(3);
    expect("nombres_repetidos" in r.json).toBe(false);
  });
});

describe("guide publish con la carpeta", () => {
  it("directa: manda {documentos, commit, rama}, sin `ruta` (es la carpeta) ni `contenido`", async () => {
    const { d, pedidos } = mundo(DOS);
    const r = await guiaPublicar(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, commit_declarado: HEAD } });
    expect(pedidos[0]!.args[3]).toEqual({
      documentos: [{ nombre: "account.md", texto: SEC("Profile") }, { nombre: "billing.md", texto: SEC("Invoices") }], commit: HEAD, rama: "main",
    });
    expect(Object.keys(pedidos[0]!.args[3] as object)).not.toContain("ruta");
  });
  it("--from-github: manda la huella del CONJUNTO, y es la que el motor calcula (vectores compartidos)", async () => {
    const { casos } = JSON.parse(readFileSync(new URL("./vectores/huella-de-conjunto.json", import.meta.url), "utf8")) as { casos: { documentos: DocumentoDeLaGuia[]; huella: string }[] };
    for (const caso of casos) {
      const { d, pedidos } = mundo(Object.fromEntries(caso.documentos.map((x) => [x.nombre, x.texto])));
      await guiaPublicar(d, { ...F, fromGithub: true });
      expect(pedidos[0]!.args[3]).toEqual({ huella: caso.huella });
    }
  });
  it("--from-github: un nombre inválido se rechaza ANTES de hashear (no se publica un subconjunto)", async () => {
    const { d, pedidos } = mundo({ "a.md": SEC("A"), [`${"x".repeat(201)}.md`]: SEC("B") });
    expect(await guiaPublicar(d, { ...F, fromGithub: true })).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada" } });
    expect(pedidos).toEqual([]);
  });
  it("--from-github: la huella cambia si se renombra un documento", async () => {
    const { d, pedidos } = mundo({ "a.md": SEC("A") });
    await guiaPublicar(d, { ...F, fromGithub: true });
    const otro = mundo({ "z.md": SEC("A") });
    await guiaPublicar(otro.d, { ...F, fromGithub: true });
    expect(pedidos[0]!.args[3]).not.toEqual(otro.pedidos[0]!.args[3]);
    expect((pedidos[0]!.args[3] as { huella: string }).huella).toBe(huellaDeConjunto([{ nombre: "a.md", texto: SEC("A") }]));
  });
  it("--from-github: guia_distinta (409) sigue saliendo 5; el aviso del motor «archivo_ignorado_por_la_carpeta» se imprime", async () => {
    const a = mundo(DOS, {}, { publicar: async () => R(409, { error: "guia_distinta", rama: "main", commit: HEAD, message: "x" }) });
    expect(await guiaPublicar(a.d, { ...F, fromGithub: true })).toMatchObject({ codigo: 5, json: { error: "guia_distinta" } });
    const b = mundo(DOS, {}, { publicar: async () => R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: HEAD, secciones: 3 }, ya_publicada: false, reemplaza: null, aviso: "archivo_ignorado_por_la_carpeta" }) });
    const r = await guiaPublicar(b.d, { ...F, fromGithub: true });
    expect(r.json.aviso).toBe("archivo_ignorado_por_la_carpeta");
    expect(r.texto).toContain("governs the guide");
  });
  it("--dry-run directo: documentos y bytes, con el commit declarado; --dry-run --from-github: la huella", async () => {
    const { d, pedidos } = mundo(DOS);
    const directo = await guiaPublicar(d, { ...F, dryRun: true });
    expect(directo.texto).toMatch(/with the content \(2 documents, \d+ bytes, from \.supcoflow\/knowledge\), commit abc1234 of main declared/);
    const github = await guiaPublicar(d, { ...F, dryRun: true, fromGithub: true });
    expect(github.json).toMatchObject({ dry_run: true, huella: huellaDeConjunto([{ nombre: "account.md", texto: SEC("Profile") }, { nombre: "billing.md", texto: SEC("Invoices") }]) });
    expect(pedidos).toEqual([]);
  });
  it("también avisa los nombres de sección repetidos", async () => {
    const { d } = mundo({ "a.md": SEC("X"), "b.md": SEC("x") });
    expect((await guiaPublicar(d, F)).json.nombres_repetidos).toEqual([{ nombre: "X", documentos: ["a.md", "b.md"] }]);
  });
});
