# Changelog

## 0.10.2

- An `origin` that uses an SSH alias (for example `git@github-gf0:owner/repo`) is now recognized as GitHub. The alias is resolved by reading `~/.ssh/config` as plain text; `ssh` is never run.
- When the home directory is a git repository, the saved request is stored in a concrete folder outside any repository (`XDG_CONFIG_HOME=…`), never under the same repository.
