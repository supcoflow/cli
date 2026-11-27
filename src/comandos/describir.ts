// `supcoflow describe --json`: el contrato entero en una línea (§13), para que un asistente sepa
// qué comandos hay, con qué flags, qué puede la clave y qué quiere decir cada código, sin leer la
// ayuda pensada para personas. La ayuda se arma desde acá: una sola fuente, así no se desfasan.
import { COMANDOS_VIEJOS } from "../alias.ts";
import { FalloDeLaTerminal, SALIDA, type Resultado } from "../contrato.ts";

type Comando = { nombre: string; resumen: string; flags: string[]; ejemplos: string[]; codigos: number[] };

// A mano a propósito, como en api.ts: tiene que coincidir con package.json (lo pinza un test).
const VERSION = "0.12.0";

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
      resumen: "Signs in by approving a code from the console, which it opens in your browser by itself when it can (the json then says `navegador_abierto`: true|false; the URL and the code are always there). Without an interactive terminal, in two steps: --start and then --wait.",
      flags: [
        "--start: asks for the code and exits 5 with the URL to approve it",
        "--wait: waits for the approval up to 90 s; exits 5 if it hasn't arrived yet (call it again)",
        "--dry-run: says what it would do without asking for anything (not valid with --wait)",
        "--no-browser: don't open the URL in the browser (also SUPCOFLOW_NO_BROWSER=1); the URL and the code are shown as always",
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
      resumen: "Describes commands, flags, capabilities and exit codes, for an assistant. `describe <command>` (for example `describe diagnose` or `describe repo connect`) describes only that command: its summary, flags, examples and the exit codes it uses (`comando`, `flags_globales`, `codigos`); an unknown name exits 3 comando_desconocido and lists the commands. Without a command it prints the whole contract.",
      flags: ["<command>: describe only that command (optional)", "--json"],
      ejemplos: ["supcoflow describe --json", "supcoflow describe diagnose --json"],
      codigos: [0, 3],
    },
    {
      nombre: "repo connect",
      resumen: "Connects this folder's repo (or --repo's) with the GitHub App: a person confirms it in the console, which it opens in your browser by itself when it can (the json then says `navegador_abierto`: true|false; the URL is always there). Without an interactive terminal, in two steps: --start and then --wait.",
      flags: [
        "--start: requests the connection and exits 5 with the URL to confirm it",
        "--wait: waits for the confirmation up to 90 s; exits 5 if it hasn't arrived yet (call it again)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would request without requesting anything (--wait only reads)",
        "--no-browser: don't open the URL in the browser (also SUPCOFLOW_NO_BROWSER=1); the URL is shown as always",
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
        "--test \"…\": the test command; not used today (the engine doesn't run it), you can leave it out",
        "--repo owner/repo: the repo, if it isn't this folder's «origin» (without reading or writing this clone's file)",
        "--dry-run: says what it would create without creating anything",
        "--json",
      ],
      ejemplos: ["supcoflow project create --json", "supcoflow project create --install \"pnpm i\""],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "project show",
      resumen: "Shows the repo's project: branch, commands and the GitHub App's state; null if it has none yet. It starts with who you are: `contexto` { equipo, identidad (the GitHub login, or «email», or «clave_de_consulta»), identidad_tipo, fuente, repo, proyecto (id or null), en_el_clon { estado: ausente|valido|ilegible, id } }, said as «You're @login in team T; repo O/R; project P (existing)». Exits 4 contexto_incoherente if this clone's .supcoflow/proyecto.json doesn't match what your key sees (proyecto_del_clon_distinto / archivo_del_clon_ilegible) or, when the repo has no project yet, if the account can't create one for it (dueno_distinto_del_login, a possible mismatch / sin_github): it stops BEFORE `repo connect`. The repo comes from the «origin» of this clone; an SSH alias (`git@alias:owner/repo`) counts as GitHub if the `Host alias` block of ~/.ssh/config (read as plain text, with simple `Include`s; `ssh` and anything else is never run, and `Match` blocks are ignored) has `HostName` github.com or ssh.github.com, and the port of an ssh:// URL, if any, is 22 (or 443 on ssh.github.com). If origin is an alias that doesn't resolve to GitHub, or isn't GitHub, from a remote called `supcoflow` that points at https://github.com/owner/repo.git (the first time, `git remote add supcoflow https://github.com/owner/repo.git`: it is never fetched). Origin wins over `supcoflow`, including an alias that resolves to GitHub.",
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
      resumen: "Shows the repo's project configuration: chat, sites, brand, problem policy and data agreement. The agreement limits what is saved and what the investigating AI reads; it doesn't cover what the chat's AI sees while it talks. A project nobody set an agreement for is CLOSED: the text says «closed (nobody has set it yet)» (the engine marks it `acuerdo_fijado: false`; an older engine's `acuerdo: null` reads the same). Like every command that acts on the repo's project, it exits 4 contexto_incoherente without doing anything if this clone's .supcoflow/proyecto.json notes another project than the one your key sees (proyecto_del_clon_distinto) or can't be read (archivo_del_clon_ilegible).",
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
      resumen: "Checks the guide in this clone against the engine, without publishing anything: says whether it's well formed and how many sections (and documents) it has. It's the step before the commit. The guide is the folder .supcoflow/knowledge/ if it has at least one .md file (every .md directly inside it is a document, sent together as ONE guide; a .md whose name isn't valid is rejected by name, never skipped; the folder governs and says if guide.md is ignored); otherwise .supcoflow/guide.md, or the old name .supcoflow/guia.md only if guide.md doesn't exist (and says so). Per-document problems come with `documento` in `errores`. It warns (exit 0, `nombres_repetidos` in the JSON) when a section name is repeated (across documents or within one), comparing without case or accents as the chat's search does.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin» (the guide is read from this clone only if it is that repo: its origin, or a `supcoflow` remote at https://github.com/owner/repo.git; otherwise it exits 3 falta_guia saying what this clone is and the exact `git remote add supcoflow …`, without asking the engine)", "--dry-run: says what it would send without sending it", "--json"],
      ejemplos: ["supcoflow guide check --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guide publish",
      resumen: "Uploads the guide directly: the folder .supcoflow/knowledge/ as ONE version (all its .md documents, the same rule as guide check) or, without that folder, .supcoflow/guide.md (or the old name guia.md, only if guide.md doesn't exist). It sends the content, what it read and the commit and branch this clone declares (if there's git and commits; otherwise, no commit). The engine checks it and makes it the active guide; the commit is kept as «declared by the terminal, not verified in GitHub». With --from-github it keeps the earlier route: it sends the fingerprint (for a folder, the fingerprint of the whole set: names and contents) and the engine compares it with the main branch's; if it isn't pushed to that branch yet (or it's another one), it exits 5. Meant for CI after the merge (see the README).",
      flags: ["--from-github: doesn't upload the file or the documents; verifies against GitHub's main branch (exits 5 guia_no_subida / guia_distinta if it doesn't match)", "--repo owner/repo: the repo, if it isn't this folder's «origin» (the guide is read from this clone only if it is that repo: its origin, or a `supcoflow` remote at https://github.com/owner/repo.git; otherwise it exits 3 falta_guia saying what this clone is and the exact `git remote add supcoflow …`, without asking the engine)", "--dry-run: says what it would send (or the fingerprint with --from-github), without requesting anything", "--json"],
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
      nombre: "guide stale",
      resumen: "Warns when a change touches code a document of .supcoflow/knowledge/ explains and doesn't touch that document. No AI, no engine call, no sign-in: it only reads git and the clone. It reads each document's header (`sources`: globs of code), diffs the working tree against the merge base with --base (committed, staged and untracked files, so it also works before the commit) and says «you changed X and didn't change the document that explains it». It also warns, each with its own `tipo`: `mapa_vacio` (no documents, or none declares `sources`), `mapa_roto` (a header or the folder can't be read), `fuente_sin_archivos` (a `sources` pattern matches no file: moved or deleted), `cambio_cosmetico` (the document changed only in whitespace), `cobertura_quitada` (it also reads the map at the merge base: the document was deleted or a `sources` pattern removed, and the change touches code it covered that no document covers now), `no_se_pudo_comparar` (the base is missing, the clone is shallow, or git couldn't list the repo's files, `motivo: git_no_pudo_listar`: it says it could NOT compare or complete the check, keeps what it did compute, `comparado` is false, and it suggests `fetch-depth: 0` when that is the cause; it never says «nothing to warn» when it couldn't look). New files that no `sources` covers come apart as `notas` (`fuera_del_mapa`), which never fail --strict. It can't tell whether a text is true or enough, only what was touched. Exits 0 even with warnings; with --strict, 4 (guia_desactualizada) if there is any warning (not a note). JSON: { ok, comparado, base, base_commit, documentos, cambiados, cubiertos, sin_cubrir, avisos: [{ tipo, mensaje, documento, archivos, patrones, … }], notas }.",
      flags: [
        "--base ref: what to compare against, for example origin/main (required; in CI the checkout needs fetch-depth: 0)",
        "--strict: exit 4 if there is any warning (notes don't count)",
        "--json",
      ],
      ejemplos: ["supcoflow guide stale --base origin/main --json", "supcoflow guide stale --base origin/main --strict"],
      codigos: [0, 1, 3, 4],
    },
    {
      nombre: "agents show",
      resumen: "Shows the AI account of each agent of the repo's project (the chat and the triage agent): its state (`lista` ready, `rechazada` rejected by the provider, `sin_saldo` out of balance, `falta` missing), the provider, the last 4 characters of the key and when it was last checked; never the key (it is write-only: once set it is never shown or editable, only replaced or removed). `cuenta_lista` says only that the ACCOUNT is ready, not that the agent's configuration is approved. A missing account is not an error here (exit 0): the skill reads `agentes[].estado` and, if one is missing, does NOT ask for the key in the chat: it tells the person to type `supcoflow agents set-key --agent …` themselves or to set it in the Agents tab. In the JSON the triage agent is `triaje`.",
      flags: [
        "--agent chat|triage: only that agent (both by default)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--json: { proyecto, repo, agentes: [{ agente, estado, cuenta_lista, cuenta: { proveedor, ultimos4, estado, codigo, validada_en, puesta_por, puesta_en } | null }] }",
      ],
      ejemplos: ["supcoflow agents show --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "agents set-key",
      resumen: "Sets or REPLACES (rotates) the AI account of an agent: the provider (AI Gateway) checks the key for free, and the engine stores it encrypted and never shows it again. The key is read without echo from an interactive terminal (a person types it themselves) or from the environment variable `--from-env NAME` names; it never goes as an argument (there is no flag for it: `--key` is flag_desconocido), never from stdin and never through the output: not the screen, not `--json`, not stderr, not an error. Without a terminal and without --from-env it exits 4 sin_terminal and asks for nothing; if the terminal can't hide what is typed it exits 4 sin_eco and doesn't ask. Only a team Owner can (403 requiere_dueno exits 4). A rejected key is not saved (exit 3 clave_rechazada, clave_con_forma_invalida); a provider that didn't answer saved nothing (exit 1 proveedor_no_responde). If the key was saved but the account has no balance it exits 4 cuenta_sin_saldo with guardada: true. Others: 3 falta_agente / agente_invalido / variable_vacia / nombre_de_variable_invalido / clave_como_nombre (the value you passed to --from-env looks like a key: it isn't repeated, and you should treat that key as exposed) / clave_vacia / clave_con_forma_invalida / es_una_clave_de_supcoflow (what you gave is your Supcoflow key, not an AI key) / proveedor_invalido / cancelado; 4 sin_proyecto.",
      flags: [
        "--agent chat|triage: which agent's account (required)",
        "--from-env NAME: the NAME of an environment variable that holds the key (not the key itself); without it, the key is asked for without echo",
        "--provider id: the provider (ai_gateway by default)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do, asking for and sending nothing",
        "--json: { agente, cuenta: { … }, reemplazo, saldo_usd, avisos }",
      ],
      ejemplos: ["supcoflow agents set-key --agent chat", "supcoflow agents set-key --agent triage --from-env AI_GATEWAY_API_KEY --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "agents check",
      resumen: "Asks the provider again, for free and without anyone pasting the key, whether the key stored for an agent works: the way out of a `rechazada` or `sin_saldo` account once it is fixed at the provider. Exits 0 if the account is ready, and 4 (cuenta_rechazada / cuenta_sin_saldo, ok: false, with the same data) if it is not; 4 sin_cuenta if there is no account yet; 1 proveedor_no_responde if the provider didn't answer (it says nothing about the key). The JSON adds `cambio_de_estado`, `saldo_usd` (the account's balance when the provider gives it) and `avisos` (warning codes).",
      flags: ["--agent chat|triage: which agent's account (required)", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json"],
      ejemplos: ["supcoflow agents check --agent chat --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "agents remove",
      resumen: "Removes the AI account of an agent: the key is deleted from Supcoflow (the audit row stays, without the secret). Only a team Owner can (exit 4 requiere_dueno). Removing what isn't there leaves the same as removing it: exit 0 with `sin_cuenta: true`.",
      flags: ["--agent chat|triage: which agent's account (required)", "--repo owner/repo: the repo, if it isn't this folder's «origin»", "--dry-run: says what it would do without doing it", "--json"],
      ejemplos: ["supcoflow agents remove --agent triage --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "agents configure",
      resumen: "Chooses the chat's model from the menu and whether only providers that don't keep your data may be used; the engine saves and approves it in one step. Only the chat: the triage agent's model is approved in the project's Agents tab, not from the terminal (exit 4 no_desde_la_terminal). The chat's message caps (per project and per user) are also set only in the Agents tab. An option that hasn't passed our measurement can't be chosen (exit 3 opcion_sin_medicion). The engine has no way to read the current configuration, so both flags are required: nothing is guessed.",
      flags: [
        "--agent chat: the chat (required)",
        "--option agile|standard|plus: the menu option (the engine's ids agil, estandar and plus work too)",
        "--data-retention allow|deny: `deny` means only providers that don't keep your data",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would send without sending it",
        "--json: { agente, perfil: { version, opcion, modelo_id, esfuerzo, sin_guardado_de_datos } } or { sin_cambios: true, version }",
      ],
      ejemplos: ["supcoflow agents configure --agent chat --option standard --data-retention allow --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "reports list",
      resumen: "Lists the repo's project reports (the console's inbox) with their state, for a PERSON signed in (`login`; a read-only key can read too). Each line: id, date, state (`estado`: con_issue, sin_issue, esperando, relevando, sin_run, guardado, arranque_incierto, reclamado_sin_run, esperando_a_tu_agente, tu_agente_no_contesto, el_agente_fallo, publicacion_a_revisar), the issue if any and whether it needs you (`te_necesitan`). It never carries the report's text (it is read in the console); `titulo` is null for a report that came through the agents' gate, which keeps no text. The JSON is short by default { ok, proyecto, repo, filtro, total, pagina, paginas, por_pagina, conteo, reportes: [{ reporte_id, titulo, creado_en, estado, te_necesitan, issue, investigador }] }; `--full` adds `ahora` and, per report, `origen` and the engine's own Spanish `estado_texto`. 404 (a project or report of another team) exits 3, never 403.",
      flags: [
        "--filter all|needs-you|in-progress|with-issue|saved: which reports (all by default)",
        "--page n: the page, from 1",
        "--per-page n: reports per page, 1 to 100 (25 by default)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--full: adds `ahora`, and `origen` and `estado_texto` per report",
        "--json",
      ],
      ejemplos: ["supcoflow reports list --json", "supcoflow reports list --filter needs-you --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "reports show",
      resumen: "Shows one report's journey (what happened to it, when, and what comes next) for a PERSON signed in. Text in fixed English; the JSON carries the engine's fields cleaned of control characters and secrets. Short by default { ok, proyecto, repo, reporte_id, titulo, creado_en, origen, estado, te_necesitan, investigador: { tipo: supcoflow|agente, agente_id }, issue, eventos: [{ clave, cuando, href }], aviso: { tono, titulo, texto } | null, acciones: [{ accion, via }], enlace_a_la_consola, siguiente, detalle }; `acciones` is what can be asked for through this API now (today only `pedir_investigacion`, via `supcoflow` or `agente_de_afuera`), and an empty list doesn't say «nothing happens»: it says there's nothing to ask for from here. `--full` adds `estado_texto`, the text of each event, `avisos` (the rounds of notices to a connected agent and each attempt's answer, never its address) and `run`. «Open anyway» (opening the issue without investigating) and «change the investigator» don't exist yet.",
      flags: [
        "--id rpt_…: the report (`reports list` gives it)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--full: adds `estado_texto`, the events' text, `avisos` and `run`",
        "--json",
      ],
      ejemplos: ["supcoflow reports show --id rpt_0123456789abcdef --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "reports investigate",
      resumen: "Asks for the investigation of a report, for a PERSON signed in with a role that can spend (an Owner or Member; not a Reader or a read-only key). It SPENDS (or, for a report a connected agent investigates and didn't answer in 2 hours, sends it the notice again, which reopens its 2 hours): without --authorize-spend it sends nothing and exits 4 falta_autorizacion with { reporte_id, via, techo_usd, siguiente }, where `siguiente` is the exact command to run once the person authorizes the ceiling; with --authorize-spend and --ceiling (the number you were shown) it asks, but only if the ceiling is still that one (otherwise exit 4 techo_distinto and nothing is sent; it reads the ceiling right before asking, and the engine's own guards decide the rest). It reads the report's journey first: if there is nothing to ask for from here it exits 4 nada_que_pedir without spending. The convivence rule is the engine's: one investigator per project (409 → exit 4 ya_esta_con_el_agente, el_agente_ya_fallo, ya_tiene_resultado, agente_no_disponible, proyecto_con_investigador_de_afuera, ya_relevado, falta_ia_del_triaje); 503 despachos_en_pausa exits 1 and nothing started. On success { ok, reporte_id, investigacion: arrancada|aviso_reenviado, via, run_id | webhook_id + ronda, repetido?, techo_usd }. «Open anyway» and «change the investigator» are not here: they don't exist in the engine yet.",
      flags: [
        "--id rpt_…: the report",
        "--authorize-spend: authorizes the spend of ONE request; without it nothing that writes is sent",
        "--ceiling usd: the ceiling you authorize, the number you were shown (required with --authorize-spend)",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: reads the journey and the ceiling and says what it would ask, without asking",
        "--json",
      ],
      ejemplos: ["supcoflow reports investigate --id rpt_0123456789abcdef --json", "supcoflow reports investigate --id rpt_0123456789abcdef --authorize-spend --ceiling 2 --json"],
      codigos: [0, 1, 2, 3, 4, 6],
    },
    {
      nombre: "gate status",
      resumen: "An AGENT sees its own state with ITS key (`scf_ag_…`, created in the console; it is not the key `login` leaves): name, type (chat or investigation), project, whether it is active and is the project's active investigator, who connected it (the GitHub login, or «someone from the team»), the last notice (when, attempts, the status it answered) and how many assigned reports it hasn't delivered (a failure notice counts as delivered). A chat agent gets no notices or assigned reports: those fields are null (not applicable, which is not zero). No key, secret or email is ever in the answer. The project comes from the key: there is no --repo. THE KEY: it never goes as an argument (there is no flag for it: `--key` is flag_desconocido) nor through stdin, and it isn't saved anywhere. It is read from the environment variable `--from-env NAME` names, or from `SUPCOFLOW_AGENT_KEY`, or typed without echo in an interactive terminal (never with --json: no command asks anything with --json except `agents set-key`); with none of them it exits 2 sin_clave_de_agente and asks for nothing. What looks like a person's key exits 3 es_una_clave_de_persona and is not sent. A 401 (the key is revoked or invalid: exit 2) and a 403 (this key can't do that: exit 4 tipo_de_clave / solo_agentes) are said clearly and NO other credential is tried. Nothing the engine says is printed as free text: only fixed phrases and validated fields.",
      flags: [
        "--from-env NAME: the NAME of the environment variable that holds the agent's key (not the key itself); by default SUPCOFLOW_AGENT_KEY, and without either, the key is asked for without echo",
        "--json: { ok, agente_id, nombre, tipo, proyecto_id, activo, es_el_investigador_activo, conectado_por: { persona_id, nombre_visible }, ultimo_aviso: { webhook_id, en, intentos, respuesta } | null, asignados_sin_entregar, tope: { avisos_por_hora, usados_esta_hora } | null }; the `tope` is informative: nothing enforces it yet",
      ],
      ejemplos: ["supcoflow gate status --json", "supcoflow gate status --from-env MY_AGENT_KEY --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "gate read",
      resumen: "The assigned investigator reads a report of its own with its key (see `gate status` for how the key is given): who has it, its state and how it ended. The engine keeps the journey and not the text, so there is no text here: it is read from the client's store with the pass (`gate pass`). Only the investigator the report is assigned to reads it (409 no_asignado exits 4); a report of another project is 404 (exit 3). The JSON is short by default { ok, reporte_id, proyecto_id, creado_en, canal, investigador, estado, te_necesitan, decision, intencion, necesita_persona, entrega: { tipo: fallo, entrega, huella, motivo }, publicacion: { estado: publicando|publicado|publicacion_incierta|esperando_reenvio|necesita_persona, entrega, huella, issue, desde, proximo_paso, buscar_desde, reenvios_que_quedan } | null } (only the fields that apply); `--full` adds `agente_declarado`, `costo` and `acciones`. With `esperando_reenvio` the text says to send exactly the same file again.",
      flags: [
        "--id rpt_…: the report",
        "--from-env NAME: the NAME of the environment variable that holds the agent's key; by default SUPCOFLOW_AGENT_KEY, else asked without echo",
        "--full: adds `agente_declarado`, `costo` and `acciones`",
        "--json",
      ],
      ejemplos: ["supcoflow gate read --id rpt_0123456789abcdef --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "gate pass",
      resumen: "The assigned investigator asks for the PASS to read a report's content: five minutes, one report, read-only, in the client's store (or in Supcoflow's own for a chat the client doesn't host). It is the only thing the terminal prints on purpose without hiding it, because it is what the command is for: send it in the `Authorization: Bearer <pass>` header to `contenido.url` (never in the URL). It is not saved anywhere and never appears in an error. The JSON: { ok, pase, audiencia, contenido: { url, ref }, proyecto_id, reporte_id, para, permisos, vence_en, acuerdo }. `acuerdo` is the project's data agreement: apply it BEFORE giving anything to the model (Supcoflow applies it again when it publishes). Asking for the pass doesn't stop the 2 hours of the notice. Exits 4 almacen_no_disponible (the report has no store to read from right now), contenido_vencido (the store no longer keeps it), no_asignado, tipo_de_clave (a chat key).",
      flags: [
        "--id rpt_…: the report",
        "--from-env NAME: the NAME of the environment variable that holds the agent's key; by default SUPCOFLOW_AGENT_KEY, else asked without echo",
        "--dry-run: says what it would ask for, without asking for the key or sending anything",
        "--json",
      ],
      ejemplos: ["supcoflow gate pass --id rpt_0123456789abcdef --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "gate deliver",
      resumen: "The assigned investigator delivers its RESULT: the body of the contract (`agente` with `nombre` and `version`, `intencion`, `decision`, `necesita_persona`, `diagnostico`, `supuestos`, `preguntas_abiertas`, `evidencia`, and optional `confianza`, `usuario`, `entorno`, `costo`) from a file, with its key. Supcoflow applies the data agreement again, reserves the publication and opens the issue ONCE. An investigation has a single delivery (a result or a failure). The delivery id (`ent_…`, header Idempotency-Key) is the same on every retry: it comes from the type, the report and the file, so repeating the same command with the same file is always the same delivery (safe: never published twice) and another file is another delivery (the engine says the report already has one). Nothing is saved. 202 means publishing (`publicacion: publicando`; look at how it ended with `gate read`), 200 with `repetido: true` means it was already received. After a failure to know whether it arrived (network, 5xx), repeat the same command. Errors say the contract's problem as `field:code`, never the values. Exits 4 no_asignado, reporte_ya_tiene_entrega, tipo_de_clave; 3 archivo_invalido, identidad_incompleta, resultado_invalido, entrega_con_otro_contenido; 1 publicacion_no_disponible.",
      flags: [
        "--id rpt_…: the report",
        "--file path.json: the result, ONE JSON object of up to 256 KB (required)",
        "--from-env NAME: the NAME of the environment variable that holds the agent's key; by default SUPCOFLOW_AGENT_KEY, else asked without echo",
        "--dry-run: reads and checks the file and says what it would send, without asking for the key or sending anything",
        "--json: { ok, reporte_id, entrega, huella, publicacion, issue, filtrado: { campos_quitados, lineas_quitadas }, sin_issue, necesita_persona, repetido }",
      ],
      ejemplos: ["supcoflow gate deliver --id rpt_0123456789abcdef --file result.json --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "gate fail",
      resumen: "The assigned investigator says it COULDN'T work the report, with its key: the report goes to «Te necesitan» right away instead of waiting the 2 hours. The body is closed, from a file: { agente: { nombre, version, modelo?, cli?, prompt_version? }, motivo, costo? } with `motivo` one of contenido_no_disponible, repositorio_no_disponible, modelo_no_disponible, tiempo_agotado, error_del_agente. No free text, user, environment or evidence: a field the contract doesn't have is rejected by name (exit 3 campo_no_permitido), not filtered. It is a delivery like the result (same delivery id rules as `gate deliver`) but it publishes nothing and the answer is 200. After a failure the same agent can't deliver again: opening the issue anyway and changing the investigator are things a person does (and don't exist in the engine yet). It doesn't change the 2 hours: they remain the safety net for an agent that dies without being able to tell.",
      flags: [
        "--id rpt_…: the report",
        "--file path.json: the failure notice, ONE JSON object (required)",
        "--from-env NAME: the NAME of the environment variable that holds the agent's key; by default SUPCOFLOW_AGENT_KEY, else asked without echo",
        "--dry-run: reads and checks the file and says what it would send, without asking for the key or sending anything",
        "--json: { ok, reporte_id, entrega, huella, estado: el_agente_fallo, te_necesitan, repetido }",
      ],
      ejemplos: ["supcoflow gate fail --id rpt_0123456789abcdef --file failure.json --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "widget",
      resumen: "Shows what to paste into the app to get the chat, built by the engine with the project's ids: the package and its exact version, the Next.js wrapper file (`nextjs.contenido`, as is, without rewriting the ids), the file name to use (`nextjs.archivo_sugerido`) and the earlier names the chat may already be installed under (`nextjs.archivos_anteriores`), how to use it, the CSP line and the <script> one (not for Next.js). If the engine describes the app's own interface (`interfaz_propia`: the app builds the chat with its own components; there is no code to paste) it passes it on as the engine sent it: `estado` (`sin_publicar`: the version isn't on npm yet, so the text doesn't offer the path; `disponible`), the package with its exact version, the ids, the backend, the CSP line, the presentation contract (`contrato.version`, `contrato.archivo`, `contrato.documento`), the entry points (`entradas`) and the docs (`documentos`). A halfway `interfaz_propia` is ignored with a warning on stderr and the widget is shown as always. It writes no files. Exits 4 sin_proyecto if the repo has no project; 1 respuesta_inesperada if the engine sends the widget itself halfway.",
      flags: ["--repo owner/repo: the repo, if it isn't this folder's «origin»", "--json: the engine's object as is (`interfaz_propia` only when the engine sends it)"],
      ejemplos: ["supcoflow widget --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "install record",
      resumen: "Records in .supcoflow/instalacion.json (this clone's root, version 3) which versions the chat was installed with: the skill, this terminal, the chat package (declared in the app's package.json and installed in node_modules), the project configuration and what was installed: `forma` (`widget` or `interfaz_propia`, with --shape), `archivos` (the files the chat lives in, with --file) and `contrato` (the version of the presentation contract the installed package carries in its contract.json, or null if it has none); never a secret or a date. A version 1 or 2 file is read without error as a widget (the `archivo` of a 2 is its file). Changing --shape without --file leaves `archivos` empty (the files of the other form aren't inherited). Repeating without changes doesn't touch it (sin_cambios: true), and running again without --shape or --file keeps the form and the files already recorded. The JSON adds `archivos`, `forma` and `contrato`; `archivo` (the first file) stays for the skills before 0.9.0. It only rewrites it if git already keeps the previous one: with uncommitted changes (or deleted without a commit) it exits 4 cambios_sin_commit; if it exists without being tracked (or ignored), 4 archivo_no_versionado. Others: 3 falta_skill / skill_invalida / archivo_invalido / forma_invalida / app_fuera_del_repo / app_inexistente / sin_clon; 4 sin_proyecto / acuerdo_ilegible / escrito_por_una_terminal_mas_nueva (the file is version 4 or more: it doesn't rewrite it); 1 paquete_ilegible / configuracion_inesperada / archivo_no_escrito.",
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
      resumen: "Says, free of charge and writing nothing, how far the installation is (sign-in, repo, GitHub App, allowed sites, chat, guide and interface: N of 7; N of 8 when the engine also reports the chat's AI account, `ia_del_chat`, which it does once AI accounts are required: without that account the chat doesn't show on the site) and, apart, whether a test of the project would go in and how far it would get: policy, the test's ceiling, open tests, whether THIS machine can save the test request (the local point `maquina`, checked without writing anything: disk and permissions, git when your home folder is a repo, and, when the config folder hangs from a shared one, that it is still only yours; when git refuses, the impediment also names, when a suitable folder is available, a persistent private folder outside any repo to use as `XDG_CONFIG_HOME`, never a temporary one; on Linux there usually isn't one and nothing is suggested), the triage agent's AI account (`ia_del_triaje`, when the engine reports it: without it a test doesn't run) and whatever else the engine adds. Exits 0 if everything is ready and 4 if something needs fixing (no_listo), with each missing point (and every point with --full); if `maquina` isn't ok, `listo` and `prueba.listo` are false and the N of 7 doesn't change. The seventh point, `interfaz`, is local and only reads: if .supcoflow/instalacion.json records an own interface (`forma: interfaz_propia`) it checks that the recorded files are still there and that the recorded contract is not behind a new major version (the first number) of the one the project declares (`interfaz_propia.contrato.version` in `widget`; a newer minor or patch only adds optional points and stays ok, saying so); without an own interface it is ok («Not applicable»). It is advice, marked `aviso: true` in the JSON: it lowers the N of 7 but doesn't stop a test.",
      flags: [
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--full: the whole detail (every point, the machine check, the pending attempt, the ceiling and balances). Without it `--json` is a short summary",
        "--json: by default a short summary { ok, listo, proyecto, instalacion: { ok, total: 7 | 8 }, faltan: [{ punto, mensaje, aviso?, siguiente }], siguiente, detalle } (on exit 4 also error: no_listo and message); each item of `faltan` carries its own fix in `siguiente`; the top-level `siguiente` is `supcoflow test --json` when `listo` is true (even if something is still missing, such as advice, `aviso: true`), otherwise the fix for the first point that stops a test, as a command to run or, when it needs data the terminal doesn't have, in words; `detalle` is `supcoflow diagnose --full --json` (with the same --repo, when given; every command in `siguiente` keeps it too). With --full, the whole detail as before: { instalacion: { ok, total, puntos }, prueba: { listo, puntos }, puntos, maquina: { ok, impedimentos: [{ codigo, detalle }] }, intento_pendiente: { techo_usd, politica } | null, politica, techo_usd, saldo_usd, tope_usd, comprometido_usd, prueba_abierta, … } plus `siguiente`",
      ],
      ejemplos: ["supcoflow diagnose --json", "supcoflow diagnose --full --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "test",
      resumen: "Tests the installation end to end: a problem comes in through the same door as the chat and ends up as an issue. It spends one investigation (up to the ceiling you authorize; with the save policy it goes as far as the saved case and doesn't spend). Without --authorize-spend it sends nothing: it exits 4 falta_autorizacion with a short summary by default { proyecto, listo, politica, techo_usd, prueba_abierta, maquina: { ok }, intento_pendiente, siguiente, detalle } (`listo` means what it means in `diagnose`: the engine's `listo` and this machine able to save the request; with --full `listo` stays the engine's, as before; `siguiente` says to fix this machine first, or, when the engine's `listo` is false, to run `diagnose` and fix what it says, or else to ask the person for the spend and gives the command to launch it; `detalle` is `supcoflow test --full --json`, keeping --repo and, with --dry-run, the authorization flags; when a request is waiting for confirmation `siguiente` gives the command that recovers it); with --full, the whole detail as before: puntos, saldo_usd, tope_usd, comprometido_usd and, checked before you say yes and without writing anything, `maquina` { ok, impedimentos: [{ codigo, detalle }] } (whether this machine can save the test request: if it isn't ok the message says why first, and, when git is what refuses and a suitable folder is available, a persistent private folder outside any repo to use as `XDG_CONFIG_HOME`) and `intento_pendiente` { techo_usd, politica } | null (a request waiting for confirmation: only its ceiling and policy, never its message or key). With --authorize-spend, --ceiling and --expect-policy it requests the test with exactly those values (it doesn't re-read anything to choose them) and exits 5 with prueba_id; then --wait follows it. If the ceiling or the policy changed in the meantime it exits 4 techo_distinto / politica_distinta with the new values and doesn't retry: ask again. Others: 4 prueba_en_curso (with its id), chat_deshabilitado, requiere_api_key, intento_pendiente; 6 tope_mensual; 1 with intento_pendiente: true if the answer didn't arrive (repeating resumes the same test).",
      flags: [
        "--authorize-spend: authorizes the spend of ONE test; without it nothing that writes is sent",
        "--ceiling usd: the ceiling you authorize, the number you were shown (required with --authorize-spend)",
        "--expect-policy investigate|save: the policy you were offered (required with --authorize-spend); if the project's is another one, nothing starts",
        "--message \"…\": the problem text of the test (by default, a fixed one from the engine); with a request that was never confirmed, another --message exits 4 intento_pendiente",
        "--wait: follows the last test up to 90 s; exits 5 while it runs, 0 with the issue (or saved), 4 if it needs a look (with the link to the inbox); the charge comes out as it is (pending is never 0)",
        "--test-id prb_…: with --wait, follows that test instead of the last saved one",
        "--repo owner/repo: the repo, if it isn't this folder's «origin»",
        "--dry-run: says what it would do (project, ceiling, policy) without requesting anything that writes; its JSON is short too ({ dry_run, autorizado, intento_pendiente, haria, proyecto, listo, politica, techo_usd, prueba_abierta, maquina: { ok }, detalle }), the whole detail with --full",
        "--full: with no --authorize-spend, or with --dry-run, the whole detail of the diagnosis (listo, puntos, saldo_usd, tope_usd, comprometido_usd, maquina with its impedimentos), as before 0.12.0; with --wait or a real --authorize-spend it exits 3 flags_incompatibles",
        "--json",
      ],
      ejemplos: ["supcoflow test --json", "supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate --json", "supcoflow test --wait --json", "supcoflow test --dry-run --authorize-spend --ceiling 2 --expect-policy investigate --json", "supcoflow test --full --json"],
      codigos: [0, 1, 2, 3, 4, 5, 6],
    },
  ],
  flags_globales: ["--json: the result as a line of JSON on stdout; warnings go to stderr", "--help, -h: the help with examples"],
  facultades: [
    {
      nombre: "read",
      incluye: "Identity and team, projects, configuration, installation state, reading and checking the guide (guide check, guide show, guide versions); guide stale needs none (it only reads git). The project's reports and one report's journey (reports list, reports show; they carry no report text). There is no command to read issues, runs or costs",
      con_api_key: true,
    },
    {
      nombre: "configure",
      incluye: "Create/reuse a project, connect or disconnect the repo, configure and turn on the chat, allowed sites, data agreement, problem policy, publish the guide, choose the active guide (guide use), create and revoke read-only keys, agent profiles",
      con_api_key: true,
    },
    { nombre: "test", incluye: "The test up to the issue (spends, within the limits), and asking for the investigation of a report (reports investigate, which also needs --authorize-spend and --ceiling)", con_api_key: true },
    {
      nombre: "console_only",
      incluye: "Raise the spend cap, delete the project, turn on the factory, give or remove people's access, create or revoke an agent's key (scf_ag_…): only with a console session. An agent's key does its own things with `gate`, and nothing else",
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

/**
 * `describe` entero (sin argumento: el contrato completo, como siempre) o `describe <comando>` (sólo ese comando, con los
 * códigos de salida que usa): lo que un asistente necesita para UN comando sin cargar el contrato de los demás.
 */
export function comandoDescribir(sobre: string | null = null): Resultado {
  if (sobre === null) return { codigo: SALIDA.ok, json: { ok: true, ...DESCRIPCION }, texto: ayuda(null) };
  const nombre = COMANDOS_VIEJOS[sobre] ?? sobre;
  const comando = DESCRIPCION.comandos.find((c) => c.nombre === nombre);
  if (comando === undefined) {
    const lista = DESCRIPCION.comandos.map((c) => c.nombre).join(", ");
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "comando_desconocido", `Unknown command «${sobre.slice(0, 40)}». The commands are: ${lista}. Try \`supcoflow describe --json\`.`);
  }
  const codigos = Object.fromEntries(comando.codigos.map((n) => [n, DESCRIPCION.codigos[n]!]));
  return {
    codigo: SALIDA.ok,
    json: { ok: true, version: DESCRIPCION.version, comando, flags_globales: DESCRIPCION.flags_globales, codigos, todos_los_comandos: "supcoflow describe --json" },
    texto: ayuda(comando.nombre),
  };
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
