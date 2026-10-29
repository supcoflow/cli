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
const F = { repo: null, dryRun: false, allow: null as string | null, mode: null as string | null };
const TODO_CERRADO = {
  usuario_id: false, usuario_rol: false, atributos: [], pagina_y_navegador: false, capturas: false, elementos: false, email: false,
};

describe("leerPermitir", () => {
  it("lo nombrado en true, el resto en false, atributos en orden", () => {
    expect(leerPermitir("user_id, screenshots,attribute:plan,attribute:empresa")).toEqual({
      usuario_id: true, usuario_rol: false, atributos: ["plan", "empresa"], pagina_y_navegador: false,
      capturas: true, elementos: false, email: false,
    });
  });
  it("los siete nombres ingleses cierran su campo de la API (que sigue en castellano)", () => {
    expect(leerPermitir("user_id,user_role,page_and_browser,screenshots,elements,email")).toEqual({
      usuario_id: true, usuario_rol: true, atributos: [], pagina_y_navegador: true, capturas: true, elementos: true, email: true,
    });
  });
  it("los nombres castellanos de la 0.7.0 valen igual y dan el mismo objeto", () => {
    expect(leerPermitir("usuario_id,usuario_rol,pagina_y_navegador,capturas,elementos,email,atributo:plan"))
      .toEqual(leerPermitir("user_id,user_role,page_and_browser,screenshots,elements,email,attribute:plan"));
    expect(leerPermitir("usuario_id, capturas,atributo:plan,atributo:empresa")).toEqual(leerPermitir("user_id,screenshots,attribute:plan,attribute:empresa"));
    expect(leerPermitir("atributo:Plan")).toMatchObject({ atributos: ["Plan"] });
  });
  it("`nothing` es todo cerrado, y `nada` (viejo) también", () => {
    expect(leerPermitir("nothing")).toEqual(TODO_CERRADO);
    expect(leerPermitir("nada")).toEqual(TODO_CERRADO);
  });
  it("Review Focus 10: palabra desconocida, `attribute:` vacío, repetidos, o `nothing` con otra cosa", () => {
    expect(leerPermitir("user")).toHaveProperty("error");
    expect(leerPermitir("usuario")).toHaveProperty("error");
    expect(leerPermitir("attribute:")).toHaveProperty("error");
    expect(leerPermitir("atributo:")).toHaveProperty("error");
    expect(leerPermitir("screenshots,screenshots")).toHaveProperty("error");
    expect(leerPermitir("capturas,screenshots")).toHaveProperty("error");
    expect(leerPermitir("nothing,email")).toHaveProperty("error");
    expect(leerPermitir("nada,email")).toHaveProperty("error");
  });
  it("el nombre del atributo se recorta: « plan» es «plan»; sólo espacios sigue siendo error", () => {
    expect(leerPermitir("attribute: plan")).toMatchObject({ atributos: ["plan"] });
    expect(leerPermitir("attribute:plan ")).toMatchObject({ atributos: ["plan"] });
    expect(leerPermitir("attribute:   ")).toHaveProperty("error");
  });
  it("más de 8 atributos, atributo repetido o de más de 40 caracteres", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => `attribute:a${i}`).join(",");
    expect(leerPermitir(nueve)).toHaveProperty("error");
    expect(leerPermitir(Array.from({ length: 8 }, (_, i) => `attribute:a${i}`).join(","))).not.toHaveProperty("error");
    expect(leerPermitir("attribute:plan,attribute:plan")).toHaveProperty("error");
    expect(leerPermitir(`attribute:${"x".repeat(41)}`)).toHaveProperty("error");
    expect(leerPermitir(`attribute:${"x".repeat(40)}`)).not.toHaveProperty("error");
  });
  it("los errores están en inglés y dicen los valores válidos", () => {
    expect((leerPermitir("user") as { error: string }).error).toMatch(/I don't know «user»\. Valid: user_id, user_role, page_and_browser, screenshots, elements, email, attribute:<name>, or nothing\./);
    expect((leerPermitir("nothing,email") as { error: string }).error).toMatch(/`nothing` goes alone/);
    expect((leerPermitir("email,email") as { error: string }).error).toMatch(/is repeated/);
  });
});

describe("data set", () => {
  it("sin --allow: 3 sin llamar, con el comando nuevo en el mensaje", async () => {
    const { d, posts } = deps();
    const r = await datosFijar(d, F);
    expect(r.codigo).toBe(3);
    expect(r.texto).toMatch(/supcoflow data set --allow user_id,screenshots/);
    expect(posts).toEqual([]);
  });
  it("--allow mal escrito: 3 permitir_invalido sin llamar", async () => {
    const { d, posts } = deps();
    expect(await datosFijar(d, { ...F, allow: "attribute:" })).toMatchObject({ codigo: 3, json: { error: "permitir_invalido" } });
    expect(posts).toEqual([]);
  });
  it("--allow user_id: POST {permitido} con las claves de la API y 0 con la versión, sin prometer toda/ninguna IA", async () => {
    const { d, posts } = deps();
    const r = await datosFijar(d, { ...F, allow: "user_id" });
    expect(r.codigo).toBe(0);
    expect(posts[0].ruta).toBe("/api/proyectos/proj_r-1/acuerdo-de-datos");
    expect(posts[0].cuerpo).toMatchObject({ permitido: { usuario_id: true, email: false } });
    expect(r.texto).toMatch(/version 3/);
    expect(r.texto).toMatch(/not what the chat's AI sees while it talks/);
    expect(r.texto).not.toMatch(/all AI|no AI/i);
  });
  it("--allow con los nombres ingleses y con los viejos manda el MISMO cuerpo a la API", async () => {
    const nuevo = deps();
    const viejo = deps();
    expect((await datosFijar(nuevo.d, { ...F, allow: "user_role,page_and_browser,attribute:plan" })).codigo).toBe(0);
    expect((await datosFijar(viejo.d, { ...F, allow: "usuario_rol,pagina_y_navegador,atributo:plan" })).codigo).toBe(0);
    expect(nuevo.posts[0].cuerpo).toEqual({ permitido: { ...TODO_CERRADO, usuario_rol: true, pagina_y_navegador: true, atributos: ["plan"] } });
    expect(viejo.posts).toEqual(nuevo.posts);
  });
  it("--allow nothing y --allow nada mandan todo cerrado", async () => {
    for (const allow of ["nothing", "nada"]) {
      const { d, posts } = deps();
      expect((await datosFijar(d, { ...F, allow })).codigo).toBe(0);
      expect(posts[0].cuerpo).toEqual({ permitido: TODO_CERRADO });
    }
  });
  it("--dry-run no llama", async () => {
    const { d, posts } = deps();
    expect((await datosFijar(d, { ...F, allow: "nothing", dryRun: true })).json).toMatchObject({ dry_run: true });
    expect(posts).toEqual([]);
  });
});

describe("policy set", () => {
  it("--mode arreglar: 3 sin llamar; sin --mode también", async () => {
    const { d, posts } = deps();
    const r = await politicaFijar(d, { ...F, mode: "arreglar" });
    expect(r).toMatchObject({ codigo: 3, json: { error: "modo_invalido" } });
    expect(r.texto).toMatch(/--mode is `investigate` or `save`/);
    expect((await politicaFijar(d, F)).codigo).toBe(3);
    expect(posts).toEqual([]);
  });
  it("--mode save: POST {modo: guardar} a /politica, y lo dice en inglés", async () => {
    const { d, posts } = deps();
    const r = await politicaFijar(d, { ...F, mode: "save" });
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/Problem policy set: save\./);
    expect(posts).toEqual([{ ruta: "/api/proyectos/proj_r-1/politica", cuerpo: { modo: "guardar" } }]);
  });
  it("--mode investigate: POST {modo: relevar}", async () => {
    const { d, posts } = deps();
    const r = await politicaFijar(d, { ...F, mode: "investigate" });
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/Problem policy set: investigate\./);
    expect(posts).toEqual([{ ruta: "/api/proyectos/proj_r-1/politica", cuerpo: { modo: "relevar" } }]);
  });
  it("los valores viejos (guardar, relevar) siguen valiendo y mandan lo mismo", async () => {
    for (const [mode, modo] of [["guardar", "guardar"], ["relevar", "relevar"]] as const) {
      const { d, posts } = deps();
      expect((await politicaFijar(d, { ...F, mode })).codigo).toBe(0);
      expect(posts).toEqual([{ ruta: "/api/proyectos/proj_r-1/politica", cuerpo: { modo } }]);
    }
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
