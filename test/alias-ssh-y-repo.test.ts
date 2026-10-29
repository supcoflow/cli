// V-1 (1A.1, fricciones 2a y 2b): un clon con alias de SSH o de otro servidor, con y sin el remoto `supcoflow`, y qué
// hacen `guide check`, `guide publish`, `install record` y `project create` con `--repo`. El test mira a qué proyecto
// y con qué contenido llegó el pedido, no sólo que llegó.
import { describe, expect, it } from "vitest";
import { guiaPublicar, guiaRevisar, type DepsDeGuia } from "../src/comandos/guia.ts";
import { instalacionAnotar, type DepsDeInstalacion } from "../src/comandos/instalacion.ts";
import { proyectoCrear, type DepsDeProyecto } from "../src/comandos/proyecto.ts";
import type { Git } from "../src/repo-local.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_reservas-1", slug: "reservas", repo: "equipo/reservas", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const GUIA = "## A\nWhat it's for: x\n";
const R = (status: number, cuerpo: unknown) => ({ status, cuerpo }) as never;
const guardado = { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never;

// Un clon cuyo `origin` y cuyo remoto `supcoflow` son los que se pasan (null = no existe).
function clon(origin: string | null, supcoflow: string | null): Git {
  return async (args) => {
    if (args[0] === "rev-parse") return { codigo: 0, stdout: "/w/reservas\n" };
    if (args[0] === "remote") {
      const url = args[2] === "origin" ? origin : args[2] === "supcoflow" ? supcoflow : null;
      return url === null ? { codigo: 2, stdout: "" } : { codigo: 0, stdout: url + "\n" };
    }
    return { codigo: 1, stdout: "" };
  };
}
const GITLAB = clon("https://gitlab.com/equipo/reservas.git", null);
const ALIAS_CON_REMOTO = clon("git@github-gf0:equipo/reservas.git", "https://github.com/equipo/reservas.git");

function depsDeGuia(git: Git) {
  const pedidos: { que: string; proyecto: string; cuerpo?: unknown }[] = [];
  const lecturas: string[] = [];
  const buscados: string[] = [];
  const d: DepsDeGuia = {
    api: new URL("http://localhost:3000"), guardado, git, cwd: "/w/reservas",
    buscarProyecto: async (_a, _k, repo) => { buscados.push(repo); return PROY; },
    leerArchivoChico: (p) => { lecturas.push(p); return { bytes: new TextEncoder().encode(GUIA) }; },
    fetch: (async () => { throw new Error("sin red"); }) as never,
    gitDeclarado: async (args) => ({ codigo: 0, stdout: args.includes("--abbrev-ref") ? "main\n" : "abc1234def5678abc1234def5678abc1234def56\n" }),
    revisar: async (_a, _k, proyecto, contenido) => { pedidos.push({ que: "revisar", proyecto, cuerpo: contenido }); return R(200, { ok: true, secciones: 1 }); },
    publicar: async (_a, _k, proyecto, cuerpo) => { pedidos.push({ que: "publicar", proyecto, cuerpo }); return R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 1 }, ya_publicada: false, reemplaza: null }); },
    ver: async () => R(200, {}), elegir: async () => R(200, {}), versiones: async () => R(200, {}),
  };
  return { d, pedidos, lecturas, buscados };
}
const F = { repo: "equipo/reservas", dryRun: false, fromGithub: false };

describe("V-1 (c): un clon de gitlab.com con --repo equipo/reservas no es ese repo", () => {
  it("guide check y guide publish salen 3, sin pedido al motor ni lectura del clon, y el mensaje dice la verdad", async () => {
    for (const comando of [guiaRevisar, guiaPublicar]) {
      const { d, pedidos, lecturas, buscados } = depsDeGuia(GITLAB);
      const r = await comando(d, F);
      expect(r).toMatchObject({ codigo: 3, json: { ok: false, error: "falta_guia" } });
      expect(r.texto).toBe(
        "This clone is `https://gitlab.com/equipo/reservas.git`, which I can't tie to github.com/equipo/reservas. "
        + "If this is equipo/reservas on GitHub, tell me once: `git remote add supcoflow https://github.com/equipo/reservas.git` (it's never fetched). "
        + "The guide is read from .supcoflow/guide.md in the repo's clone: stand in it.",
      );
      expect(r.texto).not.toMatch(/I don't have that repo's clone/);
      expect([pedidos, lecturas, buscados]).toEqual([[], [], []]);
    }
  });

  it("install record sale 3 sin_clon, sin pedido al motor ni archivo escrito", async () => {
    const llamadas: string[] = [];
    const d = {
      api: new URL("http://localhost:3000"), guardado, git: GITLAB, cwd: "/w/reservas",
      buscarProyecto: async () => { llamadas.push("buscar"); return PROY; },
      leerConfiguracion: async () => { llamadas.push("configuracion"); throw new Error("no"); },
      leerArchivoChico: () => { llamadas.push("leer"); return { error: "x" }; },
      rutaReal: () => { llamadas.push("rutaReal"); return null; }, esCarpeta: () => false, esEnlace: () => false,
      escribir: () => void llamadas.push("escribir"), avisar: () => {}, terminal: "0.8.1",
    } as DepsDeInstalacion;
    const r = await instalacionAnotar(d, { repo: "equipo/reservas", dryRun: false, skill: "0.3.1", app: null });
    expect(r).toMatchObject({ codigo: 3, json: { ok: false, error: "sin_clon" } });
    expect(r.texto).toMatch(/^This clone is `https:\/\/gitlab\.com\/equipo\/reservas\.git`, which I can't tie to github\.com\/equipo\/reservas\. .*git remote add supcoflow https:\/\/github\.com\/equipo\/reservas\.git/);
    expect(llamadas).toEqual([]);
  });

  it("project create --repo conserva su operación remota, pero no lee ni escribe ese clon (archivo: null)", async () => {
    const leidos: string[] = [];
    const escritos: string[] = [];
    const creados: string[] = [];
    const d = {
      api: new URL("http://localhost:3000"), guardado, git: GITLAB, cwd: "/w/reservas",
      idempotencia: { claveDe: async () => "k-1", tiene: async () => false, olvidar: async () => {} },
      buscarProyecto: async () => null,
      quienSoy: async () => ({ via: "api_key", equipo: "tnt_x", usuario: { id: "usr_1", login: "equipo", email: null }, proyecto: null }),
      ultimaConexion: async () => ({ id: "cnx_0123456789abcdef", repo: "equipo/reservas", estado: "conectado", url: "u", venceEn: "v", repoCanonico: "equipo/reservas", fallo: null }),
      crearProyecto: async (_a: URL, _k: string, conexionId: string) => { creados.push(conexionId); return { tipo: "ok", proyecto: PROY, reusado: false }; },
      leerProyecto: async () => ({ proyecto: PROY, github: { estado: "ok", verificadoEn: "2026-10-15T00:00:00.000Z" } }),
      archivos: { leer: (p: string) => { leidos.push(p); return null; }, escribir: (p: string) => void escritos.push(p) },
      avisar: () => {},
    } as unknown as DepsDeProyecto;
    const r = await proyectoCrear(d, { repo: "equipo/reservas", install: null, test: null, dryRun: false });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, proyecto: { id: "proj_reservas-1" }, archivo: null } });
    expect(creados).toEqual(["cnx_0123456789abcdef"]);
    expect([leidos, escritos]).toEqual([[], []]);
  });
});

describe("V-1 (b) y (e): con el remoto `supcoflow` de GitHub, el alias queda atado", () => {
  it("guide check y guide publish andan sin --repo y llegan al proyecto de ese repo con el contenido de ESE clon", async () => {
    for (const flags of [{ ...F, repo: null }, F]) {
      const a = depsDeGuia(ALIAS_CON_REMOTO);
      expect(await guiaRevisar(a.d, flags)).toMatchObject({ codigo: 0, json: { ok: true } });
      expect(a.pedidos).toEqual([{ que: "revisar", proyecto: "proj_reservas-1", cuerpo: GUIA }]);
      expect(a.buscados).toEqual(["equipo/reservas"]);
      expect(a.lecturas[0]).toBe("/w/reservas/.supcoflow/guide.md");
      expect(a.lecturas.every((l) => l.startsWith("/w/reservas/.supcoflow/"))).toBe(true);

      const b = depsDeGuia(ALIAS_CON_REMOTO);
      expect(await guiaPublicar(b.d, flags)).toMatchObject({ codigo: 0, json: { ok: true } });
      expect(b.pedidos).toHaveLength(1);
      expect(b.pedidos[0]).toMatchObject({ que: "publicar", proyecto: "proj_reservas-1", cuerpo: { contenido: GUIA, ruta: ".supcoflow/guide.md" } });
    }
  });

  it("install record pasa de largo la etapa del clon y busca el proyecto de ese repo", async () => {
    const buscados: string[] = [];
    const d = {
      api: new URL("http://localhost:3000"), guardado, git: ALIAS_CON_REMOTO, cwd: "/w/reservas",
      buscarProyecto: async (_a: URL, _k: string, repo: string) => { buscados.push(repo); return PROY; },
      leerConfiguracion: async () => { throw new Error("corte"); },
      leerArchivoChico: () => ({ error: "x" }), rutaReal: (p: string) => p, esCarpeta: () => true, esEnlace: () => false,
      escribir: () => {}, avisar: () => {}, terminal: "0.8.1",
    } as unknown as DepsDeInstalacion;
    const r = await instalacionAnotar(d, { repo: null, dryRun: false, skill: "0.3.1", app: null });
    expect(r.json.error).not.toBe("sin_clon");
    expect(buscados).toEqual(["equipo/reservas"]);
  });

  it("un remoto `supcoflow` que apunta a OTRO repo de GitHub lo eligió la persona: --repo con el repo del origin no gana nada", async () => {
    const git = clon("git@github-gf0:equipo/reservas.git", "https://github.com/otro/repo.git");
    const { d, pedidos } = depsDeGuia(git);
    // La raíz es del repo que el clon declara (otro/repo): pedir equipo/reservas desde acá sigue sin ser este clon.
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(pedidos).toEqual([]);
    expect(await guiaRevisar(depsDeGuia(git).d, { ...F, repo: "otro/repo" })).toMatchObject({ codigo: 0 });
  });
});

describe("diagnose: el punto «repo» con alias de SSH dice qué asociar", () => {
  it("origin con alias y sin remoto supcoflow: no ok, con el comando; con el remoto, ok", async () => {
    const { puntoDelRepo } = await import("../src/diagnostico.ts");
    const { leerRepoLocal } = await import("../src/repo-local.ts");
    const sin = puntoDelRepo(await leerRepoLocal(clon("git@github-gf0:equipo/reservas.git", null), "/w"), "equipo/reservas");
    expect(sin).toMatchObject({ punto: "repo", ok: false });
    expect(sin.mensaje).toContain("Your origin uses the SSH alias `github-gf0`");
    expect(sin.mensaje).toContain("`git remote add supcoflow https://github.com/equipo/reservas.git`");
    expect(puntoDelRepo(await leerRepoLocal(ALIAS_CON_REMOTO, "/w"), "equipo/reservas")).toMatchObject({ punto: "repo", ok: true });
  });
});
