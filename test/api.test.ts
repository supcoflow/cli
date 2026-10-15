import { describe, expect, it, vi } from "vitest";
import { API_DE_PRODUCCION, buscarProyecto, canjear, crearConexion, crearProyecto, leerProyecto, pedirCodigo, quienSoy, revocarPropia, ultimaConexion, urlDeLaApi, type Fetch } from "../src/api.ts";

const API = new URL("http://localhost:3000");
const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
function falso(status: number, cuerpo: unknown, vistos: Request[] = []): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    vistos.push(new Request(input, init));
    return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  }) as Fetch;
}

describe("la URL de la API (§5.2)", () => {
  it("es producción por defecto", () => expect(urlDeLaApi({}).origin).toBe(API_DE_PRODUCCION));
  it("acepta localhost por http y cualquier https", () => {
    expect(urlDeLaApi({ SUPCOFLOW_API_URL: "http://localhost:3000/x" }).origin).toBe("http://localhost:3000");
    expect(urlDeLaApi({ SUPCOFLOW_API_URL: "https://otra.dev" }).origin).toBe("https://otra.dev");
  });
  it("rechaza http contra un host remoto (la clave viajaría en claro)", () => {
    expect(() => urlDeLaApi({ SUPCOFLOW_API_URL: "http://evil.com" })).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
});

describe("las redirecciones", () => {
  it("fetch recibe redirect error y una redirección sale como motor_inalcanzable sin Location", async () => {
    let init: RequestInit | undefined;
    const f = (async (_i: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      throw new TypeError("fetch failed: redirect to https://evil.example/robo");
    }) as Fetch;
    const e = await pedirCodigo(API, "m", f).catch((x) => x);
    expect(init?.redirect).toBe("error");
    expect(e).toMatchObject({ codigo: 1, error: "motor_inalcanzable" });
    expect(JSON.stringify(e.message)).not.toContain("evil");
  });
});

describe("los pedidos", () => {
  it("pedirCodigo manda client_id y maquina como formulario", async () => {
    const vistos: Request[] = [];
    const r = await pedirCodigo(API, "mi-mac", falso(200, {
      device_code: "d".repeat(64), user_code: "BCDF-GHJK", verification_uri: "http://localhost:3000/dispositivo",
      verification_uri_complete: "http://localhost:3000/dispositivo?codigo=BCDF-GHJK", expires_in: 600, interval: 5,
    }, vistos));
    expect(r.userCode).toBe("BCDF-GHJK");
    expect(new URLSearchParams(await vistos[0]!.text()).get("client_id")).toBe("supcoflow-cli");
    expect(vistos[0]!.url).toBe("http://localhost:3000/api/dispositivo/codigo");
  });
  it("pedirCodigo: 429 del motor es esperar, con su motivo", async () => {
    await expect(pedirCodigo(API, "m", falso(429, { error: "demasiados_pedidos" }))).rejects.toMatchObject({ codigo: 1, error: "demasiados_pedidos" });
  });
  it.each([
    ["authorization_pending", "pendiente"], ["slow_down", "slow_down"], ["access_denied", "rechazado"],
    ["expired_token", "vencido"], ["invalid_grant", "invalido"],
  ])("canjear: %s → %s", async (error, tipo) => {
    expect(await canjear(API, "d".repeat(64), falso(400, { error }))).toEqual({ tipo });
  });
  it("canjear: 200 trae la clave", async () => {
    expect(await canjear(API, "d".repeat(64), falso(200, { access_token: CLAVE, token_type: "Bearer", equipo: "tnt_x" })))
      .toEqual({ tipo: "token", clave: CLAVE, equipo: "tnt_x" });
  });
  it("quienSoy manda el Bearer y un 401 es falta de login (2)", async () => {
    const vistos: Request[] = [];
    await expect(quienSoy(API, CLAVE, falso(401, { error: "clave_invalida", message: "venció" }, vistos))).rejects.toMatchObject({ codigo: 2 });
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
  });
  it("revocarPropia: un 401 es que ya no valía, no un error", async () => {
    expect(await revocarPropia(API, CLAVE, falso(401, { error: "clave_invalida" }))).toBe("ya_no_valia");
  });
  it("una página HTML (protección de Vercel) es 1, sin el cuerpo ni la clave en el mensaje", async () => {
    const e = await quienSoy(API, CLAVE, falso(403, "<html>Vercel Authentication</html>")).catch((x) => x);
    expect(e).toMatchObject({ codigo: 1, error: "respuesta_inesperada" });
    expect(String(e.message)).not.toContain("<html>");
    expect(String(e.message)).not.toContain(CLAVE);
  });
  it("la red caída es 1 motor_inalcanzable", async () => {
    const f = (async () => { throw new TypeError("fetch failed"); }) as unknown as Fetch;
    await expect(quienSoy(API, CLAVE, f)).rejects.toMatchObject({ codigo: 1, error: "motor_inalcanzable" });
  });
});

const PEDIDO = { id: "cnx_0123456789abcdef", repo: "d/r", estado: "pendiente", url: "http://localhost:3000/conectar/cnx_0123456789abcdef", vence_en: "2026-10-15T12:30:00.000Z", repo_canonico: null, fallo: null };
const PROYECTO = { id: "proj_r-1", slug: "r", repo: "D/r", rama: "main", install_command: "npm ci", test_command: "npm test" };

describe("conexión y proyecto", () => {
  it("crearConexion manda el repo con el Bearer y traduce el pedido", async () => {
    const vistos: Request[] = [];
    const p = await crearConexion(API, CLAVE, "d/r", falso(201, { pedido: PEDIDO }, vistos));
    expect(p).toMatchObject({ id: PEDIDO.id, estado: "pendiente", venceEn: PEDIDO.vence_en, repoCanonico: null });
    expect(vistos[0]!.url).toBe("http://localhost:3000/api/conexiones");
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(await vistos[0]!.json()).toEqual({ repo: "d/r" });
  });
  it("Review Focus 6: cuenta sin GitHub es 4 con el mensaje del motor", async () => {
    await expect(crearConexion(API, CLAVE, "d/r", falso(422, { error: "cuenta_sin_github", message: "Tu cuenta entró con email." })))
      .rejects.toMatchObject({ codigo: 4, error: "cuenta_sin_github", message: "Tu cuenta entró con email." });
  });
  it("ultimaConexion: null es null, y el repo va escapado en la query", async () => {
    const vistos: Request[] = [];
    expect(await ultimaConexion(API, CLAVE, "d/r", falso(200, { pedido: null }, vistos))).toBeNull();
    expect(new URL(vistos[0]!.url).searchParams.get("repo")).toBe("d/r");
  });
  it("crearProyecto manda la Idempotency-Key y distingue cada respuesta", async () => {
    const vistos: Request[] = [];
    expect(await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k-1", falso(201, { proyecto: PROYECTO, reusado: false }, vistos)))
      .toEqual({ tipo: "ok", reusado: false, proyecto: { id: "proj_r-1", slug: "r", repo: "D/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" } });
    expect(vistos[0]!.headers.get("idempotency-key")).toBe("k-1");
    expect(await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k", falso(422, { error: "comandos_faltantes", faltantes: ["test_command"], message: "falta" })))
      .toEqual({ tipo: "comandos_faltantes", faltantes: ["test_command"], message: "falta" });
    expect(await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k", falso(409, { error: "idempotency_en_curso", message: "x" }))).toEqual({ tipo: "en_curso" });
    expect(await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k", falso(409, { error: "idempotency_key_reusada", message: "x" }))).toEqual({ tipo: "clave_reusada" });
    expect(await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k", falso(409, { error: "conexion_no_conectada", message: "pendiente" }))).toEqual({ tipo: "no_conectada", message: "pendiente" });
  });
  it("M3: los dos POST que crean algo esperan 30 s (el motor habla con Vercel y GitHub detrás); los demás, 15 s", async () => {
    const plazos = vi.spyOn(AbortSignal, "timeout");
    try {
      await crearConexion(API, CLAVE, "d/r", falso(201, { pedido: PEDIDO }));
      await crearProyecto(API, CLAVE, PEDIDO.id, {}, "k", falso(201, { proyecto: PROYECTO, reusado: false }));
      await buscarProyecto(API, CLAVE, "d/r", falso(200, { proyecto: null }));
      expect(plazos.mock.calls.map((c) => c[0])).toEqual([30_000, 30_000, 15_000]);
    } finally {
      plazos.mockRestore();
    }
  });
  it("buscarProyecto y leerProyecto", async () => {
    expect(await buscarProyecto(API, CLAVE, "d/r", falso(200, { proyecto: null }))).toBeNull();
    expect(await leerProyecto(API, CLAVE, "proj_r-1", falso(200, { proyecto: PROYECTO, github: { estado: null, verificado_en: null } })))
      .toMatchObject({ proyecto: { id: "proj_r-1" }, github: { estado: null, verificadoEn: null } });
    await expect(leerProyecto(API, CLAVE, "proj_x", falso(404, { error: "proyecto_inexistente", message: "No existe ese proyecto." })))
      .rejects.toMatchObject({ codigo: 3, error: "proyecto_inexistente" });
  });
});
