// El binario COMPILADO, corrido como lo corre un asistente: sin terminal, stdin cerrado, contra un
// motor falso en un puerto libre. Nunca toca el llavero real: SUPCOFLOW_SIN_LLAVERO=1 siempre,
// porque quitar `security` del PATH no alcanza (la terminal lo llama por ruta absoluta).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(RAIZ, "dist", "cli.js");
const CLAVE_A = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const CLAVE_B = `scf_${"c".repeat(16)}_${"e".repeat(64)}`;

const motor = {
  revocar: 401,
  token: null as null | Record<string, string>,
  revocadas: [] as string[],
  // Bloque 3: la conexión que devuelve el motor y las claves de idempotencia que le llegaron.
  conexion: "pendiente" as "pendiente" | "conectado",
  claves: [] as string[],
  // `GET /api/proyectos?repo=`: sólo los comandos de configurar necesitan que el proyecto ya exista.
  proyectoExiste: false,
  guiaSubida: false,
  // Bloque 7: la prueba. Cada POST con su Idempotency-Key; la misma clave devuelve la misma prueba.
  pruebaPierde: false,
  pruebasPorClave: new Map<string, string>(),
  clavesDePrueba: [] as string[],
  estadoDePrueba: "issue_creado",
};
// La clave que el motor falso devuelve al crear una de consulta: nada de lo que imprima la terminal puede contenerla.
const CLAVE_FALSA = `scf_${"1234567890abcdef"}_${"fedcba0987654321".repeat(4)}`;
const ID_DE_CLAVE = "cla_1234567890abcdef";
const PROYECTO = { id: "proj_abc", slug: "r", repo: "d/r", rama: "main", install_command: "npm ci", test_command: "npm test" };
const pedido = () => ({
  id: "cnx_0123456789abcdef", repo: "d/r", estado: motor.conexion, url: `${api}/conectar/cnx_0123456789abcdef`,
  vence_en: new Date(Date.now() + 1_800_000).toISOString(), repo_canonico: motor.conexion === "conectado" ? "d/r" : null, fallo: null,
});
// Lo que arma el motor para pegar en la app (bloque 6); la terminal lo devuelve tal cual.
const WIDGET = {
  tenant_id: "tnt_1", project_id: PROYECTO.id, backend_url: "https://chat.supcoflow.dev", paquete: "@supcoflow/chat", version: "2.2.1",
  instalar: "npm i @supcoflow/chat@2.2.1 --save-exact",
  nextjs: { estado: "probando", archivo_sugerido: "app/_supcoflow/support-chat.tsx", archivos_anteriores: ["app/_supcoflow/chat-de-soporte.tsx"], contenido: "\"use client\";\nexport {};\n", uso: "<ChatDeSoporte />" },
  script: { estado: "disponible_sin_soporte", linea: "<script src=\"https://chat.supcoflow.dev/w.js\"></script>" },
  csp: "connect-src 'self' https://chat.supcoflow.dev;",
};
const pedidosAlMotor: string[] = [];
let servidor: Server;
let api: string;
let tmp: string;
let archivo: string;

function responder(res: import("node:http").ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

beforeAll(async () => {
  execFileSync("npm", ["run", "build"], { cwd: RAIZ, stdio: "ignore" });
  servidor = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const ruta = new URL(req.url ?? "/", "http://x").pathname;
      pedidosAlMotor.push(ruta);
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const metodo = req.method ?? "GET";
      const base = `/api/proyectos/${PROYECTO.id}`;
      if (ruta === "/api/catalogo") return responder(res, 200, { version: 1, supcoflow: [], codigo_de_la_app: { estado: "sin_contrato", message: "" } });
      if (ruta === "/api/proyectos" && new URL(req.url ?? "/", "http://x").searchParams.has("repo") && motor.proyectoExiste) return responder(res, 200, { proyecto: PROYECTO });
      if (ruta === `${base}/configuracion`) {
        return responder(res, 200, { chat: { habilitado: false }, sitios: [], marca: null, acuerdo: null, politica: { modo: "relevar" }, guia: null });
      }
      if (metodo === "GET" && ruta === `${base}/widget`) return responder(res, 200, WIDGET);
      // La guía: el motor falso contesta lo mínimo que la terminal sabe leer.
      if (metodo === "POST" && ruta === `${base}/guia/revisar`) return responder(res, 200, { ok: true, secciones: 1 });
      if (metodo === "POST" && ruta === `${base}/guia/publicar`) {
        return motor.guiaSubida
          ? responder(res, 200, { ok: true, guia: { origen: "repo", version: 1, rama: "main", commit: "a".repeat(40), secciones: 1 }, ya_publicada: false, reemplaza: null })
          : responder(res, 409, { error: "guia_no_subida", message: "No está en la rama.", rama: "main", commit: "b".repeat(40) });
      }
      if (metodo === "GET" && ruta === `${base}/guia`) return responder(res, 200, { guia: null, otra: null });
      if (metodo === "POST" && ruta === `${base}/guia/origen`) return responder(res, 409, { error: "sin_guia_publicada", message: "No hay guía del repo." });
      if (metodo === "POST" && ruta === `${base}/chat`) return responder(res, 200, { ok: true });
      if (metodo === "POST" && ruta === `${base}/origenes`) return responder(res, 200, { origenes: [] });
      if (metodo === "POST" && ruta === `${base}/chat/marca`) return responder(res, 200, { marca: {} });
      if (metodo === "POST" && ruta === `${base}/chat/logo`) return responder(res, 200, { logo_url: "https://x/logo.png" });
      if (metodo === "POST" && ruta === `${base}/acuerdo-de-datos`) return responder(res, 200, { acuerdo: { version: 1 } });
      if (metodo === "POST" && ruta === `${base}/politica`) return responder(res, 200, { politica: { modo: "guardar" } });
      if (metodo === "POST" && ruta === `${base}/claves`) return responder(res, 201, { clave_id: ID_DE_CLAVE, clave: CLAVE_FALSA, estado: "pendiente" });
      if (metodo === "GET" && ruta === `${base}/claves`) return responder(res, 200, { claves: [] });
      if (metodo === "POST" && ruta === `${base}/claves/${ID_DE_CLAVE}/confirmar`) return responder(res, 200, { ok: true });
      if (metodo === "POST" && ruta === `${base}/claves/revocar`) return responder(res, 200, { ok: true });
      if (metodo === "GET" && ruta === `${base}/diagnostico`) {
        return responder(res, 200, {
          listo: true, politica: "relevar",
          puntos: [
            { punto: "instalacion", ok: true, mensaje: "La instalación de GitHub no reporta problemas.", grupo: "instalacion" },
            { punto: "sitios", ok: true, mensaje: "1 sitio(s) admitido(s) para el chat.", grupo: "instalacion" },
            { punto: "chat", ok: true, mensaje: "El chat está prendido.", grupo: "instalacion" },
            { punto: "guia", ok: true, mensaje: "Hay una guía vigente del producto.", grupo: "instalacion" },
            { punto: "despachos", ok: true, mensaje: "Los despachos están activos.", grupo: "prueba" },
          ],
          techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, prueba_abierta: null,
        });
      }
      if (metodo === "POST" && ruta === `${base}/pruebas`) {
        const key = String(req.headers["idempotency-key"] ?? "");
        motor.clavesDePrueba.push(key);
        if (!motor.pruebasPorClave.has(key)) motor.pruebasPorClave.set(key, `prb_${String(motor.pruebasPorClave.size + 1).padStart(16, "0")}`);
        // La respuesta perdida de verdad: el motor creó la prueba y la conexión se corta antes de contestar.
        if (motor.pruebaPierde) { motor.pruebaPierde = false; req.socket.destroy(); return; }
        return responder(res, 202, { prueba_id: motor.pruebasPorClave.get(key), reporte_id: "rep_1", estado: "creada" });
      }
      if (metodo === "GET" && ruta.startsWith(`${base}/pruebas/`)) {
        return responder(res, 200, {
          prueba_id: ruta.split("/").pop(), estado: motor.estadoDePrueba, abierta: motor.estadoDePrueba === "en_curso", mensaje: "m",
          reporte: { id: "rep_1", url: `${api}/proyectos/r/reportes/rep_1` }, run: { id: "run_1", status: "completed", motivo: null },
          issue: motor.estadoDePrueba === "issue_creado" ? { numero: 42, url: "https://github.com/d/r/issues/42" } : null,
          cobro: { estado: "pendiente", usd: null, techo_usd: 2 },
        });
      }
      if (/^\/api\/conexiones\/[^/]+\/proyecto$/.test(ruta)) {
        motor.claves.push(String(req.headers["idempotency-key"] ?? ""));
        return responder(res, 201, { proyecto: PROYECTO, reusado: false });
      }
      switch (ruta) {
        case "/api/dispositivo/codigo":
          return responder(res, 200, {
            device_code: "d".repeat(64), user_code: "ABCD-EFGH", verification_uri: `${api}/dispositivo`,
            verification_uri_complete: `${api}/dispositivo?codigo=ABCD-EFGH`, expires_in: 600, interval: 1,
          });
        case "/api/dispositivo/token":
          if (motor.token) {
            const t = motor.token;
            motor.token = null; // el motor no la reentrega
            return responder(res, 200, t);
          }
          return responder(res, 400, { error: "authorization_pending" });
        case "/api/yo":
          return responder(res, 401, { error: "clave_invalida", message: "La clave ya no vale." });
        case "/api/conexiones":
          return responder(res, req.method === "POST" ? 201 : 200, { pedido: pedido() });
        case "/api/proyectos":
          return responder(res, 200, { proyecto: null });
        case "/api/dispositivo/revocar":
          if (motor.revocar === 200) motor.revocadas.push(bearer);
          return responder(res, motor.revocar, { ok: motor.revocar === 200 });
        default:
          return responder(res, 404, { error: "no_existe" });
      }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  tmp = mkdtempSync(join(tmpdir(), "supcoflow-sin-tty-"));
  archivo = join(tmp, "config", "supcoflow", "credenciales.json");
}, 120_000);

afterAll(async () => {
  await new Promise((r) => servidor.close(r));
  rmSync(tmp, { recursive: true, force: true });
});

type Corrida = { codigo: number | null; stdout: string; stderr: string; vencido: boolean };

function correr(args: string[], o: { stdin: "ignore"; techoMs?: number; cwd?: string }): Promise<Corrida> {
  return new Promise((resolve) => {
    // Un entorno armado a mano, sin heredar el de quien corre los tests: una SUPCOFLOW_TOKEN
    // exportada en la máquina no puede colarse.
    const hijo = spawn(process.execPath, [CLI, ...args], {
      // Por defecto, fuera de todo repo: si no, el `origin` de ESTE repo se colaría en `repo conectar`.
      cwd: o.cwd ?? tmp,
      stdio: [o.stdin, "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, HOME: tmp, XDG_CONFIG_HOME: join(tmp, "config"),
        // 9 s y no 3 s: la ventana de sondeo (tramo - tramo/3) tiene que superar con holgura el
        // mínimo de 2 s (PLAZO_MINIMO_DE_SONDEO_MS); con 3 s sobraban 2000 ms justos y cualquier
        // milisegundo gastado antes del primer sondeo lo salteaba (flaky, T18).
        SUPCOFLOW_API_URL: api, SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_TRAMO_MS: "9000",
      },
    });
    let stdout = "";
    let stderr = "";
    let vencido = false;
    hijo.stdout.on("data", (b) => (stdout += b));
    hijo.stderr.on("data", (b) => (stderr += b));
    const t = setTimeout(() => { vencido = true; hijo.kill("SIGKILL"); }, o.techoMs ?? 30_000);
    hijo.on("close", (codigo) => { clearTimeout(t); resolve({ codigo, stdout, stderr, vencido }); });
  });
}

async function sembrarClave(clave: string) {
  const t = existsSync(archivo) ? JSON.parse(await readFile(archivo, "utf8")) : {};
  t[new URL(api).origin] = { valor: clave, escritoEn: Date.now() };
  await writeFile(archivo, JSON.stringify(t), { mode: 0o600 });
}

// Como corre un asistente: sin terminal y, si hace falta, con una sesión ya iniciada.
async function correrSinTty(args: string[], o: { conClave?: boolean; cwd?: string } = {}): Promise<Corrida> {
  if (o.conClave) await sembrarClave(CLAVE_A);
  return correr(args, { stdin: "ignore", cwd: o.cwd });
}

// Un repo de git cuyo origin es d/r, para que `proyecto crear` tenga dónde dejar su archivo.
function repoDeGit(): string {
  const dir = mkdtempSync(join(tmp, "repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/d/r.git"], { cwd: dir });
  return dir;
}

const CASOS = [
  ["login"], ["login", "--json"], ["login", "--start", "--json"], ["login", "--wait", "--json"],
  ["logout", "--json"], ["whoami", "--json"], ["describe", "--json"], ["--help"], ["nada"], ["quien-soy", "--json"], ["describir", "--json"],
];

describe("supcoflow sin terminal", () => {
  it.each(CASOS)("`supcoflow %s` termina con stdin cerrado, una línea JSON si la pidió, y sin secretos", async (...args) => {
    const r = await correr(args, { stdin: "ignore", techoMs: 100_000 }); // --wait puede tardar su tramo
    expect(r.vencido).toBe(false);
    expect([0, 1, 2, 3, 4, 5, 6]).toContain(r.codigo);
    if (args.includes("--json")) expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(r.stdout + r.stderr).not.toMatch(/scf_[0-9a-f]{16}_|[0-9a-f]{64}/);
  }, 120_000);

  it("`login` sin TTY sale 3 y no pide código", async () => {
    pedidosAlMotor.length = 0;
    const r = await correr(["login"], { stdin: "ignore" });
    expect(r.codigo).toBe(3);
    expect(pedidosAlMotor.filter((p) => p === "/api/dispositivo/codigo")).toHaveLength(0);
  });

  it("`describe --json` y `nada` dicen lo que el contrato promete", async () => {
    const d = await correr(["describe", "--json"], { stdin: "ignore" });
    expect(d.codigo).toBe(0);
    expect(JSON.parse(d.stdout).comandos).toHaveLength(29);
    const n = await correr(["nada", "--json"], { stdin: "ignore" });
    expect(n.codigo).toBe(3);
    expect(JSON.parse(n.stdout).error).toBe("comando_desconocido");
  });

  it("el archivo de credenciales queda 0600 y su dir 0700", async () => {
    await correr(["login", "--start", "--json"], { stdin: "ignore" });
    expect((await stat(archivo)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(archivo))).mode & 0o777).toBe(0o700);
  });

  it("`login --wait --dry-run` sale 3 sin tocar el motor ni lo guardado", async () => {
    await correr(["login", "--start", "--json"], { stdin: "ignore" });
    const antes = await readFile(archivo, "utf8");
    pedidosAlMotor.length = 0;
    const r = await correr(["login", "--wait", "--dry-run", "--json"], { stdin: "ignore" });
    expect(r.codigo).toBe(3);
    expect(JSON.parse(r.stdout).error).toBe("dry_run_no_soportado");
    expect(pedidosAlMotor).toEqual([]);
    expect(await readFile(archivo, "utf8")).toBe(antes);
  });

  it("T18: revocar la anterior falla → queda anotada; el logout siguiente la revoca", async () => {
    await sembrarClave(CLAVE_A);
    motor.revocar = 500;
    motor.token = { access_token: CLAVE_B, token_type: "Bearer", equipo: "tnt_x" };
    await correr(["login", "--start", "--json"], { stdin: "ignore" });
    const w = await correr(["login", "--wait", "--json"], { stdin: "ignore" });
    expect(w.codigo).toBe(0);
    expect(JSON.parse(w.stdout)).toMatchObject({ anterior_revocada: false, queda_por_revocar: true });
    motor.revocar = 200;
    const l = await correr(["logout", "--json"], { stdin: "ignore" });
    expect(JSON.parse(l.stdout)).toMatchObject({ ok: true, quedan_por_revocar: 0 });
    expect(motor.revocadas).toContain(CLAVE_A);
    expect(motor.revocadas).toContain(CLAVE_B);
  }, 60_000);

  // La tercera columna: sin repo que pedir, `repo conectar` tiene que frenar ANTES de hablar con el
  // motor; si sólo se mirara el código, un 3 que llega después de un pedido pasaría igual.
  it.each([
    [["repo", "conectar"], 3, true],
    [["repo", "conectar", "--json"], 3, true],
    [["repo", "conectar", "--start", "--json", "--repo", "d/r"], 5, false],
    [["repo", "conectar", "--wait", "--json", "--repo", "d/r"], 5, false],
    [["proyecto", "ver", "--json", "--repo", "d/r"], 0, false],
    [["proyecto", "crear", "--json", "--repo", "d/r"], 4, false],
    [["repo"], 3, false],
  ])("sin terminal, %j termina solo con %i", async (args, codigo, sinMotor) => {
    pedidosAlMotor.length = 0;
    const r = await correrSinTty([...args], { conClave: true });
    expect(r.codigo).toBe(codigo);
    if (sinMotor) expect(pedidosAlMotor).toEqual([]);
    expect(r.stdout.trimEnd().split("\n").length).toBeLessThanOrEqual(1);
    expect(r.stdout + r.stderr).not.toMatch(/scf_[0-9a-f]{16}_|[0-9a-f]{64}/);
  }, 60_000);

  it.each([
    [["quien-soy", "--repo", "d/r", "--json"]],
    [["proyecto", "ver", "--install", "npm ci", "--json"]],
    [["repo", "conectar", "--test", "npm test", "--json"]],
    [["proyecto", "crear", "--start", "--json"]],
    [["repo", "conectar", "--start", "--wait", "--json"]],
  ])("%j sale 3 sin tocar el motor", async (args) => {
    pedidosAlMotor.length = 0;
    const r = await correrSinTty([...args], { conClave: true });
    expect(r.codigo).toBe(3);
    expect(pedidosAlMotor).toEqual([]);
  });

  it("`proyecto crear` en un repo conectado deja .supcoflow/proyecto.json y manda una clave de idempotencia", async () => {
    motor.conexion = "conectado";
    motor.claves.length = 0;
    try {
      const repo = repoDeGit();
      const r = await correrSinTty(["proyecto", "crear", "--json"], { conClave: true, cwd: repo });
      expect(r.codigo).toBe(0);
      expect(JSON.parse(await readFile(join(repo, ".supcoflow", "proyecto.json"), "utf8"))).toEqual({ id: "proj_abc", slug: "r", repo: "d/r" });
      expect(readdirSync(join(repo, ".supcoflow"))).toEqual(["proyecto.json"]); // ni un .tmp
      expect(motor.claves).toHaveLength(1);
      expect(motor.claves[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // La clave se guardó al lado de las credenciales, nunca en el repo, con los mismos permisos.
      const idem = join(dirname(archivo), "idempotencia.json");
      expect((await stat(idem)).mode & 0o777).toBe(0o600);
      expect(existsSync(join(repo, "idempotencia.json"))).toBe(false);
    } finally {
      motor.conexion = "pendiente";
    }
  });

  it("un .supcoflow que es un enlace no se sigue: sale 4 y el destino queda intacto", async () => {
    motor.conexion = "conectado";
    try {
      const repo = repoDeGit();
      const afuera = mkdtempSync(join(tmp, "afuera-"));
      symlinkSync(afuera, join(repo, ".supcoflow"));
      const r = await correrSinTty(["proyecto", "crear", "--json"], { conClave: true, cwd: repo });
      expect(r.codigo).toBe(4);
      expect(JSON.parse(r.stdout).error).toBe("archivo_distinto");
      expect(readdirSync(afuera)).toEqual([]);
      expect(lstatSync(join(repo, ".supcoflow")).isSymbolicLink()).toBe(true);
    } finally {
      motor.conexion = "pendiente";
    }
  });

  it("un proyecto.json que es un enlace a un secreto no se lee ni se copia a la salida", async () => {
    motor.conexion = "conectado";
    try {
      const repo = repoDeGit();
      const secreto = join(tmp, "secreto.json");
      await writeFile(secreto, JSON.stringify({ id: "proj_robado", clave: CLAVE_B }));
      mkdirSync(join(repo, ".supcoflow"));
      symlinkSync(secreto, join(repo, ".supcoflow", "proyecto.json"));
      const r = await correrSinTty(["proyecto", "crear", "--json"], { conClave: true, cwd: repo });
      expect(r.codigo).toBe(4);
      expect(r.stdout + r.stderr).not.toContain("proj_robado");
      expect(r.stdout + r.stderr).not.toMatch(/scf_[0-9a-f]{16}_/);
    } finally {
      motor.conexion = "pendiente";
    }
  });

  // Bloque 4: los comandos de configurar, sin terminal y con --json, contra el motor falso.
  describe("configurar", () => {
    beforeAll(() => { motor.proyectoExiste = true; });
    afterAll(() => { motor.proyectoExiste = false; });
    const PNG = () => {
      const f = join(tmp, "logo.png");
      return writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47])).then(() => f);
    };
    const casos = async (): Promise<string[][]> => [
      ["catalogo", "--json"],
      ["configuracion", "--json", "--repo", "d/r"],
      ["chat", "prender", "--json", "--repo", "d/r"],
      ["chat", "apagar", "--json", "--repo", "d/r"],
      ["chat", "marca", "--titulo", "Ayuda", "--tema", "acento=#0a7", "--json", "--repo", "d/r"],
      ["chat", "logo", "--archivo", await PNG(), "--json", "--repo", "d/r"],
      ["sitios", "agregar", "--sitio", "https://app.ejemplo.com", "--json", "--repo", "d/r"],
      ["sitios", "quitar", "--sitio", "https://app.ejemplo.com", "--json", "--repo", "d/r"],
      ["datos", "fijar", "--permitir", "usuario_id,atributo:plan", "--json", "--repo", "d/r"],
      ["politica", "fijar", "--modo", "guardar", "--json", "--repo", "d/r"],
      ["claves", "crear", "--nombre", "ci", "--guardar-en", join(tmp, "claves", "ci.key"), "--json", "--repo", "d/r"],
      ["claves", "listar", "--json", "--repo", "d/r"],
      ["claves", "revocar", "--id", ID_DE_CLAVE, "--json", "--repo", "d/r"],
    ];

    it("cada comando termina en ≤ 5 s, deja UNA línea JSON y no filtra la clave falsa del motor", async () => {
      mkdirSync(join(tmp, "claves"), { recursive: true });
      const lista = await casos();
      expect(lista).toHaveLength(13);
      for (const args of lista) {
        const t0 = Date.now();
        const r = await correrSinTty(args, { conClave: true });
        const quien = args.slice(0, 2).join(" ");
        expect(r.vencido, quien).toBe(false);
        expect(Date.now() - t0, quien).toBeLessThan(5_000);
        expect(r.codigo, `${quien}: ${r.stdout}`).toBe(0);
        expect(r.stdout.trimEnd().split("\n"), quien).toHaveLength(1);
        expect(JSON.parse(r.stdout).ok, quien).toBe(true);
        expect(r.stdout + r.stderr, quien).not.toContain(CLAVE_FALSA);
        expect(r.stdout + r.stderr, quien).not.toContain(CLAVE_FALSA.slice(-64));
      }
    }, 120_000);

    // La guía vive en la raíz del clon: un repo de git con `.supcoflow/guia.md`. Sin TTY y con stdin cerrado.
    it("los comandos de la guía terminan solos con el código que el contrato promete", async () => {
      const repo = repoDeGit();
      mkdirSync(join(repo, ".supcoflow"));
      await writeFile(join(repo, ".supcoflow", "guia.md"), "## Facturas\nPara qué sirve: Ver facturas.\nQué puede hacer el usuario: Descargarlas.\n");
      const corrida = async (args: string[]) => {
        const r = await correrSinTty([...args, "--json", "--repo", "d/r"], { conClave: true, cwd: repo });
        expect(r.vencido, args.join(" ")).toBe(false);
        expect(r.stdout.trimEnd().split("\n"), args.join(" ")).toHaveLength(1);
        return r;
      };
      expect((await corrida(["guia", "revisar"])).codigo).toBe(0);
      expect((await corrida(["guia", "ver"])).codigo).toBe(0);
      motor.guiaSubida = false;
      const noSubida = await corrida(["guia", "publicar"]);
      expect(noSubida.codigo).toBe(5);
      expect(JSON.parse(noSubida.stdout).error).toBe("guia_no_subida");
      motor.guiaSubida = true;
      try { expect((await corrida(["guia", "publicar"])).codigo).toBe(0); } finally { motor.guiaSubida = false; }
      const sinGuia = await corrida(["guia", "usar", "--origen", "repo"]);
      expect(sinGuia.codigo).toBe(3);
      expect(JSON.parse(sinGuia.stdout).error).toBe("sin_guia_publicada");
      pedidosAlMotor.length = 0;
      const sinOrigen = await corrida(["guia", "usar"]);
      expect(sinOrigen.codigo).toBe(3);
      expect(JSON.parse(sinOrigen.stdout).error).toBe("falta_origen");
      expect(pedidosAlMotor).toEqual([]);
    }, 60_000);

    it("`--origen` fuera de `guia usar` sale 3 flag_no_aplica sin tocar el motor", async () => {
      pedidosAlMotor.length = 0;
      const r = await correrSinTty(["guia", "ver", "--origen", "repo", "--json"], { conClave: true });
      expect(r.codigo).toBe(3);
      expect(JSON.parse(r.stdout).error).toBe("flag_no_aplica");
      expect(pedidosAlMotor).toEqual([]);
    });

    it("`claves crear` deja el secreto sólo en el archivo, 0600", async () => {
      const destino = join(tmp, "claves", "solo.key");
      const r = await correrSinTty(["claves", "crear", "--nombre", "ci", "--guardar-en", destino, "--json", "--repo", "d/r"], { conClave: true });
      expect(r.codigo).toBe(0);
      expect((await readFile(destino, "utf8")).trim()).toBe(CLAVE_FALSA);
      expect((await stat(destino)).mode & 0o777).toBe(0o600);
    });

    it("`claves crear --json` sin --guardar-en sale 3 y no crea nada en el motor", async () => {
      pedidosAlMotor.length = 0;
      const r = await correrSinTty(["claves", "crear", "--nombre", "ci", "--json", "--repo", "d/r"], { conClave: true });
      expect(r.codigo).toBe(3);
      expect(JSON.parse(r.stdout).error).toBe("falta_guardar_en");
      expect(pedidosAlMotor.filter((p) => p === `/api/proyectos/${PROYECTO.id}/claves`)).toEqual([]);
      expect(r.stdout + r.stderr).not.toContain(CLAVE_FALSA);
    });

    it.each([
      [["quien-soy", "--sitio", "x", "--json"]],
      [["chat", "prender", "--tema", "a=b", "--json"]],
      [["catalogo", "--repo", "d/r", "--json"]],
    ])("%j sale 3 flag_no_aplica sin tocar el motor", async (args) => {
      pedidosAlMotor.length = 0;
      const r = await correrSinTty([...args], { conClave: true });
      expect(r.codigo).toBe(3);
      expect(JSON.parse(r.stdout).error).toBe("flag_no_aplica");
      expect(pedidosAlMotor).toEqual([]);
    });
  });

  // Bloque 6, R2: los dos comandos nuevos, como los corre la skill: sin terminal, stdin cerrado y --json.
  describe("widget e instalacion anotar", () => {
    beforeAll(() => { motor.proyectoExiste = true; });
    afterAll(() => { motor.proyectoExiste = false; });

    it("`widget --json` termina solo y devuelve lo del motor tal cual, en una línea", async () => {
      const r = await correrSinTty(["widget", "--json", "--repo", "d/r"], { conClave: true });
      expect(r.vencido).toBe(false);
      expect(r.codigo).toBe(0);
      expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(JSON.parse(r.stdout)).toEqual({ ok: true, ...WIDGET });
    });

    it("`widget` sin proyecto en el repo sale 4 sin_proyecto", async () => {
      motor.proyectoExiste = false;
      try {
        const r = await correrSinTty(["widget", "--json", "--repo", "d/r"], { conClave: true });
        expect(r.codigo).toBe(4);
        expect(JSON.parse(r.stdout).error).toBe("sin_proyecto");
      } finally {
        motor.proyectoExiste = true;
      }
    });

    it("`instalacion anotar` sin --skill sale 3 falta_skill sin tocar el motor", async () => {
      const repo = repoDeGit();
      pedidosAlMotor.length = 0;
      const r = await correrSinTty(["instalacion", "anotar", "--json"], { conClave: true, cwd: repo });
      expect(r.vencido).toBe(false);
      expect(r.codigo).toBe(3);
      expect(JSON.parse(r.stdout).error).toBe("falta_skill");
      expect(pedidosAlMotor).toEqual([]);
      expect(existsSync(join(repo, ".supcoflow"))).toBe(false);
    });

    it("`instalacion anotar --skill` deja .supcoflow/instalacion.json con la versión de esta terminal", async () => {
      const repo = repoDeGit();
      const r = await correrSinTty(["instalacion", "anotar", "--skill", "0.1.0", "--json"], { conClave: true, cwd: repo });
      expect(r.vencido).toBe(false);
      expect(r.codigo, r.stdout).toBe(0);
      expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
      const anotado = JSON.parse(await readFile(join(repo, ".supcoflow", "instalacion.json"), "utf8"));
      const pkg = JSON.parse(await readFile(join(RAIZ, "package.json"), "utf8")) as { version: string };
      expect(anotado).toMatchObject({ version: 2, archivo: null, skill: "0.1.0", terminal: pkg.version, chat: { declarado: null, instalado: null } });
      expect(anotado.configuracion).toEqual({ acuerdo_version: null, politica: "relevar", guia: null });
      expect(r.stdout + r.stderr).not.toMatch(/scf_[0-9a-f]{16}_/);
      // Repetir sin cambios no toca nada.
      const otra = await correrSinTty(["instalacion", "anotar", "--skill", "0.1.0", "--json"], { conClave: true, cwd: repo });
      expect(otra.codigo).toBe(0);
      expect(JSON.parse(otra.stdout).sin_cambios).toBe(true);
    });

    it.each([
      [["widget", "--skill", "0.1.0", "--json"]],
      [["guia", "ver", "--app", "web", "--json"]],
    ])("%j sale 3 flag_no_aplica sin tocar el motor", async (args) => {
      pedidosAlMotor.length = 0;
      const r = await correrSinTty([...args], { conClave: true });
      expect(r.codigo).toBe(3);
      expect(JSON.parse(r.stdout).error).toBe("flag_no_aplica");
      expect(pedidosAlMotor).toEqual([]);
    });
  });

  // Bloque 7, R2: diagnosticar y probar como los corre un asistente: stdin cerrado, --json, sin preguntar nada.
  describe("diagnose y test", () => {
    beforeAll(() => { motor.proyectoExiste = true; });
    afterAll(() => { motor.proyectoExiste = false; });
    const pruebas = () => join(dirname(archivo), "pruebas.json");
    const POST_PRUEBA = `/api/proyectos/${PROYECTO.id}/pruebas`;

    it("R2: los siete terminan solos con stdin cerrado, una línea JSON, sin POST salvo con --authorize-spend", async () => {
      rmSync(pruebas(), { force: true });
      const casos: [string[], number][] = [
        [["diagnose", "--json"], 0],
        [["test", "--json"], 4],
        [["test", "--dry-run", "--authorize-spend", "--ceiling", "2", "--expect-policy", "investigate", "--json"], 0],
        // Los nombres de la 0.7.0 siguen andando como alias: sin --ceiling, el viejo `--autorizo-gasto` sale 3.
        [["diagnosticar", "--json"], 0],
        [["probar", "--json"], 4],
        [["probar", "--autorizo-gasto", "--json"], 3],
        [["probar", "--dry-run", "--autorizo-gasto", "--ceiling", "2", "--json"], 0],
      ];
      for (const [args, codigo] of casos) {
        pedidosAlMotor.length = 0;
        const r = await correrSinTty([...args, "--repo", "d/r"], { conClave: true, cwd: repoDeGit() });
        expect(r.vencido, args.join(" ")).toBe(false);
        expect(r.codigo, `${args.join(" ")}: ${r.stdout}`).toBe(codigo);
        expect(r.stdout.trimEnd().split("\n"), args.join(" ")).toHaveLength(1);
        expect(pedidosAlMotor.filter((p) => p === POST_PRUEBA), args.join(" ")).toEqual([]);
      }
      // R6 por el binario: el 4 trae los números del diagnóstico y no deja nada guardado.
      const sin = await correrSinTty(["test", "--json", "--repo", "d/r"], { conClave: true });
      expect(JSON.parse(sin.stdout)).toMatchObject({ error: "falta_autorizacion", techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5 });
      expect(existsSync(pruebas())).toBe(false);
    }, 60_000);

    it("R2: `test --wait` termina solo: 5 en curso (dentro del tramo) y 0 con el issue y el cobro pendiente", async () => {
      rmSync(pruebas(), { force: true });
      const pide = await correrSinTty(["test", "--authorize-spend", "--ceiling", "2", "--expect-policy", "investigate", "--json", "--repo", "d/r"], { conClave: true });
      expect(pide.codigo, pide.stdout).toBe(5);
      motor.estadoDePrueba = "en_curso";
      const t0 = Date.now();
      const enCurso = await correrSinTty(["test", "--wait", "--json", "--repo", "d/r"], { conClave: true });
      expect(enCurso.vencido).toBe(false);
      expect(enCurso.codigo).toBe(5);
      expect(Date.now() - t0).toBeLessThan(90_000);
      motor.estadoDePrueba = "issue_creado";
      const fin = await correrSinTty(["test", "--wait", "--json", "--repo", "d/r"], { conClave: true });
      expect(fin.codigo).toBe(0);
      expect(fin.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(JSON.parse(fin.stdout)).toMatchObject({ estado: "issue_creado", issue: { numero: 42 }, cobro: { estado: "pendiente", usd: null } });
    }, 60_000);

    it("R14c por el binario: la conexión se corta tras crear; el próximo manda la MISMA clave y guarda esa prueba (0600, fuera del repo)", async () => {
      rmSync(pruebas(), { force: true });
      motor.clavesDePrueba.length = 0;
      motor.pruebasPorClave.clear();
      motor.pruebaPierde = true;
      const primero = await correrSinTty(["test", "--authorize-spend", "--ceiling", "2", "--expect-policy", "investigate", "--message", "Mi caso", "--json", "--repo", "d/r"], { conClave: true });
      expect(primero.codigo, primero.stdout).toBe(1);
      expect(JSON.parse(primero.stdout)).toMatchObject({ intento_pendiente: true });
      const segundo = await correrSinTty(["test", "--authorize-spend", "--ceiling", "2", "--expect-policy", "investigate", "--json", "--repo", "d/r"], { conClave: true });
      expect(segundo.codigo, segundo.stdout).toBe(5);
      expect(motor.clavesDePrueba).toHaveLength(2);
      expect(motor.clavesDePrueba[1]).toBe(motor.clavesDePrueba[0]);
      expect(motor.pruebasPorClave.size).toBe(1);
      const guardado = JSON.parse(await readFile(pruebas(), "utf8")) as Record<string, { valor: string }>;
      const valor = JSON.parse(Object.values(guardado)[0]!.valor);
      expect(valor).toEqual({ intento: null, ultima: "prb_0000000000000001" });
      expect((await stat(pruebas())).mode & 0o777).toBe(0o600);
    }, 60_000);

    it.each([
      [["test", "--wait", "--authorize-spend", "--json"]],
      [["test", "--test-id", "prb_0123456789abcdef", "--json"]],
      [["diagnose", "--message", "x", "--json"]],
      [["test", "--start", "--json"]],
      [["probar", "--wait", "--autorizo-gasto", "--json"]],
      [["probar", "--prueba", "prb_0123456789abcdef", "--json"]],
      [["test", "--authorize-spend", "--json"]],
      [["test", "--authorize-spend", "--ceiling", "2", "--json"]],
    ])("%j sale 3 sin tocar el motor", async (args) => {
      pedidosAlMotor.length = 0;
      const r = await correrSinTty([...args], { conClave: true });
      expect(r.codigo).toBe(3);
      expect(pedidosAlMotor).toEqual([]);
    });
  });

  it("ningún caso tocó el llavero real: el único destino fue el archivo del HOME temporal", async () => {
    // con SUPCOFLOW_SIN_LLAVERO=1 la terminal no llama a /usr/bin/security; el archivo existe y es el del tmp
    expect(existsSync(archivo)).toBe(true);
  });
});
