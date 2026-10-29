// El diagnóstico en dos grupos (0.8.0): «¿está instalado?» (seis puntos, gratis) y «¿una prueba entraría ahora?».
// Los cuatro primeros puntos del grupo `instalacion` son del motor; los otros dos sólo los ve la terminal: que
// la llamada autenticó (`sign-in`) y que el `origin` de esta carpeta es el repo del proyecto (`repo`).
import type { Diagnostico } from "./api.ts";
import { frasePorQueNoAtaClon, type leerRepoLocal } from "./repo-local.ts";

export type Punto = { punto: string; ok: boolean; mensaje: string; grupo: "instalacion" | "prueba" };

export const TOTAL_DE_INSTALACION = 6;
// El orden y los nombres con que se dicen: los ids de los puntos del motor son datos suyos y no cambian.
const DE_LA_INSTALACION: readonly { punto: string; como: string }[] = [
  { punto: "sign-in", como: "sign-in" },
  { punto: "repo", como: "repo" },
  { punto: "instalacion", como: "GitHub App" },
  { punto: "sitios", como: "allowed sites" },
  { punto: "chat", como: "chat" },
  { punto: "guia", como: "guide" },
];
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
