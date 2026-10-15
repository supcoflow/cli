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
