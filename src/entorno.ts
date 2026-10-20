// Lo único que toca el mundo de verdad: el proceso, el disco, el llavero, la red y el reloj. Todo lo
// demás recibe estas piezas inyectadas y se prueba con dobles; acá sólo se enchufan.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  buscarProyecto, canjear, configurar, leerWidget, crearConexion, crearProyecto, elegirOrigen, esClaveDeConsultaDelProyecto, leerCatalogo, leerConfiguracion, leerGuia, leerProyecto,
  listarClaves, pedirCodigo, quienSoy, revocarPropia, subirLogo, ultimaConexion, urlDeLaApi, publicarGuia, revisarGuia, type Yo,
} from "./api.ts";
import { crearCandados, type FsDelCandado } from "./candado.ts";
import type { DepsDeClaves } from "./comandos/claves.ts";
import type { DepsDeGuia } from "./comandos/guia.ts";
import { esCarpetaReal, rutaRealOEnNada, type DepsDeInstalacion } from "./comandos/instalacion.ts";
import { DESCRIPCION } from "./comandos/describir.ts";
import type { DepsDeWidget } from "./comandos/widget.ts";
import type { DepsDeCatalogo } from "./comandos/datos-y-politica.ts";
import type { DepsDeLogin } from "./comandos/login.ts";
import type { DepsDeProyecto } from "./comandos/proyecto.ts";
import type { DepsDeConexion } from "./comandos/repo-conectar.ts";
import { almacenDeArchivo, type FsMinimo } from "./guardado/archivo.ts";
import { crearGuardado, type Almacen, type Guardado } from "./guardado/index.ts";
import { almacenDeLlavero, type Correr } from "./guardado/llavero.ts";
import { crearGuardaDeSecretos } from "./secreto-a-archivo.ts";
import { crearRegistroDeIdempotencia, type RegistroDeIdempotencia } from "./idempotencia.ts";
import type { Git } from "./repo-local.ts";
import type { FsDeSecretos, LecturaSinSeguir } from "./secreto-a-archivo.ts";
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

// El candado de `claves crear` (src/candado.ts). `wx` es la exclusión: SÓLO `EEXIST` es «ya hay uno»;
// cualquier otro error (permisos, disco) se relanza y sale `no_disponible`, nunca «ocupado». La lectura no
// sigue enlaces: un `.lock` que alguien cambió por un enlace no se lee como si fuera el nuestro.
export const fsDelCandadoReal: FsDelCandado = {
  // Se escribe completo en un temporal de la misma carpeta y se PUBLICA con `link`, que falla con EEXIST si
  // ya hay uno: con `wx` directo, otro proceso podía leer el `.lock` recién creado y todavía vacío, y
  // informar `candado_abandonado` de un candado vivo. Así el `.lock` nunca se ve sin contenido.
  crearExclusivo(p, contenido, modo) {
    const tmp = `${p}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tmp, "wx", modo);
      try {
        fchmodSync(fd, modo);
        writeSync(fd, contenido);
      } finally {
        closeSync(fd);
      }
      linkSync(tmp, p);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    } finally {
      rmSync(tmp, { force: true });
    }
  },
  leer(p) {
    try {
      const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        return readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
    } catch {
      return null;
    }
  },
  borrar: (p) => rmSync(p, { force: true }),
  crearDir: (p, modo) => void mkdirSync(p, { recursive: true, mode: modo }),
};

// ¿Sigue vivo el dueño de un candado? `kill(pid, 0)` no manda nada: sólo pregunta. `EPERM` es «existe pero
// es de otro usuario»: vivo. Sólo `ESRCH` (no existe) lo da por muerto.
export function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// El destino del secreto de `claves crear` (src/secreto-a-archivo.ts): el `fsReal` de siempre más una
// lectura que no sigue un enlace en el último tramo (`O_NOFOLLOW` → `ELOOP`), no se cuelga en un FIFO y
// tiene tope. Sólo archivos comunes.
function leerSinSeguir(p: string, tope: number): LecturaSinSeguir {
  let fd: number;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { tipo: "ausente" };
    // macOS y Linux dan `ELOOP` al abrir un enlace con O_NOFOLLOW; algunos BSD, `EMLINK`.
    return code === "ELOOP" || code === "EMLINK" ? { tipo: "enlace" } : { tipo: "ilegible" };
  }
  try {
    if (!fstatSync(fd).isFile()) return { tipo: "ilegible" };
    const buf = Buffer.alloc(tope + 1);
    let n = 0;
    for (;;) {
      const leidos = readSync(fd, buf, n, buf.length - n, null);
      if (leidos === 0) break;
      n += leidos;
      if (n > tope) return { tipo: "ilegible" };
    }
    return { tipo: "contenido", texto: buf.subarray(0, n).toString("utf8") };
  } catch {
    return { tipo: "ilegible" };
  } finally {
    closeSync(fd);
  }
}
// `link` es el idioma del candado (arriba): crea el nombre sólo si no existe y falla con EEXIST si sí, sin
// ventana entre mirar y escribir. El temporal queda con dos nombres hasta que `guardar` lo borra.
// Un disco sin enlaces duros (FAT, exFAT, SMB) no da EEXIST sino EPERM, ENOTSUP/EOPNOTSUPP o ENOSYS según
// el sistema: se informa aparte para no decirle a la persona «¿tenés permiso?» cuando el problema es el disco.
const SIN_ENLACES = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);
function publicarSinPisar(tmp: string, destino: string): "publicado" | "existe" | "sin_enlaces" {
  try {
    linkSync(tmp, destino);
    return "publicado";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code === "EEXIST") return "existe";
    if (SIN_ENLACES.has(code)) return "sin_enlaces";
    throw e;
  }
}
export const fsDeSecretosReal: FsDeSecretos = { ...fsReal, leerSinSeguir, publicarSinPisar };

// Para hablar con `security`/`secret-tool`. stderr se captura sólo como señal (¿dijo algo?: es lo
// que separa «no encontrado» de «sin D-Bus» en `secret-tool`), recortado, y nunca se muestra ni se
// registra: podría traer algo del secreto. Al techo el hijo se mata con SIGKILL (un llavero bloqueado no atiende un SIGTERM) y se
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

const MAXIMO_DE_STDERR = 2_048;

export const correrReal: Correr = (bin, args, stdin, techoMs) =>
  new Promise((resolve) => {
    let listo = false;
    let stdout = "";
    let stderr = "";
    const terminar = (r: { codigo: number | null; vencido: boolean; ausente?: boolean }) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      resolve({ ...r, stdout, stderr });
    };
    const hijo = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: entornoDelHijo() });
    const reloj = setTimeout(() => {
      hijo.kill("SIGKILL");
      terminar({ codigo: null, vencido: true });
    }, techoMs);
    hijo.on("error", (e: NodeJS.ErrnoException) => {
      terminar({ codigo: null, vencido: false, ausente: e.code === "ENOENT" ? true : undefined });
    });
    hijo.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    // Se lee siempre (un pipe lleno que nadie vacía colgaría al hijo) pero se guarda poco.
    hijo.stderr.on("data", (b: Buffer) => {
      if (stderr.length < MAXIMO_DE_STDERR) stderr = (stderr + b.toString("utf8")).slice(0, MAXIMO_DE_STDERR);
    });
    hijo.on("close", (codigo) => terminar({ codigo, vencido: false }));
    // Un hijo que muere antes de leer deja un EPIPE en stdin; sin este handler tumbaría el proceso.
    hijo.stdin.on("error", () => {});
    hijo.stdin.end(stdin ?? undefined);
  });

// `git` con entorno mínimo (sólo PATH): ni GIT_DIR ni GIT_CONFIG del shell desvían la lectura, y
// SUPCOFLOW_TOKEN no le llega. Un git ausente (ENOENT) es «sin git», no un fallo. El plazo es parámetro para no
// duplicar la función: lo que git imprima nunca sale a la terminal, sólo el código y el stdout.
const gitConPlazo = (plazoMs: number): Git => (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: plazoMs, env: { PATH: process.env.PATH ?? "" } }, (e, stdout) => {
      if (!e) return resolve({ codigo: 0, stdout: String(stdout) });
      const codigo = (e as NodeJS.ErrnoException).code;
      resolve({ codigo: typeof codigo === "number" ? codigo : null, stdout: "" });
    });
  });

export const gitReal: Git = gitConPlazo(5_000);

// El commit y la rama que la terminal DECLARA al subir la guía: 3 segundos (no 5) porque esto es un extra que nunca
// debe hacer esperar a nadie.
export const gitRapido: Git = gitConPlazo(3_000);

// `.supcoflow/proyecto.json` vive DENTRO del repo, y el repo puede ser un clon ajeno: su contenido lo
// decide quien lo escribió. Por eso ni la carpeta ni el archivo se siguen si son enlaces (uno hacia
// `~/.ssh/…` haría que la terminal leyera, o escribiera, lo que el repo quiera), y se lee con tope.
export const TOPE_DEL_ARCHIVO_DEL_REPO = 64 * 1024;
// Lo que devuelve `leer` cuando hay ALGO ahí que no se lee (un enlace, una carpeta, algo enorme, sin
// permiso). No es JSON a propósito: `proyecto crear` lo trata como un archivo distinto (sale 4, «no lo
// toqué») sin que nada de lo que hay ahí llegue a la salida.
export const ARCHIVO_QUE_NO_SE_LEE = "\u0000(no se lee)";

// Un archivo que la persona nombra (el logo) con las mismas defensas que los del repo: sin seguir
// enlaces, sin FIFOs que cuelguen, sólo archivos comunes y con tope (se lee tope + 1 por si crece).
export function leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string } {
  let fd: number;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { error: code === "ENOENT" ? "no existe" : code === "ELOOP" ? "es un enlace" : "no se pudo abrir" };
  }
  try {
    if (!fstatSync(fd).isFile()) return { error: "no es un archivo común" };
    const buf = Buffer.alloc(tope + 1);
    let n = 0;
    for (;;) {
      const leidos = readSync(fd, buf, n, buf.length - n, null);
      if (leidos === 0) break;
      n += leidos;
      if (n > tope) return { error: "es demasiado grande" };
    }
    return { bytes: new Uint8Array(buf.subarray(0, n)) };
  } catch {
    return { error: "no se pudo leer" };
  } finally {
    closeSync(fd);
  }
}

export function archivosDelRepo(avisar: (s: string) => void): DepsDeProyecto["archivos"] {
  // La carpeta: tiene que ser una carpeta de verdad. Un enlace o un archivo con ese nombre se rechaza;
  // `null` sólo si no existe.
  const carpetaPropia = (dir: string): "propia" | "ausente" | "ajena" => {
    try {
      const st = lstatSync(dir);
      return st.isDirectory() && !st.isSymbolicLink() ? "propia" : "ajena";
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "ENOENT" ? "ausente" : "ajena";
    }
  };
  const noSeLee = (p: string, porque: string) => {
    avisar(`No leo ${p}: ${porque}.`);
    return ARCHIVO_QUE_NO_SE_LEE;
  };

  return {
    leer(p) {
      const carpeta = carpetaPropia(dirname(p));
      if (carpeta === "ausente") return null;
      if (carpeta === "ajena") return noSeLee(p, `${basename(dirname(p))} no es una carpeta común (¿un enlace?)`);
      let fd: number;
      try {
        // O_NOFOLLOW: un enlace en el último tramo falla (ELOOP) en vez de abrir su destino.
        // O_NONBLOCK: abrir un FIFO no se cuelga esperando a quien escriba.
        fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        return noSeLee(p, code === "ELOOP" ? "es un enlace" : "no se pudo abrir");
      }
      try {
        const st = fstatSync(fd);
        if (!st.isFile()) return noSeLee(p, "no es un archivo común");
        if (st.size > TOPE_DEL_ARCHIVO_DEL_REPO) return noSeLee(p, "es demasiado grande");
        // Se lee hasta el tope + 1 y no `st.size`: el archivo puede crecer entre el fstat y la lectura.
        const buf = Buffer.alloc(TOPE_DEL_ARCHIVO_DEL_REPO + 1);
        let n = 0;
        for (;;) {
          const leidos = readSync(fd, buf, n, buf.length - n, null);
          if (leidos === 0) break;
          n += leidos;
          if (n > TOPE_DEL_ARCHIVO_DEL_REPO) return noSeLee(p, "es demasiado grande");
        }
        return buf.subarray(0, n).toString("utf8");
      } catch {
        return noSeLee(p, "no se pudo leer");
      } finally {
        closeSync(fd);
      }
    },
    // Sólo se llama cuando `leer` dijo que no hay nada. El `.tmp` lleva un nombre al azar y se crea en
    // exclusiva (`wx` no atraviesa un enlace que alguien dejara con ese nombre), y la carpeta se vuelve
    // a mirar DESPUÉS del mkdir: `mkdir -p` sobre un enlace a una carpeta no falla, y escribir ahí
    // sería escribir donde el repo quiera.
    escribir(p, s) {
      const dir = dirname(p);
      mkdirSync(dir, { recursive: true });
      if (carpetaPropia(dir) !== "propia") throw new Error(`${dir} no es una carpeta común`);
      const tmp = join(dir, `.${basename(p)}.${randomUUID()}.tmp`);
      try {
        const fd = openSync(tmp, "wx", 0o644);
        try {
          writeSync(fd, s);
        } finally {
          closeSync(fd);
        }
        renameSync(tmp, p);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    },
  };
}

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
  git: Git;
  cwd: string;
  idempotencia: RegistroDeIdempotencia;
  conexion: DepsDeConexion;
  proyecto: DepsDeProyecto;
  configurar: DepsDeCatalogo;
  guia: DepsDeGuia;
  claves: DepsDeClaves;
  widget: DepsDeWidget;
  instalacion: DepsDeInstalacion;
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

  // Al lado de las credenciales y con el mismo almacén (carpeta 0700, archivo 0600, `.tmp` en
  // exclusiva): nunca dentro del repo donde se corre el comando, que la publicaría con un `git add -A`.
  const rutaDeIdempotencia = join(dirname(rutaDelArchivo), "idempotencia.json");
  const idempotencia = crearRegistroDeIdempotencia({
    origen: api.origin,
    almacen: almacenDeArchivo(rutaDeIdempotencia, fsReal),
    rutaDelArchivo: rutaDeIdempotencia,
    fs: fsReal,
    generar: randomUUID,
    ahora: Date.now,
    avisar,
  });
  const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const cwd = process.cwd();
  // Los candados de `claves crear` viven al lado de las credenciales, nunca en un repo.
  const candados = crearCandados(fsDelCandadoReal, join(dirname(rutaDelArchivo), "candados"), process.pid, procesoVivo);
  const secretos = crearGuardaDeSecretos(fsDeSecretosReal);
  const configurarEnElMotor = {
    api, guardado, git: gitReal, cwd, avisar,
    buscarProyecto: (a: URL, clave: string, repo: string) => buscarProyecto(a, clave, repo, fetch),
    leerConfiguracion: (a: URL, clave: string, id: string) => leerConfiguracion(a, clave, id, fetch),
    configurar: (a: URL, clave: string, ruta: string, cuerpo: unknown, extra?: { idempotencyKey?: string }) => configurar(a, clave, ruta, cuerpo, fetch, extra),
  };

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
      dormir,
      pedirCodigo: (a, maquina) => pedirCodigo(a, maquina, fetch),
      canjear: (a, deviceCode, plazoMs) => canjear(a, deviceCode, fetch, plazoMs),
      revocarPropia: (a, clave, plazoMs) => revocarPropia(a, clave, fetch, plazoMs),
      avisar,
      tramoMs,
    },
    quienSoy: (a, clave) => quienSoy(a, clave, fetch),
    git: gitReal,
    cwd,
    idempotencia,
    conexion: {
      api, guardado, git: gitReal, cwd, ahora: Date.now, dormir, avisar, tramoMs,
      crearConexion: (a, clave, repo) => crearConexion(a, clave, repo, fetch),
      ultimaConexion: (a, clave, repo, plazoMs) => ultimaConexion(a, clave, repo, fetch, plazoMs),
    },
    proyecto: {
      api, guardado, git: gitReal, cwd, idempotencia, archivos: archivosDelRepo(avisar), avisar,
      buscarProyecto: (a, clave, repo) => buscarProyecto(a, clave, repo, fetch),
      ultimaConexion: (a, clave, repo, plazoMs) => ultimaConexion(a, clave, repo, fetch, plazoMs),
      crearProyecto: (a, clave, conexionId, cuerpo, key) => crearProyecto(a, clave, conexionId, cuerpo, key, fetch),
      leerProyecto: (a, clave, id) => leerProyecto(a, clave, id, fetch),
    },
    configurar: {
      ...configurarEnElMotor,
      subirLogo: (a, clave, id, archivo) => subirLogo(a, clave, id, archivo, fetch),
      leerArchivoChico,
      leerCatalogo: (a, clave) => leerCatalogo(a, clave, fetch),
    },
    guia: {
      ...configurarEnElMotor,
      leerArchivoChico, fetch, gitDeclarado: gitRapido,
      revisar: revisarGuia, publicar: publicarGuia, ver: leerGuia, elegir: elegirOrigen,
    },
    claves: {
      ...configurarEnElMotor,
      listarClaves: (a, clave, id) => listarClaves(a, clave, id, fetch),
      esClaveDeConsultaDelProyecto: (a, clave, id) => esClaveDeConsultaDelProyecto(a, clave, id, fetch),
      idempotencia, candados, secretos,
    },
    widget: {
      api, guardado, git: gitReal, cwd,
      buscarProyecto: configurarEnElMotor.buscarProyecto,
      leerWidget: (a, clave, id) => leerWidget(a, clave, id, fetch),
    },
    // La versión que se anota es la de `describir` (pinzada contra package.json por test): una sola fuente
    // para lo que la terminal dice de sí misma.
    instalacion: {
      ...configurarEnElMotor,
      leerArchivoChico, rutaReal: rutaRealOEnNada, esCarpeta: esCarpetaReal,
      escribir: archivosDelRepo(avisar).escribir,
      terminal: DESCRIPCION.version,
    },
  };
}
