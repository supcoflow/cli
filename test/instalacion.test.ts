// test/instalacion.test.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instalacionAnotar, rutaRealOEnNada, type DepsDeInstalacion } from "../src/comandos/instalacion.ts";
import { archivosDelRepo, gitReal, leerArchivoChico } from "../src/entorno.ts";
import { armarInstalacion, RUTA_DE_LA_INSTALACION, serializar, type Instalacion } from "../src/instalacion.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const COMMIT = "abc1234def5678abc1234def5678abc1234def56";
const CONFIG = {
  chat: { habilitado: true, tope_mensajes_dia: 50 },
  guia: { origen: "repo", id: "g_1", version: 4, repo: "d/r", procedencia: "terminal", rama: "main", commit: COMMIT, ruta: ".supcoflow/guia.md", huella: "f".repeat(64), secciones: 3, publicada_en: "2026-10-18T00:00:00.000Z", publicada_por: "usr_1" },
  guia_aprobada: true,
  marca: null,
  sitios: ["https://app.example"],
  acuerdo: { version: 3, permitido: ["texto"], fijado_en: "2026-10-18T00:00:00.000Z", fijado_por: "usr_1", fijado_con: "sesion" },
  politica: { modo: "relevar", fijada_en: null },
};
const ESPERADA: Instalacion = {
  version: 1, skill: "0.1.0", terminal: "0.6.0",
  chat: { declarado: "2.2.1", instalado: "2.2.1" },
  configuracion: { acuerdo_version: 3, politica: "relevar", guia: { origen: "repo", procedencia: "terminal", commit: COMMIT } },
};
const pkgApp = (dep: string | null = "2.2.1") => JSON.stringify({ name: "app", dependencies: dep === null ? { next: "16.0.0" } : { next: "16.0.0", "@supcoflow/chat": dep } });
const pkgChat = (v: string = "2.2.1") => JSON.stringify({ name: "@supcoflow/chat", version: v });

// ─── El mundo falso: archivos, enlaces y lo que contesta git sobre el archivo de la instalación ───
type Mundo = {
  archivos: Map<string, string>; dirs: Set<string>; enlaces: Map<string, string>; errores: Map<string, string>;
  versionado: boolean; estado: string; escritos: string[]; avisos: string[]; pedidos: string[];
};
function mundo(o: Partial<Mundo> = {}): Mundo {
  return {
    archivos: new Map([["/w/r/package.json", pkgApp()], ["/w/r/node_modules/@supcoflow/chat/package.json", pkgChat()]]),
    dirs: new Set(["/w/r", "/w/r/apps/web", "/w/r/.supcoflow"]),
    enlaces: new Map(), errores: new Map(), versionado: false, estado: "", escritos: [], avisos: [], pedidos: [], ...o,
  };
}
function deps(m: Mundo, o: Partial<DepsDeInstalacion> = {}): DepsDeInstalacion {
  return {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => {
      if (args[0] === "rev-parse") return { codigo: 0, stdout: "/w/r\n" };
      if (args[0] === "remote") return { codigo: 0, stdout: "git@github.com:d/r.git\n" };
      if (args[0] === "ls-files") return { codigo: 0, stdout: m.versionado ? `${RUTA_DE_LA_INSTALACION}\n` : "" };
      if (args[0] === "status") return { codigo: 0, stdout: m.estado };
      return { codigo: 1, stdout: "" };
    },
    cwd: "/w/r",
    buscarProyecto: async () => { m.pedidos.push("proyecto"); return PROY; },
    leerConfiguracion: async () => { m.pedidos.push("configuracion"); return CONFIG; },
    leerArchivoChico: (p) => {
      const e = m.errores.get(p);
      if (e !== undefined) return { error: e };
      const t = m.archivos.get(m.enlaces.get(p) ?? p);
      return t === undefined ? { error: "no existe" } : { bytes: new TextEncoder().encode(t) };
    },
    rutaReal: (p) => m.enlaces.get(p) ?? (m.archivos.has(p) || m.dirs.has(p) ? p : null),
    escribir: (p, s) => { m.escritos.push(p); m.archivos.set(p, s); },
    avisar: (s) => void m.avisos.push(s),
    terminal: "0.6.0",
    ...o,
  };
}
const F = { repo: null, dryRun: false, skill: "0.1.0", app: null };
const ARCHIVO = `/w/r/${RUTA_DE_LA_INSTALACION}`;

describe("armarInstalacion (lista cerrada de campos)", () => {
  const base = { skill: "0.1.0", terminal: "0.6.0", paqueteDeLaApp: JSON.parse(pkgApp()), paqueteInstalado: JSON.parse(pkgChat()), configuracion: CONFIG };
  it("arma exactamente la forma del contrato", () => {
    expect(armarInstalacion(base)).toEqual(ESPERADA);
  });
  it("una configuración con campos de más (y una clave en campos raros) no los copia", () => {
    const rara = {
      ...CONFIG, secreto: CLAVE, clave: CLAVE,
      acuerdo: { ...CONFIG.acuerdo, fijado_por: CLAVE, clave: CLAVE },
      politica: { modo: "guardar", fijada_en: null, extra: CLAVE },
      guia: { ...CONFIG.guia, publicada_por: CLAVE, huella: CLAVE, otra: { clave: CLAVE } },
    };
    const x = armarInstalacion({ ...base, configuracion: rara });
    expect(x.configuracion).toEqual({ acuerdo_version: 3, politica: "guardar", guia: { origen: "repo", procedencia: "terminal", commit: COMMIT } });
    expect(serializar(x)).not.toContain("scf_");
  });
  it("la guía del agente es {origen, version}; sin guía y sin acuerdo, null", () => {
    const x = armarInstalacion({ ...base, configuracion: { ...CONFIG, acuerdo: null, guia: { origen: "agente", id: "ga", version: 2, secciones: 3, aprobada_en: null } } });
    expect(x.configuracion).toEqual({ acuerdo_version: null, politica: "relevar", guia: { origen: "agente", version: 2 } });
    expect(armarInstalacion({ ...base, configuracion: { ...CONFIG, guia: null } }).configuracion.guia).toBeNull();
  });
  it("una guía del repo subida sin commit lleva commit null", () => {
    const x = armarInstalacion({ ...base, configuracion: { ...CONFIG, guia: { ...CONFIG.guia, commit: null } } });
    expect(x.configuracion.guia).toEqual({ origen: "repo", procedencia: "terminal", commit: null });
  });
  it("sin el paquete en la app: declarado null; sin instalar: instalado null", () => {
    const x = armarInstalacion({ ...base, paqueteDeLaApp: JSON.parse(pkgApp(null)), paqueteInstalado: null });
    expect(x.chat).toEqual({ declarado: null, instalado: null });
    expect(armarInstalacion({ ...base, paqueteDeLaApp: null }).chat.declarado).toBeNull();
  });
  it("también lo lee de devDependencies", () => {
    const x = armarInstalacion({ ...base, paqueteDeLaApp: { devDependencies: { "@supcoflow/chat": "^2.2.0" } } });
    expect(x.chat.declarado).toBe("^2.2.0");
  });
  it("un paquete instalado sin version: 1 paquete_ilegible", () => {
    expect(() => armarInstalacion({ ...base, paqueteInstalado: { name: "@supcoflow/chat" } })).toThrow(expect.objectContaining({ codigo: 1, error: "paquete_ilegible" }));
  });
  it("una configuración con forma inesperada no se anota a medias", () => {
    expect(() => armarInstalacion({ ...base, configuracion: { ...CONFIG, politica: { modo: "otra" } } })).toThrow(expect.objectContaining({ error: "configuracion_inesperada" }));
    expect(() => armarInstalacion({ ...base, configuracion: { ...CONFIG, guia: { ...CONFIG.guia, commit: CLAVE } } })).toThrow(expect.objectContaining({ error: "configuracion_inesperada" }));
  });
  it("un acuerdo ilegible no se anota como «sin acuerdo»: 4 acuerdo_ilegible", () => {
    expect(() => armarInstalacion({ ...base, configuracion: { ...CONFIG, acuerdo: { ilegible: true } } })).toThrow(expect.objectContaining({ codigo: 4, error: "acuerdo_ilegible" }));
  });
  it("serializar: 2 espacios y salto final", () => {
    const s = serializar(ESPERADA);
    expect(s.endsWith("}\n")).toBe(true);
    expect(s).toContain('\n  "skill": "0.1.0",');
    expect(JSON.parse(s)).toEqual(ESPERADA);
  });
});

describe("supcoflow instalacion anotar", () => {
  it("sin --skill: 3 falta_skill, sin pedido", async () => {
    const m = mundo();
    expect(await instalacionAnotar(deps(m), { ...F, skill: null })).toMatchObject({ codigo: 3, json: { error: "falta_skill" } });
    expect(m.pedidos).toEqual([]);
  });
  it("--skill que no es semver: 3 skill_invalida, sin pedido", async () => {
    const m = mundo();
    for (const s of ["1.0", "v1.0.0", "01.0.0", "latest", `1.0.0-${CLAVE}`.slice(0, 80) + " x"]) {
      expect(await instalacionAnotar(deps(m), { ...F, skill: s })).toMatchObject({ codigo: 3, json: { error: "skill_invalida" } });
    }
    expect(m.pedidos).toEqual([]);
  });
  it("--app fuera de la raíz: 3 app_fuera_del_repo, sin pedido", async () => {
    const m = mundo({ dirs: new Set(["/w/r", "/w/otra"]) });
    expect(await instalacionAnotar(deps(m), { ...F, app: "../otra" })).toMatchObject({ codigo: 3, json: { error: "app_fuera_del_repo" } });
    expect(m.pedidos).toEqual([]);
  });
  it("--app que es un enlace hacia afuera: 3 app_fuera_del_repo", async () => {
    const m = mundo({ enlaces: new Map([["/w/r/apps/web", "/fuera/web"]]) });
    expect(await instalacionAnotar(deps(m), { ...F, app: "apps/web" })).toMatchObject({ codigo: 3, json: { error: "app_fuera_del_repo" } });
  });
  it("--app que no existe: 3 app_inexistente", async () => {
    const m = mundo();
    expect(await instalacionAnotar(deps(m), { ...F, app: "apps/nada" })).toMatchObject({ codigo: 3, json: { error: "app_inexistente" } });
  });
  it("--repo sin clon local: 3 sin_clon", async () => {
    const m = mundo();
    expect(await instalacionAnotar(deps(m), { ...F, repo: "otro/repo" })).toMatchObject({ codigo: 3, json: { error: "sin_clon" } });
    expect(m.pedidos).toEqual([]);
  });
  it("sin proyecto: 4 sin_proyecto; sin sesión: 2", async () => {
    expect(await instalacionAnotar(deps(mundo(), { buscarProyecto: async () => null }), F)).toMatchObject({ codigo: 4, json: { error: "sin_proyecto" } });
    expect((await instalacionAnotar(deps(mundo(), { guardado: { leerClaveCompleta: async () => ({ valor: null, completa: true }) } as never }), F)).codigo).toBe(2);
  });

  it("no versionado y no existe: escribe, 0 sin_cambios false, con la forma del contrato", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m), F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, sin_cambios: false, ruta: RUTA_DE_LA_INSTALACION, instalacion: ESPERADA } });
    expect(m.escritos).toEqual([ARCHIVO]);
    expect(m.archivos.get(ARCHIVO)).toBe(serializar(ESPERADA));
    expect(m.pedidos).toEqual(["proyecto", "configuracion"]);
  });
  it("existe y es igual byte a byte: 0 sin_cambios true, no escribe", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, serializar(ESPERADA));
    expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 0, json: { ok: true, sin_cambios: true } });
    expect(m.escritos).toEqual([]);
  });
  it("versionado y limpio: escribe", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, serializar({ ...ESPERADA, skill: "0.0.9" }));
    const r = await instalacionAnotar(deps(m), F);
    expect(r).toMatchObject({ codigo: 0, json: { sin_cambios: false } });
    expect(m.escritos).toEqual([ARCHIVO]);
    expect(r.texto).toContain('-   "skill": "0.0.9",');
    expect(r.texto).toContain('+   "skill": "0.1.0",');
    expect(JSON.stringify(r.json)).not.toContain("0.0.9"); // el diff va sólo en texto
  });
  it("versionado y modificado: 4 cambios_sin_commit, no escribe", async () => {
    const m = mundo({ versionado: true, estado: ` M ${RUTA_DE_LA_INSTALACION}\n` });
    m.archivos.set(ARCHIVO, "{}\n");
    expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
    expect(m.escritos).toEqual([]);
  });
  it("versionado y borrado sin commit: 4 cambios_sin_commit, no lo recrea", async () => {
    const m = mundo({ versionado: true, estado: ` D ${RUTA_DE_LA_INSTALACION}\n` });
    expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
    expect(m.escritos).toEqual([]);
  });
  it("no versionado y existe (también ignorado): 4 archivo_no_versionado", async () => {
    for (const estado of [`?? ${RUTA_DE_LA_INSTALACION}\n`, `!! ${RUTA_DE_LA_INSTALACION}\n`, ""]) {
      const m = mundo({ estado });
      m.archivos.set(ARCHIVO, "{}\n");
      expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 4, json: { error: "archivo_no_versionado" } });
      expect(m.escritos).toEqual([]);
    }
  });
  it("--dry-run muestra el diff y no escribe", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m), { ...F, dryRun: true });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, dry_run: true, sin_cambios: false, instalacion: ESPERADA } });
    expect(r.texto).toContain('+   "skill": "0.1.0",');
    expect(m.escritos).toEqual([]);
  });
  it("--dry-run igual respeta la tabla: 4 si hay cambios sin commit", async () => {
    const m = mundo({ versionado: true, estado: ` M ${RUTA_DE_LA_INSTALACION}\n` });
    m.archivos.set(ARCHIVO, "{}\n");
    expect((await instalacionAnotar(deps(m), { ...F, dryRun: true })).codigo).toBe(4);
  });
  it("el diff del archivo anterior no saca secretos ni caracteres de control", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, `{"x": "${CLAVE}\u001b[31m"}\n`);
    const r = await instalacionAnotar(deps(m), F);
    expect(r.texto).not.toContain(CLAVE);
    expect(r.texto.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it("monorepo con el paquete sólo en la raíz: instalado sale de la raíz, declarado de la app", async () => {
    const m = mundo();
    m.archivos.set("/w/r/apps/web/package.json", pkgApp("2.2.0"));
    m.archivos.set("/w/r/node_modules/@supcoflow/chat/package.json", pkgChat("2.2.1"));
    const r = await instalacionAnotar(deps(m), { ...F, app: "apps/web" });
    expect(r.json).toMatchObject({ instalacion: { chat: { declarado: "2.2.0", instalado: "2.2.1" } } });
  });
  it("gana el node_modules más cercano a la app", async () => {
    const m = mundo();
    m.archivos.set("/w/r/apps/web/package.json", pkgApp());
    m.archivos.set("/w/r/apps/web/node_modules/@supcoflow/chat/package.json", pkgChat("2.2.1"));
    m.archivos.set("/w/r/node_modules/@supcoflow/chat/package.json", pkgChat("1.0.0"));
    const r = await instalacionAnotar(deps(m), { ...F, app: "apps/web" });
    expect(r.json).toMatchObject({ instalacion: { chat: { instalado: "2.2.1" } } });
  });
  it("pnpm: el enlace a node_modules/.pnpm (adentro) vale", async () => {
    const m = mundo();
    const real = "/w/r/node_modules/.pnpm/@supcoflow+chat@2.2.1/node_modules/@supcoflow/chat/package.json";
    m.archivos.delete("/w/r/node_modules/@supcoflow/chat/package.json");
    m.archivos.set(real, pkgChat());
    m.enlaces.set("/w/r/node_modules/@supcoflow/chat/package.json", real);
    expect((await instalacionAnotar(deps(m), F)).json).toMatchObject({ instalacion: { chat: { instalado: "2.2.1" } } });
  });
  it("un enlace que apunta fuera del repo: instalado null con aviso", async () => {
    const m = mundo();
    m.archivos.set("/fuera/chat/package.json", pkgChat());
    m.enlaces.set("/w/r/node_modules/@supcoflow/chat/package.json", "/fuera/chat/package.json");
    const r = await instalacionAnotar(deps(m), F);
    expect(r).toMatchObject({ codigo: 0, json: { instalacion: { chat: { instalado: null } } } });
    expect(m.avisos.join("\n")).toMatch(/fuera del repo/);
    expect((r.json.avisos as string[]).join("\n")).toMatch(/fuera del repo/);
  });
  it("sin el paquete instalado: instalado null", async () => {
    const m = mundo();
    m.archivos.delete("/w/r/node_modules/@supcoflow/chat/package.json");
    expect((await instalacionAnotar(deps(m), F)).json).toMatchObject({ instalacion: { chat: { instalado: null } } });
  });
  it("package.json del paquete ilegible o sin version: 1 paquete_ilegible, no escribe", async () => {
    for (const arreglar of [
      (m: Mundo) => m.errores.set("/w/r/node_modules/@supcoflow/chat/package.json", "es demasiado grande"),
      (m: Mundo) => m.archivos.set("/w/r/node_modules/@supcoflow/chat/package.json", "{no es json"),
      (m: Mundo) => m.archivos.set("/w/r/node_modules/@supcoflow/chat/package.json", '{"name":"@supcoflow/chat"}'),
    ]) {
      const m = mundo();
      arreglar(m);
      expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 1, json: { error: "paquete_ilegible" } });
      expect(m.escritos).toEqual([]);
    }
  });
  it("package.json de la app que no existe: declarado null; que no se lee: 1 paquete_ilegible", async () => {
    const m = mundo();
    m.archivos.delete("/w/r/package.json");
    expect((await instalacionAnotar(deps(m), F)).json).toMatchObject({ instalacion: { chat: { declarado: null } } });
    const m2 = mundo();
    m2.archivos.set("/w/r/package.json", "{roto");
    expect(await instalacionAnotar(deps(m2), F)).toMatchObject({ codigo: 1, json: { error: "paquete_ilegible" } });
  });
  it("el JSON y el archivo no llevan scf_ aunque la configuración lo traiga", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m, { leerConfiguracion: async () => ({ ...CONFIG, clave: CLAVE, acuerdo: { ...CONFIG.acuerdo, fijado_por: CLAVE } }) }), F);
    expect(r.codigo).toBe(0);
    expect(JSON.stringify(r.json)).not.toContain("scf_");
    expect(r.texto).not.toContain("scf_");
    expect(m.archivos.get(ARCHIVO)).not.toContain("scf_");
  });
});

// ─── Contra un repo de git de verdad (como archivo-real.test.ts) ───
describe("instalacion anotar sobre un repo de git real", () => {
  let tmp: string;
  let raiz: string;
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: raiz, stdio: "pipe" });
  const archivo = () => join(raiz, RUTA_DE_LA_INSTALACION);
  const depsReales = (): { d: DepsDeInstalacion; avisos: string[] } => {
    const avisos: string[] = [];
    const d = deps(mundo(), {
      git: gitReal, cwd: raiz, leerArchivoChico, rutaReal: rutaRealOEnNada,
      escribir: archivosDelRepo(() => {}).escribir, avisar: (s) => void avisos.push(s),
    });
    return { d, avisos };
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "supcoflow-instalacion-"));
    raiz = realpathSync(tmp);
    g("init", "-q");
    g("remote", "add", "origin", "https://github.com/d/r.git");
    writeFileSync(join(raiz, "package.json"), pkgApp());
    mkdirSync(join(raiz, "node_modules", "@supcoflow", "chat"), { recursive: true });
    writeFileSync(join(raiz, "node_modules", "@supcoflow", "chat", "package.json"), pkgChat());
    writeFileSync(join(raiz, ".gitignore"), "node_modules\n");
    g("add", "-A");
    g("commit", "-q", "-m", "inicio");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("sin archivo: lo escribe; repetir da sin_cambios", async () => {
    const r = await instalacionAnotar(depsReales().d, F);
    expect(r).toMatchObject({ codigo: 0, json: { sin_cambios: false, instalacion: ESPERADA } });
    expect(readFileSync(archivo(), "utf8")).toBe(serializar(ESPERADA));
    expect(await instalacionAnotar(depsReales().d, F)).toMatchObject({ codigo: 0, json: { sin_cambios: true } });
  });
  it("sin commit todavía: 4 archivo_no_versionado", async () => {
    await instalacionAnotar(depsReales().d, F);
    expect(await instalacionAnotar(depsReales().d, { ...F, skill: "0.2.0" })).toMatchObject({ codigo: 4, json: { error: "archivo_no_versionado" } });
  });
  it("commiteado y limpio: lo reescribe", async () => {
    await instalacionAnotar(depsReales().d, F);
    g("add", RUTA_DE_LA_INSTALACION);
    g("commit", "-q", "-m", "instalacion");
    expect(await instalacionAnotar(depsReales().d, { ...F, skill: "0.2.0" })).toMatchObject({ codigo: 0, json: { sin_cambios: false } });
    expect(JSON.parse(readFileSync(archivo(), "utf8")).skill).toBe("0.2.0");
  });
  it("commiteado y modificado: 4 cambios_sin_commit y no lo toca", async () => {
    await instalacionAnotar(depsReales().d, F);
    g("add", RUTA_DE_LA_INSTALACION);
    g("commit", "-q", "-m", "instalacion");
    writeFileSync(archivo(), "{}\n");
    expect(await instalacionAnotar(depsReales().d, { ...F, skill: "0.2.0" })).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
    expect(readFileSync(archivo(), "utf8")).toBe("{}\n");
  });
  it("en el índice sin commit (git add): 4 cambios_sin_commit", async () => {
    await instalacionAnotar(depsReales().d, F);
    g("add", RUTA_DE_LA_INSTALACION);
    expect(await instalacionAnotar(depsReales().d, { ...F, skill: "0.2.0" })).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
  });
  it("commiteado y borrado sin commit: 4 cambios_sin_commit y no lo recrea", async () => {
    await instalacionAnotar(depsReales().d, F);
    g("add", RUTA_DE_LA_INSTALACION);
    g("commit", "-q", "-m", "instalacion");
    unlinkSync(archivo());
    expect(await instalacionAnotar(depsReales().d, F)).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
    expect(existsSync(archivo())).toBe(false);
  });
  it("ignorado por git y existente: 4 archivo_no_versionado", async () => {
    writeFileSync(join(raiz, ".gitignore"), "node_modules\n.supcoflow/\n");
    g("commit", "-q", "-am", "ignorar");
    mkdirSync(join(raiz, ".supcoflow"));
    writeFileSync(archivo(), "{}\n");
    expect(await instalacionAnotar(depsReales().d, F)).toMatchObject({ codigo: 4, json: { error: "archivo_no_versionado" } });
    expect(readFileSync(archivo(), "utf8")).toBe("{}\n");
  });
  it("--app con un enlace que sale del repo: 3 app_fuera_del_repo", async () => {
    const afuera = mkdtempSync(join(tmpdir(), "supcoflow-afuera-"));
    try {
      symlinkSync(afuera, join(raiz, "web"));
      expect(await instalacionAnotar(depsReales().d, { ...F, app: "web" })).toMatchObject({ codigo: 3, json: { error: "app_fuera_del_repo" } });
    } finally {
      rmSync(afuera, { recursive: true, force: true });
    }
  });
  it("monorepo: --app apps/web sin node_modules propio toma el de la raíz", async () => {
    mkdirSync(join(raiz, "apps", "web"), { recursive: true });
    writeFileSync(join(raiz, "apps", "web", "package.json"), pkgApp("2.2.0"));
    const r = await instalacionAnotar(depsReales().d, { ...F, app: "apps/web" });
    expect(r.json).toMatchObject({ instalacion: { chat: { declarado: "2.2.0", instalado: "2.2.1" } } });
  });
  it("el paquete instalado como enlace que sale del repo: instalado null con aviso", async () => {
    const afuera = mkdtempSync(join(tmpdir(), "supcoflow-afuera-"));
    try {
      writeFileSync(join(afuera, "package.json"), pkgChat());
      rmSync(join(raiz, "node_modules", "@supcoflow", "chat"), { recursive: true });
      symlinkSync(afuera, join(raiz, "node_modules", "@supcoflow", "chat"));
      const { d, avisos } = depsReales();
      const r = await instalacionAnotar(d, F);
      expect(r).toMatchObject({ codigo: 0, json: { instalacion: { chat: { instalado: null } } } });
      expect(avisos.join("\n")).toMatch(/fuera del repo/);
    } finally {
      rmSync(afuera, { recursive: true, force: true });
    }
  });
});
