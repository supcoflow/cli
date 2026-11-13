# Changelog

## 0.10.3

- `supcoflow test` and `diagnose` no longer print a «monthly balance» in their text: AI accounts are per project, so a team-wide monthly figure no longer applies. The JSON fields are unchanged.

## 0.10.2

- An `origin` that uses an SSH alias (for example `git@github-gf0:owner/repo`) is now recognized as GitHub. The alias is resolved by reading `~/.ssh/config` as plain text; `ssh` is never run.
- When the home directory is a git repository and git won't let the saved request live there, the warning now suggests a concrete folder outside any repository to use as `XDG_CONFIG_HOME` (on macOS, `/Users/Shared/supcoflow-<uid>`); rerun with it. Where no such folder exists (Linux), nothing is suggested and the usual `git rm --cached` advice stays.
- The saved login, proofs and idempotency files are now refused when their folder sits under a folder others can write to and is not owned by you and private (`0700`, no foreign links). A normal personal folder such as `~/.config/supcoflow` is unaffected, and so is a system without user ids (Windows), which keeps the 0.10.1 behavior.
