// test/guia-comandos.test.ts
import { describe, expect, it } from "vitest";
import { guiaPublicar, guiaRevisar, guiaUsar, guiaVer, type DepsDeGuia } from "../src/comandos/guia.ts";
import { huellaDeGuia } from "../src/guia.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const F = { repo: null, dryRun: false };
const R = (status: number, cuerpo: unknown) => ({ status, cuerpo }) as never;

function deps(o: Partial<DepsDeGuia> = {}, archivo: { bytes: Uint8Array } | { error: string } = { bytes: new TextEncoder().encode("## A\n") }) {
  const pedidos: { que: string; args: unknown[] }[] = [];
  const d: DepsDeGuia = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerArchivoChico: () => archivo,
    fetch: (async () => { throw new Error("sin red"); }) as never,
    gitDeclarado: async (args) => ({ codigo: 0, stdout: args.includes("--abbrev-ref") ? "main\n" : `${HEAD}\n` }),
    revisar: async (...args) => { pedidos.push({ que: "revisar", args }); return R(200, { ok: true, secciones: 3 }); },
    publicar: async (...args) => { pedidos.push({ que: "publicar", args }); return R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 3 }, ya_publicada: false, reemplaza: { origen: "agente", version: 1 } }); },
    ver: async (...args) => { pedidos.push({ que: "ver", args }); return R(200, { guia: null, otra: null }); },
    elegir: async (...args) => { pedidos.push({ que: "usar", args }); return R(200, { ok: true, guia: { origen: "agente", version: 1, secciones: 2 } }); },
    ...o,
  };
  return { d, pedidos };
}
const sinControl = (t: string) => expect(t.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

describe("guia revisar", () => {
  it("0: manda el contenido del archivo", async () => {
    const { d, pedidos } = deps();
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, secciones: 3 } });
    expect(pedidos[0]!.args.slice(2)).toEqual(["proj_r-1", "## A\n", d.fetch]);
  });
  it("sin archivo: 3 falta_guia y ningún pedido", async () => {
    const { d, pedidos } = deps({}, { error: "no existe" });
    expect(await guiaRevisar(d, F)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(pedidos).toEqual([]);
  });
  it("--repo sin clon local: 3 falta_guia, «parate en el clon»", async () => {
    const { d, pedidos } = deps();
    const r = await guiaRevisar(d, { repo: "otro/repo", dryRun: false });
    expect(r).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(r.texto).toMatch(/parate en el clon del repo/);
    expect(pedidos).toEqual([]);
  });
  it("archivo enorme: 3 guia_muy_grande sin pedido; enlace: 3 guia_ilegible", async () => {
    expect(await guiaRevisar(deps({}, { error: "es demasiado grande" }).d, F)).toMatchObject({ codigo: 3, json: { error: "guia_muy_grande" } });
    expect(await guiaRevisar(deps({}, { error: "es un enlace" }).d, F)).toMatchObject({ codigo: 3, json: { error: "guia_ilegible" } });
  });
  it("422 guia_mal_armada: 3, errores en el JSON y una línea por error, sin control ni secretos", async () => {
    const { d } = deps({ revisar: async () => R(422, { error: "guia_mal_armada", message: "x", errores: [{ linea: 12, motivo: "falta «Para qué sirve:»" }, { linea: 3, motivo: `hay \u001b[31m rojo ${CLAVE}` }] }) });
    const r = await guiaRevisar(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada", errores: [{ linea: 12 }, { linea: 3 }] } });
    expect(r.texto).toContain("línea 12: falta «Para qué sirve:»");
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

describe("guia publicar (directa, por defecto)", () => {
  const OK = { ok: true, guia: { origen: "repo", rama: "main", commit: HEAD, secciones: 3 }, ya_publicada: false, reemplaza: { origen: "agente", version: 1 } };
  it("manda el contenido tal cual (con BOM y \\r\\n) y el commit y la rama declarados, sin huella", async () => {
    const crudo = "\ufeff## A\r\nPara qué sirve: x\r\n";
    const { d, pedidos } = deps({}, { bytes: new TextEncoder().encode(crudo) });
    await guiaPublicar(d, F);
    expect(pedidos[0]!.args[3]).toEqual({ contenido: crudo, commit: HEAD, rama: "main" });
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
      expect(pedidos[0]!.args[3]).toEqual({ contenido: "## A\n" });
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/sin commit/);
    });
  }
  it("cabeza suelta: manda el commit y no la rama", async () => {
    const { d, pedidos } = deps({ gitDeclarado: async (a) => ({ codigo: 0, stdout: a.includes("--abbrev-ref") ? "HEAD\n" : HEAD }) });
    await guiaPublicar(d, F);
    expect(pedidos[0]!.args[3]).toEqual({ contenido: "## A\n", commit: HEAD });
  });
  it("0 subida: dice secciones, reemplazo y el commit como declarado", async () => {
    const { d } = deps({ publicar: async () => R(200, OK) });
    const r = await guiaPublicar(d, F);
    expect(r.codigo).toBe(0);
    expect(r.texto).toBe("Guía subida: 3 secciones. Es la guía activa (reemplaza a la de nuestro agente v1); commit abc1234 declarado por la terminal (no verificado en GitHub).");
    expect(r.json).toMatchObject({ ok: true, ya_publicada: false, commit_declarado: HEAD });
  });
  it("0 ya subida: lo dice con honestidad", async () => {
    const { d } = deps({ publicar: async () => R(200, { ...OK, ya_publicada: true, reemplaza: null }) });
    const r = await guiaPublicar(d, F);
    expect(r.texto).toBe("Ya estaba subida: 3 secciones. Quedó como guía activa; commit abc1234 declarado por la terminal (no verificado en GitHub).");
  });
  it("sin commit: «sin commit»", async () => {
    const { d } = deps({ gitDeclarado: async () => ({ codigo: 128, stdout: "" }), publicar: async () => R(200, OK) });
    expect((await guiaPublicar(d, F)).texto).toBe("Guía subida: 3 secciones. Es la guía activa (reemplaza a la de nuestro agente v1); sin commit.");
  });
  it("422 guia_mal_armada: 3 con errores", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(422, { error: "guia_mal_armada", message: "m", errores: [{ linea: 1, motivo: "mal" }] }) }).d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "guia_mal_armada", errores: [{ linea: 1, motivo: "mal" }] } });
    expect(r.texto).toContain("línea 1: mal");
  });
  it("413 guia_muy_grande del motor: 3", async () => {
    expect((await guiaPublicar(deps({ publicar: async () => R(413, { error: "guia_muy_grande", message: "grande" }) }).d, F)).codigo).toBe(3);
  });
  it("archivo enorme: 3 guia_muy_grande sin pedido ni git", async () => {
    const llamadas: string[][] = [];
    const { d, pedidos } = deps({ gitDeclarado: async (a) => { llamadas.push(a); return { codigo: 0, stdout: "" }; } }, { error: "es demasiado grande" });
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
    const { d, pedidos } = deps({}, { error: "no existe" });
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
    expect(r.texto).toMatch(/contenido \(5 bytes\), commit abc1234 de main declarado/);
    expect(pedidos).toEqual([]);
  });
  it("el mensaje del motor y la rama declarada salen sin secretos ni control", async () => {
    const r = await guiaPublicar(deps({ publicar: async () => R(409, { error: "instalacion_ausente", message: `mirá \u001b[2J ${CLAVE}` }) }).d, F);
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

const G = { ...F, desdeGithub: true };
describe("guia publicar --desde-github (la vía de GitHub, intacta)", () => {
  it("manda la huella del archivo con BOM y \\r\\n, igual a la de la versión normalizada", async () => {
    const crudo = "﻿## A\r\nPara qué sirve: x\r\n";
    const { d, pedidos } = deps({}, { bytes: new TextEncoder().encode(crudo) });
    await guiaPublicar(d, G);
    expect(pedidos[0]!.args[3]).toEqual({ huella: huellaDeGuia(crudo) });
    expect(pedidos[0]!.args[3]).toEqual({ huella: huellaDeGuia("## A\nPara qué sirve: x\n") });
  });
  it("0 publicada: dice commit, rama, secciones y el reemplazo", async () => {
    const r = await guiaPublicar(deps().d, G);
    expect(r.codigo).toBe(0);
    expect(r.texto).toBe("Guía publicada: commit abc1234 de main, 3 secciones. Es la guía activa (reemplaza a la de nuestro agente v1).");
  });
  it("0 ya publicada", async () => {
    const { d } = deps({ publicar: async () => R(200, { ok: true, guia: { origen: "repo", rama: "main", commit: "abc1234def", secciones: 3 }, ya_publicada: true, reemplaza: null }) });
    const r = await guiaPublicar(d, G);
    expect(r).toMatchObject({ codigo: 0, json: { ya_publicada: true } });
    expect(r.texto).toBe("Ya estaba publicada: commit abc1234 de main, 3 secciones. Quedó como guía activa.");
    expect(r.texto).not.toMatch(/Sigue siendo/);
  });
  for (const e of ["guia_no_subida", "guia_distinta"]) {
    it(`409 ${e}: 5 con rama y commit`, async () => {
      const r = await guiaPublicar(deps({ publicar: async () => R(409, { error: e, message: "m", rama: "main", commit: "abc1234def" }) }).d, G);
      expect(r).toMatchObject({ codigo: 5, json: { error: e, rama: "main", commit: "abc1234def" } });
      expect(r.texto).toMatch(/subí la guía a la rama principal y volvé a correr/);
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
    const a = deps({}, { error: "no existe" });
    expect(await guiaPublicar(a.d, G)).toMatchObject({ codigo: 3, json: { error: "falta_guia" } });
    expect(a.pedidos).toEqual([]);
    const b = deps();
    const r = await guiaPublicar(b.d, { repo: null, dryRun: true, desdeGithub: true });
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

describe("guia ver", () => {
  const repo = { origen: "repo", version: 2, repo: "d/r", rama: "main", commit: "abc1234def", secciones: 3, publicada_por: "ana" };
  it("al día", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: repo, otra: null, rama: { al_dia: true, commit: "abc1234def" } }) }).d, { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { al_dia: true } });
    expect(r.texto).toMatch(/al día/);
  });
  it("la rama tiene otra versión: lo dice y 0", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: repo, otra: { origen: "agente", version: 1 }, rama: { al_dia: false, commit: "ffff" } }) }).d, { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { al_dia: false } });
    expect(r.texto).toContain("en la rama hay otra versión".replace("en", "En") );
    expect(r.texto).toContain("`supcoflow guia publicar`");
  });
  it("origen agente y sin guía", async () => {
    const a = await guiaVer(deps({ ver: async () => R(200, { guia: { origen: "agente", version: 1, secciones: 2, aprobada_en: null }, otra: null }) }).d, { repo: null });
    expect(a.texto).toMatch(/nuestro agente/);
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
      expect(r.texto).toContain("ubida desde la terminal; el commit es declarado, no verificado en GitHub");
      expect(r.texto).toContain("commit aaaaaaa (declarado)");
      expect(r.texto).toContain("rama main");
      expect(r.texto).not.toContain("No pude comprobar");
      expect(r.texto).not.toContain("usr_123abc");
      expect(r.json).toMatchObject({ guia: { publicada_por: "usr_123abc" }, al_dia: null });
    });
    it("sin commit ni rama: sin comas vacías", async () => {
      const r = await ver({ ...term, commit: null, rama: null });
      expect(r.texto).toContain("sin commit declarado");
      expect(r.texto).not.toMatch(/rama ,|commit ,|, ,|,\./);
      expect(r.texto).not.toContain("No pude comprobar");
      expect(r.texto).not.toContain("usr_123abc");
    });
  });
  it("texto de la procedencia sin caracteres de control", async () => {
    const r = await guiaVer(deps({ ver: async () => R(200, { guia: { ...repo, publicada_por: "a\u001b[31mna" }, otra: null }) }).d, { repo: null });
    sinControl(r.texto);
  });
});

describe("guia usar", () => {
  const U = { repo: null, dryRun: false };
  it("sin --origen: 3 falta_origen sin pedido; valor raro: 3", async () => {
    const { d, pedidos } = deps();
    expect(await guiaUsar(d, { ...U, origen: null })).toMatchObject({ codigo: 3, json: { error: "falta_origen" } });
    expect((await guiaUsar(d, { ...U, origen: "otro" })).codigo).toBe(3);
    expect(pedidos).toEqual([]);
  });
  it("0 con repo y con agente", async () => {
    const { d, pedidos } = deps();
    expect((await guiaUsar(d, { ...U, origen: "repo" })).codigo).toBe(0);
    expect(pedidos[0]!.args[3]).toBe("repo");
  });
  it("409 sin_guia_publicada: 3; sin_guia_del_agente: 4", async () => {
    expect((await guiaUsar(deps({ elegir: async () => R(409, { error: "sin_guia_publicada", message: "m" }) }).d, { ...U, origen: "repo" })).codigo).toBe(3);
    expect(await guiaUsar(deps({ elegir: async () => R(409, { error: "sin_guia_del_agente", message: "m" }) }).d, { ...U, origen: "agente" })).toMatchObject({ codigo: 4, json: { error: "sin_guia_del_agente" } });
  });
  it("--dry-run no pide", async () => {
    const { d, pedidos } = deps();
    expect((await guiaUsar(d, { repo: null, dryRun: true, origen: "agente" })).json).toMatchObject({ dry_run: true });
    expect(pedidos).toEqual([]);
  });
});
