// Qué servidor es un alias de SSH, leyendo `~/.ssh/config` COMO TEXTO. Nunca se corre `ssh` ni nada: ni `Match exec`,
// ni `ProxyCommand`, ni `LocalCommand` se evalúan, porque son programas de la persona. Sólo se busca el bloque `Host <alias>`
// y su `HostName`; los bloques `Match` se ignoran (si el alias sólo se resuelve por un `Match`, no se acepta).
// Lo que no se puede leer con certeza (un `Include` raro, un `%h` en el nombre) da null: sin certeza no se adivina.
import { closeSync, constants, fstatSync, openSync, readdirSync, readSync } from "node:fs";
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

export const lectorReal: LectorDeConfig = {
  leer(ruta) {
    let fd: number;
    try { fd = openSync(ruta, constants.O_RDONLY | constants.O_NONBLOCK); } catch { return null; }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) return null;
      if (st.size > TOPE_DE_ARCHIVO) throw new Ambiguo();
      const b = Buffer.alloc(st.size);
      let leidos = 0;
      while (leidos < b.length) {
        const n = readSync(fd, b, leidos, b.length - leidos, leidos);
        if (n === 0) break;
        leidos += n;
      }
      return b.subarray(0, leidos).toString("utf8");
    } finally { closeSync(fd); }
  },
  listar(carpeta) {
    try { return readdirSync(carpeta); } catch { return null; }
  },
};

class Ambiguo extends Error {}

// Palabras de una línea: separadas por espacios o por `=`, con comillas dobles.
function palabras(linea: string): string[] | null {
  const m = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)?(.*)$/s.exec(linea.trim());
  if (!m) return null;
  const out = [m[1]!];
  const resto = m[2]!;
  const re = /"([^"]*)"|(\S+)/g;
  for (let x = re.exec(resto); x; x = re.exec(resto)) out.push(x[1] ?? x[2]!);
  return out;
}

function comodinAExpresion(patron: string): RegExp {
  const esc = patron.toLowerCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${esc}$`);
}

function aplicaElHost(patrones: string[], alias: string): boolean {
  const a = alias.toLowerCase();
  let alguno = false;
  for (const p of patrones) {
    if (p.startsWith("!")) { if (comodinAExpresion(p.slice(1)).test(a)) return false; }
    else if (comodinAExpresion(p).test(a)) alguno = true;
  }
  return alguno;
}

type Contexto = "aplica" | "no_aplica" | "match";

/** El `HostName` que ssh usaría para `alias` según el texto de `~/.ssh/config`; null si no hay o no se puede saber con certeza. */
export function hostnameDeAlias(alias: string, lector: LectorDeConfig, home: string): string | null {
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
      if (clave === "host") ctx = aplicaElHost(w.slice(1), alias) ? "aplica" : "no_aplica";
      else if (clave === "match") ctx = "match";
      else if (clave === "include") {
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
    let ruta = destino.startsWith("~/") ? join(home, destino.slice(2)) : isAbsolute(destino) ? destino : join(carpetaSsh, destino);
    if (!ruta.includes("*")) return [ruta];
    const carpeta = dirname(ruta);
    const nombre = ruta.slice(carpeta.length + 1);
    if (carpeta.includes("*") || nombre.includes("**")) throw new Ambiguo();
    const re = new RegExp(`^${nombre.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const nombres = (lector.listar(carpeta) ?? []).filter((n) => re.test(n)).sort();
    return nombres.map((n) => join(carpeta, n));
  };

  try {
    recorrer(join(carpetaSsh, "config"), "aplica", 0);
  } catch (e) {
    if (e instanceof Ambiguo) return null;
    throw e;
  }
  // Lo que se muestra o se compara es un nombre de host común; algo raro (espacios, `;`, corchetes) no se interpreta.
  return hallado !== null && /^[A-Za-z0-9._-]{1,253}$/.test(hallado) ? hallado : null;
}
