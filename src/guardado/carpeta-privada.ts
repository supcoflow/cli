// Guardar en una carpeta COMPARTIDA (la salida que propone el aviso: /Users/Shared/supcoflow-<uid>) sin que otro usuario de
// la máquina pueda ocupar el nombre, dejar un enlace o plantar ahí un pedido pendiente que la terminal reenviaría con la
// clave de la persona (revisión 1, P2-2). Se comprueba ANTES de leer y de escribir, y cada vez, no sólo al sugerir.
//
// Sólo se exige algo cuando la carpeta de la terminal cuelga de una carpeta que otros pueden escribir. Una carpeta
// personal normal (~/.config/supcoflow) no cambia en nada.
import path from "node:path";
import type { Almacen } from "./index.ts";
import { rutaReal, type Impedimento } from "./repo.ts";

export type Ficha =
  | { existe: false }
  | { existe: true; tipo: "carpeta" | "archivo" | "enlace" | "otro"; uid: number | null; modo: number };

export type FsPrivada = {
  /** `lstat` (no sigue el enlace) o `stat` (lo sigue). */
  ficha(p: string, seguirEnlaces: boolean): Ficha;
  crearDir(p: string, modo: number): void;
  realpath(p: string): string;
  existe(p: string): boolean;
  /** El usuario que corre la terminal; `null` donde no hay (no se puede comparar dueños). */
  miUid(): number | null;
};

/** Un lugar donde no es seguro leer ni guardar: no se leyó ni se escribió nada. */
export class SinLugarSeguro extends Error {
  constructor(readonly impedimento: Impedimento) {
    super(impedimento.detalle);
  }
}

const SIN_ESCRIBIR_OTROS = 0o022;
const SIN_ACCESO_OTROS = 0o077;
const STICKY = 0o1000;

const impedimento = (detalle: string): Impedimento => ({ codigo: "carpeta_compartida_insegura", detalle });

// «Compartida»: la puede escribir cualquiera, o la puede escribir el grupo de otra persona. El grupo propio (umask 002,
// ~/.config en 0775) no cuenta: no es un lugar donde un tercero pueda ocupar un nombre.
function esCompartida(f: Extract<Ficha, { existe: true }>, miUid: number | null): boolean {
  return (f.modo & 0o002) !== 0 || (miUid !== null && f.uid !== miUid && (f.modo & 0o020) !== 0);
}

/**
 * Recorre `cadena` (de la raíz al destino) con las reglas de una carpeta personal bajo una compartida. La carpeta compartida
 * de confianza es la MÁS ALTA que otros pueden escribir (no la más cercana al destino): una raíz por usuario que se declara
 * 01777 no se vuelve «la compartida» para saltarse sus propias comprobaciones (revisión 2, P2-R2-1).
 */
function recorrer(cadena: string[], fs: FsPrivada, o: { crear: boolean }): Impedimento | null {
  const miUid = fs.miUid();
  let desde = -1;
  let compartida: Extract<Ficha, { existe: true }> | null = null;
  for (let i = 0; i < cadena.length - 1; i++) {
    const f = fs.ficha(cadena[i]!, true);
    if (f.existe && f.tipo === "carpeta" && esCompartida(f, miUid)) {
      desde = i;
      compartida = f;
      break;
    }
  }
  if (compartida === null) return null;
  const A = cadena[desde]!;
  if ((compartida.modo & STICKY) === 0) {
    return impedimento(`${A} can be written by other users and isn't sticky, so anyone could replace what I keep under it; I won't read or save anything there.`);
  }

  for (let i = desde + 1; i < cadena.length; i++) {
    const c = cadena[i]!;
    let f = fs.ficha(c, false);
    if (!f.existe) {
      if (!o.crear) return null; // nada más abajo existe todavía
      try {
        fs.crearDir(c, 0o700);
      } catch {
        return impedimento(`I couldn't create ${c}.`);
      }
      f = fs.ficha(c, false);
      if (!f.existe) return impedimento(`I couldn't create ${c}.`);
    }
    if (f.tipo === "enlace") {
      if (miUid !== null && f.uid !== miUid) return impedimento(`${c} is a link that isn't yours (it is under the shared folder ${A}); I don't follow it.`);
      f = fs.ficha(c, true);
      if (!f.existe) return impedimento(`${c} is a broken link.`);
    }
    if (f.tipo !== "carpeta") return impedimento(`${c} isn't a folder.`);
    if (miUid !== null && f.uid !== miUid) return impedimento(`${c} isn't yours (it is under the shared folder ${A}); someone else made it. Use another XDG_CONFIG_HOME.`);
    if ((f.modo & SIN_ESCRIBIR_OTROS) !== 0) return impedimento(`${c} can be written by other users; run \`chmod 700 ${c}\` or use another XDG_CONFIG_HOME.`);
    if (i === desde + 1 && (f.modo & SIN_ACCESO_OTROS) !== 0) {
      return impedimento(`${c} is under the shared folder ${A} and other users can read it; run \`chmod 700 ${c}\` or use another XDG_CONFIG_HOME.`);
    }
  }
  return null;
}

const cadenaDe = (destino: string): string[] => {
  const cadena: string[] = [];
  for (let p = destino; ; p = path.dirname(p)) {
    cadena.unshift(p);
    if (path.dirname(p) === p) break;
  }
  return cadena;
};

/**
 * `null` si `dir` es utilizable; si no, qué falla. Con `crear`, crea con 0700 lo que falta y lo vuelve a verificar (así, si
 * otro usuario ganó la carrera por el nombre, se ve). Sin `crear` no escribe nada.
 *
 * Se revisa dos veces: la cadena ESCRITA (con sus enlaces: uno ajeno no se sigue) y, si un enlace propio la desvía, la cadena
 * REAL de su destino, con los mismos requisitos para sus ancestros (revisión 2, P2-R2-2). Ante la duda, se rechaza.
 */
export function revisarCarpetaPrivada(dir: string, fs: FsPrivada, o: { crear?: boolean } = {}): Impedimento | null {
  const destino = path.resolve(dir);
  const escrita = recorrer(cadenaDe(destino), fs, { crear: o.crear === true });
  if (escrita !== null) return escrita;
  let real: string;
  try {
    real = rutaReal(destino, fs);
  } catch {
    return impedimento(`I can't tell where ${destino} really is (a broken link?).`);
  }
  return real === destino ? null : recorrer(cadenaDe(real), fs, { crear: false });
}

/**
 * Envuelve un almacén de archivo: ANTES de cada lectura, escritura o borrado comprueba que la carpeta siga siendo de la
 * persona. Leer con la carpeta ocupada por otro lanza, no devuelve «no hay»: un pedido plantado no se usa.
 */
export function almacenEnCarpetaPrivada(base: Almacen, d: { ruta: string; fs: FsPrivada }): Almacen {
  const dir = path.dirname(d.ruta);
  const revisar = (crear: boolean) => {
    const i = revisarCarpetaPrivada(dir, d.fs, { crear });
    if (i !== null) throw new SinLugarSeguro(i);
  };
  return {
    nombre: base.nombre,
    async leer(cuenta, techoMs) {
      revisar(false);
      return base.leer(cuenta, techoMs);
    },
    async escribir(cuenta, r, techoMs) {
      revisar(true);
      await base.escribir(cuenta, r, techoMs);
    },
    async borrar(cuenta, techoMs) {
      revisar(false);
      await base.borrar(cuenta, techoMs);
    },
  };
}
