// `guide stale` contra repos de git de verdad (en carpetas temporales): los casos negativos preparados de los criterios
// del piloto (C2): actualización omitida, documento equivocado, cambio cosmético, función nueva fuera del mapa, archivo
// movido o borrado, mapa roto y base ausente. Sin IA, sin red y sin motor: sólo git y el disco.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { guiaStale, type DepsDeStale } from "../src/comandos/guia-stale.ts";
import { gitDeLecturas, leerArchivoChico, listarCarpetaReal } from "../src/entorno.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "supcoflow-stale-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const ENTORNO = {
  ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENTORNO, stdio: ["ignore", "pipe", "pipe"] }).toString();
const escribir = (raiz: string, ruta: string, texto: string) => {
  mkdirSync(path.dirname(path.join(raiz, ruta)), { recursive: true });
  writeFileSync(path.join(raiz, ruta), texto);
};
const commit = (raiz: string, mensaje: string) => { git(raiz, "add", "-A"); git(raiz, "commit", "-q", "-m", mensaje); };

const DOC = (titulo: string, sources: string[], cuerpo = "Shows the invoices.") =>
  `---\ntitle: ${titulo}\nsources:\n${sources.map((s) => `  - ${s}`).join("\n")}\n---\n## ${titulo}\nWhat it's for: ${cuerpo}\nWhat users can do: Read them.\n`;
const K = ".supcoflow/knowledge";

let n = 0;
/** Un repo con main (código y dos documentos con su mapa) y la rama `feature` encima, listo para tocar. */
function repo(o: { documentos?: Record<string, string> | null } = {}): { raiz: string; deps: DepsDeStale } {
  const raiz = path.join(TMP, `r${n++}`);
  mkdirSync(raiz);
  git(raiz, "init", "-q", "-b", "main");
  escribir(raiz, "app/billing/invoice.ts", "export const a = 1;\n");
  escribir(raiz, "app/payments/pay.ts", "export const b = 1;\n");
  escribir(raiz, "README.md", "# app\n");
  const documentos = o.documentos === undefined
    ? { "billing.md": DOC("Billing", ["app/billing/**"]), "payments.md": DOC("Payments", ["app/payments/**"]) }
    : o.documentos;
  for (const [nombre, texto] of Object.entries(documentos ?? {})) escribir(raiz, `${K}/${nombre}`, texto);
  commit(raiz, "base");
  git(raiz, "checkout", "-q", "-b", "feature");
  return { raiz, deps: { git: gitDeLecturas, cwd: raiz, leerArchivoChico, listarCarpeta: listarCarpetaReal } };
}
const tipos = (r: { json: Record<string, unknown> }) => (r.json.avisos as { tipo: string }[]).map((a) => a.tipo);
const notas = (r: { json: Record<string, unknown> }) => (r.json.notas as { tipo: string }[]).map((a) => a.tipo);
const F = { base: "main", strict: false };

describe("guide stale: los casos preparados", () => {
  it("actualización omitida: tocó el código y no el documento → avisa con el archivo, el documento y qué hacer; sale 0", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const r = await guiaStale(deps, F);
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, comparado: true, base: "main", documentos: 2, cambiados: 1, cubiertos: 1, sin_cubrir: 0 });
    expect(r.json.avisos).toMatchObject([{ tipo: "documento_sin_tocar", documento: `${K}/billing.md`, archivos: ["app/billing/invoice.ts"], patrones: ["app/billing/**"] }]);
    expect(r.texto).toContain("1 warning:");
    expect(r.texto).toContain(`You changed app/billing/invoice.ts (it matches \`app/billing/**\`) and didn't change ${K}/billing.md`);
    expect(r.texto).toContain("Update");
    expect(r.texto).not.toContain("Nothing to warn");
  });
  it("el documento correcto actualizado: nada que avisar (y lo dice)", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    escribir(raiz, `${K}/billing.md`, DOC("Billing", ["app/billing/**"], "Shows the invoices and the credit notes."));
    commit(raiz, "cambio y documento");
    const r = await guiaStale(deps, F);
    expect(r.codigo).toBe(0);
    expect(tipos(r)).toEqual([]);
    expect(r.texto).toBe("Compared 1 changed file with `main` against the map of 2 documents.\nNothing to warn.");
  });
  it("documento equivocado: actualizó payments.md pero el código es de billing → avisa por billing.md", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    escribir(raiz, `${K}/payments.md`, DOC("Payments", ["app/payments/**"], "Pays with cards and wallets."));
    commit(raiz, "cambio con el documento equivocado");
    const r = await guiaStale(deps, F);
    expect(r.json.avisos).toMatchObject([{ tipo: "documento_sin_tocar", documento: `${K}/billing.md`, documentos_tocados: [`${K}/payments.md`] }]);
  });
  it("cambio cosmético: tocó el documento sólo con espacios y líneas en blanco → no cuenta", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    escribir(raiz, `${K}/billing.md`, `${DOC("Billing", ["app/billing/**"]).replace("Shows", "Shows  ")}\n\n   \n`);
    commit(raiz, "sólo espacios");
    const r = await guiaStale(deps, F);
    expect(tipos(r)).toEqual(["cambio_cosmetico"]);
    expect(r.texto).toContain("only in whitespace");
  });
  it("el límite que no se promete: un texto cambiado pero equivocado deja el detector en verde (sin IA no se juzga la verdad)", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    escribir(raiz, `${K}/billing.md`, DOC("Billing", ["app/billing/**"], "Something that is not true anymore."));
    commit(raiz, "texto equivocado");
    expect(tipos(await guiaStale(deps, F))).toEqual([]);
  });
  it("función nueva fuera del mapa: un archivo agregado que ninguna fuente cubre → una nota aparte (no es un aviso ni rompe --strict)", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/reports/page.tsx", "export default 1;\n");
    commit(raiz, "pantalla nueva");
    const r = await guiaStale(deps, { base: "main", strict: true });
    expect(r.codigo).toBe(0);
    expect(tipos(r)).toEqual([]);
    expect(r.json.notas).toMatchObject([{ tipo: "fuera_del_mapa", archivos: ["app/reports/page.tsx"] }]);
    expect(r.json).toMatchObject({ cambiados: 1, cubiertos: 0, sin_cubrir: 1 });
    expect(r.texto).toContain("1 note");
    expect(r.texto).toContain("app/reports/page.tsx");
  });
  it("archivo movido: el viejo camino cuenta como tocado, el nuevo queda fuera del mapa y la fuente ya no coincide con nada", async () => {
    const { raiz, deps } = repo();
    git(raiz, "mv", "app/billing/invoice.ts", "app/invoices-new.ts");
    commit(raiz, "mover");
    const r = await guiaStale(deps, F);
    expect(tipos(r).sort()).toEqual(["documento_sin_tocar", "fuente_sin_archivos"]);
    expect(r.json.avisos).toContainEqual(expect.objectContaining({ tipo: "fuente_sin_archivos", documento: `${K}/billing.md`, patron: "app/billing/**" }));
    expect(notas(r)).toEqual(["fuera_del_mapa"]);
    expect(r.texto).toContain("matches no file in the repo");
  });
  it("archivo borrado: avisa por el documento que lo explicaba", async () => {
    const { raiz, deps } = repo();
    git(raiz, "rm", "-q", "app/payments/pay.ts");
    commit(raiz, "borrar");
    const r = await guiaStale(deps, F);
    expect(r.json.avisos).toContainEqual(expect.objectContaining({ tipo: "documento_sin_tocar", documento: `${K}/payments.md`, archivos: ["app/payments/pay.ts"] }));
    expect(r.texto).toContain("app/payments/pay.ts (deleted or moved)");
  });
  it("un patrón que no coincide con ningún archivo avisa AUNQUE el cambio no lo toque (sin mirar la base)", async () => {
    const { raiz, deps } = repo({ documentos: { "a.md": DOC("A", ["app/vieja/**", "app/billing/**"]) } });
    escribir(raiz, "README.md", "# cambio ajeno\n");
    commit(raiz, "ajeno");
    const r = await guiaStale(deps, F);
    expect(r.json.avisos).toMatchObject([{ tipo: "fuente_sin_archivos", patron: "app/vieja/**" }]);
  });
  it("mapa roto: una cabecera con una errata no se lee a medias → mapa_roto con su línea; los demás documentos siguen valiendo", async () => {
    const { raiz, deps } = repo({ documentos: { "billing.md": DOC("Billing", ["app/billing/**"]), "roto.md": "---\nsource: app/payments/**\n---\n## R\nWhat it's for: x\nWhat users can do: y\n" } });
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const r = await guiaStale(deps, F);
    expect(tipos(r).sort()).toEqual(["documento_sin_tocar", "mapa_roto"]);
    const roto = (r.json.avisos as { tipo: string; documento: string; errores: unknown[] }[]).find((a) => a.tipo === "mapa_roto")!;
    expect(roto).toMatchObject({ documento: `${K}/roto.md`, errores: [{ linea: 2, motivo: "unknown header key «source» (allowed: title, summary, sources)" }] });
    expect(r.texto).toContain("line 2");
  });
  it("mapa vacío: sin la carpeta (o sin documentos) NO dice «nada que avisar»: dice que no pudo comparar", async () => {
    for (const documentos of [null, {}]) {
      const { raiz, deps } = repo({ documentos });
      escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
      commit(raiz, "cambio");
      const r = await guiaStale(deps, F);
      expect(r.codigo).toBe(0);
      expect(r.json).toMatchObject({ ok: true, comparado: false, documentos: 0, cambiados: null });
      expect(tipos(r)).toEqual(["mapa_vacio"]);
      expect(r.texto).toContain("I could not compare the change");
      expect(r.texto).not.toContain("Nothing to warn");
    }
  });
  it("documentos sin `sources`: mapa vacío también (hay carpeta, no hay mapa)", async () => {
    const { deps } = repo({ documentos: { "a.md": "## A\nWhat it's for: x\nWhat users can do: y\n" } });
    const r = await guiaStale(deps, F);
    expect(tipos(r)).toEqual(["mapa_vacio"]);
    expect(r.json.comparado).toBe(false);
  });
  it("una carpeta que no se puede leer (un nombre inválido) es un mapa roto con su motivo, no un silencio", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, `${K}/${"x".repeat(201)}.md`, DOC("X", ["app/**"]));
    const r = await guiaStale(deps, F);
    expect(tipos(r)).toContain("mapa_roto");
    expect(r.json.comparado).toBe(false);
    expect(r.texto).not.toContain("Nothing to warn");
  });
});

describe("guide stale: el mapa de la base (lo que el cambio borró o quitó no esconde el código)", () => {
  it("borró el documento en el mismo cambio que toca su código → cobertura_quitada, no «nada que avisar»", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    git(raiz, "rm", "-q", `${K}/billing.md`);
    commit(raiz, "borrar el documento y tocar su código");
    const r = await guiaStale(deps, F);
    expect(r.codigo).toBe(0);
    expect(r.json.avisos).toMatchObject([{ tipo: "cobertura_quitada", documento: `${K}/billing.md`, patrones: ["app/billing/**"], archivos: ["app/billing/invoice.ts"] }]);
    expect(r.texto).not.toContain("Nothing to warn");
    expect((await guiaStale(deps, { ...F, strict: true })).codigo).toBe(4);
  });
  it("quitó el patrón de `sources` y tocó su código → cobertura_quitada", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    escribir(raiz, `${K}/billing.md`, DOC("Billing", ["app/other/**"]));
    escribir(raiz, "app/other/x.ts", "x\n");
    commit(raiz, "quitar el patrón");
    const r = await guiaStale(deps, F);
    expect(tipos(r)).toEqual(["cobertura_quitada"]);
    expect(r.json.avisos).toMatchObject([{ documento: `${K}/billing.md`, patrones: ["app/billing/**"], archivos: ["app/billing/invoice.ts"] }]);
  });
  it("una base sin mapa: compara contra el mapa de ahora y no inventa cobertura quitada", async () => {
    const { raiz, deps } = repo({ documentos: null });
    escribir(raiz, `${K}/billing.md`, DOC("Billing", ["app/billing/**"]));
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "primer mapa");
    const r = await guiaStale(deps, F);
    expect(r.json).toMatchObject({ comparado: true });
    expect(tipos(r)).toEqual([]);
    expect(notas(r)).toEqual([]);
  });
});

describe("guide stale: la base que falta (nunca «nada que avisar» si no pudo mirar)", () => {
  it("una base que no existe: no_se_pudo_comparar, lo dice, sugiere fetch-depth: 0 y sale 0", async () => {
    const { deps } = repo();
    const r = await guiaStale(deps, { base: "origin/main", strict: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, comparado: false, base: "origin/main", cambiados: null });
    expect(r.json.avisos).toMatchObject([{ tipo: "no_se_pudo_comparar", motivo: "base_no_encontrada" }]);
    expect(r.texto).toContain("could not compare");
    expect(r.texto).toContain("fetch-depth: 0");
    expect(r.texto).not.toContain("Nothing to warn");
  });
  it("con --strict, no poder comparar es un aviso que falla (4)", async () => {
    const { deps } = repo();
    const r = await guiaStale(deps, { base: "origin/main", strict: true });
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ ok: false, error: "guia_desactualizada", comparado: false });
  });
  it("un clon superficial (--depth 1) sin la base: clon_superficial, y dice que está superficial", async () => {
    const { raiz } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const clon = path.join(TMP, `clon${n++}`);
    git(TMP, "clone", "-q", "--depth", "1", "--branch", "feature", `file://${raiz}`, clon);
    const r = await guiaStale({ git: gitDeLecturas, cwd: clon, leerArchivoChico, listarCarpeta: listarCarpetaReal }, { base: "origin/main", strict: false });
    expect(r.json).toMatchObject({ comparado: false });
    expect(r.json.avisos).toMatchObject([{ tipo: "no_se_pudo_comparar", motivo: "clon_superficial" }]);
    expect(r.texto).toContain("shallow");
    expect(r.texto).toContain("fetch-depth: 0");
  });
  it("superficial con la base presente pero sin ancestro común a la vista: también clon_superficial", async () => {
    const { raiz } = repo();
    for (const i of [1, 2]) { escribir(raiz, "app/billing/invoice.ts", `export const a = ${i + 1};\n`); commit(raiz, `c${i}`); }
    git(raiz, "checkout", "-q", "main");
    escribir(raiz, "README.md", "# otro\n");
    commit(raiz, "main avanza");
    git(raiz, "checkout", "-q", "feature");
    const clon = path.join(TMP, `clon${n++}`);
    git(TMP, "clone", "-q", "--depth", "1", "--no-single-branch", "--branch", "feature", `file://${raiz}`, clon);
    const r = await guiaStale({ git: gitDeLecturas, cwd: clon, leerArchivoChico, listarCarpeta: listarCarpetaReal }, { base: "origin/main", strict: false });
    expect(r.json).toMatchObject({ comparado: false });
    expect(r.json.avisos).toMatchObject([{ tipo: "no_se_pudo_comparar", motivo: "clon_superficial" }]);
  });
  it("con la historia completa sí compara (el mismo clon con la base a mano)", async () => {
    const { raiz } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const clon = path.join(TMP, `clon${n++}`);
    git(TMP, "clone", "-q", "--no-single-branch", "--branch", "feature", `file://${raiz}`, clon);
    const r = await guiaStale({ git: gitDeLecturas, cwd: clon, leerArchivoChico, listarCarpeta: listarCarpetaReal }, { base: "origin/main", strict: false });
    expect(r.json).toMatchObject({ comparado: true });
    expect(tipos(r)).toEqual(["documento_sin_tocar"]);
  });
  it("la base es el propio HEAD: compara y dice que no cambió ningún archivo", async () => {
    const { deps } = repo();
    const r = await guiaStale(deps, { base: "HEAD", strict: false });
    expect(r.json).toMatchObject({ comparado: true, cambiados: 0 });
    expect(r.texto).toContain("no files changed");
  });
});

describe("guide stale: lo que cambia la forma de usarlo", () => {
  it("antes de commitear: cuenta lo modificado, lo preparado y los archivos nuevos sin seguimiento", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 3;\n"); // modificado
    escribir(raiz, "app/payments/nuevo.ts", "export const c = 1;\n"); // nuevo sin seguimiento
    git(raiz, "add", "app/payments/nuevo.ts");
    escribir(raiz, "app/reports/page.tsx", "x\n"); // nuevo sin preparar
    const r = await guiaStale(deps, F);
    expect(tipos(r).sort()).toEqual(["documento_sin_tocar", "documento_sin_tocar"]);
    expect(notas(r)).toEqual(["fuera_del_mapa"]);
    expect(r.json).toMatchObject({ cambiados: 3 });
  });
  it("un archivo ignorado por .gitignore no cuenta", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, ".gitignore", "dist/\n");
    commit(raiz, "gitignore");
    escribir(raiz, "dist/app.js", "x\n");
    expect(await guiaStale(deps, F)).toMatchObject({ json: { cambiados: 1 } });
  });
  it("nombres con espacios y tildes (git los escapa sin -z)", async () => {
    const { raiz, deps } = repo({ documentos: { "a.md": DOC("A", ["app/facturación/**"]) } });
    escribir(raiz, "app/facturación/mes ñandú.ts", "x\n");
    commit(raiz, "tilde");
    const r = await guiaStale(deps, F);
    expect(r.json.avisos).toMatchObject([{ tipo: "documento_sin_tocar", archivos: ["app/facturación/mes ñandú.ts"] }]);
  });
  it("--strict: con un aviso sale 4 con ok:false y el mismo detalle; sin avisos sale 0", async () => {
    const { raiz, deps } = repo();
    expect((await guiaStale(deps, { base: "main", strict: true })).codigo).toBe(0);
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const r = await guiaStale(deps, { base: "main", strict: true });
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ ok: false, error: "guia_desactualizada", comparado: true, avisos: [{ tipo: "documento_sin_tocar" }] });
    expect(r.texto).toContain("--strict");
    expect((await guiaStale(deps, F)).codigo).toBe(0);
  });
  it("sin --base: 3 falta_base; una base que parece un flag o lleva espacios: 3 base_invalida; fuera de git: 3 sin_repo", async () => {
    const { deps } = repo();
    expect(await guiaStale(deps, { base: null, strict: false })).toMatchObject({ codigo: 3, json: { error: "falta_base" } });
    for (const mala of ["--output=x", "-x", "a b", "main\nx"]) expect(await guiaStale(deps, { base: mala, strict: false }), mala).toMatchObject({ codigo: 3, json: { error: "base_invalida" } });
    const fuera = path.join(TMP, "sin-git");
    mkdirSync(fuera);
    expect(await guiaStale({ ...deps, cwd: fuera }, F)).toMatchObject({ codigo: 3, json: { error: "sin_repo" } });
  });
  it("corre parado en una subcarpeta y sin red ni sesión: sólo lee", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
    commit(raiz, "cambio");
    const r = await guiaStale({ ...deps, cwd: path.join(raiz, "app/billing") }, F);
    expect(tipos(r)).toEqual(["documento_sin_tocar"]);
  });
  it("lo que viene del repo sale sin caracteres de control ni secretos", async () => {
    const clave = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
    const { raiz, deps } = repo({ documentos: { "a.md": DOC("A", [`app/${clave}/**`, "app/billing/**"]) } });
    const r = await guiaStale(deps, F);
    expect(r.texto).not.toContain(clave);
    expect(JSON.stringify(r.json)).not.toContain(clave);
    expect(r.texto.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    void raiz;
  });
});

// Sol, revisión 2, F1: si git no puede listar los archivos del repo, el detector no puede afirmar nada sobre las
// `sources` que no coinciden con ningún archivo; no lo reemplaza por una lista vacía ni dice «Nothing to warn».
describe("guide stale: un inventario de archivos que falla no es un «todo bien»", () => {
  const fallaLa = (cual: "ls-files-lista" | "ls-files-borrados", deps: DepsDeStale): DepsDeStale => ({
    ...deps,
    git: (args, cwd) => {
      const esLista = args[0] === "ls-files" && args.includes("--cached");
      const esBorrados = args[0] === "ls-files" && args.includes("--deleted");
      if ((cual === "ls-files-lista" && esLista) || (cual === "ls-files-borrados" && esBorrados)) return Promise.resolve({ codigo: 128, stdout: "" });
      return deps.git(args, cwd);
    },
  });
  for (const cual of ["ls-files-lista", "ls-files-borrados"] as const) {
    it(`falla sólo ${cual}: avisa que no pudo completar la comprobación, nunca «Nothing to warn», y --strict sale 4`, async () => {
      const { deps } = repo({ documentos: { "a.md": DOC("A", ["app/missing/**"]) } });
      const sano = await guiaStale(deps, { base: "main", strict: true });
      expect(tipos(sano)).toEqual(["fuente_sin_archivos"]);
      for (const strict of [false, true]) {
        const r = await guiaStale(fallaLa(cual, deps), { base: "main", strict });
        expect(r.codigo).toBe(strict ? 4 : 0);
        expect(r.json).toMatchObject({ comparado: false });
        expect(r.json.avisos).toMatchObject([{ tipo: "no_se_pudo_comparar", motivo: "git_no_pudo_listar" }]);
        expect(r.texto).toContain("could not complete the check");
        expect(r.texto).not.toContain("Nothing to warn");
      }
    });
    it(`falla sólo ${cual}: conserva lo que sí pudo calcular (el diff contra la base)`, async () => {
      const { raiz, deps } = repo();
      escribir(raiz, "app/billing/invoice.ts", "export const a = 2;\n");
      commit(raiz, "cambio");
      const r = await guiaStale(fallaLa(cual, deps), F);
      expect(tipos(r).sort()).toEqual(["documento_sin_tocar", "no_se_pudo_comparar"]);
      expect(r.json).toMatchObject({ comparado: false, cambiados: 1, cubiertos: 1 });
    });
  }
});

// Sol, revisión 2, F2: un nombre con salto de línea es legal en git y `**` tiene que cubrirlo.
describe("guide stale: nombres con salto de línea", () => {
  it("un cambio en app/billing/odd<LF>name.ts sin tocar el documento avisa (documento_sin_tocar) y --strict sale 4", async () => {
    const { raiz, deps } = repo();
    escribir(raiz, "app/billing/odd\nname.ts", "1\n");
    commit(raiz, "archivo raro");
    git(raiz, "checkout", "-q", "-B", "main");
    git(raiz, "checkout", "-q", "-B", "feature");
    escribir(raiz, "app/billing/odd\nname.ts", "2\n");
    commit(raiz, "cambio sólo del raro");
    const r = await guiaStale(deps, { base: "main", strict: true });
    expect(r.codigo).toBe(4);
    expect(r.json.avisos).toMatchObject([{ tipo: "documento_sin_tocar", documento: `${K}/billing.md`, archivos: ["app/billing/oddname.ts"] }]);
    // La ruta se compara tal cual (con su LF) y sólo se sanea al MOSTRARLA: el salto de línea no sale a la terminal.
  });
});

