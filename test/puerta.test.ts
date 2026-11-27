// `supcoflow gate` (etapa 2c): lo fino de cada comando, con el motor inyectado. El camino de punta a punta (el binario contra un servidor HTTP) está en `puerta-y-reportes.test.ts`;
// acá se clava lo que ese camino no alcanza: de dónde sale la clave, qué NO se manda, qué dice cada error y que nada de lo que sale lleva la clave del agente.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Respuesta } from "../src/api.ts";
import { puertaEntregar, puertaEstado, puertaFallo, puertaLeer, puertaPase, sinLaClaveDeAgente, VARIABLE_DE_LA_CLAVE, type DepsDePuerta } from "../src/comandos/puerta.ts";
import { SALIDA, type Resultado } from "../src/contrato.ts";
import { FalloDeLaTerminal } from "../src/contrato.ts";
import {
  CLAVE_DE_AGENTE, CLAVE_DE_PERSONA, ESTADO_DEL_AGENTE, FALLO, HUELLA_DEL_FALLO, HUELLA_DEL_RESULTADO, LECTURA_PUBLICADA, PASE, PEDAZOS_DE_LA_CLAVE, RESPUESTA_DEL_PASE, RESULTADO,
} from "./puerta-fixtures.ts";

type Llamada = { que: string; clave: string; id?: string; entrega?: string; cuerpo?: string };

function armar(o: {
  respuesta?: Respuesta | ((l: Llamada) => Respuesta); lanza?: Error; env?: Record<string, string | undefined>; tty?: boolean; teclado?: string | null | Error; archivo?: string | { error: string };
} = {}) {
  const llamadas: Llamada[] = [];
  const preguntas: string[] = [];
  const stderr: string[] = [];
  const archivos: { ruta: string; tope: number }[] = [];
  const responder = async (l: Llamada): Promise<Respuesta> => {
    llamadas.push(l);
    if (o.lanza !== undefined) throw o.lanza;
    if (typeof o.respuesta === "function") return o.respuesta(l);
    return o.respuesta ?? { status: 200, cuerpo: {} };
  };
  const d: DepsDePuerta = {
    api: new URL("http://localhost:3000"),
    env: o.env ?? { [VARIABLE_DE_LA_CLAVE]: CLAVE_DE_AGENTE },
    esTty: o.tty ?? false,
    leerClaveOculta: async (pregunta) => {
      preguntas.push(pregunta);
      if (o.teclado instanceof Error) throw o.teclado;
      return o.teclado === undefined ? CLAVE_DE_AGENTE : o.teclado;
    },
    leerArchivoChico: (ruta, tope) => {
      archivos.push({ ruta, tope });
      const a = o.archivo ?? JSON.stringify(RESULTADO);
      return typeof a === "string" ? { bytes: new TextEncoder().encode(a) } : a;
    },
    estado: (_a, clave) => responder({ que: "estado", clave }),
    leer: (_a, clave, id) => responder({ que: "leer", clave, id }),
    pase: (_a, clave, id) => responder({ que: "pase", clave, id }),
    entregar: (_a, clave, id, entrega, cuerpo) => responder({ que: "entregar", clave, id, entrega, cuerpo }),
    avisarFallo: (_a, clave, id, entrega, cuerpo) => responder({ que: "fallo", clave, id, entrega, cuerpo }),
    avisar: (s) => void stderr.push(s),
  };
  return { d, llamadas, preguntas, stderr, archivos };
}

const F = { json: false, dryRun: false, full: false, id: "rpt_ejemplo0001" as string | null, file: "result.json" as string | null, delivery: null as string | null, fromEnv: null as string | null };
const ok = (cuerpo: Record<string, unknown>, status = 200): Respuesta => ({ status, cuerpo });

/** TODO lo que podría leer una persona o un asistente de una corrida. */
const todo = (r: Resultado, stderr: string[] = []) => [r.texto, JSON.stringify(r.json), ...stderr].join("\n");
function sinFugas(r: Resultado, stderr: string[] = [], aparece: string[] = []) {
  let t = todo(r, stderr);
  for (const a of aparece) t = t.split(a).join("");
  for (const p of PEDAZOS_DE_LA_CLAVE) expect(t, `fuga de «${p}»`).not.toContain(p);
}

describe("de dónde sale la clave del agente", () => {
  it("de SUPCOFLOW_AGENT_KEY por defecto, y viaja en el pedido (y sólo ahí)", async () => {
    const m = armar({ respuesta: ok(ESTADO_DEL_AGENTE) });
    const r = await puertaEstado(m.d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.llamadas).toEqual([{ que: "estado", clave: CLAVE_DE_AGENTE }]);
    expect(m.preguntas).toEqual([]);
    sinFugas(r, m.stderr);
  });

  it("--from-env NOMBRE manda sobre SUPCOFLOW_AGENT_KEY", async () => {
    const otra = `${CLAVE_DE_AGENTE}-otra`;
    const m = armar({ respuesta: ok(ESTADO_DEL_AGENTE), env: { [VARIABLE_DE_LA_CLAVE]: CLAVE_DE_AGENTE, MI_AGENTE: otra } });
    await puertaEstado(m.d, { fromEnv: "MI_AGENTE", json: false });
    expect(m.llamadas[0]!.clave).toBe(otra);
  });

  it("--from-env con una variable vacía o ausente: 3 variable_vacia, sin pedido", async () => {
    const m = armar({ env: {} });
    const r = await puertaEstado(m.d, { fromEnv: "NO_ESTA", json: false });
    expect(r.codigo).toBe(SALIDA.entradaInvalida);
    expect(r.json.error).toBe("variable_vacia");
    expect(m.llamadas).toEqual([]);
  });

  it("--from-env con la CLAVE pegada: no se repite, no se manda, y se dice que ya está expuesta", async () => {
    const m = armar();
    const r = await puertaEstado(m.d, { fromEnv: CLAVE_DE_AGENTE, json: false });
    expect(r.json.error).toBe("clave_como_nombre");
    expect(String(r.json.message)).toMatch(/treat it as exposed and revoke it/);
    expect(m.llamadas).toEqual([]);
    sinFugas(r, m.stderr);
  });

  it("sin variable y sin terminal: 2 sin_clave_de_agente, no pregunta y dice cuál variable", async () => {
    const m = armar({ env: {}, tty: false });
    const r = await puertaEstado(m.d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.faltaLogin);
    expect(r.json.error).toBe("sin_clave_de_agente");
    expect(r.texto).toContain(VARIABLE_DE_LA_CLAVE);
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([]);
  });

  it("con terminal y sin variable: la pregunta es SIN ECO, y lo escrito es la clave", async () => {
    const m = armar({ env: {}, tty: true, respuesta: ok(ESTADO_DEL_AGENTE), teclado: `  ${CLAVE_DE_AGENTE}\n` });
    const r = await puertaEstado(m.d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.preguntas).toHaveLength(1);
    expect(m.preguntas[0]).toMatch(/won't be shown/);
    expect(m.llamadas[0]!.clave).toBe(CLAVE_DE_AGENTE);
    sinFugas(r, m.stderr);
  });

  it("con --json no se pregunta NADA, aunque haya terminal: sale 2 sin_clave_de_agente (la regla de todos los comandos; la excepción es `agents set-key`)", async () => {
    const m = armar({ env: {}, tty: true });
    const r = await puertaEstado(m.d, { fromEnv: null, json: true });
    expect(r.codigo).toBe(SALIDA.faltaLogin);
    expect(r.json.error).toBe("sin_clave_de_agente");
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([]);
  });

  it("con la variable puesta no pregunta aunque haya terminal", async () => {
    const m = armar({ tty: true, respuesta: ok(ESTADO_DEL_AGENTE) });
    await puertaEstado(m.d, { fromEnv: null, json: false });
    expect(m.preguntas).toEqual([]);
  });

  it("si la persona cancela: nada se manda; si la terminal no puede ocultar lo que se escribe: no se pregunta con eco", async () => {
    const cancelo = armar({ env: {}, tty: true, teclado: null });
    expect((await puertaEstado(cancelo.d, { fromEnv: null, json: false })).json.error).toBe("cancelado");
    expect(cancelo.llamadas).toEqual([]);
    const sinEco = armar({ env: {}, tty: true, teclado: new Error("raw mode is not available") });
    const r = await puertaEstado(sinEco.d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("sin_eco");
    expect(sinEco.llamadas).toEqual([]);
  });

  it.each([
    ["la clave de una persona", CLAVE_DE_PERSONA, "es_una_clave_de_persona"],
    ["una clave de IA del cliente", "vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0ZyXwVu", "no_es_una_clave_de_agente"],
    ["algo corto", "abc", "clave_con_forma_invalida"],
    ["dos cosas pegadas", `${CLAVE_DE_AGENTE} ${CLAVE_DE_AGENTE}`, "clave_con_forma_invalida"],
  ])("%s en la variable: no se manda a ningún lado y no se repite", async (_n, valor, error) => {
    const m = armar({ env: { [VARIABLE_DE_LA_CLAVE]: valor } });
    const r = await puertaEstado(m.d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.entradaInvalida);
    expect(r.json.error).toBe(error);
    expect(m.llamadas).toEqual([]);
    expect(todo(r, m.stderr)).not.toContain(valor.split(" ")[0]!.slice(0, 20));
  });
});

describe("un 401 o un 403 se dicen claro y no se prueba otra credencial", () => {
  it.each([
    [401, { error: "clave_invalida", message: `La clave ${CLAVE_DE_AGENTE} no vale.` }, SALIDA.faltaLogin, "clave_invalida", /isn't valid/],
    [401, { error: "clave_revocada" }, SALIDA.faltaLogin, "clave_revocada", /revoked/],
    [403, { error: "tipo_de_clave", message: "Esta clave es de chat." }, SALIDA.haceFaltaUnaPersona, "tipo_de_clave", /another type/],
    [403, { error: "solo_agentes" }, SALIDA.haceFaltaUnaPersona, "solo_agentes", /person's key/],
    [403, { error: "algo_que_no_conozco" }, SALIDA.haceFaltaUnaPersona, "algo_que_no_conozco", /can't do that/],
  ])("%s %j: sale %s, UN pedido, con la frase de la terminal", async (status, cuerpo, codigo, error, frase) => {
    for (const comando of [
      (d: DepsDePuerta) => puertaEstado(d, { fromEnv: null, json: false }),
      (d: DepsDePuerta) => puertaLeer(d, F),
      (d: DepsDePuerta) => puertaPase(d, F),
      (d: DepsDePuerta) => puertaEntregar(d, F),
      (d: DepsDePuerta) => puertaFallo(d, F),
    ]) {
      const m = armar({ respuesta: { status, cuerpo }, archivo: JSON.stringify(FALLO) });
      const r = await comando(m.d);
      expect(r.codigo).toBe(codigo);
      expect(r.json).toMatchObject({ ok: false, error });
      expect(String(r.json.message)).toMatch(frase);
      expect(m.llamadas).toHaveLength(1);
      expect(String(r.json.message)).not.toContain("Esta clave es de chat");
      sinFugas(r, m.stderr);
    }
  });

  it("el motor que repite la clave (por un bug) en un error, un 5xx o un 409: no llega a ninguna salida", async () => {
    for (const status of [401, 403, 404, 409, 422, 500, 503]) {
      const m = armar({
        respuesta: ok({ error: CLAVE_DE_AGENTE, message: `la clave ${CLAVE_DE_AGENTE}`, campos: [CLAVE_DE_AGENTE], validos: [CLAVE_DE_AGENTE], problemas: [`x:${CLAVE_DE_AGENTE}`], entrega: CLAVE_DE_AGENTE }, status),
      });
      for (const r of [await puertaLeer(m.d, F), await puertaEntregar(m.d, F)]) {
        expect(r.json.ok, String(status)).toBe(false);
        sinFugas(r, m.stderr);
      }
    }
  });
});

describe("gate status", () => {
  it("un agente de chat: lo que no aplica (aviso, asignados, tope) es null y se dice, no cero", async () => {
    const chat = { ...ESTADO_DEL_AGENTE, agente_id: "agc_chat_ejemplo", tipo: "chat", es_el_investigador_activo: false, ultimo_aviso: null, asignados_sin_entregar: null, tope: null };
    const r = await puertaEstado(armar({ respuesta: ok(chat) }).d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ tipo: "chat", ultimo_aviso: null, asignados_sin_entregar: null, tope: null, es_el_investigador_activo: false });
    expect(r.texto).toMatch(/null \(not applicable\)/);
    expect(r.texto).not.toMatch(/not delivered: 0/);
  });

  it("«Alguien del equipo» (quien entró con email) se dice en inglés, y el email nunca está", async () => {
    const r = await puertaEstado(armar({ respuesta: ok({ ...ESTADO_DEL_AGENTE, conectado_por: { persona_id: "usr_x", nombre_visible: "Alguien del equipo" } }) }).d, { fromEnv: null, json: false });
    expect(r.texto).toContain("connected by someone from the team");
  });

  it("una respuesta a medias es respuesta_inesperada, sin inventar un estado", async () => {
    const r = await puertaEstado(armar({ respuesta: ok({ agente_id: "agc_x" }) }).d, { fromEnv: null, json: false });
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json.error).toBe("respuesta_inesperada");
  });

  it("el nombre del agente (texto de afuera) sale sin caracteres de control", async () => {
    const r = await puertaEstado(armar({ respuesta: ok({ ...ESTADO_DEL_AGENTE, nombre: "Bot\u001b[2J\u0007" }) }).d, { fromEnv: null, json: false });
    expect(todo(r)).not.toMatch(/[\u0000-\u0008\u001b]/);
  });
});

describe("gate read", () => {
  it("la publicación incierta, esperando el reenvío, o publicando: cada estado dice qué hacer", async () => {
    const con = (publicacion: Record<string, unknown>) => armar({ respuesta: ok({ ...LECTURA_PUBLICADA, publicacion }) });
    const incierta = await puertaLeer(con({ estado: "publicacion_incierta", entrega: "ent_ejemplo0006", huella: HUELLA_DEL_RESULTADO, desde: "2026-12-01T12:01:10Z", proximo_paso: "esperar", buscar_desde: "2026-12-01T12:11:10Z" }).d, F);
    expect(incierta.texto).toMatch(/uncertain/);
    expect(incierta.texto).toMatch(/waits until 2026-12-01T12:11:10Z/);
    expect(incierta.texto).toMatch(/never deliver again/);
    const reenvio = await puertaLeer(con({ estado: "esperando_reenvio", entrega: "ent_ejemplo0006", huella: HUELLA_DEL_RESULTADO, reenvios_que_quedan: 1 }).d, F);
    expect(reenvio.texto).toMatch(/Send exactly the same file again with `supcoflow gate deliver --id rpt_ejemplo0001 --file <the same file>` \(1 resend\(s\) left\)/);
    const publicando = await puertaLeer(con({ estado: "publicando", entrega: "ent_ejemplo0001", huella: HUELLA_DEL_RESULTADO }).d, F);
    expect(publicando.texto).toMatch(/being published: look again in a moment/);
    const persona = await puertaLeer(con({ estado: "necesita_persona", entrega: "ent_ejemplo0001", huella: HUELLA_DEL_RESULTADO, motivo: "issue_dudoso", candidatos: [{ numero: 1 }] }).d, F);
    expect(persona.texto).toMatch(/a person has to look at it/);
    expect(JSON.stringify(persona.json)).not.toContain("candidatos");
  });

  it("de otro reporte que el pedido: respuesta_inesperada (no se muestra lo de otro)", async () => {
    const r = await puertaLeer(armar({ respuesta: ok({ ...LECTURA_PUBLICADA, reporte_id: "rpt_otro0001" }) }).d, F);
    expect(r.json.error).toBe("respuesta_inesperada");
  });

  it("un valor raro del motor (con mayúsculas, con forma de clave) no se copia a la salida", async () => {
    const r = await puertaLeer(armar({ respuesta: ok({ ...LECTURA_PUBLICADA, canal: "CHAT", decision: "vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0", intencion: "error" }) }).d, F);
    expect(r.json.canal).toBeNull();
    expect(r.json.decision).toBeNull();
    expect(todo(r)).not.toContain("vck_9f8e");
  });
});

describe("gate pass", () => {
  it("el pase y el acuerdo salen; la clave no; el pedido no lleva cuerpo", async () => {
    const m = armar({ respuesta: ok(RESPUESTA_DEL_PASE, 201) });
    const r = await puertaPase(m.d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.llamadas).toEqual([{ que: "pase", clave: CLAVE_DE_AGENTE, id: "rpt_ejemplo0001" }]);
    expect(r.json.pase).toBe(PASE);
    expect(r.texto).toContain(`pass: ${PASE}`);
    expect(r.texto).toContain("usuario_id no");
    expect(r.texto).toContain("pagina_y_navegador yes");
    sinFugas(r, m.stderr, [PASE]);
  });

  it("un acuerdo con una clave que la terminal no conoce llega igual (el agente aplica todo lo que el motor manda)", async () => {
    const r = await puertaPase(armar({ respuesta: ok({ ...RESPUESTA_DEL_PASE, acuerdo: { ...RESPUESTA_DEL_PASE.acuerdo, geolocalizacion: false, atributos: ["plan", "pais"] } }, 201) }).d, F);
    expect(r.json.acuerdo).toMatchObject({ geolocalizacion: false, atributos: ["plan", "pais"] });
  });

  it("un pase con forma rara, o una dirección que no es https, no se muestran: respuesta_inesperada", async () => {
    for (const mala of [{ pase: "no-es-un-pase" }, { pase: `${PASE} extra` }, { contenido: { url: "http://evil.example.com/x", ref: "r" } }, { contenido: { url: "javascript:alert(1)", ref: "r" } }, { vence_en: "ayer" }]) {
      const r = await puertaPase(armar({ respuesta: ok({ ...RESPUESTA_DEL_PASE, ...mala }, 201) }).d, F);
      expect(r.json.error, JSON.stringify(mala)).toBe("respuesta_inesperada");
      expect(todo(r)).not.toContain("evil.example.com");
      expect(todo(r)).not.toContain("no-es-un-pase");
    }
  });

  it("contra el propio Supcoflow en la propia máquina el http://localhost vale (la transición con el chat alojado)", async () => {
    const r = await puertaPase(armar({ respuesta: ok({ ...RESPUESTA_DEL_PASE, contenido: { url: "http://localhost:3000/api/v1/reportes/rpt_ejemplo0001/contenido", ref: "rpt_ejemplo0001" } }, 201) }).d, F);
    expect(r.codigo).toBe(SALIDA.ok);
  });

  it("el pase nunca sale en un error aunque el motor lo repita", async () => {
    const r = await puertaPase(armar({ respuesta: ok({ error: "almacen_no_disponible", message: `pase ${PASE}`, pase: PASE }, 409) }).d, F);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("almacen_no_disponible");
    expect(todo(r)).not.toContain("pse_");
  });

  it("--dry-run no pide la clave ni manda nada", async () => {
    const m = armar({ env: {} });
    const r = await puertaPase(m.d, { ...F, dryRun: true });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json.dry_run).toBe(true);
    expect(m.llamadas).toEqual([]);
    expect(m.preguntas).toEqual([]);
  });
});

describe("gate deliver y gate fail", () => {
  const idDe = (tipo: string, reporte: string, cuerpo: string) => `ent_${createHash("sha256").update(`${tipo}\n${reporte}\n`).update(cuerpo).digest("hex").slice(0, 32)}`;

  it("el id de entrega sale del tipo, el reporte y el contenido: el mismo archivo es la misma entrega, y cualquier cambio es otra", async () => {
    const cuerpo = JSON.stringify(RESULTADO);
    const a = armar({ respuesta: ok({ entrega: idDe("resultado", "rpt_ejemplo0001", cuerpo), huella: HUELLA_DEL_RESULTADO, publicacion: "publicando" }, 202) });
    const r = await puertaEntregar(a.d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(a.llamadas[0]).toMatchObject({ que: "entregar", id: "rpt_ejemplo0001", entrega: idDe("resultado", "rpt_ejemplo0001", cuerpo), cuerpo });
    const ids = new Set<string>();
    for (const [flags, texto] of [[{ ...F, id: "rpt_ejemplo0002" }, cuerpo], [F, cuerpo.replace("error", "pedido_de_mejora")]] as const) {
      const m = armar({ archivo: texto, respuesta: ok({}, 500) });
      await puertaEntregar(m.d, flags);
      ids.add(m.llamadas[0]!.entrega!);
    }
    ids.add(a.llamadas[0]!.entrega!);
    const f = armar({ archivo: cuerpo, respuesta: ok({}, 500) });
    await puertaFallo(f.d, F);
    ids.add(f.llamadas[0]!.entrega!);
    // la entrega de arriba, otro reporte, otro contenido y el mismo archivo como fallo: cuatro ids distintos.
    expect(ids.size).toBe(4);
  });

  it("un id de entrega a mano se manda tal cual; uno mal formado no se manda", async () => {
    const m = armar({ respuesta: ok({ entrega: "ent_mio", huella: HUELLA_DEL_RESULTADO, publicacion: "publicando" }, 202) });
    expect((await puertaEntregar(m.d, { ...F, delivery: "ent_mio" })).codigo).toBe(SALIDA.ok);
    expect(m.llamadas[0]!.entrega).toBe("ent_mio");
    const mal = armar();
    const r = await puertaEntregar(mal.d, { ...F, delivery: "ent_con espacio" });
    expect(r.json.error).toBe("entrega_invalida");
    expect(mal.llamadas).toEqual([]);
    expect(r.texto).not.toContain("con espacio");
  });

  it("el archivo se lee con tope de 256 KB y por el lector con defensas; lo que no se puede leer no se manda", async () => {
    const m = armar({ archivo: { error: "it's too large" } });
    const r = await puertaEntregar(m.d, F);
    expect(m.archivos).toEqual([{ ruta: "result.json", tope: 256 * 1024 }]);
    expect(r.json).toMatchObject({ ok: false, error: "archivo_ilegible" });
    expect(r.texto).toContain("it's too large");
    expect(m.llamadas).toEqual([]);
  });

  it("un archivo que no es UTF-8, ni JSON, ni un objeto: 3 y sin pedido", async () => {
    for (const archivo of ["{no", "[]", "\"texto\"", "null", "3"]) {
      const m = armar({ archivo });
      const r = await puertaEntregar(m.d, F);
      expect(r.json.error, archivo).toBe("archivo_invalido");
      expect(m.llamadas).toEqual([]);
    }
  });

  it("--dry-run lee y comprueba el archivo y dice el id, pero ni pide la clave ni manda nada", async () => {
    const m = armar({ env: {} });
    const r = await puertaEntregar(m.d, { ...F, dryRun: true });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ ok: true, dry_run: true, reporte_id: "rpt_ejemplo0001" });
    expect(String(r.json.entrega)).toMatch(/^ent_[0-9a-f]{32}$/);
    expect(m.llamadas).toEqual([]);
    expect(m.preguntas).toEqual([]);
    const mal = armar({ env: {}, archivo: "{" });
    expect((await puertaEntregar(mal.d, { ...F, dryRun: true })).json.error).toBe("archivo_invalido");
  });

  it("una entrega que el motor repite (200, repetido) no es un error y dice que no se publicó otra vez", async () => {
    const m = armar({ respuesta: (l) => ok({ entrega: l.entrega, huella: HUELLA_DEL_RESULTADO, publicacion: "publicado", issue: { numero: 412, url: "https://github.com/ejemplo/app/issues/412" }, repetido: true }) });
    const r = await puertaEntregar(m.d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json.repetido).toBe(true);
    expect(r.texto).toMatch(/already received .* nothing new was published\. Issue #412/);
  });

  it("«sin issue» antes de la etapa 8: lo dice (el issue sale igual) y lo que filtró el acuerdo", async () => {
    const m = armar({ respuesta: (l) => ok({ entrega: l.entrega, huella: HUELLA_DEL_RESULTADO, publicacion: "publicando", sin_issue: { registrado: true, issue_sale_igual: true, motivo: "sin_issue_todavia_no_rige" }, filtrado: { campos_quitados: ["usuario.id", "evidencia[1] (elemento)"], lineas_quitadas: 1 } }, 202) });
    const r = await puertaEntregar(m.d, F);
    expect(r.texto).toMatch(/«No issue» was recorded, but until that is turned on the issue is opened anyway/);
    expect(r.texto).toMatch(/removed: usuario\.id, evidencia\[1\] \(elemento\) \(and 1 line\(s\)\)/);
    expect(r.json.sin_issue).toEqual({ registrado: true, issue_sale_igual: true });
  });

  it("una respuesta de OTRA entrega que la pedida es respuesta_inesperada (no se dice «entregado»)", async () => {
    const r = await puertaEntregar(armar({ respuesta: ok({ entrega: "ent_otra", huella: HUELLA_DEL_RESULTADO, publicacion: "publicando" }, 202) }).d, F);
    expect(r.json.error).toBe("respuesta_inesperada");
    expect(r.json.entrega).toMatch(/^ent_[0-9a-f]{32}$/);
  });

  it("un 5xx o una red caída: sale 1, dice que repetir el MISMO comando es seguro y trae el id para repetirlo", async () => {
    for (const m of [armar({ respuesta: ok({ error: "error_interno", message: "boom" }, 502) }), armar({ lanza: new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "I couldn't reach the engine.") })]) {
      const r = await puertaEntregar(m.d, F);
      expect(r.codigo).toBe(SALIDA.inesperado);
      expect(r.texto).toMatch(/repeat the same command .* a repeat is safe and is never published twice/);
      expect(r.json.entrega).toMatch(/^ent_[0-9a-f]{32}$/);
      expect(m.llamadas).toHaveLength(1);
      sinFugas(r, m.stderr);
    }
  });

  it("publicacion_no_disponible (503): 1 y la frase dice repetir", async () => {
    const r = await puertaEntregar(armar({ respuesta: ok({ error: "publicacion_no_disponible" }, 503) }).d, F);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.texto).toMatch(/Repeat the same command/);
  });

  it("los 409 y 422 del contrato (ejemplos 10, 13 y 20) dicen su frase y los campos, nunca los valores", async () => {
    const casos: [number, Record<string, unknown>, number, string][] = [
      [409, { error: "no_asignado", message: "Este reporte lo tiene asignado otro investigador." }, SALIDA.haceFaltaUnaPersona, "no_asignado"],
      [409, { error: "reporte_ya_tiene_entrega", entrega: "ent_ejemplo0001", tipo: "fallo", estado: "el_agente_fallo" }, SALIDA.haceFaltaUnaPersona, "reporte_ya_tiene_entrega"],
      [409, { error: "entrega_con_otro_contenido", huella_guardada: HUELLA_DEL_RESULTADO, huella_recibida: HUELLA_DEL_FALLO }, SALIDA.entradaInvalida, "entrega_con_otro_contenido"],
      [422, { error: "identidad_incompleta", message: "agente.nombre y agente.version son obligatorios." }, SALIDA.entradaInvalida, "identidad_incompleta"],
      [422, { error: "motivo_desconocido", validos: ["error_del_agente"] }, SALIDA.entradaInvalida, "motivo_desconocido"],
      [422, { error: "campo_no_permitido", campos: ["por_que"] }, SALIDA.entradaInvalida, "campo_no_permitido"],
      [422, { error: "resultado_invalido", problemas: ["diagnostico.titulo:too_big", "supuestos.0:too_small"] }, SALIDA.entradaInvalida, "resultado_invalido"],
      [413, { error: "cuerpo_demasiado_grande" }, SALIDA.entradaInvalida, "cuerpo_demasiado_grande"],
    ];
    for (const [status, cuerpo, codigo, error] of casos) {
      const r = await puertaEntregar(armar({ respuesta: ok(cuerpo, status) }).d, F);
      expect(r.codigo, error).toBe(codigo);
      expect(r.json.error).toBe(error);
      expect(String(r.json.message)).not.toMatch(/asignado otro|obligatorios/);
      expect(r.json.entrega).toMatch(/^ent_/);
    }
    const huellas = await puertaEntregar(armar({ respuesta: ok(casos[2]![1], 409) }).d, F);
    expect(huellas.json).toMatchObject({ huella_guardada: HUELLA_DEL_RESULTADO, huella_recibida: HUELLA_DEL_FALLO });
    const problemas = await puertaEntregar(armar({ respuesta: ok(casos[6]![1], 422) }).d, F);
    expect(problemas.texto).toContain("Problems (field:code): diagnostico.titulo:too_big, supuestos.0:too_small.");
  });

  it("un 422 que trajera un VALOR en vez de un `campo:codigo` no se copia", async () => {
    const r = await puertaEntregar(armar({ respuesta: ok({ error: "resultado_invalido", problemas: ["diagnostico.titulo:too_big", "El usuario ana@example.com dijo que..."], campos: ["ana@example.com"] }, 422) }).d, F);
    expect(r.json.problemas).toEqual(["diagnostico.titulo:too_big"]);
    expect(r.json.campos).toBeUndefined();
    expect(todo(r)).not.toContain("ana@example.com");
  });

  it("gate fail: PUT …/fallo y el reporte pasa a «Te necesitan»; no dice abrir igual ni cambiar de investigador como si se pudiera", async () => {
    const cuerpo = JSON.stringify(FALLO);
    const m = armar({ archivo: cuerpo, respuesta: (l) => ok({ entrega: l.entrega, huella: HUELLA_DEL_FALLO, estado: "el_agente_fallo", te_necesitan: true }) });
    const r = await puertaFallo(m.d, F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.llamadas[0]).toMatchObject({ que: "fallo", cuerpo });
    expect(r.json).toMatchObject({ ok: true, estado: "el_agente_fallo", te_necesitan: true, huella: HUELLA_DEL_FALLO });
    expect(r.texto).toMatch(/the report is with a person now/);
    expect(r.texto).not.toMatch(/gate read/);
  });
});

describe("el barrido final", () => {
  it("tapa la clave literal y todo lo que tenga su forma, en el texto y en el JSON, pero no el pase", () => {
    const r = sinLaClaveDeAgente({
      codigo: 0, texto: `a ${CLAVE_DE_AGENTE} b scf_ag_otra-clave-de-otro c ${PASE}`,
      json: { ok: true, x: [`${CLAVE_DE_AGENTE}`, { y: "scf_ag_zzzzzz" }], [CLAVE_DE_AGENTE]: 1, pase: PASE },
    }, CLAVE_DE_AGENTE);
    expect(r.texto).toBe(`a [key] b scf_ag_… c ${PASE}`);
    expect(JSON.stringify(r.json)).not.toContain("clainv01");
    expect(r.json.pase).toBe(PASE);
  });
});
