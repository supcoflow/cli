// V-3 (1A.1, fricción 3): el aviso temprano. `test --json` sin autorizar y `diagnose --json` dicen, ANTES del sí de gasto y sin
// escribir nada, si esta máquina va a poder guardar el pedido de la prueba. Con disco y git reales, como proteccion-de-git.test.ts.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diagnostico } from "../src/api.ts";
import { diagnosticar, probar, type DepsDePrueba } from "../src/comandos/probar.ts";
import { fsDelLugarReal, fsReal, gitReal } from "../src/entorno.ts";
import { almacenDeArchivo } from "../src/guardado/archivo.ts";
import { revisarElLugar } from "../src/guardado/lugar.ts";
import { almacenProtegido } from "../src/guardado/protegido.ts";
import { crearRegistroDePruebas } from "../src/pruebas-guardadas.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const DIAG: Diagnostico = {
  listo: true,
  puntos: [
    { punto: "instalacion", ok: true, mensaje: "ok", grupo: "instalacion" }, { punto: "sitios", ok: true, mensaje: "ok", grupo: "instalacion" },
    { punto: "chat", ok: true, mensaje: "ok", grupo: "instalacion" }, { punto: "guia", ok: true, mensaje: "ok", grupo: "instalacion" },
    { punto: "despachos", ok: true, mensaje: "ok", grupo: "prueba" },
  ],
  politica: "guardar", techoUsd: 2, saldoUsd: 7.5, topeUsd: 10, comprometidoUsd: 2.5, pruebaAbierta: null,
};
const ENV = { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: "/nonexistent" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, env: ENV, encoding: "utf8" });

let tmp: string;
let dir: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "supcoflow-maquina-")));
  dir = join(tmp, "casa", ".config", "supcoflow");
});
afterEach(() => {
  for (const p of [dir, join(tmp, "casa", ".config"), join(tmp, "casa")]) { try { chmodSync(p, 0o700); } catch { /* no existe */ } }
  rmSync(tmp, { recursive: true, force: true });
});

function deps(rutaDir = dir, o: Partial<DepsDePrueba> = {}) {
  const ruta = join(rutaDir, "pruebas.json");
  const posts: unknown[] = [];
  const pruebas = crearRegistroDePruebas({
    origen: "http://localhost:3000", almacen: almacenProtegido(almacenDeArchivo(ruta, fsReal), { ruta, fs: fsReal, git: gitReal }),
    rutaDelArchivo: ruta, ahora: () => 1, avisar: () => {},
    revisarElLugar: () => revisarElLugar({ ruta, fs: fsDelLugarReal, git: gitReal }),
  });
  const d: DepsDePrueba = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r", buscarProyecto: async () => PROY,
    leerDiagnostico: async () => DIAG,
    pedirPrueba: async (_a, _c, _p, intento) => { posts.push(intento); return { tipo: "aceptada", pruebaId: "prb_0000000000000001", reporteId: "rep_1", estado: "creada" }; },
    leerPrueba: async () => { throw new Error("no"); },
    pruebas, generar: () => "clave-1", ahora: () => 0, dormir: async () => {}, avisar: () => {},
    ...o,
  };
  return { d, posts, ruta };
}
const F = { repo: null, authorizeSpend: false, dryRun: false, message: null, wait: false, testId: null, ceiling: null, expectPolicy: null };
const archivosDe = (p: string) => (existsSync(p) ? readdirSync(p) : null);

type Maquina = { ok: boolean; impedimentos: { codigo: string; detalle: string }[] };
async function ver(d: DepsDePrueba) {
  const antes = JSON.stringify(archivosDe(dir));
  const t = await probar(d, F);
  const g = await diagnosticar(d, { repo: null });
  expect(JSON.stringify(archivosDe(dir))).toBe(antes); // sin escrituras
  return { t, g, maquina: t.json.maquina as Maquina };
}

describe("V-3: una máquina sana", () => {
  it("test --json y diagnose --json dicen maquina.ok, sin impedimentos y sin intento pendiente; la salida de diagnose es 0", async () => {
    const { d } = deps();
    const { t, g, maquina } = await ver(d);
    expect(maquina).toEqual({ ok: true, impedimentos: [] });
    expect(t.json).toMatchObject({ error: "falta_autorizacion", intento_pendiente: null });
    expect(t.texto).not.toContain("can't save");
    expect(g.codigo).toBe(0);
    expect(g.json).toMatchObject({ listo: true, maquina: { ok: true }, prueba: { listo: true }, instalacion: { ok: 6, total: 6 }, intento_pendiente: null });
  });
});

describe("V-3: lo que se ve antes del sí", () => {
  async function conImpedimento(codigo: string, preparar: () => void) {
    preparar();
    const { d } = deps();
    const { t, g, maquina } = await ver(d);
    expect(maquina.ok).toBe(false);
    expect(maquina.impedimentos.map((i) => i.codigo)).toContain(codigo);
    expect(t.json.maquina).toEqual(g.json.maquina);
    // el mensaje lo dice PRIMERO, y el comando para lanzar sigue ahí
    expect(t.texto).toMatch(/^This machine can't save the test request yet: /);
    expect(t.codigo).toBe(4);
    // diagnose: sale 4 no_listo, `listo` y `prueba.listo` en false y el «N of 6» de la instalación no cambia
    expect(g.codigo).toBe(4);
    expect(g.json).toMatchObject({ ok: false, error: "no_listo", listo: false, prueba: { listo: false }, instalacion: { ok: 6, total: 6 } });
    expect(g.texto).toContain("6 of 6, at no cost.");
    expect(g.texto).toMatch(/\[missing\] maquina: This machine can't save the test request yet: /);
    return maquina;
  }

  it("la carpeta existe y no se puede escribir", async () => {
    await conImpedimento("carpeta_sin_permiso", () => { mkdirSync(dir, { recursive: true }); chmodSync(dir, 0o500); });
  });
  it("el archivo no existe bajo un padre que no se puede escribir", async () => {
    await conImpedimento("padre_sin_permiso", () => { mkdirSync(join(tmp, "casa"), { recursive: true }); chmodSync(join(tmp, "casa"), 0o500); });
  });
  it("un enlace roto en el camino", async () => {
    await conImpedimento("ruta_irresoluble", () => { mkdirSync(join(tmp, "casa", ".config"), { recursive: true }); symlinkSync(join(tmp, "no-existe"), dir); });
  });
  it("pruebas.json.tmp es una carpeta", async () => {
    await conImpedimento("tmp_es_carpeta", () => { mkdirSync(join(dir, "pruebas.json.tmp"), { recursive: true }); });
  });
  it("pruebas.json existe pero no se puede leer", async () => {
    await conImpedimento("archivo_ilegible", () => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "pruebas.json"), "{}"); chmodSync(join(dir, "pruebas.json"), 0o000); });
  });
  it("pruebas.json existe pero no se entiende", async () => {
    await conImpedimento("archivo_ilegible", () => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "pruebas.json"), "esto no es json"); });
  });
  it("pruebas.json es una carpeta", async () => {
    await conImpedimento("archivo_no_comun", () => { mkdirSync(join(dir, "pruebas.json"), { recursive: true }); });
  });
  it("un archivo seguido en un repo (la carpeta personal es un repo)", async () => {
    const maquina = await conImpedimento("git_lo_sigue", () => {
      const casa = join(tmp, "casa");
      mkdirSync(dir, { recursive: true });
      git(casa, "init", "-q");
      writeFileSync(join(dir, "pruebas.json"), "{}");
      git(casa, "add", "-f", ".config/supcoflow/pruebas.json");
      git(casa, "commit", "-qm", "x");
    });
    expect(maquina.impedimentos.find((i) => i.codigo === "git_lo_sigue")!.detalle).toMatch(/git -C .* rm --cached -- \.config\/supcoflow\/pruebas\.json/);
  });
  it("sin .gitignore y nada seguido, en un repo: sin impedimentos, y mirar no creó ni el .gitignore", async () => {
    mkdirSync(join(tmp, "casa"), { recursive: true });
    git(join(tmp, "casa"), "init", "-q");
    const { d } = deps();
    const { maquina } = await ver(d);
    expect(maquina).toEqual({ ok: true, impedimentos: [] });
    expect(existsSync(dir)).toBe(false);
  });
});

describe("V-3: el pedido pendiente", () => {
  it("con un intento guardado de otro techo, `intento_pendiente` lo trae: sólo techo y política, nunca el mensaje ni la clave", async () => {
    const { d } = deps();
    await d.pruebas.abrir("proj_r-1", { clave: "clave-secreta-1", mensaje: "texto privado", techoUsd: 3, politicaEsperada: "relevar" });
    const t = await probar(d, F);
    expect(t.json.intento_pendiente).toEqual({ techo_usd: 3, politica: "relevar" });
    expect(t.texto).toContain("ceiling US$ 3.00, policy investigate");
    expect(t.texto).toContain("`supcoflow test --authorize-spend --ceiling 3 --expect-policy investigate`");
    for (const s of [JSON.stringify(t.json), t.texto]) {
      expect(s).not.toContain("clave-secreta-1");
      expect(s).not.toContain("texto privado");
    }
    expect((await diagnosticar(d, { repo: null })).json).toMatchObject({ intento_pendiente: { techo_usd: 3, politica: "relevar" } });
  });
  it("un intento de la 0.7.0 (sin política) se trae con politica null y se retoma por el alias viejo", async () => {
    const { d, ruta } = deps();
    mkdirSync(dir, { recursive: true });
    writeFileSync(ruta, JSON.stringify({ "http://localhost:3000#prueba#proj_r-1": { valor: JSON.stringify({ intento: { clave: "k", mensaje: null, techo_usd: 2 }, ultima: null }), escritoEn: 1 } }));
    const t = await probar(d, F);
    expect(t.json.intento_pendiente).toEqual({ techo_usd: 2, politica: null });
    expect(t.texto).toContain("`supcoflow probar --autorizo-gasto --ceiling 2`");
  });
  it("sin intento: null", async () => {
    expect((await probar(deps().d, F)).json.intento_pendiente).toBeNull();
  });
});

describe("V-3: el aviso no cambia lo demás", () => {
  it("--authorize-spend con la máquina sana sigue pidiendo y guardando como antes", async () => {
    const { d, posts, ruta } = deps();
    const r = await probar(d, { ...F, authorizeSpend: true, ceiling: "2", expectPolicy: "save" });
    expect(r.codigo).toBe(5);
    expect(posts).toHaveLength(1);
    expect(readFileSync(ruta, "utf8")).toContain("prb_0000000000000001");
  });
  it("si el prechequeo mismo falla, es «no ok» y no un error", async () => {
    const { d } = deps(dir, { pruebas: { ...deps().d.pruebas, revisar: async () => { throw new Error("boom"); } } });
    const t = await probar(d, F);
    expect(t.json.maquina).toMatchObject({ ok: false, impedimentos: [{ codigo: "no_se_pudo_revisar" }] });
    expect(t.codigo).toBe(4);
  });
});
