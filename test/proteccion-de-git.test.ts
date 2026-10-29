// La excepción de la carpeta personal que es un repo (1A.1, fricción 2c), con disco y git REALES (como
// archivo-real.test.ts): lo que un doble no prueba es qué contesta git de verdad con un archivo nuevo, seguido o sólo agregado.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fsReal, gitReal } from "../src/entorno.ts";
import { almacenDeArchivo } from "../src/guardado/archivo.ts";
import { almacenProtegido } from "../src/guardado/protegido.ts";
import { asegurarProteccionDeGit, mirarProteccionDeGit, type GitDeRuta } from "../src/guardado/repo.ts";
import { crearRegistroDeIdempotencia } from "../src/idempotencia.ts";
import { crearRegistroDePruebas } from "../src/pruebas-guardadas.ts";

let tmp: string;
let home: string;
let dir: string;
const ENV = { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: "/nonexistent" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, env: ENV, encoding: "utf8" });
const initRepo = (cwd: string) => { mkdirSync(cwd, { recursive: true }); git(cwd, "init", "-q"); };
const INTENTO = { clave: "k-1", mensaje: "privado", techoUsd: 2, politicaEsperada: "guardar" as const };

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "supcoflow-git-")));
  home = join(tmp, "home");
  dir = join(home, ".config", "supcoflow");
  initRepo(home);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const armarPruebas = (d = dir, g: GitDeRuta = gitReal) => {
  const ruta = join(d, "pruebas.json");
  return crearRegistroDePruebas({
    origen: "http://127.0.0.1:4555", almacen: almacenProtegido(almacenDeArchivo(ruta, fsReal), { ruta, fs: fsReal, git: g }),
    rutaDelArchivo: ruta, ahora: () => 1, avisar: () => {},
  });
};
const armarIdem = (d = dir, avisos: string[] = []) => {
  const ruta = join(d, "idempotencia.json");
  return crearRegistroDeIdempotencia({
    origen: "http://127.0.0.1:4555", almacen: almacenProtegido(almacenDeArchivo(ruta, fsReal), { ruta, fs: fsReal, git: gitReal }),
    rutaDelArchivo: ruta, generar: () => "k-nueva", ahora: () => 1, avisar: (s) => avisos.push(s),
  });
};
const enElIndice = () => git(home, "diff", "--cached", "--name-only");

describe("el home es un repo de git: archivo nuevo", () => {
  it("guarda el pedido, crea el .gitignore y `git add -A` no toma nada de la carpeta", async () => {
    await armarPruebas().abrir("proj_1", INTENTO);
    expect(JSON.parse(readFileSync(join(dir, "pruebas.json"), "utf8"))).toBeTruthy();
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^\*$/m);
    expect(statSync(join(dir, "pruebas.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    git(home, "add", "-A");
    expect(enElIndice()).toBe("");
    expect((await armarPruebas().leer("proj_1")).intento).toEqual(INTENTO);
    await armarPruebas().confirmar("proj_1", "prb_0123456789abcdef");
    expect((await armarPruebas().leer("proj_1")).ultima).toBe("prb_0123456789abcdef");
  });

  it("fuera de un repo no crea ningún .gitignore ni llama a git", async () => {
    const afuera = join(tmp, "afuera", ".config", "supcoflow");
    const llamadas: string[][] = [];
    await armarPruebas(afuera, async (args, cwd) => { llamadas.push(args); return gitReal(args, cwd); }).abrir("proj_1", INTENTO);
    expect(existsSync(join(afuera, "pruebas.json"))).toBe(true);
    expect(existsSync(join(afuera, ".gitignore"))).toBe(false);
    expect(llamadas).toEqual([]);
  });
});

describe("el home es un repo de git: archivo ya seguido o agregado", () => {
  it("seguido (commiteado): se niega sin tocarlo, con qué hacer, y el índice no cambia", async () => {
    mkdirSync(dir, { recursive: true });
    const ruta = join(dir, "pruebas.json");
    writeFileSync(ruta, JSON.stringify({}));
    git(home, "add", "-f", ".config/supcoflow/pruebas.json");
    git(home, "commit", "-qm", "x");
    const antes = readFileSync(ruta, "utf8");
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({
      error: "prueba_no_guardada", codigo: 1,
      message: expect.stringMatching(/Git doesn.t ignore .*pruebas\.json in the repo .*git -C .* rm --cached -- \.config\/supcoflow\/pruebas\.json/),
    });
    expect(readFileSync(ruta, "utf8")).toBe(antes);
    expect(enElIndice()).toBe("");
    expect(git(home, "status", "--porcelain")).not.toMatch(/M /);
  });

  it("sólo agregado al índice: se niega", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pruebas.json"), "{}");
    git(home, "add", "-f", ".config/supcoflow/pruebas.json");
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada" });
    expect(enElIndice()).toBe(".config/supcoflow/pruebas.json\n");
    expect(readFileSync(join(dir, "pruebas.json"), "utf8")).toBe("{}");
  });

  it("el .tmp seguido también: se niega", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pruebas.json.tmp"), "x");
    git(home, "add", "-f", ".config/supcoflow/pruebas.json.tmp");
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada", message: expect.stringContaining("pruebas.json.tmp") });
    expect(existsSync(join(dir, "pruebas.json"))).toBe(false);
  });

  it("un .gitignore previo que no lo ignora: se niega y ese .gitignore no se edita", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "otra-cosa\n");
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada", message: expect.stringMatching(/Git doesn't ignore .*pruebas\.json/) });
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("otra-cosa\n");
    expect(existsSync(join(dir, "pruebas.json"))).toBe(false);
  });

  it("un .gitignore previo que sí lo ignora sirve y no se pisa", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "pruebas.json*\n");
    await armarPruebas().abrir("proj_1", INTENTO);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("pruebas.json*\n");
    expect(existsSync(join(dir, "pruebas.json"))).toBe(true);
  });
});

describe("la limpieza de la idempotencia (olvidar reescribe el archivo entero)", () => {
  async function conIdempotenciaSeguida(que: "archivo" | "tmp") {
    mkdirSync(dir, { recursive: true });
    const cuenta = "http://127.0.0.1:4555#proyecto_crear#o/r";
    const contenido = JSON.stringify({ [cuenta]: { valor: "k-vieja", escritoEn: 1 } }, null, 2) + "\n";
    writeFileSync(join(dir, que === "archivo" ? "idempotencia.json" : "idempotencia.json.tmp"), que === "archivo" ? contenido : "x");
    if (que === "tmp") writeFileSync(join(dir, "idempotencia.json"), contenido);
    git(home, "add", "-f", `.config/supcoflow/${que === "archivo" ? "idempotencia.json" : "idempotencia.json.tmp"}`);
    if (que === "archivo") git(home, "commit", "-qm", "x");
    return contenido;
  }

  for (const que of ["archivo", "tmp"] as const) {
    it(`olvidar con ${que === "archivo" ? "idempotencia.json seguido" : "el .tmp seguido"}: avisa, no reescribe y el índice no cambia`, async () => {
      const contenido = await conIdempotenciaSeguida(que);
      const indiceAntes = enElIndice();
      const avisos: string[] = [];
      await armarIdem(dir, avisos).olvidar("proyecto_crear", "o/r");
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatch(/^I didn't delete the idempotency key from .*idempotencia\.json, so as not to rewrite a file git doesn't ignore\. Git doesn't ignore/);
      expect(readFileSync(join(dir, "idempotencia.json"), "utf8")).toBe(contenido);
      expect(enElIndice()).toBe(indiceAntes);
      expect(git(home, "status", "--porcelain")).not.toMatch(/^ ?M /m);
    });
  }

  it("claveDe en los dos modos con el archivo seguido: el normal avisa y sigue; el estricto lanza; el disco no cambia", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "idempotencia.json"), "{}\n");
    git(home, "add", "-f", ".config/supcoflow/idempotencia.json");
    git(home, "commit", "-qm", "x");
    const avisos: string[] = [];
    expect(await armarIdem(dir, avisos).claveDe("proyecto_crear", "o/r")).toBe("k-nueva");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/Git doesn.t ignore/);
    await expect(armarIdem().claveDe("clave_crear", "p#c", { estricta: true })).rejects.toMatchObject({ error: "idempotencia_no_guardada", message: expect.stringMatching(/Git doesn.t ignore/) });
    expect(readFileSync(join(dir, "idempotencia.json"), "utf8")).toBe("{}\n");
    expect(git(home, "status", "--porcelain")).toBe("");
  });

  it("sin nada que borrar no hay ruido ni .gitignore nuevo", async () => {
    const avisos: string[] = [];
    await armarIdem(dir, avisos).olvidar("proyecto_crear", "o/r");
    expect(avisos).toEqual([]);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  it("archivo nuevo en los dos modos: guarda, lo ignora git, y olvidar lo reescribe sin tocar el índice", async () => {
    const r = armarIdem();
    expect(await r.claveDe("clave_crear", "p#c", { estricta: true })).toBe("k-nueva");
    expect(JSON.parse(readFileSync(join(dir, "idempotencia.json"), "utf8"))).toBeTruthy();
    await r.olvidar("clave_crear", "p#c");
    git(home, "add", "-A");
    expect(enElIndice()).toBe("");
  });
});

describe("git ausente o que falla: falla cerrada", () => {
  const roto = (codigo: number | null): GitDeRuta => async () => ({ codigo, stdout: "" });
  for (const codigo of [null, 128, 2]) {
    it(`check-ignore con salida ${codigo}: se niega (nunca se toma un error por un 0)`, async () => {
      await expect(armarPruebas(dir, roto(codigo)).abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada", message: expect.stringContaining("couldn't ask git") });
      expect(existsSync(join(dir, "pruebas.json"))).toBe(false);
    });
  }
});

describe("rutas enlazadas", () => {
  it("la carpeta supcoflow enlazada a otro repo: se miran los dos, y si uno no la protege se niega", async () => {
    const otro = join(tmp, "dotfiles");
    initRepo(otro);
    mkdirSync(join(otro, "supcoflow"), { recursive: true });
    mkdirSync(join(home, ".config"), { recursive: true });
    symlinkSync(join(otro, "supcoflow"), dir);
    // El .gitignore con `*` lo ignora para los dos repos: la ruta escrita (bajo el home) y la real (bajo dotfiles).
    // Git no sigue enlaces para la ruta escrita («beyond a symbolic link»), así que falla cerrada: se niega.
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada" });
    expect(git(otro, "status", "--porcelain", "--ignored")).not.toMatch(/pruebas\.json/);
  });

  it("la carpeta supcoflow enlazada a un repo cuyo único dueño es dotfiles: se mira ese repo y guarda", async () => {
    const otro = join(tmp, "dotfiles");
    initRepo(otro);
    const real = join(otro, "supcoflow");
    mkdirSync(real, { recursive: true });
    const fuera = join(tmp, "casa-sin-repo", ".config");
    mkdirSync(fuera, { recursive: true });
    symlinkSync(real, join(fuera, "supcoflow"));
    await armarPruebas(join(fuera, "supcoflow")).abrir("proj_1", INTENTO);
    expect(existsSync(join(real, "pruebas.json"))).toBe(true);
    git(otro, "add", "-A");
    expect(git(otro, "diff", "--cached", "--name-only")).toBe("");
  });

  it("un enlace roto no se puede resolver: se niega", async () => {
    mkdirSync(join(home, ".config"), { recursive: true });
    symlinkSync(join(tmp, "no-existe"), dir);
    await expect(armarPruebas().abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada", message: expect.stringContaining("broken symlink") });
  });
});

describe("mirar no escribe nada", () => {
  const mirar = () => mirarProteccionDeGit({ dir, archivos: ["pruebas.json", "pruebas.json.tmp"], fs: fsReal, git: gitReal });
  it("sin .gitignore y nada seguido: protegido, y no crea ni la carpeta ni el .gitignore", async () => {
    expect(await mirar()).toEqual({ protegido: true });
    expect(existsSync(dir)).toBe(false);
  });
  it("sin .gitignore y el archivo seguido: no protegido", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pruebas.json"), "{}");
    git(home, "add", "-f", ".config/supcoflow/pruebas.json");
    expect(await mirar()).toMatchObject({ protegido: false, impedimento: { codigo: "git_lo_sigue" } });
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });
  it("asegurar y mirar coinciden en un caso sano", async () => {
    expect(await asegurarProteccionDeGit({ dir, archivos: ["pruebas.json", "pruebas.json.tmp"], fs: fsReal, git: gitReal })).toEqual({ protegido: true });
    expect(await mirar()).toEqual({ protegido: true });
  });
});
