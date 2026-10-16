// El secreto de una clave de consulta, a un archivo que nombró la persona (§6.5, decisión 5 del bloque 4).
// Nunca sale por stdout: quien corre `claves crear` suele ser un asistente, y lo que lee queda en su
// contexto. El archivo es la ÚNICA copia, así que se escribe con las mismas defensas que las credenciales:
// fuera de un repo de git (un `git add -A` la publicaría), `0600`, sin atravesar enlaces y vía `.tmp` +
// `rename` (nunca queda un archivo a medio escribir).
//
// Lo que ya hay en el destino no se pisa salvo que sea una clave de LA MISMA fila (mismo sufijo): eso es
// la recuperación de un intento a medias, y `claves crear` sólo llega con el candado tomado. Cualquier otra
// cosa podría ser una clave vigente de otro proyecto. Y nada de lo que hay ahí llega a un mensaje.
//
// ─── Un destino ausente se publica sin pisar (revisión del 2026-10-16) ──────────
//
// El candado es por proyecto + NOMBRE de la clave, no por destino. Dos `claves crear` con nombres distintos y
// el mismo `--guardar-en` leían los dos «ausente» y hacían los dos `rename`: el segundo pisaba el archivo del
// primero, que igual confirmaba su clave, activa y sin nadie que tuviera el secreto. Por eso, cuando el
// destino estaba ausente, el temporal se publica con una operación que FALLA si ya existe (`link`); quien
// llega segundo recibe el mismo 4 de «ya tiene otra cosa» y no confirma. El `rename` que pisa queda sólo
// para la recuperación de la MISMA fila, que sí está bajo el candado de ese nombre.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FsMinimo } from "./guardado/archivo.ts";
import { dentroDeUnWorkingTree } from "./guardado/repo.ts";

export type LecturaSinSeguir = { tipo: "ausente" } | { tipo: "enlace" } | { tipo: "contenido"; texto: string } | { tipo: "ilegible" };
export type FsDeSecretos = Pick<FsMinimo, "realpath" | "existe" | "escribirExclusivo" | "renombrar" | "borrarSiExiste"> & {
  /** Abre sin seguir un enlace en el último tramo, sólo archivos comunes y con tope. */
  leerSinSeguir(p: string, tope: number): LecturaSinSeguir;
  /** Publica `tmp` en `destino` sólo si `destino` no existe: `false` si ya hay algo; lanza ante cualquier otro error. No borra `tmp`. */
  publicarSinPisar(tmp: string, destino: string): boolean;
};

export type GuardaDeSecretos = {
  /** ¿Sirve este destino para una clave? Se mira ANTES de pedirle una al motor: una fila pendiente de más no se usa. */
  validarDestino(ruta: string): { error: string; codigo: 3 } | null;
  guardar(ruta: string, claveId: string, secreto: string): "guardado" | { error: string; codigo: 3 | 4 };
  leer(ruta: string): { estado: "ausente" } | { estado: "clave"; claveId: string; secreto: string } | { estado: "otra_cosa" };
};

// Una clave ocupa 85 caracteres: 4 KB es de sobra, y algo más grande ya no es una clave.
const TOPE = 4 * 1024;
const CLAVE = /^scf_([0-9a-f]{16})_[0-9a-f]{64}$/;
const OCUPADO = { error: "el archivo ya tiene otra cosa; borralo o elegí otro destino", codigo: 4 } as const;

export function crearGuardaDeSecretos(fs: FsDeSecretos): GuardaDeSecretos {
  function leer(ruta: string): ReturnType<GuardaDeSecretos["leer"]> {
    const l = fs.leerSinSeguir(ruta, TOPE);
    if (l.tipo === "ausente") return { estado: "ausente" };
    if (l.tipo !== "contenido") return { estado: "otra_cosa" };
    // Un salto final (el que escribe `guardar`, o el de un editor) se tolera; cualquier otra cosa no.
    const m = CLAVE.exec(l.texto.endsWith("\n") ? l.texto.slice(0, -1) : l.texto);
    return m ? { estado: "clave", claveId: `cla_${m[1]}`, secreto: m[0] } : { estado: "otra_cosa" };
  }

  function validarDestino(ruta: string): { error: string; codigo: 3 } | null {
    const destino = path.resolve(ruta);
    // `realpath` lanza con un tramo que es un enlace roto: sin saber dónde cae, no se escribe.
    let raiz: string | null;
    try {
      raiz = dentroDeUnWorkingTree(path.dirname(destino), fs);
    } catch {
      return { error: "no pude resolver la ruta real de la carpeta (¿un enlace roto?)", codigo: 3 };
    }
    if (raiz !== null) return { error: `cae dentro del repo de git ${raiz}, y una clave en un repo termina commiteada; elegí un destino fuera`, codigo: 3 };
    return null;
  }

  return {
    leer,
    validarDestino,
    guardar(ruta, claveId, secreto) {
      const destino = path.resolve(ruta);
      // También acá, aunque `claves crear` ya lo miró antes de pedir: entre una cosa y otra pasa tiempo.
      const invalido = validarDestino(destino);
      if (invalido !== null) return invalido;
      const hay = fs.leerSinSeguir(destino, TOPE);
      if (hay.tipo === "enlace") return { error: "el destino es un enlace; elegí un archivo común", codigo: 3 };
      if (hay.tipo !== "ausente") {
        const actual = leer(destino);
        if (actual.estado !== "clave" || actual.claveId !== claveId) return OCUPADO;
      }
      // El temporal en la MISMA carpeta (el `rename` sólo es atómico dentro del mismo disco), con nombre al
      // azar y en exclusiva: `wx` no atraviesa un enlace que alguien dejara con ese nombre.
      const tmp = path.join(path.dirname(destino), `.${path.basename(destino)}.${randomUUID()}.tmp`);
      let publicado: boolean;
      try {
        fs.escribirExclusivo(tmp, secreto + "\n", 0o600);
        if (hay.tipo === "ausente") {
          publicado = fs.publicarSinPisar(tmp, destino);
          fs.borrarSiExiste(tmp);
        } else {
          fs.renombrar(tmp, destino);
          publicado = true;
        }
      } catch {
        // El mensaje del sistema no se reenvía: podría traer la ruta del temporal o algo peor.
        try {
          fs.borrarSiExiste(tmp);
        } catch {
          /* best-effort */
        }
        return { error: "no se pudo escribir ahí (¿la carpeta existe y tenés permiso?)", codigo: 3 };
      }
      // Otro apareció entre la lectura y la publicación: lo suyo queda intacto y esta clave no se confirma.
      return publicado ? "guardado" : OCUPADO;
    },
  };
}
