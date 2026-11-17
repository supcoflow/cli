# Changelog

## 0.11.0

- The guide can be a folder: `.supcoflow/knowledge/*.md` is read as ONE version (every `.md` directly inside it; it governs over `guide.md`/`guia.md` when it has at least one). `guide check` sends the whole set to the engine and prints the problems per document; `guide publish` uploads it, and `--from-github` sends the fingerprint of the whole set (names and contents), computed exactly like the engine's (shared test vectors). A `.md` with an invalid name is rejected by name, never skipped; the limits (64 KB, 60 documents/sections) count for the whole folder.
- `guide check` warns (exit 0) when a section name is repeated (across documents or within one), comparing without case or accents like the chat's search (`nombres_repetidos` in the JSON).
- New `guide stale --base <ref>`: warns, with no AI, no engine call and no sign-in, when a change touches code a document's `sources` explain and doesn't touch that document. It also warns, apart, when the map is empty or broken, when a `sources` pattern matches no file, when a document changed only in whitespace, when the change deletes a document or removes a `sources` pattern that covered code it touches (it reads the map at the merge base too), and when it could not compare or complete the check (missing base, shallow clone, or git couldn't list the repo's files: it suggests `fetch-depth: 0` when that is the cause, and never says «nothing to warn»). Exits 0 unless `--strict` (4 `guia_desactualizada`). README has a CI snippet.

## 0.10.3

- `supcoflow test` and `diagnose` no longer print a «monthly balance» in their text: AI accounts are per project, so a team-wide monthly figure no longer applies. The JSON fields are unchanged.

## 0.10.2

- An `origin` that uses an SSH alias (for example `git@github-gf0:owner/repo`) is now recognized as GitHub. The alias is resolved by reading `~/.ssh/config` as plain text; `ssh` is never run.
- When the home directory is a git repository and git won't let the saved request live there, the warning now suggests a concrete folder outside any repository to use as `XDG_CONFIG_HOME` (on macOS, `/Users/Shared/supcoflow-<uid>`); rerun with it. Where no such folder exists (Linux), nothing is suggested and the usual `git rm --cached` advice stays.
- The saved login, proofs and idempotency files are now refused when their folder sits under a folder others can write to and is not owned by you and private (`0700`, no foreign links). A normal personal folder such as `~/.config/supcoflow` is unaffected, and so is a system without user ids (Windows), which keeps the 0.10.1 behavior.
