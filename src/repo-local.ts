// El repo de GitHub de la carpeta donde se corre la terminal, o el que pide `--repo`.
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

export type Git = (args: string[], cwd: string) => Promise<{ codigo: number | null; stdout: string }>;

// La misma forma que acepta el motor: si la terminal dejara pasar algo que el motor rechaza, el
// error llegaría como un 400 del servidor en vez de una frase clara acá.
const FORMA_DEL_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

function esRepoValido(s: string): boolean {
  if (!FORMA_DEL_REPO.test(s)) return false;
  const nombre = s.split("/")[1]!;
  return nombre !== "." && nombre !== "..";
}

// El host tiene que ser EXACTAMENTE github.com y va anclado al principio: un origin como
// `https://evil.com/github.com/o/r` contiene «github.com» en la ruta y no es GitHub. Tampoco se
// acepta usuario:clave@ delante del host (una URL con token no se interpreta, se descarta).
// No se sigue `url.<base>.insteadOf` de la config de git: lo que importa es qué repo es, y eso
// lo vuelve a comprobar el motor contra la instalación de la App; acá sólo se arma el pedido.
const FORMAS_DE_ORIGIN = [
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

export function repoDelOrigin(url: string): string | null {
  const limpia = url.trim();
  for (const forma of FORMAS_DE_ORIGIN) {
    const m = forma.exec(limpia);
    if (!m) continue;
    const repo = `${m[1]}/${m[2]}`;
    return esRepoValido(repo) ? repo : null;
  }
  return null;
}

// El `origin` con forma de alias de SSH (`git@github-gf0:dueño/repo`, `ssh://git@github-gf0/dueño/repo`): el host no
// es github.com, pero el dueño/repo sí tiene la forma de uno de GitHub. NO se resuelve (no se corre `ssh` ni se lee su
// configuración: `Match exec` ejecutaría programas de la persona): sólo se le dice qué asociar a mano, una vez.
const FORMAS_DE_ALIAS = [
  /^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/[A-Za-z0-9._-]+@([A-Za-z0-9._-]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

export function aliasDelOrigin(url: string): { host: string; repo: string } | null {
  const limpia = url.trim();
  for (const forma of FORMAS_DE_ALIAS) {
    const m = forma.exec(limpia);
    if (!m) continue;
    const repo = `${m[2]}/${m[3]}`;
    if (m[1]!.toLowerCase() === "github.com" || !esRepoValido(repo)) return null;
    return { host: m[1]!, repo };
  }
  return null;
}

// Lo que se muestra de un `origin`: nunca el usuario:clave@ de una URL (podría ser un token). Las credenciales se quitan de la
// URL ENTERA y recién después se limita el tamaño (recortar antes dejaría pasar un `@` lejano con su clave a medias). Lo que no se
// puede interpretar con seguridad no se muestra crudo: sale un marcador neutro.
const TOPE_DEL_ORIGEN_MOSTRADO = 200;
export function origenParaMostrar(url: string): string {
  const limpia = url.trim();
  const url_ = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/\s]*)(.*)$/s.exec(limpia);
  let mostrable: string | null = null;
  if (url_) {
    // La autoridad llega hasta la primera `/`; el usuario:clave es todo lo anterior al ÚLTIMO `@` de la autoridad.
    const arroba = url_[2]!.lastIndexOf("@");
    const usuario = arroba === -1 ? "" : url_[2]!.slice(0, arroba).split(":")[0]!;
    const host = arroba === -1 ? url_[2]! : url_[2]!.slice(arroba + 1);
    mostrable = `${url_[1]}${usuario === "git" ? "git@" : ""}${host}${url_[3]}`;
  } else if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(limpia)) {
    mostrable = limpia; // `git@host:o/r`: el usuario de un scp no lleva clave
  }
  if (mostrable === null || /\s/.test(mostrable)) return "(an address I don't recognize)";
  return mostrable.length > TOPE_DEL_ORIGEN_MOSTRADO ? mostrable.slice(0, TOPE_DEL_ORIGEN_MOSTRADO) + "…" : mostrable;
}

export type MotivoLocal = "sin_git" | "sin_origin" | "origin_no_es_github" | "origin_alias_ssh";
export type RepoLocal = {
  repo: string | null; raiz: string | null; motivo?: MotivoLocal;
  /** El `origin` tal cual se puede mostrar (sin usuario:clave@); sólo si no dio un repo de GitHub. */
  origen?: string;
  /** Si el origin tiene forma de alias de SSH: el host y el dueño/repo que habría que asociar. */
  alias?: { host: string; repo: string };
  /** ¿Existe ya un remoto llamado `supcoflow` (que no dio un repo de GitHub)? Cambia el comando sugerido. */
  hayRemotoSupcoflow?: boolean;
};

// El remoto de asociación explícita: la persona le dice una sola vez a qué repo de GitHub corresponde este clon cuando su
// `origin` no es una dirección de GitHub (alias de SSH, otro servidor). Con las mismas formas estrictas de `origin`;
// nunca se usa para traer nada.
export const REMOTO_DE_ASOCIACION = "supcoflow";

export async function leerRepoLocal(git: Git, cwd: string): Promise<RepoLocal> {
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  const raiz = top.codigo === 0 ? top.stdout.trim() : "";
  if (!raiz) return { repo: null, raiz: null, motivo: "sin_git" };
  const origin = await git(["remote", "get-url", "origin"], cwd);
  const url = origin.codigo === 0 ? origin.stdout.trim() : "";
  const repoDelOrigen = url ? repoDelOrigin(url) : null;
  // Si `origin` es de GitHub, gana `origin`, como siempre.
  if (repoDelOrigen) return { repo: repoDelOrigen, raiz };
  const asociado = await git(["remote", "get-url", REMOTO_DE_ASOCIACION], cwd);
  const urlAsociada = asociado.codigo === 0 ? asociado.stdout.trim() : "";
  const repoAsociado = urlAsociada ? repoDelOrigin(urlAsociada) : null;
  if (repoAsociado) return { repo: repoAsociado, raiz };
  const alias = url ? aliasDelOrigin(url) : null;
  const comun = { repo: null, raiz, ...(url ? { origen: origenParaMostrar(url) } : {}), ...(urlAsociada ? { hayRemotoSupcoflow: true } : {}) };
  if (!url) return { ...comun, motivo: "sin_origin" };
  if (alias) return { ...comun, motivo: "origin_alias_ssh", alias };
  return { ...comun, motivo: "origin_no_es_github" };
}

// El comando exacto que asocia este clon con un repo de GitHub. `add` si todavía no hay remoto `supcoflow`; `set-url` si
// hay uno que no es una dirección de GitHub.
export function comandoDeAsociacion(repo: string, hayRemoto: boolean): string {
  return `git remote ${hayRemoto ? "set-url" : "add"} ${REMOTO_DE_ASOCIACION} https://github.com/${repo}.git`;
}

const MOTIVOS: Record<string, string> = {
  sin_git: "this folder isn't a git repo",
  sin_origin: "the repo has no remote called \"origin\"",
  origin_no_es_github: "the \"origin\" remote isn't a GitHub repo",
  origin_alias_ssh: "the \"origin\" remote isn't a GitHub repo",
};

// La frase que dice la verdad sobre un clon que no se puede atar a `repo` (owner/repo de GitHub) y cómo atarlo.
export function frasePorQueNoAtaClon(local: RepoLocal, repo: string | null): string {
  if (local.motivo === "sin_git") return "This folder isn't a git clone.";
  const sugerido = repo ?? local.alias?.repo ?? null;
  const como = sugerido === null ? ""
    : ` If this is ${sugerido} on GitHub, tell me once: \`${comandoDeAsociacion(sugerido, local.hayRemotoSupcoflow === true)}\` (it's never fetched).`;
  if (local.motivo === "origin_alias_ssh" && repo === null && local.alias) {
    return `Your origin uses the SSH alias \`${local.alias.host}\`, which I don't resolve.${como}`;
  }
  const clon = local.origen ? `This clone is \`${local.origen}\`, which I can't tie to github.com${repo ? `/${repo}` : ""}.` : "This clone has no \"origin\" remote I can tie to GitHub.";
  return `${clon}${como}`;
}

export async function repoPedido(d: { flagRepo: string | null; git: Git; cwd: string }): Promise<{ repo: string; raiz: string | null; sinClon?: string }> {
  const local = await leerRepoLocal(d.git, d.cwd);
  if (d.flagRepo !== null) {
    if (!esRepoValido(d.flagRepo)) {
      throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "repo_invalido", "The value of --repo must be owner/repo (for example owner/my-app), without the URL.");
    }
    // La raíz sólo se da si el repo local reconocido es ESE repo: con otro, lo que se escriba en esta
    // carpeta (el archivo del proyecto) no le pertenece.
    const mismo = local.repo !== null && local.repo.toLowerCase() === d.flagRepo.toLowerCase();
    if (mismo) return { repo: d.flagRepo, raiz: local.raiz };
    // El mensaje de «no es tu clon» dice por qué, y deja el comando exacto para atarlo si la persona SABE que lo es.
    const sinClon = local.repo !== null
      ? `This clone is github.com/${local.repo}, not ${d.flagRepo}.`
      : frasePorQueNoAtaClon(local, d.flagRepo);
    return { repo: d.flagRepo, raiz: null, sinClon };
  }
  if (local.repo === null) {
    const porque = local.motivo ? MOTIVOS[local.motivo] : "the folder couldn't be read";
    const detalle = local.motivo === "origin_alias_ssh" ? ` ${frasePorQueNoAtaClon(local, null)}` : "";
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "sin_repo", `I couldn't find a GitHub repo here (${porque}).${detalle} Pass --repo owner/repo.`);
  }
  return { repo: local.repo, raiz: local.raiz };
}
