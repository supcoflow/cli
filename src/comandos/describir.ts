// `supcoflow describe --json`: el contrato entero en una línea (§13), para que un asistente sepa
// qué comandos hay, con qué flags, qué puede la clave y qué quiere decir cada código, sin leer la
// ayuda pensada para personas. La ayuda se arma desde acá: una sola fuente, así no se desfasan.
import { SALIDA, type Resultado } from "../contrato.ts";

type Comando = { nombre: string; resumen: string; flags: string[]; ejemplos: string[]; codigos: number[] };

// A mano a propósito, como en api.ts: tiene que coincidir con package.json (lo pinza un test).
const VERSION = "0.9.0";

export const DESCRIPCION: {
  version: string;
  comandos: Comando[];
  flags_globales: string[];
  facultades: { nombre: string; incluye: string; con_api_key: boolean }[];
  codigos: Record<string, string>;
} = {
  version: VERSION,
  comandos: [
    {
      nombre: "login",
      resumen: "Signs in by approving a code from the console. Without an interactive terminal, in two steps: --start and then --wait.",
      flags: [
        "--start: asks for the code and exits 5 with the URL to approve it",
        "--wait: waits for the approval up to 90 s; exits 5 if it hasn't arrived yet (call it again)",
        "--dry-run: says what it would do without asking for anything (not valid with --wait)",
        "--json",
      ],
      ejemplos: ["supcoflow login", "supcoflow login --start --json", "supcoflow login --wait --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "logout",
      resumen: "Revokes the key in use and deletes it from this machine; retries the ones left to revoke.",
      flags: ["--dry-run: says what it would revoke without revoking anything", "--json"],
      ejemplos: ["supcoflow logout", "supcoflow logout --json"],
      codigos: [0, 1, 3],
    },
    {
      nombre: "whoami",
      resumen: "Shows which key the terminal runs with, on whose behalf and in which team.",
      flags: ["--json"],
      ejemplos: ["supcoflow whoami", "supcoflow whoami --json"],
      codigos: [0, 1, 2, 3],
    },
    {
      nombre: "describe",
      resumen: "Describes commands, flags, capabilities and exit codes, for an assistant.",
      flags: ["--json"],
      ejemplos: ["supcoflow describe --json"],
      codigos: [0],
    },
    {
      nombre: "repo connect",
      resumen: "Connects this folder's repo (or --repo's) with the GitHub App: a person confirms it in the console. Without an interactive terminal, in two steps: --start and then --wait.",
      flags: [
        "--start: requests the connection and exits 5 with the URL to confirm it",
        "--wait: waits for the confirmation up to 90 s; exits 5 if it hasn't arrived yet (call it again)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would request without requesting anything (--wait only reads)",
        "--json",
      ],
      ejemplos: ["supcoflow repo connect", "supcoflow repo connect --start --json", "supcoflow repo connect --wait --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "project create",
      resumen: "Creates (or reuses) the already connected repo's project and records it in .supcoflow/proyecto.json; a different existing file is never overwritten (exits 4). Before connecting or creating anything it checks what it can see and exits 4 contexto_incoherente (motivo proyecto_del_clon_distinto: the clone notes a project your account doesn't see for this repo; archivo_del_clon_ilegible: .supcoflow/proyecto.json can't be read; dueno_distinto_del_login: a possible mismatch, the repo's owner on GitHub isn't the GitHub login of your key; sin_github: the account isn't signed in with GitHub) without touching anything.",
      flags: [
        "--install \"…\": the install command, when the engine can't work it out",
        "--test \"…\": the test command, same",
        "--repo owner/repo: the repo, if it isn't this folder's «origin» (without reading or writing this clone's file)",
        "--dry-run: says what it would create without creating anything",
        "--json",
      ],
      ejemplos: ["supcoflow project create --json", "supcoflow project create --install \"pnpm i\" --test \"pnpm test\""],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "project show",
      resumen: "Shows the repo's project: branch, commands and the GitHub App's state; null if it has none yet. It starts with who you are: `contexto` { equipo, identidad (the GitHub login, or «email», or «clave_de_consulta»), identidad_tipo, fuente, repo, proyecto (id or null), en_el_clon { estado: ausente|valido|ilegible, id } }, said as «You're @login in team T; repo O/R; project P (existing)». Exits 4 contexto_incoherente if this clone's .supcoflow/proyecto.json doesn't match what your key sees (proyecto_del_clon_distinto / archivo_del_clon_ilegible) or, when the repo has no project yet, if the account can't create one for it (dueno_distinto_del_login, a possible mismatch / sin_github): it stops BEFORE `repo connect`. The repo comes from the «origin» of this clone; if origin is an SSH alias or not GitHub, from a remote called `supcoflow` that points at https://github.com/owner/repo.git (the first time, `git remote add supcoflow https://github.com/owner/repo.git`: it is never fetched and ssh is never run).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json"],
      ejemplos: ["supcoflow project show --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "catalog",
      resumen: "Lists what can be configured in the chat (keys and accepted values) and the state of the App's contract.",
      flags: ["--json"],
      ejemplos: ["supcoflow catalog --json"],
      codigos: [0, 1, 2, 3],
    },
    {
      nombre: "config",
      resumen: "Shows the repo's project configuration: chat, sites, brand, problem policy and data agreement. The agreement limits what is saved and what the investigating AI reads; it doesn't cover what the chat's AI sees while it talks. Like every command that acts on the repo's project, it exits 4 contexto_incoherente without doing anything if this clone's .supcoflow/proyecto.json notes another project than the one your key sees (proyecto_del_clon_distinto) or can't be read (archivo_del_clon_ilegible).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json"],
      ejemplos: ["supcoflow config --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat on",
      resumen: "Turns the project's support chat on. A current guide is needed (the repo's published one or our agent's approved one); otherwise it exits 4 (skill_no_aprobada).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow chat on --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat off",
      resumen: "Turns the project's support chat off.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow chat off --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat brand",
      resumen: "Changes the chat's title, greeting and colors; whatever you don't name stays as it was.",
      flags: [
        "--title \"…\": the chat's title",
        "--greeting \"…\": the opening greeting",
        "--theme key=value: a color or theme setting (repeatable, one per key); the keys are the API's: acento, fondo, texto, textoSuave, radio, fuente",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do without doing it",
        "--json",
      ],
      ejemplos: ["supcoflow chat brand --title \"Help\" --theme acento=#0a7"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat logo",
      resumen: "Uploads the chat's logo (.png, .jpg or .webp, up to 200 KB).",
      flags: ["--file path: the image", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow chat logo --file logo.png --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "sites add",
      resumen: "Adds a site the chat can load from.",
      flags: ["--site https://…: the site", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow sites add --site https://app.example.com"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "sites remove",
      resumen: "Removes a site from the ones that can load the chat.",
      flags: ["--site https://…: the site", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow sites remove --site https://app.example.com"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "data set",
      resumen: "Sets the data agreement: which data gets through. It limits what is saved and what the AI that investigates the repo reads; it doesn't cover what the chat's AI sees while it talks.",
      flags: [
        "--allow list: data that gets through, comma-separated (user_id, user_role, page_and_browser, screenshots, elements, email, attribute:name) or `nothing`",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do without doing it",
        "--json",
      ],
      ejemplos: ["supcoflow data set --allow user_id,attribute:plan"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "policy set",
      resumen: "Sets what the engine does with a problem that comes in through the chat: investigate it right away (spends) or save it. Saving only stops what the chat does automatically: from the console a person can still ask for the investigation, and it costs.",
      flags: ["--mode investigate|save", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow policy set --mode save"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "keys create",
      resumen: "Creates a read-only key (it only reads its project) and saves it in a 0600 file outside any repo; the secret never goes out through the output.",
      flags: [
        "--name ci: what the key is for",
        "--save-to path: the file where it ends up (outside a repo; if it already has something else it exits 4 and doesn't touch it)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do without doing it",
        "--json",
      ],
      ejemplos: ["supcoflow keys create --name ci --save-to ~/ci.key --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "keys list",
      resumen: "Lists the project's active read-only keys (id, name, date; never the secret).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json"],
      ejemplos: ["supcoflow keys list --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "keys revoke",
      resumen: "Revokes a read-only key by its id; revoking twice leaves the same result.",
      flags: ["--id cla_…: the key (`keys list` gives it)", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow keys revoke --id cla_0123456789abcdef --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guide check",
      resumen: "Checks .supcoflow/guide.md (this clone's root) against the engine, without publishing anything: says whether it's well formed and how many sections it has. It's the step before the commit. If guide.md doesn't exist it reads the old name .supcoflow/guia.md and says so.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin» (the guide is read from this clone only if it is that repo: its origin, or a `supcoflow` remote at https://github.com/owner/repo.git; otherwise it exits 3 falta_guia saying what this clone is and the exact `git remote add supcoflow …`, without asking the engine)", "--dry-run: says what it would send without sending it", "--json"],
      ejemplos: ["supcoflow guide check --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guide publish",
      resumen: "Uploads .supcoflow/guide.md directly (or the old name guia.md, only if guide.md doesn't exist): sends the content, the file it read and the commit and branch this clone declares (if there's git and commits; otherwise, no commit). The engine checks it and makes it the active guide; the commit is kept as «declared by the terminal, not verified in GitHub». With --from-github it keeps the earlier route: it sends the fingerprint and the engine compares it with the main branch's; if it isn't pushed to that branch yet (or it's another one), it exits 5.",
      flags: ["--from-github: doesn't upload the file; verifies against GitHub's main branch (exits 5 guia_no_subida / guia_distinta if it doesn't match)", "--repo owner/repo: the repo, if it isn't this folder's «origin» (the guide is read from this clone only if it is that repo: its origin, or a `supcoflow` remote at https://github.com/owner/repo.git; otherwise it exits 3 falta_guia saying what this clone is and the exact `git remote add supcoflow …`, without asking the engine)", "--dry-run: says what it would send (or the fingerprint with --from-github), without requesting anything", "--json"],
      ejemplos: ["supcoflow guide publish --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "guide show",
      resumen: "Shows the project's active guide, where it comes from, which file it was read from (and whether that name is declared) and whether the main branch still has that version (`al_dia` in the JSON).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json"],
      ejemplos: ["supcoflow guide show --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guide use",
      resumen: "Chooses which guide is active when there are two: the repo's or our agent's.",
      flags: ["--source repo|agent: which one becomes active (required)", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow guide use --source repo --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guide versions",
      resumen: "Lists the guide that governs now (the one the chat reads: its origin and version) and the repo's publications, newest first, with where each one comes from (declared by the terminal or verified in GitHub), commit, file and who published it. At most one says «live»: the one that is the active guide. Read-only.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json: { vigente, publicaciones }"],
      ejemplos: ["supcoflow guide versions --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "widget",
      resumen: "Shows what to paste into the app to get the chat, built by the engine with the project's ids: the package and its exact version, the Next.js wrapper file (`nextjs.contenido`, as is, without rewriting the ids), the file name to use (`nextjs.archivo_sugerido`) and the earlier names the chat may already be installed under (`nextjs.archivos_anteriores`), how to use it, the CSP line and the <script> one (not for Next.js). If the engine describes the app's own interface (`interfaz_propia`: the app builds the chat with its own components; there is no code to paste) it adds the package with its exact version, the ids, the backend, the CSP line and the version of the presentation contract (`contrato_version`), always as the engine sent them. It writes no files. Exits 4 sin_proyecto if the repo has no project; 1 respuesta_inesperada if the engine sends something halfway (a halfway `interfaz_propia` included).",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json: the engine's object as is (`interfaz_propia` only when the engine sends it)"],
      ejemplos: ["supcoflow widget --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "install record",
      resumen: "Records in .supcoflow/instalacion.json (this clone's root, version 3) which versions the chat was installed with: the skill, this terminal, the chat package (declared in the app's package.json and installed in node_modules), the project configuration and what was installed: `forma` (`widget` or `interfaz_propia`, with --shape), `archivos` (the files the chat lives in, with --file) and `contrato` (the version of the presentation contract the installed package carries in its contract.json, or null if it has none); never a secret or a date. A version 1 or 2 file is read without error (the `archivo` of a 2 was a widget). Repeating without changes doesn't touch it (sin_cambios: true), and running again without --shape or --file keeps the form and the files already recorded. The JSON adds `archivos`, `forma` and `contrato`; `archivo` (the first file) stays for the skills before 0.9.0. It only rewrites it if git already keeps the previous one: with uncommitted changes (or deleted without a commit) it exits 4 cambios_sin_commit; if it exists without being tracked (or ignored), 4 archivo_no_versionado. Others: 3 falta_skill / skill_invalida / archivo_invalido / forma_invalida / app_fuera_del_repo / app_inexistente / sin_clon; 4 sin_proyecto / acuerdo_ilegible; 1 paquete_ilegible / configuracion_inesperada / archivo_no_escrito.",
      flags: [
        "--skill version: the metadata.version of the skill that installs it (semver, required; without it exits 3 falta_skill without requesting anything)",
        "--file path: a file of the chat, relative to the repo root (no `..`, not absolute, not a symlink or through one; otherwise exits 3 archivo_invalido and writes nothing). It can be repeated (up to 20; an own interface lives in several files) and replaces the list already recorded",
        "--shape widget|own-interface: what was installed: the packaged widget, or a chat the app builds with its own components (`forma: interfaz_propia`); anything else exits 3 forma_invalida. Without it the recorded form is kept",
        "--app folder: the app's folder, relative to the repo root (the root by default; outside the repo it exits 3 app_fuera_del_repo)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin» (the file goes in this clone only if it is that repo: its origin, or a `supcoflow` remote at https://github.com/owner/repo.git; otherwise it exits 3 sin_clon saying what this clone is and the exact `git remote add supcoflow …`, without asking the engine)",
        "--dry-run: shows the file and the difference without writing anything",
        "--json",
      ],
      ejemplos: ["supcoflow install record --skill 0.3.1 --app web --file web/app/_supcoflow/support-chat.tsx --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "diagnose",
      resumen: "Says, free of charge and writing nothing, how far the installation is (sign-in, repo, GitHub App, allowed sites, chat, guide and interface: N of 7) and, apart, whether a test of the project would go in and how far it would get: policy, monthly balance against the test's ceiling, open tests, whether THIS machine can save the test request (the local point `maquina`, checked without writing anything) and whatever else the engine adds. Exits 0 if everything is ready and 4 if something needs fixing (no_listo), with each point; if `maquina` isn't ok, `listo` and `prueba.listo` are false and the N of 7 doesn't change. The seventh point, `interfaz`, is local and only reads: if .supcoflow/instalacion.json records an own interface (`forma: interfaz_propia`) it checks that the recorded files are still there and that the contract recorded is not older than the one the project declares (`interfaz_propia.contrato_version` in `widget`); without an own interface it is ok («Not applicable»). It is advice: it lowers the N of 7 but doesn't stop a test.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json: { instalacion: { ok, total: 7, puntos }, prueba: { listo, puntos }, maquina: { ok, impedimentos: [{ codigo, detalle }] }, intento_pendiente: { techo_usd, politica } | null, … }"],
      ejemplos: ["supcoflow diagnose --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "test",
      resumen: "Tests the installation end to end: a problem comes in through the same door as the chat and ends up as an issue. It spends one investigation (up to the ceiling you authorize; with the save policy it goes as far as the saved case and doesn't spend). Without --authorize-spend it sends nothing: it exits 4 falta_autorizacion with techo_usd, saldo_usd, tope_usd and comprometido_usd, and, checked before you say yes and without writing anything, `maquina` { ok, impedimentos: [{ codigo, detalle }] } (whether this machine can save the test request: if it isn't ok the message says why first) and `intento_pendiente` { techo_usd, politica } | null (a request waiting for confirmation: only its ceiling and policy, never its message or key). With --authorize-spend, --ceiling and --expect-policy it requests the test with exactly those values (it doesn't re-read anything to choose them) and exits 5 with prueba_id; then --wait follows it. If the ceiling or the policy changed in the meantime it exits 4 techo_distinto / politica_distinta with the new values and doesn't retry: ask again. Others: 4 prueba_en_curso (with its id), chat_deshabilitado, requiere_api_key, intento_pendiente; 6 tope_mensual; 1 with intento_pendiente: true if the answer didn't arrive (repeating resumes the same test).",
      flags: [
        "--authorize-spend: authorizes the spend of ONE test; without it nothing that writes is sent",
        "--ceiling usd: the ceiling you authorize, the number you were shown (required with --authorize-spend)",
        "--expect-policy investigate|save: the policy you were offered (required with --authorize-spend); if the project's is another one, nothing starts",
        "--message \"…\": the problem text of the test (by default, a fixed one from the engine); with a request that was never confirmed, another --message exits 4 intento_pendiente",
        "--wait: follows the last test up to 90 s; exits 5 while it runs, 0 with the issue (or saved), 4 if it needs a look (with the link to the inbox); the charge comes out as it is (pending is never 0)",
        "--test-id prb_…: with --wait, follows that test instead of the last saved one",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do (project, ceiling, balance, policy) without requesting anything that writes",
        "--json",
      ],
      ejemplos: ["supcoflow test --json", "supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate --json", "supcoflow test --wait --json", "supcoflow test --dry-run --authorize-spend --ceiling 2 --expect-policy investigate --json"],
      codigos: [0, 1, 2, 3, 4, 5, 6],
    },
  ],
  flags_globales: ["--json: the result as a line of JSON on stdout; warnings go to stderr", "--help, -h: the help with examples"],
  facultades: [
    {
      nombre: "read",
      incluye: "Identity and team, projects, configuration, cases, issues, runs, costs, installation state, reading and checking the guide (guide check, guide show, guide versions)",
      con_api_key: true,
    },
    {
      nombre: "configure",
      incluye: "Create/reuse a project, connect or disconnect the repo, configure and turn on the chat, allowed sites, data agreement, problem policy, publish the guide, choose the active guide (guide use), create and revoke read-only keys, agent profiles",
      con_api_key: true,
    },
    { nombre: "test", incluye: "The test up to the issue (spends, within the limits)", con_api_key: true },
    {
      nombre: "console_only",
      incluye: "Raise the spend cap, delete the project, turn on the factory, give or remove people's access: only with a console session",
      con_api_key: false,
    },
    {
      nombre: "operator",
      incluye: "Requests, /maquinaria, closing runs, the operator factory: never by key, even if the person is an operator",
      con_api_key: false,
    },
  ],
  codigos: {
    [SALIDA.ok]: "ok",
    [SALIDA.inesperado]: "unexpected",
    [SALIDA.faltaLogin]: "login needed",
    [SALIDA.entradaInvalida]: "invalid input",
    [SALIDA.haceFaltaUnaPersona]: "a person is needed",
    [SALIDA.esperandoAUnaPersona]: "waiting for a person (call again)",
    [SALIDA.topeAlcanzado]: "limit reached",
  },
};

export function comandoDescribir(): Resultado {
  return { codigo: SALIDA.ok, json: { ok: true, ...DESCRIPCION }, texto: ayuda(null) };
}

function bloque(c: Comando): string {
  return [
    `  ${c.nombre}: ${c.resumen}`,
    ...c.flags.map((f) => `      ${f}`),
  ].join("\n");
}

export function ayuda(comando: string | null): string {
  const elegidos = comando === null ? DESCRIPCION.comandos : DESCRIPCION.comandos.filter((c) => c.nombre === comando);
  const uso = comando === null ? "supcoflow <command> [flags]" : `supcoflow ${comando} [flags]`;
  const codigos = Object.entries(DESCRIPCION.codigos).map(([n, t]) => `  ${n}  ${t}`);
  return [
    `Usage: ${uso}`,
    "",
    comando === null ? "Commands:" : "Command:",
    ...elegidos.map(bloque),
    "",
    "Flags for every command:",
    ...DESCRIPCION.flags_globales.map((f) => `  ${f}`),
    "",
    "Examples:",
    ...elegidos.flatMap((c) => c.ejemplos.map((e) => `  ${e}`)),
    "",
    "Exit codes:",
    ...codigos,
  ].join("\n");
}
