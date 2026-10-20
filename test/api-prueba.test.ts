// Los tres pedidos de la prueba (bloque 7) contra un `fetch` falso: la forma real de las respuestas del
// motor (app/api/proyectos/[projectId]/{diagnostico,pruebas,pruebas/[pruebaId]}/route.ts).
import { describe, expect, it } from "vitest";
import { leerDiagnostico, leerPrueba, pedirPrueba, type Fetch } from "../src/api.ts";

const API = new URL("http://localhost:3000");
const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
function falso(status: number, cuerpo: unknown, vistos: Request[] = []): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    vistos.push(new Request(input, init));
    return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  }) as Fetch;
}
const DIAG = {
  listo: false,
  puntos: [{ punto: "despachos", ok: false, mensaje: "En pausa." }, { punto: "acuerdo", ok: true, mensaje: "Sin acuerdo." }],
  politica: "relevar", techo_usd: 2, saldo_usd: null, tope_usd: null, comprometido_usd: null, prueba_abierta: "prb_0123456789abcdef",
};

describe("leerDiagnostico", () => {
  it("lee la forma del motor, con nulls y puntos que no conoce", async () => {
    const vistos: Request[] = [];
    const g = await leerDiagnostico(API, CLAVE, "proj_1", falso(200, DIAG, vistos));
    expect(g).toEqual({
      listo: false, puntos: DIAG.puntos, politica: "relevar", techoUsd: 2, saldoUsd: null, topeUsd: null, comprometidoUsd: null, pruebaAbierta: "prb_0123456789abcdef",
    });
    expect(new URL(vistos[0]!.url).pathname).toBe("/api/proyectos/proj_1/diagnostico");
    expect(vistos[0]!.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
  });
  it("una forma a medias es respuesta_inesperada; un 404 es su error", async () => {
    await expect(leerDiagnostico(API, CLAVE, "p", falso(200, { ...DIAG, techo_usd: "2" }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
    await expect(leerDiagnostico(API, CLAVE, "p", falso(404, { error: "proyecto_inexistente", message: "No." }))).rejects.toMatchObject({ codigo: 3, error: "proyecto_inexistente" });
  });
});

describe("pedirPrueba", () => {
  const INTENTO = { clave: "k-1", mensaje: null, techoUsd: 2 };
  it("manda Bearer, Idempotency-Key y {techo_usd} (sin mensaje si es el del motor); 202 → aceptada", async () => {
    const vistos: Request[] = [];
    const r = await pedirPrueba(API, CLAVE, "proj_1", INTENTO, falso(202, { prueba_id: "prb_0123456789abcdef", reporte_id: "rep_1", estado: "creada" }, vistos));
    expect(r).toEqual({ tipo: "aceptada", pruebaId: "prb_0123456789abcdef", reporteId: "rep_1", estado: "creada" });
    const q = vistos[0]!;
    expect(q.method).toBe("POST");
    expect(new URL(q.url).pathname).toBe("/api/proyectos/proj_1/pruebas");
    expect(q.headers.get("idempotency-key")).toBe("k-1");
    expect(q.headers.get("authorization")).toBe(`Bearer ${CLAVE}`);
    expect(await q.json()).toEqual({ techo_usd: 2 });
  });
  it("con mensaje propio lo manda", async () => {
    const vistos: Request[] = [];
    await pedirPrueba(API, CLAVE, "p", { ...INTENTO, mensaje: "hola" }, falso(202, { prueba_id: "prb_0123456789abcdef", reporte_id: "r", estado: "creada" }, vistos));
    expect(await vistos[0]!.json()).toEqual({ techo_usd: 2, mensaje: "hola" });
  });
  it.each([
    [503, { error: "despachos_en_pausa", message: "Pausa." }, "despachos_en_pausa"],
    [500, { error: "misconfigured_engine", message: "x" }, "misconfigured_engine"],
    [409, { error: "idempotency_en_curso", message: "x" }, "idempotency_en_curso"],
    [502, "<html>bad gateway</html>", "respuesta_inesperada"],
    [202, { prueba_id: "otro", estado: "creada" }, "respuesta_inesperada"],
  ])("%i → ambigua (%s)", async (status, cuerpo, error) => {
    expect(await pedirPrueba(API, CLAVE, "p", INTENTO, falso(status, cuerpo))).toMatchObject({ tipo: "ambigua", error });
  });
  it("sin respuesta (red caída o corte) → ambigua motor_inalcanzable", async () => {
    const f = (async () => { throw new TypeError("socket hang up"); }) as Fetch;
    expect(await pedirPrueba(API, CLAVE, "p", INTENTO, f)).toMatchObject({ tipo: "ambigua", error: "motor_inalcanzable" });
  });
  it.each([
    [400, "falta_idempotency_key"], [401, "clave_invalida"], [403, "requiere_api_key"], [403, "clave_de_consulta"], [404, "proyecto_inexistente"],
    [409, "techo_distinto"], [409, "prueba_en_curso"], [409, "chat_deshabilitado"], [409, "idempotency_key_reusada"], [429, "tope_mensual"],
  ])("%i %s → rechazo, con el cuerpo", async (status, error) => {
    const r = await pedirPrueba(API, CLAVE, "p", INTENTO, falso(status, { error, message: "m", comprometido_usd: 9.5, tope_usd: 10 }));
    expect(r).toMatchObject({ tipo: "rechazo", status, error, message: "m", cuerpo: { comprometido_usd: 9.5, tope_usd: 10 } });
  });
});

describe("leerPrueba", () => {
  const S = {
    prueba_id: "prb_0123456789abcdef", estado: "issue_creado", abierta: false, mensaje: "La prueba llegó hasta el issue.",
    reporte: { id: "rep_1", url: "https://app.supcoflow.dev/proyectos/r/reportes/rep_1" },
    run: { id: "run_1", status: "completed", motivo: null },
    issue: { numero: 42, url: "https://github.com/d/r/issues/42" },
    cobro: { estado: "pendiente", usd: null, techo_usd: 2 },
  };
  it("lee la forma del motor y conserva usd null (pendiente nunca es 0)", async () => {
    const vistos: Request[] = [];
    const s = await leerPrueba(API, CLAVE, "proj_1", "prb_0123456789abcdef", falso(200, S, vistos), 5_000);
    expect(s).toEqual({
      pruebaId: S.prueba_id, estado: "issue_creado", abierta: false, mensaje: S.mensaje, reporte: S.reporte,
      run: { id: "run_1", status: "completed", motivo: null }, issue: S.issue, cobro: { estado: "pendiente", usd: null, techo_usd: 2 },
    });
    expect(new URL(vistos[0]!.url).pathname).toBe("/api/proyectos/proj_1/pruebas/prb_0123456789abcdef");
  });
  it("sin run: run null y cobro con estado null", async () => {
    const s = await leerPrueba(API, CLAVE, "p", "prb_0123456789abcdef", falso(200, { ...S, estado: "creada", run: null, issue: null, cobro: { estado: null, usd: null, techo_usd: 2 } }));
    expect(s.run).toBeNull();
    expect(s.cobro).toEqual({ estado: null, usd: null, techo_usd: 2 });
  });
  it("404 prueba_inexistente sale 3; un cobro sin techo es respuesta_inesperada", async () => {
    await expect(leerPrueba(API, CLAVE, "p", "prb_0123456789abcdef", falso(404, { error: "prueba_inexistente", message: "No." }))).rejects.toMatchObject({ codigo: 3, error: "prueba_inexistente" });
    await expect(leerPrueba(API, CLAVE, "p", "prb_0123456789abcdef", falso(200, { ...S, cobro: { estado: "leido", usd: 1 } }))).rejects.toMatchObject({ error: "respuesta_inesperada" });
  });
});
