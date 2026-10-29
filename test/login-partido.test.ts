import { describe, expect, it } from "vitest";
import { loginStart, loginWait, type DepsDeLogin } from "../src/comandos/login.ts";
import { TRAMO_MAXIMO_MS, RESERVA_PARA_CERRAR_MS } from "../src/sondeo.ts";
import { crearGuardado, type Almacen, type Registro } from "../src/guardado/index.ts";
import type { Canje, PedidoDeCodigo } from "../src/api.ts";

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

// Los almacenes de la Tarea 3, con dos perillas: `lento` consume el techo ENTERO que recibe cada
// operación (como un llavero colgado que responde justo al vencer), y `roto` decide por operación y
// cuenta si la operación lanza (después de haber consumido su tiempo).
function memoria(nombre: "llavero" | "archivo", r: Reloj) {
  const datos = new Map<string, Registro>();
  const m = {
    nombre, datos, lento: false, roto: (_op: Op, _cuenta: string) => false,
    paso(op: Op, c: string, techoMs?: number) {
      if (m.lento) r.avanzar(techoMs ?? 0);
      if (m.roto(op, c)) throw new Error(`${nombre} caído`);
    },
    async leer(c: string, t?: number) { m.paso("leer", c, t); return datos.get(c) ?? null; },
    async escribir(c: string, reg: Registro, t?: number) { m.paso("escribir", c, t); datos.set(c, reg); },
    async borrar(c: string, t?: number) { m.paso("borrar", c, t); datos.delete(c); },
  };
  return m as typeof m & Almacen;
}

const pedido: PedidoDeCodigo = {
  deviceCode: DEVICE, userCode: "BCDF-GHJK", verificationUri: "https://app.supcoflow.dev/dispositivo",
  verificationUriComplete: "https://app.supcoflow.dev/dispositivo?code=BCDF-GHJK", expiresIn: 600, interval: 5,
};

function armar(o: {
  canjear?: (plazoMs: number, r: Reloj) => Canje;
  revocar?: (clave: string, plazoMs: number, r: Reloj) => "revocada" | "ya_no_valia";
  env?: Record<string, string>;
} = {}) {
  const r = reloj();
  const llavero = memoria("llavero", r);
  const archivo = memoria("archivo", r);
  const avisos: string[] = [];
  const llamadas: string[] = [];
  const g = crearGuardado({
    env: o.env ?? {}, llavero, archivo, rutaDelArchivo: RUTA,
    fs: { realpath: (p) => p, existe: () => false }, ahora: r.ahora, avisar: (s) => avisos.push(s),
  });
  // El guardado real, con una sola costura: anota en el registro de llamadas CUÁNDO terminó de
  // guardarse cada clave, para comprobar el orden contra la revocación.
  const guardado = {
    ...g,
    async guardarClave(origen: string, clave: string, techoMs?: number) {
      const res = await g.guardarClave(origen, clave, techoMs);
      llamadas.push(`guardarClave ${clave}`);
      return res;
    },
  };
  const d: DepsDeLogin = {
    api: API, guardado, maquina: "mi-mac", ahora: r.ahora, dormir: r.dormir,
    pedirCodigo: async () => { llamadas.push("pedirCodigo"); return pedido; },
    canjear: async (_api, deviceCode, plazoMs) => {
      expect(deviceCode).toBe(DEVICE);
      llamadas.push("canjear");
      return (o.canjear ?? (() => ({ tipo: "pendiente" })))(plazoMs, r);
    },
    revocarPropia: async (_api, clave, plazoMs) => {
      llamadas.push(`revocarPropia ${clave}`);
      return (o.revocar ?? (() => "revocada"))(clave, plazoMs, r);
    },
    avisar: (s) => avisos.push(s),
  };
  return { d, g, r, llavero, archivo, avisos, llamadas };
}

const sinSecretos = (v: unknown) => {
  const s = JSON.stringify(v);
  expect(s).not.toMatch(/[0-9a-f]{64}/);
  expect(s).not.toContain("scf_");
};

describe("loginStart", () => {
  it("sale 5 con lo que la persona necesita, sin el device_code, y lo guarda como pendiente", async () => {
    const { d, g } = armar();
    const r = await loginStart(d, { dryRun: false });
    expect(r.codigo).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/[0-9a-f]{64}/);
    expect(r.json).toEqual({
      ok: false, esperando: "persona", verification_uri: pedido.verificationUri,
      verification_uri_complete: pedido.verificationUriComplete, user_code: "BCDF-GHJK", expires_in: 600,
    });
    expect(r.texto).toBe(`Open ${pedido.verificationUriComplete} and confirm the code BCDF-GHJK. Then run \`supcoflow login --wait\`.`);
    expect(await g.leerPendiente(ORIGEN)).toEqual({
      deviceCode: DEVICE, userCode: "BCDF-GHJK", verificationUriComplete: pedido.verificationUriComplete,
      venceEn: T0 + 600_000, intervaloS: 5, ultimoSondeoEn: null,
    });
  });
  it("--dry-run: sale 0 sin pedir código ni revocar nada", async () => {
    const { d, g, llamadas } = armar();
    await g.anotarPorRevocar(ORIGEN, X);
    const r = await loginStart(d, { dryRun: true });
    expect(r.codigo).toBe(0);
    expect(r.json).toEqual({ ok: true, dry_run: true, haria: `ask ${ORIGEN} for a device code` });
    expect(llamadas).toEqual([]);
    expect(await g.leerPendiente(ORIGEN)).toBeNull();
  });
  it("con una clave anotada «por revocar»: la revoca y la quita ANTES de pedir el código (Review Focus 14)", async () => {
    const { d, g, llamadas } = armar();
    await g.anotarPorRevocar(ORIGEN, X);
    await loginStart(d, { dryRun: false });
    expect(llamadas).toEqual([`revocarPropia ${X}`, "pedirCodigo"]);
    expect(await g.leerPorRevocar(ORIGEN)).toEqual({ claves: [], completa: true });
  });
  it("una anotada cuya revocación falla queda anotada, y el login sigue", async () => {
    const { d, g } = armar({ revocar: () => { throw new Error("red"); } });
    await g.anotarPorRevocar(ORIGEN, X);
    expect((await loginStart(d, { dryRun: false })).codigo).toBe(5);
    expect(await g.leerPorRevocar(ORIGEN)).toEqual({ claves: [X], completa: true });
  });
  it("con el llavero sin responder, «cuántas quedan» es «no sé» y lo avisa (Review Focus 15)", async () => {
    const { d, g, llavero, avisos } = armar();
    await g.anotarPorRevocar(ORIGEN, X);
    llavero.roto = (op) => op === "leer";
    expect((await loginStart(d, { dryRun: false })).codigo).toBe(5);
    expect(avisos.join("\n")).toContain("I couldn't read the whole list of keys waiting to be revoked");
  });
  it("no toca la clave vigente (Review Focus 7)", async () => {
    const { d, g } = armar();
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
  });
  it("si no puede guardar el pendiente (ni llavero ni archivo), sale 1 sin el device_code", async () => {
    const { d, llavero, archivo } = armar();
    llavero.roto = (op) => op === "escribir";
    archivo.roto = (op) => op === "escribir";
    const r = await loginStart(d, { dryRun: false });
    expect(r.codigo).toBe(1);
    sinSecretos(r);
  });
});

describe("loginWait", () => {
  it("sin pendiente → 3 sin_login_en_curso", async () => {
    const { d, llamadas } = armar();
    const r = await loginWait(d);
    expect(r.codigo).toBe(3);
    expect(r.json).toMatchObject({ ok: false, error: "sin_login_en_curso" });
    expect(llamadas).toEqual([]);
  });
  it("con token: 0, la clave guardada, el pendiente borrado y la salida sin la clave", async () => {
    const { d, g, avisos } = armar({ canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await loginStart(d, { dryRun: false });
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(r.json).toEqual({ ok: true, equipo: "tnt_1", guardada_en: "llavero", anterior_revocada: null, queda_por_revocar: false });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
    expect(await g.leerPendiente(ORIGEN)).toBeNull();
    sinSecretos(r);
    sinSecretos(avisos);
  });
  it("sesión previa, aprobada: la anterior se revoca DESPUÉS de guardar la nueva (Review Focus 7)", async () => {
    const { d, g, llamadas } = armar({ canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await g.guardarClave(ORIGEN, A);
    llamadas.length = 0;
    await loginStart(d, { dryRun: false });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
    expect(llamadas).toEqual(["pedirCodigo", "canjear", `guardarClave ${B}`, `revocarPropia ${A}`]);
    expect(r.json.anterior_revocada).toBe(true);
    expect(r.json.queda_por_revocar).toBe(false);
  });
  it("sesión previa, rechazada: 4, la anterior sigue y nadie la revocó", async () => {
    const { d, g, llamadas } = armar({ canjear: () => ({ tipo: "rechazado" }) });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    const r = await loginWait(d);
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ ok: false, error: "acceso_rechazado" });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
    expect(llamadas.some((l) => l.startsWith("revocarPropia"))).toBe(false);
    expect(await g.leerPendiente(ORIGEN)).toBeNull();
  });
  it("sesión previa, abandonada: la anterior sigue", async () => {
    const { d, g } = armar();
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
  });
  it("token y el borrado del pendiente falla: 0, B guardada, A revocada igual (Review Focus 13 y 14)", async () => {
    const { d, g, llavero, archivo, llamadas } = armar({ canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    llavero.roto = (op) => op === "borrar";
    archivo.roto = (op) => op === "borrar";
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
    expect(llamadas).toContain(`revocarPropia ${A}`);
    expect(r.json.anterior_revocada).toBe(true);
  });
  it("token y guardar la nueva falla en los dos almacenes: 1 no_se_pudo_guardar, B revocada, A intacta (Review Focus 13)", async () => {
    const { d, g, llavero, archivo, llamadas } = armar({ canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    // Sólo la cuenta de la clave: el pendiente se sigue pudiendo escribir y borrar.
    llavero.roto = (op, c) => op === "escribir" && c === ORIGEN;
    archivo.roto = (op, c) => op === "escribir" && c === ORIGEN;
    const r = await loginWait(d);
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "no_se_pudo_guardar" });
    expect(llamadas).toContain(`revocarPropia ${B}`);
    expect(llamadas).not.toContain(`revocarPropia ${A}`);
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: A, fuente: "llavero" });
    sinSecretos(r);
  });
  it("revocar la anterior falla: 0, queda anotada y lo avisa (Review Focus 14)", async () => {
    const { d, g, avisos } = armar({
      canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }),
      revocar: () => { throw new Error("red caída"); },
    });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ ok: true, anterior_revocada: false, queda_por_revocar: true });
    expect(await g.leerPorRevocar(ORIGEN)).toEqual({ claves: [A], completa: true });
    expect(avisos).toContain("I couldn't revoke your previous key; it's noted down and I'll try again on the next login or logout.");
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
  });
  it("revocar la anterior falla Y anotarla falla: 1 clave_anterior_sin_revocar, pero B quedó guardada", async () => {
    const { d, g, llavero, archivo, avisos } = armar({
      canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }),
      revocar: () => { throw new Error("red caída"); },
    });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    llavero.roto = (op, c) => op === "escribir" && c.endsWith("#por_revocar");
    archivo.roto = (op, c) => op === "escribir" && c.endsWith("#por_revocar");
    const r = await loginWait(d);
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "clave_anterior_sin_revocar", guardada_en: "llavero" });
    expect(await g.leerClave(ORIGEN)).toEqual({ clave: B, fuente: "llavero" });
    expect(avisos.join("\n")).toContain("Accesos desde la terminal");
    sinSecretos(r);
  });
  it("vencido → 2 codigo_vencido, invalido → 2 codigo_invalido; los dos borran el pendiente", async () => {
    for (const [tipo, error] of [["vencido", "codigo_vencido"], ["invalido", "codigo_invalido"]] as const) {
      const { d, g } = armar({ canjear: () => ({ tipo }) });
      await loginStart(d, { dryRun: false });
      const r = await loginWait(d);
      expect(r.codigo).toBe(2);
      expect(r.json).toMatchObject({ ok: false, error });
      expect(r.texto).toContain("supcoflow login --start");
      expect(await g.leerPendiente(ORIGEN)).toBeNull();
    }
  });
  it("pendiente hasta el fin del tramo: 5, y el pendiente queda con el intervalo y el último sondeo al día", async () => {
    const sondeos: number[] = [];
    const { d, g, r: rel } = armar({ canjear: (_p, r) => { sondeos.push(r.ahora()); return sondeos.length === 2 ? { tipo: "slow_down" } : { tipo: "pendiente" }; } });
    await loginStart(d, { dryRun: false });
    const inicio = rel.ahora();
    const r = await loginWait(d);
    expect(r.codigo).toBe(5);
    expect(r.json).toEqual({ ok: false, esperando: "persona", user_code: "BCDF-GHJK", verification_uri_complete: pedido.verificationUriComplete });
    sinSecretos(r);
    const p = await g.leerPendiente(ORIGEN);
    expect(p).toMatchObject({ deviceCode: DEVICE, intervaloS: 10, ultimoSondeoEn: sondeos.at(-1) });
    expect(sondeos.length).toBeGreaterThan(3);
    expect(rel.ahora() - inicio).toBeLessThanOrEqual(TRAMO_MAXIMO_MS);
    // Y el próximo --wait no sondea antes de tiempo (Review Focus 4).
    const antes = sondeos.length;
    await loginWait(d);
    expect(sondeos[antes]! - sondeos[antes - 1]!).toBeGreaterThanOrEqual(10_000);
  });
  it("una caída de la red mientras sondea sale 1 con un mensaje legible, sin secretos", async () => {
    const { d } = armar({ canjear: () => { throw new Error(`fetch failed ${DEVICE}`); } });
    await loginStart(d, { dryRun: false });
    const r = await loginWait(d);
    expect(r.codigo).toBe(1);
    sinSecretos(r);
  });
  it("con SUPCOFLOW_TOKEN definida, la anterior es la GUARDADA (no la del entorno) y avisa que la variable manda", async () => {
    const { d, g, llamadas, avisos } = armar({ env: { SUPCOFLOW_TOKEN: X }, canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await g.guardarClave(ORIGEN, A);
    await loginStart(d, { dryRun: false });
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(llamadas).toContain(`revocarPropia ${A}`);
    expect(llamadas).not.toContain(`revocarPropia ${X}`);
    expect(avisos).toContain("SUPCOFLOW_TOKEN is set and takes priority over the key I just saved.");
  });
});

describe("el comando entero en ≤ 90 s con TODO lento (Review Focus 10)", () => {
  // Cada canje consume su plazo completo, cada operación del guardado su techo, y la revocación de
  // la anterior consume el suyo y falla (para forzar la anotación). Para que el token llegue lo más
  // tarde posible, cada caso corre dos veces: la primera, sin token, cuenta cuántos canjes entran
  // en el tramo; la segunda devuelve el token en ESE último canje. Los desplazamientos del primer
  // canje mueven dónde cae el último respecto de `finDeSondeos` (incluido justo encima).
  async function correr(desplazamientoMs: number, tokenEn: number | null) {
    let canjes = 0;
    const h = armar({
      canjear: (plazoMs, r) => {
        canjes++;
        r.avanzar(canjes === 1 ? Math.max(0, plazoMs - desplazamientoMs) : plazoMs);
        return canjes === tokenEn ? { tipo: "token", clave: B, equipo: "tnt_1" } : { tipo: "pendiente" };
      },
      revocar: (_c, plazoMs, r) => { r.avanzar(plazoMs); throw new Error("motor lento"); },
    });
    await h.g.guardarClave(ORIGEN, A);
    await loginStart(h.d, { dryRun: false });
    h.llavero.lento = true; h.archivo.lento = true;
    const inicio = h.r.ahora();
    const res = await loginWait(h.d);
    return { ...h, res, transcurrido: h.r.ahora() - inicio, canjes, inicio };
  }

  it.each([0, 1_000, 2_000, 3_000, 4_000, 5_000, 8_000, 12_000, 14_999])("desplazamiento %i ms", async (desp) => {
    const ensayo = await correr(desp, null);
    expect(ensayo.res.codigo).toBe(5);
    expect(ensayo.transcurrido).toBeLessThanOrEqual(TRAMO_MAXIMO_MS);
    const h = await correr(desp, ensayo.canjes);
    expect(h.res.codigo).toBe(0);
    expect(h.transcurrido).toBeLessThanOrEqual(TRAMO_MAXIMO_MS);
    h.llavero.lento = false; h.archivo.lento = false;
    expect(await h.g.leerClave(ORIGEN)).toMatchObject({ clave: B });
    expect(h.llamadas).toContain(`revocarPropia ${A}`);
    expect(h.res.json).toMatchObject({ anterior_revocada: false, queda_por_revocar: true });
    expect((await h.g.leerPorRevocar(ORIGEN)).claves).toEqual([A]);
  });

  it("el token llega exactamente en finDeSondeos y el cierre igual entra", async () => {
    // Un canje que consume justo lo que queda hasta el fin de los sondeos, y devuelve el token.
    const h = armar({
      canjear: (plazoMs, r) => { r.avanzar(plazoMs); return plazoMs < 15_000 ? { tipo: "token", clave: B, equipo: "tnt_1" } : { tipo: "pendiente" }; },
      revocar: (_c, plazoMs, r) => { r.avanzar(plazoMs); throw new Error("motor lento"); },
    });
    await h.g.guardarClave(ORIGEN, A);
    await loginStart(h.d, { dryRun: false });
    // Sin la lectura lenta del principio, los canjes de 15 s caen de modo que el último queda recortado.
    const inicio = h.r.ahora();
    const finDeSondeos = inicio + TRAMO_MAXIMO_MS - RESERVA_PARA_CERRAR_MS;
    let tokenEn = -1;
    const canjear = h.d.canjear;
    h.d.canjear = async (api, dc, plazoMs) => {
      const c = await canjear(api, dc, plazoMs);
      if (c.tipo === "token") { tokenEn = h.r.ahora(); h.llavero.lento = true; h.archivo.lento = true; }
      return c;
    };
    const r = await loginWait(h.d);
    expect(tokenEn).toBe(finDeSondeos);
    expect(r.codigo).toBe(0);
    expect(h.r.ahora() - inicio).toBeLessThanOrEqual(TRAMO_MAXIMO_MS);
    expect(r.json).toMatchObject({ queda_por_revocar: true });
  });
});

// La clave A vive en un llavero bloqueado (nada en el archivo). Si la lectura que vence se tomara
// por «no hay clave», el token nuevo pisaría A en el llavero sin revocarla: viva y olvidada.
describe("loginWait con la clave anterior ilegible (Review Focus 12 y 14)", () => {
  async function conAIlegible(env?: Record<string, string>) {
    const h = armar({ env, canjear: () => ({ tipo: "token", clave: B, equipo: "tnt_1" }) });
    await h.g.guardarClave(ORIGEN, A);
    await loginStart(h.d, { dryRun: false });
    h.llamadas.length = 0;
    // Un llavero que se cuelga: consume su techo entero y recién ahí falla, sólo al leer la clave.
    h.llavero.lento = true;
    h.llavero.roto = (op, c) => op === "leer" && c === ORIGEN;
    const r = await loginWait(h.d);
    h.llavero.lento = false;
    h.llavero.roto = () => false;
    return { ...h, r };
  }
  it("sale 1 no_pude_leer_la_clave ANTES de sondear, conserva el pendiente y no pisa ni revoca nada", async () => {
    const { r, g, llavero, llamadas } = await conAIlegible();
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "no_pude_leer_la_clave" });
    expect(String(r.json.message)).toContain("supcoflow login --wait");
    expect(llamadas).toEqual([]); // ni canjear ni revocarPropia
    expect(await g.leerPendiente(ORIGEN)).toMatchObject({ deviceCode: DEVICE });
    expect(llavero.datos.get(ORIGEN)?.valor).toBe(A);
    sinSecretos(r);
  });
  it("con SUPCOFLOW_TOKEN definida también: la anterior guardada es la que se pisaría", async () => {
    const { r, g, llavero, llamadas } = await conAIlegible({ SUPCOFLOW_TOKEN: X });
    expect(r.codigo).toBe(1);
    expect(r.json.error).toBe("no_pude_leer_la_clave");
    expect(llamadas).toEqual([]);
    expect(await g.leerPendiente(ORIGEN)).not.toBeNull();
    expect(llavero.datos.get(ORIGEN)?.valor).toBe(A);
    sinSecretos(r);
  });
  it("cuando el llavero vuelve, el reintento sí termina: guarda B y revoca A", async () => {
    const { d, llamadas } = await conAIlegible();
    const r = await loginWait(d);
    expect(r.codigo).toBe(0);
    expect(llamadas).toContain(`revocarPropia ${A}`);
  });
});
