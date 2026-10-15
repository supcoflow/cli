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
