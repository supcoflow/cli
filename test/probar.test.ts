// `diagnosticar` y `probar` contra un motor falso guionado (bloque 7). El registro de lo guardado es el
// REAL (src/pruebas-guardadas.ts) sobre un almacén en memoria: lo que se prueba es el ciclo de la clave.
import { describe, expect, it } from "vitest";
import type { Diagnostico, IntentoDePrueba, RespuestaDePrueba, Seguimiento } from "../src/api.ts";
import { diagnosticar, probar, type DepsDePrueba } from "../src/comandos/probar.ts";
import { FalloDeLaTerminal, SALIDA } from "../src/contrato.ts";
import type { Almacen, Registro } from "../src/guardado/index.ts";
import { crearRegistroDePruebas } from "../src/pruebas-guardadas.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const RUTA = `/api/proyectos/${PROY.id}/pruebas`;

const DIAG: Diagnostico = {
  listo: true,
  puntos: [
    { punto: "instalacion", ok: true, mensaje: "La instalación de GitHub no reporta problemas." },
    { punto: "chat", ok: true, mensaje: "El chat de soporte está prendido." },
    { punto: "despachos", ok: true, mensaje: "Los despachos están activos." },
  ],
  politica: "relevar", techoUsd: 2, saldoUsd: 7.5, topeUsd: 10, comprometidoUsd: 2.5, pruebaAbierta: null,
};

// El motor falso: la Idempotency-Key devuelve la misma prueba (como la clave natural del motor), una
// prueba abierta por proyecto, y el techo que se autoriza tiene que ser el vigente.
function motor() {
  return {
    posts: [] as { key: string; mensaje: string | null; techoUsd: number }[],
    pruebas: new Map<string, { id: string; mensaje: string | null; techoUsd: number }>(),
    diagnosticos: 0,
    abierta: null as string | null,
    techoVigente: 2,
    // Lo que hace cada POST, en orden: `normal`, `pierde` (crea y no contesta), o una respuesta fija.
    guion: [] as ("normal" | "pierde" | RespuestaDePrueba)[],
    seguimientos: [] as Seguimiento[],
    gets: [] as string[],
    siguiente: 0,
  };
}
type Motor = ReturnType<typeof motor>;

function memoria(): Almacen & { datos: Map<string, Registro>; romper: (valor: string) => boolean } {
  const datos = new Map<string, Registro>();
  const a = {
    nombre: "archivo" as const, datos, romper: (_v: string) => false,
    async leer(c: string) { return datos.get(c) ?? null; },
    async escribir(c: string, r: Registro) { if (a.romper(r.valor)) throw new Error("disco"); datos.set(c, r); },
    async borrar(c: string) { datos.delete(c); },
  };
  return a;
}

function deps(m: Motor, almacen = memoria(), o: Partial<DepsDePrueba> = {}) {
  let reloj = 0;
  let clave = 0;
  const avisos: string[] = [];
  const d: DepsDePrueba = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerDiagnostico: async () => { m.diagnosticos++; return { ...DIAG, pruebaAbierta: m.abierta }; },
    pedirPrueba: async (_a, _c, proyectoId, intento: IntentoDePrueba) => {
      expect(proyectoId).toBe(PROY.id);
      m.posts.push({ key: intento.clave, mensaje: intento.mensaje, techoUsd: intento.techoUsd });
      const paso = m.guion.shift() ?? "normal";
      if (typeof paso === "object") return paso;
      const ya = m.pruebas.get(intento.clave);
      let id: string;
      if (ya) {
        if (ya.mensaje !== intento.mensaje || ya.techoUsd !== intento.techoUsd) {
          return { tipo: "rechazo", status: 409, error: "idempotency_key_reusada", message: "Otra.", cuerpo: {} };
        }
        id = ya.id;
      } else {
        if (intento.techoUsd !== m.techoVigente) return { tipo: "rechazo", status: 409, error: "techo_distinto", message: "Otro techo.", cuerpo: { techo_usd: m.techoVigente } };
        if (m.abierta !== null) return { tipo: "rechazo", status: 409, error: "prueba_en_curso", message: "Hay otra.", cuerpo: { prueba_id: m.abierta } };
        id = `prb_${String(++m.siguiente).padStart(16, "0")}`;
        m.pruebas.set(intento.clave, { id, mensaje: intento.mensaje, techoUsd: intento.techoUsd });
        m.abierta = id;
      }
      if (paso === "pierde") return { tipo: "ambigua", error: "motor_inalcanzable", message: "No pude comunicarme con el motor (red caída o demora)." };
      return { tipo: "aceptada", pruebaId: id, reporteId: `rep_${id}`, estado: "creada" };
    },
    leerPrueba: async (_a, _c, _p, pruebaId) => {
      m.gets.push(pruebaId);
      const s = m.seguimientos.shift();
      if (!s) throw new Error("el guion se quedó sin respuestas");
      return s;
    },
    pruebas: crearRegistroDePruebas({
      origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/pruebas.json",
      fs: { realpath: (p) => p, existe: () => false }, ahora: () => 1, avisar: () => {},
    }),
    generar: () => `clave-${++clave}`,
    ahora: () => reloj,
    dormir: async (ms) => { reloj += ms; },
    avisar: (s) => void avisos.push(s),
    ...o,
  };
  return { d, avisos, almacen };
}

const F = { repo: null, autorizoGasto: false, dryRun: false, mensaje: null as string | null, wait: false, prueba: null as string | null };
const AUT = { ...F, autorizoGasto: true };
const desenlace = (m: Motor) => { m.abierta = null; };

function seg(estado: string, o: Partial<Seguimiento> = {}): Seguimiento {
  return {
    pruebaId: "prb_0000000000000001", estado, abierta: estado === "en_curso" || estado === "creada", mensaje: `mensaje de ${estado}`,
    reporte: { id: "rep_1", url: "https://app.supcoflow.dev/proyectos/r/reportes/rep_1" },
    run: { id: "run_1", status: estado === "en_curso" ? "running" : "completed", motivo: null },
    issue: null,
    cobro: { estado: null, usd: null, techo_usd: 2 },
    ...o,
  };
}

describe("diagnosticar", () => {
  it("0 si está listo, con todos los puntos que mande el motor (sin lista fija de nombres)", async () => {
    const m = motor();
    const { d } = deps(m, undefined, {
      leerDiagnostico: async () => ({ ...DIAG, puntos: [...DIAG.puntos, { punto: "algo_nuevo", ok: true, mensaje: "Un punto que esta terminal no conoce." }] }),
    });
    const r = await diagnosticar(d, { repo: null });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ ok: true, listo: true, techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, politica: "relevar", prueba_abierta: null });
    expect((r.json.puntos as unknown[]).length).toBe(4);
    expect(r.texto).toContain("Un punto que esta terminal no conoce.");
  });

  it("4 si algo no está listo, y el texto marca qué", async () => {
    const m = motor();
    const { d } = deps(m, undefined, {
      leerDiagnostico: async () => ({ ...DIAG, listo: false, puntos: [...DIAG.puntos, { punto: "sitios", ok: false, mensaje: "La lista de sitios está vacía." }] }),
    });
    const r = await diagnosticar(d, { repo: null });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "no_listo", listo: false });
    expect(r.texto).toMatch(/sitios.*vacía/);
  });

  it("un fallo del motor sale con su código (2 sin clave válida)", async () => {
    const m = motor();
    const { d } = deps(m, undefined, { leerDiagnostico: async () => { throw new FalloDeLaTerminal(SALIDA.faltaLogin, "clave_invalida", "La clave ya no vale."); } });
    expect((await diagnosticar(d, { repo: null })).codigo).toBe(SALIDA.faltaLogin);
  });
});

describe("probar sin el flag no gasta (R6) y --dry-run tampoco (R7)", () => {
  it("R6: sin --autorizo-gasto sale 4 con techo, saldo, tope y comprometido del diagnóstico, y 0 POST", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    const r = await probar(d, F);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "falta_autorizacion", techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, politica: "relevar" });
    expect(r.texto).toContain("--autorizo-gasto");
    expect(r.texto).toContain("US$ 2.00");
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("R6: con --mensaje y sin el flag, igual: 4 y nada guardado", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    expect((await probar(d, { ...F, mensaje: "hola" })).codigo).toBe(4);
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("R7: --dry-run --autorizo-gasto sale 0 diciendo proyecto, techo, saldo y política, sin POST ni nada guardado", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    const r = await probar(d, { ...AUT, dryRun: true });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ ok: true, dry_run: true, proyecto: { id: PROY.id, repo: "d/r" }, techo_usd: 2, saldo_usd: 7.5, politica: "relevar" });
    expect(String(r.json.haria)).toContain(`POST ${RUTA}`);
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("con política guardar, el texto sin flag dice que no gasta", async () => {
    const m = motor();
    const { d } = deps(m, undefined, { leerDiagnostico: async () => ({ ...DIAG, politica: "guardar" }) });
    const r = await probar(d, F);
    expect(r.codigo).toBe(4);
    expect(r.texto).toMatch(/guardar/);
  });

  it("un --mensaje vacío o enorme sale 3 sin pedir nada", async () => {
    for (const mensaje of ["   ", "x".repeat(20_001)]) {
      const m = motor();
      const { d } = deps(m);
      const r = await probar(d, { ...AUT, mensaje });
      expect(r.codigo, mensaje.slice(0, 5)).toBe(SALIDA.entradaInvalida);
      expect(r.json.error).toBe("mensaje_invalido");
      expect(m.posts).toEqual([]);
      expect(m.diagnosticos).toBe(0);
    }
  });
});

describe("probar --autorizo-gasto: el ciclo de la clave", () => {
  it("la primera vez: diagnóstico para el techo, intento guardado ANTES del POST, 202 → 5 con el id, la última queda y el intento se cierra", async () => {
    const m = motor();
    const { d } = deps(m);
    let guardadoAntes = false;
    const pedir = d.pedirPrueba;
    d.pedirPrueba = async (...a) => { guardadoAntes = (await d.pruebas.leer(PROY.id)).intento?.clave === a[3].clave; return pedir(...a); };
    const r = await probar(d, AUT);
    expect(guardadoAntes).toBe(true);
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(r.json).toMatchObject({ prueba_id: "prb_0000000000000001", reporte_id: "rep_prb_0000000000000001", estado: "creada" });
    expect(r.texto).toContain("probar --wait");
    expect(m.posts).toEqual([{ key: "clave-1", mensaje: null, techoUsd: 2 }]);
    expect(await d.pruebas.leer(PROY.id)).toEqual({ intento: null, ultima: "prb_0000000000000001" });
  });

  it("estricto: si el intento no se puede guardar, no se manda nada (sale 1)", async () => {
    const m = motor();
    const almacen = memoria();
    almacen.romper = () => true;
    const { d } = deps(m, almacen);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json.error).toBe("prueba_no_guardada");
    expect(m.posts).toEqual([]);
  });

  it("R14c: respuesta perdida → el próximo manda la MISMA clave con el mismo mensaje y techo; 2 POST, 1 prueba, la última = esa", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    const primero = await probar(d, { ...AUT, mensaje: "Mi propio caso" });
    expect(primero.codigo).toBe(SALIDA.inesperado);
    expect(primero.json).toMatchObject({ error: "motor_inalcanzable", intento_pendiente: true });
    const segundo = await probar(d, AUT); // sin --mensaje: recupera el guardado
    expect(segundo.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts).toEqual([
      { key: "clave-1", mensaje: "Mi propio caso", techoUsd: 2 },
      { key: "clave-1", mensaje: "Mi propio caso", techoUsd: 2 },
    ]);
    expect(m.pruebas.size).toBe(1);
    expect(m.diagnosticos).toBe(1); // el reintento no vuelve a preguntar el techo: manda el guardado
    expect(await d.pruebas.leer(PROY.id)).toEqual({ intento: null, ultima: "prb_0000000000000001" });
  });

  it("R14d: tras un 202 falla guardar el id → sale 1 mostrando el id, el intento sigue; el próximo reenvía la misma clave y lo guarda", async () => {
    const m = motor();
    const almacen = memoria();
    almacen.romper = (valor) => valor.includes("prb_");
    const { d } = deps(m, almacen);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json).toMatchObject({ error: "prueba_no_guardada", prueba_id: "prb_0000000000000001" });
    expect(r.texto).toContain("prb_0000000000000001");
    expect((await d.pruebas.leer(PROY.id)).intento?.clave).toBe("clave-1");
    almacen.romper = () => false;
    const otra = await probar(d, AUT);
    expect(otra.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(otra.json.prueba_id).toBe("prb_0000000000000001");
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
    expect(m.pruebas.size).toBe(1);
    expect(await d.pruebas.leer(PROY.id)).toEqual({ intento: null, ultima: "prb_0000000000000001" });
  });

  it("R14e (a): después de un desenlace, el MISMO mensaje con una clave NUEVA crea otra prueba", async () => {
    const m = motor();
    const { d } = deps(m);
    await probar(d, { ...AUT, mensaje: "igual" });
    desenlace(m);
    const r = await probar(d, { ...AUT, mensaje: "igual" });
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.pruebas.size).toBe(2);
    expect(new Set(m.posts.map((p) => p.key)).size).toBe(2);
    expect(await d.pruebas.leer(PROY.id)).toEqual({ intento: null, ultima: "prb_0000000000000002" });
  });

  it("R14e (b): con un intento abierto, otro --mensaje sale 4 intento_pendiente con 0 POST; sin --mensaje reenvía el guardado", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    await probar(d, AUT);
    const antes = m.posts.length;
    const r = await probar(d, { ...AUT, mensaje: "otro" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("intento_pendiente");
    expect(r.texto).toContain("sin `--mensaje`");
    expect(m.posts.length).toBe(antes);
    const sin = await probar(d, AUT);
    expect(sin.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
    expect(m.posts[1]!.mensaje).toBeNull();
  });

  it("con la prueba anterior abierta (según el diagnóstico) sale 4 prueba_en_curso con su id, sin POST", async () => {
    const m = motor();
    m.abierta = "prb_ffffffffffffffff";
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ error: "prueba_en_curso", prueba_id: "prb_ffffffffffffffff" });
    expect(r.texto).toContain("probar --wait --prueba prb_ffffffffffffffff");
    expect(m.posts).toEqual([]);
  });

  const rechazos: [string, RespuestaDePrueba, number, Record<string, unknown>][] = [
    ["409 prueba_en_curso", { tipo: "rechazo", status: 409, error: "prueba_en_curso", message: "Hay otra.", cuerpo: { prueba_id: "prb_eeeeeeeeeeeeeeee" } }, 4, { prueba_id: "prb_eeeeeeeeeeeeeeee" }],
    ["409 techo_distinto", { tipo: "rechazo", status: 409, error: "techo_distinto", message: "Otro techo.", cuerpo: { techo_usd: 3 } }, 4, { techo_usd: 3 }],
    ["409 chat_deshabilitado", { tipo: "rechazo", status: 409, error: "chat_deshabilitado", message: "Apagado.", cuerpo: {} }, 4, {}],
    ["429 tope_mensual", { tipo: "rechazo", status: 429, error: "tope_mensual", message: "Tope.", cuerpo: { comprometido_usd: 9.5, tope_usd: 10 } }, 6, { comprometido_usd: 9.5, tope_usd: 10 }],
    ["403 requiere_api_key", { tipo: "rechazo", status: 403, error: "requiere_api_key", message: "Con la API key.", cuerpo: {} }, 4, {}],
    ["403 clave_de_consulta", { tipo: "rechazo", status: 403, error: "clave_de_consulta", message: "Sólo lee.", cuerpo: {} }, 4, {}],
    ["400 falta_idempotency_key", { tipo: "rechazo", status: 400, error: "falta_idempotency_key", message: "Falta.", cuerpo: {} }, 3, {}],
    ["404", { tipo: "rechazo", status: 404, error: "proyecto_inexistente", message: "No existe.", cuerpo: {} }, 3, {}],
    ["401", { tipo: "rechazo", status: 401, error: "clave_invalida", message: "La clave ya no vale.", cuerpo: {} }, 2, {}],
    ["409 idempotency_key_reusada", { tipo: "rechazo", status: 409, error: "idempotency_key_reusada", message: "Otra.", cuerpo: {} }, 1, {}],
  ];
  it.each(rechazos)("un rechazo definitivo (%s) cierra el intento y sale %i", async (_n, respuesta, codigo, extra) => {
    const m = motor();
    m.guion = [respuesta];
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(codigo);
    expect(r.json).toMatchObject({ ok: false, error: (respuesta as { error: string }).error, ...extra });
    expect((await d.pruebas.leer(PROY.id)).intento).toBeNull();
    // Cerrado: el próximo comando es una prueba nueva, con otra clave.
    await probar(d, AUT);
    expect(m.posts[1]!.key).not.toBe(m.posts[0]!.key);
  });

  it("requiere_api_key lo explica: la prueba va con la API key personal de `supcoflow login`", async () => {
    const m = motor();
    m.guion = [{ tipo: "rechazo", status: 403, error: "requiere_api_key", message: "x", cuerpo: {} }];
    const { d } = deps(m);
    expect((await probar(d, AUT)).texto).toMatch(/API key personal/);
  });

  it.each([
    ["503 despachos_en_pausa", { tipo: "ambigua", error: "despachos_en_pausa", message: "Estamos actualizando el motor." }],
    ["5xx", { tipo: "ambigua", error: "motor_inalcanzable", message: "El motor respondió 502." }],
    ["409 idempotency_en_curso", { tipo: "ambigua", error: "idempotency_en_curso", message: "Otro intento." }],
  ] as [string, RespuestaDePrueba][])("una respuesta ambigua (%s) conserva el intento: el próximo manda la misma clave", async (_n, respuesta) => {
    const m = motor();
    m.guion = [respuesta];
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json).toMatchObject({ error: (respuesta as { error: string }).error, intento_pendiente: true });
    expect(r.texto).toContain("probar --autorizo-gasto");
    await probar(d, AUT);
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
  });
});

describe("probar --wait (R25)", () => {
  const W = { ...F, wait: true };
  const tramoCorto = { tramoMs: 3_000 }; // un solo sondeo por llamada: cada `--wait` es una vuelta del guion

  async function conPrueba(m: Motor, o: Partial<DepsDePrueba> = {}) {
    const x = deps(m, undefined, { ...tramoCorto, ...o });
    await probar(x.d, AUT);
    return x;
  }

  it("en_curso ×3 → 5 cada vez; después issue_creado con cobro pendiente → 0, mostrado como pendiente y nunca como 0", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [
      seg("en_curso"), seg("en_curso"), seg("en_curso"),
      seg("issue_creado", { issue: { numero: 42, url: "https://github.com/d/r/issues/42" }, cobro: { estado: "pendiente", usd: null, techo_usd: 2 } }),
    ];
    for (let i = 0; i < 3; i++) {
      const r = await probar(d, W);
      expect(r.codigo, `vuelta ${i}`).toBe(SALIDA.esperandoAUnaPersona);
      expect(r.json).toMatchObject({ estado: "en_curso", esperando: "relevamiento" });
    }
    const fin = await probar(d, W);
    expect(fin.codigo).toBe(SALIDA.ok);
    expect(fin.json).toMatchObject({ ok: true, estado: "issue_creado", issue: { numero: 42, url: "https://github.com/d/r/issues/42" }, cobro: { estado: "pendiente", usd: null, techo_usd: 2 } });
    expect(fin.texto).toContain("https://github.com/d/r/issues/42");
    expect(fin.texto).toMatch(/pendiente/);
    expect(fin.texto).not.toMatch(/US\$ 0\.00/);
    expect(m.gets).toEqual(Array(4).fill("prb_0000000000000001"));
  });

  it("con cobro perdido, ídem: perdido y con el techo como cota, nunca 0", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg("issue_creado", { issue: { numero: 7, url: "https://github.com/d/r/issues/7" }, cobro: { estado: "perdido", usd: null, techo_usd: 2 } })];
    const r = await probar(d, W);
    expect(r.codigo).toBe(0);
    expect(r.json.cobro).toEqual({ estado: "perdido", usd: null, techo_usd: 2 });
    expect(r.texto).toMatch(/perdido/);
    expect(r.texto).toContain("US$ 2.00");
    expect(r.texto).not.toMatch(/US\$ 0\.00/);
  });

  it("con cobro leído muestra el monto", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg("issue_creado", { issue: { numero: 7, url: "https://github.com/d/r/issues/7" }, cobro: { estado: "leido", usd: 0.83, techo_usd: 2 } })];
    expect((await probar(d, W)).texto).toContain("US$ 0.83");
  });

  it("arranque_incierto → 4 con el enlace a la bandeja", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg("arranque_incierto", { run: null })];
    const r = await probar(d, W);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "arranque_incierto", reporte: { url: "https://app.supcoflow.dev/proyectos/r/reportes/rep_1" } });
    expect(r.texto).toContain("https://app.supcoflow.dev/proyectos/r/reportes/rep_1");
  });

  it("fallido → 4 con el motivo y el cobro", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg("fallido", { run: { id: "run_1", status: "failed", motivo: "canal_perdido" }, cobro: { estado: "pendiente", usd: null, techo_usd: 2 } })];
    const r = await probar(d, W);
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ error: "fallido", run: { motivo: "canal_perdido" } });
    expect(r.texto).toContain("canal_perdido");
    expect(r.texto).toMatch(/pendiente/);
  });

  it.each([
    ["creada", 5], ["guardado", 0], ["issue_con_cierre_anomalo", 4], ["cierre_sin_evidencia", 4],
    ["reclamado_sin_run", 4], ["esperando_cupo", 4], ["sin_despacho", 4],
  ] as [string, number][])("%s → %i (la tabla de la prueba)", async (estado, codigo) => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg(estado)];
    expect((await probar(d, W)).codigo).toBe(codigo);
  });

  it("un estado que esta terminal no conoce sale 1 estado_desconocido, con el estado", async () => {
    const m = motor();
    const { d } = await conPrueba(m);
    m.seguimientos = [seg("algo_nuevo")];
    const r = await probar(d, W);
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ error: "estado_desconocido", estado: "algo_nuevo" });
  });

  it("dentro del tramo sigue sondeando mientras esté en curso, y nunca pasa de 90 s", async () => {
    const m = motor();
    const { d } = await conPrueba(m, { tramoMs: 1_000_000 });
    m.seguimientos = Array.from({ length: 100 }, () => seg("en_curso"));
    const inicio = d.ahora();
    const r = await probar(d, W);
    expect(r.codigo).toBe(5);
    expect(d.ahora() - inicio).toBeLessThanOrEqual(90_000);
    expect(m.gets.length).toBeGreaterThan(1);
  });

  it("--prueba elige otra; sin ninguna guardada ni --prueba sale 3 sin_prueba sin pedir nada", async () => {
    const m = motor();
    const { d } = deps(m, undefined, tramoCorto);
    const sin = await probar(d, W);
    expect(sin.codigo).toBe(SALIDA.entradaInvalida);
    expect(sin.json.error).toBe("sin_prueba");
    expect(m.gets).toEqual([]);
    m.seguimientos = [seg("en_curso")];
    await probar(d, { ...W, prueba: "prb_abcdefabcdefabcd" });
    expect(m.gets).toEqual(["prb_abcdefabcdefabcd"]);
  });

  it("--prueba con otra forma sale 3 sin pedir nada", async () => {
    const m = motor();
    const { d } = deps(m, undefined, tramoCorto);
    const r = await probar(d, { ...W, prueba: "../../yo" });
    expect(r.codigo).toBe(3);
    expect(r.json.error).toBe("prueba_invalida");
    expect(m.gets).toEqual([]);
  });

  it("con un pedido sin confirmar y sin última, --wait sale 4 intento_pendiente", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m, undefined, tramoCorto);
    await probar(d, AUT);
    const r = await probar(d, W);
    expect(r.codigo).toBe(4);
    expect(r.json.error).toBe("intento_pendiente");
    expect(m.gets).toEqual([]);
  });

  it("con una última ya cerrada y un pedido nuevo sin confirmar, --wait sale 4 intento_pendiente sin seguir la vieja; --prueba explícito sí la sigue", async () => {
    const m = motor();
    const { d } = deps(m, undefined, tramoCorto);
    await probar(d, AUT); // prb_…1 confirmada como última
    desenlace(m);
    m.guion = ["pierde"];
    await probar(d, AUT); // el pedido nuevo pierde la respuesta: intento abierto, última = prb_…1
    expect(await d.pruebas.leer(PROY.id)).toMatchObject({ ultima: "prb_0000000000000001", intento: { clave: "clave-2" } });
    m.seguimientos = [seg("issue_creado", { issue: { numero: 1, url: "https://github.com/d/r/issues/1" } })];
    const r = await probar(d, W);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("intento_pendiente");
    expect(m.gets).toEqual([]);
    const explicita = await probar(d, { ...W, prueba: "prb_0000000000000001" });
    expect(explicita.codigo).toBe(SALIDA.ok);
    expect(m.gets).toEqual(["prb_0000000000000001"]);
  });

  it("--wait no se combina con --autorizo-gasto ni con --mensaje; --prueba es sólo de --wait (3, sin pedir nada)", async () => {
    for (const f of [{ ...W, autorizoGasto: true }, { ...W, mensaje: "x" }, { ...F, prueba: "prb_abcdefabcdefabcd" }]) {
      const m = motor();
      const { d } = deps(m, undefined, tramoCorto);
      const r = await probar(d, f);
      expect(r.codigo).toBe(3);
      expect(m.posts).toEqual([]);
      expect(m.gets).toEqual([]);
      expect(m.diagnosticos).toBe(0);
    }
  });
});
