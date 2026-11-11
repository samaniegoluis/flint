---
title: CLI reference
description: Every flint command, flag, exit code and JSON shape.
---

```text
flint [--json] [--vault <name|path>] <command> [args] [flags]
```

Flags can go anywhere on the line, up to a bare `--`: what follows it is the remote
command of `flint exec`. `flint help` prints a summary.

With the Flint app open and the vault unlocked there, every command on that vault,
`connect` and `exec` included, runs inside the app and needs no master password.
Otherwise a command that needs the vault asks for it, for that one command; with no
terminal, Flint's window asks instead ([Vaults](/guides/vaults/#flint-holds-the-unlocked-vault)).

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
| `vault status` | Path, lock state, counts, and how long the activity log keeps entries (set in the app, **Settings → Access**) |
| `vault unlock` | Ask Flint to unlock the vault (starting it if needed), and wait up to 2 minutes |
| `vault lock` | Lock the vault in Flint, and remove its key if this machine remembers it |
| `vault rename <new-name>` | Rename the vault (with `--vault`, another one); the file keeps its name and place |
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
| `host add <alias> --hostname <host> [--type ssh\|rdp] [flags]` | Add a host, SSH unless `--type rdp` |
| `host edit <alias> [flags]` | Change the fields given |
| `host list [--group <path>] [--tag <tag>]` | List hosts, optionally filtered |
| `host show <alias>` | One host |
| `host test <alias>` | Connect, verify the host key, log in and hang up. Runs nothing |
| `host rm <alias>` | Remove a host |

Host flags: `--hostname`, `--port`, `--user`, `--label`, `--group`, `--tag` (repeatable),
`--color`, `--notes`, `--jump`, `--cred`, `--key`, `--password`, `--password-stdin`,
`--sudo-password`, `--sudo-password-stdin` (what `exec --sudo` types; without one, the
login password), `--command <cmd>` (run on connect) with `--keep-shell` / `--no-keep-shell`.
`host edit` also takes `--alias <new>`, `--no-tags`, `--no-password` and
`--no-sudo-password`;
`--command ""` clears the command. See [Hosts and groups](/guides/hosts/).

An RDP host (`--type rdp`, port 3389 by default) takes `--domain <name>` and logs in with
`--password` or a `--cred` that has a password; `--key`, `--jump`, `--command` and
`--sudo-password` are refused for it (`invalid`), and `--domain` for an SSH host. The type
is fixed once added: `host edit --type` may repeat it, not change it. `host list` shows a
`TYPE` column, and `--json` a `type` (and `domain`) field on every host. See
[Remote desktop hosts](/guides/hosts/#remote-desktop-rdp-hosts).

`host test` takes `--timeout` and `--accept-new-host-key` like `connect`, never asks for
a password, and exits 0 or with the SSH error codes (11 to 14). With `--json` it prints
`{host, target, hops, duration_ms}`.

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

### SSH

| Command | What it does |
|---|---|
| `connect <alias>` | Interactive shell, through the host's jump hosts, or the host's initial command (`--no-command` skips it). Exits with the remote shell's status. On an RDP host it asks Flint to open the remote desktop tab and exits 0 (see below) |
| `exec <alias> -- <command>` | Run one command. Streams its stdout and stderr and exits with its status |
| `exec <alias> --sudo -- <command> [args]` | Run it as root. Flint's window asks you for each one, and Flint types the sudo password. Needs Flint open |
| `known-host list` | Every recorded server key |
| `known-host rm <alias\|address>` | Forget a server key, so the next connect asks again |

`connect` and `exec` take `--timeout <secs>` (connect and login, default 15),
`--accept-new-host-key` (trust an unknown key without asking; a changed key is still
refused), and `exec` takes `--exec-timeout <secs>` (default 600). With `--json`, `exec`
prints `{host, exit_code, signal, stdout, stderr, duration_ms}` and `connect` prints
`{host, exit_code}` after the session. See [Connecting](/guides/connecting/).

`connect` on an [RDP host](/guides/remote-desktop/) never shows a desktop in the
terminal: with Flint serving the vault it opens the host's tab there, prints `Opened
<alias> in Flint (remote desktop).` (`{host, type, opened}` with `--json`) and exits 0;
with no Flint serving it, it fails with `wrong_host_type`.

With `--sudo`, the words after `--` are the command and its arguments, each passed to
`sudo` as one word, never parsed by a shell (`--sudo -- sh -c '…'` for a pipe). The
command runs with no terminal; its output and exit status come back as with `exec`.
It runs only through Flint, approved one command at a time; with Flint closed or the
vault locked it fails with `locked`. See [sudo](/guides/ai-agents/#sudo).

### Files

| Command | What it does |
|---|---|
| `cp <local path> <alias>:<path>` | Copy to the host: into `<path>` when it is a folder, else to that name |
| `cp <alias>:<path> <local path>` | Copy from the host. `<alias>:` alone is the login folder |
| `cp <alias>:<path> <alias>:<path>` | Copy from one host to another, through this machine |

`-r` (or `--recursive`) copies a folder and everything in it, merging into a folder that
is already there. `--force` replaces an existing file, which is otherwise refused with
`exists`. `--timeout` and `--accept-new-host-key` work as for `exec`. Progress goes to
stderr when it is a terminal. With `--json`, `cp` prints `{host, to_host, direction,
files: [{source, target, bytes}], folders, bytes, skipped, duration_ms}`; `direction` is
`upload`, `download` or `relay`. Through Flint it needs a grant that runs commands on that
host, or on both hosts of a copy between two. See [Copying files](/guides/files/).

### Tunnels

| Command | What it does |
|---|---|
| `tunnel add <host> <name> --local <port>` | Save a tunnel in a host: `127.0.0.1:<port>` here reaches `--to <destination>` as the host sees it (`port`, `host:port` or `[address]:port`; default `localhost:<port>`). `--open-on-connect` starts it when you connect in the app |
| `tunnel edit <host>:<name>` | Change `--name`, `--local`, `--to`, `--open-on-connect` / `--no-open-on-connect` |
| `tunnel rm <host>:<name>` | Stop it if it runs, then forget it |
| `tunnel ls [<host>]` | Every saved tunnel, or one host's, with its state when Flint runs the command |
| `tunnel up <host>:<name>` | Start it in Flint, which keeps it running. Logs in to the host as `connect` does |
| `tunnel down <host>:<name>` | Stop it and every connection through it |
| `tunnel status [<host>:<name>]` | One tunnel's state, or every running tunnel |

`up`, `down` and `status` run only through Flint: with Flint closed or the vault locked
they fail with `locked`, and never ask for the master password. `up` takes `--timeout` and
`--accept-new-host-key` as `exec` does; through Flint, `up` and `down` need a grant that
runs commands on the host. A port already in use fails with `port_in_use`. With `--json`,
a tunnel is `{host, name, local_port, destination, open_on_connect, state, listen,
connections, error}`, where `state` is `stopped`, `listening` or `connection lost` (empty
from `ls` when Flint does not run it) and `listen` is `127.0.0.1:<port>` while it listens;
`ls` and `status` print an array, `rm` prints `{removed, name}`. See
[Tunnels](/guides/tunnels/).

### Tokens

| Command | What it does |
|---|---|
| `token create --name <name> --allow <actions> [--hosts <list> \| --all] [--ttl <ttl>]` | Ask Flint to create a token for a program it cannot ask (cron, launchd, CI). Flint's window asks you to approve it, every time; the token is printed once, alone on stdout |
| `token list` | Every token: id, name, what it allows, which hosts, status (`active`, `expired`, `revoked`) and until when |
| `token revoke <name\|id>` | End a token at once. Revoked tokens stay listed, so the activity log can still name them |

`--allow` takes `read`, `exec` and `write`, comma-separated; `write` needs `--all`.
`--hosts` takes host aliases and `@group` paths, comma-separated, and may repeat; reading
alone needs no hosts. `--ttl` is `15m`, `1h`, `4h`, `1d` (default), `7d`, `30d` or `90d`.
`token create` runs only in Flint: without it, it fails with `locked`; with `FLINT_TOKEN`
set it fails with `denied`. `token list` and `token revoke` also work with the master
password typed for one command. With `--json`, `create` prints `{token, secret}` and
`list` an array of `{id, name, all, groups, hosts, read, exec, write, created_at,
expires_at, revoked_at, status}` (Unix seconds); no output ever carries a token's hash.
See [Tokens for scheduled jobs](/guides/ai-agents/#tokens-for-scheduled-jobs).

## Secrets

Flint never takes a secret from a command-line argument or an environment variable, where
it would leak into `ps`, shell history and child processes. A secret comes from one of
two places:

- **The terminal.** Flint asks with echo off: the master password when the vault is not
  unlocked in the Flint app (for that one command; nothing is kept), a host/credential
  password when you pass `--password`, or a host's sudo password with `--sudo-password`.
- **Stdin**, with a `--*-stdin` flag. This is for scripts and agents.

The one exception is `FLINT_TOKEN`: a scheduled job has neither a terminal nor a stdin to
spare, and a token is scoped, expires and can be revoked, unlike a password. Set it only
in the job's own environment, from its secret store.

When a command takes several secrets on stdin, they are read in this order:

1. The master password line (`--master-stdin`)
2. The password line (`--password-stdin`)
3. The sudo password line (`--sudo-password-stdin`)
4. The passphrase line (`--passphrase-stdin`)
5. The private key, which takes the rest of stdin (`--key-stdin`)

```sh
printf '%s\n%s\n' "$MASTER" "$HOST_PASSWORD" |
  flint host add db --hostname db.internal --master-stdin --password-stdin
```

Output never contains a secret, with or without `--json`. Hosts and credentials report
`has_password` (hosts also `has_sudo_password`), keys report `has_passphrase`.

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
| 3 | `not_found` | No such vault, host, group, key, credential or tunnel |
| 4 | `conflict` | Already exists, or still in use |
| 5 | `locked` | The vault is not unlocked in Flint and no master password was given. With no terminal, Flint's window now asks for it (see [Vaults](/guides/vaults/#flint-holds-the-unlocked-vault)) |
| 6 | `wrong_password` | The master password is wrong |
| 7 | `invalid` | A value breaks a rule (alias, port, colour, key format…) |
| 8 | `unsupported` | The vault was written by a newer Flint |
| 9 | `keychain` | The OS keychain refused to remove a remembered key (`vault lock`, `vault forget`) |
| 10 | `io` | The vault or config file could not be read or written |
| 11 | `host_key` | A server key is unknown and could not be confirmed, or it changed |
| 12 | `auth` | The server accepted none of the auth methods |
| 13 | `network` | A host could not be reached, or the connection dropped |
| 14 | `timeout` | `flint exec` ran past `--exec-timeout` |
| 15 | `denied` | The owner denied this program in Flint's window, or its grant or token does not cover the command; a token that is revoked, expired or wrong (see [Approve a program](/guides/ai-agents/#approve-a-program)) |
| 16 | `approval_timeout` | Nobody answered Flint's approval window within two minutes |
| 17 | `not_sudoer` | `exec --sudo`: the host's login user may not use `sudo` |
| 18 | `sudo_password` | `exec --sudo`: sudo refused the password Flint typed, or Flint has none for that host |
| 19 | `permission_denied` | `cp`: the user may not read that file or write in that folder, here or on the host |
| 20 | `exists` | `cp`: the file is already there; `--force` replaces it |
| 21 | `not_a_directory` | `cp`: a path that has to be a folder is a file |
| 22 | `port_in_use` | `tunnel up`: another program already listens on that local port |
| 23 | `wrong_host_type` | An RDP host given to something only SSH does: `exec`, `cp`, `host test`, a tunnel, a jump host; or `connect` on one with no Flint serving the vault |
| 24 | `refused` | A remote desktop server answered and refused the connection (in the app; no command returns it yet) |

The codes are stable: scripts can rely on them.

A command Flint has to ask you about waits for your answer and says so on stderr
(*Waiting for approval in Flint (flint, started by Claude Code)…*); with `--json` it waits
silently, so stderr holds at most the one JSON error.

`connect` and `exec` exit with the **remote** status once the command has run (255 for
a signal), so a remote `exit 3` and a `not_found` error both exit 3. Use `--json` to
tell them apart: a remote status comes with a JSON object on stdout, a Flint error with
nothing on stdout and a JSON error on stderr.

## Environment

| Variable | Meaning |
|---|---|
| `FLINT_CONFIG_DIR` | Folder for the recent-vault list and the open app's socket (see [Vaults](/guides/vaults/#flint-holds-the-unlocked-vault)) |
| `FLINT_APP` | The Flint app `flint` starts when a locked vault needs unlocking: a path to `Flint` or `Flint.app`. `off` never starts it |
| `FLINT_TOKEN` | A token from `flint token create`: the request is allowed by it alone, or refused with `denied`, and Flint never asks. The one secret Flint reads from the environment, since a scheduled job has no terminal |
| `FLINT_KEYCHAIN=off` | For the app: never remember vault keys (**Remember on this computer** does nothing), always ask for the master password. The CLI never reads the keychain |
| `SSH_AUTH_SOCK` | The SSH agent to try after the vault's keys and passwords |
| `TERM` | The terminal type `flint connect` asks the server for (default `xterm-256color`) |

## `flint --version`

```sh
flint --version --json
```

```json
{"flint":"0.0.0-dev","libssh":"0.12.2/openssl/zlib","libsodium":"1.0.22","sqlite":"3.54.1 (SQLCipher 4.20.0 community)"}
```
