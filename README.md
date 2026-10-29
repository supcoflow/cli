# supcoflow

The [Supcoflow](https://app.supcoflow.dev) terminal: sign in and manage the support chat from the console,
or from a code assistant that runs the commands for you.

It signs you in and out, shows which account you are using, connects the repo with the GitHub App, creates
its project, configures the chat, puts it in the app, and checks that a problem reaches an issue.

## Install

Node 24 or newer is required.

```bash
npx supcoflow login
```

## The commands

The command names are in English. The Spanish names of 0.7.0 (`quien-soy`, `guia publicar`,
`--autorizo-gasto`, `--modo relevar|guardar`…) still work as hidden aliases; `describe` and `--help` only show
the English ones.

| Command | What it does |
|---|---|
| `supcoflow login` | Shows a link and a code; you approve it in the console and the terminal keeps its key. |
| `supcoflow login --start` | The first step alone: asks for the code and exits 5 with the link to approve it. |
| `supcoflow login --wait` | The second step: waits for the approval up to 90 s. If it hasn't arrived, exits 5: run it again. |
| `supcoflow logout` | Revokes the key in use and deletes it from this machine. |
| `supcoflow whoami` | Which key the terminal runs with, on whose behalf and in which team. |
| `supcoflow repo connect` | Connects this folder's repo with the GitHub App: it gives you a link and you confirm it in the console. Without a terminal, `--start` and then `--wait`, like `login`. |
| `supcoflow project create` | Creates (or reuses) the project of the connected repo and records it in `.supcoflow/proyecto.json`. If the engine can't work out the commands, `--install "…" --test "…"`. |
| `supcoflow project show` | The repo's project: branch, commands and the state of the GitHub App, starting with who you are: «You're @login in team T; repo O/R; project P (existing)». |
| `supcoflow guide check` | Checks `.supcoflow/guide.md` against the engine without publishing anything. |
| `supcoflow guide publish` | Uploads `.supcoflow/guide.md` directly (with the commit and branch your clone declares, not verified in GitHub). `--from-github` verifies against the main branch instead of uploading the file. |
| `supcoflow guide show` | Shows the active guide, where it comes from, which file it was read from and whether the branch is still up to date. |
| `supcoflow guide use --source repo\|agent` | Chooses which guide is active. |
| `supcoflow guide versions` | The guide that governs now and the repo's publications, newest first; at most one says «live». |
| `supcoflow widget` | What to paste into the app to get the chat (see «Put the chat in the app»). |
| `supcoflow install record --skill 0.3.1 --file app/_supcoflow/support-chat.tsx` | Records in `.supcoflow/instalacion.json` which versions the chat was installed with and which file it lives in. |
| `supcoflow diagnose` | Free: how far the installation is (N of 6) and whether a test would go in (including whether this machine can save the test request). |
| `supcoflow test` | The end-to-end test (see «Test the installation»). |
| `supcoflow describe --json` | The whole contract (commands, flags, key capabilities, codes) in one line of JSON. |

`supcoflow --help` (or `supcoflow <command> --help`) shows the help with examples. The repo and project commands
take the repo from the folder's `origin`; `--repo owner/repo` picks it by hand.

### When the `origin` isn't a GitHub address

The terminal only recognizes `origin` when its host is exactly `github.com` (`https://github.com/o/r`,
`git@github.com:o/r.git`, `ssh://git@github.com/o/r`). If yours is an SSH alias (`git@github-work:o/r.git`) or
another server, it never runs `ssh` or reads your SSH configuration (it could run programs of yours). You tell it
once, in your own clone, which GitHub repo this is:

```bash
git remote add supcoflow https://github.com/owner/repo.git   # it's never fetched
```

A remote called `supcoflow` with those same strict forms ties the clone to that repo for every command. If `origin`
is a GitHub address, `origin` wins. The error says the exact command to run. With `--repo owner/repo`, the commands
that read or write a file of the clone (`guide check`, `guide publish`, `install record`) only use this clone if it is
that repo; otherwise they exit 3 saying what the clone is, without asking the engine. (`project create --repo` keeps
creating or reusing the project, but never reads or writes the clone.)

### Is this repo the one for this account?

Every command that acts on the repo's project first checks what it can see, and exits 4 `contexto_incoherente` (with a
`motivo`) without touching anything when it doesn't add up:

- `proyecto_del_clon_distinto`: `.supcoflow/proyecto.json` notes a project your key doesn't see for this repo. Check
  which account you signed in with (`supcoflow whoami`), or review that old file.
- `archivo_del_clon_ilegible`: that file exists but can't be read or understood (its content is never printed).
- `dueno_distinto_del_login` (only when creating a project): the repo's owner on GitHub isn't the GitHub login of your
  key. It is a *possible* mismatch (the engine compares GitHub's number, and a login can be renamed): sign in to the
  console with GitHub again, or as the owner. If your key comes from `SUPCOFLOW_TOKEN`, that variable wins over a new
  login, and the terminal doesn't touch it.
- `sin_github` (only when creating): the account was signed in by email; connecting a repo needs GitHub.

A project that already exists is never blocked for belonging to another person of the team. This doesn't see a project
of the same repo in another team when the clone doesn't note it.

### From zero to a project

1. `supcoflow login`: you approve the code in the console.
2. `supcoflow repo connect`: you install the App on GitHub if needed and tap Confirm.
3. `supcoflow project create`: the project is created and `.supcoflow/proyecto.json` is left to commit.
4. `supcoflow project show`: to check how it ended up.

### Examples

```bash
# A person at the terminal
supcoflow login

# An assistant, without an interactive terminal: two steps
supcoflow login --start --json     # exits 5 with verification_uri_complete and user_code
supcoflow login --wait --json      # exits 5 until the person approves; 0 when they do

supcoflow repo connect --start --json   # exits 5 with the URL to confirm
supcoflow repo connect --wait --json    # exits 5 until someone confirms; 0 connected
supcoflow project create --json         # 4 if there is a different .supcoflow/proyecto.json (it doesn't overwrite)
supcoflow project create --install "pnpm i" --test "pnpm test"
supcoflow project show --json

supcoflow whoami --json
supcoflow logout --dry-run         # what it would revoke, without revoking anything
```

## Configure

With the repo connected and its project created, the chat is configured without entering the console (the key
has to be a session key, not a read-only one). All of them take the repo from the `origin`, or `--repo
owner/repo`, and the ones that write accept `--dry-run`.

| Command | What it does |
|---|---|
| `supcoflow catalog` | What can be configured and with which values. |
| `supcoflow config` | The project's chat, sites, brand and data agreement. |
| `supcoflow chat on` / `chat off` | Turns the chat on or off (a guide is needed: publish the repo's with `supcoflow guide publish`, or generate and approve our agent's in Brain). |
| `supcoflow chat brand --title "Help" --theme acento=#0a7` | Title, greeting and colors; whatever isn't named stays as it was. The `--theme` keys are the API's: `acento`, `fondo`, `texto`, `textoSuave`, `radio`, `fuente`. |
| `supcoflow chat logo --file logo.png` | Uploads the logo (.png, .jpg or .webp, up to 200 KB). |
| `supcoflow sites add\|remove --site https://app.example.com` | Sites the chat loads from. |
| `supcoflow data set --allow user_id,attribute:plan` | Data agreement: it limits what is saved and what the AI that investigates reads; it doesn't cover what the chat's AI sees while it talks. The values are `user_id`, `user_role`, `page_and_browser`, `screenshots`, `elements`, `email`, `attribute:<name>` or `nothing`. |
| `supcoflow policy set --mode save` | What the engine does with a problem that comes in through the chat: `investigate` (spends) or `save`. Saving only stops what the chat does automatically; a person can still ask for the investigation from the console, and it costs. |
| `supcoflow keys create --name ci --save-to ~/ci.key` | Read-only key for CI: the secret stays only in that file (0600, outside a repo), never in the output. |
| `supcoflow keys list` / `keys revoke --id cla_…` | List and revoke read-only keys. |

## The guide

The guide tells the chat what each screen of your product does. It lives in the repo, in
`.supcoflow/guide.md` (at the root). The flow, in this order:

1. `supcoflow guide check`: checks it against the engine without publishing anything (if it is badly formed it exits 3 with the line of each error).
2. `supcoflow guide publish`: uploads the file directly and it becomes the active guide. It also sends your clone's
   commit and branch (`git rev-parse HEAD`, if there is git and commits; otherwise it goes without a commit): they are
   declared by the terminal, not verified in GitHub, and are shown that way. It also sends the file it actually read.
   Repeating with the same file doesn't duplicate it.
3. Optional, `supcoflow guide publish --from-github`: it doesn't upload the file; it sends its fingerprint and the
   engine compares it with the main branch's on GitHub (verified commit). If it isn't pushed yet (or the branch has
   another one), it exits 5: push the guide to the main branch and run again.

**The old file name.** Until 0.7.0 the file was `.supcoflow/guia.md`. If `guide.md` doesn't exist and `guia.md` does,
the terminal reads `guia.md` and says so («rename it to `guide.md`»); it never renames or deletes your files. If both
exist, `guide.md` wins and the terminal says `guia.md` is ignored. If `guide.md` exists but can't be read, or is
badly formed, that is an error: it never falls back to the old one.

`supcoflow guide show` shows the active guide, the file it was read from and whether the branch is still up to date
(`al_dia` in the JSON); `supcoflow guide versions` lists the guide that governs now and the repo's publications;
`supcoflow guide use --source repo|agent` chooses which one is active when there is one from the repo and one from
our agent. All of them take the repo from the `origin` (or a `supcoflow` remote, see above), or `--repo owner/repo`
(with `check` and `publish`, if this clone isn't that repo it exits 3 `falta_guia` saying what the clone is: the guide
is read from the file); `check`, `publish` and `use` accept `--dry-run`; `--from-github` is only for `publish`.

The format of `.supcoflow/guide.md`:

```markdown
# My App guide              ← optional; ignored

## Invoices                 ← one section per screen or function (1 to 60). Name: 1–120 characters
What it's for: See and pay the month's invoices.                 ← required, 1–600
What users can do: Download the PDF, pay by card and see the    ← required, 1–600; it can continue
history.                                                            on the lines below
Common problems:                                                ← optional; up to 10, each 1–300
- The Pay button does nothing with debit cards.
- The PDF comes out blank in Safari.
Where: /invoices                                                ← optional; the page's path, starts with /
```

- Labels are recognized at the start of the line, ignoring case. The Spanish labels of 0.7.0 (`Para qué sirve:`,
  `Qué puede hacer el usuario:`, `Problemas comunes:`) are still accepted. A line that isn't a label continues the
  previous field (joined with a space).
- Text before the first `## ` that isn't the `# ` title → error. A repeated label in a section → error. A line with
  `<` or `>` → error. More than 64 KB → `guia_muy_grande`.

## Put the chat in the app

`supcoflow widget` shows what to paste, built by the engine with your project's ids (don't copy them by hand: a
wrongly copied id leaves the chat invisible without any error). It writes no files of the app:

1. The package with its exact version (`npm i @supcoflow/chat@… --save-exact`, or the same with your package manager).
2. **Next.js (App Router):** a wrapper file at the path the engine suggests (`nextjs.archivo_sugerido`, today
   `app/_supcoflow/support-chat.tsx`; if the app uses `src/app`, inside `src/app`), with the content as is. If the
   chat is already installed under an earlier name (`nextjs.archivos_anteriores`, for example
   `app/_supcoflow/chat-de-soporte.tsx`), update that file in place instead of creating a second one. The wrapper is
   needed because the chat component uses React hooks and doesn't ship `"use client"`, and a `layout.tsx` is a server
   component by default: importing it directly there doesn't work.
3. Use the wrapper in the layout that covers the screens where your users get stuck.
4. If the app has a Content Security Policy (CSP) with `connect-src`, add the chat's origin to it, keeping what it
   already has (a second `connect-src` is ignored).

The `<script>` line it also shows is available but not tested in a real app, and is not for Next.js.
`supcoflow widget --json` returns the engine's object as is.

Then, `supcoflow install record --skill <version> [--app <folder>] [--file <path>]` leaves in
`.supcoflow/instalacion.json` (to commit) which versions it ended up with: the skill, the terminal, the chat declared
and installed, the project configuration and, with `--file`, the file the chat lives in (a path relative to the repo
root, with no `..`, and not a symlink). The file is version 2; a version 1 file (from 0.7.0) is read without error as
«no file recorded». Running it again without `--file` keeps the file already recorded. It never contains a secret or
a date; repeating it without changes doesn't touch it, and if the file has uncommitted changes it exits 4 and doesn't
overwrite it.

## Test the installation

With the chat in place, two commands say whether a problem that comes in through the chat reaches an issue. Both take
the repo from the `origin`, or `--repo owner/repo`.

| Command | What it does |
|---|---|
| `supcoflow diagnose` | Free and writes nothing. It prints «Checked sign-in, repo, GitHub App, allowed sites, chat and guide: N of 6, at no cost.» and, apart, «Ready for a test: yes / no, because …» with the policy, the month's balance and open tests. Exits 0 if everything is ready, 4 if something needs fixing (with each point). `--json` gives `instalacion: { ok, total: 6, puntos }` and `prueba: { listo, puntos }`. |
| `supcoflow test` | Without `--authorize-spend` it sends nothing: it exits 4 with the test's ceiling, the balance, the cap and what is committed this month, and the exact command to launch it. It also says, before you authorize anything, whether this machine can save the test request (`maquina: { ok, impedimentos }`) and any request still waiting for confirmation (`intento_pendiente: { techo_usd, politica }`). |
| `supcoflow test --authorize-spend --ceiling 2 --expect-policy investigate` | Requests the test: the problem comes in through the same door as the chat and runs an investigation that **spends** up to the ceiling you authorize (with the `save` policy it goes as far as the saved case and doesn't spend). Exits 5 with the id. `--message "…"` uses your own text. |
| `supcoflow test --wait` | Follows the last test up to 90 s: 5 while it runs (call it again), 0 with the issue, 4 if it needs a look in the console (it brings the link). The charge is shown as it is: `pendiente` right at the close, never 0. `--test-id prb_…` follows another one. |
| `supcoflow test --dry-run --authorize-spend --ceiling 2 --expect-policy investigate` | What it would do (project, ceiling, balance, policy), without requesting anything. |

`--ceiling` is the number you were shown and `--expect-policy` the policy you were offered: both travel in the request
and the terminal doesn't re-read anything to choose them. If the ceiling or the policy changed in the meantime, it
exits 4 `techo_distinto` / `politica_distinta` with the new values and doesn't retry: ask again. The old
`probar --autorizo-gasto` alias also needs `--ceiling` now (an alias can't widen what you authorized); if you need the
old behavior, use supcoflow 0.7.0.

If the engine's answer doesn't arrive, the request stays saved on this machine (outside the repo, next to the
credentials): repeating the same `supcoflow test --authorize-spend …` picks up **the same** test instead of
requesting another. While a request is unconfirmed, another `--message`, `--ceiling` or `--expect-policy` exits 4
`intento_pendiente`. The test goes with the personal key of `supcoflow login`; a read-only key can't request it. One
open test per project: another one exits 4 `prueba_en_curso` with the id of the open one. A test's issue stays open and
is marked as a test.

**If your home folder is a git repo.** The request is saved in `~/.config/supcoflow/pruebas.json` (it carries the
ceiling, the policy and, if you passed one, your `--message`). That is allowed inside a repo only when git itself says
it ignores the file and doesn't track it: the first time, the terminal creates a `.gitignore` containing `*` in that
folder (only if there isn't one; it never edits yours), and then asks git (`git check-ignore`) about the file and its
`.tmp`, for every repo that contains the written or the real path. A file that is already tracked or added to the index
is refused with the exact `git rm --cached …` to run (the terminal never runs it or deletes anything of yours), and so
is a missing or failing git. The same goes for every write or delete of `idempotencia.json`. `diagnose` and `test`
check all this (and permissions, broken links and unreadable files) **before** you authorize, without writing
anything: «no obstacle found» is a check, not a promise that the disk won't fill up later. The credentials don't use
this exception: inside a repo they are still refused.

## With an assistant

If you use a code assistant such as Claude Code, the Supcoflow skill does the whole path for you: session, project,
configuration, guide, the chat in the app and the summary.

```bash
npx skills add supcoflow/skills
```

And in the assistant: `/supcoflow go`. It always asks you about your users' data and what happens with each problem;
it doesn't push anything to GitHub.

## The contract

Made to be read by a program, not only by a person:

- **`--json`**: the result goes out on stdout as **one line** of JSON; warnings go to stderr. Errors too:
  `{"ok":false,"error":"…","message":"…"}`, with their exit code. The `error` codes are stable identifiers (some are in
  Spanish, like `falta_guia`); the `message` of the engine's answers is printed as it arrives.
- **No questions without an interactive terminal** (or with `--json`): if something is missing, it exits 3 saying which
  flag to use. `supcoflow login` without a terminal exits 3 and points you to the two-step path.
- **`--dry-run`** wherever it can be simulated (`login`, `login --start`, `logout`, `repo connect --start`,
  `project create`, `guide check`, `guide publish`, `guide use`, `install record`, `test`). `login --wait --dry-run`
  exits 3: polling consumes the code and there is no way to simulate it.

| Code | It means |
|---|---|
| 0 | ok |
| 1 | unexpected |
| 2 | login needed |
| 3 | invalid input |
| 4 | a person is needed |
| 5 | waiting for a person: call again |
| 6 | limit reached |

## Where the key is kept

- In the **system keychain** (Keychain on macOS, Secret Service with `secret-tool` on Linux).
- If there is no keychain, in `~/.config/supcoflow/credenciales.json` (or `$XDG_CONFIG_HOME/supcoflow/…`) with `0600`
  permissions, and the terminal warns you.
- **Never inside a git repo**: if that file would land inside one (a `HOME` that is a dotfiles repo, for example), it
  saves nothing and asks you to use the keychain or `SUPCOFLOW_TOKEN`. (The test request and the idempotency key are
  the only things with an exception: see «Test the installation».)
- **`SUPCOFLOW_TOKEN`** takes priority over what is saved: it is for CI and the cloud.
- The key never appears in a log or in a `--json` output.
- `project create` keeps its idempotency key (it isn't a secret: it only avoids creating twice if the answer is lost)
  in `idempotencia.json`, next to the credentials and with the same permissions. Inside a repo it is saved only if git
  ignores it and doesn't track it; otherwise the terminal says so and goes on without saving it.

When you sign in again, the previous key is revoked only after the new one is saved; if it couldn't be revoked, it is
noted down and retried on the next `login` or `logout`.

## The API is fixed

The terminal always talks to `https://app.supcoflow.dev`. No file in the repo can change that, so cloning someone
else's repo and running `supcoflow` doesn't send your key to another server. For development, only the
`SUPCOFLOW_API_URL` environment variable moves it (`https`, or `http` against `localhost`), and what is saved stays
tied to the API that issued it: a key from a local engine never travels to production.
