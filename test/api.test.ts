import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { API_DE_PRODUCCION, buscarProyecto, canjear, elegirOrigen, leerGuia, leerWidget, publicarGuia, revisarGuia, configurar, crearConexion, crearProyecto, esClaveDeConsultaDelProyecto, leerCatalogo, leerConfiguracion, leerProyecto, listarClaves, subirLogo, pedirCodigo, quienSoy, revocarPropia, ultimaConexion, urlDeLaApi, type Fetch } from "../src/api.ts";

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

describe("configurar (bloque 4)", () => {
  it("configurar manda Bearer, JSON e idempotency-key si se pasa", async () => {
    const vistos: Request[] = [];
    const r = await configurar(API, CLAVE, "/api/proyectos/p/chat/prender", { a: 1 }, falso(200, { ok: true }, vistos), { idempotencyKey: "k-1" });
    expect(r).toEqual({ status: 200, cuerpo: { ok: true } });
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(vistos[0]!.headers.get("content-type")).toBe("application/json");
    expect(vistos[0]!.headers.get("idempotency-key")).toBe("k-1");
    expect(await vistos[0]!.json()).toEqual({ a: 1 });
    const sin: Request[] = [];
    await configurar(API, CLAVE, "/x", {}, falso(200, {}, sin));
    expect(sin[0]!.headers.get("idempotency-key")).toBeNull();
  });
  it("un 409 vuelve como respuesta, sin lanzar", async () => {
    expect(await configurar(API, CLAVE, "/x", {}, falso(409, { error: "lista_cambio" }))).toEqual({ status: 409, cuerpo: { error: "lista_cambio" } });
  });
  it("un 403 clave_de_consulta sale FalloDeLaTerminal 4 y sin la clave", async () => {
    const e = await configurar(API, CLAVE, "/x", {}, falso(403, { error: "clave_de_consulta", message: `no con ${CLAVE}` })).catch((x) => x);
    expect(e).toMatchObject({ codigo: 4, error: "clave_de_consulta" });
    expect(String(e.message)).not.toContain(CLAVE);
  });
  it("subirLogo manda un FormData con el campo logo", async () => {
    const vistos: Request[] = [];
    await subirLogo(API, CLAVE, "p1", { bytes: new Uint8Array([1, 2, 3]), mime: "image/png", nombre: "l.png" }, falso(200, { ok: true }, vistos));
    expect(vistos[0]!.url).toContain("/api/proyectos/p1/chat/logo");
    const fd = await vistos[0]!.formData();
    const f = fd.get("logo") as File;
    expect(f.name).toBe("l.png");
    expect(f.type).toBe("image/png");
  });
  it("leerCatalogo y leerConfiguracion validan la forma", async () => {
    expect(await leerCatalogo(API, CLAVE, falso(200, { supcoflow: [] }))).toEqual({ supcoflow: [] });
    await expect(leerCatalogo(API, CLAVE, falso(200, { otro: 1 }))).rejects.toMatchObject({ codigo: 1, error: "respuesta_inesperada" });
    const c = { chat: {}, sitios: [] };
    expect(await leerConfiguracion(API, CLAVE, "p", falso(200, c))).toEqual(c);
    await expect(leerConfiguracion(API, CLAVE, "p", falso(200, { chat: {} }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
  });
  it("listarClaves devuelve id, nombre y creadaEn", async () => {
    const r = await listarClaves(API, CLAVE, "p", falso(200, { claves: [{ id: "1", nombre: "n", creada_en: "2026-10-16" }] }));
    expect(r).toEqual([{ id: "1", nombre: "n", creadaEn: "2026-10-16" }]);
    await expect(listarClaves(API, CLAVE, "p", falso(200, { claves: [{ id: "1" }] }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
  });
});

describe("esClaveDeConsultaDelProyecto (la prueba de posesión de claves crear)", () => {
  it("true sólo con 200, via clave_de_consulta y el mismo proyecto; manda el Bearer a /api/yo", async () => {
    const vistos: Request[] = [];
    expect(await esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(200, { via: "clave_de_consulta", equipo: "t", usuario: null, proyecto: "proj_1" }, vistos))).toBe(true);
    expect(new URL(vistos[0]!.url).pathname).toBe("/api/yo");
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
  });
  it("una clave PERSONAL (lee el proyecto, pero no es de consulta) o de otro proyecto → false", async () => {
    expect(await esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(200, { via: "api_key", equipo: "t", usuario: { id: "u" }, proyecto: null }))).toBe(false);
    expect(await esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(200, { via: "clave_de_consulta", equipo: "t", usuario: null, proyecto: "proj_2" }))).toBe(false);
  });
  it("401 → false (no «iniciá sesión»); ≥ 500 → motor_inalcanzable; otra cosa → respuesta_inesperada", async () => {
    expect(await esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(401, { error: "clave_invalida" }))).toBe(false);
    await expect(esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(503, {}))).rejects.toMatchObject({ error: "motor_inalcanzable" });
    await expect(esClaveDeConsultaDelProyecto(API, CLAVE, "proj_1", falso(403, {}))).rejects.toMatchObject({ error: "respuesta_inesperada" });
  });
});

describe("la versión que viaja en el user-agent", () => {
  it("es la del package.json (si se sube una y no la otra, esto avisa)", () => {
    const fuente = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
    const enApi = /^const VERSION = "([^"]+)";/m.exec(fuente)?.[1];
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(enApi).toBe(pkg.version);
  });
});

describe("los pedidos de la guía (bloque 5)", () => {
  const ID = "p/1";
  it("revisarGuia: POST …/guia/revisar con {contenido} y Bearer", async () => {
    const vistos: Request[] = [];
    const r = await revisarGuia(API, CLAVE, ID, "## A\n", falso(200, { ok: true, secciones: 1 }, vistos));
    expect(r).toEqual({ status: 200, cuerpo: { ok: true, secciones: 1 } });
    expect(vistos[0].method).toBe("POST");
    expect(new URL(vistos[0].url).pathname).toBe("/api/proyectos/p%2F1/guia/revisar");
    expect(vistos[0].headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(await vistos[0].json()).toEqual({ contenido: "## A\n" });
  });
  it("publicarGuia directa: manda {contenido, commit, rama}", async () => {
    const vistos: Request[] = [];
    await publicarGuia(API, CLAVE, ID, { contenido: "## A\n", commit: "a".repeat(40), rama: "main" }, falso(200, { ok: true }, vistos));
    expect(new URL(vistos[0].url).pathname).toBe("/api/proyectos/p%2F1/guia/publicar");
    expect(vistos[0].headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(await vistos[0].json()).toEqual({ contenido: "## A\n", commit: "a".repeat(40), rama: "main" });
  });
  it("publicarGuia: POST …/guia/publicar con {huella}", async () => {
    const vistos: Request[] = [];
    await publicarGuia(API, CLAVE, ID, { huella: "h".repeat(64) }, falso(409, { error: "guia_no_subida" }, vistos));
    expect(vistos[0].method).toBe("POST");
    expect(new URL(vistos[0].url).pathname).toBe("/api/proyectos/p%2F1/guia/publicar");
    expect(vistos[0].headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(await vistos[0].json()).toEqual({ huella: "h".repeat(64) });
  });
  it("leerGuia: GET …/guia?comprobar=1 sin cuerpo", async () => {
    const vistos: Request[] = [];
    await leerGuia(API, CLAVE, ID, falso(200, { guia: null, otra: null }, vistos));
    expect(vistos[0].method).toBe("GET");
    const u = new URL(vistos[0].url);
    expect([u.pathname, u.search]).toEqual(["/api/proyectos/p%2F1/guia", "?comprobar=1"]);
    expect(vistos[0].headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
  });
  it("elegirOrigen: POST …/guia/origen con {origen}", async () => {
    const vistos: Request[] = [];
    await elegirOrigen(API, CLAVE, ID, "agente", falso(409, { error: "sin_guia_del_agente" }, vistos));
    expect(vistos[0].method).toBe("POST");
    expect(new URL(vistos[0].url).pathname).toBe("/api/proyectos/p%2F1/guia/origen");
    expect(await vistos[0].json()).toEqual({ origen: "agente" });
  });
  it("una clave rota es 401 y un 5xx es motor_inalcanzable, como en los demás pedidos", async () => {
    await expect(leerGuia(API, CLAVE, ID, falso(401, { error: "x" }))).rejects.toMatchObject({ error: "clave_invalida" });
    await expect(revisarGuia(API, CLAVE, ID, "", falso(503, { error: "x" }))).rejects.toMatchObject({ error: "motor_inalcanzable" });
  });
});

const WIDGET = {
  tenant_id: "t_1", project_id: "proj_1", backend_url: "https://chat.supcoflow.dev",
  paquete: "@supcoflow/chat", version: "2.2.1", instalar: "npm i @supcoflow/chat@2.2.1 --save-exact",
  nextjs: { estado: "probando", archivo_sugerido: "app/_supcoflow/support-chat.tsx", archivos_anteriores: ["app/_supcoflow/chat-de-soporte.tsx"], contenido: '"use client";\n', uso: "<SupcoflowChat />" },
  script: { estado: "disponible_sin_soporte", linea: "<script src=\"x\"></script>" },
  csp: "connect-src 'self' https://chat.supcoflow.dev;",
};

describe("leerWidget", () => {
  it("GET con Bearer a /api/proyectos/{id}/widget y devuelve la forma validada", async () => {
    const vistos: Request[] = [];
    expect(await leerWidget(API, CLAVE, "proj_1", falso(200, WIDGET, vistos))).toEqual(WIDGET);
    expect(new URL(vistos[0]!.url).pathname).toBe("/api/proyectos/proj_1/widget");
    expect(vistos[0]!.method).toBe("GET");
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
  });
  it("AD9: archivos_anteriores se lee SÓLO dentro de nextjs; ausente es lista vacía, y arriba de todo no se lee", async () => {
    const { archivos_anteriores: _fuera, ...sinLista } = WIDGET.nextjs;
    const sin = await leerWidget(API, CLAVE, "p", falso(200, { ...WIDGET, nextjs: sinLista, archivos_anteriores: ["app/x.tsx"], archivo_sugerido: "otro.tsx" }));
    expect(sin.nextjs.archivos_anteriores).toEqual([]);
    expect(sin).not.toHaveProperty("archivos_anteriores");
    expect(sin).not.toHaveProperty("archivo_sugerido");
    expect(sin.nextjs.archivo_sugerido).toBe("app/_supcoflow/support-chat.tsx");
  });
  it("archivos_anteriores con otra forma (no lista, o con algo que no es texto) es respuesta_inesperada", async () => {
    for (const malo of ["x.tsx", [1], [""]]) {
      await expect(leerWidget(API, CLAVE, "p", falso(200, { ...WIDGET, nextjs: { ...WIDGET.nextjs, archivos_anteriores: malo } }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
    }
  });
  it("una forma que no valida (campo faltante, estado raro, script sin linea) es respuesta_inesperada", async () => {
    const sin = { ...WIDGET, csp: undefined };
    await expect(leerWidget(API, CLAVE, "p", falso(200, sin))).rejects.toMatchObject({ codigo: 1, error: "respuesta_inesperada" });
    await expect(leerWidget(API, CLAVE, "p", falso(200, { ...WIDGET, nextjs: { ...WIDGET.nextjs, estado: "raro" } }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
    await expect(leerWidget(API, CLAVE, "p", falso(200, { ...WIDGET, script: {} }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
    await expect(leerWidget(API, CLAVE, "p", falso(200, { ...WIDGET, paquete: "otro" }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
  });
  it("404 sale como entrada inválida con el mensaje del motor tapado", async () => {
    await expect(leerWidget(API, CLAVE, "p", falso(404, { error: "proyecto_inexistente", message: `no está ${CLAVE}` })))
      .rejects.toSatisfy((e: { error: string; message: string; codigo: number }) =>
        e.error === "proyecto_inexistente" && e.codigo === 3 && !e.message.includes(CLAVE));
  });
});
