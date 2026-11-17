import { describe, expect, it } from "vitest";
import { repoConectarInteractivo, repoConectarStart, repoConectarWait, type DepsDeConexion } from "../src/comandos/repo-conectar.ts";
import type { Pedido } from "../src/api.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const pedido = (estado: Pedido["estado"], extra: Partial<Pedido> = {}): Pedido => ({
  id: "cnx_0123456789abcdef", repo: "d/r", estado, url: "http://localhost:3000/conectar/cnx_0123456789abcdef",
  venceEn: "2026-10-15T12:30:00.000Z", repoCanonico: estado === "conectado" ? "D/r" : null, fallo: null, ...extra,
});

function deps(o: Partial<DepsDeConexion> & { estados?: Pedido["estado"][] } = {}) {
  let t = 0;
  const llamadas: string[] = [];
  const estados = [...(o.estados ?? ["pendiente"])];
  const d: DepsDeConexion = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    ahora: () => t,
    dormir: async (ms) => { t += ms; },
    crearConexion: async () => { llamadas.push("crear"); return pedido("pendiente"); },
    ultimaConexion: async () => { llamadas.push("sondeo"); t += 100; return pedido(estados.length > 1 ? estados.shift()! : estados[0]!); },
    avisar: () => {},
    tramoMs: 20_000,
    ...o,
  };
  return { d, llamadas };
}

describe("repo conectar --start", () => {
  it("sale 5 con la URL y sin la clave", async () => {
    const { d } = deps();
    const r = await repoConectarStart(d, { repo: null, dryRun: false });
    expect(r.codigo).toBe(5);
    expect(r.json).toMatchObject({ ok: false, esperando: "persona", repo: "d/r", url: "http://localhost:3000/conectar/cnx_0123456789abcdef" });
    expect(JSON.stringify(r)).not.toContain(CLAVE);
  });
  it("si el atajo ya lo conectó, sale 0 sin pedirle nada a la persona", async () => {
    const { d } = deps({ crearConexion: async () => pedido("conectado") });
    expect(await repoConectarStart(d, { repo: null, dryRun: false })).toMatchObject({ codigo: 0, json: { estado: "conectado", repo_canonico: "D/r" } });
  });
  it("--dry-run no llama al motor", async () => {
    const { d, llamadas } = deps();
    expect((await repoConectarStart(d, { repo: null, dryRun: true })).codigo).toBe(0);
    expect(llamadas).toEqual([]);
  });
  it("sin sesión: 2", async () => {
    const { d } = deps({ guardado: { leerClaveCompleta: async () => ({ valor: null, completa: true }) } as never });
    expect((await repoConectarStart(d, { repo: null, dryRun: false })).codigo).toBe(2);
  });
});

describe("repo conectar --wait", () => {
  it("pendiente todo el tramo: 5 en ≤ el tramo", async () => {
    const { d } = deps();
    const r = await repoConectarWait(d, { repo: null });
    expect(r.codigo).toBe(5);
    expect(d.ahora()).toBeLessThanOrEqual(20_000);
  });
  it("se conecta a mitad del tramo: 0", async () => {
    const { d } = deps({ estados: ["pendiente", "pendiente", "conectado"] });
    expect((await repoConectarWait(d, { repo: null })).codigo).toBe(0);
  });
  it.each([
    ["repo_fuera_de_alcance", 4, "repo_fuera_de_alcance"],
    ["vencido", 4, "pedido_vencido"],
  ] as const)("%s → %i %s", async (estado, codigo, error) => {
    const { d } = deps({ estados: [estado] });
    expect(await repoConectarWait(d, { repo: null })).toMatchObject({ codigo, json: { error } });
  });
  it("sin pedido para ese repo: 3", async () => {
    const { d } = deps({ ultimaConexion: async () => null });
    expect(await repoConectarWait(d, { repo: null })).toMatchObject({ codigo: 3, json: { error: "sin_conexion_en_curso" } });
  });
  it("un fallo anotado se informa sin cerrar el pedido", async () => {
    const { d } = deps({ ultimaConexion: async () => pedido("pendiente", { fallo: "cuenta_ajena" }) });
    expect(await repoConectarWait(d, { repo: null })).toMatchObject({ codigo: 5, json: { fallo: "cuenta_ajena" } });
  });
});

it("sin terminal interactiva y sin --start/--wait: 3, sin pedir nada al motor", async () => {
  const { d, llamadas } = deps();
  const r = await repoConectarInteractivo({ ...d, esTty: false, mostrar: () => {} }, { repo: null, dryRun: false, json: false });
  expect(r).toMatchObject({ codigo: 3, json: { error: "hace_falta_tty" } });
  expect(llamadas).toEqual([]);
});

it("Review Focus 9: con terminal pero con --json, tampoco espera a nadie", async () => {
  const { d, llamadas } = deps();
  const r = await repoConectarInteractivo({ ...d, esTty: true, mostrar: () => {} }, { repo: null, dryRun: false, json: true });
  expect(r).toMatchObject({ codigo: 3, json: { error: "hace_falta_tty" } });
  expect(llamadas).toEqual([]);
});

describe("repo conectar abre el navegador (R-B)", () => {
  it("--start con un pedido pendiente: abre la URL y lo dice (json y texto), sin quitar nada de lo que ya había", async () => {
    const { d } = deps();
    const abiertas: string[] = [];
    const r = await repoConectarStart({ ...d, abrirNavegador: async (u) => { abiertas.push(u); return true; } }, { repo: null, dryRun: false });
    expect(abiertas).toEqual(["http://localhost:3000/conectar/cnx_0123456789abcdef"]);
    expect(r.codigo).toBe(5);
    expect(r.json).toMatchObject({ ok: false, esperando: "persona", repo: "d/r", url: "http://localhost:3000/conectar/cnx_0123456789abcdef", navegador_abierto: true });
    expect(r.texto).toContain("I opened");
  });
  it("si no se pudo abrir: el texto de siempre y navegador_abierto false", async () => {
    const { d } = deps();
    const r = await repoConectarStart({ ...d, abrirNavegador: async () => false }, { repo: null, dryRun: false });
    expect(r.json.navegador_abierto).toBe(false);
    expect(r.texto).toBe("Open http://localhost:3000/conectar/cnx_0123456789abcdef, install the App on GitHub if needed, and click Confirm.");
  });
  it("sin abridor (--no-browser): false y nada se abre", async () => {
    const { d } = deps();
    expect((await repoConectarStart(d, { repo: null, dryRun: false })).json.navegador_abierto).toBe(false);
  });
  it("ya conectado: no abre nada ni agrega el campo", async () => {
    const { d } = deps({ crearConexion: async () => pedido("conectado") });
    let abierto = false;
    const r = await repoConectarStart({ ...d, abrirNavegador: async () => { abierto = true; return true; } }, { repo: null, dryRun: false });
    expect(abierto).toBe(false);
    expect(r.json).not.toHaveProperty("navegador_abierto");
  });
  it("--dry-run no abre nada", async () => {
    const { d } = deps();
    let abierto = false;
    await repoConectarStart({ ...d, abrirNavegador: async () => { abierto = true; return true; } }, { repo: null, dryRun: true });
    expect(abierto).toBe(false);
  });
  it("--wait no abre el navegador de nuevo", async () => {
    const { d } = deps();
    let abierto = false;
    const r = await repoConectarWait({ ...d, abrirNavegador: async () => { abierto = true; return true; } }, { repo: null });
    expect(abierto).toBe(false);
    expect(r.json).not.toHaveProperty("navegador_abierto");
  });
  it("interactivo: abre una vez y se lo dice a la persona", async () => {
    const { d } = deps({ estados: ["pendiente", "conectado"] });
    const abiertas: string[] = [];
    const mostrado: string[] = [];
    const r = await repoConectarInteractivo(
      { ...d, abrirNavegador: async (u) => { abiertas.push(u); return true; }, esTty: true, mostrar: (s) => mostrado.push(s) },
      { repo: null, dryRun: false, json: false },
    );
    expect(r.codigo).toBe(0);
    expect(abiertas).toHaveLength(1);
    expect(mostrado.join("\n")).toContain("I opened");
  });
});
