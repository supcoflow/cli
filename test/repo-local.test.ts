import { describe, expect, it } from "vitest";
import { leerRepoLocal, repoDelOrigin, repoPedido, type Git } from "../src/repo-local.ts";

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
    expect(await repoPedido({ flagRepo: "d/otro", git, cwd: "/w/r" })).toEqual({ repo: "d/otro", raiz: null });
  });
  it("sin git ni --repo: 3 sin_repo", async () => {
    await expect(repoPedido({ flagRepo: null, git: gitFalso({}), cwd: "/tmp" })).rejects.toMatchObject({ codigo: 3, error: "sin_repo" });
  });
  it("un origin que no es GitHub se dice", async () => {
    const git = gitFalso({ "rev-parse --show-toplevel": { codigo: 0, stdout: "/w/r\n" }, "remote get-url origin": { codigo: 0, stdout: "https://gitlab.com/d/r\n" } });
    expect(await leerRepoLocal(git, "/w/r")).toEqual({ repo: null, raiz: "/w/r", motivo: "origin_no_es_github" });
  });
  it("--repo mal formado: 3", async () => {
    await expect(repoPedido({ flagRepo: "https://github.com/d/r", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
  });
  it("--repo . y .. se rechazan", async () => {
    await expect(repoPedido({ flagRepo: "d/..", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
    await expect(repoPedido({ flagRepo: "d/.", git: gitFalso({}), cwd: "/" })).rejects.toMatchObject({ codigo: 3 });
  });
});
