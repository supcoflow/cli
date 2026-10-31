// El diagnóstico en dos grupos (0.8.0): «¿está instalado?» (siete puntos desde la 0.9.0, gratis) y «¿una prueba entraría ahora?».
// Cuatro puntos del grupo `instalacion` son del motor; los otros sólo los ve la terminal: que la llamada autenticó
// (`sign-in`), que el `origin` de esta carpeta es el repo del proyecto (`repo`) y, desde la 0.9.0 (T8, el punto 7), que la
// interfaz propia de la app, si hay una anotada, sigue ahí y cumple el contrato que el proyecto declara (`interfaz`).
import type { LecturaDeLaInstalacion } from "./instalacion.ts";
import { compararSemver, RUTA_DE_LA_INSTALACION } from "./instalacion.ts";
import type { Diagnostico } from "./api.ts";
import { frasePorQueNoAtaClon, type leerRepoLocal } from "./repo-local.ts";

export type Punto = { punto: string; ok: boolean; mensaje: string; grupo: "instalacion" | "prueba" };


// El orden y los nombres con que se dicen: los ids de los puntos del motor son datos suyos y no cambian.
const DE_LA_INSTALACION: readonly { punto: string; como: string }[] = [
  { punto: "sign-in", como: "sign-in" },
  { punto: "repo", como: "repo" },
  { punto: "instalacion", como: "GitHub App" },
  { punto: "sitios", como: "allowed sites" },
  { punto: "chat", como: "chat" },
  { punto: "guia", como: "guide" },
  { punto: "interfaz", como: "interface" },
];
export const TOTAL_DE_INSTALACION = DE_LA_INSTALACION.length;
const DEL_MOTOR = new Set(["instalacion", "sitios", "chat", "guia"]);

export const lineaDeLoRevisado = (n: number) =>
  `Checked ${DE_LA_INSTALACION.map((x) => x.como).slice(0, -1).join(", ")} and ${DE_LA_INSTALACION.at(-1)!.como}: ${n} of ${TOTAL_DE_INSTALACION}, at no cost.`;

export const nombreDelPunto = (punto: string) => DE_LA_INSTALACION.find((x) => x.punto === punto)?.como ?? punto;

export function puntoDeSesion(): Punto {
  return { punto: "sign-in", ok: true, mensaje: "This request was authenticated: you're signed in.", grupo: "instalacion" };
}

export function puntoDelRepo(local: Awaited<ReturnType<typeof leerRepoLocal>>, repoDelProyecto: string): Punto {
  const mal = (mensaje: string): Punto => ({ punto: "repo", ok: false, mensaje, grupo: "instalacion" });
  if (local.repo === null) {
    if (local.motivo === "sin_git") return mal("This folder isn't a git repo, so I can't tell which repo it is.");
    if (local.motivo === "sin_origin") return mal("This repo has no «origin» remote, so I can't tell which repo it is.");
    if (local.motivo === "origin_alias_ssh") return mal(`The «origin» of this repo isn't a GitHub repo. ${frasePorQueNoAtaClon(local, null)}`);
    return mal("The «origin» of this repo isn't a GitHub repo.");
  }
  if (local.repo.toLowerCase() !== repoDelProyecto.toLowerCase()) {
    return mal(`The origin of this folder is ${local.repo}, not the project's repo ${repoDelProyecto}.`);
  }
  return { punto: "repo", ok: true, mensaje: `The origin of this folder is ${local.repo}, the project's repo.`, grupo: "instalacion" };
}

/**
 * El punto 7 (T8): la interfaz propia de la app. Puro: recibe lo ya leído. Es un AVISO local: baja el «N of 7» pero no frena una
 * prueba (la prueba mira que un problema llegue a un issue, no cómo se ve el chat). Sin interfaz propia anotada no aplica y
 * cuenta como ok. El contenido de `instalacion.json` nunca se copia al mensaje.
 *  · `lectura`: lo que dice el archivo (o `null` si no se miró: el clon no es el del repo del proyecto).
 *  · `faltan`: los archivos anotados que ya no están.
 *  · `delProyecto`: el contrato que declara el proyecto hoy (`interfaz_propia.contrato_version`), o null si no se supo.
 */
export function puntoDeLaInterfaz(i: { lectura: LecturaDeLaInstalacion | null; faltan: string[]; delProyecto: string | null }): Punto {
  const punto = (ok: boolean, mensaje: string): Punto => ({ punto: "interfaz", ok, mensaje, grupo: "instalacion" });
  if (i.lectura === null) return punto(true, "Not checked: this folder isn't a clone of the project's repo, so I don't read its installation record.");
  const l = i.lectura;
  if (l.estado === "ausente") return punto(true, `Not applicable: there's no ${RUTA_DE_LA_INSTALACION}, so no own interface is recorded.`);
  if (l.estado === "ilegible") return punto(false, `I can't read ${RUTA_DE_LA_INSTALACION}: run \`supcoflow install record\` again.`);
  if (l.forma !== "interfaz_propia") {
    return punto(true, l.forma === "widget" ? "Not applicable: the chat is recorded as the packaged widget, which has no interface contract to check." : "Not applicable: no own interface is recorded.");
  }
  if (l.archivos.length === 0) return punto(false, "The installation says the chat is an own interface but records none of its files: run `supcoflow install record --file …` again.");
  if (i.faltan.length > 0) return punto(false, `These files of the interface are recorded but gone: ${i.faltan.join(", ")}. Run the skill again to update the record.`);
  if (l.contrato === null) {
    return punto(false, "The interface doesn't record which presentation contract it follows (the installed @supcoflow/chat has no contract.json): update the package and run `supcoflow install record` again.");
  }
  const archivos = `${l.archivos.length} ${l.archivos.length === 1 ? "file" : "files"}`;
  if (i.delProyecto !== null && compararSemver(i.delProyecto, l.contrato) > 0) {
    return punto(false, `The interface (${archivos}) follows contract ${l.contrato}, and the project now declares ${i.delProyecto}: run the skill again to see what changed and check that the interface still conforms.`);
  }
  return punto(true, `The interface (${archivos}) follows contract ${l.contrato}${i.delProyecto === l.contrato ? ", the one the project declares" : ""}.`);
}

/** Reparte los puntos del motor en los dos grupos y suma los dos locales al de la instalación. */
export function agruparPuntos(g: Pick<Diagnostico, "puntos">, locales: Punto[]): { instalacion: Punto[]; prueba: Punto[] } {
  const delMotor = g.puntos.map((p) => ({ ...p, grupo: p.grupo ?? (DEL_MOTOR.has(p.punto) ? "instalacion" : "prueba") }) as Punto);
  const instalacion = [...locales, ...delMotor.filter((p) => p.grupo === "instalacion")];
  // Un punto del grupo que el motor no mandó no se da por bueno: se dice que falta y cuenta como no ok.
  for (const { punto } of DE_LA_INSTALACION) {
    if (!instalacion.some((p) => p.punto === punto)) {
      instalacion.push({ punto, ok: false, mensaje: "The engine didn't report this point.", grupo: "instalacion" });
    }
  }
  const orden = (p: Punto) => {
    const i = DE_LA_INSTALACION.findIndex((x) => x.punto === p.punto);
    return i === -1 ? DE_LA_INSTALACION.length : i;
  };
  return { instalacion: instalacion.sort((a, b) => orden(a) - orden(b)), prueba: delMotor.filter((p) => p.grupo === "prueba") };
}

/** Cuántos de los seis puntos de la instalación están bien (los extras que un motor nuevo sume no cambian el seis). */
export const contarBuenos = (instalacion: Punto[]): number =>
  DE_LA_INSTALACION.filter(({ punto }) => instalacion.some((p) => p.punto === punto && p.ok)).length;
