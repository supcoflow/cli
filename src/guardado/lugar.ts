// El prechequeo SIN ESCRITURAS de lo que guardar un registro necesita (1A.1, fricción 3): se llama antes del OK de gasto
// para que la persona sepa ya si esta máquina va a poder guardar el pedido de la prueba, y no después. Mira lo mismo que
// `persistir` (src/guardado/archivo.ts) va a pedirle al disco, y lo de git de la fricción 2c.
//
// Qué promete y qué no: «no se detectaron impedimentos» no es «se va a poder escribir». Un disco que se llena después, o
// un cambio al mismo tiempo, no se pueden garantizar sin escribir. El guardado estricto, justo antes del POST, se queda.
import path from "node:path";
import { mirarProteccionDeGit, rutaReal, type FsDeProteccion, type GitDeRuta, type Impedimento } from "./repo.ts";

/** Lo que el prechequeo necesita saber del disco. Todo se ve SIN escribir; `estado` sigue los enlaces. */
export type EstadoEnDisco = { existe: false } | { existe: true; tipo: "archivo" | "carpeta" | "otro"; propio: boolean };
export type FsDelLugar = FsDeProteccion & {
  estado(p: string): EstadoEnDisco;
  /** ¿Se puede leer (`leer`) o escribir y entrar (`escribir`: crear, renombrar y borrar adentro)? */
  puede(p: string, que: "leer" | "escribir"): boolean;
};

export async function revisarElLugar(d: { ruta: string; fs: FsDelLugar; git: GitDeRuta }): Promise<Impedimento[]> {
  const impedimentos: Impedimento[] = [];
  const dir = path.dirname(d.ruta);
  const nombre = path.basename(d.ruta);
  const tmp = d.ruta + ".tmp";

  let real: string;
  try {
    real = rutaReal(path.resolve(dir), d.fs);
  } catch {
    // Un enlace roto en el camino: no se sabe dónde se escribiría, y `persistir` fallaría.
    return [{ codigo: "ruta_irresoluble", detalle: `I can't tell where ${dir} really is (a broken symlink?).` }];
  }
  const carpeta = d.fs.estado(real);
  if (carpeta.existe) {
    if (carpeta.tipo !== "carpeta") {
      impedimentos.push({ codigo: "carpeta_no_es_carpeta", detalle: `${dir} exists but isn't a folder.` });
    } else {
      if (!carpeta.propio) impedimentos.push({ codigo: "carpeta_ajena", detalle: `${dir} isn't yours, so I can't set its permissions to 0700.` });
      if (!d.fs.puede(real, "escribir")) impedimentos.push({ codigo: "carpeta_sin_permiso", detalle: `I can't write in ${dir}.` });
    }
  } else {
    // Todavía no existe: el ancestro más cercano que existe tiene que ser una carpeta donde se pueda crear.
    let ancestro = path.dirname(real);
    while (!d.fs.estado(ancestro).existe && path.dirname(ancestro) !== ancestro) ancestro = path.dirname(ancestro);
    const a = d.fs.estado(ancestro);
    if (!a.existe || a.tipo !== "carpeta" || !d.fs.puede(ancestro, "escribir")) {
      impedimentos.push({ codigo: "padre_sin_permiso", detalle: `${dir} doesn't exist and I can't create it: ${ancestro} isn't a folder I can write in.` });
    }
  }

  const archivo = d.fs.estado(path.join(real, nombre));
  if (archivo.existe) {
    if (archivo.tipo !== "archivo") impedimentos.push({ codigo: "archivo_no_comun", detalle: `${d.ruta} isn't a regular file.` });
    else if (!d.fs.puede(path.join(real, nombre), "leer")) impedimentos.push({ codigo: "archivo_ilegible", detalle: `I can't read ${d.ruta}.` });
  } else if (d.fs.existe(path.join(real, nombre))) {
    impedimentos.push({ codigo: "archivo_no_comun", detalle: `${d.ruta} is a broken symlink.` });
  }
  // El `.tmp` se borra antes de escribir (`borrarSiExiste`, sin recursión): si es una carpeta, no se puede.
  const temporal = d.fs.estado(path.join(real, nombre + ".tmp"));
  if (temporal.existe && temporal.tipo === "carpeta") {
    impedimentos.push({ codigo: "tmp_es_carpeta", detalle: `${tmp} is a folder: I remove that name before saving, and I can't remove a folder.` });
  }

  const git = await mirarProteccionDeGit({ dir, archivos: [nombre, nombre + ".tmp"], fs: d.fs, git: d.git });
  if (!git.protegido) impedimentos.push(git.impedimento);
  return impedimentos;
}
