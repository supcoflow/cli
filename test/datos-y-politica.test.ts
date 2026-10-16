// test/datos-y-politica.test.ts
import { describe, expect, it } from "vitest";
import { comandoCatalogo, datosFijar, leerPermitir, politicaFijar, type DepsDeCatalogo } from "../src/comandos/datos-y-politica.ts";
import type { DepsDeConfigurar } from "../src/comandos/configurar.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };

function deps(o: Partial<DepsDeCatalogo> = {}) {
  const posts: { ruta: string; cuerpo: unknown }[] = [];
  const d: DepsDeCatalogo = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerConfiguracion: async () => ({ chat: {}, sitios: [] }),
    configurar: async (_a, _c, ruta, cuerpo) => {
      posts.push({ ruta, cuerpo });
      return ruta.endsWith("/politica")
        ? { status: 200, cuerpo: { politica: { modo: "guardar", fijada_en: "2026-10-16" } } }
        : { status: 200, cuerpo: { acuerdo: { version: 3, permitido: {} } } };
    },
    subirLogo: async () => ({ status: 200, cuerpo: {} }),
    leerArchivoChico: () => ({ bytes: new Uint8Array() }),
    leerCatalogo: async () => ({ version: 1, supcoflow: [{ clave: "chat", valores: "prendido|apagado" }], codigo_de_la_app: { estado: "sin_contrato", message: "m" } }),
    avisar: () => {},
    ...o,
  } as DepsDeConfigurar & DepsDeCatalogo;
  return { d, posts };
}
const F = { repo: null, dryRun: false, permitir: null as string | null, modo: null as string | null };

describe("leerPermitir", () => {
  it("lo nombrado en true, el resto en false, atributos en orden", () => {
    expect(leerPermitir("usuario_id, capturas,atributo:plan,atributo:empresa")).toEqual({
      usuario_id: true, usuario_rol: false, atributos: ["plan", "empresa"], pagina_y_navegador: false,
      capturas: true, elementos: false, email: false,
    });
  });
  it("`nada` es todo cerrado", () => {
    expect(leerPermitir("nada")).toEqual({
      usuario_id: false, usuario_rol: false, atributos: [], pagina_y_navegador: false, capturas: false, elementos: false, email: false,
    });
  });
  it("Review Focus 10: palabra desconocida, `atributo:` vacío, repetidos, o `nada` con otra cosa", () => {
    expect(leerPermitir("usuario")).toHaveProperty("error");
    expect(leerPermitir("atributo:")).toHaveProperty("error");
    expect(leerPermitir("capturas,capturas")).toHaveProperty("error");
    expect(leerPermitir("nada,email")).toHaveProperty("error");
  });
  it("el nombre del atributo se recorta: « plan» es «plan»; sólo espacios sigue siendo error", () => {
    expect(leerPermitir("atributo: plan")).toMatchObject({ atributos: ["plan"] });
    expect(leerPermitir("atributo:plan ")).toMatchObject({ atributos: ["plan"] });
    expect(leerPermitir("atributo:   ")).toHaveProperty("error");
  });
  it("más de 8 atributos, atributo repetido o de más de 40 caracteres", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => `atributo:a${i}`).join(",");
    expect(leerPermitir(nueve)).toHaveProperty("error");
    expect(leerPermitir(Array.from({ length: 8 }, (_, i) => `atributo:a${i}`).join(","))).not.toHaveProperty("error");
    expect(leerPermitir("atributo:plan,atributo:plan")).toHaveProperty("error");
    expect(leerPermitir(`atributo:${"x".repeat(41)}`)).toHaveProperty("error");
    expect(leerPermitir(`atributo:${"x".repeat(40)}`)).not.toHaveProperty("error");
  });
});

describe("datos fijar", () => {
  it("sin --permitir: 3 sin llamar", async () => {
    const { d, posts } = deps();
    expect((await datosFijar(d, F)).codigo).toBe(3);
    expect(posts).toEqual([]);
  });
  it("--permitir mal escrito: 3 permitir_invalido sin llamar", async () => {
    const { d, posts } = deps();
    expect(await datosFijar(d, { ...F, permitir: "atributo:" })).toMatchObject({ codigo: 3, json: { error: "permitir_invalido" } });
    expect(posts).toEqual([]);
  });
  it("--permitir usuario_id: POST {permitido} y 0 con la versión, sin prometer toda/ninguna IA", async () => {
    const { d, posts } = deps();
    const r = await datosFijar(d, { ...F, permitir: "usuario_id" });
    expect(r.codigo).toBe(0);
    expect(posts[0].ruta).toBe("/api/proyectos/proj_r-1/acuerdo-de-datos");
    expect(posts[0].cuerpo).toMatchObject({ permitido: { usuario_id: true, email: false } });
    expect(r.texto).toMatch(/versión 3/);
    expect(r.texto).toMatch(/no lo que ve la IA del chat mientras conversa/);
    expect(r.texto).not.toMatch(/toda IA|ninguna IA/i);
  });
  it("--dry-run no llama", async () => {
    const { d, posts } = deps();
    expect((await datosFijar(d, { ...F, permitir: "nada", dryRun: true })).json).toMatchObject({ dry_run: true });
    expect(posts).toEqual([]);
  });
});

describe("politica fijar", () => {
  it("--modo arreglar: 3 sin llamar; sin --modo también", async () => {
    const { d, posts } = deps();
    expect(await politicaFijar(d, { ...F, modo: "arreglar" })).toMatchObject({ codigo: 3, json: { error: "modo_invalido" } });
    expect((await politicaFijar(d, F)).codigo).toBe(3);
    expect(posts).toEqual([]);
  });
  it("--modo guardar: POST {modo} a /politica", async () => {
    const { d, posts } = deps();
    expect((await politicaFijar(d, { ...F, modo: "guardar" })).codigo).toBe(0);
    expect(posts).toEqual([{ ruta: "/api/proyectos/proj_r-1/politica", cuerpo: { modo: "guardar" } }]);
  });
});

describe("catalogo", () => {
  it("0 con codigo_de_la_app.estado y una línea por item", async () => {
    const r = await comandoCatalogo(deps().d);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, codigo_de_la_app: { estado: "sin_contrato" } } });
    expect(r.texto).toMatch(/chat: prendido\|apagado/);
  });
  it("sin sesión: 2", async () => {
    const { d } = deps({ guardado: { leerClaveCompleta: async () => ({ valor: null, completa: true }) } as never });
    expect((await comandoCatalogo(d)).codigo).not.toBe(0);
  });
});
