---
title: Connecting
description: Open a shell or run a command on a host, through jump hosts, with known-host checks.
---

This page covers the CLI. In the desktop app, a session opens in a tab and the same
checks appear as prompts over it; see [The desktop app](/guides/desktop-app/#connecting).

Once a host is in the vault, you reach it by its alias. Flint reads the hostname, user,
key, password and jump host from the vault, so nothing about the server has to be
typed or kept in `~/.ssh`.

```sh
flint connect web-01              # interactive shell
flint exec web-01 -- uptime       # one command
```

## Interactive shell

```sh
flint connect <alias> [--timeout <secs>] [--accept-new-host-key] [--no-command]
```

`flint connect` opens a shell in a remote terminal the size of your window, and follows
it when you resize. Keys go straight to the server: `Ctrl-C` interrupts the remote
command, not Flint. The session ends when the remote shell exits, and Flint exits with
the shell's exit status. Your terminal is restored when the session ends, even if Flint
is killed.

The remote terminal type is taken from `TERM` (`xterm-256color` if it is not set).

If the host has an [initial command](/guides/hosts/#run-a-command-on-connect), such as
`herdr`, it runs instead of the bare shell, through your interactive login shell; when
it exits, a login shell follows unless the host says to end the session. Use
`--no-command` to get a plain shell, for example when that program is broken. The app
does the same from the [command palette](/guides/desktop-app/#the-command-palette).

To check a host without opening anything, use
[`flint host test`](/guides/hosts/#check-that-a-host-works).

If the vault is locked, Flint asks for the master password on the terminal first. Do
not use `--master-stdin` with `flint connect`: it reads all of stdin, so the session
would see no keyboard input and end at once.

## Run a command

```sh
flint exec <alias> [--timeout <secs>] [--exec-timeout <secs>] [--accept-new-host-key] -- <command>
```

Everything after `--` is the remote command. Like `ssh`, Flint joins the words with
spaces and the remote shell parses them, so quote what the remote shell should see as
one word:

```sh
flint exec web-01 -- df -h /
flint exec web-01 -- 'cd /var/log && tail -n 50 syslog'
```

The remote stdout and stderr are written to Flint's stdout and stderr as they arrive,
and Flint exits with the remote exit status. A command killed by a signal exits 255.
The command's stdin is closed: `flint exec` does not forward your stdin yet.

With `--json`, the output is collected and printed as one object when the command ends:

```sh
flint --json exec web-01 -- 'echo hello; echo oops >&2; exit 3'
```

```json
{"host":"web-01","exit_code":3,"signal":"","stdout":"hello\n","stderr":"oops\n","duration_ms":41}
```

The exit status is still the remote one (3 here). A JSON object on stdout means the
command ran; a JSON error on stderr and nothing on stdout means Flint could not run it
(see [exit codes](/reference/cli/#output-and-errors)).

## How Flint logs in

The **user** is the host's `--user`, or else the user of its
[credential](/guides/credentials/). A host with neither is refused before anything is
dialled.

The **auth methods** are tried in this order, and the first one the server accepts wins:

1. The host's key (`--key`)
2. The host's password (`--password`)
3. The credential's key
4. The credential's password
5. Your SSH agent (`SSH_AUTH_SOCK`), if one is running

The host's own settings come first because they are the more specific ones. Passwords
are sent with password authentication, or with keyboard-interactive authentication when
the server only offers that. When every method fails and Flint runs in a terminal, it
asks for the password once. The error then lists what was tried, by name:

```text
flint: deploy@web-01: no auth method was accepted (tried: key 'deploy', SSH agent)
```

Secrets are decrypted only at this point, handed to the SSH library, and never printed.

## Jump hosts

A host with `--jump <alias>` is reached through that host, like OpenSSH's `ProxyJump`.
Jump hosts can be chained: if `bastion` itself has a jump host, Flint goes through both.

```sh
flint host add bastion --hostname bastion.example.org --user jump --key laptop
flint host add db --hostname 10.0.0.12 --user admin --cred ops --jump bastion
flint connect db
```

Every hop is a separate SSH session with its own known-host check and its own login,
taken from that hop's own host entry. The jump host only forwards encrypted bytes: it
never sees the credentials for the next hop.

## Known hosts

The first time Flint reaches an address, it shows the server's key fingerprint and asks
whether to trust it:

```text
The host 'web-01' (10.0.0.5) is not known yet.
ssh-ed25519 key fingerprint is SHA256:9PMRynWDtBxv/4WwK/c4pVJdjpcJwqYQzJ3HCvXtiRE.
Trust this key and continue connecting (yes/no)?
```

Answer `yes` to record it. The key is stored **inside the vault**, encrypted like
everything else, so every machine that opens the vault trusts the same servers. Flint
does not read or write `~/.ssh/known_hosts`.

- **No terminal** (a script, a cron job, an agent): an unknown key fails with
  `host_key`, unless you pass `--accept-new-host-key` to trust it on first use.
- **A changed key is always refused**, with or without `--accept-new-host-key`, before
  any credential is sent. A changed key can mean someone is intercepting the
  connection. If you know why it changed (the server was reinstalled), forget the old
  key and connect again:

```sh
flint known-host list
flint known-host rm web-01      # by alias, or by address: flint known-host rm '[10.0.0.5]:2222'
```

Keys are recorded per address: `hostname` on port 22, `[hostname]:port` otherwise.

Many servers have more than one host key (for example ed25519, ECDSA and RSA). Once a
key is recorded, Flint asks the server for that same key type first, so the server keeps
presenting the key you trusted. If the server no longer has a key of that type, the key
counts as changed and is refused like any other changed key.

## Timeouts

| Flag | Default | Bounds |
|---|---|---|
| `--timeout <secs>` | 15 | Each hop's connect, handshake and every login step |
| `--exec-timeout <secs>` | 600 | The whole remote command of `flint exec`; past it Flint exits with `timeout` (14) |

Both take 1 to 86400 seconds. An interactive shell has no time limit.

### Idle sessions

An interactive session, in the CLI or a tab in the app, sends the server a keepalive
after 30 seconds without hearing from it, as OpenSSH's `ServerAliveInterval 30` does.
Routers, NATs and firewalls that drop idle connections then leave it open while you
read. If the keepalive cannot be sent, the connection is gone: the session ends with
`network` (exit code 13 in the CLI, a lost connection in the app).

## Not supported yet

- Forwarding your stdin to `flint exec`, agent forwarding, port forwarding and SFTP.
- Picking a host interactively when `flint connect` has no alias.
- Reading `~/.ssh/config`: Flint takes everything from the vault.

These are planned for later versions.
