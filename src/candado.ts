// Un candado por operación en ESTA máquina (segunda revisión externa del 2026-10-16, hallazgo 1): comprobar
// que un archivo autentica y después escribirlo no es atómico, y dos `claves crear` del mismo proyecto y
// nombre pisaban uno el secreto del otro. Un archivo creado en exclusiva es el candado más simple que
// funciona entre procesos sin dependencias.
//
// ─── No se recupera solo (tercera revisión, hallazgo 1) ─────────────────────────
//
// La primera versión borraba un candado «viejo» y tomaba uno nuevo. Leer la fecha y después borrar no es
// atómico: dos procesos que encontraban el mismo candado viejo entraban los dos, y el primero en soltar
// borraba el del otro. Ahora un candado de un proceso que ya no existe se informa con su ruta y lo borra una
// persona, que sabe que no hay nadie corriendo. Y `soltar` sólo borra si el archivo sigue siendo el suyo.
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export type TomaDelCandado =
  | { tipo: "tomado"; soltar(): void }
  | { tipo: "ocupado" }
  | { tipo: "abandonado"; ruta: string }
  | { tipo: "no_disponible"; ruta: string };
export type Candados = { tomar(nombre: string): TomaDelCandado };
export type FsDelCandado = {
  /** `false` si ya existe; lanza ante cualquier otro error (permisos). */
  crearExclusivo(p: string, contenido: string, modo: number): boolean;
  /** `null` si no se puede leer. */
  leer(p: string): string | null;
  borrar(p: string): void;
  crearDir(p: string, modo: number): void;
};

export function crearCandados(fs: FsDelCandado, carpeta: string, pid: number, procesoVivo: (pid: number) => boolean): Candados {
  return {
    tomar(nombre) {
      // El nombre lleva el id del proyecto y el nombre de la clave que eligió la persona: el hash lo vuelve
      // un nombre de archivo sin barras ni puntos, sea lo que sea.
      const ruta = path.join(carpeta, `${createHash("sha256").update(nombre).digest("hex")}.lock`);
      const token = randomUUID();
      let creado: boolean;
      try {
        fs.crearDir(carpeta, 0o700);
        creado = fs.crearExclusivo(ruta, JSON.stringify({ pid, token }), 0o600);
      } catch {
        return { tipo: "no_disponible", ruta };
      }
      if (!creado) {
        let duenio: number | null = null;
        try {
          const v = JSON.parse(fs.leer(ruta) ?? "null") as { pid?: unknown } | null;
          duenio = typeof v?.pid === "number" ? v.pid : null;
        } catch {
          duenio = null;
        }
        // Un candado que no se entiende tampoco se toca: «abandonado» le pide a una persona que mire.
        return duenio !== null && procesoVivo(duenio) ? { tipo: "ocupado" } : { tipo: "abandonado", ruta };
      }
      return {
        tipo: "tomado",
        soltar() {
          // Sólo si sigue siendo MÍO: si una persona lo borró y otro tomó uno nuevo, no se toca.
          try {
            const v = JSON.parse(fs.leer(ruta) ?? "null") as { token?: unknown } | null;
            if (v?.token === token) fs.borrar(ruta);
          } catch {
            /* best-effort: si no se pudo, queda abandonado y se informa con su ruta */
          }
        },
      };
    },
  };
}
