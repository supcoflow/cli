// Cuando la carpeta personal es un repo de git y git no deja guardar el pedido de la prueba ahí (archivo ya seguido, un
// `.gitignore` que no lo cubre, git que no contesta), la salida que sirve es mudar esos archivos a una carpeta que NO esté
// en ningún repo. `XDG_CONFIG_HOME` bajo la carpeta personal no sirve: cae en el mismo repo. Esto busca una que sí.
//
// Tiene que ser una carpeta que PERSISTE (el pedido guardado es lo que deja retomar la misma prueba sin pedir otra: una
// carpeta temporal del sistema se limpia y lo perdería) y PRIVADA (compartida entre usuarios, pero con una raíz sólo de la
// persona). Por eso nunca /tmp ni /var/tmp. Donde no hay un lugar así (Linux: nada fuera del home es escribible y
// persistente sin ser root), no se sugiere nada y el aviso queda con el `git rm --cached` de siempre.
//
// Sólo MIRA: no crea nada. La raíz la crea la terminal al guardar (0700), y ahí se vuelve a comprobar.
import path from "node:path";
import { revisarCarpetaPrivada } from "./carpeta-privada.ts";
import type { FsDelLugar } from "./lugar.ts";
import { dentroDeUnWorkingTree } from "./repo.ts";

// El texto del comando vive en repo.ts (que arma el aviso) y se reexporta acá para quien busca la carpeta.
export { comandoConLaCarpeta } from "./repo.ts";

/** Dónde se busca, en orden. /Users/Shared es de todos, con sticky y persiste; no hay equivalente sin ser root en Linux. */
export function candidatasFueraDelRepo(plataforma: string = process.platform): string[] {
  return plataforma === "darwin" ? ["/Users/Shared"] : [];
}

/** El usuario que lleva el nombre de la subcarpeta: dos personas en la misma máquina no se pisan. */
export function usuarioParaLaCarpeta(): string {
  return String(typeof process.getuid === "function" ? process.getuid() : process.pid);
}

/**
 * La primera carpeta de `candidatos` donde `XDG_CONFIG_HOME=<ella>` termina guardando en un destino REAL utilizable:
 * `<candidata>/supcoflow-<usuario>/supcoflow`, que es donde la terminal escribe (no la carpeta de arriba). Ese destino, la
 * raíz y la candidata tienen que existir como carpetas utilizables o no existir todavía; no estar en ningún repo (ruta
 * escrita y real, así un enlace hacia un repo no engaña) y pasar la comprobación de carpeta privada (dueño, permisos, sin
 * enlaces ajenos, candidata compartida con sticky). Si ninguna sirve, `null`: no se inventa.
 */
export function carpetaFueraDeUnRepo(d: { fs: FsDelLugar; candidatos: string[]; usuario: string }): string | null {
  for (const base of d.candidatos) {
    try {
      const b = d.fs.estado(base);
      if (!b.existe || b.tipo !== "carpeta" || !d.fs.puede(base, "escribir")) continue;
      if (dentroDeUnWorkingTree(base, d.fs) !== null) continue;
      const raiz = path.join(base, `supcoflow-${d.usuario}`);
      const destino = path.join(raiz, "supcoflow");
      let sirve = true;
      for (const p of [raiz, destino]) {
        const s = d.fs.estado(p);
        if (s.existe) {
          if (s.tipo !== "carpeta" || !s.propio || !d.fs.puede(p, "escribir")) sirve = false;
        } else if (d.fs.existe(p)) {
          sirve = false; // un enlace roto
        }
        if (dentroDeUnWorkingTree(p, d.fs) !== null) sirve = false;
      }
      if (!sirve) continue;
      if (revisarCarpetaPrivada(destino, d.fs) !== null) continue;
      return raiz;
    } catch {
      // Una candidata que no se puede mirar no sirve; la siguiente sí puede.
    }
  }
  return null;
}
