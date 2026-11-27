// Etapa 2c, de punta a punta: el binario COMPILADO (a un directorio propio, para no pisar el `dist/` que usa `sin-tty.test.ts`) contra un servidor HTTP falso que
// contesta con las formas del contrato de la puerta v1 y de la API de reportes del PR 215. Sin terminal, sin llavero, sin producción.
// Lo que se clava acá: qué pedido sale (método, ruta, cabeceras, cuerpo), que la clave del agente sólo viaja en `Authorization`, que nunca sale por stdout ni stderr, que un
// 401 o un 403 son UN solo pedido (no se prueba otra credencial) y que lo que gasta no se manda sin la autorización.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CLAVE_DE_AGENTE, CLAVE_DE_CHAT, CLAVE_DE_PERSONA, DIAGNOSTICO, ESTADO_DEL_AGENTE, FALLO, HUELLA_DEL_FALLO, HUELLA_DEL_RESULTADO, LECTURA_DEL_FALLO, LECTURA_PUBLICADA, LISTA_DE_REPORTES,
  PASE, PEDAZOS_DE_LA_CLAVE, PROYECTO, RECORRIDO_INVESTIGABLE, RECORRIDO_SIN_ACCIONES, RESPUESTA_DEL_PASE, RESULTADO, recorridoDe,
} from "./puerta-fixtures.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

type Visto = { metodo: string; ruta: string; consulta: string; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string };
type Corrida = { codigo: number | null; stdout: string; stderr: string };

let servidor: Server;
let api: string;
let tmp: string;
let cli: string;
let repo: string;
let vistos: Visto[] = [];
// Las entregas que el motor falso ya recibió, por id: lo que hace un motor de verdad con `Idempotency-Key` (misma huella → 200 repetido; otra → 409).
let entregas = new Map<string, { cuerpo: string; reporte: string }>();
let investigaciones: string[] = [];

const json = (res: import("node:http").ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(cuerpo));
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "supcoflow-puerta-"));
  cli = join(tmp, "dist", "cli.js");
  // Se compila a un directorio propio: dos archivos de test que escriben el mismo `dist/` a la vez se pisarían.
  execFileSync("npx", ["tsc", "-p", "tsconfig.json", "--outDir", join(tmp, "dist")], { cwd: RAIZ, stdio: "ignore" });
  repo = join(tmp, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/d/r.git"], { cwd: repo });

  servidor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const ruta = url.pathname;
      const metodo = req.method ?? "GET";
      vistos.push({ metodo, ruta, consulta: url.search, cabeceras: req.headers, cuerpo });
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const base = "/api/v1/proyectos/proj_ejemplo/reportes";

      // ── la puerta de los agentes: sólo una clave de agente ──────────────────────────────────────────
      if (ruta.startsWith("/api/v1/agente") || /^\/api\/v1\/reportes\//.test(ruta)) {
        if (bearer === "") return json(res, 401, { error: "clave_invalida", message: "Esta ruta es de los agentes: hace falta `Authorization: Bearer <clave de agente>`." });
        if (bearer === CLAVE_DE_PERSONA) return json(res, 403, { error: "solo_agentes", message: "Esta ruta es de las claves de agente: una persona no entra." });
        if (bearer !== CLAVE_DE_AGENTE && bearer !== CLAVE_DE_CHAT) return json(res, 401, { error: "clave_revocada", message: `La clave ${bearer} está revocada.` });
        if (ruta === "/api/v1/agente") return json(res, 200, ESTADO_DEL_AGENTE);
        const id = ruta.split("/")[4]!;
        const sub = ruta.split("/")[5];
        if (bearer === CLAVE_DE_CHAT && sub !== undefined) return json(res, 403, { error: "tipo_de_clave", message: "Esta clave es de chat: no entrega resultados." });
        if (id === "rpt_deotroproyecto") return json(res, 404, { error: "reporte_inexistente" });
        if (id === "rpt_ajeno0001") return json(res, 409, { error: "no_asignado", message: "Este reporte lo tiene asignado otro investigador." });
        if (metodo === "GET" && sub === undefined) {
          if (id === "rpt_ejemplo0001") return json(res, 200, LECTURA_PUBLICADA);
          if (id === "rpt_ejemplo0010") return json(res, 200, LECTURA_DEL_FALLO);
          return json(res, 200, { reporte_id: id, proyecto_id: "proj_ejemplo", creado_en: "2026-12-01T11:59:58Z", canal: "chat", investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" }, estado: "esperando_a_tu_agente", te_necesitan: false });
        }
        if (metodo === "POST" && sub === "pase") return json(res, 201, { ...RESPUESTA_DEL_PASE, reporte_id: id });
        if (metodo === "PUT" && (sub === "resultado" || sub === "fallo")) {
          const clave = String(req.headers["idempotency-key"] ?? "");
          if (!/^ent_[A-Za-z0-9_-]{1,100}$/.test(clave)) return json(res, 400, { error: "idempotency_key_invalida" });
          const previa = entregas.get(clave);
          if (previa !== undefined) {
            if (previa.cuerpo !== cuerpo) return json(res, 409, { error: "entrega_con_otro_contenido", huella_guardada: HUELLA_DEL_RESULTADO, huella_recibida: HUELLA_DEL_FALLO });
            return json(res, 200, sub === "fallo" ? { entrega: clave, huella: HUELLA_DEL_FALLO, estado: "el_agente_fallo", te_necesitan: true, repetido: true } : { entrega: clave, huella: HUELLA_DEL_RESULTADO, publicacion: "publicado", issue: { numero: 412, url: "https://github.com/ejemplo/app/issues/412" }, repetido: true });
          }
          if ([...entregas.values()].some((e) => e.reporte === id)) return json(res, 409, { error: "reporte_ya_tiene_entrega", entrega: "ent_ejemplo0001", publicacion: "publicado" });
          const parsed = JSON.parse(cuerpo) as Record<string, unknown>;
          if (sub === "fallo" && "por_que" in parsed) return json(res, 422, { error: "campo_no_permitido", campos: ["por_que"] });
          if (sub === "fallo" && parsed.motivo === "se_cayo_el_servidor") return json(res, 422, { error: "motivo_desconocido", validos: ["contenido_no_disponible", "repositorio_no_disponible", "modelo_no_disponible", "tiempo_agotado", "error_del_agente"] });
          if (sub === "resultado" && parsed.intencion === "inventada") return json(res, 422, { error: "resultado_invalido", problemas: ["intencion:invalid_value"] });
          entregas.set(clave, { cuerpo, reporte: id });
          return sub === "fallo"
            ? json(res, 200, { entrega: clave, huella: HUELLA_DEL_FALLO, estado: "el_agente_fallo", te_necesitan: true })
            : json(res, 202, { entrega: clave, huella: HUELLA_DEL_RESULTADO, publicacion: "publicando", filtrado: { campos_quitados: ["usuario.id", "entorno"], lineas_quitadas: 1 } });
        }
        return json(res, 404, { error: "no_existe" });
      }

      // ── las rutas de una persona ───────────────────────────────────────────────────────────────────
      if (bearer !== CLAVE_DE_PERSONA && bearer !== CLAVE_DE_AGENTE) return json(res, 401, { error: "clave_invalida", message: "La clave ya no vale." });
      if (bearer === CLAVE_DE_AGENTE) return json(res, 403, { error: "clave_de_agente", message: "Una clave de agente no sirve para esta ruta." });
      if (ruta === "/api/proyectos" && url.searchParams.get("repo") === "d/r") return json(res, 200, { proyecto: PROYECTO });
      if (ruta === "/api/proyectos/proj_ejemplo/diagnostico") return json(res, 200, DIAGNOSTICO);
      if (metodo === "GET" && ruta === base) return json(res, 200, LISTA_DE_REPORTES);
      if (metodo === "GET" && ruta === `${base}/rpt_ejemplo0001`) return json(res, 200, RECORRIDO_SIN_ACCIONES);
      if (metodo === "GET" && ruta === `${base}/rpt_ejemplo0002`) return json(res, 200, RECORRIDO_INVESTIGABLE);
      if (metodo === "GET" && ruta === `${base}/rpt_ejemplo0003`) return json(res, 200, recorridoDe("rpt_ejemplo0003"));
      if (metodo === "GET" && ruta.startsWith(`${base}/`)) return json(res, 404, { error: "reporte_inexistente", message: "No existe ese reporte en este proyecto." });
      if (metodo === "POST" && ruta === `${base}/rpt_ejemplo0002/investigacion`) {
        investigaciones.push("rpt_ejemplo0002");
        return json(res, 202, { reporte_id: "rpt_ejemplo0002", investigacion: "arrancada", via: "supcoflow", run_id: "wrun_0123456789abcdef" });
      }
      if (metodo === "POST" && ruta === `${base}/rpt_ejemplo0003/investigacion`) {
        investigaciones.push("rpt_ejemplo0003");
        return json(res, 202, { reporte_id: "rpt_ejemplo0003", investigacion: "aviso_reenviado", via: "agente_de_afuera", webhook_id: "msg_avs_ejemplo0002", ronda: 2 });
      }
      return json(res, 404, { error: "no_existe" });
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  vistos = [];
  entregas = new Map();
  investigaciones = [];
});

/** Un entorno armado a mano: nada de la máquina de quien corre los tests (una SUPCOFLOW_TOKEN o una clave de agente exportadas) se cuela. */
function correr(args: string[], env: Record<string, string> = {}): Promise<Corrida> {
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, [cli, ...args], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: tmp, XDG_CONFIG_HOME: join(tmp, "config"), SUPCOFLOW_API_URL: api, SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_NO_BROWSER: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    hijo.stdout.on("data", (b) => (stdout += b));
    hijo.stderr.on("data", (b) => (stderr += b));
    const t = setTimeout(() => hijo.kill("SIGKILL"), 30_000);
    hijo.on("close", (codigo) => { clearTimeout(t); resolve({ codigo, stdout, stderr }); });
  });
}

const comoAgente = (args: string[], env: Record<string, string> = {}) => correr(args, { SUPCOFLOW_AGENT_KEY: CLAVE_DE_AGENTE, ...env });
const comoPersona = (args: string[], env: Record<string, string> = {}) => correr(args, { SUPCOFLOW_TOKEN: CLAVE_DE_PERSONA, ...env });
const ultima = (c: Corrida) => JSON.parse(c.stdout.trim().split("\n").at(-1)!) as Record<string, unknown>;
const rutas = () => vistos.map((v) => `${v.metodo} ${v.ruta}`);

/** TODO lo que una persona (o un asistente) podría leer de una corrida: nada de la clave del agente. */
function sinFugas(c: Corrida, aparece: string[] = []) {
  let todo = `${c.stdout}\n${c.stderr}`;
  for (const ok of aparece) todo = todo.split(ok).join("");
  for (const trozo of PEDAZOS_DE_LA_CLAVE) expect(todo, `fuga de «${trozo}»`).not.toContain(trozo);
}

describe("gate: la clave del agente", () => {
  it("gate status con la clave en SUPCOFLOW_AGENT_KEY: un GET /api/v1/agente con Authorization y nada más", async () => {
    const c = await comoAgente(["gate", "status", "--json"]);
    expect(c.codigo).toBe(0);
    expect(rutas()).toEqual(["GET /api/v1/agente"]);
    expect(vistos[0]!.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_AGENTE}`);
    expect(vistos[0]!.consulta).toBe("");
    expect(vistos[0]!.cuerpo).toBe("");
    const j = ultima(c);
    expect(j).toMatchObject({ ok: true, agente_id: "agc_inv_ejemplo", tipo: "investigacion", activo: true, es_el_investigador_activo: true, asignados_sin_entregar: 1 });
    expect(j.conectado_por).toEqual({ persona_id: "usr_ejemplo", nombre_visible: "Fulana" });
    expect(j.tope).toEqual({ avisos_por_hora: 60, usados_esta_hora: 3 });
    sinFugas(c);
  });

  it("el texto de gate status dice quién es, si está activo, el último aviso y lo que falta entregar", async () => {
    const c = await comoAgente(["gate", "status"]);
    expect(c.codigo).toBe(0);
    expect(c.stdout).toContain("investigation agent");
    expect(c.stdout).toContain("agc_inv_ejemplo");
    expect(c.stdout).toContain("connected by Fulana");
    expect(c.stdout).toMatch(/Last notice: 2026-12-01T12:00:00Z, 1 attempt\(s\), answered 200/);
    expect(c.stdout).toMatch(/not delivered: 1/);
    expect(c.stdout).toMatch(/Notices this hour: 3 of 60 \(informative/);
    sinFugas(c);
  });

  it("--from-env NOMBRE lee la clave de OTRA variable; la de SUPCOFLOW_AGENT_KEY no se mira", async () => {
    const c = await correr(["gate", "status", "--from-env", "MI_AGENTE", "--json"], { MI_AGENTE: CLAVE_DE_AGENTE, SUPCOFLOW_AGENT_KEY: CLAVE_DE_CHAT });
    expect(c.codigo).toBe(0);
    expect(vistos[0]!.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_AGENTE}`);
    sinFugas(c);
  });

  it("no hay un flag que reciba la clave: `--key` es flag_desconocido, no se manda nada y el valor no se repite", async () => {
    const c = await correr(["gate", "status", "--key", CLAVE_DE_AGENTE, "--json"]);
    expect(c.codigo).toBe(3);
    expect(ultima(c).error).toBe("flag_desconocido");
    expect(vistos).toHaveLength(0);
    sinFugas(c);
  });

  it("la clave pegada donde va el NOMBRE de la variable no se repite ni se manda", async () => {
    const c = await correr(["gate", "status", "--from-env", CLAVE_DE_AGENTE, "--json"]);
    expect(c.codigo).toBe(3);
    expect(ultima(c).error).toBe("clave_como_nombre");
    expect(vistos).toHaveLength(0);
    sinFugas(c);
  });

  it("sin clave y sin terminal: sale 2 sin_clave_de_agente, no pregunta y no manda nada", async () => {
    const c = await correr(["gate", "status", "--json"]);
    expect(c.codigo).toBe(2);
    expect(ultima(c).error).toBe("sin_clave_de_agente");
    expect(String(ultima(c).message)).toContain("SUPCOFLOW_AGENT_KEY");
    expect(vistos).toHaveLength(0);
  });

  it("la clave de una PERSONA no se prueba como clave de agente: 3 es_una_clave_de_persona, nada sale a la red", async () => {
    const c = await correr(["gate", "status", "--json"], { SUPCOFLOW_AGENT_KEY: CLAVE_DE_PERSONA });
    expect(c.codigo).toBe(3);
    expect(ultima(c).error).toBe("es_una_clave_de_persona");
    expect(vistos).toHaveLength(0);
    expect(`${c.stdout}${c.stderr}`).not.toContain(CLAVE_DE_PERSONA);
  });

  it("la clave de login guardada o SUPCOFLOW_TOKEN no se usan en la puerta: sin la del agente, nada se manda", async () => {
    const c = await correr(["gate", "status", "--json"], { SUPCOFLOW_TOKEN: CLAVE_DE_PERSONA });
    expect(c.codigo).toBe(2);
    expect(vistos).toHaveLength(0);
  });

  it("un 401 (clave revocada): sale 2, UN solo pedido, dice que no prueba otra y no repite la clave aunque el motor la repita", async () => {
    const revocada = `${CLAVE_DE_AGENTE}-revocada`;
    const c = await correr(["gate", "status", "--json"], { SUPCOFLOW_AGENT_KEY: revocada });
    expect(c.codigo).toBe(2);
    expect(vistos).toHaveLength(1);
    const j = ultima(c);
    expect(j.error).toBe("clave_revocada");
    expect(String(j.message)).toMatch(/revoked/);
    expect(String(j.message)).toMatch(/doesn't try another/);
    sinFugas(c);
    expect(`${c.stdout}${c.stderr}`).not.toContain("revocada-");
  });

  it("un 403 (clave de chat que entrega): sale 4 tipo_de_clave, UN solo pedido y la frase es de la terminal, no la del motor", async () => {
    const c = await correr(["gate", "pass", "--id", "rpt_ejemplo0001", "--json"], { SUPCOFLOW_AGENT_KEY: CLAVE_DE_CHAT });
    expect(c.codigo).toBe(4);
    expect(vistos).toHaveLength(1);
    const j = ultima(c);
    expect(j.error).toBe("tipo_de_clave");
    expect(String(j.message)).not.toContain("Esta clave es de chat");
    expect(String(j.message)).toMatch(/investigation key/);
    expect(`${c.stdout}${c.stderr}`).not.toContain("clachat01");
  });
});

describe("gate: leer, pedir el pase, entregar y avisar el fallo", () => {
  it("gate read de un reporte publicado: el issue, la decisión y la publicación", async () => {
    const c = await comoAgente(["gate", "read", "--id", "rpt_ejemplo0001", "--json"]);
    expect(c.codigo).toBe(0);
    expect(rutas()).toEqual(["GET /api/v1/reportes/rpt_ejemplo0001"]);
    const j = ultima(c);
    expect(j).toMatchObject({ ok: true, reporte_id: "rpt_ejemplo0001", decision: "abrir_issue", intencion: "error", necesita_persona: false });
    expect(j.publicacion).toMatchObject({ estado: "publicado", entrega: "ent_ejemplo0001", huella: HUELLA_DEL_RESULTADO, issue: { numero: 412, url: "https://github.com/ejemplo/app/issues/412" } });
    // Lo corto no trae lo declarado ni el costo: `--full` sí.
    expect(j.agente_declarado).toBeUndefined();
    expect(j.costo).toBeUndefined();
    const f = ultima(await comoAgente(["gate", "read", "--id", "rpt_ejemplo0001", "--full", "--json"]));
    expect(f.agente_declarado).toMatchObject({ nombre: "investigador-de-referencia", version: "0.1.0", modelo: "anthropic/claude-sonnet-5" });
    expect(f.costo).toEqual({ declarado_por_el_agente: true, tokens_entrada: 182340, tokens_salida: 4210, usd: 0.61 });
  });

  it("gate read de un reporte donde el agente falló: la entrega es un fallo y no hay publicación", async () => {
    const c = await comoAgente(["gate", "read", "--id", "rpt_ejemplo0010", "--json"]);
    expect(c.codigo).toBe(0);
    const j = ultima(c);
    expect(j).toMatchObject({ estado: "el_agente_fallo", te_necesitan: true, publicacion: null });
    expect(j.entrega).toEqual({ tipo: "fallo", entrega: "ent_fallo0001", huella: HUELLA_DEL_FALLO, motivo: "modelo_no_disponible" });
    expect(c.stdout).not.toContain("abrir igual");
    const t = await comoAgente(["gate", "read", "--id", "rpt_ejemplo0010"]);
    expect(t.stdout).toMatch(/You reported a failure \(modelo_no_disponible\)/);
  });

  it("gate read de un reporte que espera el resultado dice los pasos que siguen", async () => {
    const c = await comoAgente(["gate", "read", "--id", "rpt_ejemplo0007"]);
    expect(c.stdout).toContain("supcoflow gate pass --id rpt_ejemplo0007");
    expect(c.stdout).toContain("supcoflow gate deliver --id rpt_ejemplo0007 --file result.json");
  });

  it("un reporte de otro proyecto es 404 → 3, y uno asignado a otro es 409 → 4: dicho por la terminal", async () => {
    const otro = await comoAgente(["gate", "read", "--id", "rpt_deotroproyecto", "--json"]);
    expect(otro.codigo).toBe(3);
    expect(ultima(otro).error).toBe("reporte_inexistente");
    const ajeno = await comoAgente(["gate", "read", "--id", "rpt_ajeno0001", "--json"]);
    expect(ajeno.codigo).toBe(4);
    expect(ultima(ajeno).error).toBe("no_asignado");
    expect(String(ultima(ajeno).message)).not.toContain("otro investigador");
  });

  it("--id mal escrito o ausente: 3, sin red y sin repetir el valor", async () => {
    const mal = await comoAgente(["gate", "read", "--id", "../../etc/passwd", "--json"]);
    expect(mal.codigo).toBe(3);
    expect(ultima(mal).error).toBe("id_invalido");
    expect(mal.stdout).not.toContain("passwd");
    const falta = await comoAgente(["gate", "read", "--json"]);
    expect(falta.codigo).toBe(3);
    expect(ultima(falta).error).toBe("falta_id");
    expect(vistos).toHaveLength(0);
  });

  it("gate pass: el pase sale (es para lo que se pide), la clave no, y no viaja cuerpo", async () => {
    const c = await comoAgente(["gate", "pass", "--id", "rpt_ejemplo0001", "--json"]);
    expect(c.codigo).toBe(0);
    expect(rutas()).toEqual(["POST /api/v1/reportes/rpt_ejemplo0001/pase"]);
    expect(vistos[0]!.cuerpo).toBe("");
    const j = ultima(c);
    expect(j).toMatchObject({
      ok: true, pase: PASE, audiencia: "agc_chat_ejemplo", contenido: { url: "https://agentes-de-supcoflow.example.com/api/supcoflow/contenido", ref: "msg_cli_7f3a" },
      reporte_id: "rpt_ejemplo0001", para: { tipo: "agente", id: "agc_inv_ejemplo" }, permisos: ["leer"], vence_en: "2026-12-01T12:05:00Z",
    });
    // El acuerdo llega ENTERO: el agente lo aplica antes de pasarle nada al modelo.
    expect(j.acuerdo).toEqual({ usuario_id: false, usuario_rol: true, atributos: [], pagina_y_navegador: true, capturas: true, elementos: false, email: false });
    sinFugas(c, [PASE]);
    const t = await comoAgente(["gate", "pass", "--id", "rpt_ejemplo0001"]);
    expect(t.stdout).toContain(`pass: ${PASE}`);
    expect(t.stdout).toMatch(/Authorization: Bearer <pass>/);
    expect(t.stdout).toMatch(/never in the URL/);
    sinFugas(t, [PASE]);
  });

  it("gate pass de un reporte que no es suyo: 4 no_asignado y NINGÚN pase en la salida", async () => {
    const c = await comoAgente(["gate", "pass", "--id", "rpt_ajeno0001", "--json"]);
    expect(c.codigo).toBe(4);
    expect(`${c.stdout}${c.stderr}`).not.toContain("pse_");
  });

  describe("deliver", () => {
    const archivo = (nombre: string, cuerpo: unknown) => {
      const p = join(tmp, nombre);
      writeFileSync(p, typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo));
      return p;
    };

    it("PUT /resultado con Idempotency-Key ent_…, el archivo TAL CUAL como cuerpo, y 202 publicando", async () => {
      const crudo = JSON.stringify(RESULTADO, null, 2);
      const p = archivo("resultado.json", crudo);
      const c = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", p, "--json"]);
      expect(c.codigo).toBe(0);
      expect(rutas()).toEqual(["PUT /api/v1/reportes/rpt_ejemplo0001/resultado"]);
      expect(vistos[0]!.cuerpo).toBe(crudo);
      expect(vistos[0]!.cabeceras["content-type"]).toBe("application/json");
      const id = String(vistos[0]!.cabeceras["idempotency-key"]);
      expect(id).toMatch(/^ent_[0-9a-f]{32}$/);
      expect(vistos[0]!.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_AGENTE}`);
      const j = ultima(c);
      expect(j).toMatchObject({ ok: true, reporte_id: "rpt_ejemplo0001", entrega: id, huella: HUELLA_DEL_RESULTADO, publicacion: "publicando" });
      expect(j.filtrado).toEqual({ campos_quitados: ["usuario.id", "entorno"], lineas_quitadas: 1 });
      sinFugas(c);
    });

    it("repetir el MISMO comando es la misma entrega (mismo id): 200 repetido, ninguna publicación nueva; otro archivo es otra entrega y el motor lo dice", async () => {
      const p = archivo("resultado.json", RESULTADO);
      const a = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", p, "--json"]);
      const b = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", p, "--json"]);
      expect(a.codigo).toBe(0);
      expect(b.codigo).toBe(0);
      expect(vistos[1]!.cabeceras["idempotency-key"]).toBe(vistos[0]!.cabeceras["idempotency-key"]);
      expect(ultima(b)).toMatchObject({ ok: true, repetido: true, publicacion: "publicado", issue: { numero: 412 } });
      const otro = archivo("otro.json", { ...RESULTADO, intencion: "pedido_de_mejora" });
      const c = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", otro, "--json"]);
      expect(c.codigo).toBe(4);
      expect(vistos[2]!.cabeceras["idempotency-key"]).not.toBe(vistos[0]!.cabeceras["idempotency-key"]);
      expect(ultima(c)).toMatchObject({ ok: false, error: "reporte_ya_tiene_entrega", entrega: "ent_ejemplo0001" });
    });

    it("--delivery elige el id (y el mismo id con otro contenido es entrega_con_otro_contenido, con las huellas)", async () => {
      const a = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("a.json", RESULTADO), "--delivery", "ent_ejemplo0001", "--json"]);
      expect(a.codigo).toBe(0);
      expect(vistos[0]!.cabeceras["idempotency-key"]).toBe("ent_ejemplo0001");
      const b = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("b.json", { ...RESULTADO, intencion: "pedido_de_mejora" }), "--delivery", "ent_ejemplo0001", "--json"]);
      expect(b.codigo).toBe(3);
      expect(ultima(b)).toMatchObject({ error: "entrega_con_otro_contenido", huella_guardada: HUELLA_DEL_RESULTADO, huella_recibida: HUELLA_DEL_FALLO });
      const mala = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("c.json", RESULTADO), "--delivery", "no-es-un-id", "--json"]);
      expect(mala.codigo).toBe(3);
      expect(ultima(mala).error).toBe("entrega_invalida");
    });

    it("un 422 del motor se dice con el campo y el código, nunca con el valor", async () => {
      const c = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("mala.json", { ...RESULTADO, intencion: "inventada" }), "--json"]);
      expect(c.codigo).toBe(3);
      expect(ultima(c)).toMatchObject({ ok: false, error: "resultado_invalido", problemas: ["intencion:invalid_value"] });
      expect(c.stdout).not.toContain("inventada");
    });

    it("un archivo que no existe, que no es JSON o que no es un objeto: 3 y sin red", async () => {
      const falta = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--json"]);
      expect(ultima(falta).error).toBe("falta_archivo");
      const noExiste = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", join(tmp, "no-existe.json"), "--json"]);
      expect(ultima(noExiste).error).toBe("archivo_ilegible");
      const roto = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("roto.json", "{no es json"), "--json"]);
      expect(ultima(roto).error).toBe("archivo_invalido");
      const lista = await comoAgente(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("lista.json", "[1,2]"), "--json"]);
      expect(ultima(lista).error).toBe("archivo_invalido");
      expect([falta, noExiste, roto, lista].map((x) => x.codigo)).toEqual([3, 3, 3, 3]);
      expect(vistos).toHaveLength(0);
    });

    it("--dry-run lee y comprueba el archivo, no pide la clave y no manda nada", async () => {
      const c = await correr(["gate", "deliver", "--id", "rpt_ejemplo0001", "--file", archivo("resultado.json", RESULTADO), "--dry-run", "--json"]);
      expect(c.codigo).toBe(0);
      expect(ultima(c)).toMatchObject({ ok: true, dry_run: true, reporte_id: "rpt_ejemplo0001" });
      expect(String(ultima(c).entrega)).toMatch(/^ent_[0-9a-f]{32}$/);
      expect(vistos).toHaveLength(0);
    });
  });

  describe("fail", () => {
    const archivo = (cuerpo: unknown) => {
      const p = join(tmp, "fallo.json");
      writeFileSync(p, JSON.stringify(cuerpo));
      return p;
    };

    it("PUT /fallo con el cuerpo cerrado: 200, el reporte pasa a «Te necesitan» (el_agente_fallo) y no hay publicación", async () => {
      const c = await comoAgente(["gate", "fail", "--id", "rpt_ejemplo0010", "--file", archivo(FALLO), "--json"]);
      expect(c.codigo).toBe(0);
      expect(rutas()).toEqual(["PUT /api/v1/reportes/rpt_ejemplo0010/fallo"]);
      expect(JSON.parse(vistos[0]!.cuerpo)).toEqual(FALLO);
      expect(ultima(c)).toMatchObject({ ok: true, entrega: String(vistos[0]!.cabeceras["idempotency-key"]), huella: HUELLA_DEL_FALLO, estado: "el_agente_fallo", te_necesitan: true });
      expect((await comoAgente(["gate", "fail", "--id", "rpt_ejemplo0010", "--file", archivo(FALLO)])).stdout).toMatch(/already recorded/);
    });

    it("un campo que el contrato no tiene (texto libre) se rechaza por NOMBRE: el valor no vuelve a ninguna salida", async () => {
      const c = await comoAgente(["gate", "fail", "--id", "rpt_ejemplo0012", "--file", archivo({ ...FALLO, por_que: "The user ana@example.com reported a crash." }), "--json"]);
      expect(c.codigo).toBe(3);
      expect(ultima(c)).toMatchObject({ ok: false, error: "campo_no_permitido", campos: ["por_que"] });
      expect(`${c.stdout}${c.stderr}`).not.toContain("ana@example.com");
    });

    it("un motivo fuera de la lista dice cuáles valen", async () => {
      const c = await comoAgente(["gate", "fail", "--id", "rpt_ejemplo0012", "--file", archivo({ ...FALLO, motivo: "se_cayo_el_servidor" }), "--json"]);
      expect(c.codigo).toBe(3);
      expect(ultima(c).validos).toEqual(["contenido_no_disponible", "repositorio_no_disponible", "modelo_no_disponible", "tiempo_agotado", "error_del_agente"]);
      expect(c.stdout).not.toContain("se_cayo");
      const t = await comoAgente(["gate", "fail", "--id", "rpt_ejemplo0012", "--file", archivo({ ...FALLO, motivo: "se_cayo_el_servidor" })]);
      expect(t.stdout).toContain("Valid values: contenido_no_disponible");
    });
  });
});

describe("reports: la bandeja vista por una persona", () => {
  it("reports list: GET /api/v1/proyectos/{id}/reportes con la clave de la persona; JSON corto, sin la prosa del motor", async () => {
    const c = await comoPersona(["reports", "list", "--json"]);
    expect(c.codigo).toBe(0);
    expect(rutas()).toEqual(["GET /api/proyectos", "GET /api/v1/proyectos/proj_ejemplo/reportes"]);
    expect(vistos[1]!.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_PERSONA}`);
    expect(vistos[1]!.consulta).toBe("");
    const j = ultima(c);
    expect(j).toMatchObject({ ok: true, proyecto: "proj_ejemplo", repo: "d/r", filtro: "todos", total: 3, pagina: 1, paginas: 1, por_pagina: 25 });
    expect(j.conteo).toMatchObject({ con_issue: 1, tu_agente_no_contesto: 1 });
    const filas = j.reportes as Record<string, unknown>[];
    expect(filas.map((f) => f.reporte_id)).toEqual(["rpt_ejemplo0001", "rpt_ejemplo0002", "rpt_ejemplo0003"]);
    expect(filas[0]).toEqual({
      reporte_id: "rpt_ejemplo0001", titulo: "No anda el login", creado_en: "2026-12-01T07:00:00Z", estado: "con_issue", te_necesitan: false,
      issue: { numero: 12, url: "https://github.com/ejemplo/app/issues/12" }, investigador: { tipo: "supcoflow", agente_id: null },
    });
    expect(filas[2]).toMatchObject({ estado: "tu_agente_no_contesto", te_necesitan: true, titulo: null, investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" } });
    expect(j.ahora).toBeUndefined();
    expect(filas[0]!.estado_texto).toBeUndefined();
    const t = await comoPersona(["reports", "list"]);
    expect(t.stdout).toContain("rpt_ejemplo0001  2026-12-01  issue created, issue #12");
    expect(t.stdout).toContain("your agent didn't answer  [needs you]");
    expect(t.stdout).not.toContain("tu agente no contestó");
    const f = ultima(await comoPersona(["reports", "list", "--full", "--json"]));
    expect(f.ahora).toBe("2026-12-01T12:00:00Z");
    expect((f.reportes as Record<string, unknown>[])[0]).toMatchObject({ origen: "externo", estado_texto: "issue creado" });
  });

  it("--filter, --page y --per-page viajan como filtro, pagina y por_pagina; uno inválido no manda nada", async () => {
    const c = await comoPersona(["reports", "list", "--filter", "needs-you", "--page", "2", "--per-page", "10", "--json"]);
    expect(c.codigo).toBe(0);
    expect(new URLSearchParams(vistos[1]!.consulta).get("filtro")).toBe("necesitan");
    expect(new URLSearchParams(vistos[1]!.consulta).get("pagina")).toBe("2");
    expect(new URLSearchParams(vistos[1]!.consulta).get("por_pagina")).toBe("10");
    vistos = [];
    const mal = await comoPersona(["reports", "list", "--filter", "todo-lo-que-hay", "--json"]);
    expect(mal.codigo).toBe(3);
    expect(ultima(mal).error).toBe("filtro_invalido");
    const grande = await comoPersona(["reports", "list", "--per-page", "101", "--json"]);
    expect(ultima(grande).error).toBe("parametro_invalido");
    expect(vistos).toHaveLength(0);
  });

  it("reports show: el recorrido en inglés fijo; en JSON los eventos con clave, cuando y href, y las acciones", async () => {
    const c = await comoPersona(["reports", "show", "--id", "rpt_ejemplo0001", "--json"]);
    expect(c.codigo).toBe(0);
    expect(rutas()).toEqual(["GET /api/proyectos", "GET /api/v1/proyectos/proj_ejemplo/reportes/rpt_ejemplo0001"]);
    const j = ultima(c);
    expect(j).toMatchObject({ ok: true, reporte_id: "rpt_ejemplo0001", estado: "con_issue", te_necesitan: false, acciones: [], siguiente: null, issue: { numero: 12 } });
    expect(j.eventos).toEqual([{ clave: "reportado", cuando: "2026-12-01T07:00:00Z", href: null }, { clave: "issue", cuando: "2026-12-01T08:00:00Z", href: "https://github.com/ejemplo/app/issues/12" }]);
    const t = await comoPersona(["reports", "show", "--id", "rpt_ejemplo0001"]);
    expect(t.stdout).toMatch(/State: issue created\./);
    expect(t.stdout).toMatch(/2026-12-01T08:00:00Z {2}issue opened {2}https:\/\/github.com\/ejemplo\/app\/issues\/12/);
    expect(t.stdout).toContain("Nothing to ask for from here right now.");
    expect(t.stdout).not.toContain("Reportado en");
    const full = ultima(await comoPersona(["reports", "show", "--id", "rpt_ejemplo0003", "--full", "--json"]));
    expect(full.avisos).toEqual([expect.objectContaining({ webhook_id: "msg_avs_ejemplo0001", ronda: 1, entrega: "agotado", resolucion: "plazo_vencido", intentos: [{ intento: 1, respuesta: "no_contesta" }, { intento: 6, respuesta: 503 }] })]);
  });

  it("un reporte de otro proyecto o de otro equipo es 404 → 3 reporte_inexistente (nunca 403)", async () => {
    const c = await comoPersona(["reports", "show", "--id", "rpt_nuncaexistio", "--json"]);
    expect(c.codigo).toBe(3);
    expect(ultima(c).error).toBe("reporte_inexistente");
  });

  it("una clave de AGENTE en SUPCOFLOW_TOKEN: el motor dice 403 y la terminal no prueba otra credencial", async () => {
    const c = await correr(["reports", "list", "--json"], { SUPCOFLOW_TOKEN: CLAVE_DE_AGENTE });
    expect(c.codigo).not.toBe(0);
    expect(vistos.length).toBeLessThanOrEqual(1);
    sinFugas(c);
  });

  describe("investigate gasta: sólo con la autorización y el techo que la persona vio", () => {
    it("sin --authorize-spend no manda NADA: 4 falta_autorizacion con el techo y el comando exacto", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--json"]);
      expect(c.codigo).toBe(4);
      expect(investigaciones).toEqual([]);
      expect(rutas().filter((r) => r.startsWith("POST"))).toEqual([]);
      const j = ultima(c);
      expect(j).toMatchObject({
        ok: false, error: "falta_autorizacion", reporte_id: "rpt_ejemplo0002", via: "supcoflow", techo_usd: 2,
        siguiente: "supcoflow reports investigate --id rpt_ejemplo0002 --authorize-spend --ceiling 2",
      });
    });

    it("con --authorize-spend y el techo que se mostró: UN POST /investigacion sin cuerpo, y arranca", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--authorize-spend", "--ceiling", "2", "--json"]);
      expect(c.codigo).toBe(0);
      expect(investigaciones).toEqual(["rpt_ejemplo0002"]);
      const post = vistos.find((v) => v.metodo === "POST")!;
      expect(post.ruta).toBe("/api/v1/proyectos/proj_ejemplo/reportes/rpt_ejemplo0002/investigacion");
      expect(post.cuerpo).toBe("");
      expect(post.cabeceras.authorization).toBe(`Bearer ${CLAVE_DE_PERSONA}`);
      expect(ultima(c)).toMatchObject({ ok: true, reporte_id: "rpt_ejemplo0002", investigacion: "arrancada", via: "supcoflow", run_id: "wrun_0123456789abcdef", techo_usd: 2 });
      expect(vistos.filter((v) => v.metodo === "POST")).toHaveLength(1);
    });

    it("si el techo ya no es el que la persona autorizó: 4 techo_distinto y NO se manda el POST", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--authorize-spend", "--ceiling", "1.5", "--json"]);
      expect(c.codigo).toBe(4);
      expect(ultima(c)).toMatchObject({ ok: false, error: "techo_distinto", techo_usd: 2, autorizado_usd: 1.5 });
      expect(investigaciones).toEqual([]);
    });

    it("--authorize-spend sin --ceiling, y --ceiling sin --authorize-spend: 3 sin tocar el motor", async () => {
      const a = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--authorize-spend", "--json"]);
      expect(a.codigo).toBe(3);
      expect(ultima(a).error).toBe("falta_techo");
      const b = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--ceiling", "2", "--json"]);
      expect(b.codigo).toBe(3);
      expect(ultima(b).error).toBe("flags_incompatibles");
      expect(vistos).toHaveLength(0);
    });

    it("un reporte donde no hay nada que pedir: 4 nada_que_pedir, ni siquiera lee el techo y no se gasta nada", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0001", "--authorize-spend", "--ceiling", "2", "--json"]);
      expect(c.codigo).toBe(4);
      expect(ultima(c)).toMatchObject({ ok: false, error: "nada_que_pedir", estado: "con_issue" });
      expect(rutas().some((r) => r.endsWith("/diagnostico") || r.startsWith("POST"))).toBe(false);
    });

    it("un reporte de un agente de afuera que no contestó: se reenvía el aviso (ronda nueva)", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0003", "--authorize-spend", "--ceiling", "2", "--json"]);
      expect(c.codigo).toBe(0);
      expect(ultima(c)).toMatchObject({ ok: true, investigacion: "aviso_reenviado", via: "agente_de_afuera", webhook_id: "msg_avs_ejemplo0002", ronda: 2 });
      const t = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0003", "--authorize-spend", "--ceiling", "2"]);
      expect(t.stdout).toMatch(/Sent the notice again to your connected agent \(round 2\): it has 2 more hours/);
    });

    it("--dry-run lee el recorrido y el techo y no manda el POST", async () => {
      const c = await comoPersona(["reports", "investigate", "--id", "rpt_ejemplo0002", "--dry-run", "--json"]);
      expect(c.codigo).toBe(0);
      expect(ultima(c)).toMatchObject({ ok: true, dry_run: true, reporte_id: "rpt_ejemplo0002", via: "supcoflow", techo_usd: 2, autorizado: false });
      expect(investigaciones).toEqual([]);
    });
  });
});

describe("describe y los flags de cada mitad", () => {
  it("describe --json lista reports y gate; la clave del agente no tiene flag y --repo no es de gate", async () => {
    const d = ultima(await correr(["describe", "--json"]));
    const nombres = (d.comandos as { nombre: string }[]).map((c) => c.nombre);
    for (const n of ["reports list", "reports show", "reports investigate", "gate status", "gate read", "gate pass", "gate deliver", "gate fail"]) expect(nombres).toContain(n);
    const un = ultima(await correr(["describe", "gate", "deliver", "--json"]));
    expect((un.comando as { nombre: string }).nombre).toBe("gate deliver");
    const repoEnGate = await correr(["gate", "status", "--repo", "d/r", "--json"], { SUPCOFLOW_AGENT_KEY: CLAVE_DE_AGENTE });
    expect(repoEnGate.codigo).toBe(3);
    expect(ultima(repoEnGate).error).toBe("flag_no_aplica");
    expect(vistos).toHaveLength(0);
    const agenteEnReports = await comoPersona(["reports", "list", "--from-env", "X", "--json"]);
    expect(ultima(agenteEnReports).error).toBe("flag_no_aplica");
  });

  it("`agents` sigue siendo la cuenta de IA: `gate` no le quita nada", async () => {
    const c = await correr(["agents", "show", "--agent", "bot", "--json"], { SUPCOFLOW_TOKEN: CLAVE_DE_PERSONA });
    expect(ultima(c).error).toBe("agente_invalido");
  });
});
