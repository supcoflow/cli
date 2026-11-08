// El repo de GitHub de la carpeta donde se corre la terminal, o el que pide `--repo`.
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

// Dice el nombre real del host de un alias de SSH (el `HostName` de su bloque `Host` en `~/.ssh/config`, leído como texto);
// null si no se pudo saber con certeza.
export type ResolverAlias = (host: string) => Promise<string | null>;
export type Git = ((args: string[], cwd: string) => Promise<{ codigo: number | null; stdout: string }>) & {
  /** Sólo el git real lo trae: con él, un `origin` con alias de SSH se resuelve leyendo `~/.ssh/config` como texto. Sin él, no se resuelve. */
  resolverAlias?: ResolverAlias;
};

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
// es github.com, pero el dueño/repo sí tiene la forma de uno de GitHub. Si hay con qué (el git real), el host se
// resuelve leyendo `~/.ssh/config` como texto (ver `ssh-config.ts`: nunca se corre `ssh` ni nada) y se acepta sólo si el
// nombre real es GitHub; si no se puede, se le dice qué asociar a mano, una vez.
// El puerto sólo existe en la forma `ssh://`; en la forma `git@host:o/r` no hay puerto (null).
const FORMAS_DE_ALIAS_CON_PUERTO = [
  /^[A-Za-z0-9._-]+@([A-Za-z0-9._-]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/[A-Za-z0-9._-]+@([A-Za-z0-9._-]+)(?::(\d+))?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

function aliasConPuerto(url: string): { host: string; repo: string; puerto: number | null } | null {
  const limpia = url.trim();
  const scp = FORMAS_DE_ALIAS_CON_PUERTO[0]!.exec(limpia);
  const ssh = scp ? null : FORMAS_DE_ALIAS_CON_PUERTO[1]!.exec(limpia);
  const host = scp ? scp[1]! : ssh ? ssh[1]! : null;
  if (host === null) return null;
  const repo = scp ? `${scp[2]}/${scp[3]}` : `${ssh![3]}/${ssh![4]}`;
  if (host.toLowerCase() === "github.com" || !esRepoValido(repo)) return null;
  return { host, repo, puerto: ssh && ssh[2] !== undefined ? Number(ssh[2]) : null };
}

export function aliasDelOrigin(url: string): { host: string; repo: string } | null {
  const a = aliasConPuerto(url);
  return a ? { host: a.host, repo: a.repo } : null;
}

// Los nombres reales de host de GitHub para git por SSH: `github.com`, y `ssh.github.com` (el SSH de GitHub por el
// puerto 443). Se compara exacto, sin mayúsculas y sin el punto final de un nombre absoluto.
const HOSTS_DE_GITHUB = new Set(["github.com", "ssh.github.com"]);

export function esHostDeGithub(hostname: string): boolean {
  return HOSTS_DE_GITHUB.has(hostname.toLowerCase().replace(/\.$/, ""));
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

// El puerto de la URL no cambia qué bloque `Host` aplica (se busca por el alias), pero sí adónde se conecta: GitHub sólo
// atiende por SSH en el 22 (`github.com`) y en el 443 (`ssh.github.com`, y también en el 22). Con otro puerto, o con
// un 443 en `github.com`, la URL no apunta a GitHub y no se acepta.
function puertoDeGithub(hostname: string, puerto: number | null): boolean {
  if (puerto === null || puerto === 22) return true;
  return puerto === 443 && hostname.toLowerCase().replace(/\.$/, "") === "ssh.github.com";
}

export type MotivoLocal = "sin_git" | "sin_origin" | "origin_no_es_github" | "origin_alias_ssh";
export type RepoLocal = {
  repo: string | null; raiz: string | null; motivo?: MotivoLocal;
  /** El `origin` tal cual se puede mostrar (sin usuario:clave@); sólo si no dio un repo de GitHub. */
  origen?: string;
  /** Si el origin tiene forma de alias de SSH: el host y el dueño/repo que habría que asociar. `real` es el host al que
   *  lo resuelve `~/.ssh/config` (otro que GitHub); `sinResolver`, que se intentó y no se pudo; `puerto`, que es GitHub pero con un puerto que GitHub no atiende por SSH. Sin ninguno de los dos, no se intentó. */
  alias?: { host: string; repo: string; real?: string; sinResolver?: true; puerto?: number };
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
  const conPuerto = url ? aliasConPuerto(url) : null;
  const alias: RepoLocal["alias"] | null = conPuerto ? { host: conPuerto.host, repo: conPuerto.repo } : null;
  // Con el git real, el alias se resuelve: si el nombre real es GitHub, este origin ES ese repo de GitHub.
  if (conPuerto && alias && git.resolverAlias) {
    let real: string | null = null;
    try { real = await git.resolverAlias(conPuerto.host); } catch { real = null; }
    if (real !== null && esHostDeGithub(real)) {
      if (puertoDeGithub(real, conPuerto.puerto)) return { repo: conPuerto.repo, raiz };
      alias.puerto = conPuerto.puerto!; // es GitHub, pero con un puerto donde GitHub no atiende por SSH
    } else if (real === null) alias.sinResolver = true; else alias.real = real;
  }
  const asociado = await git(["remote", "get-url", REMOTO_DE_ASOCIACION], cwd);
  const urlAsociada = asociado.codigo === 0 ? asociado.stdout.trim() : "";
  const repoAsociado = urlAsociada ? repoDelOrigin(urlAsociada) : null;
  if (repoAsociado) return { repo: repoAsociado, raiz };
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
    const a = local.alias;
    const queEs = a.real !== undefined ? `, which your SSH configuration points to \`${a.real}\`, not github.com.`
      : a.puerto !== undefined ? `, but port ${a.puerto} isn't one GitHub serves over SSH (22, or 443 on ssh.github.com).`
      : a.sinResolver ? ", and I couldn't tell from your SSH configuration (read as text, nothing is run) that it is github.com."
      : ", which I don't resolve.";
    return `Your origin uses the SSH alias \`${a.host}\`${queEs}${como}`;
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
