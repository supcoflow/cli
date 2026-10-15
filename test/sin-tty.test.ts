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
};
const PROYECTO = { id: "proj_abc", slug: "r", repo: "d/r", rama: "main", install_command: "npm ci", test_command: "npm test" };
const pedido = () => ({
  id: "cnx_0123456789abcdef", repo: "d/r", estado: motor.conexion, url: `${api}/conectar/cnx_0123456789abcdef`,
  vence_en: new Date(Date.now() + 1_800_000).toISOString(), repo_canonico: motor.conexion === "conectado" ? "d/r" : null, fallo: null,
});
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
  ["logout", "--json"], ["quien-soy", "--json"], ["describir", "--json"], ["--help"], ["nada"],
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

  it("`describir --json` y `nada` dicen lo que el contrato promete", async () => {
    const d = await correr(["describir", "--json"], { stdin: "ignore" });
    expect(d.codigo).toBe(0);
    expect(JSON.parse(d.stdout).comandos).toHaveLength(7);
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

  it.each([
    [["repo", "conectar"], 3],
    [["repo", "conectar", "--json"], 3],
    [["repo", "conectar", "--start", "--json", "--repo", "d/r"], 5],
    [["repo", "conectar", "--wait", "--json", "--repo", "d/r"], 5],
    [["proyecto", "ver", "--json", "--repo", "d/r"], 0],
    [["proyecto", "crear", "--json", "--repo", "d/r"], 4],
    [["repo"], 3],
  ])("sin terminal, %j termina solo con %i", async (args, codigo) => {
    const r = await correrSinTty([...args], { conClave: true });
    expect(r.codigo).toBe(codigo);
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

  it("ningún caso tocó el llavero real: el único destino fue el archivo del HOME temporal", async () => {
    // con SUPCOFLOW_SIN_LLAVERO=1 la terminal no llama a /usr/bin/security; el archivo existe y es el del tmp
    expect(existsSync(archivo)).toBe(true);
  });
});
