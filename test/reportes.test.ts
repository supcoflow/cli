// `supcoflow reports list | show | investigate` (etapa 2c): lo fino de cada comando, con el motor inyectado. El camino de punta a punta (el binario contra un servidor HTTP) está en
// `puerta-y-reportes.test.ts`. Acá: validaciones sin red, la regla de lo que gasta, y cada error del motor con su frase fija.
import { describe, expect, it } from "vitest";
import type { Diagnostico, Respuesta } from "../src/api.ts";
import { reportesInvestigar, reportesListar, reportesVer, type DepsDeReportes } from "../src/comandos/reportes.ts";
import { FalloDeLaTerminal, SALIDA, type Resultado } from "../src/contrato.ts";
import { CLAVE_DE_PERSONA, DIAGNOSTICO, LISTA_DE_REPORTES, RECORRIDO_INVESTIGABLE, RECORRIDO_SIN_ACCIONES, recorridoDe } from "./puerta-fixtures.ts";

const PROY = { id: "proj_ejemplo", slug: "ejemplo", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };

type Llamada = { que: string; clave: string; proyecto: string; id?: string; consulta?: unknown };
const ok = (cuerpo: Record<string, unknown>, status = 200): Respuesta => ({ status, cuerpo });

function armar(o: {
  lista?: Respuesta; recorrido?: Respuesta; investigar?: Respuesta | Error; techo?: number | Error; sinProyecto?: boolean;
} = {}) {
  const llamadas: Llamada[] = [];
  const d: DepsDeReportes = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE_DE_PERSONA, fuente: "env" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => (o.sinProyecto ? null : PROY),
    listar: async (_a, clave, proyecto, consulta) => { llamadas.push({ que: "listar", clave, proyecto, consulta }); return o.lista ?? ok(LISTA_DE_REPORTES); },
    recorrido: async (_a, clave, proyecto, id) => { llamadas.push({ que: "recorrido", clave, proyecto, id }); return o.recorrido ?? ok(recorridoDe(id)); },
    investigar: async (_a, clave, proyecto, id) => {
      llamadas.push({ que: "investigar", clave, proyecto, id });
      if (o.investigar instanceof Error) throw o.investigar;
      return o.investigar ?? ok({ reporte_id: id, investigacion: "arrancada", via: "supcoflow", run_id: "wrun_0123456789abcdef" }, 202);
    },
    leerDiagnostico: async (_a, clave, proyecto) => {
      llamadas.push({ que: "diagnostico", clave, proyecto });
      if (o.techo instanceof Error) throw o.techo;
      return { ...DIAGNOSTICO, techoUsd: o.techo ?? 2 } as unknown as Diagnostico;
    },
    avisar: () => {},
  };
  return { d, llamadas, hizo: (que: string) => llamadas.filter((l) => l.que === que).length };
}

const F = {
  repo: null as string | null, dryRun: false, full: false, filter: null as string | null, page: null as string | null, perPage: null as string | null,
  id: "rpt_ejemplo0002" as string | null, authorizeSpend: false, ceiling: null as string | null,
};
const INVESTIGABLE = ok(RECORRIDO_INVESTIGABLE);

describe("reports list", () => {
  it("lo que se valida va ANTES de la red: filtro, página y tamaño", async () => {
    for (const [flags, error] of [
      [{ filter: "todo" }, "filtro_invalido"], [{ filter: "necesitan" }, "filtro_invalido"], [{ filter: "guardados" }, "filtro_invalido"], [{ page: "0" }, "parametro_invalido"], [{ page: "-1" }, "parametro_invalido"], [{ page: "1.5" }, "parametro_invalido"],
      [{ page: "1000000" }, "parametro_invalido"], [{ perPage: "0" }, "parametro_invalido"], [{ perPage: "101" }, "parametro_invalido"], [{ perPage: "abc" }, "parametro_invalido"],
    ] as const) {
      const m = armar();
      const r = await reportesListar(m.d, { ...F, ...flags });
      expect(r.codigo, JSON.stringify(flags)).toBe(SALIDA.entradaInvalida);
      expect(r.json.error).toBe(error);
      expect(m.llamadas).toEqual([]);
    }
  });

  it("cada nombre en inglés viaja como el id del motor", async () => {
    for (const [dado, esperado] of [["all", "todos"], ["needs-you", "necesitan"], ["in-progress", "curso"], ["with-issue", "con_issue"], ["saved", "guardados"]]) {
      const m = armar();
      await reportesListar(m.d, { ...F, filter: dado });
      expect(m.llamadas.find((l) => l.que === "listar")!.consulta).toEqual({ filtro: esperado, pagina: null, porPagina: null });
    }
    const m = armar();
    await reportesListar(m.d, { ...F, page: "3", perPage: "100" });
    expect(m.llamadas[0]!.consulta).toEqual({ filtro: null, pagina: 3, porPagina: 100 });
  });

  it("la clave de la persona viaja al motor y el proyecto sale del repo", async () => {
    const m = armar();
    await reportesListar(m.d, F);
    expect(m.llamadas[0]).toMatchObject({ clave: CLAVE_DE_PERSONA, proyecto: "proj_ejemplo" });
  });

  it("si hay más páginas dice el comando exacto, con el filtro, el tamaño de página y el repo que se pasaron", async () => {
    const m = armar({ lista: ok({ ...LISTA_DE_REPORTES, total: 60, pagina: 1, paginas: 3, por_pagina: 25, filtro: "necesitan" }) });
    const r = await reportesListar(m.d, { ...F, filter: "needs-you", repo: "d/r" });
    expect(r.texto).toContain("More: `supcoflow reports list --page 2 --filter needs-you --repo d/r`.");
    expect(r.texto).toContain("page 1 of 3");
    const conTamano = await reportesListar(armar({ lista: ok({ ...LISTA_DE_REPORTES, total: 25, pagina: 1, paginas: 3, por_pagina: 10 }) }).d, { ...F, perPage: "10" });
    expect(conTamano.texto).toContain("More: `supcoflow reports list --page 2 --per-page 10`.");
  });

  it("sin reportes: lo dice, y el aviso de que el texto se lee en la consola", async () => {
    const r = await reportesListar(armar({ lista: ok({ ...LISTA_DE_REPORTES, reportes: [], total: 0, paginas: 0 }) }).d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.texto).toContain("(none)");
    expect(r.texto).toMatch(/text of a report isn't here: it is read in the console/);
  });

  it("el título (texto de un usuario del producto) sale sin caracteres de control y sin secretos", async () => {
    const lista = ok({ ...LISTA_DE_REPORTES, reportes: [{ ...LISTA_DE_REPORTES.reportes[0]!, titulo: `Hola\u001b[31m\u0007 vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0 ${"x".repeat(400)}` }] });
    const r = await reportesListar(armar({ lista }).d, F);
    const t = `${r.texto}${JSON.stringify(r.json)}`;
    expect(t).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(t).not.toContain("vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0");
    expect((r.json.reportes as { titulo: string }[])[0]!.titulo.length).toBeLessThanOrEqual(200);
  });

  it("un estado que esta terminal no conoce se dice por su id (puede estar vieja), no se inventa", async () => {
    const lista = ok({ ...LISTA_DE_REPORTES, reportes: [{ ...LISTA_DE_REPORTES.reportes[0]!, estado: "estado_nuevo" }] });
    const r = await reportesListar(armar({ lista }).d, F);
    expect(r.texto).toContain("estado_nuevo");
  });

  it("una fila sin id, o una respuesta sin la lista, es respuesta_inesperada", async () => {
    const sinId = await reportesListar(armar({ lista: ok({ ...LISTA_DE_REPORTES, reportes: [{ titulo: "x" }] }) }).d, F);
    expect(sinId.json.error).toBe("respuesta_inesperada");
    const sinLista = await reportesListar(armar({ lista: ok({ proyecto_id: "proj_ejemplo" }) }).d, F);
    expect(sinLista.json.error).toBe("respuesta_inesperada");
  });

  it("un repo sin proyecto: 4 sin_proyecto, sin pedir la lista", async () => {
    const m = armar({ sinProyecto: true });
    const r = await reportesListar(m.d, F);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("sin_proyecto");
    expect(m.llamadas).toEqual([]);
  });

  it.each([
    [401, { error: "clave_invalida", message: "La clave ya no vale." }, SALIDA.faltaLogin, "clave_invalida", /log in again/],
    [403, { error: "clave_de_agente", message: "Una clave de agente no sirve para esta ruta." }, SALIDA.haceFaltaUnaPersona, "clave_de_agente", /agent's key.*supcoflow gate/],
    [404, { error: "proyecto_inexistente", message: "No existe." }, SALIDA.entradaInvalida, "proyecto_inexistente", /doesn't know that project/],
    [400, { error: "parametro_invalido", message: "`por_pagina` es un entero de 1 a 100." }, SALIDA.entradaInvalida, "parametro_invalido", /page or page size/],
    [500, { error: "boom" }, SALIDA.inesperado, "error_interno", /try again in a few minutes/],
  ])("%s del motor: la frase es de la terminal y UN solo pedido", async (status, cuerpo, codigo, error, frase) => {
    const m = armar({ lista: ok(cuerpo, status) });
    const r = await reportesListar(m.d, F);
    expect(r.codigo).toBe(codigo);
    expect(r.json.error).toBe(error);
    expect(String(r.json.message)).toMatch(frase);
    expect(String(r.json.message)).not.toMatch(/La clave|Una clave|No existe|por_pagina/);
    expect(m.hizo("listar")).toBe(1);
  });
});

describe("reports show", () => {
  it("--id falta o mal escrito: 3 sin red, y el valor no se repite", async () => {
    for (const id of [null, "abc", "rpt_", "rpt_con espacio", "rpt_../x"]) {
      const m = armar();
      const r = await reportesVer(m.d, { ...F, id });
      expect(r.codigo, String(id)).toBe(SALIDA.entradaInvalida);
      expect(m.llamadas).toEqual([]);
      if (id !== null && id !== "rpt_") expect(r.texto).not.toContain(id);
    }
  });

  it("dice los eventos con etiquetas en inglés y NO la prosa en castellano del motor", async () => {
    const r = await reportesVer(armar({ recorrido: ok(RECORRIDO_SIN_ACCIONES.eventos ? { ...RECORRIDO_SIN_ACCIONES, reporte_id: "rpt_ejemplo0002" } : {}) }).d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.texto).toMatch(/reported/);
    expect(r.texto).not.toMatch(/Reportado en|issue creado/);
  });

  it("la acción de pedir una investigación y su comando exacto (con el repo, si se pasó)", async () => {
    const r = await reportesVer(armar({ recorrido: INVESTIGABLE }).d, { ...F, repo: "d/r" });
    expect(r.json.siguiente).toBe("supcoflow reports investigate --id rpt_ejemplo0002 --repo d/r");
    expect(r.texto).toContain("supcoflow reports investigate --id rpt_ejemplo0002 --repo d/r");
    expect(r.texto).toMatch(/without --authorize-spend it sends nothing and shows the ceiling/);
  });

  it("corto por defecto (con `detalle`), y --full suma estado_texto, el texto de los eventos, los avisos y el run", async () => {
    const c = await reportesVer(armar({ recorrido: ok(recorridoDe("rpt_ejemplo0002", { run: { run_id: "wrun_abc", estado: "completed", creado_en: "2026-12-01T07:00:00Z", terminado_en: null } })) }).d, F);
    for (const k of ["estado_texto", "avisos", "run"]) expect(c.json[k], k).toBeUndefined();
    expect(c.json.detalle).toBe("supcoflow reports show --id rpt_ejemplo0002 --full --json");
    const f = await reportesVer(armar({ recorrido: ok(recorridoDe("rpt_ejemplo0002", { run: { run_id: "wrun_abc", estado: "completed", creado_en: "2026-12-01T07:00:00Z", terminado_en: null } })) }).d, { ...F, full: true });
    expect(f.json.estado_texto).toBe("tu agente no contestó");
    expect((f.json.eventos as { texto: string }[])[0]!.texto).toBe("Reportado en https://app.example.com/login");
    expect(f.json.run).toMatchObject({ run_id: "wrun_abc", estado: "completed" });
    expect(f.texto).toMatch(/Notices to the agent:\n {4}round 1: delivery agotado, plazo_vencido, 2 attempt\(s\)/);
  });

  it("un reporte de otro proyecto del mismo equipo (la respuesta nombra otro proyecto) no se muestra", async () => {
    const r = await reportesVer(armar({ recorrido: ok({ ...recorridoDe("rpt_ejemplo0002"), proyecto_id: "proj_ajeno" }) }).d, F);
    expect(r.json.error).toBe("respuesta_inesperada");
  });

  it("una dirección que no es https (el enlace del issue, el de la consola) no se copia", async () => {
    const r = await reportesVer(armar({ recorrido: ok(recorridoDe("rpt_ejemplo0002", { enlace_a_la_consola: "javascript:alert(1)", issue: { numero: 5, url: "http://evil.example/x" } })) }).d, F);
    expect(r.json.enlace_a_la_consola).toBeNull();
    expect(r.json.issue).toEqual({ numero: 5, url: null });
    expect(JSON.stringify(r)).not.toContain("evil.example");
  });
});

describe("reports investigate: lo que gasta no se manda sin la autorización", () => {
  it("las combinaciones de flags inválidas se rechazan ANTES de leer nada", async () => {
    for (const [flags, error] of [
      [{ authorizeSpend: true }, "falta_techo"],
      [{ ceiling: "2" }, "flags_incompatibles"],
      [{ authorizeSpend: true, ceiling: "0" }, "techo_invalido"],
      [{ authorizeSpend: true, ceiling: "-2" }, "techo_invalido"],
      [{ authorizeSpend: true, ceiling: "dos" }, "techo_invalido"],
      [{ authorizeSpend: true, ceiling: "2e3" }, "techo_invalido"],
      [{ id: null }, "falta_id"],
      [{ id: "no-es-un-id" }, "id_invalido"],
    ] as const) {
      const m = armar();
      const r = await reportesInvestigar(m.d, { ...F, ...flags });
      expect(r.codigo, JSON.stringify(flags)).toBe(SALIDA.entradaInvalida);
      expect(r.json.error).toBe(error);
      expect(m.llamadas).toEqual([]);
    }
  });

  it("sin --authorize-spend no se manda el POST nunca: 4 falta_autorizacion con el techo y el comando con el repo", async () => {
    const m = armar({ recorrido: INVESTIGABLE });
    const r = await reportesInvestigar(m.d, { ...F, repo: "d/r" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "falta_autorizacion", techo_usd: 2, via: "supcoflow", siguiente: "supcoflow reports investigate --id rpt_ejemplo0002 --authorize-spend --ceiling 2 --repo d/r" });
    expect(m.hizo("investigar")).toBe(0);
  });

  it("autorizado: UN POST, después de leer el recorrido y el techo", async () => {
    const m = armar({ recorrido: INVESTIGABLE });
    const r = await reportesInvestigar(m.d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.llamadas.map((l) => l.que)).toEqual(["recorrido", "diagnostico", "investigar"]);
    expect(r.json).toMatchObject({ ok: true, investigacion: "arrancada", run_id: "wrun_0123456789abcdef", techo_usd: 2 });
    expect(r.texto).toMatch(/Started the investigation of rpt_ejemplo0002 \(run wrun_0123456789abcdef\); it can spend up to US\$ 2\.00/);
  });

  it("2 y 2.0000 son el mismo techo; 2.01 y 1.99 no: se rechaza sin POST", async () => {
    for (const [dado, pasa] of [["2", true], ["2.0000", true], ["2.01", false], ["1.99", false]] as const) {
      const m = armar({ recorrido: INVESTIGABLE });
      const r = await reportesInvestigar(m.d, { ...F, authorizeSpend: true, ceiling: dado });
      expect(m.hizo("investigar"), dado).toBe(pasa ? 1 : 0);
      if (!pasa) expect(r.json).toMatchObject({ error: "techo_distinto", techo_usd: 2, autorizado_usd: Number(dado) });
    }
  });

  it("si por esta API no hay nada que pedir: 4 nada_que_pedir, sin leer el techo ni mandar nada", async () => {
    const m = armar({ recorrido: ok(RECORRIDO_SIN_ACCIONES) });
    const r = await reportesInvestigar(m.d, { ...F, id: "rpt_ejemplo0001", authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ error: "nada_que_pedir", estado: "con_issue" });
    expect(m.llamadas.map((l) => l.que)).toEqual(["recorrido"]);
  });

  it("con un agente de afuera que no contestó, el texto dice que reenvía el aviso (y que gasta su cuenta, no la de Supcoflow)", async () => {
    const m = armar({ recorrido: ok(recorridoDe("rpt_ejemplo0003")) });
    const r = await reportesInvestigar(m.d, { ...F, id: "rpt_ejemplo0003" });
    expect(r.json.via).toBe("agente_de_afuera");
    expect(r.texto).toMatch(/sends the notice again to your connected agent/);
    expect(r.texto).toMatch(/its own AI account/);
  });

  it("--dry-run: lee y no manda; con o sin autorización", async () => {
    const m = armar({ recorrido: INVESTIGABLE });
    const r = await reportesInvestigar(m.d, { ...F, dryRun: true, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ dry_run: true, autorizado: true, via: "supcoflow", techo_usd: 2 });
    expect(m.hizo("investigar")).toBe(0);
  });

  it("un aviso reenviado que el motor ya tenía (200 repetido) dice que no arrancó nada nuevo", async () => {
    const m = armar({ recorrido: ok(recorridoDe("rpt_ejemplo0003")), investigar: ok({ reporte_id: "rpt_ejemplo0003", investigacion: "aviso_reenviado", via: "agente_de_afuera", webhook_id: "msg_avs_x", ronda: 2, repetido: true }) });
    const r = await reportesInvestigar(m.d, { ...F, id: "rpt_ejemplo0003", authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json.repetido).toBe(true);
    expect(r.texto).toMatch(/already sent \(round 2\): nothing new started/);
  });

  it.each([
    [409, "ya_esta_con_el_agente", /still has time/],
    [409, "el_agente_ya_fallo", /single delivery.*aren't available yet/],
    [409, "ya_tiene_resultado", /already delivered/],
    [409, "agente_no_disponible", /no longer active/],
    [409, "proyecto_con_investigador_de_afuera", /isn't available yet/],
    [409, "ya_relevado", /already has an investigation/],
    [403, "rol_insuficiente", /Owner or Member/],
    [403, "clave_de_consulta", /read-only key/],
    [409, "falta_ia_del_triaje", /no AI account ready/],
  ])("%s %s: la frase es de la terminal, sale 4 y se mira el reporte antes de volver a pedir", async (status, error, frase) => {
    const m = armar({ recorrido: INVESTIGABLE, investigar: ok({ error, message: "Texto del motor en castellano." }, status) });
    const r = await reportesInvestigar(m.d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe(error);
    expect(String(r.json.message)).toMatch(frase);
    expect(String(r.json.message)).not.toContain("castellano");
    expect(m.hizo("investigar")).toBe(1);
  });

  it("un 409 que la terminal no conoce sale 4 con el código del motor, sin su texto", async () => {
    const r = await reportesInvestigar(armar({ recorrido: INVESTIGABLE, investigar: ok({ error: "estado_nuevo", message: "Algo en castellano" }, 409) }).d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("estado_nuevo");
    expect(String(r.json.message)).toContain("supcoflow reports show");
    expect(todo(r)).not.toContain("castellano");
  });

  it("la pausa de despachos (deploy): 1 y nada arrancó; un tope alcanzado: 6", async () => {
    const pausa = await reportesInvestigar(armar({ recorrido: INVESTIGABLE, investigar: ok({ error: "despachos_en_pausa" }, 503) }).d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(pausa.codigo).toBe(SALIDA.inesperado);
    expect(pausa.texto).toMatch(/nothing was started/);
    const tope = await reportesInvestigar(armar({ recorrido: INVESTIGABLE, investigar: ok({ error: "tope_mensual" }, 409) }).d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(tope.codigo).toBe(SALIDA.topeAlcanzado);
  });

  it("la red cae al pedir: no se sabe si arrancó, y lo dice con cómo mirar (nunca reintenta)", async () => {
    const m = armar({ recorrido: INVESTIGABLE, investigar: new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "I couldn't reach the engine.") });
    const r = await reportesInvestigar(m.d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.texto).toMatch(/I don't know whether it started: look with `supcoflow reports show --id rpt_ejemplo0002`/);
    expect(m.hizo("investigar")).toBe(1);
  });

  it("una respuesta de éxito sin saber qué se hizo es respuesta_inesperada (no se dice «arrancó»)", async () => {
    const r = await reportesInvestigar(armar({ recorrido: INVESTIGABLE, investigar: ok({ reporte_id: "rpt_ejemplo0002" }, 202) }).d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.json.error).toBe("respuesta_inesperada");
  });

  it("la clave de consulta o una sesión rota al leer el techo se dicen sin mandar el POST", async () => {
    const m = armar({ recorrido: INVESTIGABLE, techo: new FalloDeLaTerminal(SALIDA.faltaLogin, "clave_invalida", "The key is no longer valid: log in again.") });
    const r = await reportesInvestigar(m.d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.faltaLogin);
    expect(m.hizo("investigar")).toBe(0);
  });
});

const todo = (r: Resultado) => `${r.texto}\n${JSON.stringify(r.json)}`;
