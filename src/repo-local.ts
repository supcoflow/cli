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

export async function leerRepoLocal(
  git: Git,
  cwd: string,
): Promise<{ repo: string | null; raiz: string | null; motivo?: "sin_git" | "sin_origin" | "origin_no_es_github" }> {
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  const raiz = top.codigo === 0 ? top.stdout.trim() : "";
  if (!raiz) return { repo: null, raiz: null, motivo: "sin_git" };
  const origin = await git(["remote", "get-url", "origin"], cwd);
  const url = origin.codigo === 0 ? origin.stdout.trim() : "";
  if (!url) return { repo: null, raiz, motivo: "sin_origin" };
  const repo = repoDelOrigin(url);
  if (!repo) return { repo: null, raiz, motivo: "origin_no_es_github" };
  return { repo, raiz };
}

const MOTIVOS: Record<string, string> = {
  sin_git: "this folder isn't a git repo",
  sin_origin: "the repo has no remote called \"origin\"",
  origin_no_es_github: "the \"origin\" remote isn't a GitHub repo",
};

export async function repoPedido(d: { flagRepo: string | null; git: Git; cwd: string }): Promise<{ repo: string; raiz: string | null }> {
  const local = await leerRepoLocal(d.git, d.cwd);
  if (d.flagRepo !== null) {
    if (!esRepoValido(d.flagRepo)) {
      throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "repo_invalido", "The value of --repo must be owner/repo (for example owner/my-app), without the URL.");
    }
    // La raíz sólo se da si el origin local es ESE repo: con otro, lo que se escriba en esta
    // carpeta (el archivo del proyecto) no le pertenece.
    const mismo = local.repo !== null && local.repo.toLowerCase() === d.flagRepo.toLowerCase();
    return { repo: d.flagRepo, raiz: mismo ? local.raiz : null };
  }
  if (local.repo === null) {
    const porque = local.motivo ? MOTIVOS[local.motivo] : "the folder couldn't be read";
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "sin_repo", `I couldn't find a GitHub repo here (${porque}). Pass --repo owner/repo.`);
  }
  return { repo: local.repo, raiz: local.raiz };
}
