// Lo único que toca el mundo de verdad: el proceso, el disco, el llavero, la red y el reloj. Todo lo
// demás recibe estas piezas inyectadas y se prueba con dobles; acá sólo se enchufan.
import { spawn } from "node:child_process";
import { chmodSync, closeSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { canjear, pedirCodigo, quienSoy, revocarPropia, urlDeLaApi, type Yo } from "./api.ts";
import type { DepsDeLogin } from "./comandos/login.ts";
import { almacenDeArchivo, type FsMinimo } from "./guardado/archivo.ts";
import { crearGuardado, type Almacen, type Guardado } from "./guardado/index.ts";
import { almacenDeLlavero, type Correr } from "./guardado/llavero.ts";
import { TRAMO_MAXIMO_MS } from "./sondeo.ts";

// El `.tmp` se crea en exclusiva (`wx`: falla si quedó algo, enlace incluido, en vez de escribir a
// través de él) y el `fchmod` va aparte porque el modo de `open` pasa por la umask del proceso.
// `rmSync` sobre un enlace borra el enlace, nunca su destino.
export const fsReal: FsMinimo = {
  leer(p) {
    try {
      return readFileSync(p, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  crearDir: (p, modo) => void mkdirSync(p, { recursive: true, mode: modo }),
  chmod: (p, modo) => chmodSync(p, modo),
  borrarSiExiste: (p) => rmSync(p, { force: true }),
  escribirExclusivo(p, s, modo) {
    const fd = openSync(p, "wx", modo);
    try {
      fchmodSync(fd, modo);
      writeSync(fd, s);
    } finally {
      closeSync(fd);
    }
  },
  renombrar: (a, b) => renameSync(a, b),
  // Un enlace roto que no se puede resolver es un FALLO: el control del repo no puede saber adónde
  // apunta, y escribir sin saberlo es justo lo que el control existe para impedir.
  realpath(p) {
    try {
      return realpathSync(p);
    } catch {
      throw new Error(`No puedo resolver la ruta real de ${p} (¿un enlace roto?); no guardo nada ahí.`);
    }
  },
  // `lstat` y no `existsSync`: éste sigue el enlace y ante uno roto dice «no existe», y el control
  // del repo pasaba de largo, resolvía al padre y daba una ruta «real» que no era por donde se iba a
  // escribir (Review Focus 6). Con `lstat` el enlace existe, `realpath` no lo resuelve y falla cerrado.
  existe(p) {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
};

// Para hablar con `security`/`secret-tool`. stderr se descarta: no hace falta y podría traer algo
// del secreto. Al techo el hijo se mata con SIGKILL (un llavero bloqueado no atiende un SIGTERM) y se
// resuelve sin esperar a que muera: un `close` que no llega no puede colgar el comando (Review Focus 2).
// Un entorno mínimo para el hijo: con `process.env` entero, SUPCOFLOW_TOKEN (y cualquier otro
// secreto del shell) llegaría a `security`/`secret-tool`, que no lo necesitan. Las variables de D-Bus
// y XDG sí: sin ellas `secret-tool` no encuentra el bus del Secret Service.
const VARIABLES_DEL_HIJO = ["PATH", "HOME", "USER", "LANG", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "DISPLAY", "XDG_CONFIG_HOME"];
function entornoDelHijo(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const k of VARIABLES_DEL_HIJO) {
    const v = process.env[k];
    if (v !== undefined) r[k] = v;
  }
  return r;
}

export const correrReal: Correr = (bin, args, stdin, techoMs) =>
  new Promise((resolve) => {
    let listo = false;
    let stdout = "";
    const terminar = (r: { codigo: number | null; vencido: boolean; ausente?: boolean }) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      resolve({ ...r, stdout });
    };
    const hijo = spawn(bin, args, { stdio: ["pipe", "pipe", "ignore"], env: entornoDelHijo() });
    const reloj = setTimeout(() => {
      hijo.kill("SIGKILL");
      terminar({ codigo: null, vencido: true });
    }, techoMs);
    hijo.on("error", (e: NodeJS.ErrnoException) => {
      terminar({ codigo: null, vencido: false, ausente: e.code === "ENOENT" ? true : undefined });
    });
    hijo.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    hijo.on("close", (codigo) => terminar({ codigo, vencido: false }));
    // Un hijo que muere antes de leer deja un EPIPE en stdin; sin este handler tumbaría el proceso.
    hijo.stdin.on("error", () => {});
    hijo.stdin.end(stdin ?? undefined);
  });

const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Entorno = {
  env: Record<string, string | undefined>;
  api: URL;
  esTty: boolean;
  mostrar: (s: string) => void;
  avisar: (s: string) => void;
  rutaDelArchivo: string;
  llavero: Almacen | null;
  guardado: Guardado;
  login: DepsDeLogin;
  quienSoy: (api: URL, clave: string) => Promise<Yo>;
};

export function entornoReal(env: Record<string, string | undefined> = process.env): Entorno {
  const api = urlDeLaApi(env);
  // Perillas de PRUEBA, no del producto: sólo valen contra un motor en la propia máquina. Contra
  // producción se ignoran, así una variable olvidada en el shell no saca la clave del llavero ni
  // acorta los tramos de nadie.
  const local = LOCALES.has(api.hostname);
  const sinLlavero = local && env.SUPCOFLOW_SIN_LLAVERO === "1";
  const tramo = Number(env.SUPCOFLOW_TRAMO_MS);
  const tramoMs = local && Number.isInteger(tramo) && tramo > 0 && tramo <= TRAMO_MAXIMO_MS ? tramo : undefined;

  const avisar = (s: string) => void process.stderr.write(s + "\n");
  // `||` y no `??`: un XDG_CONFIG_HOME vacío daría una ruta RELATIVA, que cae donde esté parado el
  // comando; la especificación de XDG lo trata como no definido.
  const rutaDelArchivo = join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "supcoflow", "credenciales.json");
  const llavero = sinLlavero ? null : almacenDeLlavero(process.platform, correrReal);
  const guardado = crearGuardado({
    env, llavero, archivo: almacenDeArchivo(rutaDelArchivo, fsReal), rutaDelArchivo, fs: fsReal, ahora: Date.now, avisar,
  });

  return {
    env,
    api,
    esTty: process.stdin.isTTY === true && process.stdout.isTTY === true,
    mostrar: avisar,
    avisar,
    rutaDelArchivo,
    llavero,
    guardado,
    login: {
      api,
      guardado,
      maquina: hostname(),
      ahora: Date.now,
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
      pedirCodigo: (a, maquina) => pedirCodigo(a, maquina, fetch),
      canjear: (a, deviceCode, plazoMs) => canjear(a, deviceCode, fetch, plazoMs),
      revocarPropia: (a, clave, plazoMs) => revocarPropia(a, clave, fetch, plazoMs),
      avisar,
      tramoMs,
    },
    quienSoy: (a, clave) => quienSoy(a, clave, fetch),
  };
}
