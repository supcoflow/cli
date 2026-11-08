// Cuando la carpeta personal es un repo de git y git no deja guardar el pedido de la prueba ahí (archivo ya seguido, un
// `.gitignore` que no lo cubre, git que no contesta), la salida que sirve es mudar esos archivos a una carpeta que NO esté
// en ningún repo. `XDG_CONFIG_HOME` bajo la carpeta personal no sirve: cae en el mismo repo. Esto busca una que sí.
//
// Sólo MIRA: no crea nada. La subcarpeta la crea la terminal al guardar (0700), y `revisarElLugar` ya comprueba que se pueda.
import path from "node:path";
import { tmpdir } from "node:os";
import { dentroDeUnWorkingTree } from "./repo.ts";

// El texto del comando vive en repo.ts (que arma el aviso) y se reexporta acá para quien busca la carpeta.
export { comandoConLaCarpeta } from "./repo.ts";
import type { FsDelLugar } from "./lugar.ts";

/** Dónde se busca, en orden: `/var/tmp` (sobrevive a un reinicio) y la carpeta temporal propia del sistema. */
export function candidatasFueraDelRepo(): string[] {
  return [...new Set(["/var/tmp", tmpdir()])];
}

/** El usuario que lleva el nombre de la subcarpeta: dos personas en la misma máquina no se pisan. */
export function usuarioParaLaCarpeta(): string {
  return String(typeof process.getuid === "function" ? process.getuid() : process.pid);
}

/**
 * La primera carpeta de `candidatos` que existe, se puede escribir y no cae en ningún repo (se miran la ruta escrita y la
 * real, así un enlace hacia un repo no engaña), con una subcarpeta propia `supcoflow-<usuario>`. Si esa subcarpeta ya está,
 * tiene que ser una carpeta propia, que se pueda usar y que tampoco esté en un repo. Si ninguna sirve, `null`: no se inventa.
 */
export function carpetaFueraDeUnRepo(d: { fs: FsDelLugar; candidatos: string[]; usuario: string }): string | null {
  for (const base of d.candidatos) {
    try {
      const b = d.fs.estado(base);
      if (!b.existe || b.tipo !== "carpeta" || !d.fs.puede(base, "escribir")) continue;
      if (dentroDeUnWorkingTree(base, d.fs) !== null) continue;
      const sub = path.join(base, `supcoflow-${d.usuario}`);
      const s = d.fs.estado(sub);
      if (s.existe) {
        if (s.tipo !== "carpeta" || !s.propio || !d.fs.puede(sub, "escribir")) continue;
      } else if (d.fs.existe(sub)) {
        continue; // un enlace roto
      }
      if (dentroDeUnWorkingTree(sub, d.fs) !== null) continue;
      return sub;
    } catch {
      // Una candidata que no se puede mirar no sirve; la siguiente sí puede.
    }
  }
  return null;
}
