// Abrir el navegador de la persona en los pasos que la necesitan (R-B): el login, la App de GitHub, la conexión del repo.
// Nunca pasa por un shell: el binario y los argumentos van por separado (`spawn` con `shell: false`), y la URL se valida
// antes (https, o http sólo contra la propia máquina, como la dirección de la API). Si no se puede abrir (sin pantalla, por
// SSH, en un contenedor, en un CI, con `--no-browser` o `SUPCOFLOW_NO_BROWSER=1`) devuelve `false` y quien llama muestra la
// URL y el código como siempre.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export type Ejecutar = (bin: string, args: string[], env: Record<string, string>) => Promise<boolean>;

export type DepsDelNavegador = {
  env: Record<string, string | undefined>;
  plataforma: NodeJS.Platform;
  enContenedor: () => boolean;
  ejecutar: Ejecutar;
};

/** Lo que `login` y `repo connect` reciben: abre la URL y dice si lo logró. Nunca lanza. */
export type AbrirNavegador = (url: string) => Promise<boolean>;

const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAXIMO_DE_LA_URL = 2_048;
// `cmd /c start` re-interpreta la línea: `&`, `^`, `%`, `|`, `<`, `>` y las comillas la romperían. Una URL con algo fuera de
// esta lista no se abre en Windows (se muestra, como cuando no hay navegador).
const SEGURA_EN_CMD = /^[A-Za-z0-9\-._~:/?#@+=]+$/;

const verdadera = (v: string | undefined) => v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";

export function urlAbrible(url: string): boolean {
  if (url.length === 0 || url.length > MAXIMO_DE_LA_URL || /[\s\u0000-\u001f\u007f]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  return u.protocol === "https:" || (u.protocol === "http:" && LOCALES.has(u.hostname));
}

/** ¿Tiene sentido intentar abrir un navegador acá? Sólo mira el entorno; no ejecuta nada. */
export function hayDondeAbrir(d: Pick<DepsDelNavegador, "env" | "plataforma" | "enContenedor">): boolean {
  const { env } = d;
  if (verdadera(env.SUPCOFLOW_NO_BROWSER)) return false;
  if (verdadera(env.CI)) return false;
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return false;
  if (d.plataforma === "darwin" || d.plataforma === "win32") return true;
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return !(env.container || d.enContenedor());
}

export function ordenParaAbrir(plataforma: NodeJS.Platform, url: string): { bin: string; args: string[] } | null {
  if (plataforma === "darwin") return { bin: "open", args: [url] };
  if (plataforma === "win32") return SEGURA_EN_CMD.test(url) ? { bin: "cmd", args: ["/c", "start", "", url] } : null;
  return { bin: "xdg-open", args: [url] };
}

export function crearAbridor(d: DepsDelNavegador): AbrirNavegador {
  return async (url) => {
    try {
      if (!urlAbrible(url) || !hayDondeAbrir(d)) return false;
      const orden = ordenParaAbrir(d.plataforma, url);
      return orden === null ? false : await d.ejecutar(orden.bin, orden.args, entornoDelNavegador(d.env));
    } catch {
      return false;
    }
  };
}

// Un entorno mínimo para el hijo (el navegador no necesita SUPCOFLOW_TOKEN ni ningún otro secreto del shell): sólo lo que
// hace falta para encontrar la pantalla, la sesión de escritorio y el navegador elegido.
const VARIABLES_DEL_NAVEGADOR = [
  "PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE", "XDG_DATA_DIRS", "XDG_CONFIG_HOME", "DBUS_SESSION_BUS_ADDRESS", "DESKTOP_SESSION", "BROWSER",
  "SystemRoot", "ComSpec", "windir", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP",
];
function entornoDelNavegador(env: Record<string, string | undefined>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const k of VARIABLES_DEL_NAVEGADOR) {
    const v = env[k];
    if (v !== undefined) r[k] = v;
  }
  return r;
}

// Un `xdg-open` puede quedarse vivo mientras el navegador arranca: pasados unos segundos sin error se da por abierto.
const ESPERA_MAXIMA_MS = 3_000;

export const ejecutarReal: Ejecutar = (bin, args, env) =>
  new Promise((resolve) => {
    let listo = false;
    const terminar = (v: boolean) => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      resolve(v);
    };
    const reloj = setTimeout(() => terminar(true), ESPERA_MAXIMA_MS);
    try {
      const hijo = spawn(bin, args, { stdio: "ignore", env, shell: false, windowsHide: true, detached: true });
      hijo.on("error", () => terminar(false));
      hijo.on("close", (codigo) => terminar(codigo === 0));
      hijo.unref();
    } catch {
      terminar(false);
    }
  });

export const abridorReal = (env: Record<string, string | undefined> = process.env): AbrirNavegador =>
  crearAbridor({ env, plataforma: process.platform, enContenedor: () => existsSync("/.dockerenv"), ejecutar: ejecutarReal });
