// ¿Este repo va con la cuenta en la que estoy? (1A.1, fricción 6). La terminal junta lo que ya sabe y frena, ANTES de
// conectar, crear o publicar nada, ante lo que no cierra y se puede VER:
//   - el `.supcoflow/proyecto.json` del clon contra el proyecto que la clave ve para ese repo;
//   - ese archivo cuando no se entiende;
//   - al crear un proyecto: el dueño del repo contra el login de GitHub de la clave, y la falta de GitHub.
// Qué NO cubre: un proyecto del mismo repo en OTRO equipo cuando el clon no tiene su archivo (el motor tendría que mirar
// en todos los equipos y eso filtra información entre clientes), ni prueba una identidad: el motor compara el número de
// GitHub y el login es una etiqueta que se puede cambiar. Por eso `dueno_distinto_del_login` es una posible incoherencia.
import path from "node:path";
import type { Proyecto, Yo } from "../api.ts";
import { SALIDA, type Resultado } from "../contrato.ts";
import type { Fuente } from "../guardado/index.ts";

// Lo único que se lee de un `.supcoflow/proyecto.json` ajeno es su id, y sólo si tiene esta forma:
// así lo que salga a la terminal no puede ser otra cosa que un id (Review Focus 11).
const FORMA_DEL_ID = /^proj_[a-z0-9-]{1,80}$/;
export const RUTA_DEL_ARCHIVO_DEL_CLON = path.join(".supcoflow", "proyecto.json");

export function idDelArchivo(crudo: string): string | null {
  try {
    const v: unknown = JSON.parse(crudo);
    if (typeof v !== "object" || v === null) return null;
    const id = (v as Record<string, unknown>).id;
    return typeof id === "string" && FORMA_DEL_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type ArchivoDelClon = { estado: "ausente" } | { estado: "valido"; id: string } | { estado: "ilegible" };

/** Los tres estados del archivo del clon. Nunca se imprime su contenido; sólo el id, si tiene forma de id. */
export function leerElArchivoDelClon(archivos: { leer(p: string): string | null } | undefined, raiz: string | null): ArchivoDelClon {
  // Sin clon de este repo (un `--repo` ajeno a la carpeta) no hay archivo que le pertenezca.
  if (archivos === undefined || raiz === null) return { estado: "ausente" };
  let crudo: string | null;
  try {
    crudo = archivos.leer(path.join(raiz, RUTA_DEL_ARCHIVO_DEL_CLON));
  } catch {
    return { estado: "ilegible" };
  }
  if (crudo === null) return { estado: "ausente" };
  const id = idDelArchivo(crudo);
  return id === null ? { estado: "ilegible" } : { estado: "valido", id };
}

export type Motivo = "proyecto_del_clon_distinto" | "archivo_del_clon_ilegible" | "dueno_distinto_del_login" | "sin_github";

export function contextoIncoherente(motivo: Motivo, message: string, extra: Record<string, unknown> = {}): Resultado {
  return { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "contexto_incoherente", motivo, message, ...extra }, texto: message };
}

/**
 * El clon contra lo que la clave ve (lo que comparten TODOS los comandos que actúan sobre el proyecto del repo).
 * `null` = coherente. `proyecto` es el que la clave ve para este repo, o null si no ve ninguno.
 */
export function coherenciaDelClon(archivo: ArchivoDelClon, proyecto: Pick<Proyecto, "id"> | null, repo: string): Resultado | null {
  if (archivo.estado === "ilegible") {
    return contextoIncoherente("archivo_del_clon_ilegible",
      "I can't read `.supcoflow/proyecto.json` in this clone; I won't act on this repo until it's readable. Look at it before going on.",
      { repo, en_el_clon: { estado: "ilegible", id: null } });
  }
  if (archivo.estado === "valido" && archivo.id !== proyecto?.id) {
    return contextoIncoherente("proyecto_del_clon_distinto",
      `The project noted in this clone (${archivo.id}) isn't the one your account sees for this repo (${proyecto?.id ?? "none"}). `
      + "Check which account you signed in with (`supcoflow whoami`), or, if that file is old, review it.",
      { repo, en_el_clon: { estado: "valido", id: archivo.id }, proyecto: proyecto?.id ?? null });
  }
  return null;
}

export type Contexto = {
  equipo: string;
  /** El login de GitHub, o «email», o «clave_de_consulta». `identidad_tipo` lo distingue de un login que se llame igual. */
  identidad: string;
  identidad_tipo: "github" | "email" | "clave_de_consulta";
  fuente: Fuente;
  repo: string;
  proyecto: string | null;
  en_el_clon: { estado: ArchivoDelClon["estado"]; id: string | null };
};

export function armarElContexto(d: { yo: Yo; fuente: Fuente; repo: string; proyecto: Pick<Proyecto, "id"> | null; archivo: ArchivoDelClon }): Contexto {
  const { yo } = d;
  const soloLectura = yo.via === "clave_de_consulta";
  const login = yo.usuario?.login ?? null;
  const tipo = soloLectura ? "clave_de_consulta" : login !== null ? "github" : "email";
  return {
    equipo: yo.equipo,
    identidad: tipo === "github" ? login! : tipo,
    identidad_tipo: tipo,
    fuente: d.fuente,
    repo: d.repo,
    proyecto: d.proyecto?.id ?? null,
    en_el_clon: { estado: d.archivo.estado, id: d.archivo.estado === "valido" ? d.archivo.id : null },
  };
}

/** La línea que la persona lee: quién es, en qué equipo, qué repo y qué proyecto. */
export function lineaDelContexto(c: Contexto, readOnlyDe: string | null = null): string {
  const quien = c.identidad_tipo === "github" ? `@${c.identidad}` : c.identidad_tipo === "email" ? "signed in with email (no GitHub)" : `using a read-only key${readOnlyDe ? ` for ${readOnlyDe}` : ""}`;
  const cuenta = `You're ${quien} in team ${c.equipo}`;
  const proyecto = c.proyecto !== null ? `project ${c.proyecto} (existing)` : `no project yet (it will be created in team ${c.equipo})`;
  return `${cuenta}; repo ${c.repo}; ${proyecto}.`;
}

/**
 * Sólo cuando la clave NO ve proyecto para el repo y se va a crear uno: lo que se ve de la cuenta contra el repo.
 * Una clave de consulta no crea nada, así que no se compara su login con nadie.
 */
export function coherenciaAlCrear(d: { yo: Yo; fuente: Fuente; repo: string }): Resultado | null {
  if (d.yo.via === "clave_de_consulta") return null;
  const login = d.yo.usuario?.login ?? null;
  if (login === null) {
    return contextoIncoherente("sin_github", "Connecting a repo needs a Supcoflow account signed in with GitHub.", { repo: d.repo });
  }
  const dueno = d.repo.split("/")[0]!;
  if (dueno.toLowerCase() === login.toLowerCase()) return null;
  const deLaVariable = d.fuente === "env"
    ? " Your key comes from SUPCOFLOW_TOKEN, which wins over a new login: unset it or replace it first; I don't touch it."
    : "";
  return contextoIncoherente("dueno_distinto_del_login",
    `This repo's owner on GitHub (@${dueno}) isn't the GitHub account your key shows (@${login}). `
    + `If you renamed your GitHub account, sign in to the Supcoflow console with GitHub again (that updates it) and run this again; otherwise sign in as @${dueno}.${deLaVariable}`,
    { repo: d.repo, dueno, login, ...(d.fuente === "env" ? { fuente: "env" } : {}) });
}
