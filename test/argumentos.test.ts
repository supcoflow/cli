import { describe, expect, it } from "vitest";
import { leerArgumentos } from "../src/argumentos.ts";
import { COMANDOS_VIEJOS, FLAGS_VIEJOS } from "../src/alias.ts";

const VACIOS = {
  json: false, dryRun: false, fromGithub: false, help: false, start: false, wait: false, repo: null, install: null, test: null,
  site: null, title: null, greeting: null, file: null, allow: null, mode: null, name: null, saveTo: null, id: null, source: null, theme: [],
  skill: null, app: null, authorizeSpend: false, message: null, testId: null, ceiling: null, expectPolicy: null,
};

it("lee comando y flags", () => {
  expect(leerArgumentos(["login", "--start", "--json"])).toEqual({
    comando: "login",
    flags: { ...VACIOS, json: true, start: true },
    viejos: [],
  });
});
it("sin comando es null (se muestra la ayuda)", () => {
  expect(leerArgumentos([]).comando).toBeNull();
});
it("un flag desconocido es entrada inválida (3), no se ignora", () => {
  expect(() => leerArgumentos(["login", "--estart"])).toThrowError(expect.objectContaining({ codigo: 3, error: "flag_desconocido" }));
});
it("acepta `--dry-run`", () => {
  expect(leerArgumentos(["logout", "--dry-run"]).flags.dryRun).toBe(true);
});
it("un comando de dos palabras", () => {
  expect(leerArgumentos(["repo", "connect", "--start", "--json"]).comando).toBe("repo connect");
  expect(leerArgumentos(["project", "create", "--install", "pnpm i", "--test", "pnpm test"]).flags)
    .toMatchObject({ install: "pnpm i", test: "pnpm test" });
});
it("--repo lleva valor", () => {
  expect(leerArgumentos(["project", "show", "--repo", "duenio/repo"]).flags.repo).toBe("duenio/repo");
  expect(() => leerArgumentos(["project", "show", "--repo", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
});
it("un flag con valor repetido o sin valor es entrada inválida", () => {
  expect(() => leerArgumentos(["project", "show", "--repo", "a/b", "--repo", "c/d"])).toThrowError(
    expect.objectContaining({ codigo: 3, error: "argumentos_invalidos" }),
  );
  expect(() => leerArgumentos(["project", "show", "--repo"])).toThrowError(expect.objectContaining({ codigo: 3 }));
});
it("tres posicionales son de más", () => {
  expect(() => leerArgumentos(["repo", "connect", "ya"])).toThrowError(expect.objectContaining({ codigo: 3, error: "argumentos_de_mas" }));
});
it("una palabra sola de un compuesto queda como comando (el despacho la rechaza)", () => {
  expect(leerArgumentos(["repo"]).comando).toBe("repo");
  expect(leerArgumentos(["repo", "borrar"]).comando).toBe("repo");
});

describe("los comandos canónicos, en inglés", () => {
  it("los de dos palabras", () => {
    for (const c of ["repo connect", "project create", "project show", "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove",
      "data set", "policy set", "keys create", "keys list", "keys revoke", "guide check", "guide publish", "guide show", "guide use", "guide versions",
      "install record"]) {
      expect(leerArgumentos(c.split(" ")).comando).toBe(c);
    }
  });
  it("los de una palabra", () => {
    for (const c of ["login", "logout", "whoami", "describe", "catalog", "config", "widget", "diagnose", "test"]) {
      expect(leerArgumentos([c]).comando).toBe(c);
    }
  });
});

describe("los alias castellanos llegan al mismo comando", () => {
  it("cada nombre viejo se resuelve al canónico y se anota como viejo", () => {
    for (const [viejo, nuevo] of Object.entries(COMANDOS_VIEJOS)) {
      const r = leerArgumentos(viejo.split(" "));
      expect(r.comando, viejo).toBe(nuevo);
      expect(r.viejos, viejo).toContain(viejo);
    }
  });
  it("son los 24 que tenía la 0.7.0 (los únicos nuevos son `guide versions`, en inglés desde el principio)", () => {
    expect(Object.keys(COMANDOS_VIEJOS)).toHaveLength(24);
  });
  it("cada flag viejo llega al mismo campo que el canónico", () => {
    const casos: [string[], string[], Record<string, unknown>][] = [
      [["policy", "set", "--modo", "guardar"], ["policy", "set", "--mode", "save"], { mode: "guardar" }],
      [["test", "--autorizo-gasto"], ["test", "--authorize-spend"], { authorizeSpend: true }],
      [["test", "--mensaje", "hola"], ["test", "--message", "hola"], { message: "hola" }],
      [["test", "--wait", "--prueba", "prb_0123456789abcdef"], ["test", "--wait", "--test-id", "prb_0123456789abcdef"], { testId: "prb_0123456789abcdef" }],
      [["guide", "publish", "--desde-github"], ["guide", "publish", "--from-github"], { fromGithub: true }],
      [["data", "set", "--permitir", "nada"], ["data", "set", "--allow", "nothing"], { allow: "nada" }],
      [["sites", "add", "--sitio", "https://a"], ["sites", "add", "--site", "https://a"], { site: "https://a" }],
      [["chat", "logo", "--archivo", "logo.png"], ["chat", "logo", "--file", "logo.png"], { file: "logo.png" }],
      [["keys", "create", "--nombre", "ci", "--guardar-en", "/tmp/k"], ["keys", "create", "--name", "ci", "--save-to", "/tmp/k"], { name: "ci", saveTo: "/tmp/k" }],
      [["guide", "use", "--origen", "repo"], ["guide", "use", "--source", "repo"], { source: "repo" }],
      [["chat", "brand", "--titulo", "Ayuda", "--saludo", "Hola"], ["chat", "brand", "--title", "Ayuda", "--greeting", "Hola"], { title: "Ayuda", greeting: "Hola" }],
    ];
    for (const [viejo, nuevo, campos] of casos) {
      const v = leerArgumentos(viejo);
      expect(v.flags, viejo.join(" ")).toMatchObject(campos);
      expect(v.viejos.length, viejo.join(" ")).toBeGreaterThan(0);
      const n = leerArgumentos(nuevo);
      expect(n.viejos, nuevo.join(" ")).toEqual([]);
      // El valor del canónico llega con el mismo nombre de campo.
      expect(Object.keys(campos).every((k) => k in n.flags), nuevo.join(" ")).toBe(true);
    }
  });
  it("cada flag viejo de la tabla tiene su caso arriba (no queda ninguno sin probar)", () => {
    expect(Object.keys(FLAGS_VIEJOS).sort()).toEqual([
      "archivo", "autorizo-gasto", "desde-github", "guardar-en", "mensaje", "modo", "nombre", "origen", "permitir", "prueba", "saludo", "sitio", "titulo", "tema",
    ].sort());
  });
  it("el nombre viejo y el nuevo de un mismo flag cuentan como repetido", () => {
    expect(() => leerArgumentos(["policy", "set", "--mode", "save", "--modo", "guardar"])).toThrowError(
      expect.objectContaining({ codigo: 3, error: "argumentos_invalidos" }),
    );
  });
});

describe("flags de configurar", () => {
  it("--theme (y --tema) se puede repetir y se junta en orden", () => {
    expect(leerArgumentos(["chat", "brand", "--theme", "acento=#000", "--theme", "fondo=#fff"]).flags.theme).toEqual(["acento=#000", "fondo=#fff"]);
    expect(leerArgumentos(["chat", "marca", "--theme", "a=1", "--tema", "b=2", "--theme", "c=3"]).flags.theme).toEqual(["a=1", "b=2", "c=3"]);
  });
  it("Review Focus 10: --theme vacío o --site repetido salen 3", () => {
    expect(() => leerArgumentos(["chat", "brand", "--theme", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["sites", "add", "--site", "https://a", "--site", "https://b"])).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
  it("--from-github llega como fromGithub (falso por defecto)", () => {
    expect(leerArgumentos(["guide", "publish", "--from-github"]).flags.fromGithub).toBe(true);
    expect(leerArgumentos(["guide", "publish"]).flags.fromGithub).toBe(false);
  });
  it("--source llega como source, y repetido o vacío sale 3", () => {
    expect(leerArgumentos(["guide", "use", "--source", "repo"]).flags.source).toBe("repo");
    expect(leerArgumentos(["guide", "show"]).flags.source).toBeNull();
    expect(() => leerArgumentos(["guide", "use", "--source", "repo", "--source", "agent"])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["guide", "use", "--source", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
  it("`widget` es simple, `install record` compuesto; --skill, --app y --file llevan valor, una sola vez", () => {
    expect(leerArgumentos(["widget", "--json"]).comando).toBe("widget");
    const a = leerArgumentos(["install", "record", "--skill", "0.1.0", "--app", "web", "--file", "app/_supcoflow/support-chat.tsx"]);
    expect(a.comando).toBe("install record");
    expect(a.flags).toMatchObject({ skill: "0.1.0", app: "web", file: "app/_supcoflow/support-chat.tsx" });
    expect(leerArgumentos(["install", "record"]).flags).toMatchObject({ skill: null, app: null, file: null });
    expect(() => leerArgumentos(["install", "record", "--skill", "0.1.0", "--skill", "0.2.0"])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["install", "record", "--app", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["install", "record", "--file", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["widget", "show"])).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
  it("--save-to llega como saveTo", () => {
    expect(leerArgumentos(["keys", "create", "--save-to", "/tmp/k"]).flags.saveTo).toBe("/tmp/k");
  });
});

it("la prueba: --authorize-spend, --ceiling, --expect-policy, --message y --test-id; ninguno se repite ni va vacío", () => {
  expect(leerArgumentos(["test", "--authorize-spend", "--ceiling", "2", "--expect-policy", "investigate", "--message", "hola", "--json"]).flags)
    .toMatchObject({ authorizeSpend: true, ceiling: "2", expectPolicy: "investigate", message: "hola", testId: null });
  expect(leerArgumentos(["test", "--wait", "--test-id", "prb_0123456789abcdef"]).flags).toMatchObject({ wait: true, testId: "prb_0123456789abcdef" });
  expect(() => leerArgumentos(["test", "--message", "a", "--message", "b"])).toThrowError(expect.objectContaining({ codigo: 3 }));
  expect(() => leerArgumentos(["test", "--test-id", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
  expect(() => leerArgumentos(["test", "--ceiling", "2", "--ceiling", "3"])).toThrowError(expect.objectContaining({ codigo: 3 }));
  expect(() => leerArgumentos(["test", "--expect-policy", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
});

it("el aviso de un flag desconocido y los demás errores de lectura están en inglés", () => {
  expect(() => leerArgumentos(["login", "--estart"])).toThrowError(/Unknown flag --estart/);
  expect(() => leerArgumentos(["repo", "connect", "ya"])).toThrowError(/more than one command/i);
  expect(() => leerArgumentos(["project", "show", "--repo"])).toThrowError(/--repo/);
});
