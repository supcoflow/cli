# AGENTS.md

Instructions for a coding agent working in this repo. The user-facing documentation is in [README.md](README.md);
this file does not repeat it.

## What this is

`supcoflow` is the command-line terminal of [Supcoflow](https://app.supcoflow.dev): sign in, connect a repo, create
its project, configure the support chat, publish the guide and check that a problem reaches an issue. It is a Node
(>= 24), ESM, TypeScript package with no runtime dependencies. The binary is `dist/cli.js`.

If you want to *use* the product on an app (not change this terminal), do not drive the commands by hand: install the
Supcoflow skill with `npx skills add supcoflow/skills` and run `/supcoflow go` (see the README, «With an assistant»).

## Build and test

```bash
npm ci
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # tsc, writes dist/ and makes dist/cli.js executable
```

Run `npm test` and `npm run build` before you finish. `dist/` is a build output and is not committed.

## Where things are

- `src/cli.ts`: entry point and command dispatch.
- `src/comandos/`: one file per command group (`login`, `logout`, `quien-soy`, `repo-conectar`, `proyecto`, `guia`,
  `widget`, `instalacion`, `agentes`, `configurar`, `claves`, `probar`, `describir`…).
- `src/api.ts`: every call to the engine. `src/contrato.ts` and `src/flags-por-comando.ts`: the contract that
  `supcoflow describe --json` prints.
- `src/guardado/`: where the key is stored (keychain, or a `0600` file outside any git repo).
- `src/clave-sin-eco.ts`: the no-echo prompt used for AI keys.
- `test/`: vitest tests, one file per area. Tests are written first; a new behavior gets a test.

## Rules that already hold (do not break them)

- **The AI key is never an argument and never printed.** There is no `--key` flag. `agents set-key` asks for it
  without echo, or reads a named environment variable with `--from-env NAME`. It must not appear on screen, in
  `--json`, on stderr, in an error, or in any file. Engine answers are reduced to fixed phrases.
- **The login key is never printed or written inside a git repo.** `SUPCOFLOW_TOKEN` wins over what is saved.
- **The API address is fixed** to `https://app.supcoflow.dev`; only `SUPCOFLOW_API_URL` moves it (`https`, or `http`
  against `localhost`). No file in a repo may change it.
- **Exit codes:** 0 ok, 1 unexpected, 2 login needed, 3 invalid input, 4 a person is needed, 5 waiting for a person
  (call again), 6 limit reached.
- **`--json`** prints one line of JSON on stdout (errors as `{"ok":false,"error":…,"message":…}`); warnings go to
  stderr. In general, without an interactive terminal, or with `--json`, a command does not ask questions: it exits 3
  naming the missing flag. **The exception is `agents set-key`:** without a terminal it exits 4 `sin_terminal` (a
  person is needed), and with a terminal it asks for the key without echo even with `--json`. The key never goes
  through the assistant: tell the person to run it in their own terminal. Do not "fix" this in tests without changing
  the command.
- **`--dry-run`** exists wherever a command can be simulated.
- **`describe --json` is the contract.** If you add or change a command, flag, error code or exit code, update what
  `describe` reports and its tests (`test/describir.test.ts`, `test/contrato.test.ts`) and the README table.
- **Texts shown to people are in English**; the English command names are the public ones. The Spanish names are
  hidden aliases (`src/alias.ts`). Some stable `error` codes are Spanish on purpose: do not rename them.
- Anything that spends money (`supcoflow test`) needs the explicit `--authorize-spend` and a ceiling.

## Working here

- Do not publish to npm, push, or open a PR unless the owner asked for it.
- Do not put secrets, real keys or tokens in code, tests, fixtures or docs.
- Review notes live in `docs/revisiones/` and `docs/verificaciones/`.
