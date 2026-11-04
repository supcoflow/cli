// Los pedidos de `agents` al motor (tanda 9): rutas, métodos y cuerpos exactos, y el único lugar por donde viaja la clave de IA.
import { describe, expect, it } from "vitest";
import { configurarElChat, leerCuentasDeIa, ponerCuentaDeIa, quitarCuentaDeIa, validarCuentaDeIa, type Fetch } from "../src/api.ts";

const API = new URL("http://localhost:3000");
const SESION = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const CLAVE_DE_IA = "vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0ZyXwVu";

type Visto = { metodo: string; url: string; cabeceras: Record<string, string>; cuerpo: string; redirect: RequestRedirect | undefined };
function falso(status: number, cuerpo: unknown, vistos: Visto[] = []): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    vistos.push({
      metodo: init?.method ?? "GET", url: String(input),
      cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: typeof init?.body === "string" ? init.body : "", redirect: init?.redirect,
    });
    return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  }) as Fetch;
}

describe("leerCuentasDeIa", () => {
  it("GET /api/proyectos/{id}/cuentas-de-ia con la clave de la persona, sin cuerpo", async () => {
    const vistos: Visto[] = [];
    const r = await leerCuentasDeIa(API, SESION, "proj_x", falso(200, { cuentas: [] }, vistos));
    expect(r).toEqual({ status: 200, cuerpo: { cuentas: [] } });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatchObject({ metodo: "GET", url: "http://localhost:3000/api/proyectos/proj_x/cuentas-de-ia", cuerpo: "", redirect: "error" });
    expect(vistos[0]!.cabeceras.authorization).toBe(`Bearer ${SESION}`);
  });
  it("el id del proyecto se escapa en la ruta", async () => {
    const vistos: Visto[] = [];
    await leerCuentasDeIa(API, SESION, "a/b c", falso(200, { cuentas: [] }, vistos));
    expect(vistos[0]!.url).toBe("http://localhost:3000/api/proyectos/a%2Fb%20c/cuentas-de-ia");
  });
});

describe("ponerCuentaDeIa: la clave de IA viaja en el cuerpo de UN PUT y en ningún otro lado", () => {
  it("PUT /cuentas-de-ia/{agente} con {clave, proveedor} como JSON", async () => {
    const vistos: Visto[] = [];
    await ponerCuentaDeIa(API, SESION, "proj_x", "chat", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, falso(200, { cuenta: {} }, vistos));
    expect(vistos[0]).toMatchObject({ metodo: "PUT", url: "http://localhost:3000/api/proyectos/proj_x/cuentas-de-ia/chat" });
    expect(JSON.parse(vistos[0]!.cuerpo)).toEqual({ clave: CLAVE_DE_IA, proveedor: "ai_gateway" });
    expect(vistos[0]!.cabeceras["content-type"]).toBe("application/json");
  });
  it("la clave NO está en la URL ni en ninguna cabecera", async () => {
    const vistos: Visto[] = [];
    await ponerCuentaDeIa(API, SESION, "proj_x", "triaje", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, falso(200, { cuenta: {} }, vistos));
    expect(vistos[0]!.url).not.toContain("9f8e7d6c");
    expect(JSON.stringify(vistos[0]!.cabeceras)).not.toContain("9f8e7d6c");
  });
  it("no hay reintento ni redirección: un solo pedido, con redirect: error", async () => {
    const vistos: Visto[] = [];
    await ponerCuentaDeIa(API, SESION, "proj_x", "chat", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, falso(502, { error: "proveedor_no_responde" }, vistos));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]!.redirect).toBe("error");
  });
  it("una red caída sale como motor_inalcanzable SIN el mensaje del sistema (podría traer la URL o la clave)", async () => {
    const f = (async () => { throw new TypeError(`fetch failed: body ${CLAVE_DE_IA}`); }) as Fetch;
    const e = await ponerCuentaDeIa(API, SESION, "proj_x", "chat", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, f).catch((x) => x);
    expect(e).toMatchObject({ codigo: 1, error: "motor_inalcanzable" });
    expect(JSON.stringify([e.message, e.error])).not.toContain("9f8e7d6c");
  });
  it("un cuerpo que no es JSON → respuesta_inesperada sin pegar el cuerpo", async () => {
    const e = await ponerCuentaDeIa(API, SESION, "proj_x", "chat", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, falso(200, `<html>${CLAVE_DE_IA}</html>`)).catch((x) => x);
    expect(e).toMatchObject({ codigo: 1, error: "respuesta_inesperada" });
    expect(e.message).not.toContain("9f8e7d6c");
  });
});

describe("los errores del motor que importan llegan como respuesta, no como excepción", () => {
  it("502 y 503 pasan (traen el motivo de verdad: el proveedor no contestó / no hay llavero)", async () => {
    expect(await validarCuentaDeIa(API, SESION, "p", "chat", falso(502, { error: "proveedor_no_responde", message: "x" }))).toMatchObject({ status: 502, cuerpo: { error: "proveedor_no_responde" } });
    expect(await ponerCuentaDeIa(API, SESION, "p", "chat", { clave: CLAVE_DE_IA, proveedor: "ai_gateway" }, falso(503, { error: "cuentas_no_disponibles", message: "x" }))).toMatchObject({ status: 503 });
  });
  it("401 → exit 2 clave_invalida; una clave de consulta (403 requiere_persona) → 4", async () => {
    await expect(leerCuentasDeIa(API, SESION, "p", falso(401, { error: "x" }))).rejects.toMatchObject({ codigo: 2, error: "clave_invalida" });
    await expect(quitarCuentaDeIa(API, SESION, "p", "chat", falso(403, { error: "requiere_persona", message: "Esto lo pide una persona." }))).rejects.toMatchObject({ codigo: 4, error: "requiere_persona" });
  });
  it("500 sin cuerpo útil → motor_inalcanzable (1)", async () => {
    await expect(leerCuentasDeIa(API, SESION, "p", falso(500, { error: "error_interno" }))).rejects.toMatchObject({ codigo: 1 });
  });
  it("el `message` del motor pasa por taparSecretos", async () => {
    const r = await leerCuentasDeIa(API, SESION, "p", falso(404, { error: "proyecto_no_encontrado", message: `con ${CLAVE_DE_IA}` }));
    expect(JSON.stringify(r)).not.toContain("9f8e7d6c");
  });
});

describe("validar, quitar y configurar el chat", () => {
  it("POST …/{agente}/validar sin cuerpo", async () => {
    const vistos: Visto[] = [];
    await validarCuentaDeIa(API, SESION, "proj_x", "triaje", falso(200, { cuenta: {} }, vistos));
    expect(vistos[0]).toMatchObject({ metodo: "POST", url: "http://localhost:3000/api/proyectos/proj_x/cuentas-de-ia/triaje/validar", cuerpo: "" });
  });
  it("DELETE …/{agente}", async () => {
    const vistos: Visto[] = [];
    await quitarCuentaDeIa(API, SESION, "proj_x", "chat", falso(200, { cuenta: {} }, vistos));
    expect(vistos[0]).toMatchObject({ metodo: "DELETE", url: "http://localhost:3000/api/proyectos/proj_x/cuentas-de-ia/chat", cuerpo: "" });
  });
  it("PUT /agentes/chat con {opcion, sin_guardado_de_datos}", async () => {
    const vistos: Visto[] = [];
    await configurarElChat(API, SESION, "proj_x", { opcion: "estandar", sin_guardado_de_datos: true }, falso(200, { perfil: {} }, vistos));
    expect(vistos[0]).toMatchObject({ metodo: "PUT", url: "http://localhost:3000/api/proyectos/proj_x/agentes/chat" });
    expect(JSON.parse(vistos[0]!.cuerpo)).toEqual({ opcion: "estandar", sin_guardado_de_datos: true });
  });
});
