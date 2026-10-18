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
  nextjs: { estado: "probando", archivo_sugerido: "app/supcoflow-chat.tsx", contenido: CONTENIDO, uso: "<SupcoflowChat />" },
  script: { estado: "disponible_sin_soporte", linea: '<script src="https://chat.supcoflow.dev/widget.js" data-project="proj_1"></script>' },
  csp: "connect-src 'self' https://chat.supcoflow.dev;",
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
    expect(texto).toContain(CONTENIDO); // ningún reemplazo de ids en la terminal
    expect(texto).toContain(W.nextjs.uso);
    expect(texto).toContain(W.csp);
    const i = texto.indexOf("disponible, no probada en una app real");
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
    const r = await widget(deps({ leerWidget: async () => { throw new FalloDeLaTerminal(SALIDA.inesperado, "respuesta_inesperada", "El motor respondió 200 con algo que no esperaba."); } }), F);
    expect(r.codigo).toBe(SALIDA.inesperado);
    expect(r.json).toMatchObject({ ok: false, error: "respuesta_inesperada" });
  });

  it("un mensaje con secretos que se cuele en el error se tapa", async () => {
    const r = await widget(deps({ leerWidget: async () => { throw new Error(`clave ${CLAVE}`); } }), F);
    expect(r.texto).not.toContain(CLAVE);
    expect(JSON.stringify(r.json)).not.toContain(CLAVE);
  });
});
