// La carpeta concreta FUERA de todo repo que la terminal sugiere cuando git no deja guardar el pedido de la prueba bajo la
// carpeta personal (que es un repo). Con disco y git reales, como proteccion-de-git.test.ts. Nunca otra ruta bajo el mismo repo.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fsDelLugarReal, fsReal, gitReal } from "../src/entorno.ts";
import { carpetaFueraDeUnRepo, comandoConLaCarpeta } from "../src/guardado/fuera-del-repo.ts";
import { asegurarProteccionDeGit, mirarProteccionDeGit } from "../src/guardado/repo.ts";

const ENV = { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: "/nonexistent" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, env: ENV, encoding: "utf8" });

let tmp: string;
let casa: string;
let afuera: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "supcoflow-fuera-")));
  casa = join(tmp, "casa");
  afuera = join(tmp, "afuera");
  mkdirSync(casa, { recursive: true });
  mkdirSync(afuera, { recursive: true });
  git(casa, "init", "-q");
});
afterEach(() => {
  try { chmodSync(afuera, 0o700); } catch { /* no existe */ }
  rmSync(tmp, { recursive: true, force: true });
});

const buscar = (candidatos: string[], usuario = "501") => carpetaFueraDeUnRepo({ fs: fsDelLugarReal, candidatos, usuario });

describe("carpetaFueraDeUnRepo", () => {
  it("elige una carpeta que existe, se puede escribir y no está en ningún repo; es una subcarpeta propia del usuario", () => {
    expect(buscar([afuera])).toBe(join(afuera, "supcoflow-501"));
  });

  it("no crea nada: mirar no escribe", () => {
    buscar([afuera]);
    expect(readdirSync(afuera)).toEqual([]);
  });

  it("salta una candidata que cae dentro del mismo repo y usa la siguiente", () => {
    mkdirSync(join(casa, ".config"), { recursive: true });
    expect(buscar([join(casa, ".config"), casa, afuera])).toBe(join(afuera, "supcoflow-501"));
  });

  it("salta una candidata que es un enlace hacia dentro de un repo (la ruta real es la que cuenta)", () => {
    const enlace = join(tmp, "enlace");
    symlinkSync(casa, enlace);
    expect(buscar([enlace, afuera])).toBe(join(afuera, "supcoflow-501"));
  });

  it("si todas las candidatas están en un repo, no sugiere nada (nunca otra ruta bajo el mismo repo)", () => {
    expect(buscar([casa, join(casa, "x")])).toBeNull();
  });

  it("salta una candidata que no existe, que no es carpeta o que no se puede escribir", () => {
    const archivo = join(tmp, "archivo");
    writeFileSync(archivo, "x");
    const sinPermiso = join(tmp, "sin-permiso");
    mkdirSync(sinPermiso, { recursive: true });
    chmodSync(sinPermiso, 0o500);
    try {
      expect(buscar([join(tmp, "no-existe"), archivo, sinPermiso, afuera])).toBe(join(afuera, "supcoflow-501"));
    } finally {
      chmodSync(sinPermiso, 0o700);
    }
  });

  it("si la subcarpeta ya existe y es una carpeta que se puede usar, la sugiere", () => {
    mkdirSync(join(afuera, "supcoflow-501"));
    expect(buscar([afuera])).toBe(join(afuera, "supcoflow-501"));
  });

  it("salta la candidata si su subcarpeta es un archivo, o una carpeta dentro de un repo (enlace)", () => {
    const otra = join(tmp, "otra");
    mkdirSync(otra);
    writeFileSync(join(afuera, "supcoflow-501"), "x");
    symlinkSync(casa, join(otra, "supcoflow-501"));
    expect(buscar([afuera, otra])).toBeNull();
  });

  it("sirve para dos usuarios distintos sin pisarse: el nombre lleva al usuario", () => {
    expect(buscar([afuera], "502")).toBe(join(afuera, "supcoflow-502"));
  });
});

describe("el aviso trae la carpeta de afuera sólo cuando mudarse arregla algo", () => {
  const dir = () => join(casa, ".config", "supcoflow");
  const mirar = (fuera?: () => string | null) => mirarProteccionDeGit({ dir: dir(), archivos: ["pruebas.json", "pruebas.json.tmp"], fs: fsReal, git: gitReal, fuera });
  const seguido = () => {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(join(dir(), "pruebas.json"), "{}");
    git(casa, "add", "-f", ".config/supcoflow/pruebas.json");
    git(casa, "commit", "-qm", "x");
  };

  it("archivo seguido: el impedimento sigue diciendo el `git rm --cached` y suma el comando con la carpeta de afuera", async () => {
    seguido();
    const p = await mirar(() => join(afuera, "supcoflow-501"));
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "git_lo_sigue" } });
    const detalle = (p as { impedimento: { detalle: string } }).impedimento.detalle;
    expect(detalle).toMatch(/git -C .* rm --cached -- \.config\/supcoflow\/pruebas\.json/);
    expect(detalle).toContain(`XDG_CONFIG_HOME=${join(afuera, "supcoflow-501")}`);
    expect(detalle).toMatch(/outside any git repo/);
    expect(existsSync(join(afuera, "supcoflow-501"))).toBe(false); // sugerir no crea
  });

  it("un .gitignore previo que no lo cubre: también", async () => {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(join(dir(), ".gitignore"), "otra-cosa\n");
    const p = await mirar(() => join(afuera, "supcoflow-501"));
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "git_no_lo_ignora" } });
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).toContain(`XDG_CONFIG_HOME=${join(afuera, "supcoflow-501")}`);
  });

  it("sin carpeta de afuera que sirva: el aviso queda como estaba, sin inventar una ruta", async () => {
    seguido();
    const p = await mirar(() => null);
    const detalle = (p as { impedimento: { detalle: string } }).impedimento.detalle;
    expect(detalle).toMatch(/rm --cached/);
    expect(detalle).not.toContain("XDG_CONFIG_HOME");
  });

  it("sin la función (como antes de este cambio), el texto es el de siempre", async () => {
    seguido();
    const p = await mirar();
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).not.toContain("XDG_CONFIG_HOME");
  });

  it("si git no contesta, mudarse afuera también sirve (afuera de un repo no se le pregunta nada a git)", async () => {
    const roto = async () => ({ codigo: 128 as number | null, stdout: "" });
    const p = await mirarProteccionDeGit({ dir: dir(), archivos: ["pruebas.json"], fs: fsReal, git: roto, fuera: () => join(afuera, "supcoflow-501") });
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "git_no_contesta" } });
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).toContain("XDG_CONFIG_HOME=");
  });

  it("lo que no tiene que ver con git no lleva la sugerencia (una ruta irresoluble)", async () => {
    mkdirSync(join(casa, ".config"), { recursive: true });
    symlinkSync(join(tmp, "no-existe"), dir());
    const p = await mirar(() => join(afuera, "supcoflow-501"));
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "ruta_irresoluble" } });
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).not.toContain("XDG_CONFIG_HOME");
  });

  it("asegurar (la escritura de verdad) dice lo mismo que mirar", async () => {
    seguido();
    const p = await asegurarProteccionDeGit({ dir: dir(), archivos: ["pruebas.json", "pruebas.json.tmp"], fs: fsReal, git: gitReal, fuera: () => join(afuera, "supcoflow-501") });
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "git_lo_sigue" } });
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).toContain(`XDG_CONFIG_HOME=${join(afuera, "supcoflow-501")}`);
  });

  it("si `fuera` lanza, el aviso sale igual, sin la sugerencia", async () => {
    seguido();
    const p = await mirar(() => { throw new Error("boom"); });
    expect(p).toMatchObject({ protegido: false, impedimento: { codigo: "git_lo_sigue" } });
    expect((p as { impedimento: { detalle: string } }).impedimento.detalle).not.toContain("XDG_CONFIG_HOME");
  });
});

describe("comandoConLaCarpeta", () => {
  it("una ruta sin caracteres raros va tal cual", () => {
    expect(comandoConLaCarpeta("/var/tmp/supcoflow-501")).toBe("XDG_CONFIG_HOME=/var/tmp/supcoflow-501");
  });
  it("una ruta con espacios o comillas va entre comillas simples, para que se pueda pegar", () => {
    expect(comandoConLaCarpeta("/tmp/mi carpeta/x")).toBe("XDG_CONFIG_HOME='/tmp/mi carpeta/x'");
    expect(comandoConLaCarpeta("/tmp/it's")).toBe("XDG_CONFIG_HOME='/tmp/it'\\''s'");
  });
});
