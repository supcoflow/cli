// `diagnose` y `test` contra un motor falso guionado (bloque 7). El registro de lo guardado es el
// REAL (src/pruebas-guardadas.ts) sobre un almacén en memoria: lo que se prueba es el ciclo de la clave.
import { describe, expect, it } from "vitest";
import type { Diagnostico, IntentoDePrueba, RespuestaDePrueba, Seguimiento } from "../src/api.ts";
import { leerArgumentos } from "../src/argumentos.ts";
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
    { punto: "instalacion", ok: true, mensaje: "La instalación de GitHub no reporta problemas.", grupo: "instalacion" },
    { punto: "sitios", ok: true, mensaje: "1 sitio(s) admitido(s) para el chat.", grupo: "instalacion" },
    { punto: "chat", ok: true, mensaje: "El chat de soporte está prendido.", grupo: "instalacion" },
    { punto: "guia", ok: true, mensaje: "Hay una guía vigente del producto.", grupo: "instalacion" },
    { punto: "despachos", ok: true, mensaje: "Los despachos están activos.", grupo: "prueba" },
  ],
  politica: "relevar", techoUsd: 2, saldoUsd: 7.5, topeUsd: 10, comprometidoUsd: 2.5, pruebaAbierta: null,
};

// El motor falso: la Idempotency-Key devuelve la misma prueba (como la clave natural del motor), una
// prueba abierta por proyecto, y el techo que se autoriza tiene que ser el vigente.
function motor() {
  return {
    posts: [] as { key: string; mensaje: string | null; techoUsd: number; politicaEsperada: "relevar" | "guardar" | null }[],
    pruebas: new Map<string, { id: string; mensaje: string | null; techoUsd: number; politicaEsperada: "relevar" | "guardar" | null }>(),
    diagnosticos: 0,
    abierta: null as string | null,
    techoVigente: 2,
    politicaVigente: "relevar" as "relevar" | "guardar",
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
    leerDiagnostico: async () => { m.diagnosticos++; return { ...DIAG, techoUsd: m.techoVigente, politica: m.politicaVigente, pruebaAbierta: m.abierta }; },
    pedirPrueba: async (_a, _c, proyectoId, intento: IntentoDePrueba) => {
      expect(proyectoId).toBe(PROY.id);
      m.posts.push({ key: intento.clave, mensaje: intento.mensaje, techoUsd: intento.techoUsd, politicaEsperada: intento.politicaEsperada });
      const paso = m.guion.shift() ?? "normal";
      if (typeof paso === "object") return paso;
      const ya = m.pruebas.get(intento.clave);
      let id: string;
      if (ya) {
        if (ya.mensaje !== intento.mensaje || ya.techoUsd !== intento.techoUsd || ya.politicaEsperada !== intento.politicaEsperada) {
          return { tipo: "rechazo", status: 409, error: "idempotency_key_reusada", message: "Otra.", cuerpo: {} };
        }
        id = ya.id;
      } else {
        if (intento.techoUsd !== m.techoVigente) return { tipo: "rechazo", status: 409, error: "techo_distinto", message: "Otro techo.", cuerpo: { techo_usd: m.techoVigente } };
        if (intento.politicaEsperada !== null && intento.politicaEsperada !== m.politicaVigente) return { tipo: "rechazo", status: 409, error: "politica_distinta", message: "Otra política.", cuerpo: { politica: m.politicaVigente } };
        if (m.abierta !== null) return { tipo: "rechazo", status: 409, error: "prueba_en_curso", message: "Hay otra.", cuerpo: { prueba_id: m.abierta } };
        id = `prb_${String(++m.siguiente).padStart(16, "0")}`;
        m.pruebas.set(intento.clave, { id, mensaje: intento.mensaje, techoUsd: intento.techoUsd, politicaEsperada: intento.politicaEsperada });
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
      ahora: () => 1, avisar: () => {},
    }),
    generar: () => `clave-${++clave}`,
    ahora: () => reloj,
    dormir: async (ms) => { reloj += ms; },
    avisar: (s) => void avisos.push(s),
    ...o,
  };
  return { d, avisos, almacen };
}

const F = {
  repo: null, authorizeSpend: false, dryRun: false, message: null as string | null, wait: false, testId: null as string | null,
  ceiling: null as string | null, expectPolicy: null as string | null,
};
// Lo que la persona vio y autorizó: el techo de US$ 2 y la política `investigate` (R5).
const AUT = { ...F, authorizeSpend: true, ceiling: "2", expectPolicy: "investigate" };
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

describe("diagnose", () => {
  const fuera = { git: async (args: string[]) => (args[0] === "rev-parse" ? { codigo: 128, stdout: "" } : { codigo: 128, stdout: "" }) };
  const otroOrigin = { git: async (args: string[]) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:otro/repo.git\n" }) };

  it("0 si está listo: «Checked … 7 of 7, at no cost.» y aparte «Ready for a test: yes.», con los puntos del motor", async () => {
    const m = motor();
    const { d } = deps(m, undefined, {
      leerDiagnostico: async () => ({ ...DIAG, puntos: [...DIAG.puntos, { punto: "algo_nuevo", ok: true, mensaje: "Un punto que esta terminal no conoce." }] }),
    });
    const r = await diagnosticar(d, { repo: null });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({
      ok: true, listo: true, techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, politica: "relevar", prueba_abierta: null,
      instalacion: { ok: 7, total: 7 }, prueba: { listo: true },
    });
    const lineas = r.texto.split("\n");
    expect(lineas[0]).toBe("Checked sign-in, repo, GitHub App, allowed sites, chat, guide and interface: 7 of 7, at no cost.");
    expect(lineas).toContain("Ready for a test: yes.");
    expect(r.texto).toContain("Un punto que esta terminal no conoce.");
    // «Ready for a test» va DESPUÉS de los seis y los puntos de la prueba después de esa línea.
    expect(lineas.indexOf("Ready for a test: yes.")).toBeGreaterThan(lineas.findIndex((l) => l.includes("guide:")));
    expect(lineas.findIndex((l) => l.includes("despachos"))).toBeGreaterThan(lineas.indexOf("Ready for a test: yes."));
  });

  it("el JSON: instalacion {ok, total: 7, puntos} con sign-in y repo locales primero, y prueba {listo, puntos}", async () => {
    const { d } = deps(motor());
    const r = await diagnosticar(d, { repo: null });
    const inst = r.json.instalacion as { ok: number; total: number; puntos: { punto: string; ok: boolean; grupo: string }[] };
    expect(inst.total).toBe(7);
    expect(inst.puntos.map((p) => p.punto)).toEqual(["sign-in", "repo", "instalacion", "sitios", "chat", "guia", "interfaz"]);
    expect(inst.puntos.every((p) => p.grupo === "instalacion" && p.ok)).toBe(true);
    const prueba = r.json.prueba as { listo: boolean; puntos: { punto: string }[] };
    // `maquina` es el punto local de la prueba (1A.1): va primero en su grupo y no cuenta en el «N of 7».
    expect(prueba.puntos.map((p) => p.punto)).toEqual(["maquina", "despachos"]);
    expect((r.json.puntos as unknown[]).length).toBe(7 + 2);
    expect(r.json).toMatchObject({ maquina: { ok: true, impedimentos: [] }, intento_pendiente: null });
  });

  it("agrupa por el nombre del punto si el motor viejo no manda `grupo`", async () => {
    const sinGrupo = DIAG.puntos.map(({ grupo: _g, ...p }) => p);
    const { d } = deps(motor(), undefined, { leerDiagnostico: async () => ({ ...DIAG, puntos: sinGrupo }) });
    const r = await diagnosticar(d, { repo: null });
    expect(r.json).toMatchObject({ instalacion: { ok: 7, total: 7 }, prueba: { listo: true } });
  });

  it("4 si el motor dice que no está listo: cuenta N of 7 sólo con los de la instalación, y el texto marca qué", async () => {
    const m = motor();
    const { d } = deps(m, undefined, {
      leerDiagnostico: async () => ({ ...DIAG, listo: false, puntos: DIAG.puntos.map((p) => (p.punto === "sitios" ? { ...p, ok: false, mensaje: "La lista de sitios está vacía." } : p)) }),
    });
    const r = await diagnosticar(d, { repo: null });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "no_listo", listo: false, instalacion: { ok: 6, total: 7 } });
    expect(r.texto).toContain("6 of 7, at no cost.");
    expect(r.texto).toMatch(/\[missing\] allowed sites: La lista de sitios está vacía\./);
    expect(r.texto).toMatch(/Ready for a test: no, because/);
  });

  it("un punto de la PRUEBA que falla no baja el N of 7, pero sí el «Ready for a test» y la salida 4", async () => {
    const { d } = deps(motor(), undefined, {
      leerDiagnostico: async () => ({ ...DIAG, listo: false, puntos: DIAG.puntos.map((p) => (p.punto === "despachos" ? { ...p, ok: false, mensaje: "Los despachos están en pausa." } : p)) }),
    });
    const r = await diagnosticar(d, { repo: null });
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ instalacion: { ok: 7, total: 7 }, prueba: { listo: false } });
    expect(r.texto).toContain("Ready for a test: no, because Los despachos están en pausa.");
  });

  it("sin git (--repo y la carpeta no es un repo): el punto repo no está ok, con el motivo, y la salida es 4 aunque el motor diga listo", async () => {
    const { d } = deps(motor(), undefined, fuera);
    const r = await diagnosticar(d, { repo: "d/r" });
    expect(r.codigo).toBe(4);
    expect(r.json).toMatchObject({ instalacion: { ok: 6, total: 7 }, listo: false, prueba: { listo: true } });
    expect(r.texto).toContain("[missing] repo: This folder isn't a git repo, so I can't tell which repo it is.");
    expect(r.texto).toContain("6 of 7");
  });

  it("el origin de la carpeta es otro repo que el del proyecto: repo no ok y se dice cuál es cuál", async () => {
    const { d } = deps(motor(), undefined, otroOrigin);
    const r = await diagnosticar(d, { repo: "d/r" });
    expect(r.codigo).toBe(4);
    expect(r.texto).toContain("The origin of this folder is otro/repo, not the project's repo d/r.");
    expect(r.json).toMatchObject({ instalacion: { ok: 6, total: 7 } });
  });

  it("el origin coincide sin importar mayúsculas", async () => {
    const { d } = deps(motor(), undefined, { git: async (a: string[]) => (a[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:D/R.git\n" }) });
    expect((await diagnosticar(d, { repo: null })).json).toMatchObject({ instalacion: { ok: 7 } });
  });

  it("un punto de la instalación que el motor no mandó no se da por bueno: cuenta como no ok", async () => {
    const { d } = deps(motor(), undefined, { leerDiagnostico: async () => ({ ...DIAG, puntos: DIAG.puntos.filter((p) => p.punto !== "guia") }) });
    const r = await diagnosticar(d, { repo: null });
    expect(r.json).toMatchObject({ instalacion: { ok: 6, total: 7 } });
    expect(r.texto).toContain("[missing] guide: The engine didn't report this point.");
  });

  it("un fallo del motor sale con su código (2 sin clave válida)", async () => {
    const m = motor();
    const { d } = deps(m, undefined, { leerDiagnostico: async () => { throw new FalloDeLaTerminal(SALIDA.faltaLogin, "clave_invalida", "La clave ya no vale."); } });
    expect((await diagnosticar(d, { repo: null })).codigo).toBe(SALIDA.faltaLogin);
  });

  it("no escribe nada ni pide pruebas: sólo lee el diagnóstico", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    await diagnosticar(d, { repo: null });
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
    expect(m.diagnosticos).toBe(1);
  });
});

// ─── T8: el séptimo punto de `diagnose` (la interfaz propia). Es local: lee `.supcoflow/instalacion.json` del clon y,
// si hay una interfaz propia anotada, mira que sus archivos sigan y que el contrato anotado sea el que declara el proyecto. ───
describe("diagnose: el punto 7, la interfaz", () => {
  const RAIZ = "/w/r";
  const INST = `${RAIZ}/.supcoflow/instalacion.json`;
  const instalacion = (o: object = {}) => JSON.stringify({
    version: 3, skill: "0.4.0", terminal: "0.9.0", chat: { declarado: "2.4.0", instalado: "2.4.0" },
    configuracion: { acuerdo_version: 1, politica: "relevar", guia: null },
    forma: "interfaz_propia", archivos: ["src/chat/panel.tsx", "src/chat/use-chat.ts"], contrato: "1.1.0", ...o,
  });
  const DEL_MOTOR = { paquete: "@supcoflow/chat" as const, version: "2.4.0", instalar: "x", tenant_id: "t", project_id: "p", backend_url: "https://chat.supcoflow.dev", csp: "c" };
  const widgetConContrato = (v: string | null) => async () => ({
    ...DEL_MOTOR, nextjs: { estado: "probando" as const, archivo_sugerido: "a", archivos_anteriores: [], contenido: "c", uso: "u" },
    script: { estado: "disponible_sin_soporte" as const, linea: "l" }, csp: "c",
    ...(v === null ? {} : { interfaz_propia: { ...DEL_MOTOR, contrato_version: v } }),
  });
  const archivos = (m: Record<string, string>) => ({ leer: (p: string) => m[p] ?? null });
  const fuera = { git: async () => ({ codigo: 128, stdout: "" }) };
  const TODOS = { [`${RAIZ}/src/chat/panel.tsx`]: "x", [`${RAIZ}/src/chat/use-chat.ts`]: "x" };
  async function punto(m: Record<string, string>, o: Partial<DepsDePrueba> = {}) {
    const { d } = deps(motor(), undefined, { archivos: archivos(m), ...o });
    const r = await diagnosticar(d, { repo: null });
    const inst = r.json.instalacion as { ok: number; total: number; puntos: { punto: string; ok: boolean; mensaje: string }[] };
    return { r, inst, p: inst.puntos.find((x) => x.punto === "interfaz")! };
  }

  it("sin instalacion.json, o con el widget, o sin forma: no aplica y cuenta bien (7 de 7)", async () => {
    for (const m of [{}, { [INST]: instalacion({ forma: "widget", archivos: ["app/x.tsx"], contrato: null }) }, { [INST]: instalacion({ forma: null, archivos: [], contrato: null }) }]) {
      const { p, inst } = await punto(m);
      expect(p, JSON.stringify(m)).toMatchObject({ ok: true, grupo: "instalacion" });
      expect(p.mensaje).toMatch(/^Not applicable/);
      expect(inst).toMatchObject({ ok: 7, total: 7 });
    }
  });
  it("un instalacion.json v2 con archivo (el widget de la 0.8.x) tampoco es una interfaz propia", async () => {
    const { p } = await punto({ [INST]: JSON.stringify({ version: 2, skill: "0.3.1", archivo: "app/_supcoflow/support-chat.tsx" }) });
    expect(p).toMatchObject({ ok: true });
    expect(p.mensaje).toMatch(/^Not applicable/);
  });
  it("interfaz propia con sus archivos y el contrato al día: ok, y dice cuántos archivos y qué contrato", async () => {
    const { p, inst } = await punto({ [INST]: instalacion(), ...TODOS }, { leerWidget: widgetConContrato("1.1.0") });
    expect(p.ok).toBe(true);
    expect(p.mensaje).toContain("2 files");
    expect(p.mensaje).toContain("contract 1.1.0");
    expect(inst).toMatchObject({ ok: 7, total: 7 });
  });
  it("un archivo anotado que ya no está: no ok, con el nombre del que falta", async () => {
    const { p, inst, r } = await punto({ [INST]: instalacion(), [`${RAIZ}/src/chat/panel.tsx`]: "x" }, { leerWidget: widgetConContrato("1.1.0") });
    expect(p.ok).toBe(false);
    expect(p.mensaje).toContain("src/chat/use-chat.ts");
    expect(p.mensaje).not.toContain("src/chat/panel.tsx");
    expect(inst).toMatchObject({ ok: 6, total: 7 });
    expect(r.texto).toContain("[missing] interface:");
  });
  it("interfaz propia sin archivos anotados, o sin contrato anotado: no ok", async () => {
    expect((await punto({ [INST]: instalacion({ archivos: [] }) })).p.ok).toBe(false);
    const sinContrato = (await punto({ [INST]: instalacion({ contrato: null }), ...TODOS })).p;
    expect(sinContrato.ok).toBe(false);
    expect(sinContrato.mensaje).toMatch(/contract/);
  });
  it("el proyecto declara un contrato más nuevo que el anotado: no ok, con los dos números y qué hacer", async () => {
    const { p } = await punto({ [INST]: instalacion(), ...TODOS }, { leerWidget: widgetConContrato("1.2.0") });
    expect(p.ok).toBe(false);
    expect(p.mensaje).toContain("1.1.0");
    expect(p.mensaje).toContain("1.2.0");
    expect(p.mensaje).toMatch(/skill/);
  });
  it("el proyecto declara el mismo contrato o uno más viejo, no lo declara, o no se pudo preguntar: ok (no se inventa una diferencia)", async () => {
    for (const leerWidget of [
      widgetConContrato("1.1.0"), widgetConContrato("1.0.0"), widgetConContrato(null),
      async () => { throw new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "no hay red"); },
    ]) {
      const { p } = await punto({ [INST]: instalacion(), ...TODOS }, { leerWidget });
      expect(p.ok, p.mensaje).toBe(true);
    }
    // Sin la dependencia (los tests viejos) tampoco se compara.
    expect((await punto({ [INST]: instalacion(), ...TODOS })).p.ok).toBe(true);
  });
  it("sólo pregunta el contrato al proyecto cuando hay una interfaz propia anotada", async () => {
    let pidio = 0;
    const leerWidget = async (...a: Parameters<NonNullable<DepsDePrueba["leerWidget"]>>) => { pidio++; return widgetConContrato("1.1.0")(); void a; };
    await punto({}, { leerWidget });
    await punto({ [INST]: instalacion({ forma: "widget" }) }, { leerWidget });
    expect(pidio).toBe(0);
    await punto({ [INST]: instalacion(), ...TODOS }, { leerWidget });
    expect(pidio).toBe(1);
  });
  it("un instalacion.json que no se lee: no ok, sin copiar su contenido", async () => {
    for (const malo of ["{no es json", "\u0000(unreadable)", `{"version":3,"x":"${CLAVE}`]) {
      const { p, r } = await punto({ [INST]: malo });
      expect(p.ok, malo).toBe(false);
      expect(JSON.stringify(r.json)).not.toContain(CLAVE);
    }
  });
  it("sin clon de esta carpeta (el origin no es el repo): no mira nada y no baja la cuenta por ahí", async () => {
    const { d } = deps(motor(), undefined, { ...fuera, archivos: archivos({ [INST]: instalacion() }) });
    const r = await diagnosticar(d, { repo: "d/r" });
    const p = (r.json.instalacion as { puntos: { punto: string; ok: boolean; mensaje: string }[] }).puntos.find((x) => x.punto === "interfaz")!;
    expect(p.ok).toBe(true);
    expect(p.mensaje).toMatch(/Not checked/);
  });
  it("un punto de la interfaz que falla es un aviso: no frena la prueba (listo y salida 0 siguen) pero sí baja el N of 7", async () => {
    const { r, inst } = await punto({ [INST]: instalacion() }); // los archivos no están
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ listo: true, prueba: { listo: true } });
    expect(inst.ok).toBe(6);
  });
  it("sólo lee: nada se escribe ni se pide una prueba", async () => {
    const m = motor();
    const { d, almacen } = deps(m, undefined, { archivos: archivos({ [INST]: instalacion(), ...TODOS }), leerWidget: widgetConContrato("1.1.0") });
    await diagnosticar(d, { repo: null });
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });
});

describe("test sin el flag no gasta (R6) y --dry-run tampoco (R7)", () => {
  it("R6: sin --authorize-spend sale 4 con techo, saldo, tope y comprometido del diagnóstico, y 0 POST; dice el comando exacto para lanzarla", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    const r = await probar(d, F);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "falta_autorizacion", techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, politica: "relevar" });
    expect(r.texto).toContain("`supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate`");
    expect(r.texto).toContain("US$ 2.00");
    expect(r.texto).toContain("monthly balance US$ 7.50 of US$ 10.00");
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("R6: con --message y sin el flag, igual: 4 y nada guardado", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    expect((await probar(d, { ...F, message: "hola" })).codigo).toBe(4);
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("R7: --dry-run --authorize-spend sale 0 diciendo proyecto, techo, saldo y política, y qué mandaría con lo AUTORIZADO, sin POST ni nada guardado", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    const r = await probar(d, { ...AUT, dryRun: true });
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toMatchObject({ ok: true, dry_run: true, proyecto: { id: PROY.id, repo: "d/r" }, techo_usd: 2, saldo_usd: 7.5, politica: "relevar" });
    expect(String(r.json.haria)).toContain(`POST ${RUTA}`);
    expect(String(r.json.haria)).toContain("techo_usd: 2, politica_esperada: relevar");
    expect(r.texto).toContain("With --dry-run I do nothing.");
    expect(m.posts).toEqual([]);
    expect(almacen.datos.size).toBe(0);
  });

  it("R7: el dry-run manda lo que se pasó en --ceiling aunque el motor tenga otro techo", async () => {
    const m = motor();
    m.techoVigente = 3;
    const { d } = deps(m);
    const r = await probar(d, { ...AUT, dryRun: true, ceiling: "2" });
    expect(String(r.json.haria)).toContain("techo_usd: 2,");
  });

  it("con política save, el texto sin flag dice que no gasta, y el comando a lanzar lleva --expect-policy save", async () => {
    const m = motor();
    m.politicaVigente = "guardar";
    const { d } = deps(m);
    const r = await probar(d, F);
    expect(r.codigo).toBe(4);
    expect(r.texto).toContain("With the `save` policy the test goes as far as the saved case and spends nothing");
    expect(r.texto).toContain("--expect-policy save");
  });

  it("un --message vacío o enorme sale 3 sin pedir nada", async () => {
    for (const message of ["   ", "x".repeat(20_001)]) {
      const m = motor();
      const { d } = deps(m);
      const r = await probar(d, { ...AUT, message });
      expect(r.codigo, message.slice(0, 5)).toBe(SALIDA.entradaInvalida);
      expect(r.json.error).toBe("mensaje_invalido");
      expect(m.posts).toEqual([]);
      expect(m.diagnosticos).toBe(0);
    }
  });
});

// ─── R5 (T3.1): lo que la persona vio es lo que viaja ───
describe("test --authorize-spend exige --ceiling y --expect-policy, y manda esos valores (R5)", () => {
  it("sin --ceiling: 3 falta_techo, sin diagnóstico, sin POST y sin guardar nada; el mensaje dice cómo pasarlo", async () => {
    const m = motor();
    const { d, almacen } = deps(m);
    const r = await probar(d, { ...F, authorizeSpend: true, expectPolicy: "investigate" });
    expect(r.codigo).toBe(SALIDA.entradaInvalida);
    expect(r.json.error).toBe("falta_techo");
    expect(r.texto).toContain("--ceiling <usd>");
    expect(m.posts).toEqual([]);
    expect(m.diagnosticos).toBe(0);
    expect(almacen.datos.size).toBe(0);
  });
  it("sin --expect-policy: 3 falta_politica, sin pedido", async () => {
    const m = motor();
    const { d } = deps(m);
    const r = await probar(d, { ...F, authorizeSpend: true, ceiling: "2" });
    expect(r.codigo).toBe(SALIDA.entradaInvalida);
    expect(r.json.error).toBe("falta_politica");
    expect(m.posts).toEqual([]);
  });
  it("--ceiling que no es un número positivo, o --expect-policy que no es investigate|save: 3, sin pedido", async () => {
    for (const [f, error] of [[{ ceiling: "abc" }, "techo_invalido"], [{ ceiling: "0" }, "techo_invalido"], [{ ceiling: "-1" }, "techo_invalido"], [{ ceiling: "2,5" }, "techo_invalido"],
      [{ ceiling: "1e3" }, "techo_invalido"], [{ expectPolicy: "otra" }, "politica_invalida"]] as const) {
      const m = motor();
      const { d } = deps(m);
      const r = await probar(d, { ...AUT, ...f });
      expect(r.codigo, JSON.stringify(f)).toBe(3);
      expect(r.json.error, JSON.stringify(f)).toBe(error);
      expect(m.posts).toEqual([]);
    }
  });
  it("--ceiling 2 con el motor en 2: el pedido lleva 2 y la política esperada `relevar` (investigate se traduce a la de la API)", async () => {
    const m = motor();
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts).toEqual([{ key: "clave-1", mensaje: null, techoUsd: 2, politicaEsperada: "relevar" }]);
  });
  it("--expect-policy save viaja como `guardar`", async () => {
    const m = motor();
    m.politicaVigente = "guardar";
    const { d } = deps(m);
    await probar(d, { ...AUT, expectPolicy: "save" });
    expect(m.posts[0]!.politicaEsperada).toBe("guardar");
  });
  it("NO relee el diagnóstico para elegir los valores: 0 lecturas en el camino autorizado", async () => {
    const m = motor();
    const { d } = deps(m);
    await probar(d, AUT);
    expect(m.diagnosticos).toBe(0);
  });
  it("con --ceiling 2 y un motor cuyo techo pasó a 3: el pedido LLEVA 2 y la salida es techo_distinto con el 3 en el JSON, sin reintentar", async () => {
    const m = motor();
    m.techoVigente = 3;
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(m.posts).toHaveLength(1);
    expect(m.posts[0]!.techoUsd).toBe(2);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "techo_distinto", techo_usd: 3, autorizado_usd: 2 });
    expect(r.texto).toBe("The ceiling for a test changed: it's now US$ 3.00, and you authorized US$ 2.00. Nothing was started. Ask again with the new number.");
    expect((await d.pruebas.leer(PROY.id)).intento).toBeNull();
    expect(m.pruebas.size).toBe(0);
  });
  it("con --expect-policy save y la política `relevar` del proyecto: politica_distinta con la política nueva, sin reintentar y sin prueba", async () => {
    const m = motor();
    const { d } = deps(m);
    const r = await probar(d, { ...AUT, expectPolicy: "save" });
    expect(m.posts).toHaveLength(1);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "politica_distinta", politica: "relevar", politica_esperada: "guardar" });
    expect(r.texto).toBe("The project's policy changed: it's now `investigate`, and you authorized a test under `save`. Nothing was started. Ask again with the current policy.");
    expect(m.pruebas.size).toBe(0);
    expect((await d.pruebas.leer(PROY.id)).intento).toBeNull();
  });
  it("politica_distinta sin la política en el cuerpo: igual sale 4 con el mensaje corto", async () => {
    const m = motor();
    m.guion = [{ tipo: "rechazo", status: 409, error: "politica_distinta", message: "x", cuerpo: {} }];
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.json).toMatchObject({ error: "politica_distinta", politica: null });
    expect(r.texto).toContain("The project's policy changed, and you authorized a test under `investigate`.");
  });
  it("el reintento tras una respuesta perdida manda el MISMO techo y la MISMA política guardados; otro --ceiling u otra --expect-policy sale 4 intento_pendiente sin POST", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    await probar(d, AUT);
    for (const f of [{ ceiling: "3" }, { expectPolicy: "save" }]) {
      const antes = m.posts.length;
      const r = await probar(d, { ...AUT, ...f });
      expect(r.codigo, JSON.stringify(f)).toBe(4);
      expect(r.json.error).toBe("intento_pendiente");
      expect(r.texto).toContain("`supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate`");
      expect(m.posts.length).toBe(antes);
    }
    const ok = await probar(d, AUT);
    expect(ok.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts.map((x) => [x.key, x.techoUsd, x.politicaEsperada])).toEqual([["clave-1", 2, "relevar"], ["clave-1", 2, "relevar"]]);
  });
  it("--ceiling 2.50 se manda como 2.5", async () => {
    const m = motor();
    m.techoVigente = 2.5;
    const { d } = deps(m);
    expect((await probar(d, { ...AUT, ceiling: "2.50" })).codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts[0]!.techoUsd).toBe(2.5);
  });
  it("--ceiling y --expect-policy sin --authorize-spend (ni --wait): 3 flags_incompatibles", async () => {
    for (const f of [{ ceiling: "2" }, { expectPolicy: "investigate" }]) {
      const { d } = deps(motor());
      expect(await probar(d, { ...F, ...f })).toMatchObject({ codigo: 3, json: { error: "flags_incompatibles" } });
    }
  });

  describe("el alias viejo `probar --autorizo-gasto` también exige --ceiling (un alias no puede ampliar lo autorizado)", () => {
    const V = { ...F, authorizeSpend: true, viejo: true };
    it("sin --ceiling: 3 falta_techo con un mensaje que dice cómo pasarlo y que la vieja es la 0.7.0; no manda nada", async () => {
      const m = motor();
      const { d, almacen } = deps(m);
      const r = await probar(d, V);
      expect(r.codigo).toBe(3);
      expect(r.json.error).toBe("falta_techo");
      expect(r.texto).toContain("`probar --autorizo-gasto` now needs --ceiling <usd>");
      expect(r.texto).toContain("`supcoflow test --authorize-spend --ceiling <usd> --expect-policy investigate|save`");
      expect(r.texto).toContain("supcoflow 0.7.0");
      expect(m.posts).toEqual([]);
      expect(m.diagnosticos).toBe(0);
      expect(almacen.datos.size).toBe(0);
    });
    it("con --ceiling pero sin --expect-policy: anda, y NO manda política (como la 0.7.0)", async () => {
      const m = motor();
      const { d } = deps(m);
      const r = await probar(d, { ...V, ceiling: "2" });
      expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
      expect(m.posts).toEqual([{ key: "clave-1", mensaje: null, techoUsd: 2, politicaEsperada: null }]);
    });
    it("el reintento del alias retoma el pedido guardado sin política", async () => {
      const m = motor();
      m.guion = ["pierde"];
      const { d } = deps(m);
      await probar(d, { ...V, ceiling: "2" });
      expect((await probar(d, { ...V, ceiling: "2" })).codigo).toBe(SALIDA.esperandoAUnaPersona);
      expect(m.pruebas.size).toBe(1);
    });
    it("con techo distinto del vigente: techo_distinto, igual que el comando nuevo", async () => {
      const m = motor();
      m.techoVigente = 3;
      const { d } = deps(m);
      expect((await probar(d, { ...V, ceiling: "2" })).json).toMatchObject({ error: "techo_distinto", techo_usd: 3 });
    });
  });
});

describe("test --authorize-spend: el ciclo de la clave", () => {
  it("la primera vez: sin leer el diagnóstico, intento guardado ANTES del POST, 202 → 5 con el id, la última queda y el intento se cierra", async () => {
    const m = motor();
    const { d } = deps(m);
    let guardadoAntes = false;
    const pedir = d.pedirPrueba;
    d.pedirPrueba = async (...a) => { guardadoAntes = (await d.pruebas.leer(PROY.id)).intento?.clave === a[3].clave; return pedir(...a); };
    const r = await probar(d, AUT);
    expect(guardadoAntes).toBe(true);
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(r.json).toMatchObject({ prueba_id: "prb_0000000000000001", reporte_id: "rep_prb_0000000000000001", estado: "creada" });
    expect(r.texto).toBe("Test prb_0000000000000001 requested (creada). Follow it with `supcoflow test --wait`.");
    expect(m.posts).toEqual([{ key: "clave-1", mensaje: null, techoUsd: 2, politicaEsperada: "relevar" }]);
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
    const primero = await probar(d, { ...AUT, message: "Mi propio caso" });
    expect(primero.codigo).toBe(SALIDA.inesperado);
    expect(primero.json).toMatchObject({ error: "motor_inalcanzable", intento_pendiente: true });
    const segundo = await probar(d, AUT); // sin --message: recupera el guardado
    expect(segundo.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts).toEqual([
      { key: "clave-1", mensaje: "Mi propio caso", techoUsd: 2, politicaEsperada: "relevar" },
      { key: "clave-1", mensaje: "Mi propio caso", techoUsd: 2, politicaEsperada: "relevar" },
    ]);
    expect(m.pruebas.size).toBe(1);
    expect(m.diagnosticos).toBe(0); // nunca se pregunta el techo: se manda lo autorizado y, en el reintento, lo guardado
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
    await probar(d, { ...AUT, message: "igual" });
    desenlace(m);
    const r = await probar(d, { ...AUT, message: "igual" });
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.pruebas.size).toBe(2);
    expect(new Set(m.posts.map((p) => p.key)).size).toBe(2);
    expect(await d.pruebas.leer(PROY.id)).toEqual({ intento: null, ultima: "prb_0000000000000002" });
  });

  it("R14e (b): con un intento abierto, otro --message sale 4 intento_pendiente con 0 POST; sin --message reenvía el guardado", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    await probar(d, AUT);
    const antes = m.posts.length;
    const r = await probar(d, { ...AUT, message: "otro" });
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json.error).toBe("intento_pendiente");
    expect(r.texto).toContain("without --message");
    expect(m.posts.length).toBe(antes);
    const sin = await probar(d, AUT);
    expect(sin.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
    expect(m.posts[1]!.mensaje).toBeNull();
  });

  it("con una prueba anterior abierta, el motor contesta prueba_en_curso: sale 4 con su id, el intento se cierra y no se creó otra", async () => {
    const m = motor();
    m.abierta = "prb_ffffffffffffffff";
    const { d } = deps(m);
    const r = await probar(d, AUT);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ error: "prueba_en_curso", prueba_id: "prb_ffffffffffffffff" });
    expect(r.texto).toContain("supcoflow test --wait --test-id prb_ffffffffffffffff");
    expect(m.pruebas.size).toBe(0);
    expect((await d.pruebas.leer(PROY.id)).intento).toBeNull();
  });

  const rechazos: [string, RespuestaDePrueba, number, Record<string, unknown>][] = [
    ["409 prueba_en_curso", { tipo: "rechazo", status: 409, error: "prueba_en_curso", message: "Hay otra.", cuerpo: { prueba_id: "prb_eeeeeeeeeeeeeeee" } }, 4, { prueba_id: "prb_eeeeeeeeeeeeeeee" }],
    ["409 techo_distinto", { tipo: "rechazo", status: 409, error: "techo_distinto", message: "Otro techo.", cuerpo: { techo_usd: 3 } }, 4, { techo_usd: 3, autorizado_usd: 2 }],
    ["409 politica_distinta", { tipo: "rechazo", status: 409, error: "politica_distinta", message: "Otra política.", cuerpo: { politica: "guardar" } }, 4, { politica: "guardar", politica_esperada: "relevar" }],
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

  it("requiere_api_key lo explica: la prueba va con la personal API key de `supcoflow login`", async () => {
    const m = motor();
    m.guion = [{ tipo: "rechazo", status: 403, error: "requiere_api_key", message: "x", cuerpo: {} }];
    const { d } = deps(m);
    expect((await probar(d, AUT)).texto).toMatch(/personal API key/);
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
    expect(r.texto).toContain("`supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate`");
    await probar(d, AUT);
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
  });
});

describe("test --wait (R25)", () => {
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
    expect(fin.texto).toMatch(/Charge pending/);
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
    expect(r.texto).toMatch(/Charge lost/);
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
    expect(r.texto).toMatch(/Charge pending/);
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

  it("--test-id elige otra; sin ninguna guardada ni --test-id sale 3 sin_prueba sin pedir nada", async () => {
    const m = motor();
    const { d } = deps(m, undefined, tramoCorto);
    const sin = await probar(d, W);
    expect(sin.codigo).toBe(SALIDA.entradaInvalida);
    expect(sin.json.error).toBe("sin_prueba");
    expect(m.gets).toEqual([]);
    m.seguimientos = [seg("en_curso")];
    await probar(d, { ...W, testId: "prb_abcdefabcdefabcd" });
    expect(m.gets).toEqual(["prb_abcdefabcdefabcd"]);
  });

  it("--test-id con otra forma sale 3 sin pedir nada", async () => {
    const m = motor();
    const { d } = deps(m, undefined, tramoCorto);
    const r = await probar(d, { ...W, testId: "../../yo" });
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

  it("con una última ya cerrada y un pedido nuevo sin confirmar, --wait sale 4 intento_pendiente sin seguir la vieja; --test-id explícito sí la sigue", async () => {
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
    const explicita = await probar(d, { ...W, testId: "prb_0000000000000001" });
    expect(explicita.codigo).toBe(SALIDA.ok);
    expect(m.gets).toEqual(["prb_0000000000000001"]);
  });

  it("--wait no se combina con --authorize-spend, --ceiling, --expect-policy ni --message; --test-id es sólo de --wait (3, sin pedir nada)", async () => {
    for (const f of [{ ...W, authorizeSpend: true }, { ...W, message: "x" }, { ...W, ceiling: "2" }, { ...W, expectPolicy: "save" }, { ...F, testId: "prb_abcdefabcdefabcd" }]) {
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

// ─── Revisión 1, hallazgo 1: la orden que el mensaje recomienda tiene que SERVIR (se ejecuta de verdad, por el parser y el alias) ───
describe("la orden de recuperación que imprime un mensaje se puede ejecutar", () => {
  // Lo que escribiría la persona: se parte la orden recomendada, se pasa por `leerArgumentos` y se despacha como `cli.ts`.
  const ordenes = (texto: string) => [...texto.matchAll(/`(supcoflow [^`]+)`/g)].map((x) => x[1]!).filter((o) => /--authorize-spend|--autorizo-gasto/.test(o));
  async function ejecutar(d: DepsDePrueba, orden: string) {
    const { comando, flags, viejos } = leerArgumentos(orden.replace(/^supcoflow /, "").split(" "));
    expect(["test"], orden).toContain(comando);
    return probar(d, { ...flags, viejo: viejos.includes("probar") || viejos.includes("--autorizo-gasto") });
  }

  it("un intento NUEVO (con política): la orden es la canónica y recupera la misma prueba", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    const primero = await probar(d, AUT);
    const [orden] = ordenes(primero.texto);
    expect(orden).toBe("supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate");
    const r = await ejecutar(d, orden!);
    expect(r.codigo).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts.map((p) => p.key)).toEqual(["clave-1", "clave-1"]);
    expect(m.pruebas.size).toBe(1);
  });

  it("un intento SIN política (alias viejo, o guardado por la 0.7.0): la orden es la del alias y recupera la misma prueba (no 3 falta_politica ni 4 intento_pendiente)", async () => {
    const m = motor();
    m.guion = ["pierde"];
    const { d } = deps(m);
    const primero = await probar(d, { ...F, authorizeSpend: true, ceiling: "2", viejo: true });
    const [orden] = ordenes(primero.texto);
    expect(orden).toBe("supcoflow probar --autorizo-gasto --ceiling 2");
    const r = await ejecutar(d, orden!);
    expect(r.codigo, r.texto).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts.map((p) => [p.key, p.politicaEsperada])).toEqual([["clave-1", null], ["clave-1", null]]);
    expect(m.pruebas.size).toBe(1);
  });

  it("un intento de la 0.7.0 guardado en disco (sin politica_esperada) se recupera con la orden que dicen los tres mensajes", async () => {
    const m = motor();
    const almacen = memoria();
    almacen.datos.set("http://localhost:3000#prueba#proj_r-1", { valor: JSON.stringify({ intento: { clave: "vieja", mensaje: null, techo_usd: 2 }, ultima: null }), escritoEn: 1 });
    const { d } = deps(m, almacen);
    // 1) --wait con un pedido sin confirmar
    const espera = await probar(d, { ...F, wait: true });
    expect(espera.json.error).toBe("intento_pendiente");
    // 2) un --ceiling distinto
    const otro = await probar(d, { ...AUT, ceiling: "3" });
    expect(otro.json.error).toBe("intento_pendiente");
    for (const texto of [espera.texto, otro.texto]) {
      const [orden] = ordenes(texto);
      expect(orden, texto).toBe("supcoflow probar --autorizo-gasto --ceiling 2");
    }
    const r = await ejecutar(d, ordenes(espera.texto)[0]!);
    expect(r.codigo, r.texto).toBe(SALIDA.esperandoAUnaPersona);
    expect(m.posts).toEqual([{ key: "vieja", mensaje: null, techoUsd: 2, politicaEsperada: null }]);
  });

  it("cuando falla guardar la confirmación, la orden que se imprime también sirve (intento con y sin política)", async () => {
    for (const [flags, esperada] of [[AUT, "supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate"], [{ ...F, authorizeSpend: true, ceiling: "2", viejo: true }, "supcoflow probar --autorizo-gasto --ceiling 2"]] as const) {
      const m = motor();
      const almacen = memoria();
      almacen.romper = (valor) => valor.includes("prb_");
      const { d } = deps(m, almacen);
      const r = await probar(d, flags);
      expect(r.json.error).toBe("prueba_no_guardada");
      expect(ordenes(r.texto)[0]).toBe(esperada);
      almacen.romper = () => false;
      const otra = await ejecutar(d, ordenes(r.texto)[0]!);
      expect(otra.codigo, r.texto).toBe(SALIDA.esperandoAUnaPersona);
      expect(m.pruebas.size).toBe(1);
    }
  });
});
