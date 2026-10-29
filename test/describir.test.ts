import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatMarca } from "../src/comandos/configurar.ts";
import { ayuda, comandoDescribir, DESCRIPCION } from "../src/comandos/describir.ts";
import { leerArgumentos } from "../src/argumentos.ts";

describe("describe --json", () => {
  it("lista los comandos, los siete códigos y las facultades que la clave no tiene", () => {
    const r = comandoDescribir();
    expect(r.codigo).toBe(0);
    expect(r.json.ok).toBe(true);
    const comandos = r.json.comandos as { nombre: string }[];
    expect(comandos.map((c) => c.nombre).slice(0, 7)).toEqual(["login", "logout", "whoami", "describe", "repo connect", "project create", "project show"]);
    expect(comandos).toHaveLength(29);
    expect(Object.keys(r.json.codigos as object)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    const facultades = r.json.facultades as { nombre: string; con_api_key: boolean }[];
    const sin = facultades.filter((f) => !f.con_api_key).map((f) => f.nombre);
    expect(sin).toEqual(["console_only", "operator"]);
    expect(facultades.filter((f) => f.con_api_key).map((f) => f.nombre)).toEqual(["read", "configure", "test"]);
  });

  it("describe los comandos del bloque 3 con sus códigos", () => {
    const nombres = DESCRIPCION.comandos.map((c) => c.nombre);
    expect(nombres.slice(0, 7)).toEqual(["login", "logout", "whoami", "describe", "repo connect", "project create", "project show"]);
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "repo connect")!.codigos).toEqual([0, 1, 2, 3, 4, 5]);
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "project create")!.flags.join(" ")).toContain("--install");
  });

  it("describe los trece comandos de configurar, cada uno con flag, ejemplo y códigos", () => {
    const nuevos = [
      "catalog", "config", "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove",
      "data set", "policy set", "keys create", "keys list", "keys revoke",
    ];
    for (const n of nuevos) {
      const c = DESCRIPCION.comandos.find((x) => x.nombre === n);
      expect(c, n).toBeDefined();
      expect(c!.flags.length, n).toBeGreaterThan(0);
      expect(c!.ejemplos.length, n).toBeGreaterThan(0);
      expect(c!.codigos.length, n).toBeGreaterThan(0);
    }
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "keys create")!.codigos).toContain(4);
  });

  it("los cuatro comandos de la guía: flags, un ejemplo, y los códigos (el 5 sólo en publicar)", () => {
    const g = (n: string) => DESCRIPCION.comandos.find((x) => x.nombre === n)!;
    for (const n of ["guide check", "guide publish", "guide show", "guide use", "guide versions"]) {
      expect(g(n), n).toBeDefined();
      expect(g(n).flags.length, n).toBeGreaterThan(0);
      expect(g(n).ejemplos, n).toHaveLength(1);
      expect(g(n).codigos, n).toContain(4);
      expect(g(n).codigos.includes(5), n).toBe(n === "guide publish");
    }
    const prender = DESCRIPCION.comandos.find((c) => c.nombre === "chat on")!.resumen;
    expect(prender).toMatch(/current guide/);
    expect(prender).not.toMatch(/Sin skill aprobada/);
    expect(g("guide use").flags.join(" ")).toContain("--source");
    expect(g("guide publish").resumen).toMatch(/directly/);
    expect(g("guide publish").flags.join(" ")).toContain("--from-github");
    expect(g("guide publish").resumen).toMatch(/main branch/);
  });

  it("todo comando de configurar declara el 4: sin proyecto en el repo, o una clave de consulta que no escribe", () => {
    const configurar = DESCRIPCION.comandos.filter((c) => !["login", "logout", "whoami", "describe", "repo connect", "project create", "project show", "catalog", "diagnose", "test"].includes(c.nombre));
    expect(configurar).toHaveLength(19);
    for (const c of configurar) expect(c.codigos, c.nombre).toContain(4);
  });

  it("los textos de data set y config no prometen «all AI» ni «no AI» y dicen el límite (AD2: en 1A el acuerdo no cubre a la IA del chat)", () => {
    for (const n of ["data set", "config"]) {
      const c = DESCRIPCION.comandos.find((x) => x.nombre === n)!;
      const t = `${c.resumen} ${c.flags.join(" ")}`;
      expect(t, n).not.toMatch(/all (the )?AI|no AI/i);
      expect(t, n).toMatch(/doesn't cover what the chat's AI sees/);
    }
  });

  it("bloque 6: `widget` e `install record`, con flags, un ejemplo y sus códigos", () => {
    const g = (n: string) => DESCRIPCION.comandos.find((x) => x.nombre === n)!;
    const w = g("widget");
    expect(w).toBeDefined();
    expect(w.ejemplos).toEqual(["supcoflow widget --json"]);
    expect(w.codigos).toEqual([0, 1, 2, 3, 4]);
    expect(w.flags.join(" ")).toContain("--repo");
    expect(`${w.resumen} ${w.flags.join(" ")}`).toMatch(/sin_proyecto/);
    expect(`${w.resumen} ${w.flags.join(" ")}`).toMatch(/respuesta_inesperada/);
    const i = g("install record");
    expect(i).toBeDefined();
    expect(i.ejemplos).toHaveLength(1);
    expect(i.ejemplos[0]).toMatch(/^supcoflow install record --skill \S+/);
    expect(i.codigos).toEqual([0, 1, 2, 3, 4]);
    const flags = i.flags.join(" ");
    for (const f of ["--skill", "--app", "--file", "--repo", "--dry-run", "--json"]) expect(flags, f).toContain(f);
    // Todos los errores con nombre, para que el asistente sepa qué hacer con cada uno sin probarlo.
    const texto = `${i.resumen} ${flags}`;
    for (const e of [
      "falta_skill", "skill_invalida", "app_fuera_del_repo", "app_inexistente", "sin_clon",
      "cambios_sin_commit", "archivo_no_versionado", "archivo_invalido", "sin_proyecto", "acuerdo_ilegible",
      "paquete_ilegible", "configuracion_inesperada", "archivo_no_escrito", "sin_cambios",
    ]) expect(texto, e).toContain(e);
    // Sólo `install record` nombra --skill y --app.
    for (const c of DESCRIPCION.comandos.filter((x) => x.nombre !== "install record")) {
      expect(c.flags.join(" "), c.nombre).not.toMatch(/--skill|--app/);
    }
  });

  it("la versión es la del package.json, y es la 0.8.1", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(DESCRIPCION.version).toBe(pkg.version);
    expect(pkg.version).toBe("0.8.1");
    // api.ts la manda en el user-agent: a mano, tiene que ser la misma.
    expect(readFileSync(new URL("../src/api.ts", import.meta.url), "utf8")).toContain(`const VERSION = "${pkg.version}";`);
  });

  it("R1, bloque 7: `diagnose` y `test` con sus flags, ejemplos y códigos; los de los bloques 2 a 6 siguen", () => {
    const g = (n: string) => DESCRIPCION.comandos.find((x) => x.nombre === n)!;
    const dg = g("diagnose");
    expect(dg).toBeDefined();
    expect(dg.codigos).toEqual([0, 1, 2, 3, 4]);
    expect(dg.ejemplos).toContain("supcoflow diagnose --json");
    expect(dg.resumen).toMatch(/N of 6/);
    const pr = g("test");
    expect(pr).toBeDefined();
    const flags = pr.flags.join(" ");
    for (const f of ["--authorize-spend", "--ceiling", "--expect-policy", "--wait", "--test-id", "--message", "--dry-run", "--repo", "--json"]) expect(flags, f).toContain(f);
    expect(pr.codigos).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pr.ejemplos).toEqual(expect.arrayContaining(["supcoflow test --json", "supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate --json", "supcoflow test --wait --json"]));
    // Lo que gasta se dice: sin el flag no se manda nada, y el techo lo pone el motor.
    expect(`${pr.resumen} ${flags}`).toMatch(/spends/);
    for (const e of ["intento_pendiente", "prueba_en_curso", "tope_mensual", "falta_autorizacion", "techo_distinto", "politica_distinta"]) expect(`${pr.resumen} ${flags}`, e).toContain(e);
    for (const n of ["login", "repo connect", "project create", "chat on", "guide publish", "widget", "install record"]) expect(g(n), n).toBeDefined();
    // Sólo `test` nombra --authorize-spend, --ceiling, --expect-policy, --message y --test-id.
    for (const c of DESCRIPCION.comandos.filter((x) => x.nombre !== "test")) {
      expect(c.flags.join(" "), c.nombre).not.toMatch(/--authorize-spend|--ceiling|--expect-policy|--message|--test-id/);
    }
  });

  it("cabe en una línea de JSON", () => {
    expect(JSON.stringify(comandoDescribir().json)).not.toContain("\n");
  });
});

describe("la ayuda", () => {
  it("trae ejemplos, armados desde la descripción", () => {
    const t = ayuda(null);
    expect(t).toContain("Examples");
    expect(t).toContain("supcoflow login --start --json");
    for (const c of DESCRIPCION.comandos) expect(t).toContain(c.nombre);
  });

  it("la de un comando trae sus flags y sus ejemplos", () => {
    const t = ayuda("login");
    expect(t).toContain("--wait");
    expect(t).toContain("supcoflow login --wait --json");
  });

  it("la de `repo connect` trae sus dos pasos", () => {
    const t = ayuda("repo connect");
    expect(t).toContain("supcoflow repo connect --start --json");
    expect(t).toContain("supcoflow repo connect --wait --json");
    expect(t).not.toContain("supcoflow login --start");
  });
});

describe("T3.1: ni un nombre castellano en describe (los alias no salen)", () => {
  it("ningún comando, flag, facultad, ejemplo ni código lleva un nombre viejo", async () => {
    const { COMANDOS_VIEJOS, FLAGS_VIEJOS } = await import("../src/alias.ts");
    const todo = JSON.stringify(comandoDescribir().json);
    for (const viejo of Object.keys(COMANDOS_VIEJOS)) expect(todo, viejo).not.toContain(`"${viejo}"`);
    for (const viejo of Object.keys(FLAGS_VIEJOS)) expect(todo, `--${viejo}`).not.toMatch(new RegExp(`--${viejo}(?![a-z-])`));
    for (const c of DESCRIPCION.comandos) for (const e of c.ejemplos) for (const viejo of Object.keys(COMANDOS_VIEJOS)) expect(e, e).not.toContain(`supcoflow ${viejo}`);
    expect(todo).not.toMatch(/[¿¡ñáéíóú]/);
  });
  it("cada comando que describe se resuelve en el despacho (los nombres de describe son los que lee el parser)", async () => {
    const { leerArgumentos } = await import("../src/argumentos.ts");
    for (const c of DESCRIPCION.comandos) expect(leerArgumentos(c.nombre.split(" ")).comando, c.nombre).toBe(c.nombre);
  });
  it("describe --json se escribe en una sola línea con la versión 0.8.1", () => {
    expect(comandoDescribir().json).toMatchObject({ ok: true, version: "0.8.1" });
  });
});

// ─── Revisión 1, hallazgo 2: los ejemplos publicados se ejecutan, y sus claves son las que acepta la API ───
describe("los ejemplos publicados sirven", () => {
  // Las claves de `tema` que acepta el motor (`TemaSchema`, estricto): cualquier otra es 400 invalid_body.
  const CLAVES_DEL_TEMA = ["acento", "fondo", "texto", "textoSuave", "radio", "fuente"];
  const troceo = (e: string) => [...e.replace(/^supcoflow /, "").matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);

  it("`chat brand`: el ejemplo de describe, de la ayuda y del README manda sólo claves de tema que la API admite", async () => {
    const ejemplo = DESCRIPCION.comandos.find((c) => c.nombre === "chat brand")!.ejemplos[0]!;
    const { comando, flags } = leerArgumentos(troceo(ejemplo));
    expect(comando).toBe("chat brand");
    let enviado: Record<string, unknown> = {};
    const d = {
      api: new URL("http://localhost:3000"),
      guardado: { leerClaveCompleta: async () => ({ valor: { clave: `scf_${"a".repeat(16)}_${"b".repeat(64)}`, fuente: "llavero" }, completa: true }) } as never,
      git: async (a: string[]) => (a[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
      cwd: "/w/r",
      buscarProyecto: async () => ({ id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "x", testCommand: "y" }),
      leerConfiguracion: async () => ({ marca: null }),
      configurar: async (_a: URL, _c: string, _r: string, cuerpo: unknown) => { enviado = cuerpo as Record<string, unknown>; return { status: 200, cuerpo: { marca: cuerpo } } as never; },
      subirLogo: async () => ({}) as never, leerArchivoChico: () => ({ error: "x" }), avisar: () => {},
    };
    const r = await chatMarca(d, flags);
    expect(r.codigo).toBe(0);
    const claves = Object.keys((enviado.tema ?? {}) as object);
    expect(claves.length).toBeGreaterThan(0);
    for (const k of claves) expect(CLAVES_DEL_TEMA, `la clave de tema «${k}» del ejemplo`).toContain(k);
    // Lo mismo, textual, en el README y en el aviso de formato del comando.
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const [donde, texto] of [["README", readme], ["ayuda", ayuda("chat brand")]] as const) {
      for (const m of texto.matchAll(/--theme (?!key=)(\w+)=/g)) expect(CLAVES_DEL_TEMA, `${donde}: --theme ${m[1]}`).toContain(m[1]);
    }
    const mal = await chatMarca(d, { ...flags, theme: ["sin-igual"] });
    for (const m of mal.texto.matchAll(/\(for example (\w+)=/g)) expect(CLAVES_DEL_TEMA).toContain(m[1]);
  });

  it("revisión 1, hallazgo 3: todo comando que actúa sobre el proyecto del repo declara la salida 4 (contexto_incoherente)", () => {
    for (const n of ["project create", "project show", "config", "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove", "data set", "policy set",
      "keys create", "keys list", "keys revoke", "guide check", "guide publish", "guide show", "guide use", "guide versions", "widget", "install record", "diagnose", "test"]) {
      expect(DESCRIPCION.comandos.find((c) => c.nombre === n)!.codigos, n).toContain(4);
    }
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "project show")!.resumen).toMatch(/BEFORE `repo connect`/);
  });
});
