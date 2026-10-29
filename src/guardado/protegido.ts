// El almacén de archivo de los dos registros de la terminal que PUEDEN vivir bajo una carpeta personal que es un repo
// (`pruebas.json` e `idempotencia.json`; 1A.1, fricción 2c). Es un envoltorio fino: cada `escribir` y cada `borrar`
// pasan por `asegurarProteccionDeGit` ANTES de tocar el disco, porque borrar una entrada reescribe el archivo entero
// por su `.tmp`. Las credenciales no lo usan: dentro de un repo se siguen negando.
import path from "node:path";
import type { Almacen } from "./index.ts";
import { asegurarProteccionDeGit, type FsDeProteccion, type GitDeRuta, type Impedimento } from "./repo.ts";

/** Git no garantiza que este archivo quede fuera del repo: no se escribió (ni se borró) nada. */
export class SinProteccionDeGit extends Error {
  constructor(readonly impedimento: Impedimento) {
    super(impedimento.detalle);
  }
}

export function almacenProtegido(base: Almacen, d: { ruta: string; fs: FsDeProteccion; git: GitDeRuta }): Almacen {
  const dir = path.dirname(d.ruta);
  const archivos = [path.basename(d.ruta), path.basename(d.ruta) + ".tmp"];
  async function proteger(): Promise<void> {
    const p = await asegurarProteccionDeGit({ dir, archivos, fs: d.fs, git: d.git });
    if (!p.protegido) throw new SinProteccionDeGit(p.impedimento);
  }
  return {
    nombre: base.nombre,
    leer: (cuenta, techoMs) => base.leer(cuenta, techoMs),
    async escribir(cuenta, r, techoMs) {
      await proteger();
      await base.escribir(cuenta, r, techoMs);
    },
    async borrar(cuenta, techoMs) {
      // Si no hay nada que borrar, `borrar` no reescribe nada: no hay nada que proteger.
      if ((await base.leer(cuenta, techoMs)) === null) return;
      await proteger();
      await base.borrar(cuenta, techoMs);
    },
  };
}
