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

describe("revisión 1, hallazgo 1: las credenciales se quitan ANTES de recortar", () => {
  const FALSA = "FAKE_TOKEN_";
  it.each([150, 190, 199, 200, 201, 260, 400])("el `@` queda en la posición %i de la URL: no sale nada de la clave", (pos) => {
    const prefijo = "https://alice:";
    const clave = FALSA.repeat(Math.ceil((pos - prefijo.length) / FALSA.length)).slice(0, Math.max(1, pos - prefijo.length));
    const url = `${prefijo}${clave}@gitlab.com/o/r.git`;
    const m = origenParaMostrar(url);
    expect(m).not.toContain("FAKE");
    expect(m).not.toContain("alice");
    expect(m).toBe("https://gitlab.com/o/r.git");
  });
  it("una clave con `@` adentro y otra sin usuario tampoco salen", () => {
    expect(origenParaMostrar("https://u:cla@ve@gitlab.com/o/r")).toBe("https://gitlab.com/o/r");
    expect(origenParaMostrar("https://:" + "x".repeat(300) + "@gitlab.com/o/r")).toBe("https://gitlab.com/o/r");
  });
  it("lo que no se interpreta no se muestra crudo; lo largo se recorta DESPUÉS", () => {
    expect(origenParaMostrar("algo raro con scf_secreto")).toBe("(an address I don't recognize)");
    expect(origenParaMostrar("https://gitlab.com/" + "a".repeat(500)).length).toBeLessThanOrEqual(201);
  });
  it("en el mensaje final de un comando que exige clon", async () => {
    const git = gitFalso({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "https://alice:" + FALSA.repeat(25) + "@gitlab.com/o/r.git\n" }, ...SIN_REMOTO });
    const r = await repoPedido({ flagRepo: "o/r", git, cwd: "/w" });
    expect(r.sinClon).not.toContain("FAKE");
    expect(r.sinClon).toContain("`https://gitlab.com/o/r.git`");
  });
});

// ─── el alias de SSH se resuelve con `ssh -G` (sólo si hay con qué resolverlo) ───
import { resolverAliasConSsh, type ResolverAlias } from "../src/repo-local.ts";

function gitConResolutor(t: Record<string, { codigo: number | null; stdout: string }>, resolver: ResolverAlias | undefined) {
  const git = gitFalso(t) as Git & { resolverAlias?: ResolverAlias };
  if (resolver) git.resolverAlias = resolver;
  return git;
}
const llamadas: { host: string; usuario: string }[] = [];
const resuelveA = (hostname: string | null): ResolverAlias => async (host, usuario) => { llamadas.push({ host, usuario }); return hostname; };

describe("el origin con alias de SSH que resuelve a github.com", () => {
  it("git@github-gf0:owner/repo.git con `ssh -G` → github.com: es ese repo de GitHub, con la raíz", async () => {
    llamadas.length = 0;
    const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA("github.com"));
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "germanflores0/geolanding", raiz: "/w/geo" });
    expect(llamadas).toEqual([{ host: "github-gf0", usuario: "git" }]);
  });
  it("también la forma ssh://git@alias/owner/repo, y ssh.github.com (el SSH por el puerto 443 de GitHub)", async () => {
    const git = gitConResolutor({ ...TOP, "remote get-url origin": { codigo: 0, stdout: "ssh://git@github-gf0:2222/d/r\n" }, ...SIN_REMOTO }, resuelveA("ssh.github.com"));
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "d/r", raiz: "/w/geo" });
  });
  it("el host real se compara exacto (sin mayúsculas ni punto final de más) y no cuenta lo que sólo lo contiene", async () => {
    for (const real of ["GitHub.com", "github.com."]) {
      const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA(real));
      expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "germanflores0/geolanding", raiz: "/w/geo" });
    }
    for (const real of ["github.com.evil.com", "evil-github.com", "gitlab.com", "github-gf0", "notgithub.com"]) {
      const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA(real));
      const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
      expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
    }
  });
  it("si resuelve a otro servidor: 3 sin_repo, lo dice y sugiere --repo y el remoto supcoflow", async () => {
    const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA("gitlab.com"));
    const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
    expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
    expect(e.message).toContain("Your origin uses the SSH alias `github-gf0`, which ssh resolves to `gitlab.com`, not github.com.");
    expect(e.message).toContain("`git remote add supcoflow https://github.com/germanflores0/geolanding.git`");
    expect(e.message).toMatch(/Pass --repo owner\/repo\.$/);
  });
  it("si no se pudo resolver (sin ssh, plazo, sin hostname): mismo error de antes, ahora dice que no se pudo y sugiere --repo", async () => {
    const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA(null));
    const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
    expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
    expect(e.message).toContain("Your origin uses the SSH alias `github-gf0`, and I couldn't resolve it with ssh.");
    expect(e.message).toContain("Pass --repo owner/repo.");
  });
  it("un resolutor que explota cuenta como «no se pudo», no tumba el comando", async () => {
    const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, async () => { throw new Error("boom"); });
    const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
    expect(e).toMatchObject({ codigo: 3, error: "sin_repo" });
  });
  it("con un origin de GitHub directo, o sin alias, nunca se corre ssh", async () => {
    llamadas.length = 0;
    for (const url of ["git@github.com:a/b.git", "https://gitlab.com/a/b.git", "git@alias:d/r;rm -rf"]) {
      const git = gitConResolutor({ ...TOP, "remote get-url origin": { codigo: 0, stdout: url + "\n" }, ...SIN_REMOTO }, resuelveA("github.com"));
      await leerRepoLocal(git, "/w/geo");
    }
    expect(llamadas).toEqual([]);
  });
  it("un alias que empieza con `-` (sería una opción de ssh) no se resuelve nunca", async () => {
    llamadas.length = 0;
    for (const url of ["git@-alias:d/r.git", "-o@alias:d/r.git"]) {
      const git = gitConResolutor({ ...TOP, "remote get-url origin": { codigo: 0, stdout: url + "\n" }, ...SIN_REMOTO }, resuelveA("github.com"));
      const local = await leerRepoLocal(git, "/w/geo");
      expect(local.repo).toBeNull();
    }
    expect(llamadas).toEqual([]);
  });
  it("si el alias resuelve a GitHub gana sobre un remoto supcoflow distinto (como con origin directo)", async () => {
    const git = gitConResolutor({ ...TOP, ...ALIAS, "remote get-url supcoflow": { codigo: 0, stdout: "https://github.com/otro/repo.git\n" } }, resuelveA("github.com"));
    expect(await repoPedido({ flagRepo: null, git, cwd: "/w/geo" })).toEqual({ repo: "germanflores0/geolanding", raiz: "/w/geo" });
  });
  it("--repo con el mismo repo y un alias que resuelve a GitHub: sirve la raíz de este clon", async () => {
    const git = gitConResolutor({ ...TOP, ...ALIAS, ...SIN_REMOTO }, resuelveA("github.com"));
    expect(await repoPedido({ flagRepo: "germanflores0/geolanding", git, cwd: "/w/geo" })).toMatchObject({ raiz: "/w/geo" });
  });
  it("sin resolutor (los tests y todo lo demás) el comportamiento es el de siempre", async () => {
    const git = gitFalso({ ...TOP, ...ALIAS, ...SIN_REMOTO });
    const e = await repoPedido({ flagRepo: null, git, cwd: "/w/geo" }).catch((x) => x);
    expect(e.message).toContain("which I don't resolve.");
  });
});

describe("resolverAliasConSsh: lee el `hostname` de `ssh -G`", () => {
  const ejecutar = (stdout: string, codigo: number | null = 0) => {
    const pedidos: string[][] = [];
    return { pedidos, run: async (args: string[]) => { pedidos.push(args); return { codigo, stdout }; } };
  };
  it("corre `ssh -G -- usuario@host` y devuelve el hostname", async () => {
    const e = ejecutar("user git\nhostname github.com\nport 22\nidentityfile ~/.ssh/id_gf0\n");
    expect(await resolverAliasConSsh(e.run)("github-gf0", "git")).toBe("github.com");
    expect(e.pedidos).toEqual([["-G", "--", "git@github-gf0"]]);
  });
  it("falla de ssh, sin línea hostname o un hostname raro: null", async () => {
    expect(await resolverAliasConSsh(ejecutar("hostname github.com\n", 255).run)("a", "git")).toBeNull();
    expect(await resolverAliasConSsh(ejecutar("", null).run)("a", "git")).toBeNull();
    expect(await resolverAliasConSsh(ejecutar("port 22\n").run)("a", "git")).toBeNull();
    expect(await resolverAliasConSsh(ejecutar("hostname github.com; rm -rf\n").run)("a", "git")).toBeNull();
  });
  it("host o usuario que empiezan con `-`: no corre nada", async () => {
    const e = ejecutar("hostname github.com\n");
    expect(await resolverAliasConSsh(e.run)("-oProxyCommand=x", "git")).toBeNull();
    expect(await resolverAliasConSsh(e.run)("a", "-l")).toBeNull();
    expect(e.pedidos).toEqual([]);
  });
});
