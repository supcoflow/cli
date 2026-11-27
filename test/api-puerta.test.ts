// Los pedidos de la etapa 2c al motor (`reports` y `gate`): ruta, método, cabeceras y cuerpo exactos, y por dónde viaja cada clave. Un `fetch` falso que lo anota todo.
import { describe, expect, it } from "vitest";
import {
  avisarElFallo, entregarElResultado, leerElEstadoDelAgente, leerElRecorrido, leerElReporteDeLaPuerta, listarReportes, pedirElPase, pedirLaInvestigacion, type Fetch,
} from "../src/api.ts";
import { CLAVE_DE_AGENTE, CLAVE_DE_PERSONA, HUELLA_DEL_RESULTADO, PASE } from "./puerta-fixtures.ts";

const API = new URL("http://localhost:3000");
type Visto = { metodo: string; url: string; cabeceras: Record<string, string>; cuerpo: string; redirect: RequestRedirect | undefined; conPlazo: boolean };
function falso(status: number, cuerpo: unknown, vistos: Visto[] = []): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    vistos.push({
      metodo: init?.method ?? "GET", url: String(input), cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: typeof init?.body === "string" ? init.body : "", redirect: init?.redirect, conPlazo: init?.signal instanceof AbortSignal,
    });
    return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status });
  }) as Fetch;
}

describe("las rutas de una persona (`/api/v1/proyectos/{id}/reportes…`), con su clave", () => {
  it("listarReportes: GET con filtro, pagina y por_pagina sólo cuando se piden", async () => {
    const v: Visto[] = [];
    await listarReportes(API, CLAVE_DE_PERSONA, "proj_x", { filtro: null, pagina: null, porPagina: null }, falso(200, {}, v));
    expect(v[0]).toMatchObject({ metodo: "GET", url: "http://localhost:3000/api/v1/proyectos/proj_x/reportes", cuerpo: "", redirect: "error", conPlazo: true });
    expect(v[0]!.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_PERSONA}`);
    await listarReportes(API, CLAVE_DE_PERSONA, "proj_x", { filtro: "necesitan", pagina: 2, porPagina: 10 }, falso(200, {}, v));
    expect(v[1]!.url).toBe("http://localhost:3000/api/v1/proyectos/proj_x/reportes?filtro=necesitan&pagina=2&por_pagina=10");
  });

  it("leerElRecorrido y pedirLaInvestigacion: los ids se escapan en la ruta y el POST no lleva cuerpo ni content-type", async () => {
    const v: Visto[] = [];
    await leerElRecorrido(API, CLAVE_DE_PERSONA, "a/b c", "rpt_1/../x", falso(200, {}, v));
    expect(v[0]!.url).toBe("http://localhost:3000/api/v1/proyectos/a%2Fb%20c/reportes/rpt_1%2F..%2Fx");
    await pedirLaInvestigacion(API, CLAVE_DE_PERSONA, "proj_x", "rpt_1", falso(202, {}, v));
    expect(v[1]).toMatchObject({ metodo: "POST", url: "http://localhost:3000/api/v1/proyectos/proj_x/reportes/rpt_1/investigacion", cuerpo: "", redirect: "error" });
    expect(v[1]!.cabeceras["content-type"]).toBeUndefined();
  });

  it("un 401, un 403 o un 409 NO lanzan: la respuesta entera vuelve al comando, que la dice con una frase suya (y un solo pedido)", async () => {
    for (const status of [401, 403, 404, 409, 503]) {
      const v: Visto[] = [];
      const r = await pedirLaInvestigacion(API, CLAVE_DE_PERSONA, "proj_x", "rpt_1", falso(status, { error: "x" }, v));
      expect(r).toEqual({ status, cuerpo: { error: "x" } });
      expect(v).toHaveLength(1);
    }
  });
});

describe("la puerta de los agentes (`/api/v1/agente`, `/api/v1/reportes/{id}…`), con la clave del agente", () => {
  it("la clave viaja SÓLO en Authorization: ni en la ruta, ni en la consulta, ni en el cuerpo", async () => {
    const v: Visto[] = [];
    const f = falso(200, {}, v);
    await leerElEstadoDelAgente(API, CLAVE_DE_AGENTE, f);
    await leerElReporteDeLaPuerta(API, CLAVE_DE_AGENTE, "rpt_1", f);
    await pedirElPase(API, CLAVE_DE_AGENTE, "rpt_1", f);
    await entregarElResultado(API, CLAVE_DE_AGENTE, "rpt_1", "ent_1", "{\"a\":1}", f);
    await avisarElFallo(API, CLAVE_DE_AGENTE, "rpt_1", "ent_1", "{\"b\":2}", f);
    expect(v.map((x) => `${x.metodo} ${new URL(x.url).pathname}`)).toEqual([
      "GET /api/v1/agente", "GET /api/v1/reportes/rpt_1", "POST /api/v1/reportes/rpt_1/pase", "PUT /api/v1/reportes/rpt_1/resultado", "PUT /api/v1/reportes/rpt_1/fallo",
    ]);
    for (const x of v) {
      expect(x.cabeceras.authorization, x.url).toBe(`Bearer ${CLAVE_DE_AGENTE}`);
      expect(x.url).not.toContain("clainv01");
      expect(x.cuerpo).not.toContain("clainv01");
      expect(JSON.stringify({ ...x.cabeceras, authorization: "" })).not.toContain("clainv01");
      expect(x.redirect).toBe("error");
      expect(x.conPlazo).toBe(true);
    }
  });

  it("entregar y avisar el fallo: PUT con Idempotency-Key y el cuerpo TAL CUAL (el motor calcula la huella); el pase y el estado no llevan cuerpo", async () => {
    const v: Visto[] = [];
    const cuerpo = "{ \"b\" : 2,\n \"a\": 1 }";
    await entregarElResultado(API, CLAVE_DE_AGENTE, "rpt_1", "ent_abc", cuerpo, falso(202, {}, v));
    await avisarElFallo(API, CLAVE_DE_AGENTE, "rpt_1", "ent_abc", cuerpo, falso(200, {}, v));
    for (const x of v) {
      expect(x.cuerpo).toBe(cuerpo);
      expect(x.cabeceras["idempotency-key"]).toBe("ent_abc");
      expect(x.cabeceras["content-type"]).toBe("application/json");
    }
    const sinCuerpo: Visto[] = [];
    await pedirElPase(API, CLAVE_DE_AGENTE, "rpt_1", falso(201, {}, sinCuerpo));
    expect(sinCuerpo[0]!.cuerpo).toBe("");
    expect(sinCuerpo[0]!.cabeceras["idempotency-key"]).toBeUndefined();
  });

  it("las huellas (`sha256:` + 64 hexadecimales) vuelven enteras: `taparSecretos` las rompería como si fueran un device_code", async () => {
    const r = await entregarElResultado(API, CLAVE_DE_AGENTE, "rpt_1", "ent_1", "{}", falso(200, { entrega: "ent_1", huella: HUELLA_DEL_RESULTADO }));
    expect(r.cuerpo.huella).toBe(HUELLA_DEL_RESULTADO);
  });

  it("el pase vuelve entero (es para lo que se pide)", async () => {
    const r = await pedirElPase(API, CLAVE_DE_AGENTE, "rpt_1", falso(201, { pase: PASE }));
    expect(r.cuerpo.pase).toBe(PASE);
  });

  it("la ruta de un reporte con caracteres raros se escapa", async () => {
    const v: Visto[] = [];
    await leerElReporteDeLaPuerta(API, CLAVE_DE_AGENTE, "rpt_a/b?c=d", falso(200, {}, v));
    expect(v[0]!.url).toBe("http://localhost:3000/api/v1/reportes/rpt_a%2Fb%3Fc%3Dd");
  });

  it("una red caída sale como motor_inalcanzable SIN el mensaje del sistema (podría traer la URL o la clave)", async () => {
    const f = (async () => { throw new TypeError(`fetch failed: Bearer ${CLAVE_DE_AGENTE}`); }) as Fetch;
    for (const hacer of [
      () => leerElEstadoDelAgente(API, CLAVE_DE_AGENTE, f),
      () => pedirElPase(API, CLAVE_DE_AGENTE, "rpt_1", f),
      () => entregarElResultado(API, CLAVE_DE_AGENTE, "rpt_1", "ent_1", "{}", f),
    ]) {
      const e = await hacer().catch((x) => x);
      expect(e).toMatchObject({ codigo: 1, error: "motor_inalcanzable" });
      expect(e.message).not.toContain("clainv01");
    }
  });

  it("una respuesta que no es JSON (una página HTML) es respuesta_inesperada y no se pega en el mensaje", async () => {
    const e = await leerElEstadoDelAgente(API, CLAVE_DE_AGENTE, falso(502, "<html>Bad gateway</html>")).catch((x) => x);
    expect(e).toMatchObject({ codigo: 1, error: "respuesta_inesperada" });
    expect(e.message).not.toContain("Bad gateway");
  });

  it("una redirección es anómala: sale como motor_inalcanzable (la clave no se reenvía adonde diga Location)", async () => {
    const f = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("unexpected redirect");
    }) as Fetch;
    expect(await leerElEstadoDelAgente(API, CLAVE_DE_AGENTE, f).catch((x) => x)).toMatchObject({ error: "motor_inalcanzable" });
  });
});
