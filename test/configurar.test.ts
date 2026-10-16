// test/configurar.test.ts
import { describe, expect, it } from "vitest";
import { desenlace, chatLogo, chatMarca, chatPrenderApagar, comandoConfiguracion, sitios, type DepsDeConfigurar } from "../src/comandos/configurar.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };

function deps(o: Partial<DepsDeConfigurar> = {}) {
  const posts: { ruta: string; cuerpo: unknown }[] = [];
  const d: DepsDeConfigurar = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerConfiguracion: async () => ({ chat: { habilitado: false, tope_mensajes_dia: 200 }, sitios: [], acuerdo: null }),
    configurar: async (_a, _c, ruta, cuerpo) => { posts.push({ ruta, cuerpo }); return { status: 200, cuerpo: { ok: true, origenes: ["https://a.com"], habilitado: true } }; },
    subirLogo: async () => ({ status: 200, cuerpo: { ok: true, logo_url: "https://blob/l.png" } }),
    leerArchivoChico: () => ({ bytes: new Uint8Array([1, 2, 3]) }),
    avisar: () => {},
    ...o,
  };
  return { d, posts };
}
const F = { repo: null, sitio: null, titulo: null, saludo: null, tema: [] as string[], archivo: null, dryRun: false };

describe("configurar", () => {
  it("configuracion: 0 con lo que dice el motor", async () => {
    expect(await comandoConfiguracion(deps().d, F)).toMatchObject({ codigo: 0, json: { ok: true, proyecto: "proj_r-1", chat: { habilitado: false } } });
  });
  it("chat prender: POST {habilitado: true} a la route del proyecto", async () => {
    const { d, posts } = deps();
    expect((await chatPrenderApagar(d, F, true)).codigo).toBe(0);
    expect(posts).toEqual([{ ruta: "/api/proyectos/proj_r-1/chat", cuerpo: { habilitado: true } }]);
  });
  it("prender sin guía: 4 skill_no_aprobada con el mensaje del motor", async () => {
    const { d } = deps({ configurar: async () => ({ status: 409, cuerpo: { error: "skill_no_aprobada", message: "Generá y aprobá la base…" } }) });
    expect(await chatPrenderApagar(d, F, true)).toMatchObject({ codigo: 4, json: { error: "skill_no_aprobada" } });
  });
  it("quitar el último con el chat prendido: 3 con «apagá el chat»", async () => {
    const { d } = deps({ configurar: async () => ({ status: 409, cuerpo: { error: "chat_prendido_sin_sitios", message: "Apagá el chat primero." } }) });
    const r = await sitios(d, { ...F, sitio: "https://a.com" }, "quitar");
    expect(r).toMatchObject({ codigo: 3, json: { error: "chat_prendido_sin_sitios" } });
    expect(r.texto).toMatch(/Apagá el chat/);
  });
  it("la lista cambió: 1 (reintentar)", async () => {
    const { d } = deps({ configurar: async () => ({ status: 409, cuerpo: { error: "sitios_cambiaron", message: "…" } }) });
    expect((await sitios(d, { ...F, sitio: "https://a.com" }, "agregar")).codigo).toBe(1);
  });
  it("sitios sin --sitio: 3 sin llamar al motor", async () => {
    const { d, posts } = deps();
    expect((await sitios(d, F, "agregar")).codigo).toBe(3);
    expect(posts).toEqual([]);
  });
  it("Review Focus 14: cambiar sólo el título y después sólo el acento no borra lo demás", async () => {
    let guardada: Record<string, unknown> = { titulo: "Viejo", saludo: "Hola", tema: { acento: "#111", fondo: "#fff" }, logo_url: null };
    const { d } = deps({
      leerConfiguracion: async () => ({ chat: { habilitado: false }, sitios: [], acuerdo: null, marca: guardada }),
      configurar: async (_a, _c, _ruta, cuerpo) => { guardada = { ...(cuerpo as Record<string, unknown>), logo_url: null }; return { status: 200, cuerpo: { ok: true, marca: guardada } }; },
    });
    await chatMarca(d, { ...F, titulo: "Ayuda" });
    expect(guardada).toMatchObject({ titulo: "Ayuda", saludo: "Hola", tema: { acento: "#111", fondo: "#fff" } });
    await chatMarca(d, { ...F, tema: ["acento=#0a7"] });
    expect(guardada).toMatchObject({ titulo: "Ayuda", saludo: "Hola", tema: { acento: "#0a7", fondo: "#fff" } });
  });
  it("chat marca arma {titulo, saludo, tema} con --tema clave=valor", async () => {
    const { d, posts } = deps({ configurar: async (_a, _c, ruta, cuerpo) => { posts.push({ ruta, cuerpo }); return { status: 200, cuerpo: { ok: true, marca: {} } }; } });
    expect((await chatMarca(d, { ...F, titulo: "Ayuda", tema: ["acento=#0a7", "radio=8px"] })).codigo).toBe(0);
    expect(posts[0]).toEqual({ ruta: "/api/proyectos/proj_r-1/chat/marca", cuerpo: { titulo: "Ayuda", tema: { acento: "#0a7", radio: "8px" } } });
  });
  it("Review Focus 10: --tema sin = o repetido: 3 sin llamar", async () => {
    const { d, posts } = deps();
    expect((await chatMarca(d, { ...F, tema: ["acento"] })).codigo).toBe(3);
    expect((await chatMarca(d, { ...F, tema: ["acento=#000", "acento=#fff"] })).codigo).toBe(3);
    expect(posts).toEqual([]);
  });
  it("chat marca sin nada: 3", async () => {
    expect((await chatMarca(deps().d, F)).codigo).toBe(3);
  });
  it("chat logo: tipo por extensión, archivo que no se lee sale 3", async () => {
    expect((await chatLogo(deps().d, { ...F, archivo: "/x/logo.png" })).codigo).toBe(0);
    expect((await chatLogo(deps().d, { ...F, archivo: "/x/logo.gif" })).codigo).toBe(3);
    expect((await chatLogo(deps({ leerArchivoChico: () => ({ error: "es un enlace" }) }).d, { ...F, archivo: "/x/l.png" })).codigo).toBe(3);
  });
  it("configuracion: el acuerdo ilegible o fijado aclara que no cubre la IA del chat", async () => {
    for (const acuerdo of [{ ilegible: true }, { version: 1 }]) {
      const r = await comandoConfiguracion(deps({ leerConfiguracion: async () => ({ chat: {}, sitios: [], acuerdo }) }).d, F);
      expect(r.texto).toMatch(/no cubre lo que ve la IA del chat/);
      expect(r.texto).not.toMatch(/toda IA|ninguna IA/);
    }
  });
  it("configuracion en texto: dice la política en palabras llanas y la marca; el JSON no cambia", async () => {
    const marca = { titulo: "Ayuda", saludo: "Hola", tema: { acento: "#0a7" }, logo_url: "https://blob/l.png" };
    const base = { chat: { habilitado: true }, sitios: [], acuerdo: null };
    const guardar = await comandoConfiguracion(deps({ leerConfiguracion: async () => ({ ...base, marca, politica: { modo: "guardar", fijada_en: null } }) }).d, F);
    expect(guardar.texto).toMatch(/Política de problemas: guardar: los problemas del chat se guardan sin relevar; desde la consola una persona puede pedir el relevamiento/);
    expect(guardar.texto).toMatch(/Marca: título «Ayuda», saludo «Hola», tema acento #0a7, con logo\./);
    expect(guardar.json).toEqual({ ok: true, proyecto: "proj_r-1", ...base, marca, politica: { modo: "guardar", fijada_en: null } });
    const relevar = await comandoConfiguracion(deps({ leerConfiguracion: async () => ({ ...base, marca: null, politica: { modo: "relevar", fijada_en: null } }) }).d, F);
    expect(relevar.texto).toMatch(/Política de problemas: relevar: cada problema se releva y nace el issue \(gasta\)\./);
    expect(relevar.texto).toMatch(/Marca: sin fijar/);
    // Un motor que no manda ninguna de las dos: no se inventa.
    const viejo = await comandoConfiguracion(deps({ leerConfiguracion: async () => base }).d, F);
    expect(viejo.texto).toMatch(/Política de problemas: el motor no la informó\.\nMarca: el motor no la informó\./);
  });
  it("configuracion en texto: título, saludo y tema sin caracteres de control (ESC incluido); el JSON intacto", async () => {
    const marca = { titulo: "Ay\u001b[31muda\u0007", saludo: "Ho\nla\u009b", tema: { "ac\u001bento": "#0a7\u001b[0m" }, logo_url: null };
    const r = await comandoConfiguracion(deps({ leerConfiguracion: async () => ({ chat: {}, sitios: [], acuerdo: null, marca }) }).d, F);
    expect(r.texto).toMatch(/Marca: título «Ay\[31muda», saludo «Hola», tema acento #0a7\[0m, sin logo\./);
    expect(r.texto).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect((r.json as { marca: unknown }).marca).toEqual(marca);
  });
  it("--dry-run no escribe", async () => {
    const { d, posts } = deps();
    expect(await chatPrenderApagar(d, { ...F, dryRun: true }, true)).toMatchObject({ codigo: 0, json: { dry_run: true } });
    expect(posts).toEqual([]);
  });
});

describe("desenlace por sí solo", () => {
  const nunca = () => { throw new Error("no es un éxito"); };
  it("401: falta el login (2)", () => {
    expect(desenlace({ status: 401, cuerpo: { error: "no_autenticado" } }, nunca).codigo).toBe(2);
  });
  it("5xx o una forma que no se entiende: 1", () => {
    expect(desenlace({ status: 503, cuerpo: {} }, nunca).codigo).toBe(1);
    expect(desenlace({ status: 500, cuerpo: { error: "x" } }, nunca).codigo).toBe(1);
    expect(desenlace({ status: 400, cuerpo: null as never }, nunca).codigo).toBe(1);
  });
  it("el resto sigue igual: 4xx de validación 3, skill_no_aprobada 4, transitorios 1", () => {
    expect(desenlace({ status: 400, cuerpo: { error: "x" } }, nunca).codigo).toBe(3);
    expect(desenlace({ status: 409, cuerpo: { error: "skill_no_aprobada" } }, nunca).codigo).toBe(4);
    expect(desenlace({ status: 409, cuerpo: { error: "sitios_cambiaron" } }, nunca).codigo).toBe(1);
  });
});
