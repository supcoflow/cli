import { flagQueNoAplica } from "../src/flags-por-comando.ts";
import { describe, expect, it } from "vitest";
import { loginInteractivo, type DepsDeLogin } from "../src/comandos/login.ts";
import { comandoQuienSoy } from "../src/comandos/quien-soy.ts";
import { comandoLogout } from "../src/comandos/logout.ts";
import { crearGuardado, type Almacen, type Registro } from "../src/guardado/index.ts";
import { FalloDeLaTerminal } from "../src/contrato.ts";
import type { Canje, PedidoDeCodigo, Yo } from "../src/api.ts";

// Los mismos dobles que test/login-partido.test.ts (reloj falso, almacenes en memoria, motor falso),
// copiados en lo mínimo: los comandos se prueban contra el guardado REAL de la Tarea 3.
const A = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const B = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
const X = `scf_${"e".repeat(16)}_${"f".repeat(64)}`;
const DEVICE = "0123456789abcdef".repeat(4);
const API = new URL("https://app.supcoflow.dev");
const ORIGEN = API.origin;
const RUTA = "/home/a/.config/supcoflow/credenciales.json";
const T0 = 1_000_000;

type Op = "leer" | "escribir" | "borrar";

function reloj() {
  let t = T0;
  return { ahora: () => t, avanzar: (ms: number) => { t += ms; }, dormir: async (ms: number) => { t += ms; } };
}
type Reloj = ReturnType<typeof reloj>;

function memoria(nombre: "llavero" | "archivo") {
  const datos = new Map<string, Registro>();
  const m = {
    nombre, datos, roto: (_op: Op, _cuenta: string) => false,
    paso(op: Op, c: string) { if (m.roto(op, c)) throw new Error(`${nombre} caído`); },
    async leer(c: string) { m.paso("leer", c); return datos.get(c) ?? null; },
    async escribir(c: string, reg: Registro) { m.paso("escribir", c); datos.set(c, reg); },
    async borrar(c: string) { m.paso("borrar", c); datos.delete(c); },
  };
  return m as typeof m & Almacen;
}

const pedido: PedidoDeCodigo = {
  deviceCode: DEVICE, userCode: "BCDF-GHJK", verificationUri: "https://app.supcoflow.dev/dispositivo",
  verificationUriComplete: "https://app.supcoflow.dev/dispositivo?code=BCDF-GHJK", expiresIn: 600, interval: 5,
};

const yo: Yo = { via: "clave", equipo: "acme", usuario: { id: "u1", login: "ana", email: null }, proyecto: null };

function armar(o: {
  canjes?: Canje[];
  revocar?: (clave: string) => "revocada" | "ya_no_valia";
  quienSoy?: (clave: string) => Yo;
  env?: Record<string, string>;
} = {}) {
  const r = reloj();
  const llavero = memoria("llavero");
  const archivo = memoria("archivo");
  const avisos: string[] = [];
  const mostrado: string[] = [];
  const llamadas: string[] = [];
  const guardado = crearGuardado({
    env: o.env ?? {}, llavero, archivo, rutaDelArchivo: RUTA,
    fs: { realpath: (p) => p, existe: () => false }, ahora: r.ahora, avisar: (s) => avisos.push(s),
  });
  const canjes = [...(o.canjes ?? [])];
  const revocarPropia = async (_api: URL, clave: string) => {
    llamadas.push(`revocarPropia ${clave}`);
    return (o.revocar ?? (() => "revocada"))(clave);
  };
  const d: DepsDeLogin = {
    api: API, guardado, maquina: "mi-mac", ahora: r.ahora, dormir: r.dormir,
    pedirCodigo: async () => { llamadas.push("pedirCodigo"); return pedido; },
    canjear: async () => { llamadas.push("canjear"); return canjes.shift() ?? { tipo: "pendiente" }; },
    revocarPropia,
    avisar: (s) => avisos.push(s),
  };
  const quienSoy = async (_api: URL, clave: string) => {
    llamadas.push("quienSoy");
    return (o.quienSoy ?? (() => yo))(clave);
  };
  const base = { api: API, guardado, ahora: r.ahora, avisar: (s: string) => avisos.push(s) };
  return { d, r, guardado, llavero, archivo, avisos, mostrado, llamadas, revocarPropia, quienSoy, base };
}

const sinSecretos = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toMatch(/[0-9a-f]{64}/);
  expect(s).not.toContain("scf_");
};

describe("loginInteractivo", () => {
  it("sin TTY: 3 hace_falta_tty y no pide código", async () => {
    const { d, mostrado, llamadas } = armar();
    const r = await loginInteractivo({ ...d, esTty: false, mostrar: (s) => mostrado.push(s) }, { json: false, dryRun: false });
    expect(r.codigo).toBe(3);
    expect(r.json).toMatchObject({ ok: false, error: "hace_falta_tty" });
    expect(r.json.message).toBe("Sin terminal interactiva usá `supcoflow login --start --json` y después `supcoflow login --wait --json`.");
    expect(llamadas).not.toContain("pedirCodigo");
  });
  it("con --json aunque haya TTY: 3 igual, sin pedir código", async () => {
    const { d, mostrado, llamadas } = armar();
    const r = await loginInteractivo({ ...d, esTty: true, mostrar: (s) => mostrado.push(s) }, { json: true, dryRun: false });
    expect(r.codigo).toBe(3);
    expect(r.json.error).toBe("hace_falta_tty");
    expect(llamadas).not.toContain("pedirCodigo");
  });
  it("con TTY: pendiente, pendiente, token → 0; muestra URL y código; nada lleva la clave", async () => {
    const { d, guardado, mostrado, llamadas } = armar({
      canjes: [{ tipo: "pendiente" }, { tipo: "pendiente" }, { tipo: "token", clave: A, equipo: "acme" }],
    });
    // Tramo corto: obliga a que el comando repita `loginWait` más de una vez.
    const r = await loginInteractivo({ ...d, tramoMs: 15_000, esTty: true, mostrar: (s) => mostrado.push(s) }, { json: false, dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, equipo: "acme" });
    expect(llamadas.filter((l) => l === "canjear")).toHaveLength(3);
    const todo = mostrado.join("\n");
    expect(todo).toContain(pedido.verificationUriComplete);
    expect(todo).toContain("BCDF-GHJK");
    sinSecretos(mostrado);
    sinSecretos(r);
    expect(await guardado.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
  });
  it("entre un tramo y el siguiente duerme 1 s: un 5 sin sondeos no gira en vacío", async () => {
    const { d, mostrado } = armar({ canjes: [{ tipo: "pendiente" }, { tipo: "pendiente" }, { tipo: "token", clave: A, equipo: "acme" }] });
    const dormidos: number[] = [];
    const dormir = async (ms: number) => { dormidos.push(ms); await d.dormir(ms); };
    const r = await loginInteractivo({ ...d, dormir, tramoMs: 15_000, esTty: true, mostrar: (s) => mostrado.push(s) }, { json: false, dryRun: false });
    expect(r.codigo).toBe(0);
    expect(dormidos.filter((ms) => ms === 1_000).length).toBeGreaterThanOrEqual(1);
  });
  it("con TTY y un rechazo: devuelve el final (4)", async () => {
    const { d, mostrado } = armar({ canjes: [{ tipo: "rechazado" }] });
    const r = await loginInteractivo({ ...d, esTty: true, mostrar: (s) => mostrado.push(s) }, { json: false, dryRun: false });
    expect(r.codigo).toBe(4);
  });
});

describe("comandoQuienSoy", () => {
  it("sin clave → 2 sin_sesion", async () => {
    const { base, quienSoy, llamadas } = armar();
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(2);
    expect(r.json).toEqual({ ok: false, error: "sin_sesion", message: "Iniciá sesión con `supcoflow login`." });
    expect(llamadas).not.toContain("quienSoy");
  });
  it("con clave → 0 con la fuente, sin la clave en la salida", async () => {
    const { base, quienSoy, guardado } = armar();
    await guardado.guardarClave(ORIGEN, A);
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(0);
    expect(r.json).toEqual({ ok: true, via: "clave", equipo: "acme", usuario: yo.usuario, proyecto: null, fuente: "llavero" });
    expect(r.texto).toBe("ana en el equipo acme (clave en llavero)");
    sinSecretos(r);
  });
  it("401 con la clave de SUPCOFLOW_TOKEN → 2 y el mensaje lo dice", async () => {
    const { base, quienSoy } = armar({
      env: { SUPCOFLOW_TOKEN: A },
      quienSoy: () => { throw new FalloDeLaTerminal(2, "clave_invalida", "La clave ya no vale: iniciá sesión de nuevo."); },
    });
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(2);
    expect(r.json.error).toBe("clave_invalida");
    expect(String(r.json.message)).toContain("SUPCOFLOW_TOKEN");
    sinSecretos(r);
  });
  it("con la lista «por revocar» no vacía: avisa y no revoca nada", async () => {
    const { base, quienSoy, guardado, avisos, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    await guardado.anotarPorRevocar(ORIGEN, X);
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(0);
    expect(avisos).toContain("Hay 1 clave(s) anterior(es) anotadas para revocar; se reintenta en el próximo login o logout.");
    expect(llamadas.some((l) => l.startsWith("revocarPropia"))).toBe(false);
    expect((await guardado.leerPorRevocar(ORIGEN)).claves).toEqual([X]);
  });
  it("con la lista «por revocar» a medio leer: avisa que no pudo leerla entera", async () => {
    const { base, quienSoy, guardado, llavero, avisos } = armar();
    await guardado.guardarClave(ORIGEN, A);
    llavero.roto = (op, c) => op === "leer" && c.endsWith("#por_revocar");
    await comandoQuienSoy({ ...base, quienSoy });
    expect(avisos).toContain("No pude leer entera la lista de claves por revocar.");
  });
});

describe("comandoLogout", () => {
  it("revocada → 0, lo guardado borrado", async () => {
    const { base, revocarPropia, guardado, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, revocada: true, quedan_por_revocar: 0 });
    expect(llamadas).toEqual([`revocarPropia ${A}`]);
    expect(await guardado.leerClaveGuardada(ORIGEN)).toBeNull();
    sinSecretos(r);
  });
  it("ya_no_valia → 0 y borrada igual", async () => {
    const { base, revocarPropia, guardado } = armar({ revocar: () => "ya_no_valia" });
    await guardado.guardarClave(ORIGEN, A);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, revocada: false });
    expect(await guardado.leerClaveGuardada(ORIGEN)).toBeNull();
  });
  it("red caída → 1 motor_inalcanzable y la clave SIGUE guardada", async () => {
    const { base, revocarPropia, guardado } = armar({
      revocar: () => { throw new FalloDeLaTerminal(1, "motor_inalcanzable", "No pude comunicarme con el motor (red caída o demora)."); },
    });
    await guardado.guardarClave(ORIGEN, A);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.json.error).toBe("motor_inalcanzable");
    expect(String(r.json.message)).toContain("no cerré la sesión");
    expect(await guardado.leerClaveGuardada(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
    sinSecretos(r);
  });
  it("--dry-run → 0 sin revocar ni borrar nada", async () => {
    const { base, revocarPropia, guardado, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    await guardado.anotarPorRevocar(ORIGEN, X);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: true });
    expect(r.codigo).toBe(0);
    expect(r.json).toEqual({ ok: true, dry_run: true, haria: `revocar la clave de llavero en ${ORIGEN} y borrarla` });
    expect(llamadas).toEqual([]);
    expect(await guardado.leerClaveGuardada(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
    expect((await guardado.leerPorRevocar(ORIGEN)).claves).toEqual([X]);
  });
  it("sin clave → 0 habia_sesion: false, y borra un pendiente si quedó", async () => {
    const { base, revocarPropia, guardado, llamadas } = armar();
    await guardado.guardarPendiente(ORIGEN, {
      deviceCode: DEVICE, userCode: "BCDF-GHJK", verificationUriComplete: pedido.verificationUriComplete,
      venceEn: T0 + 600_000, intervaloS: 5, ultimoSondeoEn: null,
    });
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, habia_sesion: false });
    expect(llamadas).toEqual([]);
    expect(await guardado.leerPendiente(ORIGEN)).toBeNull();
  });
  it("revocada y el borrado local lanza → 1 no_se_pudo_borrar", async () => {
    const { base, revocarPropia, guardado, llavero, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    llavero.roto = (op, c) => op === "borrar" && c === ORIGEN;
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.json.error).toBe("no_se_pudo_borrar");
    expect(llamadas).toEqual([`revocarPropia ${A}`]);
    sinSecretos(r);
  });

  describe("las claves anotadas «por revocar» (Review Focus 14 y 15)", () => {
    it("una que el motor revoca sale de la lista: quedan_por_revocar 0", async () => {
      const { base, revocarPropia, guardado, llamadas } = armar();
      await guardado.guardarClave(ORIGEN, A);
      await guardado.anotarPorRevocar(ORIGEN, X);
      const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
      expect(r.codigo).toBe(0);
      expect(r.json.quedan_por_revocar).toBe(0);
      expect(llamadas).toEqual([`revocarPropia ${X}`, `revocarPropia ${A}`]);
      expect((await guardado.leerPorRevocar(ORIGEN)).claves).toEqual([]);
    });
    it("una que falla queda: quedan_por_revocar 1 y lo avisa", async () => {
      const { base, revocarPropia, guardado, avisos } = armar({
        revocar: (c) => { if (c === X) throw new Error("red"); return "revocada"; },
      });
      await guardado.guardarClave(ORIGEN, A);
      await guardado.anotarPorRevocar(ORIGEN, X);
      const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
      expect(r.codigo).toBe(0);
      expect(r.json.quedan_por_revocar).toBe(1);
      expect(avisos.join("\n")).toContain("siguen anotadas");
      expect((await guardado.leerPorRevocar(ORIGEN)).claves).toEqual([X]);
    });
    it("con el llavero sin responder: quedan_por_revocar null (nunca 0) y aviso", async () => {
      const { base, revocarPropia, guardado, llavero, avisos } = armar();
      await guardado.guardarClave(ORIGEN, A);
      await guardado.anotarPorRevocar(ORIGEN, X);
      llavero.roto = (op, c) => op === "leer" && c.endsWith("#por_revocar");
      const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
      expect(r.json.quedan_por_revocar).toBeNull();
      expect(avisos.join("\n")).toContain("siguen anotadas");
    });
  });

  it("SUPCOFLOW_TOKEN=A y B guardada: revoca A una vez, B sigue, y avisa las dos cosas (Review Focus 9)", async () => {
    const { base, revocarPropia, guardado, llamadas, avisos } = armar({ env: { SUPCOFLOW_TOKEN: A } });
    await guardado.guardarClave(ORIGEN, B);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(llamadas).toEqual([`revocarPropia ${A}`]);
    expect(await guardado.leerClaveGuardada(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
    expect(r.json).toMatchObject({ ok: true, revocada: true, queda_clave_guardada: true });
    expect(avisos).toContain("Revoqué la clave de SUPCOFLOW_TOKEN; sacala de tu entorno.");
    expect(avisos).toContain("Sigue guardada otra clave en llavero; para cerrarla, corré `supcoflow logout` sin SUPCOFLOW_TOKEN.");
    sinSecretos(r);
  });
  it("SUPCOFLOW_TOKEN y --dry-run: haria sin «y borrarla»", async () => {
    const { base, revocarPropia } = armar({ env: { SUPCOFLOW_TOKEN: A } });
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: true });
    expect(r.json).toEqual({ ok: true, dry_run: true, haria: `revocar la clave de env en ${ORIGEN}` });
  });
});

// Ausente no es fallido (Review Focus 12): un llavero que no contesta no es «no hay sesión».
describe("con el llavero sin responder al leer la clave", () => {
  const ilegible = (llavero: ReturnType<typeof memoria>) => {
    llavero.roto = (op, c) => op === "leer" && c === ORIGEN;
  };
  it("quien-soy: sin nada legible → 1 llavero_no_responde (no 2 sin_sesion)", async () => {
    const { base, quienSoy, guardado, llavero, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    ilegible(llavero);
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "llavero_no_responde" });
    expect(llamadas).toEqual([]);
    sinSecretos(r);
  });
  it("quien-soy: con una copia en el archivo → contesta, pero avisa", async () => {
    const { base, quienSoy, archivo, llavero, avisos } = armar();
    archivo.datos.set(ORIGEN, { valor: B, escritoEn: 1 });
    ilegible(llavero);
    const r = await comandoQuienSoy({ ...base, quienSoy });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, fuente: "archivo" });
    expect(avisos.join("\n")).toContain("llavero");
  });
  it("logout: sin nada legible → 1 no_pude_leer_la_clave, no revoca ni borra nada", async () => {
    const { base, revocarPropia, guardado, llavero, llamadas } = armar();
    await guardado.guardarClave(ORIGEN, A);
    await guardado.guardarPendiente(ORIGEN, {
      deviceCode: DEVICE, userCode: "BCDF-GHJK", verificationUriComplete: pedido.verificationUriComplete,
      venceEn: T0 + 600_000, intervaloS: 5, ultimoSondeoEn: null,
    });
    ilegible(llavero);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "no_pude_leer_la_clave" });
    expect(r.json.habia_sesion).toBeUndefined();
    expect(llamadas).toEqual([]);
    expect(llavero.datos.get(ORIGEN)?.valor).toBe(A);
    sinSecretos(r);
  });
  it("logout --dry-run: tampoco dice «no hay sesión»", async () => {
    const { base, revocarPropia, guardado, llavero } = armar();
    await guardado.guardarClave(ORIGEN, A);
    ilegible(llavero);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: true });
    expect(r.codigo).toBe(1);
    expect(r.json.error).toBe("no_pude_leer_la_clave");
  });
  it("logout: B legible en el archivo y el llavero mudo → revoca y borra B, deja el llavero sin tocar, avisa y lectura_completa false", async () => {
    const { base, revocarPropia, archivo, llavero, llamadas, avisos } = armar();
    llavero.datos.set(ORIGEN, { valor: A, escritoEn: 1 });
    archivo.datos.set(ORIGEN, { valor: B, escritoEn: 2 });
    ilegible(llavero);
    const r = await comandoLogout({ ...base, revocarPropia }, { dryRun: false });
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, revocada: true, lectura_completa: false });
    expect(llamadas).toEqual([`revocarPropia ${B}`]);
    expect(archivo.datos.has(ORIGEN)).toBe(false);
    // A no se pudo ver, así que no se revocó: borrarla la dejaría viva y olvidada.
    expect(llavero.datos.get(ORIGEN)?.valor).toBe(A);
    expect(avisos.join("\n")).toContain("otra copia");
    sinSecretos(r);
  });
});

describe("flags que no aplican (despacho)", () => {
  const sin = (c: string, ...f: string[]) => flagQueNoAplica(c, f);
  it("un flag de configurar en un comando que no lo acepta no aplica", () => {
    expect(sin("quien-soy", "sitio")).not.toBeNull();
    expect(sin("chat prender", "tema")).not.toBeNull();
    expect(sin("chat marca", "archivo")).not.toBeNull();
    expect(sin("claves listar", "guardarEn")).not.toBeNull();
    expect(sin("claves crear", "id")).not.toBeNull();
    expect(sin("catalogo", "repo")).not.toBeNull();
    expect(sin("login", "repo")).not.toBeNull();
    expect(sin("guia ver", "origen")).not.toBeNull();
    expect(sin("guia publicar", "origen")).not.toBeNull();
    expect(sin("claves listar", "origen")).not.toBeNull();
    expect(sin("guia revisar", "desdeGithub")).not.toBeNull();
    expect(sin("guia ver", "desdeGithub")).not.toBeNull();
  });
  it("los flags de cada comando de configurar sí aplican", () => {
    expect(sin("sitios agregar", "sitio", "repo")).toBeNull();
    expect(sin("chat marca", "titulo", "saludo", "tema", "repo")).toBeNull();
    expect(sin("chat logo", "archivo")).toBeNull();
    expect(sin("datos fijar", "permitir")).toBeNull();
    expect(sin("politica fijar", "modo")).toBeNull();
    expect(sin("claves crear", "nombre", "guardarEn")).toBeNull();
    expect(sin("claves revocar", "id")).toBeNull();
    expect(sin("configuracion", "repo")).toBeNull();
    expect(sin("guia usar", "origen", "repo")).toBeNull();
    expect(sin("guia revisar", "repo")).toBeNull();
    expect(sin("guia publicar", "desdeGithub", "repo")).toBeNull();
    expect(sin("proyecto ver", "repo")).toBeNull();
  });
  it("bloque 6: --skill y --app sólo en `instalacion anotar`; `widget` toma --repo", () => {
    expect(sin("instalacion anotar", "skill", "app", "repo")).toBeNull();
    expect(sin("widget", "repo")).toBeNull();
    for (const c of ["widget", "guia publicar", "proyecto crear", "configuracion", "quien-soy"]) {
      expect(sin(c, "skill"), c).toMatch(/instalacion anotar/);
      expect(sin(c, "app"), c).toMatch(/instalacion anotar/);
    }
    expect(sin("instalacion anotar", "sitio")).not.toBeNull();
  });
  it("bloque 7: --autorizo-gasto, --mensaje y --prueba sólo en `probar`; --wait también en `probar`; --repo en los dos", () => {
    expect(sin("probar", "autorizoGasto", "mensaje", "repo")).toBeNull();
    expect(sin("probar", "wait", "prueba")).toBeNull();
    expect(sin("diagnosticar", "repo")).toBeNull();
    for (const c of ["diagnosticar", "widget", "quien-soy", "login"]) {
      expect(sin(c, "autorizoGasto"), c).toMatch(/probar/);
      expect(sin(c, "mensaje"), c).toMatch(/probar/);
      expect(sin(c, "prueba"), c).toMatch(/probar/);
    }
    expect(sin("diagnosticar", "wait")).not.toBeNull();
    expect(sin("probar", "start")).not.toBeNull();
    expect(sin("login", "wait")).toBeNull();
  });
});
