// supcoflow agents show / set-key / check / remove / configure — tanda 9 de «La IA la pone el cliente» (plan v2 §8).
// Lo que manda: la clave de IA del cliente es de SÓLO ESCRITURA. Entra por una terminal sin eco o por una variable de entorno que
// la persona nombra, viaja en el cuerpo de UN pedido al motor, y no sale por ningún lado: ni la pantalla, ni `--json`, ni lo que
// va a stderr, ni un error (aunque el motor, por un bug, la repitiera). Cada test de abajo mira TODO lo que salió.
import { describe, expect, it } from "vitest";
import { configurarElChat, leerCuentasDeIa, ponerCuentaDeIa, quitarCuentaDeIa, validarCuentaDeIa, type Fetch } from "../src/api.ts";
import {
  agentesConfigurar, agentesPonerClave, agentesQuitar, agentesValidar, agentesVer, sinLaClave, type DepsDeAgentes,
} from "../src/comandos/agentes.ts";
import { FalloDeLaTerminal, SALIDA, type Resultado } from "../src/contrato.ts";

const CLAVE_DE_LA_PERSONA = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
// La clave de IA del cliente. Distinguible a simple vista, con trozos de adelante, del medio y de atrás para detectar fugas parciales.
const CLAVE = "vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0ZyXwVu";
const ULTIMOS4 = "XwVu";
const PEDAZOS = [CLAVE, CLAVE.slice(0, -4), CLAVE.slice(4, 20), CLAVE.slice(12, 30), "9f8e7d6c5b4a"];
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const RUTA = "/api/proyectos/proj_r-1/cuentas-de-ia";

type Llamada = { metodo: string; ruta: string; cuerpo?: unknown };
type Respuesta = { status: number; cuerpo: Record<string, unknown> };

const cuenta = (agente: string, o: Record<string, unknown> = {}) => ({
  id: `cdi_${agente}`, agente, proveedor: "ai_gateway", ultimos4: ULTIMOS4, estado: "lista", codigo: null,
  validada_en: "2026-11-01T10:00:00.000Z", puesta_por: "usr_1", puesta_en: "2026-11-01T09:00:00.000Z", ...o,
});

function armar(o: { respuestas?: Respuesta[] | ((l: Llamada) => Respuesta); env?: Record<string, string | undefined>; tty?: boolean; teclado?: string | null | Error; sinProyecto?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  const stderr: string[] = [];
  const preguntas: string[] = [];
  let buscados = 0;
  const responder = (l: Llamada): Respuesta => {
    llamadas.push(l);
    if (typeof o.respuestas === "function") return o.respuestas(l);
    const r = o.respuestas?.shift();
    if (r === undefined) throw new Error(`respuesta de más para ${l.metodo} ${l.ruta}`);
    return r;
  };
  const d: DepsDeAgentes = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE_DE_LA_PERSONA, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => { buscados++; return o.sinProyecto ? null : PROY; },
    env: o.env ?? {},
    esTty: o.tty ?? false,
    leerClaveOculta: async (pregunta) => {
      preguntas.push(pregunta);
      if (o.teclado instanceof Error) throw o.teclado;
      return o.teclado === undefined ? CLAVE : o.teclado;
    },
    leerCuentas: async (_a, _c, id) => responder({ metodo: "GET", ruta: `/api/proyectos/${id}/cuentas-de-ia` }),
    ponerCuenta: async (_a, _c, id, agente, cuerpo) => responder({ metodo: "PUT", ruta: `/api/proyectos/${id}/cuentas-de-ia/${agente}`, cuerpo }),
    validarCuenta: async (_a, _c, id, agente) => responder({ metodo: "POST", ruta: `/api/proyectos/${id}/cuentas-de-ia/${agente}/validar` }),
    quitarCuenta: async (_a, _c, id, agente) => responder({ metodo: "DELETE", ruta: `/api/proyectos/${id}/cuentas-de-ia/${agente}` }),
    configurarChat: async (_a, _c, id, cuerpo) => responder({ metodo: "PUT", ruta: `/api/proyectos/${id}/agentes/chat`, cuerpo }),
    avisar: (s) => void stderr.push(s),
  };
  return { d, llamadas, stderr, preguntas, buscados: () => buscados };
}

/** TODO lo que una persona (o un asistente) podría leer de una corrida: el texto, el JSON y lo que fue a stderr. */
function loQueSale(r: Resultado, stderr: string[]): string {
  return [r.texto, JSON.stringify(r.json), ...stderr].join("\n");
}
function sinFugas(r: Resultado, stderr: string[], quePuedeAparecer: string[] = []) {
  let todo = loQueSale(r, stderr);
  for (const ok of quePuedeAparecer) todo = todo.split(ok).join("");
  for (const trozo of PEDAZOS) expect(todo, `fuga de «${trozo.slice(0, 8)}…»`).not.toContain(trozo);
}

const F = {
  repo: null, dryRun: false, agent: "chat" as string | null, fromEnv: null as string | null, provider: null as string | null,
  option: null as string | null, dataRetention: null as string | null,
};
const LISTA = { status: 200, cuerpo: { cuenta: cuenta("chat"), reemplazo: false, saldo_usd: 12.5, avisos: [] } };

// ───────────────────────────────────────────────────────── show ─────────────────────────────────────────────────────────
describe("agents show", () => {
  const S = { ...F, agent: null as string | null };
  const DOS = { status: 200, cuerpo: { cuentas: [
    { agente: "chat", estado: "lista", cuenta_lista: true, cuenta: cuenta("chat") },
    { agente: "triaje", estado: "falta", cuenta_lista: false, cuenta: null },
  ] } };

  it("muestra las dos cuentas (lista y falta), sin ningún secreto, y sale 0 aunque falte una", async () => {
    const m = armar({ respuestas: [structuredClone(DOS)] });
    const r = await agentesVer(m.d, S as never);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.llamadas).toEqual([{ metodo: "GET", ruta: RUTA }]);
    expect(r.json).toMatchObject({
      ok: true, proyecto: "proj_r-1",
      agentes: [
        { agente: "chat", estado: "lista", cuenta_lista: true, cuenta: { proveedor: "ai_gateway", ultimos4: ULTIMOS4, estado: "lista", validada_en: "2026-11-01T10:00:00.000Z" } },
        { agente: "triaje", estado: "falta", cuenta_lista: false, cuenta: null },
      ],
    });
    expect(r.texto).toContain("chat: ready");
    expect(r.texto).toContain("triage agent: missing");
    // La clave no se puede ver ni editar: el texto lo dice y dice cómo se rota.
    expect(r.texto).toMatch(/can't be shown|never shown/i);
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("a una cuenta que falta le dice a la persona cómo ponerla ella misma (la skill nunca la pide en el chat)", async () => {
    const m = armar({ respuestas: [structuredClone(DOS)] });
    const r = await agentesVer(m.d, S as never);
    expect(r.texto).toContain("supcoflow agents set-key --agent triage");
    expect(r.texto).toMatch(/Agents tab/);
    expect(r.texto).toMatch(/yourself/);
  });
  it("--agent triage (o triaje) muestra sólo ése; --agent chat sólo el chat", async () => {
    for (const a of ["triage", "triaje"]) {
      const m = armar({ respuestas: [structuredClone(DOS)] });
      const r = await agentesVer(m.d, { ...F, agent: a } as never);
      expect((r.json.agentes as { agente: string }[]).map((x) => x.agente), a).toEqual(["triaje"]);
    }
    const m = armar({ respuestas: [structuredClone(DOS)] });
    expect(((await agentesVer(m.d, { ...F, agent: "chat" } as never)).json.agentes as unknown[]).length).toBe(1);
  });
  it("un agente que no existe → 3 agente_invalido, sin llamar al motor", async () => {
    const m = armar();
    const r = await agentesVer(m.d, { ...F, agent: "skill" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { ok: false, error: "agente_invalido" } });
    expect(m.llamadas).toEqual([]);
  });
  it("sólo pasan los campos de la lista blanca: un campo de más del motor (aunque fuera la clave) no sale", async () => {
    const hostil = structuredClone(DOS);
    const c = hostil.cuerpo.cuentas as { cuenta: Record<string, unknown> | null }[];
    c[0]!.cuenta!.clave = CLAVE;
    c[0]!.cuenta!.sobre = `enc:${CLAVE}`;
    (hostil.cuerpo as Record<string, unknown>).clave = CLAVE;
    const m = armar({ respuestas: [hostil] });
    const r = await agentesVer(m.d, S as never);
    sinFugas(r, m.stderr, [ULTIMOS4]);
    expect(JSON.stringify(r.json)).not.toContain("sobre");
  });
  it("«últimos 4» con más de cuatro caracteres (un motor roto que mandara la clave entera) no sale", async () => {
    const hostil = structuredClone(DOS);
    (hostil.cuerpo.cuentas as { cuenta: Record<string, unknown> }[])[0]!.cuenta.ultimos4 = CLAVE;
    const m = armar({ respuestas: [hostil] });
    const r = await agentesVer(m.d, S as never);
    sinFugas(r, m.stderr);
  });
  it("una cuenta rechazada o sin saldo se dice con lo que hay que hacer", async () => {
    const m = armar({ respuestas: [{ status: 200, cuerpo: { cuentas: [
      { agente: "chat", estado: "rechazada", cuenta_lista: false, cuenta: cuenta("chat", { estado: "rechazada", codigo: "invalid_api_key" }) },
      { agente: "triaje", estado: "sin_saldo", cuenta_lista: false, cuenta: cuenta("triaje", { estado: "sin_saldo", codigo: "insufficient_funds" }) },
    ] } }] });
    const r = await agentesVer(m.d, S as never);
    expect(r.texto).toMatch(/chat: rejected/);
    expect(r.texto).toMatch(/triage agent: out of balance/);
    expect(r.texto).toContain("supcoflow agents check --agent chat");
  });
  it("sin proyecto en el repo → 4 sin_proyecto (como los demás comandos), sin pedir las cuentas", async () => {
    const m = armar({ sinProyecto: true });
    const r = await agentesVer(m.d, S as never);
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { error: "sin_proyecto" } });
    expect(m.llamadas).toEqual([]);
  });
  it("un motor que contesta algo que no es la lista → 1 respuesta_inesperada", async () => {
    const m = armar({ respuestas: [{ status: 200, cuerpo: { cuentas: "no" } }] });
    expect(await agentesVer(m.d, S as never)).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "respuesta_inesperada" } });
  });
  it("un proyecto ajeno o que no existe (404) → 3 con el código del motor", async () => {
    const m = armar({ respuestas: [{ status: 404, cuerpo: { error: "proyecto_no_encontrado", message: "No encontramos ese proyecto." } }] });
    expect(await agentesVer(m.d, S as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "proyecto_no_encontrado" } });
  });
});

// ─────────────────────────────────────────────────────── set-key ────────────────────────────────────────────────────────
describe("agents set-key: de dónde sale la clave", () => {
  it("falta --agent → 3 falta_agente, sin leer nada ni llamar al motor", async () => {
    const m = armar({ tty: true });
    const r = await agentesPonerClave(m.d, { ...F, agent: null } as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "falta_agente" } });
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([]);
  });
  it("--from-env NOMBRE: lee la variable, la manda en el cuerpo del PUT y nada más; no pregunta nada", async () => {
    const m = armar({ env: { AI_GATEWAY_API_KEY: CLAVE }, respuestas: [structuredClone(LISTA)] });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "AI_GATEWAY_API_KEY" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "chat", reemplazo: false } });
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([{ metodo: "PUT", ruta: `${RUTA}/chat`, cuerpo: { clave: CLAVE, proveedor: "ai_gateway" } }]);
    sinFugas(r, m.stderr, [ULTIMOS4]);
    expect(r.texto).toContain(`ends in ${ULTIMOS4}`);
  });
  it("la variable trae un salto de línea o espacios de más (pasa con `export K=$(cat archivo)`) → se limpian", async () => {
    const m = armar({ env: { K: `  ${CLAVE}\n` }, respuestas: [structuredClone(LISTA)] });
    await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect((m.llamadas[0]!.cuerpo as { clave: string }).clave).toBe(CLAVE);
  });
  it("--from-env con una variable que no existe o está vacía → 3 variable_vacia, sin llamar al motor", async () => {
    for (const env of [{}, { K: "" }, { K: "   \n" }]) {
      const m = armar({ env });
      const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
      expect(r, JSON.stringify(env)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "variable_vacia" } });
      expect(r.texto).toContain("K");
      expect(m.llamadas).toEqual([]);
    }
  });
  it("--from-env con la CLAVE en lugar del nombre → 3 sin_la_clave_como_nombre; el mensaje NO la repite y dice que la dé por expuesta", async () => {
    const m = armar({ env: { [CLAVE]: "otra-cosa" } });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: CLAVE } as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { ok: false, error: "clave_como_nombre" } });
    expect(r.texto).toMatch(/exposed/);
    expect(r.texto).toMatch(/NAME of an environment variable/);
    sinFugas(r, m.stderr);
    expect(m.llamadas).toEqual([]);
  });
  it("--from-env con algo que no es un nombre (espacios, signos) → 3 nombre_de_variable_invalido, sin repetirlo", async () => {
    const m = armar();
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "una clave con espacios 1234" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "nombre_de_variable_invalido" } });
    expect(r.texto).not.toContain("una clave con espacios");
  });
  it("terminal interactiva (sin --from-env): pregunta sin eco, y la pregunta no lleva nada de la clave", async () => {
    const m = armar({ tty: true, respuestas: [structuredClone(LISTA)] });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(m.preguntas).toHaveLength(1);
    expect(m.preguntas[0]).toMatch(/chat/);
    expect(m.preguntas[0]).toMatch(/not shown|hidden|won't be shown/i);
    expect((m.llamadas[0]!.cuerpo as { clave: string }).clave).toBe(CLAVE);
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("pregunta DESPUÉS de saber que el proyecto existe (no se le pide la clave a quien no puede usarla)", async () => {
    const m = armar({ tty: true, sinProyecto: true });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r.json.error).toBe("sin_proyecto");
    expect(m.preguntas).toEqual([]);
  });
  it("sin terminal y sin --from-env → 4 sin_terminal: dice que la escriba la persona, o --from-env; no llama al motor ni pregunta", async () => {
    const m = armar({ tty: false });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "sin_terminal" } });
    expect(r.texto).toContain("supcoflow agents set-key --agent chat");
    expect(r.texto).toContain("--from-env");
    expect(r.texto).toMatch(/never goes as an argument|never as an argument|not as an argument/i);
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([]);
    expect(m.buscados()).toBe(0);
  });
  it("si no se puede ocultar lo que se escribe, NO pregunta (falla cerrado, nunca con eco) → 4 sin_eco", async () => {
    const m = armar({ tty: true, teclado: new Error(`no puedo ocultar ${CLAVE}`) });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "sin_eco" } });
    expect(r.texto).toContain("--from-env");
    sinFugas(r, m.stderr);
    expect(m.llamadas).toEqual([]);
  });
  it("Ctrl-C en la pregunta → 3 cancelado, sin tocar nada", async () => {
    const m = armar({ tty: true, teclado: null });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "cancelado" } });
    expect(m.llamadas).toEqual([]);
  });
});

describe("agents set-key: lo que se acepta como clave", () => {
  it("vacía → 3 clave_vacia", async () => {
    const m = armar({ tty: true, teclado: "  " });
    expect(await agentesPonerClave(m.d, F as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "clave_vacia" } });
    expect(m.llamadas).toEqual([]);
  });
  it("con espacios o saltos adentro → 3 clave_con_forma_invalida, y el mensaje no repite lo escrito", async () => {
    const mala = `${CLAVE} ${CLAVE}`;
    const m = armar({ tty: true, teclado: mala });
    const r = await agentesPonerClave(m.d, F as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "clave_con_forma_invalida" } });
    sinFugas(r, m.stderr);
    expect(m.llamadas).toEqual([]);
  });
  it("demasiado larga → 3 clave_con_forma_invalida", async () => {
    const m = armar({ env: { K: "k".repeat(513) } });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "clave_con_forma_invalida" } });
    expect(JSON.stringify(r)).not.toContain("kkkkkkkkkk");
  });
  it("la clave de Supcoflow (scf_…, la de SUPCOFLOW_TOKEN) pegada como si fuera la de IA → 3 es_una_clave_de_supcoflow, sin repetirla ni mandarla", async () => {
    for (const via of ["env", "tty"] as const) {
      const m = armar(via === "env" ? { env: { SUPCOFLOW_TOKEN: CLAVE_DE_LA_PERSONA } } : { tty: true, teclado: CLAVE_DE_LA_PERSONA });
      const r = await agentesPonerClave(m.d, { ...F, fromEnv: via === "env" ? "SUPCOFLOW_TOKEN" : null } as never);
      expect(r, via).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "es_una_clave_de_supcoflow" } });
      expect(loQueSale(r, m.stderr)).not.toContain(CLAVE_DE_LA_PERSONA.slice(5, 30));
      expect(m.llamadas).toEqual([]);
    }
  });
  it("--provider: se manda tal cual (ai_gateway por defecto); uno con forma rara → 3 sin llamar", async () => {
    const m = armar({ env: { K: CLAVE }, respuestas: [structuredClone(LISTA)] });
    await agentesPonerClave(m.d, { ...F, fromEnv: "K", provider: "ai_gateway" } as never);
    expect((m.llamadas[0]!.cuerpo as { proveedor: string }).proveedor).toBe("ai_gateway");
    const otro = armar({ env: { K: CLAVE } });
    expect(await agentesPonerClave(otro.d, { ...F, fromEnv: "K", provider: "Un Proveedor!" } as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "proveedor_invalido" } });
    expect(otro.llamadas).toEqual([]);
  });
});

describe("agents set-key: lo que el motor contesta", () => {
  const poner = async (resp: Respuesta, extra: Partial<typeof F> = {}) => {
    const m = armar({ env: { K: CLAVE }, respuestas: [resp] });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K", ...extra } as never);
    return { r, m };
  };

  it("200 reemplazo → «Replaced», con los últimos 4, el saldo y el siguiente paso; JSON en la forma de siempre", async () => {
    const { r, m } = await poner({ status: 200, cuerpo: { cuenta: cuenta("chat"), reemplazo: true, saldo_usd: 3.25, avisos: ["saldo_cero"] } });
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "chat", reemplazo: true, saldo_usd: 3.25, avisos: ["saldo_cero"], cuenta: { ultimos4: ULTIMOS4, estado: "lista" } } });
    expect(r.texto).toMatch(/Replaced/);
    expect(r.texto).toMatch(/no balance|zero|hasn't any balance|has no balance/i);
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("200 pero la cuenta quedó sin saldo → sale 4 cuenta_sin_saldo con lo que hay que hacer (la clave se guardó, y se dice)", async () => {
    const { r, m } = await poner({ status: 200, cuerpo: { cuenta: cuenta("chat", { estado: "sin_saldo", codigo: "insufficient_funds" }), reemplazo: false, saldo_usd: 0, avisos: [] } });
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "cuenta_sin_saldo", guardada: true } });
    expect(r.texto).toMatch(/saved/);
    expect(r.texto).toMatch(/agents check --agent chat/);
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("200 sin la cuenta en la respuesta → 1 respuesta_inesperada (y dice que mire con `agents show`)", async () => {
    const { r } = await poner({ status: 200, cuerpo: { reemplazo: false } });
    expect(r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "respuesta_inesperada" } });
    expect(r.texto).toContain("agents show");
  });
  it("422 clave rechazada → 3 clave_rechazada: no se guardó; con el código del proveedor, nunca la clave", async () => {
    const { r, m } = await poner({ status: 422, cuerpo: { error: "clave_rechazada", message: "El proveedor de IA rechazó esa clave. No la guardamos.", codigo: "invalid_api_key" } });
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { ok: false, error: "clave_rechazada", codigo: "invalid_api_key" } });
    expect(r.texto).toMatch(/not saved|didn't save|No la guardamos/i);
    sinFugas(r, m.stderr);
  });
  it("422 forma inválida → 3 clave_con_forma_invalida", async () => {
    const { r } = await poner({ status: 422, cuerpo: { error: "clave_con_forma_invalida", message: "Eso no tiene la forma de una clave de ese proveedor." } });
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "clave_con_forma_invalida" } });
  });
  it("400 proveedor desconocido → 3", async () => {
    const { r } = await poner({ status: 400, cuerpo: { error: "proveedor_desconocido", message: "Ese proveedor de IA no está disponible." } });
    expect(r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "proveedor_desconocido" } });
  });
  it("403 requiere_dueno (un Miembro o un Lector) → 4: lo hace un Dueño del equipo", async () => {
    const { r } = await poner({ status: 403, cuerpo: { error: "requiere_dueno", message: "Sólo un Dueño del equipo puede poner, cambiar o quitar la cuenta de IA. Vos podés ver su estado." } });
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { error: "requiere_dueno" } });
  });
  it("404 proyecto ajeno → 3; 404 agente desconocido → 3", async () => {
    expect((await poner({ status: 404, cuerpo: { error: "proyecto_no_encontrado", message: "x" } })).r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "proyecto_no_encontrado" } });
    expect((await poner({ status: 404, cuerpo: { error: "agente_desconocido", message: "x" } })).r).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "agente_desconocido" } });
  });
  it("409 dos puestas a la vez → 1 (se reintenta)", async () => {
    expect((await poner({ status: 409, cuerpo: { error: "conflicto", message: "Otra persona estaba poniendo la cuenta." } })).r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "conflicto" } });
  });
  it("502 el proveedor no contestó → 1 proveedor_no_responde, y dice que NO se guardó nada", async () => {
    const { r } = await poner({ status: 502, cuerpo: { error: "proveedor_no_responde", message: "No pudimos hablar con el proveedor de IA para comprobar la clave. No cambiamos nada: probá de nuevo en un rato." } });
    expect(r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "proveedor_no_responde" } });
    expect(r.texto).toMatch(/nothing was saved|didn't change anything|No cambiamos nada/i);
  });
  it("503 el motor no tiene llavero → 1 cuentas_no_disponibles", async () => {
    expect((await poner({ status: 503, cuerpo: { error: "cuentas_no_disponibles", message: "No podemos guardar ni usar cuentas de IA en este momento." } })).r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "cuentas_no_disponibles" } });
  });
  it("500 → 1 error_interno", async () => {
    expect((await poner({ status: 500, cuerpo: { error: "error_interno", message: "Algo falló de nuestro lado." } })).r.codigo).toBe(SALIDA.inesperado);
  });
  it("una respuesta rara (cuerpo sin error ni cuenta) → 1, sin pegar el cuerpo crudo", async () => {
    const { r } = await poner({ status: 418, cuerpo: { raro: CLAVE } });
    expect(r.codigo).not.toBe(SALIDA.ok);
    sinFugas(r, []);
  });
});

describe("agents set-key: el secreto no sale NUNCA — ni siquiera si el motor lo repite", () => {
  // El motor de verdad no lo hace (lo clavan sus tests), pero la terminal no confía: tapa la clave literal en todo lo que imprime
  // y reduce lo que muestra del motor a campos conocidos.
  const MOTOR_QUE_REPITE: Respuesta[] = [
    { status: 422, cuerpo: { error: "clave_rechazada", message: `La clave ${CLAVE} fue rechazada`, codigo: CLAVE } },
    { status: 422, cuerpo: { error: `clave_${CLAVE}`, message: `x ${CLAVE.slice(0, -4)} y`, campos: [CLAVE] } },
    { status: 400, cuerpo: { error: "invalid_body", message: `cuerpo ${CLAVE}`, issues: [{ received: CLAVE }] } },
    { status: 502, cuerpo: { error: "proveedor_no_responde", message: `fetch a https://ai-gateway.vercel.sh con Bearer ${CLAVE} falló` } },
    { status: 500, cuerpo: { error: "error_interno", message: `INSERT ... VALUES ('${CLAVE}')` } },
    { status: 200, cuerpo: { cuenta: cuenta("chat", { ultimos4: CLAVE, codigo: CLAVE, proveedor: CLAVE }), reemplazo: false, saldo_usd: 1, avisos: [CLAVE, "saldo_cero"] } },
    { status: 200, cuerpo: { cuenta: cuenta("chat"), reemplazo: false, saldo_usd: 1, avisos: [], clave: CLAVE, eco: { clave: CLAVE } } },
  ];
  for (const [i, resp] of MOTOR_QUE_REPITE.entries()) {
    it(`caso ${i + 1}: status ${resp.status}`, async () => {
      for (const via of ["env", "tty"] as const) {
        const m = armar({ respuestas: [structuredClone(resp)], ...(via === "env" ? { env: { K: CLAVE } } : { tty: true }) });
        const r = await agentesPonerClave(m.d, { ...F, fromEnv: via === "env" ? "K" : null } as never);
        sinFugas(r, m.stderr, resp.status === 200 ? [ULTIMOS4] : []);
      }
    });
  }
  it("con --dry-run: no lee la clave (no pregunta), no llama al motor y no la nombra", async () => {
    const m = armar({ tty: true });
    const r = await agentesPonerClave(m.d, { ...F, dryRun: true } as never);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, dry_run: true } });
    expect(m.preguntas).toEqual([]);
    expect(m.llamadas).toEqual([]);
    expect(r.texto).toMatch(/PUT/);
    sinFugas(r, m.stderr);
  });
  it("con --dry-run y --from-env: dice si la variable está puesta, sin mostrarla", async () => {
    const m = armar({ env: { K: CLAVE } });
    const r = await agentesPonerClave(m.d, { ...F, dryRun: true, fromEnv: "K" } as never);
    expect(r.json).toMatchObject({ dry_run: true });
    expect(r.texto).toContain("K");
    sinFugas(r, m.stderr);
    const vacia = await agentesPonerClave(armar({ env: {} }).d, { ...F, dryRun: true, fromEnv: "K" } as never);
    expect(vacia).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "variable_vacia" } });
  });
  it("lo que `avisar` (stderr) recibió en toda la corrida tampoco la lleva", async () => {
    const m = armar({ env: { K: CLAVE }, respuestas: [structuredClone(MOTOR_QUE_REPITE[3]!)] });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    for (const linea of m.stderr) for (const p of PEDAZOS) expect(linea).not.toContain(p);
    sinFugas(r, m.stderr);
  });
});

// ─────────────────────────────────────────────────────── check ──────────────────────────────────────────────────────────
describe("agents check", () => {
  const validar = async (resp: Respuesta, agent = "chat") => {
    const m = armar({ respuestas: [resp] });
    const r = await agentesValidar(m.d, { ...F, agent } as never);
    return { r, m };
  };
  it("la cuenta sirve → 0; POST …/validar; dice si cambió de estado y el saldo", async () => {
    const { r, m } = await validar({ status: 200, cuerpo: { cuenta: cuenta("chat"), cambio_de_estado: false, saldo_usd: 7.5, avisos: [] } });
    expect(m.llamadas).toEqual([{ metodo: "POST", ruta: `${RUTA}/chat/validar` }]);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "chat", cambio_de_estado: false, saldo_usd: 7.5, cuenta: { estado: "lista" } } });
    expect(r.texto).toMatch(/ready/);
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("--agent triage valida el triaje", async () => {
    const { m } = await validar({ status: 200, cuerpo: { cuenta: cuenta("triaje"), cambio_de_estado: true, saldo_usd: null, avisos: [] } }, "triage");
    expect(m.llamadas[0]!.ruta).toBe(`${RUTA}/triaje/validar`);
  });
  it("el proveedor ahora la rechaza → 4 cuenta_rechazada (ok: false), con los datos igual", async () => {
    const { r } = await validar({ status: 200, cuerpo: { cuenta: cuenta("chat", { estado: "rechazada", codigo: "invalid_api_key" }), cambio_de_estado: true, saldo_usd: null, avisos: [] } });
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "cuenta_rechazada", cambio_de_estado: true, cuenta: { estado: "rechazada" } } });
    expect(r.texto).toContain("supcoflow agents set-key --agent chat");
  });
  it("sin saldo → 4 cuenta_sin_saldo", async () => {
    const { r } = await validar({ status: 200, cuerpo: { cuenta: cuenta("chat", { estado: "sin_saldo" }), cambio_de_estado: false, saldo_usd: 0, avisos: [] } });
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { error: "cuenta_sin_saldo" } });
  });
  it("los avisos se dicen con una frase; uno que no se conoce se dice en general, nunca crudo", async () => {
    const { r } = await validar({ status: 200, cuerpo: { cuenta: cuenta("chat"), cambio_de_estado: true, saldo_usd: 1, avisos: ["tope_de_la_clave_no_verificable", "algo_nuevo"] } });
    expect(r.json.avisos).toEqual(["tope_de_la_clave_no_verificable", "algo_nuevo"]);
    expect(r.texto).toMatch(/spending cap/i);
    expect(r.texto).not.toContain("algo_nuevo");
  });
  it("404 sin_cuenta → 4: no hay nada que validar; dice cómo ponerla", async () => {
    const { r } = await validar({ status: 404, cuerpo: { error: "sin_cuenta", message: "Ese agente no tiene una cuenta de IA puesta." } });
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { error: "sin_cuenta" } });
    expect(r.texto).toContain("supcoflow agents set-key --agent chat");
  });
  it("502 el proveedor no contestó → 1 (no es un veredicto sobre la clave)", async () => {
    const { r } = await validar({ status: 502, cuerpo: { error: "proveedor_no_responde", message: "No pudimos hablar con el proveedor de IA para comprobar la clave. No cambiamos nada: probá de nuevo en un rato." } });
    expect(r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "proveedor_no_responde" } });
  });
  it("409 la cuenta cambió mientras se validaba → 1", async () => {
    expect((await validar({ status: 409, cuerpo: { error: "cuenta_cambio", message: "La cuenta cambió mientras la validábamos." } })).r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "cuenta_cambio" } });
  });
  it("un Lector no valida: 403 requiere_persona/clave de consulta → 4", async () => {
    expect((await validar({ status: 403, cuerpo: { error: "requiere_persona", message: "Esto lo pide una persona." } })).r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
  });
  it("sin --agent → 3 falta_agente", async () => {
    const m = armar();
    expect(await agentesValidar(m.d, { ...F, agent: null } as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "falta_agente" } });
  });
});

// ─────────────────────────────────────────────────────── remove ─────────────────────────────────────────────────────────
describe("agents remove", () => {
  it("quita: DELETE …/{agente}; dice que la clave se borró de Supcoflow y cómo poner otra", async () => {
    const m = armar({ respuestas: [{ status: 200, cuerpo: { cuenta: cuenta("chat", { estado: "quitada" }) } }] });
    const r = await agentesQuitar(m.d, F as never);
    expect(m.llamadas).toEqual([{ metodo: "DELETE", ruta: `${RUTA}/chat` }]);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "chat" } });
    expect(r.texto).toMatch(/Removed/);
    expect(r.texto).toContain("supcoflow agents set-key --agent chat");
    sinFugas(r, m.stderr, [ULTIMOS4]);
  });
  it("quitar lo que no hay (404 sin_cuenta) deja lo mismo que quitarlo: 0, sin_cuenta: true", async () => {
    const m = armar({ respuestas: [{ status: 404, cuerpo: { error: "sin_cuenta", message: "Ese agente no tiene una cuenta de IA puesta." } }] });
    expect(await agentesQuitar(m.d, { ...F, agent: "triage" } as never)).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "triaje", sin_cuenta: true } });
  });
  it("un Miembro o un Lector → 4 requiere_dueno", async () => {
    const m = armar({ respuestas: [{ status: 403, cuerpo: { error: "requiere_dueno", message: "Sólo un Dueño del equipo puede poner, cambiar o quitar la cuenta de IA." } }] });
    expect(await agentesQuitar(m.d, F as never)).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { error: "requiere_dueno" } });
  });
  it("--dry-run no llama a nada", async () => {
    const m = armar();
    const r = await agentesQuitar(m.d, { ...F, dryRun: true } as never);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { dry_run: true } });
    expect(m.llamadas).toEqual([]);
  });
  it("sin --agent → 3 falta_agente", async () => {
    expect(await agentesQuitar(armar().d, { ...F, agent: null } as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "falta_agente" } });
  });
});

// ───────────────────────────────────────────────────── configure ────────────────────────────────────────────────────────
describe("agents configure (el chat; el motor no deja al triage agent por la terminal)", () => {
  const PERFIL = { status: 200, cuerpo: { perfil: { version: 3, opcion: "estandar", modelo_id: "anthropic/claude-haiku-4.5", esfuerzo: null, sin_guardado_de_datos: false } } };
  it("manda la opción del menú y el interruptor de datos al PUT …/agentes/chat", async () => {
    const m = armar({ respuestas: [structuredClone(PERFIL)] });
    const r = await agentesConfigurar(m.d, { ...F, option: "estandar", dataRetention: "allow" } as never);
    expect(m.llamadas).toEqual([{ metodo: "PUT", ruta: "/api/proyectos/proj_r-1/agentes/chat", cuerpo: { opcion: "estandar", sin_guardado_de_datos: false } }]);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, agente: "chat", perfil: { version: 3, opcion: "estandar", modelo_id: "anthropic/claude-haiku-4.5", sin_guardado_de_datos: false } } });
    expect(r.texto).toMatch(/version 3/);
  });
  it("--data-retention deny → sólo proveedores que no guardan datos (true)", async () => {
    const m = armar({ respuestas: [structuredClone(PERFIL)] });
    await agentesConfigurar(m.d, { ...F, option: "plus", dataRetention: "deny" } as never);
    expect(m.llamadas[0]!.cuerpo).toEqual({ opcion: "plus", sin_guardado_de_datos: true });
  });
  it("acepta los nombres en inglés (agile, standard) y los ids del motor", async () => {
    for (const [dado, id] of [["agile", "agil"], ["standard", "estandar"], ["agil", "agil"], ["Standard", "estandar"]] as const) {
      const m = armar({ respuestas: [structuredClone(PERFIL)] });
      await agentesConfigurar(m.d, { ...F, option: dado, dataRetention: "allow" } as never);
      expect((m.llamadas[0]!.cuerpo as { opcion: string }).opcion, dado).toBe(id);
    }
  });
  it("falta la opción, o el interruptor de datos, o es inválido → 3 sin llamar (el motor no tiene una lectura para completar lo que falta)", async () => {
    const casos: [Partial<typeof F>, string][] = [
      [{ option: null, dataRetention: "allow" }, "falta_opcion"],
      [{ option: "mega", dataRetention: "allow" }, "opcion_invalida"],
      [{ option: "plus", dataRetention: null }, "falta_retencion"],
      [{ option: "plus", dataRetention: "tal-vez" }, "retencion_invalida"],
    ];
    for (const [flags, error] of casos) {
      const m = armar();
      expect(await agentesConfigurar(m.d, { ...F, ...flags } as never), error).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error } });
      expect(m.llamadas).toEqual([]);
    }
  });
  it("sin cambios → 0 sin_cambios", async () => {
    const m = armar({ respuestas: [{ status: 200, cuerpo: { sin_cambios: true, version: 2 } }] });
    const r = await agentesConfigurar(m.d, { ...F, option: "estandar", dataRetention: "allow" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { ok: true, sin_cambios: true, version: 2 } });
  });
  it("una opción que no pasó la medición → 3 opcion_sin_medicion (con el mensaje del motor)", async () => {
    const m = armar({ respuestas: [{ status: 409, cuerpo: { error: "opcion_sin_medicion", message: "Esa opción todavía no pasó nuestra medición como chat: no se puede elegir." } }] });
    expect(await agentesConfigurar(m.d, { ...F, option: "plus", dataRetention: "allow" } as never)).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "opcion_sin_medicion" } });
  });
  it("--agent triage → 4 no_desde_la_terminal: se aprueba en la pestaña Agents; no llama a nada", async () => {
    const m = armar();
    const r = await agentesConfigurar(m.d, { ...F, agent: "triage", option: "plus", dataRetention: "allow" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "no_desde_la_terminal" } });
    expect(r.texto).toMatch(/Agents tab/);
    expect(m.llamadas).toEqual([]);
  });
  it("--dry-run no llama a nada y dice qué mandaría", async () => {
    const m = armar();
    const r = await agentesConfigurar(m.d, { ...F, option: "estandar", dataRetention: "deny", dryRun: true } as never);
    expect(r).toMatchObject({ codigo: SALIDA.ok, json: { dry_run: true } });
    expect(m.llamadas).toEqual([]);
  });
  it("un Lector → 403 requiere_persona / sin permiso → 4", async () => {
    const m = armar({ respuestas: [{ status: 403, cuerpo: { error: "requiere_persona", message: "Esto lo pide una persona." } }] });
    expect((await agentesConfigurar(m.d, { ...F, option: "estandar", dataRetention: "allow" } as never)).codigo).toBe(SALIDA.haceFaltaUnaPersona);
  });
});

describe("las FalloDeLaTerminal que salen de las dependencias se traducen (no se escapan)", () => {
  it("el motor inalcanzable al poner la clave → 1 motor_inalcanzable, y dice que no sabe si se guardó", async () => {
    const m = armar({ env: { K: CLAVE } });
    m.d.ponerCuenta = async () => { throw new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "I couldn't reach the engine (the network is down or it took too long)."); };
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect(r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "motor_inalcanzable" } });
    expect(r.texto).toContain("agents show");
    sinFugas(r, m.stderr);
  });
  it("una excepción cualquiera (aunque su mensaje lleve la clave) sale 1 con la clave tapada", async () => {
    const m = armar({ env: { K: CLAVE } });
    m.d.ponerCuenta = async () => { throw new Error(`boom ${CLAVE}`); };
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect(r.codigo).toBe(SALIDA.inesperado);
    sinFugas(r, m.stderr);
  });
});

// ─── Revisión 1 de la 0.10.0 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("revisión 1, P2-1: lo que dice el motor NO llega a la pantalla ni cuando `api.ts` lanza (401, 403 de persona) — composición real", () => {
  // Acá no se arma la respuesta a mano: se usan las funciones REALES de `api.ts` con un fetch falso, que es lo que recorre el binario.
  const LIBRE = "TEXTO_LIBRE_DEL_MOTOR en castellano";
  const real = (status: number, cuerpo: Record<string, unknown>): DepsDeAgentes => {
    const f = (async () => new Response(JSON.stringify(cuerpo), { status })) as Fetch;
    const m = armar({ env: { K: CLAVE }, tty: true });
    return {
      ...m.d,
      leerCuentas: (a, c, id) => leerCuentasDeIa(a, c, id, f),
      ponerCuenta: (a, c, id, ag, cu) => ponerCuentaDeIa(a, c, id, ag, cu, f),
      validarCuenta: (a, c, id, ag) => validarCuentaDeIa(a, c, id, ag, f),
      quitarCuenta: (a, c, id, ag) => quitarCuentaDeIa(a, c, id, ag, f),
      configurarChat: (a, c, id, cu) => configurarElChat(a, c, id, cu, f),
    };
  };
  const todos = (d: DepsDeAgentes) => [
    () => agentesVer(d, { ...F, agent: null } as never),
    () => agentesPonerClave(d, { ...F, fromEnv: "K" } as never),
    () => agentesValidar(d, F as never),
    () => agentesQuitar(d, F as never),
    () => agentesConfigurar(d, { ...F, option: "estandar", dataRetention: "allow" } as never),
  ];
  const casos: [string, number, Record<string, unknown>, number, string][] = [
    ["401", 401, { error: "sin_sesion", message: `Sesión vencida ${LIBRE}` }, SALIDA.faltaLogin, "clave_invalida"],
    ["403 requiere_persona", 403, { error: "requiere_persona", message: `Esto lo pide una persona. ${LIBRE}` }, SALIDA.haceFaltaUnaPersona, "requiere_persona"],
    ["403 clave_de_consulta", 403, { error: "clave_de_consulta", message: `Sólo lee. ${LIBRE}` }, SALIDA.haceFaltaUnaPersona, "clave_de_consulta"],
  ];
  for (const [nombre, status, cuerpo, codigo, error] of casos) {
    it(`${nombre}: frase fija de la terminal, el código de siempre y el error del motor; en los cinco comandos`, async () => {
      for (const correr of todos(real(status, cuerpo))) {
        const r = await correr();
        expect(r.codigo, nombre).toBe(codigo);
        expect(r.json.error, nombre).toBe(error);
        expect(loQueSale(r, [])).not.toContain("TEXTO_LIBRE");
        expect(loQueSale(r, [])).not.toMatch(/[áéíóúñ]/i);
      }
    });
  }
  it("un 500 sale como motor_inalcanzable con su frase (la de la terminal), no con el texto del motor", async () => {
    const r = await agentesValidar(real(500, { error: "error_interno", message: LIBRE }), F as never);
    expect(r).toMatchObject({ codigo: SALIDA.inesperado, json: { error: "motor_inalcanzable" } });
    expect(loQueSale(r, [])).not.toContain("TEXTO_LIBRE");
  });
  it("un 502 y un 503 siguen trayendo su motivo (con la frase de la terminal)", async () => {
    expect(await agentesValidar(real(502, { error: "proveedor_no_responde", message: LIBRE }), F as never)).toMatchObject({ json: { error: "proveedor_no_responde" } });
    expect(await agentesValidar(real(503, { error: "cuentas_no_disponibles", message: LIBRE }), F as never)).toMatchObject({ json: { error: "cuentas_no_disponibles" } });
  });
});

describe("revisión 1, P2-3: el barrido final (`sinLaClave`) es una defensa que los tests pueden romper", () => {
  const SIN_PREFIJO = "a3f9c2e1b7d4f6a8c0e2b4d6f8a1c3e5";
  it("unitario: tapa la clave entera, la clave sin los últimos 4, y lo que tiene forma de clave; en el texto, en el JSON y en sus llaves", () => {
    const r = sinLaClave({ codigo: 1, texto: `error ${SIN_PREFIJO} y ${SIN_PREFIJO.slice(0, -4)} y vck_abcdef012345`, json: { message: SIN_PREFIJO, lista: [SIN_PREFIJO], [SIN_PREFIJO]: 1 } }, SIN_PREFIJO);
    const todo = JSON.stringify(r);
    expect(todo).not.toContain(SIN_PREFIJO.slice(0, 20));
    expect(todo).not.toContain("vck_abcdef012345");
    expect(r.codigo).toBe(1);
  });
  it("de punta a punta: una clave SIN prefijo conocido que vuelve en una excepción (sólo el barrido la salva)", async () => {
    const m = armar({ env: { K: SIN_PREFIJO } });
    m.d.ponerCuenta = async () => { throw new Error(`boom ${SIN_PREFIJO} y ${SIN_PREFIJO.slice(0, -4)}`); };
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(loQueSale(r, m.stderr)).not.toContain(SIN_PREFIJO.slice(0, 20));
  });
});

describe("revisión 1, P3-3: una clave demasiado corta se rechaza antes de llamar al motor (no deja el texto ilegible)", () => {
  it("menos de 8 caracteres → 3 clave_con_forma_invalida, sin llamar", async () => {
    for (const via of ["env", "tty"] as const) {
      const m = armar(via === "env" ? { env: { K: "e" } } : { tty: true, teclado: "abcdefg" });
      const r = await agentesPonerClave(m.d, { ...F, fromEnv: via === "env" ? "K" : null } as never);
      expect(r, via).toMatchObject({ codigo: SALIDA.entradaInvalida, json: { error: "clave_con_forma_invalida" } });
      expect(r.texto).toMatch(/too short/);
      expect(m.llamadas).toEqual([]);
    }
  });
  it("ocho caracteres ya pasan (el motor decide la forma)", async () => {
    const m = armar({ env: { K: "abcdefgh" }, respuestas: [structuredClone(LISTA)] });
    expect((await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never)).codigo).toBe(SALIDA.ok);
  });
});

describe("revisión 1, P3-4: `idSeguro` y `puesta_por` frenan una clave toda en minúsculas (sin mayúsculas que la delaten)", () => {
  const MINUSCULA = "vck_abcdef0123456789abcdef0123456789";
  it("en codigo, proveedor, estado y puesta_por de `show`", async () => {
    const cuentaMala = cuenta("chat", { proveedor: MINUSCULA, codigo: MINUSCULA, puesta_por: MINUSCULA });
    const m = armar({ respuestas: [{ status: 200, cuerpo: { cuentas: [{ agente: "chat", estado: "lista", cuenta_lista: true, cuenta: cuentaMala }] } }] });
    const r = await agentesVer(m.d, { ...F, agent: null } as never);
    const todo = loQueSale(r, m.stderr);
    expect(todo).not.toContain("abcdef0123456789");
    expect(r.json).toMatchObject({ agentes: [{ cuenta: { proveedor: null, codigo: null, puesta_por: null } }] });
  });
  it("en el código del motor (`error`) de un rechazo", async () => {
    const m = armar({ respuestas: [{ status: 422, cuerpo: { error: MINUSCULA, codigo: MINUSCULA, message: "x" } }], env: { K: CLAVE } });
    const r = await agentesPonerClave(m.d, { ...F, fromEnv: "K" } as never);
    expect(loQueSale(r, m.stderr)).not.toContain("abcdef0123456789");
  });
});

describe("revisión 1, P2-2: `variable_vacia` no manda a escribir la clave en el historial del shell", () => {
  it("el mensaje habla de un secreto de CI o de cargarla sin eco, no de `export NOMBRE=clave`", async () => {
    const r = await agentesPonerClave(armar({ env: {} }).d, { ...F, fromEnv: "K" } as never);
    expect(r.texto).toMatch(/read -rs K/);
    expect(r.texto).toMatch(/CI/);
    expect(r.texto).not.toMatch(/export K=/);
  });
});
