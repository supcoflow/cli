// test/instalacion.test.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { esCarpetaReal, esEnlaceReal, instalacionAnotar, rutaRealOEnNada, type DepsDeInstalacion } from "../src/comandos/instalacion.ts";
import { archivosDelRepo, gitReal, leerArchivoChico } from "../src/entorno.ts";
import { anotadoEn, armarInstalacion, compararSemver, leerInstalacionAnotada, RUTA_DE_LA_INSTALACION, serializar, validarElArchivoDelChat, type Instalacion } from "../src/instalacion.ts";
import { NO_LEIDO } from "../src/lectura.ts";

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
  version: 3, skill: "0.1.0", terminal: "0.6.0",
  chat: { declarado: "2.2.1", instalado: "2.2.1" },
  configuracion: { acuerdo_version: 3, politica: "relevar", guia: { origen: "repo", procedencia: "terminal", commit: COMMIT } },
  forma: null, archivos: [], contrato: null,
};
const pkgApp = (dep: string | null = "2.2.1") => JSON.stringify({ name: "app", dependencies: dep === null ? { next: "16.0.0" } : { next: "16.0.0", "@supcoflow/chat": dep } });
const pkgChat = (v: string = "2.2.1") => JSON.stringify({ name: "@supcoflow/chat", version: v });
const contratoJson = (v: string = "1.1.0") => JSON.stringify({ name: "supcoflow-presentation-contract", version: v, points: [] });

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
      return t === undefined ? { error: NO_LEIDO.noExiste } : { bytes: new TextEncoder().encode(t) };
    },
    rutaReal: (p) => m.enlaces.get(p) ?? (m.archivos.has(p) || m.dirs.has(p) ? p : null),
    esCarpeta: (p) => m.dirs.has(p),
    esEnlace: (p) => m.enlaces.has(p),
    escribir: (p, s) => { m.escritos.push(p); m.archivos.set(p, s); },
    avisar: (s) => void m.avisos.push(s),
    terminal: "0.6.0",
    ...o,
  };
}
const F = { repo: null, dryRun: false, skill: "0.1.0", app: null, file: null };
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

describe("supcoflow install record", () => {
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
  it("--app que es un archivo: 3 app_inexistente, sin pedido", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m), { ...F, app: "package.json" });
    expect(r).toMatchObject({ codigo: 3, json: { error: "app_inexistente" } });
    expect(m.pedidos).toEqual([]);
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
  it("--dry-run con el archivo igual: 0 sin_cambios true y dry_run true", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, serializar(ESPERADA));
    expect(await instalacionAnotar(deps(m), { ...F, dryRun: true })).toMatchObject({ codigo: 0, json: { ok: true, dry_run: true, sin_cambios: true } });
  });
  it("borrado con git rm (en el índice): ls-files no lo ve, igual 4 cambios_sin_commit y no lo recrea", async () => {
    const m = mundo({ versionado: false, estado: `D  ${RUTA_DE_LA_INSTALACION}\n` });
    expect(await instalacionAnotar(deps(m), F)).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
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
    expect(m.avisos.join("\n")).toMatch(/points outside the repo/);
    expect((r.json.avisos as string[]).join("\n")).toMatch(/points outside the repo/);
  });
  it("sin el paquete instalado: instalado null", async () => {
    const m = mundo();
    m.archivos.delete("/w/r/node_modules/@supcoflow/chat/package.json");
    expect((await instalacionAnotar(deps(m), F)).json).toMatchObject({ instalacion: { chat: { instalado: null } } });
  });
  it("package.json del paquete ilegible o sin version: 1 paquete_ilegible, no escribe", async () => {
    for (const arreglar of [
      (m: Mundo) => m.errores.set("/w/r/node_modules/@supcoflow/chat/package.json", NO_LEIDO.demasiadoGrande),
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
      git: gitReal, cwd: raiz, leerArchivoChico, rutaReal: rutaRealOEnNada, esCarpeta: esCarpetaReal, esEnlace: esEnlaceReal,
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
  it("borrado con git rm sin commit: 4 cambios_sin_commit y no lo recrea", async () => {
    await instalacionAnotar(depsReales().d, F);
    g("add", RUTA_DE_LA_INSTALACION);
    g("commit", "-q", "-m", "instalacion");
    g("rm", "-q", RUTA_DE_LA_INSTALACION);
    expect(await instalacionAnotar(depsReales().d, F)).toMatchObject({ codigo: 4, json: { error: "cambios_sin_commit" } });
    expect(existsSync(archivo())).toBe(false);
  });
  it("--app que es un archivo: 3 app_inexistente", async () => {
    expect(await instalacionAnotar(depsReales().d, { ...F, app: "package.json" })).toMatchObject({ codigo: 3, json: { error: "app_inexistente" } });
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
      expect(avisos.join("\n")).toMatch(/points outside the repo/);
    } finally {
      rmSync(afuera, { recursive: true, force: true });
    }
  });
});

// ─── T3.8 (R7, spec §10.3): `install record --file` y el formato v2 ───
describe("install record --file (instalacion.json v3; el `archivo` de la v2 se lee)", () => {
  const CHAT = "app/_supcoflow/support-chat.tsx";
  const conArchivo = (archivo: string | null): Instalacion => ({ ...ESPERADA, archivos: archivo === null ? [] : [archivo] });

  it("--file con una ruta válida: escribe v3 con `archivos` y devuelve `archivo` (el primero) y `archivos` en el JSON", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m), { ...F, file: CHAT });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, archivo: CHAT, archivos: [CHAT], instalacion: conArchivo(CHAT) } });
    expect(JSON.parse(m.archivos.get(ARCHIVO)!)).toEqual(conArchivo(CHAT));
    expect(m.archivos.get(ARCHIVO)).toBe(serializar(conArchivo(CHAT)));
    expect(r.texto).toContain(`file ${CHAT}`);
  });
  it("la ruta se anota normalizada (./, barras de más, separador de Windows)", async () => {
    for (const cruda of [`./${CHAT}`, `app//_supcoflow/./support-chat.tsx`, "app\\_supcoflow\\support-chat.tsx"]) {
      const m = mundo();
      expect((await instalacionAnotar(deps(m), { ...F, file: cruda })).json).toMatchObject({ archivo: CHAT });
    }
  });
  it("`..`, ruta absoluta, unidad de Windows, vacía y carpeta: 3 archivo_invalido, sin pedido y sin escribir", async () => {
    for (const mala of ["../fuera.tsx", "app/../../fuera.tsx", "app/..", "/etc/passwd", "C:\\x\\y.tsx", "\\\\servidor\\x", "", ".", "./", "a\u0000b"]) {
      const m = mundo();
      const r = await instalacionAnotar(deps(m), { ...F, file: mala });
      expect(r, JSON.stringify(mala)).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
      expect(m.pedidos, JSON.stringify(mala)).toEqual([]);
      expect(m.escritos, JSON.stringify(mala)).toEqual([]);
    }
  });
  it("un symlink (el archivo mismo o una carpeta del camino): 3 archivo_invalido y no escribe", async () => {
    const delArchivo = mundo({ enlaces: new Map([[`/w/r/${CHAT}`, "/w/r/otro.tsx"]]) });
    expect(await instalacionAnotar(deps(delArchivo), { ...F, file: CHAT })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    const deCarpeta = mundo({ enlaces: new Map([["/w/r/app", "/fuera/app"]]) });
    const r = await instalacionAnotar(deps(deCarpeta), { ...F, file: CHAT });
    expect(r).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    expect(r.texto).toContain("app");
    for (const m of [delArchivo, deCarpeta]) {
      expect(m.escritos).toEqual([]);
      expect(m.pedidos).toEqual([]);
    }
  });
  it("el archivo todavía puede no existir (se anota antes de escribirlo, o con --dry-run)", async () => {
    const m = mundo();
    expect(m.archivos.has(`/w/r/${CHAT}`)).toBe(false);
    expect((await instalacionAnotar(deps(m), { ...F, file: CHAT, dryRun: true })).json).toMatchObject({ dry_run: true, archivo: CHAT });
  });
  it("re-correr SIN --file conserva el `archivo` ya anotado (no lo borra)", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, serializar(conArchivo(CHAT)));
    const r = await instalacionAnotar(deps(m), { ...F, skill: "0.2.0" });
    expect(r.json).toMatchObject({ archivo: CHAT, archivos: [CHAT], instalacion: { skill: "0.2.0", archivos: [CHAT] } });
    expect(JSON.parse(m.archivos.get(ARCHIVO)!).archivos).toEqual([CHAT]);
  });
  it("--file nuevo reemplaza al anotado", async () => {
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, serializar(conArchivo(CHAT)));
    expect((await instalacionAnotar(deps(m), { ...F, file: "web/app/_supcoflow/support-chat.tsx" })).json).toMatchObject({ archivo: "web/app/_supcoflow/support-chat.tsx" });
  });
  it("un instalacion.json v1 (version: 1, sin archivo) se lee sin error: archivo null; y se reescribe como v3", async () => {
    const v1 = JSON.stringify({ version: 1, skill: "0.1.0", terminal: "0.6.0", chat: { declarado: "2.2.1", instalado: "2.2.1" }, configuracion: ESPERADA.configuracion }, null, 2) + "\n";
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, v1);
    const r = await instalacionAnotar(deps(m), F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, archivo: null, archivos: [], forma: "widget", sin_cambios: false } });
    expect(JSON.parse(m.archivos.get(ARCHIVO)!)).toMatchObject({ version: 3, forma: "widget", archivos: [], contrato: null });
  });
  it("--file con otro proyecto/clon: --repo sin clon sale 3 sin_clon como antes", async () => {
    expect(await instalacionAnotar(deps(mundo()), { ...F, repo: "otro/repo", file: CHAT })).toMatchObject({ codigo: 3, json: { error: "sin_clon" } });
  });
});

describe("anotadoEn, leerInstalacionAnotada y validarElArchivoDelChat (puras)", () => {
  const VACIO = { forma: null, archivos: [], contrato: null };
  it("sin `version`, ilegible, vacío o de una versión futura: lo anotado vacío, nunca un error", () => {
    const v = (extra: object) => JSON.stringify({ skill: "0.1.0", ...extra });
    expect(anotadoEn(v({}))).toEqual(VACIO);
    expect(anotadoEn("{no es json")).toEqual(VACIO);
    expect(anotadoEn(null)).toEqual(VACIO);
    expect(anotadoEn(v({ version: 4, forma: "widget", archivos: ["a.tsx"] }))).toEqual(VACIO); // de una terminal más nueva: no se adivina
  });
  it("P3-1: antes de la 0.9.0 la única forma era el widget: una v1, o una v2 sin archivo, se leen como widget (sin archivos si no hay)", () => {
    const v = (extra: object) => JSON.stringify({ skill: "0.1.0", ...extra });
    expect(anotadoEn(v({ version: 1 }))).toEqual({ forma: "widget", archivos: [], contrato: null });
    expect(anotadoEn(v({ version: 1, archivo: "app/x.tsx" }))).toEqual({ forma: "widget", archivos: [], contrato: null }); // la v1 no tiene archivo
    expect(anotadoEn(v({ version: 2, archivo: null }))).toEqual({ forma: "widget", archivos: [], contrato: null });
    expect(anotadoEn(v({ version: 2, archivo: "../x" }))).toEqual({ forma: "widget", archivos: [], contrato: null });
  });
  it("v2: el `archivo` es de un widget (la v2 sólo existió para el widget)", () => {
    expect(anotadoEn(JSON.stringify({ version: 2, archivo: "app/_supcoflow/support-chat.tsx" }))).toEqual({ forma: "widget", archivos: ["app/_supcoflow/support-chat.tsx"], contrato: null });
    expect(anotadoEn(JSON.stringify({ version: 2, archivo: null }))).toEqual({ forma: "widget", archivos: [], contrato: null });
  });
  it("v3: de ida y vuelta (serializar → leer) devuelve lo mismo", () => {
    const x: Instalacion = { ...ESPERADA, forma: "interfaz_propia", archivos: ["src/chat/panel.tsx", "src/chat/use-chat.ts"], contrato: "1.1.0" };
    expect(anotadoEn(serializar(x))).toEqual({ forma: "interfaz_propia", archivos: x.archivos, contrato: "1.1.0" });
    expect(anotadoEn(serializar(ESPERADA))).toEqual(VACIO);
  });
  it("v3 con basura: una forma desconocida, una ruta inválida o un contrato que no es semver se descartan de a uno", () => {
    const t = JSON.stringify({ version: 3, forma: "otra", archivos: ["../x", "ok/a.tsx", 3, "ok//b.tsx", "ok/a.tsx"], contrato: "uno" });
    expect(anotadoEn(t)).toEqual({ forma: null, archivos: ["ok/a.tsx"], contrato: null });
    expect(anotadoEn(JSON.stringify({ version: 3, forma: "widget", archivos: "no es lista", contrato: "1.0.0" }))).toEqual({ forma: "widget", archivos: [], contrato: "1.0.0" });
  });
  it("leerInstalacionAnotada distingue ausente, ilegible y leída", () => {
    expect(leerInstalacionAnotada(null)).toEqual({ estado: "ausente" });
    expect(leerInstalacionAnotada("{no es json")).toEqual({ estado: "ilegible" });
    expect(leerInstalacionAnotada("\u0000(unreadable)")).toEqual({ estado: "ilegible" });
    expect(leerInstalacionAnotada("[1]")).toEqual({ estado: "ilegible" });
    expect(leerInstalacionAnotada(serializar(ESPERADA))).toEqual({ estado: "leida", ...VACIO });
    // P3-2: una versión que esta terminal no conoce no es «nada»: es de una terminal más nueva.
    expect(leerInstalacionAnotada(JSON.stringify({ version: 4 }))).toEqual({ estado: "mas_nueva" });
    expect(leerInstalacionAnotada(JSON.stringify({ version: 12 }))).toEqual({ estado: "mas_nueva" });
  });
  it("compararSemver compara número a número (1.10.0 > 1.9.0) e ignora lo que sigue al guion", () => {
    expect(compararSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compararSemver("1.1.0", "1.1.0")).toBe(0);
    expect(compararSemver("1.0.9", "1.1.0")).toBeLessThan(0);
    expect(compararSemver("2.0.0-rc.1", "2.0.0")).toBe(0);
  });
  it("validarElArchivoDelChat normaliza y rechaza con el motivo", () => {
    expect(validarElArchivoDelChat("./a//b.tsx")).toEqual({ ok: true, ruta: "a/b.tsx" });
    expect(validarElArchivoDelChat("../a")).toMatchObject({ ok: false, motivo: expect.stringContaining("..") });
    expect(validarElArchivoDelChat("/a")).toMatchObject({ ok: false, motivo: expect.stringContaining("absolute") });
    expect(validarElArchivoDelChat("a".repeat(301))).toMatchObject({ ok: false });
  });
});

describe("install record --file sobre un repo de git real", () => {
  let tmp: string;
  let raiz: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "supcoflow-instalacion-file-"));
    raiz = realpathSync(tmp);
    execFileSync("git", ["init", "-q"], { cwd: raiz });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/d/r.git"], { cwd: raiz });
    writeFileSync(join(raiz, "package.json"), pkgApp());
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));
  const real = (): DepsDeInstalacion => deps(mundo(), {
    git: gitReal, cwd: raiz, leerArchivoChico, rutaReal: rutaRealOEnNada, esCarpeta: esCarpetaReal, esEnlace: esEnlaceReal,
    escribir: archivosDelRepo(() => {}).escribir, avisar: () => {},
  });
  it("un symlink real a un archivo, o una carpeta del camino que es un symlink: 3 archivo_invalido y no escribe nada", async () => {
    mkdirSync(join(raiz, "app", "_supcoflow"), { recursive: true });
    writeFileSync(join(raiz, "real.tsx"), "x");
    symlinkSync(join(raiz, "real.tsx"), join(raiz, "app", "_supcoflow", "support-chat.tsx"));
    expect(await instalacionAnotar(real(), { ...F, file: "app/_supcoflow/support-chat.tsx" })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    mkdirSync(join(raiz, "fuera"), { recursive: true });
    symlinkSync(join(raiz, "fuera"), join(raiz, "web"));
    expect(await instalacionAnotar(real(), { ...F, file: "web/support-chat.tsx" })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    expect(existsSync(join(raiz, RUTA_DE_LA_INSTALACION))).toBe(false);
  });
  it("un archivo real: lo anota (v3) y repetir da sin_cambios", async () => {
    mkdirSync(join(raiz, "app", "_supcoflow"), { recursive: true });
    writeFileSync(join(raiz, "app", "_supcoflow", "support-chat.tsx"), "x");
    const r = await instalacionAnotar(real(), { ...F, file: "app/_supcoflow/support-chat.tsx" });
    expect(r).toMatchObject({ codigo: 0, json: { archivo: "app/_supcoflow/support-chat.tsx", sin_cambios: false } });
    expect(JSON.parse(readFileSync(join(raiz, RUTA_DE_LA_INSTALACION), "utf8"))).toMatchObject({ version: 3, archivos: ["app/_supcoflow/support-chat.tsx"] });
    expect(await instalacionAnotar(real(), { ...F, file: "app/_supcoflow/support-chat.tsx" })).toMatchObject({ json: { sin_cambios: true } });
  });
});

// ─── T8: instalacion.json v3 (forma, archivos y versión del contrato) ───
describe("install record: forma, archivos y contrato (v3)", () => {
  const A = "src/chat/support-panel.tsx";
  const B = "src/chat/use-support-chat.ts";
  const CONTRATO = "/w/r/node_modules/@supcoflow/chat/contract.json";
  const propia: Instalacion = { ...ESPERADA, forma: "interfaz_propia", archivos: [A, B], contrato: "1.1.0" };
  const conContrato = (v = "1.1.0") => { const m = mundo(); m.archivos.set(CONTRATO, contratoJson(v)); return m; };

  it("--shape own-interface con dos --file: anota la forma, los dos archivos en el orden dado y el contrato del paquete instalado", async () => {
    const m = conContrato();
    const r = await instalacionAnotar(deps(m), { ...F, shape: "own-interface", files: [A, B] });
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, archivo: A, archivos: [A, B], forma: "interfaz_propia", contrato: "1.1.0", instalacion: propia } });
    expect(m.archivos.get(ARCHIVO)).toBe(serializar(propia));
    expect(r.texto).toContain("own interface");
    expect(r.texto).toContain(`files ${A}, ${B}`);
    expect(r.texto).toContain("contract 1.1.0");
  });
  it("--shape widget anota el widget; sin contract.json (un paquete viejo) el contrato es null", async () => {
    const m = mundo();
    const r = await instalacionAnotar(deps(m), { ...F, shape: "widget", file: A });
    expect(r.json).toMatchObject({ forma: "widget", archivos: [A], contrato: null, instalacion: { ...ESPERADA, forma: "widget", archivos: [A] } });
  });
  it("--shape inventado: 3 forma_invalida, sin pedido y sin escribir", async () => {
    for (const mala of ["own", "Widget", "interfaz_propia", "bubble"]) {
      const m = mundo();
      expect(await instalacionAnotar(deps(m), { ...F, shape: mala }), mala).toMatchObject({ codigo: 3, json: { error: "forma_invalida" } });
      expect(m.pedidos).toEqual([]);
      expect(m.escritos).toEqual([]);
    }
  });
  it("--shape solo (sin archivos) anota la forma; el contrato se lee igual", async () => {
    const r = await instalacionAnotar(deps(conContrato()), { ...F, shape: "own-interface" });
    expect(r.json).toMatchObject({ forma: "interfaz_propia", archivos: [], archivo: null, contrato: "1.1.0" });
  });
  it("re-correr sin --shape ni --file conserva la forma y los archivos (y refresca el contrato)", async () => {
    const m = conContrato("1.2.0");
    m.versionado = true;
    m.archivos.set(ARCHIVO, serializar(propia));
    const r = await instalacionAnotar(deps(m), { ...F, skill: "0.2.0" });
    expect(r.json).toMatchObject({ forma: "interfaz_propia", archivos: [A, B], contrato: "1.2.0", sin_cambios: false });
    expect(JSON.parse(m.archivos.get(ARCHIVO)!)).toMatchObject({ version: 3, skill: "0.2.0", forma: "interfaz_propia", archivos: [A, B], contrato: "1.2.0" });
  });
  it("--file reemplaza la lista entera (no la acumula) y --shape reemplaza la forma", async () => {
    const m = conContrato();
    m.versionado = true;
    m.archivos.set(ARCHIVO, serializar(propia));
    const r = await instalacionAnotar(deps(m), { ...F, file: "src/otro.tsx", shape: "widget" });
    expect(r.json).toMatchObject({ forma: "widget", archivos: ["src/otro.tsx"] });
  });
  it("las rutas repetidas (aun escritas distinto) se anotan una vez; una inválida frena todo; más de 20 también", async () => {
    const m = mundo();
    expect((await instalacionAnotar(deps(m), { ...F, files: [A, `./${A}`, B] })).json).toMatchObject({ archivos: [A, B] });
    const m2 = mundo();
    expect(await instalacionAnotar(deps(m2), { ...F, files: [A, "../fuera.tsx"] })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    const muchos = Array.from({ length: 21 }, (_, i) => `src/chat/f${i}.tsx`);
    expect(await instalacionAnotar(deps(m2), { ...F, files: muchos })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    expect(m2.pedidos).toEqual([]);
    expect(m2.escritos).toEqual([]);
  });
  it("un symlink en cualquiera de los archivos: 3 archivo_invalido y no escribe", async () => {
    const m = mundo({ enlaces: new Map([[`/w/r/${B}`, "/w/r/otro.ts"]]) });
    expect(await instalacionAnotar(deps(m), { ...F, files: [A, B] })).toMatchObject({ codigo: 3, json: { error: "archivo_invalido" } });
    expect(m.escritos).toEqual([]);
  });
  it("`files` manda sobre `file`; `file` solo sigue valiendo (la skill 0.3.x)", async () => {
    expect((await instalacionAnotar(deps(mundo()), { ...F, file: A, files: [B] })).json).toMatchObject({ archivos: [B] });
    expect((await instalacionAnotar(deps(mundo()), { ...F, file: A })).json).toMatchObject({ archivos: [A], archivo: A });
  });
  it("un instalacion.json v2 con `archivo` se lee como widget con ese archivo y se reescribe v3", async () => {
    const v2 = JSON.stringify({ ...ESPERADA, version: 2, forma: undefined, archivos: undefined, contrato: undefined, archivo: A }, null, 2) + "\n";
    const m = mundo({ versionado: true });
    m.archivos.set(ARCHIVO, v2);
    const r = await instalacionAnotar(deps(m), F);
    expect(r.json).toMatchObject({ archivo: A, archivos: [A], forma: "widget", sin_cambios: false });
    expect(JSON.parse(m.archivos.get(ARCHIVO)!)).toEqual({ ...ESPERADA, forma: "widget", archivos: [A] });
  });
  it("el contrato se busca como el paquete: el node_modules más cercano a la app, sin salir del repo", async () => {
    const m = mundo();
    m.archivos.set("/w/r/apps/web/package.json", pkgApp());
    m.archivos.set("/w/r/apps/web/node_modules/@supcoflow/chat/package.json", pkgChat("2.4.0"));
    m.archivos.set("/w/r/apps/web/node_modules/@supcoflow/chat/contract.json", contratoJson("1.1.0"));
    m.archivos.set(CONTRATO, contratoJson("0.9.0"));
    const r = await instalacionAnotar(deps(m), { ...F, app: "apps/web" });
    expect(r.json).toMatchObject({ contrato: "1.1.0", instalacion: { chat: { instalado: "2.4.0" } } });
  });
  it("un contract.json ilegible o sin versión semver: 1 paquete_ilegible, no escribe", async () => {
    for (const malo of ["{no es json", JSON.stringify({ name: "x" }), JSON.stringify({ version: "uno" })]) {
      const m = mundo();
      m.archivos.set(CONTRATO, malo);
      expect(await instalacionAnotar(deps(m), F), malo).toMatchObject({ codigo: 1, json: { error: "paquete_ilegible" } });
      expect(m.escritos).toEqual([]);
    }
  });
  it("un contract.json que es un enlace hacia afuera del repo no se lee: contrato null y un aviso", async () => {
    const m = mundo({ enlaces: new Map([[CONTRATO, "/fuera/contract.json"]]) });
    m.archivos.set("/fuera/contract.json", contratoJson("9.9.9"));
    const r = await instalacionAnotar(deps(m), F);
    expect(r.json).toMatchObject({ contrato: null });
    expect(m.avisos.join(" ")).toContain("points outside the repo");
  });
  it("P2-4: cambiar la forma SIN --file no hereda los archivos de la forma anterior (ni de v2 a interfaz propia, ni al revés)", async () => {
    const v2 = JSON.stringify({ ...ESPERADA, version: 2, forma: undefined, archivos: undefined, contrato: undefined, archivo: "app/_supcoflow/support-chat.tsx" }, null, 2) + "\n";
    const m = conContrato();
    m.versionado = true;
    m.archivos.set(ARCHIVO, v2);
    const aPropia = await instalacionAnotar(deps(m), { ...F, shape: "own-interface" });
    expect(aPropia.json).toMatchObject({ forma: "interfaz_propia", archivos: [], archivo: null });
    const m2 = conContrato();
    m2.versionado = true;
    m2.archivos.set(ARCHIVO, serializar(propia));
    const aWidget = await instalacionAnotar(deps(m2), { ...F, shape: "widget" });
    expect(aWidget.json).toMatchObject({ forma: "widget", archivos: [] });
    // La misma forma, o una forma que no estaba dicha, sí conserva los archivos.
    const m3 = conContrato();
    m3.versionado = true;
    m3.archivos.set(ARCHIVO, serializar(propia));
    expect((await instalacionAnotar(deps(m3), { ...F, shape: "own-interface" })).json).toMatchObject({ archivos: [A, B] });
    const m4 = conContrato();
    m4.versionado = true;
    m4.archivos.set(ARCHIVO, serializar({ ...ESPERADA, archivos: [A] }));
    expect((await instalacionAnotar(deps(m4), { ...F, shape: "own-interface" })).json).toMatchObject({ forma: "interfaz_propia", archivos: [A] });
  });
  it("P3-2: un instalacion.json de una terminal más nueva (version 4 o más) no se reescribe: 4 escrito_por_una_terminal_mas_nueva", async () => {
    const m = mundo({ versionado: true });
    const futuro = JSON.stringify({ version: 4, forma: "interfaz_propia", archivos: [A] });
    m.archivos.set(ARCHIVO, futuro);
    const r = await instalacionAnotar(deps(m), { ...F, shape: "widget" });
    expect(r).toMatchObject({ codigo: 4, json: { error: "escrito_por_una_terminal_mas_nueva" } });
    expect(r.texto).toMatch(/update supcoflow/i);
    expect(m.escritos).toEqual([]);
    expect(m.archivos.get(ARCHIVO)).toBe(futuro);
  });
  it("armarInstalacion: la forma, los archivos y el contrato entran por una lista cerrada", () => {
    const base = { skill: "0.1.0", terminal: "0.6.0", paqueteDeLaApp: JSON.parse(pkgApp()), paqueteInstalado: JSON.parse(pkgChat()), configuracion: CONFIG };
    expect(armarInstalacion({ ...base, forma: "interfaz_propia", archivos: [A], contrato: JSON.parse(contratoJson()) })).toEqual({ ...ESPERADA, forma: "interfaz_propia", archivos: [A], contrato: "1.1.0" });
    expect(armarInstalacion(base)).toEqual(ESPERADA);
    expect(() => armarInstalacion({ ...base, contrato: { version: "x" } })).toThrow(expect.objectContaining({ error: "paquete_ilegible" }));
    // Una clave pegada en el contract.json no llega al archivo: sólo se copia la versión.
    expect(serializar(armarInstalacion({ ...base, contrato: { version: "1.1.0", secreto: CLAVE } }))).not.toContain("scf_");
  });
});
