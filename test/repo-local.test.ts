import { describe, expect, it } from "vitest";
import { aliasDelOrigin, comandoDeAsociacion, leerRepoLocal, origenParaMostrar, repoDelOrigin, repoPedido, type Git } from "../src/repo-local.ts";

describe("repoDelOrigin (Review Focus 3)", () => {
  it.each([
    ["https://github.com/Duenio/Repo.git", "Duenio/Repo"],
    ["https://github.com/duenio/repo/", "duenio/repo"],
    ["git@github.com:duenio/repo.git", "duenio/repo"],
    ["ssh://git@github.com/duenio/repo", "duenio/repo"],
    ["https://gitlab.com/duenio/repo.git", null],
    ["https://github.com/duenio", null],
    ["https://evil.com/github.com/duenio/repo", null],
  ])("%s → %s", (url, esperado) => expect(repoDelOrigin(url)).toBe(esperado));
});

function gitFalso(t: Record<string, { codigo: number | null; stdout: string }>): Git {
  return async (args) => t[args.join(" ")] ?? { codigo: 128, stdout: "" };
}

describe("el repo que se pide", () => {
  it("del origin, con la raíz", async () => {
    const git = gitFalso({ "rev-parse --show-toplevel": { codigo: 0, stdout: "/w/r\n" }, "remote get-url origin": { codigo: 0, stdout: "git@github.com:d/r.git\n" } });
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/r/sub" })).toEqual({ repo: "d/r", raiz: "/w/r" });
  });
  it("--repo gana; la raíz sólo si el origin es el mismo repo", async () => {
    const git = gitFalso({ "rev-parse --show-toplevel": { codigo: 0, stdout: "/w/r\n" }, "remote get-url origin": { codigo: 0, stdout: "https://github.com/d/r\n" } });
    expect(await repoPedido({ flagRepo: "D/R", git, cwd: "/w/r" })).toEqual({ repo: "D/R", raiz: "/w/r" });
    expect(await repoPedido({ flagRepo: "d/otro", git, cwd: "/w/r" })).toMatchObject({ repo: "d/otro", raiz: null });
  });
  it("sin git ni --repo: 3 sin_repo", async () => {
    await expect(repoPedido({ flagRepo: null, git: gitFalso({}), cwd: "/tmp" })).rejects.toMatchObject({ codigo: 3, error: "sin_repo" });
  });
  it("un origin que no es GitHub se dice", async () => {
    const git = gitFalso({ "rev-parse --show-toplevel": { codigo: 0, stdout: "/w/r\n" }, "remote get-url origin": { codigo: 0, stdout: "https://gitlab.com/d/r\n" } });
    expect(await leerRepoLocal(git, "/w/r")).toEqual({ repo: null, raiz: "/w/r", motivo: "origin_no_es_github", origen: "https://gitlab.com/d/r" });
  });
  it("--repo mal formado: 3", async () => {
    await expect(repoPedido({ flagRepo: "https://github.com/d/r", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
  });
  it("--repo . y .. se rechazan", async () => {
    await expect(repoPedido({ flagRepo: "d/..", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
    await expect(repoPedido({ flagRepo: "d/.", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
  });
});

// ─── 1A.1, fricción 2a: el origin con alias de SSH y el remoto `supcoflow` ───
const TOP = { "rev-parse --show-toplevel": { codigo: 0, stdout: "/w/geo\n" } };
const ALIAS = { "remote get-url origin": { codigo: 0, stdout: "git@github-gf0:germanflores0/geolanding.git\n" } };
const SIN_REMOTO = { "remote get-url supcoflow": { codigo: 2, stdout: "" } };

describe("el origin con alias de SSH (nunca se corre ssh ni se lee su configuración)", () => {
  it("alias y sin remoto supcoflow: 3 sin_repo con el comando exacto para asociarlo", async () => {
    const git = gitFalso({ ...TOP, ...ALIAS, ...SIN_REMOTO });
    const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
    expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
    expect(e.message).toBe(
      "I couldn't find a GitHub repo here (the \"origin\" remote isn't a GitHub repo). Your origin uses the SSH alias `github-gf0`, which I don't resolve. "
      + "If this is germanflores0/geolanding on GitHub, tell me once: `git remote add supcoflow https://github.com/germanflores0/geolanding.git` (it's never fetched). Pass --repo owner/repo.",
    );
  });
  it("alias más un remoto supcoflow de GitHub: ok, con la raíz", async () => {
    const git = gitFalso({ ...TOP, ...ALIAS, "remote get-url supcoflow": { codigo: 0, stdout: "https://github.com/germanflores0/geolanding.git\n" } });
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo/sub" })).toEqual({ repo: "germanflores0/geolanding", raiz: "/w/geo" });
    expect(await repoPedido({ flagRepo: "GermanFlores0/Geolanding", git, cwd: "/w/geo" })).toMatchObject({ raiz: "/w/geo" });
  });
  it("un remoto supcoflow que no es de GitHub no cuenta (el host se compara exacto) y el comando pasa a ser set-url", async () => {
    for (const url of ["https://gitlab.com/x/y.git", "https://evil.com/github.com/x/y", "git@github-gf0:x/y.git", "https://github.com.evil.com/x/y"]) {
      const git = gitFalso({ ...TOP, ...ALIAS, "remote get-url supcoflow": { codigo: 0, stdout: url + "\n" } });
      const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
      expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
      expect(e.message).toContain("`git remote set-url supcoflow https://github.com/germanflores0/geolanding.git`");
    }
  });
  it("si origin es de GitHub gana origin, aunque haya un remoto supcoflow distinto", async () => {
    const git = gitFalso({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "git@github.com:a/b.git\n" }, "remote get-url supcoflow": { codigo: 0, stdout: "https://github.com/otro/repo.git\n" } });
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "a/b", raiz: "/w/geo" });
    expect(await repoPedido({ flagRepo: "otro/repo", git, cwd: "/w/geo" })).toMatchObject({ raiz: null });
  });
  it("sin origin pero con remoto supcoflow de GitHub: sirve", async () => {
    const git = gitFalso({ ...TOP, "remote get-url supcoflow": { codigo: 0, stdout: "git@github.com:a/b.git\n" } });
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "a/b", raiz: "/w/geo" });
  });
  it("las formas de alias; github.com y lo mal formado no son alias", () => {
    expect(aliasDelOrigin("git@github-gf0:d/r.git")).toEqual({ host: "github-gf0", repo: "d/r" });
    expect(aliasDelOrigin("ssh://git@github-gf0/d/r")).toEqual({ host: "github-gf0", repo: "d/r" });
    expect(aliasDelOrigin("ssh://git@github-gf0:2222/d/r.git")).toEqual({ host: "github-gf0", repo: "d/r" });
    expect(aliasDelOrigin("git@github.com:d/r.git")).toBeNull();
    expect(aliasDelOrigin("git@alias:d/r;rm -rf")).toBeNull();
    expect(aliasDelOrigin("https://gitlab.com/d/r")).toBeNull();
    expect(aliasDelOrigin("git@alias:d/..")).toBeNull();
  });
  it("el comando sugerido sólo lleva caracteres de un dueño/repo válido", () => {
    expect(comandoDeAsociacion("d/r", false)).toBe("git remote add supcoflow https://github.com/d/r.git");
    expect(comandoDeAsociacion("d/r", true)).toBe("git remote set-url supcoflow https://github.com/d/r.git");
  });
  it("lo que se muestra de un origin nunca lleva usuario:clave@", () => {
    expect(origenParaMostrar("https://usuario:scf_secreto@gitlab.com/d/r.git")).toBe("https://gitlab.com/d/r.git");
    expect(origenParaMostrar("https://tokensolo@gitlab.com/d/r.git")).toBe("https://gitlab.com/d/r.git");
    expect(origenParaMostrar("ssh://git@gitlab.com/d/r.git")).toBe("ssh://git@gitlab.com/d/r.git");
    expect(origenParaMostrar("git@gitlab.com:d/r.git")).toBe("git@gitlab.com:d/r.git");
  });
});

describe("--repo con un clon que no se puede atar (2b): el mensaje dice la verdad", () => {
  it("un clon de otro servidor: no se da la raíz, y dice qué es el clon y el comando para asociarlo", async () => {
    const git = gitFalso({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "https://gitlab.com/equipo/reservas.git\n" }, ...SIN_REMOTO });
    const r = await repoPedido({ flagRepo: "equipo/reservas", git, cwd: "/w/geo" });
    expect(r.raiz).toBeNull();
    expect(r.sinClon).toBe("This clone is `https://gitlab.com/equipo/reservas.git`, which I can't tie to github.com/equipo/reservas. If this is equipo/reservas on GitHub, tell me once: `git remote add supcoflow https://github.com/equipo/reservas.git` (it's never fetched).");
  });
  it("un clon de otro repo de GitHub, o una carpeta que no es un clon", async () => {
    const otro = gitFalso({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "https://github.com/a/b\n" } });
    expect((await repoPedido({ flagRepo: "x/y", git: otro, cwd: "/w" })).sinClon).toBe("This clone is github.com/a/b, not x/y.");
    expect((await repoPedido({ flagRepo: "x/y", git: gitFalso({}), cwd: "/tmp" })).sinClon).toBe("This folder isn't a git clone.");
  });
  it("el mensaje no lleva el usuario:clave@ del origin", async () => {
    const git = gitFalso({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "https://u:scf_secreto@gitlab.com/e/r.git\n" }, ...SIN_REMOTO });
    expect((await repoPedido({ flagRepo: "e/r", git, cwd: "/w" })).sinClon).not.toContain("scf_secreto");
  });
});
