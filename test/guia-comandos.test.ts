// test/guia-comandos.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guiaPublicar, guiaRevisar, guiaUsar, guiaVer, guiaVersiones, type DepsDeGuia } from "../src/comandos/guia.ts";
import { huellaDeGuia, RUTA_DE_LA_GUIA, RUTA_VIEJA_DE_LA_GUIA } from "../src/guia.ts";
import { NO_LEIDO } from "../src/lectura.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const F = { repo: null, dryRun: false, fromGithub: false };
const R = (status: number, cuerpo: unknown) => ({ status, cuerpo }) as never;

type Archivo = { bytes: Uint8Array } | { error: string };
const NO_EXISTE: Archivo = { error: NO_LEIDO.noExiste };
const bytes = (t: string): Archivo => ({ bytes: new TextEncoder().encode(t) });

// `archivo` es lo que hay en `guide.md`; `viejo` lo que hay en `guia.md` (por defecto, nada). Se pregunta por el nombre.
function deps(o: Partial<DepsDeGuia> = {}, archivo: Archivo = bytes("## A\n"), viejo: Archivo = NO_EXISTE) {
  const pedidos: { que: string; args: unknown[] }[] = [];
  const lecturas: string[] = [];
  const d: DepsDeGuia = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerArchivoChico: (p) => {
      lecturas.push(p.replace("/w/r/", ""));
      return p.endsWith("guia.md") ? viejo : archivo;
    },
    fetch: (async () => { throw new Error("sin red"); }) as never,
    gitDeclarado: async (args) => ({ codigo: 0, stdout: args.includes("--abbrev-ref") ? "main\n" : `${HEAD}\n` }),
    revisar: async (...args) => { pedidos.push({ que: "revisar", args }); return R(200, { ok: true, secciones: 3 }); },
    publicar: async (...args) => { pedidos.push({ que: "publicar", args }); return R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 3 }, ya_publicada: false, reemplaza: { origen: "agente", version: 1 } }); },
    ver: async (...args) => { pedidos.push({ que: "ver", args }); return R(200, { guia: null, otra: null }); },
    elegir: async (...args) => { pedidos.push({ que: "usar", args }); return R(200, { ok: true, guia: { origen: "agente", version: 1, secciones: 2 } }); },
    versiones: async (...args) => { pedidos.push({ que: "versiones", args }); return R(200, { vigente: null, publicaciones: [] }); },
    ...o,
  };
  return { d, pedidos, lecturas };
}
const sinControl = (t: string) => expect(t.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

describe("guide check", () => {
  it("0: manda el contenido del archivo", async () => {
    const { d, pedidos } = deps();
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, secciones: 3 } });
    expect(pedidos[0]!.args.slice(2)).toEqual(["proj_r-1", "## A\n", d.fetch]);
  });
  it("sin archivo: 3 falta_guia y ningún pedido", async () => {
    const { d, pedidos } = deps({}, NO_EXISTE);
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(pedidos).toEqual([]);
  });
  it("--repo sin clon local: 3 falta_guia, «stand in the repo's clone»", async () => {
    const { d, pedidos } = deps();
    const r = await guiaRevisar(d, { repo: "otro/repo", dryRun: false });
    expect(r).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(r.texto).toMatch(/stand in the repo's clone/);
    expect(pedidos).toEqual([]);
  });
  it("archivo enorme: 3 guia_muy_grande sin pedido; enlace: 3 guia_ilegible", async () => {
    expect(await guiaRevisar(deps({}, { error: NO_LEIDO.demasiadoGrande }).d, F)).toMatchObject({ codigo: 3, json: { error: "guia_muy_grande" } });
    expect(await guiaRevisar(deps({}, { error: NO_LEIDO.esUnEnlace }).d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
  });
  it("422 guia_mal_armada: 3, errores en el JSON y una línea por error, sin control ni secretos", async () => {
    const { d } = deps({ revisar: async () => R(422, { error: "guia_mal_armada", message: "x", errores: [{ linea: 12, motivo: "missing «What it's for:»" }, { linea: 3, motivo: `there is \u001b[31m red ${CLAVE}` }] }) });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada", errores: [{ linea: 12 }, { linea: 3 }] } });
    expect(r.texto).toContain("line 12: missing «What it's for:»");
    expect(r.texto).not.toContain(CLAVE);
    sinControl(r.texto);
    expect(JSON.stringify(r.json)).not.toContain(CLAVE);
  });
  it("una clave partida por un carácter de control (U+0085) no se reconstruye al quitarlo", async () => {
    const partida = `scf_${"a".repeat(16)}\u0085_${"b".repeat(64)}`;
    const { d } = deps({ revisar: async () => R(422, { error: "guia_mal_armada", message: "x", errores: [{ linea: 3, motivo: `clave ${partida} fin` }] }) });
    const r = await guiaRevisar(d, F);
    for (const salida of [r.texto, JSON.stringify(r.json)]) {
      expect(salida).not.toContain(CLAVE);
      expect(salida).not.toMatch(/scf_[0-9a-f]{16}_[0-9a-f]{64}/);
    }
    // En el texto la clave ya no está ni partida: se quitó el control y recién ahí se tapó.
    expect(r.texto).not.toContain("b".repeat(64));
  });
  it("413 del motor: 3; 404: 3; 401: 2", async () => {
    expect((await guiaRevisar(deps({ revisar: async () => R(413, { error: "guia_muy_grande", message: "grande" }) }).d, F)).codigo).toBe(3);
    expect((await guiaRevisar(deps({ revisar: async () => R(404, { error: "no_encontrado", message: "no" }) }).d, F)).codigo).toBe(3);
    expect((await guiaRevisar(deps({ revisar: async () => R(401, { error: "x" }) }).d, F)).codigo).toBe(2);
  });
  it("--dry-run no hace el pedido", async () => {
    const { d, pedidos } = deps();
    expect((await guiaRevisar(d, { repo: null, dryRun: true })).json).toMatchObject({ dry_run: true });
    expect(pedidos).toEqual([]);
  });
  it("sin proyecto: 4 sin_proyecto", async () => {
    expect(await guiaRevisar(deps({ buscarProyecto: async () => null }).d, F)).toMatchObject({ codigo: 4, json: { error: "sin_proyecto" } });
  });
});

describe("guide publish (directa, por defecto)", () => {
  const OK = { ok: true, guia: { origen: "repo", rama: "main", commit: HEAD, secciones: 3 }, ya_publicada: false, reemplaza: { origen: "agente", version: 1 } };
  it("manda el contenido tal cual (con BOM y \\r\\n) y el commit y la rama declarados, sin huella", async () => {
    const crudo = "\ufeff## A\r\nWhat it's for: x\r\n";
    const { d, pedidos } = deps({}, bytes(crudo));
    await guiaPublicar(d, F);
    expect(pedidos[0]!.args[3]).toEqual({ contenido: crudo, ruta: RUTA_DE_LA_GUIA, commit: HEAD, rama: "main" });
  });
  it("corre git en la raíz del clon, rev-parse HEAD y --abbrev-ref HEAD", async () => {
    const llamadas: [string[], string][] = [];
    const { d } = deps({ gitDeclarado: async (a, cwd) => { llamadas.push([a, cwd]); return { codigo: 0, stdout: a.includes("--abbrev-ref") ? "main\n" : HEAD }; } });
    await guiaPublicar(d, F);
    expect(llamadas).toEqual([[["rev-parse", "HEAD"], "/w/r"], [["rev-parse", "--abbrev-ref", "HEAD"], "/w/r"]]);
  });
  for (const [nombre, gitDeclarado] of [
    ["git sale con error (sin commits o sin repo)", async () => ({ codigo: 128, stdout: "" })],
    ["git lanza (ausente o plazo)", async () => { throw new Error("ENOENT"); }],
    ["git devuelve basura en vez de un hash", async () => ({ codigo: 0, stdout: "fatal: algo\n" })],
  ] as const) {
    it(`${nombre}: no manda commit ni rama, y sube igual (0)`, async () => {
      const { d, pedidos } = deps({ gitDeclarado: gitDeclarado as never });
      const r = await guiaPublicar(d, F);
      expect(pedidos[0]!.args[3]).toEqual({ contenido: "## A\n", ruta: RUTA_DE_LA_GUIA });
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/no commit/);
    });
  }
  it("cabeza suelta: manda el commit y no la rama", async () => {
    const { d, pedidos } = deps({ gitDeclarado: async (a) => ({ codigo: 0, stdout: a.includes("--abbrev-ref") ? "HEAD\n" : HEAD }) });
    await guiaPublicar(d, F);
    expect(pedidos[0]!.args[3]).toEqual({ contenido: "## A\n", ruta: RUTA_DE_LA_GUIA, commit: HEAD });
  });
  it("0 subida: dice secciones, reemplazo y el commit como declarado", async () => {
    const { d } = deps({ publicar: async () => R(200, OK) });
    const r = await guiaPublicar(d, F);
    expect(r.codigo).toBe(0);
    expect(r.texto).toBe("Guide uploaded: 3 sections. It's the active guide (replaces our agent's v1); commit abc1234 declared by the terminal (not verified in GitHub).");
    expect(r.json).toMatchObject({ ok: true, ya_publicada: false, commit_declarado: HEAD });
  });
  it("0 ya subida: lo dice con honestidad", async () => {
    const { d } = deps({ publicar: async () => R(200, { ...OK, ya_publicada: true, reemplaza: null }) });
    const r = await guiaPublicar(d, F);
    expect(r.texto).toBe("It was already uploaded: 3 sections. It stayed as the active guide; commit abc1234 declared by the terminal (not verified in GitHub).");
  });
  it("sin commit: «no commit»", async () => {
    const { d } = deps({ gitDeclarado: async () => ({ codigo: 128, stdout: "" }), publicar: async () => R(200, OK) });
    expect((await guiaPublicar(d, F)).texto).toBe("Guide uploaded: 3 sections. It's the active guide (replaces our agent's v1); no commit.");
  });
  it("422 guia_mal_armada: 3 con errores", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(422, { error: "guia_mal_armada", message: "m", errores: [{ linea: 1, motivo: "mal" }] }) }).d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada", errores: [{ linea: 1, motivo: "mal" }] } });
    expect(r.texto).toContain("line 1: mal");
  });
  it("413 guia_muy_grande del motor: 3", async () => {
    expect((await guiaPublicar(deps({ publicar: async () => R(413, { error: "guia_muy_grande", message: "grande" }) }).d, F)).codigo).toBe(3);
  });
  it("archivo enorme: 3 guia_muy_grande sin pedido ni git", async () => {
    const llamadas: string[][] = [];
    const { d, pedidos } = deps({ gitDeclarado: async (a) => { llamadas.push(a); return { codigo: 0, stdout: "" }; } }, { error: NO_LEIDO.demasiadoGrande });
    expect(await guiaPublicar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_muy_grande" } });
    expect(pedidos).toEqual([]);
    expect(llamadas).toEqual([]);
  });
  it("no es UTF-8: 3 guia_ilegible sin pedido", async () => {
    const { d, pedidos } = deps({}, { bytes: new Uint8Array([0xff, 0xfe, 0x41]) });
    expect(await guiaPublicar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
    expect(pedidos).toEqual([]);
  });
  it("sin archivo: 3 falta_guia y ningún pedido", async () => {
    const { d, pedidos } = deps({}, NO_EXISTE);
    expect(await guiaPublicar(d, F)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(pedidos).toEqual([]);
  });
  it("sin proyecto: 4; 401: 2; 500/502 y servicio caído: 1", async () => {
    expect((await guiaPublicar(deps({ buscarProyecto: async () => null }).d, F)).codigo).toBe(4);
    expect((await guiaPublicar(deps({ publicar: async () => R(401, { error: "x" }) }).d, F)).codigo).toBe(2);
    expect((await guiaPublicar(deps({ publicar: async () => R(502, { error: "github_no_disponible", message: "m" }) }).d, F)).codigo).toBe(1);
    expect((await guiaPublicar(deps({ publicar: async () => { throw new Error("caído"); } }).d, F)).codigo).toBe(1);
  });
  for (const e of ["instalacion_ausente", "repo_fuera_de_alcance"]) {
    it(`409 ${e}: 4`, async () => {
      expect((await guiaPublicar(deps({ publicar: async () => R(409, { error: e, message: "m" }) }).d, F)).codigo).toBe(4);
    });
  }
  it("--dry-run: dice qué mandaría (commit incluido), sin huella y sin pedido", async () => {
    const { d, pedidos } = deps();
    const r = await guiaPublicar(d, { repo: null, dryRun: true });
    expect(r.json).toMatchObject({ dry_run: true, commit: HEAD, rama: "main" });
    expect(r.json).not.toHaveProperty("huella");
    expect(r.texto).toMatch(/content \(5 bytes, from \.supcoflow\/guide\.md\), commit abc1234 of main declared/);
    expect(pedidos).toEqual([]);
  });
  it("el mensaje del motor y la rama declarada salen sin secretos ni control", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(409, { error: "instalacion_ausente", message: `look \u001b[2J ${CLAVE}` }) }).d, F);
    expect(r.texto).not.toContain(CLAVE);
    sinControl(r.texto);
    const { d } = deps({ gitDeclarado: async (a) => ({ codigo: 0, stdout: a.includes("--abbrev-ref") ? "ra\u001b[2Jma\n" : HEAD }) });
    const dry = await guiaPublicar(d, { repo: null, dryRun: true });
    sinControl(dry.texto);
  });

  it("el JSON del --dry-run de la vía directa limpia rama y commit igual que el texto", async () => {
    const { d } = deps({ gitDeclarado: async (a) => ({ codigo: 0, stdout: a.includes("--abbrev-ref") ? `ra\u001b[2Jma-${CLAVE}\n` : HEAD }) });
    const dry = await guiaPublicar(d, { repo: null, dryRun: true });
    const json = dry.json as { rama: string; commit: string };
    expect(json.rama).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(json.rama).not.toContain(CLAVE);
    expect(json.commit).toBe(HEAD);
  });
});

const G = { ...F, fromGithub: true };
describe("guide publish --from-github (la vía de GitHub, intacta)", () => {
  it("manda la huella del archivo con BOM y \\r\\n, igual a la de la versión normalizada", async () => {
    const crudo = "﻿## A\r\nWhat it's for: x\r\n";
    const { d, pedidos } = deps({}, bytes(crudo));
    await guiaPublicar(d, G);
    expect(pedidos[0]!.args[3]).toEqual({ huella: huellaDeGuia(crudo) });
    expect(pedidos[0]!.args[3]).toEqual({ huella: huellaDeGuia("## A\nWhat it's for: x\n") });
  });
  it("0 publicada: dice commit, rama, secciones y el reemplazo", async () => {
    const r = await guiaPublicar(deps().d, G);
    expect(r.codigo).toBe(0);
    expect(r.texto).toBe("Guide published: commit abc1234 of main, 3 sections. It's the active guide (replaces our agent's v1).");
  });
  it("0 ya publicada", async () => {
    const { d } = deps({ publicar: async () => R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 3 }, ya_publicada: true, reemplaza: null }) });
    const r = await guiaPublicar(d, G);
    expect(r).toMatchObject({ codigo: 0, json: { ya_publicada: true } });
    expect(r.texto).toBe("It was already published: commit abc1234 of main, 3 sections. It stayed as the active guide.");
    expect(r.texto).not.toMatch(/Still/i);
  });
  for (const e of ["guia_no_subida", "guia_distinta"]) {
    it(`409 ${e}: 5 con rama y commit`, async () => {
      const r = await guiaPublicar(deps({ publicar: async () => R(409, { error: e, message: "m", rama: "main", commit: "abc1234def" }) }).d, G);
      expect(r).toMatchObject({ codigo: 5, json: { error: e, rama: "main", commit: "abc1234def" } });
      expect(r.texto).toMatch(/push the guide to the main branch and run again/);
    });
  }
  for (const e of ["instalacion_ausente", "repo_fuera_de_alcance"]) {
    it(`409 ${e}: 4`, async () => {
      expect(await guiaPublicar(deps({ publicar: async () => R(409, { error: e, message: "m" }) }).d, G)).toMatchObject({ codigo: 4, json: { error: e } });
    });
  }
  it("422 guia_mal_armada: 3 con errores", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(422, { error: "guia_mal_armada", message: "m", errores: [{ linea: 1, motivo: "mal" }] }) }).d, G);
    expect(r).toMatchObject({ codigo: 3, json: { errores: [{ linea: 1, motivo: "mal" }] } });
  });
  it("502 github_no_disponible y 500 connect_no_disponible: 1", async () => {
    expect((await guiaPublicar(deps({ publicar: async () => R(502, { error: "github_no_disponible", message: "m" }) }).d, G)).codigo).toBe(1);
    expect((await guiaPublicar(deps({ publicar: async () => R(500, { error: "connect_no_disponible", message: "m" }) }).d, G)).codigo).toBe(1);
  });
  it("un fallo del servicio que lanza (sinServicio): 1", async () => {
    expect((await guiaPublicar(deps({ publicar: async () => { throw new Error("servicio caído"); } }).d, G)).codigo).toBe(1);
  });
  it("no junta commit ni llama a git", async () => {
    const llamadas: string[][] = [];
    const { d } = deps({ gitDeclarado: async (a) => { llamadas.push(a); return { codigo: 0, stdout: HEAD }; } });
    await guiaPublicar(d, G);
    expect(llamadas).toEqual([]);
  });
  it("sin archivo: 3 falta_guia y ningún pedido; --dry-run calcula la huella y no pide", async () => {
    const a = deps({}, NO_EXISTE);
    expect(await guiaPublicar(a.d, G)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(a.pedidos).toEqual([]);
    const b = deps();
    const r = await guiaPublicar(b.d, { repo: null, dryRun: true, fromGithub: true });
    expect(r.json).toMatchObject({ dry_run: true, huella: huellaDeGuia("## A\n") });
    expect(b.pedidos).toEqual([]);
  });
  it("el mensaje del motor sale sin secretos ni control", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(409, { error: "instalacion_ausente", message: `mirá \u001b[2J ${CLAVE}` }) }).d, G);
    expect(r.texto).not.toContain(CLAVE);
    expect(JSON.stringify(r.json)).not.toContain(CLAVE);
    sinControl(r.texto);
  });
});

describe("guide show", () => {
  const repo = { origen: "repo", version: 2, repo: "d/r", rama: "main", commit: "abc1234def", secciones: 3, publicada_por: "ana" };
  it("al día", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: repo, otra: null, rama: { al_dia: true, commit: "abc1234def" } }) }).d, { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { al_dia: true } });
    expect(r.texto).toMatch(/up to date/);
  });
  it("la rama tiene otra versión: lo dice y 0", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: repo, otra: { origen: "agente", version: 1 }, rama: { al_dia: false, commit: "ffff" } }) }).d, { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { al_dia: false } });
    expect(r.texto).toContain("The branch has another version");
    expect(r.texto).toContain("`supcoflow guide publish`");
    expect(r.texto).toContain("`supcoflow guide use --source agent`");
  });
  it("origen agente y sin guía", async () => {
    const a = await guiaVer(deps({ ver: async () => R(200, { guia: { origen: "agente", version: 1, secciones: 2, aprobada_en: null }, otra: null }) }).d, { repo: null });
    expect(a.texto).toMatch(/our agent/);
    expect((await guiaVer(deps().d, { repo: null })).codigo).toBe(0);
  });
  it("sin proyecto: 4", async () => {
    expect((await guiaVer(deps({ buscarProyecto: async () => null }).d, { repo: null })).codigo).toBe(4);
  });
  describe("subida desde la terminal (commit declarado)", () => {
    const H = "a".repeat(40);
    const term = { origen: "repo", procedencia: "terminal", version: 2, repo: "d/r", secciones: 3, publicada_por: "usr_123abc" };
    const ver = (guia: object) => guiaVer(deps({ ver: async () => R(200, { guia, otra: null, rama: { al_dia: null, commit: null } }) }).d, { repo: null });
    it("con commit y rama: lo declara, sin frase de rama ni id crudo", async () => {
      const r = await ver({ ...term, commit: H, rama: "main" });
      expect(r.codigo).toBe(0);
      expect(r.texto).toContain("Uploaded from the terminal; the commit is declared, not verified in GitHub");
      expect(r.texto).toContain("commit aaaaaaa (declared)");
      expect(r.texto).toContain("branch main");
      expect(r.texto).not.toContain("I couldn't check");
      expect(r.texto).not.toContain("usr_123abc");
      expect(r.json).toMatchObject({ guia: { publicada_por: "usr_123abc" }, al_dia: null });
    });
    it("sin commit ni rama: sin comas vacías", async () => {
      const r = await ver({ ...term, commit: null, rama: null });
      expect(r.texto).toContain("no declared commit");
      expect(r.texto).not.toMatch(/branch ,|commit ,|, ,|,\./);
      expect(r.texto).not.toContain("I couldn't check");
      expect(r.texto).not.toContain("usr_123abc");
    });
  });
  it("texto de la procedencia sin caracteres de control", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: { ...repo, publicada_por: "a\u001b[31mna" }, otra: null }) }).d, { repo: null });
    sinControl(r.texto);
  });
});

describe("guide use", () => {
  const U = { repo: null, dryRun: false };
  it("sin --source: 3 falta_origen sin pedido; valor raro: 3", async () => {
    const { d, pedidos } = deps();
    expect(await guiaUsar(d, { ...U, source: null })).toMatchObject({ codigo: 3, json: { error: "falta_origen" } });
    expect((await guiaUsar(d, { ...U, source: "otro" })).codigo).toBe(3);
    expect(pedidos).toEqual([]);
  });
  it("0 con repo y con agent (a la API viaja `agente`); `agente` también vale", async () => {
    const { d, pedidos } = deps();
    expect((await guiaUsar(d, { ...U, source: "repo" })).codigo).toBe(0);
    expect(pedidos[0]!.args[3]).toBe("repo");
    expect((await guiaUsar(d, { ...U, source: "agent" })).texto).toBe("Now the active guide is our agent's.");
    expect(pedidos[1]!.args[3]).toBe("agente");
    expect((await guiaUsar(d, { ...U, source: "agente" })).codigo).toBe(0);
    expect(pedidos[2]!.args[3]).toBe("agente");
  });
  it("409 sin_guia_publicada: 3; sin_guia_del_agente: 4", async () => {
    expect((await guiaUsar(deps({ elegir: async () => R(409, { error: "sin_guia_publicada", message: "m" }) }).d, { ...U, source: "repo" })).codigo).toBe(3);
    expect(await guiaUsar(deps({ elegir: async () => R(409, { error: "sin_guia_del_agente", message: "m" }) }).d, { ...U, source: "agent" })).toMatchObject({ codigo: 4, json: { error: "sin_guia_del_agente" } });
  });
  it("--dry-run no pide", async () => {
    const { d, pedidos } = deps();
    expect((await guiaUsar(d, { repo: null, dryRun: true, source: "agent" })).json).toMatchObject({ dry_run: true });
    expect(pedidos).toEqual([]);
  });
});


// ─── T3.2 (R8): `guide.md`, con caída a `guia.md` sólo si `guide.md` NO existe ───
describe("el archivo de la guía: guide.md y el nombre viejo", () => {
  const NUEVO = "## New\n";
  const VIEJO = "## Old\n";
  const cuerpo = (pedidos: { args: unknown[] }[]) => pedidos[0]!.args[3] as { contenido: string; ruta: string };

  it("sólo guide.md: sube ese texto con ruta = guide.md y no avisa nada", async () => {
    const { d, pedidos } = deps({}, bytes(NUEVO), NO_EXISTE);
    const r = await guiaPublicar(d, F);
    expect(cuerpo(pedidos)).toMatchObject({ contenido: NUEVO, ruta: ".supcoflow/guide.md" });
    expect(r.json).not.toHaveProperty("aviso");
    expect(r.texto).not.toMatch(/old name|ignore/);
  });

  it("sólo guia.md: lo sube con ruta = guia.md y avisa el nombre viejo (texto y JSON)", async () => {
    const { d, pedidos } = deps({}, NO_EXISTE, bytes(VIEJO));
    const r = await guiaPublicar(d, F);
    expect(cuerpo(pedidos)).toMatchObject({ contenido: VIEJO, ruta: ".supcoflow/guia.md" });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ aviso: "nombre_viejo" });
    expect(r.texto).toContain("`.supcoflow/guia.md` is the old name: rename it to `guide.md`.");
  });

  it("los dos: manda guide.md, ignora guia.md y lo avisa", async () => {
    const { d, pedidos } = deps({}, bytes(NUEVO), bytes(VIEJO));
    const r = await guiaPublicar(d, F);
    expect(cuerpo(pedidos)).toMatchObject({ contenido: NUEVO, ruta: ".supcoflow/guide.md" });
    expect(r.json).toMatchObject({ aviso: "nombre_viejo_ignorado" });
    expect(r.texto).toContain("I use guide.md and ignore guia.md");
  });

  it("guide.md existe pero no se puede leer: error, NO cae al viejo (aunque guia.md sea válido)", async () => {
    for (const [motivo, error, esperado] of [
      ["demasiado grande", NO_LEIDO.demasiadoGrande, "guia_muy_grande"],
      ["un enlace", NO_LEIDO.esUnEnlace, "guia_ilegible"],
      ["no se pudo abrir", NO_LEIDO.noSePudoAbrir, "guia_ilegible"],
    ] as const) {
      const { d, pedidos } = deps({}, { error }, bytes(VIEJO));
      const r = await guiaPublicar(d, F);
      expect(r, motivo).toMatchObject({ codigo: 3, json: { error: esperado } });
      expect(r.texto, motivo).toContain(".supcoflow/guide.md");
      expect(pedidos, motivo).toEqual([]);
    }
    const noUtf8 = deps({}, { bytes: new Uint8Array([0xff, 0xfe]) }, bytes(VIEJO));
    expect(await guiaPublicar(noUtf8.d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
    expect(noUtf8.pedidos).toEqual([]);
  });

  it("guide.md leído pero que el motor rechaza (inválido) y guia.md válido: error, el motor no recibe el viejo", async () => {
    const enviados: unknown[] = [];
    const { d } = deps({ publicar: async (...args) => { enviados.push(args[3]); return R(422, { error: "guia_mal_armada", message: "m", errores: [{ linea: 2, motivo: "bad" }] }); } }, bytes("## broken\n"), bytes(VIEJO));
    const r = await guiaPublicar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada" } });
    expect(r.texto).toContain(".supcoflow/guide.md is badly formed:");
    expect(enviados).toEqual([{ contenido: "## broken\n", ruta: ".supcoflow/guide.md", commit: HEAD, rama: "main" }]);
  });

  it("ninguno de los dos: 3 falta_guia, y dice cuál se esperaba", async () => {
    const { d, pedidos } = deps({}, NO_EXISTE, NO_EXISTE);
    const r = await guiaPublicar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(r.texto).toContain(RUTA_DE_LA_GUIA);
    expect(pedidos).toEqual([]);
  });

  it("guia.md ilegible cuando guide.md no existe: error (no se adivina)", async () => {
    const { d } = deps({}, NO_EXISTE, { error: NO_LEIDO.noSePudoAbrir });
    expect(await guiaPublicar(d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
  });

  it("guide check y --dry-run también leen con la caída y dicen la ruta", async () => {
    const a = deps({}, NO_EXISTE, bytes(VIEJO));
    const r = await guiaRevisar(a.d, F);
    expect(r.json).toMatchObject({ ok: true, ruta: ".supcoflow/guia.md", aviso: "nombre_viejo" });
    expect(a.pedidos[0]!.args[3]).toBe(VIEJO);
    const dry = await guiaPublicar(deps({}, NO_EXISTE, bytes(VIEJO)).d, { repo: null, dryRun: true, fromGithub: false });
    expect(dry.json).toMatchObject({ dry_run: true, ruta: ".supcoflow/guia.md", aviso: "nombre_viejo" });
    expect(dry.texto).toContain("from .supcoflow/guia.md");
  });

  it("--from-github manda sólo la huella del archivo que se lee (el motor resuelve los nombres en su SHA)", async () => {
    const { d, pedidos } = deps({}, NO_EXISTE, bytes(VIEJO));
    const r = await guiaPublicar(d, G);
    expect(pedidos[0]!.args[3]).toEqual({ huella: huellaDeGuia(VIEJO) });
    expect(r.json).toMatchObject({ aviso: "nombre_viejo" });
  });

  it("--from-github: si el motor trae su propio aviso (leyó el repo en su SHA), manda el del motor", async () => {
    const OK = { ok: true, guia: { origen: "repo", rama: "main", commit: HEAD, secciones: 3 }, ya_publicada: false, reemplaza: null };
    const { d } = deps({ publicar: async () => R(200, { ...OK, aviso: "nombre_viejo_ignorado" }) }, bytes(NUEVO), NO_EXISTE);
    const r = await guiaPublicar(d, G);
    expect(r.json).toMatchObject({ aviso: "nombre_viejo_ignorado" });
    expect(r.texto).toContain("ignore guia.md");
  });

  it("una resubida idéntica que el motor contesta con la ruta HISTÓRICA lo dice (no aparenta una lectura nueva)", async () => {
    const OK = { ok: true, guia: { origen: "repo", rama: "main", commit: HEAD, secciones: 3, ruta: ".supcoflow/guia.md" }, ya_publicada: true, reemplaza: null };
    const { d } = deps({ publicar: async () => R(200, OK) }, bytes(NUEVO), NO_EXISTE);
    const r = await guiaPublicar(d, F);
    expect(r.texto).toContain("That version keeps the file name it was first published with (.supcoflow/guia.md).");
  });

  it("las constantes: el canónico es guide.md y el viejo guia.md", () => {
    expect(RUTA_DE_LA_GUIA).toBe(".supcoflow/guide.md");
    expect(RUTA_VIEJA_DE_LA_GUIA).toBe(".supcoflow/guia.md");
  });

  it("lee guide.md y, sólo para avisar, mira que guia.md exista; nunca lee guia.md si guide.md anda", async () => {
    const a = deps({}, bytes(NUEVO), bytes(VIEJO));
    await guiaPublicar(a.d, F);
    expect(a.lecturas).toEqual([".supcoflow/guide.md", ".supcoflow/guia.md"]);
  });
});

describe("guide show: la ruta y si es declarada", () => {
  const base = { origen: "repo", version: 2, repo: "d/r", secciones: 3, publicada_por: "usr_1", commit: "a".repeat(40), rama: "main" };
  it("subida desde la terminal: la ruta sale como declarada", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: { ...base, procedencia: "terminal", ruta: ".supcoflow/guia.md" }, otra: null, rama: { al_dia: null } }) }).d, { repo: null });
    expect(r.texto).toContain("File: .supcoflow/guia.md (declared by the terminal).");
  });
  it("por GitHub: la ruta es la leída en ese SHA, sin «declared»", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: { ...base, procedencia: "github", ruta: ".supcoflow/guide.md" }, otra: null, rama: { al_dia: true } }) }).d, { repo: null });
    expect(r.texto).toContain("File: .supcoflow/guide.md.");
    expect(r.texto).not.toContain("declared by the terminal");
  });
});

// ─── T3.5: guide versions ───
describe("guide versions", () => {
  const vigente = { origen: "repo", id: "gpb_2", version: 2, secciones: 3, procedencia: "terminal", repo: "d/r", rama: "main", commit: "a".repeat(40), ruta: ".supcoflow/guide.md" };
  const publicaciones = [
    { id: "gpb_2", version: 2, procedencia: "terminal", commit: "a".repeat(40), ruta: ".supcoflow/guide.md", publicada_por: "usr_1", publicada_en: "2026-10-28T10:00:00.000Z", live: true },
    { id: "gpb_1", version: 1, procedencia: "github", commit: "b".repeat(40), ruta: ".supcoflow/guia.md", publicada_por: "usr_1", publicada_en: "2026-10-20T10:00:00.000Z", live: false },
  ];
  it("pide la route de versiones del proyecto y devuelve {vigente, publicaciones} tal cual", async () => {
    const { d, pedidos } = deps({ versiones: async (...args) => { pedidos.push({ que: "versiones", args }); return R(200, { vigente, publicaciones }); } });
    const r = await guiaVersiones(d, { repo: null });
    expect(pedidos.find((x) => x.que === "versiones")!.args.slice(2, 3)).toEqual(["proj_r-1"]);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, vigente, publicaciones } });
  });
  it("el texto dice la que rige ahora y una sola publicación «live»", async () => {
    const { texto } = await guiaVersiones(deps({ versiones: async () => R(200, { vigente, publicaciones }) }).d, { repo: null });
    expect(texto).toContain("Active now: the repo's guide, version 2 (3 sections).");
    expect(texto).toContain("Published from the repo, newest first:");
    expect(texto.match(/ live/g)).toHaveLength(1);
    expect(texto).toMatch(/v2 live · uploaded from the terminal \(declared\) · commit aaaaaaa · \.supcoflow\/guide\.md/);
    expect(texto).toMatch(/v1 published · verified in GitHub · commit bbbbbbb · \.supcoflow\/guia\.md/);
  });
  it("vigente del agente, sin publicaciones, y sin guía", async () => {
    const a = await guiaVersiones(deps({ versiones: async () => R(200, { vigente: { origen: "agente", version: 4, secciones: 2 }, publicaciones: [] }) }).d, { repo: null });
    expect(a.texto).toContain("Active now: our agent's guide, v4 (2 sections).");
    expect(a.texto).toContain("Published from the repo: none.");
    const b = await guiaVersiones(deps().d, { repo: null });
    expect(b).toMatchObject({ codigo: 0, json: { ok: true, vigente: null, publicaciones: [] } });
    expect(b.texto).toContain("Active now: no guide.");
  });
  it("texto del motor con control o secretos sale limpio", async () => {
    const sucio = [{ ...publicaciones[0], publicada_por: `a\u001b[31mna ${CLAVE}` }];
    const r = await guiaVersiones(deps({ versiones: async () => R(200, { vigente, publicaciones: sucio }) }).d, { repo: null });
    expect(r.texto).not.toContain(CLAVE);
    sinControl(r.texto);
  });
  it("sin proyecto: 4; sin sesión del motor (401): 2; caído: 1", async () => {
    expect((await guiaVersiones(deps({ buscarProyecto: async () => null }).d, { repo: null })).codigo).toBe(4);
    expect((await guiaVersiones(deps({ versiones: async () => R(401, { error: "x" }) }).d, { repo: null })).codigo).toBe(2);
    expect((await guiaVersiones(deps({ versiones: async () => { throw new Error("caído"); } }).d, { repo: null })).codigo).toBe(1);
  });
});

// ─── T3.3: el vector de la guía de ejemplo, el mismo texto byte a byte que el del motor (T2.3) ───
describe("la guía de ejemplo (vector compartido)", () => {
  const ruta = new URL("./vectores/guia-de-ejemplo.md", import.meta.url);
  const huellas = JSON.parse(readFileSync(new URL("./vectores/huella.json", import.meta.url), "utf8")) as { ejemplo: { archivo: string; huella: string } };
  it("tiene la huella que fija huella.json (el mismo archivo que el motor): si cambia un byte, esto rompe", () => {
    expect(huellas.ejemplo.archivo).toBe("guia-de-ejemplo.md");
    expect(huellaDeGuia(readFileSync(ruta, "utf8"))).toBe(huellas.ejemplo.huella);
  });
  it("usa las etiquetas en inglés (con Where:) y ninguna castellana", () => {
    const t = readFileSync(ruta, "utf8");
    for (const e of ["What it's for:", "What users can do:", "Common problems:", "Where: /"]) expect(t).toContain(e);
    expect(t).not.toMatch(/Para qué sirve|Qué puede hacer|Problemas comunes|Dónde:/);
    expect(t).not.toMatch(/[¿¡ñáéíóú]/);
  });
  it("la terminal la lee de .supcoflow/guide.md y la manda tal cual, con su ruta", async () => {
    const texto = readFileSync(ruta, "utf8");
    const { d, pedidos } = deps({}, bytes(texto));
    await guiaPublicar(d, F);
    expect(pedidos[0]!.args[3]).toMatchObject({ contenido: texto, ruta: ".supcoflow/guide.md" });
    const gh = deps({}, bytes(texto));
    await guiaPublicar(gh.d, G);
    expect(gh.pedidos[0]!.args[3]).toEqual({ huella: huellas.ejemplo.huella });
  });
});
