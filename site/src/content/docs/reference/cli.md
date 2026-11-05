---
title: CLI reference
description: Every flint command, flag, exit code and JSON shape.
---

```text
flint [--json] [--vault <name|path>] <command> [args] [flags]
```

Flags can go anywhere on the line. `flint help` prints a summary. `flint connect` and
`flint exec` arrive in the next milestone.

## Global flags

| Flag | Meaning |
|---|---|
| `--json` | Write JSON to stdout. Errors go to stderr as JSON |
| `--vault <v>` | Use this vault (a name or a file path) instead of the current one |
| `--master-stdin` | Read the master password from the first line of stdin |
| `--help`, `-h` | Print the summary |
| `--version`, `-V` | Print the Flint version and the linked libraries |

## Commands

### Vaults

| Command | What it does |
|---|---|
| `vault create <path> [--name <name>]` | Create a vault; asks for the master password twice |
| `vault open <path>` | Open an existing vault and make it current |
| `vault list` | Recent vaults, current one first |
| `vault use <name\|path>` | Make a recent vault current |
| `vault status` | Path, lock state and counts |
| `vault unlock` | Cache the vault key in the OS keychain |
| `vault lock` | Remove the cached key from this machine |
| `vault forget <name\|path>` | Drop a vault from the recent list; the file is kept |

See [Vaults](/guides/vaults/).

### Groups

| Command | What it does |
|---|---|
| `group add <path>` | Create a group and any missing parents (`homelab/proxmox`) |
| `group list` | Every group with its host and subgroup counts |
| `group rename <path> <new-name>` | Rename the last segment |
| `group rm <path>` | Remove an empty group |

### Hosts

| Command | What it does |
|---|---|
| `host add <alias> --hostname <host> [flags]` | Add a host |
| `host edit <alias> [flags]` | Change the fields given |
| `host list [--group <path>] [--tag <tag>]` | List hosts, optionally filtered |
| `host show <alias>` | One host |
| `host rm <alias>` | Remove a host |

Host flags: `--hostname`, `--port`, `--user`, `--label`, `--group`, `--tag` (repeatable),
`--color`, `--notes`, `--jump`, `--cred`, `--key`, `--password`, `--password-stdin`.
`host edit` also takes `--alias <new>`, `--no-tags` and `--no-password`. See
[Hosts and groups](/guides/hosts/).

### Keys

| Command | What it does |
|---|---|
| `key add <name> (--file <path> \| --key-stdin)` | Store a private key; add `--passphrase` or `--passphrase-stdin` if it has one |
| `key list` | Every key with type and fingerprint |
| `key show <name>` | One key, with its public key |
| `key rename <name> <new-name>` | Rename a key |
| `key rm <name>` | Remove a key no host or credential uses |

See [SSH keys](/guides/keys/).

### Credentials

| Command | What it does |
|---|---|
| `cred add <name> --user <user> [--key <name>] [--password \| --password-stdin]` | Add a credential |
| `cred edit <name> [--name] [--user] [--key] [--password \| --password-stdin \| --no-password]` | Change the fields given |
| `cred list` | Every credential |
| `cred show <name>` | One credential |
| `cred rm <name>` | Remove a credential no host uses |

See [Credentials](/guides/credentials/).

## Secrets

Flint never takes a secret from a command-line argument or an environment variable, where
it would leak into `ps`, shell history and child processes. A secret comes from one of
two places:

- **The terminal.** Flint asks with echo off: the master password when a vault is locked,
  or a host/credential password when you pass `--password`.
- **Stdin**, with a `--*-stdin` flag. This is for scripts and agents.

When a command takes several secrets on stdin, they are read in this order:

1. The master password line (`--master-stdin`)
2. The password line (`--password-stdin`)
3. The passphrase line (`--passphrase-stdin`)
4. The private key, which takes the rest of stdin (`--key-stdin`)

```sh
printf '%s\n%s\n' "$MASTER" "$HOST_PASSWORD" |
  flint host add db --hostname db.internal --master-stdin --password-stdin
```

Output never contains a secret, with or without `--json`. Hosts and credentials report
`has_password`, keys report `has_passphrase`.

## Output and errors

Data goes to stdout and diagnostics to stderr. With `--json`, a command prints one JSON
document: an object, or an array for `list` commands.

```sh
flint --json host show web-01
```

```json
{"alias":"web-01","label":"Web server","hostname":"10.20.30.40","port":22,"user":"root","group":"homelab/web","tags":["prod","web"],"color":"","notes":"","jump":"","credential":"","key":"","has_password":false}
```

A failing command prints nothing to stdout and exits with the code of its error. With
`--json`, stderr carries the code:

```json
{"error":{"code":"not_found","message":"no host 'web-02'"}}
```

| Exit code | Error code | Meaning |
|---|---|---|
| 0 | | Success |
| 1 | `internal` | An unexpected failure |
| 2 | `usage` | Bad command line: unknown command or flag, missing argument |
| 3 | `not_found` | No such vault, host, group, key or credential |
| 4 | `conflict` | Already exists, or still in use |
| 5 | `locked` | The vault is locked and no master password was given |
| 6 | `wrong_password` | The master password is wrong |
| 7 | `invalid` | A value breaks a rule (alias, port, colour, key format…) |
| 8 | `unsupported` | The vault was written by a newer Flint |
| 9 | `keychain` | The OS keychain refused an operation |
| 10 | `io` | The vault or config file could not be read or written |

The codes are stable: scripts can rely on them.

## Environment

| Variable | Meaning |
|---|---|
| `FLINT_CONFIG_DIR` | Folder for the recent-vault list (see [Vaults](/guides/vaults/)) |
| `FLINT_KEYCHAIN=off` | Never cache vault keys; always ask for the master password |

## `flint --version`

```sh
flint --version --json
```

```json
{"flint":"0.0.0-dev","libssh":"0.12.2/openssl/zlib","libsodium":"1.0.22","sqlite":"3.54.1 (SQLCipher 4.20.0 community)"}
```
