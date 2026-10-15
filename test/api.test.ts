import { describe, expect, it } from "vitest";
import { API_DE_PRODUCCION, canjear, pedirCodigo, quienSoy, revocarPropia, urlDeLaApi, type Fetch } from "../src/api.ts";

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
