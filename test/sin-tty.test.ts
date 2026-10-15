// El binario COMPILADO, corrido como lo corre un asistente: sin terminal, stdin cerrado, contra un
// motor falso en un puerto libre. Nunca toca el llavero real: SUPCOFLOW_SIN_LLAVERO=1 siempre,
// porque quitar `security` del PATH no alcanza (la terminal lo llama por ruta absoluta).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

function correr(args: string[], o: { stdin: "ignore"; techoMs?: number }): Promise<Corrida> {
  return new Promise((resolve) => {
    // Un entorno armado a mano, sin heredar el de quien corre los tests: una SUPCOFLOW_TOKEN
    // exportada en la máquina no puede colarse.
    const hijo = spawn(process.execPath, [CLI, ...args], {
      stdio: [o.stdin, "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, HOME: tmp, XDG_CONFIG_HOME: join(tmp, "config"),
        SUPCOFLOW_API_URL: api, SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_TRAMO_MS: "3000",
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
    expect(JSON.parse(d.stdout).comandos).toHaveLength(4);
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

  it("ningún caso tocó el llavero real: el único destino fue el archivo del HOME temporal", async () => {
    // con SUPCOFLOW_SIN_LLAVERO=1 la terminal no llama a /usr/bin/security; el archivo existe y es el del tmp
    expect(existsSync(archivo)).toBe(true);
  });
});
