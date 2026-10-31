// test/widget.test.ts
import { describe, expect, it } from "vitest";
import type { Widget } from "../src/api.ts";
import { FalloDeLaTerminal, SALIDA } from "../src/contrato.ts";
import { widget, type DepsDeWidget } from "../src/comandos/widget.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const CONTENIDO = '"use client";\nimport { ChatDeIntake } from "@supcoflow/chat";\nexport function SupcoflowChat() {\n  return <ChatDeIntake tenantId="t_1" projectId="proj_1" />;\n}\n';
const W: Widget = {
  tenant_id: "t_1", project_id: "proj_1", backend_url: "https://chat.supcoflow.dev",
  paquete: "@supcoflow/chat", version: "2.2.1", instalar: "npm i @supcoflow/chat@2.2.1 --save-exact",
  nextjs: { estado: "probando", archivo_sugerido: "app/_supcoflow/support-chat.tsx", archivos_anteriores: ["app/_supcoflow/chat-de-soporte.tsx"], contenido: CONTENIDO, uso: "<SupcoflowChat />" },
  script: { estado: "disponible_sin_soporte", linea: '<script src="https://chat.supcoflow.dev/widget.js" data-project="proj_1"></script>' },
  csp: "connect-src 'self' https://chat.supcoflow.dev;",
};

const PROPIA = {
  paquete: "@supcoflow/chat" as const, version: "2.4.0", instalar: "npm i @supcoflow/chat@2.4.0 --save-exact",
  tenant_id: "t_1", project_id: "proj_1", backend_url: "https://chat.supcoflow.dev",
  csp: "connect-src 'self' https://chat.supcoflow.dev;", contrato_version: "1.1.0",
};

function deps(o: Partial<DepsDeWidget> = {}): DepsDeWidget {
  return {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    leerWidget: async () => W,
    ...o,
  };
}
const F = { repo: null };

describe("supcoflow widget", () => {
  it("0 con la forma: --json es {ok:true, ...Widget} y lee el widget del proyecto del repo", async () => {
    let visto: string | undefined;
    const r = await widget(deps({ leerWidget: async (_a, _c, id) => ((visto = id), W) }), F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toEqual({ ok: true, ...W });
    expect(visto).toBe("proj_r-1");
  });

  it("el texto trae los cuatro pasos, el contenido TAL CUAL y la línea de <script> aparte, rotulada", async () => {
    const { texto } = await widget(deps(), F);
    expect(texto).toContain(W.instalar);
    expect(texto).toContain(W.nextjs.archivo_sugerido);
    expect(texto).toContain("If the chat is already installed in app/_supcoflow/chat-de-soporte.tsx, update that file in place instead of creating a second one.");
    expect(texto).toContain(CONTENIDO); // ningún reemplazo de ids en la terminal
    expect(texto).toContain(W.nextjs.uso);
    expect(texto).toContain(W.csp);
    const i = texto.indexOf("available, not tested in a real app");
    expect(i).toBeGreaterThan(-1);
    expect(texto.indexOf(W.script.linea)).toBeGreaterThan(i);
    expect(texto.indexOf(W.script.linea)).toBeGreaterThan(texto.indexOf(W.csp));
  });

  it("sin proyecto: 4 sin_proyecto y no pide el widget", async () => {
    let pidio = false;
    const r = await widget(deps({ buscarProyecto: async () => null, leerWidget: async () => ((pidio = true), W) }), F);
    expect(r.codigo).toBe(SALIDA.haceFaltaUnaPersona);
    expect(r.json).toMatchObject({ ok: false, error: "sin_proyecto" });
    expect(pidio).toBe(false);
  });

  it("sin sesión: 2", async () => {
    const r = await widget(deps({ guardado: { leerClaveCompleta: async () => ({ valor: null, completa: true }) } as never }), F);
    expect(r.codigo).toBe(SALIDA.faltaLogin);
  });

  it("un fallo del motor sale por resultadoDeFallo, sin el mensaje crudo con secretos", async () => {
    const r = await widget(deps({ leerWidget: async () => { throw new FalloDeLaTerminal(SALIDA.inesperado, "respuesta_inesperada", "The engine answered 200 with something it did not expect."); } }), F);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json).toMatchObject({ ok: false, error: "respuesta_inesperada" });
  });

  it("un mensaje con secretos que se cuele en el error se tapa", async () => {
    const r = await widget(deps({ leerWidget: async () => { throw new Error(`clave ${CLAVE}`); } }), F);
    expect(r.texto).not.toContain(CLAVE);
    expect(JSON.stringify(r.json)).not.toContain(CLAVE);
  });

  it("T8: sin `interfaz_propia` el texto no habla de ella ni el JSON la lleva", async () => {
    const r = await widget(deps(), F);
    expect(r.texto).not.toMatch(/own interface/i);
    expect(r.json).not.toHaveProperty("interfaz_propia");
  });

  it("T8: con `interfaz_propia`: el JSON la lleva tal cual y el texto la describe sin dar código para pegar", async () => {
    const r = await widget(deps({ leerWidget: async () => ({ ...W, interfaz_propia: PROPIA }) }), F);
    expect(r.codigo).toBe(SALIDA.ok);
    expect(r.json).toEqual({ ok: true, ...W, interfaz_propia: PROPIA });
    const t = r.texto!;
    // Lo de siempre sigue (el widget es el respaldo) y lo nuevo va aparte, rotulado.
    expect(t).toContain(CONTENIDO);
    const i = t.indexOf("Own interface");
    expect(i).toBeGreaterThan(t.indexOf(W.csp));
    const propia = t.slice(i);
    expect(propia).toContain(PROPIA.instalar);
    for (const dato of [PROPIA.tenant_id, PROPIA.project_id, PROPIA.backend_url, PROPIA.csp, PROPIA.contrato_version]) expect(propia).toContain(dato);
    expect(propia).toContain("node_modules/@supcoflow/chat/contract.json");
    expect(propia).toMatch(/no code to paste/i);
    expect(propia).not.toContain("ChatDeIntake");
  });
});
