// ¿Cae este destino dentro de un repo de git? Si la respuesta es sí, la clave no se escribe ahí:
// un `git add -A` distraído (o un repo de dotfiles que se sube a GitHub) la publicaría (§5.2).
import path from "node:path";

type FsDeRutas = { realpath(p: string): string; existe(p: string): boolean };

// La ruta escrita engaña cuando un tramo es un enlace (`~/.config` armado con `stow` desde un repo
// de dotfiles): se resuelve el ancestro existente más cercano y se le suman los segmentos que todavía
// no existen, porque `realpath` de algo que no existe lanza (Review Focus 6).
export function rutaReal(p: string, fs: FsDeRutas): string {
  let actual = path.resolve(p);
  const faltan: string[] = [];
  while (!fs.existe(actual)) {
    const padre = path.dirname(actual);
    if (padre === actual) break;
    faltan.unshift(path.basename(actual));
    actual = padre;
  }
  return path.join(fs.realpath(actual), ...faltan);
}

// Seguido o no: basta que exista `.git`, directorio o archivo (un worktree tiene un archivo `.git`).
// Se miran las dos rutas porque cualquiera de las dos puede ser la que cae dentro del repo.
export function dentroDeUnWorkingTree(dir: string, fs: FsDeRutas): string | null {
  const escrita = path.resolve(dir);
  for (const inicio of new Set([escrita, rutaReal(escrita, fs)])) {
    let actual = inicio;
    for (;;) {
      if (fs.existe(path.join(actual, ".git"))) return actual;
      const padre = path.dirname(actual);
      if (padre === actual) break;
      actual = padre;
    }
  }
  return null;
}

// ─── La excepción de la carpeta personal que es un repo (1A.1, fricción 2c) ───
// Una carpeta que cae dentro de un repo de git sólo es un destino válido para los registros de la
// terminal (`pruebas.json`, `idempotencia.json`) si GIT mismo dice que los ignora y que no los sigue ni
// los tiene en el índice. Un `.gitignore` solo no alcanza: no protege un archivo ya seguido o agregado.
// Las credenciales NO usan esto: dentro de un repo se siguen negando (`dentroDeUnWorkingTree`).
export type GitDeRuta = (args: string[], cwd: string) => Promise<{ codigo: number | null; stdout: string }>;

export type Impedimento = { codigo: string; detalle: string };
export type Proteccion = { protegido: true } | { protegido: false; impedimento: Impedimento };

export type FsDeProteccion = FsDeRutas & {
  crearDir(p: string, modo: number): void;
  escribirExclusivo(p: string, s: string, modo: number): void;
};

const CONTENIDO_DEL_GITIGNORE = "# Written by supcoflow: nothing in this folder belongs in git.\n*\n";

// La raíz del repo (si hay) de cada una de las dos rutas: la escrita y la real. Un tramo enlazado (`stow`)
// puede hacer que sean dos repos distintos, y cualquiera de los dos publicaría el archivo.
function raicesQueContienen(dir: string, fs: FsDeRutas): Map<string, string[]> {
  const escrita = path.resolve(dir);
  const rutas = new Set([escrita, rutaReal(escrita, fs)]);
  const raices = new Map<string, string[]>();
  for (const ruta of rutas) {
    let actual = ruta;
    for (;;) {
      if (fs.existe(path.join(actual, ".git"))) {
        raices.set(actual, [...(raices.get(actual) ?? []), ruta]);
        break;
      }
      const padre = path.dirname(actual);
      if (padre === actual) break;
      actual = padre;
    }
  }
  return raices;
}

const sinProteger = (codigo: string, detalle: string): Proteccion => ({ protegido: false, impedimento: { codigo, detalle } });

function queHacer(raiz: string, archivo: string): string {
  const rel = path.relative(raiz, archivo);
  return `Take it out of the repo with \`git -C ${raiz} rm --cached -- ${rel}\` or have git ignore it; I won't touch your repo myself.`;
}

async function mirar(
  d: { dir: string; archivos: string[]; fs: FsDeProteccion; git: GitDeRuta },
  conGitignore: (carpeta: string) => boolean,
): Promise<Proteccion> {
  let raices: Map<string, string[]>;
  try {
    raices = raicesQueContienen(d.dir, d.fs);
  } catch {
    return sinProteger("ruta_irresoluble", `I can't tell where ${d.dir} really is (a broken symlink?).`);
  }
  for (const [raiz, carpetas] of raices) {
    for (const carpeta of carpetas) {
      const hayGitignore = conGitignore(carpeta);
      for (const nombre of d.archivos) {
        const archivo = path.join(carpeta, nombre);
        if (hayGitignore) {
          // 0 = ignorado y no seguido; 1 = no lo es (o está seguido o agregado). Cualquier otra cosa (git ausente,
          // `fatal`, tiempo) es «no sé», y no saber no es «protegido».
          const r = await d.git(["check-ignore", "-q", "--", archivo], raiz);
          if (r.codigo === 1) {
            return sinProteger("git_no_lo_ignora", `Git doesn't ignore ${archivo} in the repo ${raiz} (it is tracked or staged, or a .gitignore doesn't cover it). ${queHacer(raiz, archivo)}`);
          }
          if (r.codigo !== 0) return sinProteger("git_no_contesta", `I couldn't ask git whether it ignores ${archivo} in the repo ${raiz}.`);
        } else {
          // Sin `.gitignore` todavía: se crearía uno con `*`, que ignora todo lo que no esté seguido ni en el índice.
          const r = await d.git(["ls-files", "--", archivo], raiz);
          if (r.codigo !== 0) return sinProteger("git_no_contesta", `I couldn't ask git whether it tracks ${archivo} in the repo ${raiz}.`);
          if (r.stdout.trim() !== "") {
            return sinProteger("git_lo_sigue", `Git tracks ${archivo} in the repo ${raiz}. ${queHacer(raiz, archivo)}`);
          }
        }
      }
    }
  }
  return { protegido: true };
}

/** Sin escribir nada: lo mismo que `asegurarProteccionDeGit` va a comprobar, para avisar antes. */
export function mirarProteccionDeGit(d: { dir: string; archivos: string[]; fs: FsDeProteccion; git: GitDeRuta }): Promise<Proteccion> {
  return mirar(d, (carpeta) => d.fs.existe(path.join(carpeta, ".gitignore")));
}

/**
 * Antes de CADA escritura o borrado de un registro. Si la carpeta cae en un repo y no tiene `.gitignore`, crea
 * uno con `*` (en exclusiva: si aparece otro al mismo tiempo no se pisa; y nunca se edita uno que ya estaba),
 * y después le pregunta a git por cada archivo y su `.tmp`. Falla cerrada.
 */
export async function asegurarProteccionDeGit(d: { dir: string; archivos: string[]; fs: FsDeProteccion; git: GitDeRuta }): Promise<Proteccion> {
  let raices: Map<string, string[]>;
  try {
    raices = raicesQueContienen(d.dir, d.fs);
  } catch {
    return sinProteger("ruta_irresoluble", `I can't tell where ${d.dir} really is (a broken symlink?).`);
  }
  if (raices.size === 0) return { protegido: true };
  const gitignore = path.join(path.resolve(d.dir), ".gitignore");
  if (!d.fs.existe(gitignore)) {
    try {
      d.fs.crearDir(path.resolve(d.dir), 0o700);
      d.fs.escribirExclusivo(gitignore, CONTENIDO_DEL_GITIGNORE, 0o600);
    } catch (e) {
      // `EEXIST`: otro proceso lo creó entre medio; sirve igual, y no se toca.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        return sinProteger("no_se_pudo_crear_gitignore", `I couldn't create ${gitignore} to keep this folder out of git.`);
      }
    }
  }
  return mirar(d, () => true);
}
