import { describe, expect, it } from "vitest";
import { proyectoCrear, proyectoVer, type DepsDeProyecto } from "../src/comandos/proyecto.ts";
import { FalloDeLaTerminal, SALIDA } from "../src/contrato.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "D/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const CONECTADO = { id: "cnx_0123456789abcdef", repo: "d/r", estado: "conectado" as const, url: "u", venceEn: "v", repoCanonico: "D/r", fallo: null };

const YO = { via: "api_key", equipo: "tnt_x", usuario: { id: "usr_1", login: "d", email: null }, proyecto: null };

function deps(o: Partial<DepsDeProyecto> = {}) {
  const archivos = new Map<string, string>();
  const claves: string[] = [];
  const olvidadas: string[] = [];
  const olvidos: string[] = [];
  let siguiente = 0;
  const d: DepsDeProyecto = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    idempotencia: {
      claveDe: async () => { const k = claves.at(-1) && !olvidadas.includes(claves.at(-1)!) ? claves.at(-1)! : `k-${++siguiente}`; if (!claves.includes(k)) claves.push(k); return k; },
      tiene: async () => false,
      olvidar: async (op, alcance) => { olvidos.push(`${op}#${alcance}`); if (claves.length > 0) olvidadas.push(claves.at(-1)!); },
    },
    buscarProyecto: async () => null,
    // El dueño `d` del repo `d/r`: nada que frenar salvo que el test lo pida.
    quienSoy: async () => YO,
    ultimaConexion: async () => CONECTADO,
    crearProyecto: async () => ({ tipo: "ok", proyecto: PROY, reusado: false }),
    leerProyecto: async () => ({ proyecto: PROY, github: { estado: "ok", verificadoEn: "2026-10-15T00:00:00.000Z" } }),
    archivos: { leer: (p) => archivos.get(p) ?? null, escribir: (p, s) => void archivos.set(p, s) },
    avisar: () => {},
    ...o,
  };
  return { d, archivos, claves, olvidadas, olvidos };
}
const sinFlags = { repo: null, install: null, test: null, dryRun: false };

describe("proyecto crear", () => {
  it("crea desde la conexión y deja .supcoflow/proyecto.json", async () => {
    const { d, archivos } = deps();
    const r = await proyectoCrear(d, sinFlags);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, reusado: false, proyecto: { id: "proj_r-1" }, archivo: "/w/r/.supcoflow/proyecto.json" } });
    expect(JSON.parse(archivos.get("/w/r/.supcoflow/proyecto.json")!)).toEqual({ id: "proj_r-1", slug: "r", repo: "D/r" });
  });
  it("si el repo ya tiene proyecto, lo reusa sin conexión ni POST", async () => {
    let posts = 0;
    const { d } = deps({ buscarProyecto: async () => PROY, ultimaConexion: async () => null, crearProyecto: async () => { posts++; return { tipo: "ok", proyecto: PROY, reusado: false }; } });
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 0, json: { reusado: true } });
    expect(posts).toBe(0);
  });
  it("M1: al reusar olvida la clave guardada, para que una vieja no quede viva", async () => {
    const { d, olvidos } = deps({ buscarProyecto: async () => PROY });
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 0, json: { reusado: true } });
    expect(olvidos).toEqual(["proyecto_crear#d/r"]);
  });
  it("M5: al reusar con --install/--test avisa una vez que se ignoran, sin copiar los valores", async () => {
    const avisos: string[] = [];
    const { d } = deps({ buscarProyecto: async () => PROY, avisar: (s) => avisos.push(s) });
    const r = await proyectoCrear(d, { ...sinFlags, install: "pnpm i --secreto-raro", test: "pnpm vitest-raro" });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, reusado: true, proyecto: { id: "proj_r-1" } } });
    expect(Object.keys(r.json).sort()).toEqual(["archivo", "ok", "proyecto", "reusado"]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/ignor/i);
    expect(avisos[0]).not.toContain("\n");
    expect(avisos[0]).not.toContain("secreto-raro");
    expect(avisos[0]).not.toContain("vitest-raro");
  });
  it("M5: al reusar sin --install/--test no avisa nada", async () => {
    const avisos: string[] = [];
    const { d } = deps({ buscarProyecto: async () => PROY, avisar: (s) => avisos.push(s) });
    await proyectoCrear(d, sinFlags);
    expect(avisos).toEqual([]);
  });
  it.each([
    ["instalacion_no_verificada", "No pude verificar que la instalación sea tuya."],
    ["repo_fuera_de_la_instalacion", "El repo no está entre los de la instalación."],
  ])("I1: el rechazo %s pide a una persona en GitHub: 4 con el mensaje del motor y una pista", async (error, message) => {
    const { d, olvidos } = deps({ crearProyecto: async () => ({ tipo: "rechazo", error, message }) });
    const r = await proyectoCrear(d, sinFlags);
    expect(r).toMatchObject({ codigo: 4, json: { ok: false, error } });
    expect(r.texto).toContain(message);
    expect(r.texto).toContain("supcoflow repo connect");
    expect(olvidos).toEqual([]);
  });
  it.each(["slug_ocupado", "repo_ya_conectado"])("I1: el rechazo %s es transitorio: 1", async (error) => {
    const { d } = deps({ crearProyecto: async () => ({ tipo: "rechazo", error, message: "Probá de nuevo." }) });
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 1, json: { ok: false, error } });
  });
  it("I1: un rechazo que no está en la tabla sigue en 3", async () => {
    const { d } = deps({ crearProyecto: async () => ({ tipo: "rechazo", error: "otra_cosa", message: "No." }) });
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 3, json: { error: "otra_cosa" } });
  });
  it("sin conexión: 4 repo_sin_conectar", async () => {
    const { d } = deps({ ultimaConexion: async () => null });
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 4, json: { error: "repo_sin_conectar" } });
  });
  it("Review Focus 4: la respuesta se pierde y el reintento manda la MISMA clave", async () => {
    const vistas: string[] = [];
    let primera = true;
    const { d } = deps({
      crearProyecto: async (_a, _c, _id, _b, key) => {
        vistas.push(key);
        if (primera) { primera = false; throw new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "red"); }
        return { tipo: "ok", proyecto: PROY, reusado: true };
      },
    });
    expect((await proyectoCrear(d, sinFlags)).codigo).toBe(1);
    expect((await proyectoCrear(d, sinFlags)).codigo).toBe(0);
    expect(vistas[0]).toBe(vistas[1]);
  });
  it("D-06: comandos faltantes es 3 con la pista de los flags", async () => {
    const { d } = deps({ crearProyecto: async () => ({ tipo: "comandos_faltantes", faltantes: ["test_command"], message: "No encontré el comando de test." }) });
    const r = await proyectoCrear(d, sinFlags);
    expect(r).toMatchObject({ codigo: 3, json: { error: "comandos_faltantes", faltantes: ["test_command"] } });
    expect(r.texto).toContain("--test");
  });
  it("un proyecto.json del mismo proyecto pero con otro slug o repo no se pisa: 4 archivo_distinto", async () => {
    const { d, archivos } = deps({ buscarProyecto: async () => PROY });
    const crudo = '{"id":"proj_r-1","slug":"otro","repo":"d/otro"}\n';
    archivos.set("/w/r/.supcoflow/proyecto.json", crudo);
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 4, json: { error: "archivo_distinto", id_actual: "proj_r-1", nuevo: { id: "proj_r-1" } } });
    expect(archivos.get("/w/r/.supcoflow/proyecto.json")).toBe(crudo);
  });
  it("un proyecto.json de OTRO proyecto frena antes de crear nada (1A.1: contexto_incoherente, no un archivo_distinto tardío)", async () => {
    const { d, archivos } = deps();
    archivos.set("/w/r/.supcoflow/proyecto.json", '{"id":"proj_otro"}\n');
    expect(await proyectoCrear(d, sinFlags)).toMatchObject({ codigo: 4, json: { error: "contexto_incoherente", motivo: "proyecto_del_clon_distinto" } });
    expect(archivos.get("/w/r/.supcoflow/proyecto.json")).toBe('{"id":"proj_otro"}\n');
  });
  it("Review Focus 11: un archivo con secretos adentro no los copia a ninguna salida (no se entiende: frena sin crear)", async () => {
    const secreto = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
    const codigo = "e".repeat(64);
    const avisos: string[] = [];
    let creados = 0;
    const { d, archivos } = deps({ avisar: (s) => avisos.push(s), crearProyecto: async () => { creados++; return { tipo: "ok", proyecto: PROY, reusado: false }; } });
    const crudo = JSON.stringify({ id: secreto, token: secreto, device_code: codigo }) + "\n";
    archivos.set("/w/r/.supcoflow/proyecto.json", crudo);
    const r = await proyectoCrear(d, sinFlags);
    expect(r).toMatchObject({ codigo: 4, json: { error: "contexto_incoherente", motivo: "archivo_del_clon_ilegible" } });
    const todo = JSON.stringify(r) + r.texto + avisos.join("\n");
    expect(todo).not.toContain(secreto);
    expect(todo).not.toContain(codigo);
    expect(creados).toBe(0);
    expect(archivos.get("/w/r/.supcoflow/proyecto.json")).toBe(crudo);
  });
  it("con --repo de otro repo no escribe ningún archivo", async () => {
    const { d, archivos } = deps();
    expect(await proyectoCrear(d, { ...sinFlags, repo: "d/otro" })).toMatchObject({ codigo: 0, json: { archivo: null } });
    expect(archivos.size).toBe(0);
  });
  it("--dry-run no hace el POST", async () => {
    let posts = 0;
    const { d } = deps({ crearProyecto: async () => { posts++; return { tipo: "ok", proyecto: PROY, reusado: false }; } });
    expect((await proyectoCrear(d, { ...sinFlags, dryRun: true })).codigo).toBe(0);
    expect(posts).toBe(0);
  });
});

describe("proyecto ver", () => {
  it("sin proyecto es 0 con null", async () => {
    const { d } = deps();
    expect(await proyectoVer(d, { repo: null })).toMatchObject({ codigo: 0, json: { ok: true, proyecto: null } });
  });
  it("con proyecto, la configuración y la salud de GitHub", async () => {
    const { d } = deps({ buscarProyecto: async () => PROY });
    expect(await proyectoVer(d, { repo: null })).toMatchObject({ codigo: 0, json: { proyecto: { id: "proj_r-1" }, github: { estado: "ok" } } });
  });
});
