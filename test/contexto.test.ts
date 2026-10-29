// V-7 (1A.1, fricción 6): ¿este repo va con la cuenta en la que estoy? Motor falso. Todo frena con
// `error: "contexto_incoherente"` y el `motivo` indicado, y SIN conexión, alta, publicación, configuración, pedido de prueba
// ni escritura local.
import { describe, expect, it } from "vitest";
import type { Pedido, Proyecto, Yo } from "../src/api.ts";
import { datosFijar, politicaFijar } from "../src/comandos/datos-y-politica.ts";
import { guiaPublicar, type DepsDeGuia } from "../src/comandos/guia.ts";
import { proyectoCrear, proyectoVer, type DepsDeProyecto } from "../src/comandos/proyecto.ts";
import { probar, diagnosticar, type DepsDePrueba } from "../src/comandos/probar.ts";
import { armarElContexto, leerElArchivoDelClon, lineaDelContexto } from "../src/comandos/contexto.ts";
import { ARCHIVO_QUE_NO_SE_LEE } from "../src/entorno.ts";
import type { Fuente } from "../src/guardado/index.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY_A: Proyecto = { id: "proj_a", slug: "a", repo: "Dueno/App", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const PROY_B: Proyecto = { ...PROY_A, id: "proj_b" };
const CONECTADO: Pedido = { id: "cnx_0123456789abcdef", repo: "dueno/app", estado: "conectado", url: "u", venceEn: "v", repoCanonico: "Dueno/App", fallo: null };
const ARCHIVO = "/w/app/.supcoflow/proyecto.json";
const yo = (o: Partial<Yo> = {}): Yo => ({ via: "api_key", equipo: "tnt_x", usuario: { id: "usr_1", login: "dueno", email: null }, proyecto: null, ...o });
const EMAIL = yo({ usuario: { id: "usr_2", login: null, email: "ana@x.com" } });
const CONSULTA = yo({ via: "clave_de_consulta", usuario: null, proyecto: "proj_a" });

type Mundo = { llamadas: string[]; archivos: Map<string, string>; escritos: string[]; proyecto: Proyecto | null; yo: Yo; fuente: Fuente };
function mundo(o: Partial<Mundo> = {}): Mundo {
  return { llamadas: [], archivos: new Map(), escritos: [], proyecto: null, yo: yo(), fuente: "llavero", ...o };
}
const base = (m: Mundo) => ({
  api: new URL("http://localhost:3000"),
  guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: m.fuente }, completa: true }) } as never,
  git: async (args: string[]) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/app\n" } : { codigo: 0, stdout: "git@github.com:Dueno/App.git\n" }),
  cwd: "/w/app",
  buscarProyecto: async () => { m.llamadas.push("buscar"); return m.proyecto; },
  archivos: {
    leer: (p: string) => m.archivos.get(p) ?? null,
    escribir: (p: string, s: string) => { m.escritos.push(p); m.archivos.set(p, s); },
  },
  avisar: () => {},
});
const f = (m: Mundo, nombre: string) => async (...a: unknown[]) => { m.llamadas.push(nombre); return a as never; };

function depsDeProyecto(m: Mundo): DepsDeProyecto {
  return {
    ...base(m),
    idempotencia: { claveDe: async () => { m.llamadas.push("clave"); return "k-1"; }, tiene: async () => false, olvidar: async () => { m.llamadas.push("olvidar"); } },
    quienSoy: async () => { m.llamadas.push("quien"); return m.yo; },
    ultimaConexion: async () => { m.llamadas.push("conexion"); return CONECTADO; },
    crearProyecto: async () => { m.llamadas.push("alta"); return { tipo: "ok", proyecto: PROY_A, reusado: false }; },
    leerProyecto: async () => ({ proyecto: PROY_A, github: { estado: "ok", verificadoEn: null } }),
  } as DepsDeProyecto;
}
const sinFlags = { repo: null, install: null, test: null, dryRun: false };
const incoherente = (r: { codigo: number; json: Record<string, unknown> }, motivo: string) =>
  expect(r).toMatchObject({ codigo: 4, json: { ok: false, error: "contexto_incoherente", motivo } });
const NADA_DE_ESCRIBIR = ["conexion", "alta", "publicar", "configurar", "pedir"];

describe("V-7 (1): un pedido PARCIAL no toca un proyecto distinto del que anota el clon", () => {
  const clonDeA = () => mundo({ proyecto: PROY_B, archivos: new Map([[ARCHIVO, '{"id":"proj_a","slug":"a","repo":"Dueno/App"}\n']]) });

  it("guide publish", async () => {
    const m = clonDeA();
    const d = { ...base(m), fetch: (async () => { throw new Error("sin red"); }) as never, leerArchivoChico: () => ({ bytes: new TextEncoder().encode("## A\n") }),
      gitDeclarado: async () => ({ codigo: 0, stdout: "main\n" }), publicar: f(m, "publicar"), revisar: f(m, "revisar"), ver: f(m, "ver"), elegir: f(m, "elegir"), versiones: f(m, "versiones") } as unknown as DepsDeGuia;
    const r = await guiaPublicar(d, { repo: null, dryRun: false, fromGithub: false });
    incoherente(r, "proyecto_del_clon_distinto");
    expect(r.texto).toBe("The project noted in this clone (proj_a) isn't the one your account sees for this repo (proj_b). Check which account you signed in with (`supcoflow whoami`), or, if that file is old, review it.");
    expect(m.llamadas).toEqual(["buscar"]);
  });
  it("data set y policy set", async () => {
    for (const comando of [(d: never) => datosFijar(d, { repo: null, dryRun: false, allow: "user_id" }), (d: never) => politicaFijar(d, { repo: null, dryRun: false, mode: "save" })]) {
      const m = clonDeA();
      const d = { ...base(m), leerConfiguracion: f(m, "leer"), configurar: f(m, "configurar") } as never;
      incoherente(await comando(d), "proyecto_del_clon_distinto");
      expect(m.llamadas).toEqual(["buscar"]);
    }
  });
  it("test --authorize-spend y diagnose", async () => {
    const m = clonDeA();
    const d = { ...base(m), leerDiagnostico: f(m, "diagnostico"), pedirPrueba: f(m, "pedir"), leerPrueba: f(m, "seguir"), generar: () => "k", ahora: () => 0, dormir: async () => {},
      pruebas: { leer: f(m, "leer-guardado"), abrir: f(m, "guardar"), confirmar: f(m, "confirmar"), descartar: f(m, "descartar"), revisar: f(m, "revisar") } } as unknown as DepsDePrueba;
    const F = { repo: null, authorizeSpend: true, dryRun: false, message: null, wait: false, testId: null, ceiling: "2", expectPolicy: "save" };
    incoherente(await probar(d, F), "proyecto_del_clon_distinto");
    incoherente(await probar(d, { ...F, authorizeSpend: false, ceiling: null, expectPolicy: null }), "proyecto_del_clon_distinto");
    incoherente(await diagnosticar(d, { repo: null }), "proyecto_del_clon_distinto");
    expect(m.llamadas.filter((l) => l !== "buscar")).toEqual([]);
  });
  it("si el clon anota el MISMO proyecto que ve la clave, anda como siempre", async () => {
    const m = mundo({ proyecto: PROY_A, archivos: new Map([[ARCHIVO, '{"id":"proj_a"}\n']]) });
    const d = { ...base(m), leerConfiguracion: f(m, "leer"), configurar: async () => { m.llamadas.push("configurar"); return { status: 200, cuerpo: { politica: { modo: "guardar", fijada_en: null } } }; } } as never;
    expect(await politicaFijar(d, { repo: null, dryRun: false, mode: "save" })).toMatchObject({ codigo: 0 });
    expect(m.llamadas).toContain("configurar");
  });
  it("--repo de otro repo (sin clon de ese repo) no compara con el archivo de esta carpeta", async () => {
    const m = clonDeA();
    const d = { ...base(m), leerConfiguracion: f(m, "leer"), configurar: async () => ({ status: 200, cuerpo: { politica: { modo: "guardar", fijada_en: null } } }) } as never;
    expect(await politicaFijar(d, { repo: "otro/repo", dryRun: false, mode: "save" })).toMatchObject({ codigo: 0 });
  });
});

describe("V-7 (2): el clon anota un proyecto y la clave no ve ninguno", () => {
  it("project show y project create salen 4 proyecto_del_clon_distinto, sin crear nada", async () => {
    for (const comando of [(d: DepsDeProyecto) => proyectoVer(d, { repo: null }), (d: DepsDeProyecto) => proyectoCrear(d, sinFlags)]) {
      const m = mundo({ proyecto: null, archivos: new Map([[ARCHIVO, '{"id":"proj_a"}\n']]) });
      const r = await comando(depsDeProyecto(m));
      incoherente(r, "proyecto_del_clon_distinto");
      expect(r.texto).toContain("(proj_a) isn't the one your account sees for this repo (none)");
      expect(m.llamadas.filter((l) => NADA_DE_ESCRIBIR.includes(l) || l === "clave")).toEqual([]);
      expect(m.escritos).toEqual([]);
    }
  });
});

describe("V-7 (3): el archivo del clon que no se entiende", () => {
  const casos: [string, string | null][] = [
    ["JSON roto", '{"id": "proj_a"'], ["sin id", '{"slug":"a"}'], ["id con otra forma", '{"id":"../../etc"}'], ["id que no es texto", '{"id":7}'],
    ["no se puede leer", ARCHIVO_QUE_NO_SE_LEE], ["un arreglo", "[1]"],
  ];
  for (const [nombre, contenido] of casos) {
    it(`${nombre}: 4 archivo_del_clon_ilegible en show, create y un pedido parcial, sin imprimir su contenido`, async () => {
      const secreto = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
      const crudo = contenido === ARCHIVO_QUE_NO_SE_LEE ? contenido : `${contenido}${secreto}`;
      for (const comando of [(m: Mundo) => proyectoVer(depsDeProyecto(m), { repo: null }), (m: Mundo) => proyectoCrear(depsDeProyecto(m), sinFlags),
        (m: Mundo) => politicaFijar({ ...base(m), leerConfiguracion: f(m, "leer"), configurar: f(m, "configurar") } as never, { repo: null, dryRun: false, mode: "save" })]) {
        const m = mundo({ proyecto: PROY_A, archivos: new Map([[ARCHIVO, crudo]]) });
        const r = await comando(m);
        incoherente(r, "archivo_del_clon_ilegible");
        expect(r.texto).toBe("I can't read `.supcoflow/proyecto.json` in this clone; I won't act on this repo until it's readable. Look at it before going on.");
        expect(JSON.stringify(r) + r.texto).not.toContain(secreto);
        expect(m.llamadas.filter((l) => NADA_DE_ESCRIBIR.includes(l))).toEqual([]);
        expect(m.escritos).toEqual([]);
      }
    });
  }
  it("un archivo que se lee y tiene forma de id es válido", () => {
    expect(leerElArchivoDelClon({ leer: () => '{"id":"proj_a-1"}' }, "/w")).toEqual({ estado: "valido", id: "proj_a-1" });
    expect(leerElArchivoDelClon({ leer: () => null }, "/w")).toEqual({ estado: "ausente" });
    expect(leerElArchivoDelClon({ leer: () => { throw new Error("EACCES"); } }, "/w")).toEqual({ estado: "ilegible" });
    expect(leerElArchivoDelClon({ leer: () => '{"id":"proj_a"}' }, null)).toEqual({ estado: "ausente" });
  });
});

describe("V-7 (4)-(6): al crear, el dueño del repo contra la cuenta", () => {
  it("(4) sin proyecto y dueño distinto del login: 4 dueno_distinto_del_login, con el mensaje de la cuenta renombrada, sin conexión", async () => {
    const m = mundo({ yo: yo({ usuario: { id: "usr_1", login: "otra-persona", email: null } }) });
    const r = await proyectoCrear(depsDeProyecto(m), sinFlags);
    incoherente(r, "dueno_distinto_del_login");
    expect(r.texto).toBe("This repo's owner on GitHub (@Dueno) isn't the GitHub account your key shows (@otra-persona). If you renamed your GitHub account, sign in to the Supcoflow console with GitHub again (that updates it) and run this again; otherwise sign in as @Dueno.");
    expect(m.llamadas).toEqual(["buscar", "quien"]);
  });
  it("(4) con fuente env el mensaje nombra SUPCOFLOW_TOKEN y no la toca", async () => {
    const m = mundo({ fuente: "env", yo: yo({ usuario: { id: "usr_1", login: "otra-persona", email: null } }) });
    const r = await proyectoCrear(depsDeProyecto(m), sinFlags);
    incoherente(r, "dueno_distinto_del_login");
    expect(r.texto).toContain("SUPCOFLOW_TOKEN");
    expect(r.texto).toContain("I don't touch it");
  });
  it("(5) Dueno/App contra el login dueno: no frena (sin distinguir mayúsculas)", async () => {
    const m = mundo();
    expect(await proyectoCrear(depsDeProyecto(m), sinFlags)).toMatchObject({ codigo: 0, json: { ok: true } });
    expect(m.llamadas).toContain("alta");
  });
  it("(6) persona por email sin proyecto: 4 sin_github; con el proyecto existente, 0", async () => {
    const sin = mundo({ yo: EMAIL });
    const r = await proyectoCrear(depsDeProyecto(sin), sinFlags);
    incoherente(r, "sin_github");
    expect(r.texto).toBe("Connecting a repo needs a Supcoflow account signed in with GitHub.");
    expect(sin.llamadas).toEqual(["buscar", "quien"]);
    const con = mundo({ yo: EMAIL, proyecto: PROY_A });
    expect(await proyectoCrear(depsDeProyecto(con), sinFlags)).toMatchObject({ codigo: 0 });
  });
  it("con --dry-run también frena, sin tocar nada", async () => {
    const m = mundo({ yo: yo({ usuario: { id: "usr_1", login: "otra-persona", email: null } }) });
    incoherente(await proyectoCrear(depsDeProyecto(m), { ...sinFlags, dryRun: true }), "dueno_distinto_del_login");
  });
});

describe("V-7 (7)-(9): lo que no frena y la línea del contexto", () => {
  it("(7) una clave de consulta: contexto «read-only», sin comparar logins", async () => {
    const m = mundo({ yo: CONSULTA, proyecto: PROY_A });
    const r = await proyectoVer(depsDeProyecto(m), { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { contexto: { identidad: "clave_de_consulta", identidad_tipo: "clave_de_consulta", proyecto: "proj_a" } } });
    expect(r.texto).toMatch(/^You're using a read-only key for proj_a in team tnt_x; repo Dueno\/App; project proj_a \(existing\)\./);
  });
  it("(8) un proyecto existente creado por otra persona del equipo: 0, y la línea de contexto sale igual", async () => {
    const m = mundo({ yo: yo({ usuario: { id: "usr_9", login: "colega", email: null } }), proyecto: PROY_A });
    const r = await proyectoVer(depsDeProyecto(m), { repo: null });
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/^You're @colega in team tnt_x; repo Dueno\/App; project proj_a \(existing\)\./);
    expect(await proyectoCrear(depsDeProyecto(mundo({ yo: yo({ usuario: { id: "usr_9", login: "colega", email: null } }), proyecto: PROY_A })), sinFlags)).toMatchObject({ codigo: 0 });
  });
  it("(9) todo coherente, nuevo y existente: 0 y el bloque contexto completo", async () => {
    const nuevo = await proyectoVer(depsDeProyecto(mundo()), { repo: null });
    expect(nuevo).toMatchObject({ codigo: 0, json: { ok: true, proyecto: null, contexto: { equipo: "tnt_x", identidad: "dueno", identidad_tipo: "github", fuente: "llavero", repo: "Dueno/App", proyecto: null, en_el_clon: { estado: "ausente", id: null } } } });
    expect(nuevo.texto).toMatch(/^You're @dueno in team tnt_x; repo Dueno\/App; no project yet \(it will be created in team tnt_x\)\. This repo doesn't have a project yet/);
    const existente = mundo({ proyecto: PROY_A, archivos: new Map([[ARCHIVO, '{"id":"proj_a"}']]) });
    const r = await proyectoVer(depsDeProyecto(existente), { repo: null });
    expect(r).toMatchObject({ codigo: 0, json: { contexto: { proyecto: "proj_a", en_el_clon: { estado: "valido", id: "proj_a" } }, proyecto: { id: "proj_a" } } });
    expect(r.texto).toMatch(/^You're @dueno in team tnt_x; repo Dueno\/App; project proj_a \(existing\)\. proj_a /);
  });
  it("la persona por email se dice «signed in with email», no con un login inventado; un login llamado «email» se distingue por identidad_tipo", () => {
    const c = armarElContexto({ yo: EMAIL, fuente: "llavero", repo: "o/r", proyecto: null, archivo: { estado: "ausente" } });
    expect(c).toMatchObject({ identidad: "email", identidad_tipo: "email" });
    expect(lineaDelContexto(c)).toBe("You're signed in with email (no GitHub) in team tnt_x; repo o/r; no project yet (it will be created in team tnt_x).");
    expect(armarElContexto({ yo: yo({ usuario: { id: "u", login: "email", email: null } }), fuente: "llavero", repo: "o/r", proyecto: null, archivo: { estado: "ausente" } }))
      .toMatchObject({ identidad: "email", identidad_tipo: "github" });
  });
});

describe("revisión 1, hallazgo 2: project show frena ANTES de repo connect cuando la cuenta no puede crear el proyecto", () => {
  it("sin proyecto y dueño distinto del login: show sale 4 dueno_distinto_del_login (no 0 con proyecto null)", async () => {
    const m = mundo({ yo: yo({ usuario: { id: "usr_1", login: "dueno-b", email: null } }) });
    const r = await proyectoVer(depsDeProyecto(m), { repo: null });
    incoherente(r, "dueno_distinto_del_login");
    expect(m.llamadas).toEqual(["buscar", "quien"]);
  });
  it("sin proyecto y persona por email: show sale 4 sin_github", async () => {
    incoherente(await proyectoVer(depsDeProyecto(mundo({ yo: EMAIL })), { repo: null }), "sin_github");
  });
  it("sin proyecto con SUPCOFLOW_TOKEN: el mensaje la nombra", async () => {
    const r = await proyectoVer(depsDeProyecto(mundo({ fuente: "env", yo: yo({ usuario: { id: "u", login: "otra", email: null } }) })), { repo: null });
    expect(r.texto).toContain("SUPCOFLOW_TOKEN");
  });
  it("las excepciones siguen: proyecto existente de otra persona, clave de consulta y dueño = login no frenan", async () => {
    expect((await proyectoVer(depsDeProyecto(mundo({ yo: EMAIL, proyecto: PROY_A })), { repo: null })).codigo).toBe(0);
    expect((await proyectoVer(depsDeProyecto(mundo({ yo: CONSULTA })), { repo: null })).codigo).toBe(0);
    expect((await proyectoVer(depsDeProyecto(mundo()), { repo: null })).codigo).toBe(0);
  });
  it("el recorrido show → connect: tras ese 4 no se inicia ninguna conexión", async () => {
    // La skill sólo sigue con `repo connect` si `project show` salió 0; con 4 se detiene, y el 4 no tocó el motor más que para leer.
    const m = mundo({ yo: yo({ usuario: { id: "usr_1", login: "dueno-b", email: null } }) });
    const r = await proyectoVer(depsDeProyecto(m), { repo: null });
    expect(r.codigo).toBe(4);
    expect(m.llamadas.filter((l) => NADA_DE_ESCRIBIR.includes(l))).toEqual([]);
  });
});
