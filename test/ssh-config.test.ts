// El alias de SSH se reconoce LEYENDO `~/.ssh/config` como texto. Nunca se corre `ssh` ni nada: `Match exec` no se evalúa.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostnameDeAlias, lectorReal, type LectorDeConfig } from "../src/ssh-config.ts";

const HOME = "/home/u";
function lector(archivos: Record<string, string>): LectorDeConfig {
  return {
    leer: (ruta) => (ruta in archivos ? archivos[ruta]! : null),
    listar: (dir) => {
      const p = dir.endsWith("/") ? dir : dir + "/";
      const n = Object.keys(archivos).filter((r) => r.startsWith(p) && !r.slice(p.length).includes("/")).map((r) => r.slice(p.length));
      return n.length ? n : null;
    },
  };
}
const conf = (texto: string, extra: Record<string, string> = {}) => lector({ [`${HOME}/.ssh/config`]: texto, ...extra });
const hn = (alias: string, texto: string, extra?: Record<string, string>) => hostnameDeAlias(alias, conf(texto, extra), HOME);

describe("el bloque `Host <alias>` y su `HostName`", () => {
  it("el caso común", () => {
    expect(hn("github-gf0", "Host github-gf0\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_gf0\n")).toBe("github.com");
  });
  it("palabras en cualquier mayúscula, `=`, comillas y comentarios", () => {
    expect(hn("a", "# mi config\nhost a\n\thostname=ssh.github.com\n")).toBe("ssh.github.com");
    expect(hn("a", 'Host "a"\n  HostName = "github.com"\n')).toBe("github.com");
  });
  it("varios patrones en el Host, negaciones y comodines", () => {
    expect(hn("b", "Host a b c\n  HostName github.com\n")).toBe("github.com");
    expect(hn("gh-work", "Host gh-*\n  HostName github.com\n")).toBe("github.com");
    expect(hn("gh-x", "Host gh-? \n  HostName github.com\n")).toBe("github.com");
    expect(hn("gh-xx", "Host gh-?\n  HostName github.com\n")).toBeNull();
    expect(hn("gh-bad", "Host gh-* !gh-bad\n  HostName github.com\n")).toBeNull();
    expect(hn("GH-Work", "Host gh-work\n  HostName github.com\n")).toBe("github.com");
  });
  it("gana el primer HostName que aplica (como ssh), también el de `Host *` y el global", () => {
    expect(hn("a", "Host a\n  HostName gitlab.com\nHost *\n  HostName github.com\n")).toBe("gitlab.com");
    expect(hn("a", "Host *\n  HostName github.com\nHost a\n  HostName gitlab.com\n")).toBe("github.com");
    expect(hn("a", "HostName github.com\nHost a\n  HostName gitlab.com\n")).toBe("github.com");
  });
  it("un Host que no es este alias no cuenta", () => {
    expect(hn("a", "Host b\n  HostName github.com\n")).toBeNull();
    expect(hn("a", "Host a\n  User git\n")).toBeNull();
    expect(hn("a", "")).toBeNull();
  });
  it("sin archivo: null", () => {
    expect(hostnameDeAlias("a", lector({}), HOME)).toBeNull();
  });
  it("un HostName con `%` (sustitución) o con espacios raros no se interpreta", () => {
    expect(hn("a", "Host a\n  HostName %h.github.com\n")).toBeNull();
    expect(hn("a", "Host a\n  HostName ${X}\n")).toBeNull();
  });
});

describe("los bloques `Match` se ignoran por completo (sólo se miran como texto, nunca se evalúan)", () => {
  it("si el alias sólo se resuelve por Match: no se acepta", () => {
    expect(hn("a", 'Match originalhost a exec "true"\n  HostName github.com\n')).toBeNull();
    expect(hn("a", "Match host a\n  HostName github.com\n")).toBeNull();
  });
  it("un Match que no toca HostName no estorba; un Match con HostName ANTES del Host que decide deja la duda y no se acepta", () => {
    expect(hn("a", "Match host b\n  User x\nHost a\n  HostName github.com\n")).toBe("github.com");
    expect(hn("a", "Match host a\n  HostName gitlab.com\nHost a\n  HostName github.com\n")).toBeNull();
  });
  it("el caso de la revisión (H1/H2): un Match con exec que depende del puerto y apunta a otro lado antes del Host: duda, no se acepta", () => {
    expect(hn("port-review", 'Match originalhost port-review exec "test %p = 2222"\n  HostName gitlab.com\nHost port-review\n  HostName github.com\n')).toBeNull();
  });
  it("un Match DESPUÉS del que decide no cambia nada (gana el primero)", () => {
    expect(hn("a", "Host a\n  HostName github.com\nMatch host a\n  HostName gitlab.com\n")).toBe("github.com");
  });
  it("lo que está bajo un Match no es del Host anterior", () => {
    expect(hn("a", "Host a\n  User git\nMatch all\n  HostName github.com\n")).toBeNull();
  });
});

describe("Include, si es simple", () => {
  const ARCH = (extra: Record<string, string>) => extra;
  it("ruta relativa (a ~/.ssh), con ~ y absoluta", () => {
    expect(hn("a", "Include extra\n", { [`${HOME}/.ssh/extra`]: "Host a\n  HostName github.com\n" })).toBe("github.com");
    expect(hn("a", "Include ~/otro/cfg\n", { [`${HOME}/otro/cfg`]: "Host a\n  HostName github.com\n" })).toBe("github.com");
    expect(hn("a", "Include /etc/ssh/extra\n", { "/etc/ssh/extra": "Host a\n  HostName github.com\n" })).toBe("github.com");
  });
  it("un `*` en el nombre del archivo, en orden alfabético", () => {
    const r = hn("a", "Include config.d/*\n", ARCH({
      [`${HOME}/.ssh/config.d/20-b`]: "Host a\n  HostName gitlab.com\n",
      [`${HOME}/.ssh/config.d/10-a`]: "Host a\n  HostName github.com\n",
    }));
    expect(r).toBe("github.com");
  });
  it("el Include cuenta en su lugar: antes o después de un Host", () => {
    expect(hn("a", "Host a\n  HostName github.com\nInclude x\n", { [`${HOME}/.ssh/x`]: "Host a\n  HostName gitlab.com\n" })).toBe("github.com");
    expect(hn("a", "Include x\nHost a\n  HostName github.com\n", { [`${HOME}/.ssh/x`]: "Host a\n  HostName gitlab.com\n" })).toBe("gitlab.com");
  });
  it("un archivo que falta se ignora (como ssh)", () => {
    expect(hn("a", "Include falta\nHost a\n  HostName github.com\n")).toBe("github.com");
  });
  it("lo no simple (variables, `?`, `[`, `{`, comodín en la carpeta, `%`) deja la duda: null, sin adivinar", () => {
    for (const inc of ["${HOME}/x", "x?", "x[1]", "x{a,b}", "dir*/x", "%d/x", "**/x"]) {
      expect(hn("a", `Include ${inc}\nHost a\n  HostName github.com\n`)).toBeNull();
    }
  });
  it("ciclos y exceso de archivos no cuelgan: null", () => {
    expect(hn("a", "Include c1\n", { [`${HOME}/.ssh/c1`]: "Include c1\n" })).toBeNull();
  });
  it("un Include dentro de un Match que trae HostName no se acepta", () => {
    expect(hn("a", "Match host a\n  Include x\n", { [`${HOME}/.ssh/x`]: "HostName github.com\n" })).toBeNull();
  });
});

describe("nada se ejecuta: con archivos de verdad, un Match exec / ProxyCommand / LocalCommand no corre", () => {
  it("el marcador no aparece, el alias se lee como texto y el resultado es el esperado", () => {
    const home = mkdtempSync(join(tmpdir(), "scf-ssh-"));
    const marca = join(home, "EJECUTADO");
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "config"), [
      `Match originalhost trampa exec "touch ${marca}"`,
      "  User git",
      `Host trampa`,
      `  HostName github.com`,
      `  ProxyCommand touch ${marca}`,
      `  LocalCommand touch ${marca}`,
      `  PermitLocalCommand yes`,
      `Host solo-match`,
      `Match originalhost solo-match exec "touch ${marca}"`,
      `  HostName github.com`,
      "",
    ].join("\n"));
    expect(hostnameDeAlias("trampa", lectorReal, home)).toBe("github.com");
    expect(hostnameDeAlias("solo-match", lectorReal, home)).toBeNull();
    expect(existsSync(marca)).toBe(false);
  });
  it("un Include que apunta a algo enorme o a una carpeta no se lee: null", () => {
    const home = mkdtempSync(join(tmpdir(), "scf-ssh-"));
    mkdirSync(join(home, ".ssh", "carpeta"), { recursive: true });
    writeFileSync(join(home, ".ssh", "config"), "Include carpeta\nHost a\n  HostName github.com\n");
    expect(hostnameDeAlias("a", lectorReal, home)).toBe("github.com");
    writeFileSync(join(home, ".ssh", "enorme"), "# " + "x".repeat(400 * 1024));
    writeFileSync(join(home, ".ssh", "config"), "Include enorme\nHost a\n  HostName github.com\n");
    expect(hostnameDeAlias("a", lectorReal, home)).toBeNull();
  });
  it("ni ssh-config.ts ni repo-local.ts pueden lanzar procesos", () => {
    for (const f of ["../src/ssh-config.ts", "../src/repo-local.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/child_process|execFile|spawn|execSync/);
    }
  });
});
