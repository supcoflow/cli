// Qué servidor es un alias de SSH, leyendo `~/.ssh/config` COMO TEXTO. Nunca se corre `ssh` ni nada: ni `Match exec`,
// ni `ProxyCommand`, ni `LocalCommand` se evalúan, porque son programas de la persona. Sólo se busca el bloque `Host <alias>`
// y su `HostName`; los bloques `Match` se ignoran (si el alias sólo se resuelve por un `Match`, no se acepta).
// Lo que no se puede leer con certeza (un `Include` raro, un `%h` en el nombre) da null: sin certeza no se adivina.
import { closeSync, constants, fstatSync, opendirSync, openSync, readSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export type LectorDeConfig = {
  /** El texto del archivo, o null si no existe o no se puede leer como archivo común. Tira si es demasiado grande. */
  leer: (ruta: string) => string | null;
  /** Los nombres (sin la carpeta) de lo que hay en una carpeta; null si no se puede. */
  listar: (carpeta: string) => string[] | null;
};

const TOPE_DE_ARCHIVO = 256 * 1024;
const MAXIMO_DE_ARCHIVOS = 40;
const PROFUNDIDAD_MAXIMA = 5;

const MAXIMO_DE_ENTRADAS = 500;

// Lo que no existe (o no es una carpeta en el camino) se ignora, como hace ssh; lo que SÍ está pero no se puede leer con
// seguridad (una carpeta, un FIFO, algo enorme, sin permiso, que cambia mientras se lee) deja la duda: nunca se
// acepta un alias por saltearse un archivo que podía decidir otra cosa.
export const lectorReal: LectorDeConfig = {
  leer(ruta) {
    let fd: number;
    try { fd = openSync(ruta, constants.O_RDONLY | constants.O_NONBLOCK); } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === "ENOENT" || c === "ENOTDIR") return null;
      throw new Ambiguo();
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > TOPE_DE_ARCHIVO) throw new Ambiguo();
      const b = Buffer.alloc(st.size);
      let leidos = 0;
      while (leidos < b.length) {
        const n = readSync(fd, b, leidos, b.length - leidos, leidos);
        if (n === 0) break;
        leidos += n;
      }
      if (leidos !== st.size || fstatSync(fd).size !== st.size) throw new Ambiguo();
      return b.toString("utf8");
    } finally { closeSync(fd); }
  },
  listar(carpeta) {
    let dir;
    try { dir = opendirSync(carpeta); } catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === "ENOENT" || c === "ENOTDIR") return null;
      throw new Ambiguo();
    }
    try {
      const nombres: string[] = [];
      for (let d = dir.readSync(); d; d = dir.readSync()) {
        if (nombres.length >= MAXIMO_DE_ENTRADAS) throw new Ambiguo();
        nombres.push(d.name);
      }
      return nombres;
    } finally { dir.closeSync(); }
  },
};

class Ambiguo extends Error {}

// Palabras de una línea: la clave, y sus argumentos separados por espacios (o un `=`), con comillas dobles. Un `#` que
// empieza una palabra (fuera de comillas) abre un comentario hasta el final de la línea. Lo que no se sabe leer con
// certeza (comillas sin cerrar, barra invertida, un `#` pegado a una palabra) da duda: no se reinterpreta.
function palabras(linea: string): string[] | null {
  const m = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)?(.*)$/s.exec(linea.trim());
  if (!m) return null;
  const out = [m[1]!];
  const resto = m[2]!;
  if (resto.includes("\\")) throw new Ambiguo();
  let i = 0;
  while (i < resto.length) {
    const c = resto[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") break;
    let palabra = "";
    while (i < resto.length && !/\s/.test(resto[i]!)) {
      if (resto[i] === '"') {
        const fin = resto.indexOf('"', i + 1);
        if (fin === -1) throw new Ambiguo();
        palabra += resto.slice(i + 1, fin);
        i = fin + 1;
      } else if (resto[i] === "#") throw new Ambiguo();
      else palabra += resto[i++];
    }
    out.push(palabra);
  }
  return out;
}

// ssh pasa a minúsculas el nombre que se le da, pero un patrón de `Host` se compara tal cual: `Host ALIAS` nunca aplica a `alias`.
function comodinAExpresion(patron: string): RegExp {
  const esc = patron.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}

function aplicaElHost(patrones: string[], alias: string): boolean {
  let alguno = false;
  for (const p of patrones) {
    if (p.startsWith("!")) { if (comodinAExpresion(p.slice(1)).test(alias)) return false; }
    else if (comodinAExpresion(p).test(alias)) alguno = true;
  }
  return alguno;
}

// `global`: antes de cualquier Host/Match del archivo principal. `aplica`/`no_aplica`: dentro de un `Host`. `match`: dentro de un `Match`.
type Contexto = "global" | "aplica" | "no_aplica" | "match";

/** El `HostName` que ssh usaría para `alias` según el texto de `~/.ssh/config`; null si no hay o no se puede saber con certeza. */
export function hostnameDeAlias(aliasDado: string, lector: LectorDeConfig, home: string): string | null {
  const alias = aliasDado.toLowerCase();
  const carpetaSsh = join(home, ".ssh");
  let archivos = 0;
  let hallado: string | null = null;

  // Devuelve true cuando ya se decidió (el primer HostName que aplica gana, como en ssh).
  const recorrer = (ruta: string, ctxInicial: Contexto, profundidad: number): boolean => {
    if (profundidad > PROFUNDIDAD_MAXIMA || ++archivos > MAXIMO_DE_ARCHIVOS) throw new Ambiguo();
    const texto = lector.leer(ruta);
    if (texto === null) return false;
    let ctx = ctxInicial;
    for (const linea of texto.split(/\r?\n/)) {
      const t = linea.trim();
      if (t === "" || t.startsWith("#")) continue;
      const w = palabras(t);
      if (!w) continue;
      const clave = w[0]!.toLowerCase();
      if (clave === "host" || clave === "match") {
        // Un archivo incluido desde dentro de un bloque no puede abrir bloques propios: no hay certeza de cómo los trataría ssh.
        if (profundidad > 0 && ctxInicial !== "global") throw new Ambiguo();
        ctx = clave === "match" ? "match" : aplicaElHost(w.slice(1), alias) ? "aplica" : "no_aplica";
      } else if (clave === "include") {
        if (ctx === "no_aplica") continue; // bajo un Host que no aplica el Include no aporta nada
        for (const destino of w.slice(1)) {
          for (const archivo of expandirInclude(destino)) if (recorrer(archivo, ctx, profundidad + 1)) return true;
        }
      } else if (clave === "hostname") {
        if (ctx === "match") throw new Ambiguo(); // un Match con HostName antes de decidir: no se evalúa, así que no hay certeza
        if (ctx === "no_aplica") continue;
        if (w.length !== 2 || /[%$~]/.test(w[1]!)) throw new Ambiguo();
        hallado = w[1]!;
        return true;
      }
    }
    return false;
  };

  const expandirInclude = (destino: string): string[] => {
    if (/[?[\]{}$%]/.test(destino)) throw new Ambiguo();
    if (destino.startsWith("~") && !destino.startsWith("~/")) throw new Ambiguo(); // `~usuario` o `~`: no se expande
    const ruta = destino.startsWith("~/") ? join(home, destino.slice(2)) : isAbsolute(destino) ? destino : join(carpetaSsh, destino);
    if (!ruta.includes("*")) return [ruta];
    const carpeta = dirname(ruta);
    const nombre = ruta.slice(carpeta.length + 1);
    if (carpeta.includes("*") || nombre.includes("**")) throw new Ambiguo();
    // Como el glob de ssh: el `*` no entra en los archivos ocultos, salvo que el patrón empiece con punto.
    const re = new RegExp(`^${nombre.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const nombres = (lector.listar(carpeta) ?? []).filter((n) => re.test(n) && (nombre.startsWith(".") || !n.startsWith("."))).sort();
    if (nombres.length > MAXIMO_DE_ARCHIVOS) throw new Ambiguo();
    return nombres.map((n) => join(carpeta, n));
  };

  try {
    recorrer(join(carpetaSsh, "config"), "global", 0);
  } catch (e) {
    if (e instanceof Ambiguo) return null;
    throw e;
  }
  // Lo que se muestra o se compara es un nombre de host común; algo raro (espacios, `;`, corchetes) no se interpreta.
  return hallado !== null && /^[A-Za-z0-9._-]{1,253}$/.test(hallado) ? hallado : null;
}
