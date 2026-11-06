---
title: Use Flint with an AI agent
description: Let a coding agent reach your servers through your vault, without ever handing it a password or a key.
---

A coding agent (Claude Code, Codex, or any tool that can run a command) can use the same
vault you use in the app. It reaches a server by its alias with `flint exec`, Flint logs
in, and the agent gets the output and the exit code. Passwords, keys and passphrases stay
inside Flint: no command prints them, so they never reach the agent's prompt, transcript
or context.

```sh
flint --json exec web-01 -- 'systemctl is-active nginx'
```

```json
{"host":"web-01","exit_code":0,"signal":"","stdout":"active\n","stderr":"","duration_ms":187}
```

## Set up the machine

The agent runs `flint` as you, on your machine, so it uses your current vault and the key
cached in the OS keychain.

1. Unlock the vault once, in the app or with:

   ```sh
   flint vault unlock
   ```

2. Check that a command runs without a prompt:

   ```sh
   flint vault status
   flint --json host list
   ```

3. Trust each server's host key yourself before the agent uses it, with
   `flint host test <alias>` or a first `flint connect`. An agent has no terminal to
   answer the host key question, so an unknown key stops it with `host_key`.

With the vault unlocked in the open app, `host`, `group`, `key`, `cred` and the other
vault commands run inside Flint and need no cached key at all
([how](/guides/vaults/#the-cli-and-the-open-app)). `flint exec` and `flint connect` still
open the vault themselves, so the steps above are still needed for them.

On macOS, a new Flint build shows the Keychain dialog the first time it reads the cached
key ([why](/guides/vaults/#what-the-cache-protects-and-what-it-does-not)). Run one command
yourself after each update, so the dialog does not wait on the agent. On Linux, the cache
needs a Secret Service (GNOME Keyring, KWallet); without one, every command asks for the
master password and an agent gets `locked`.

## Tell your agent about Flint

Paste this into your project's `CLAUDE.md`, `AGENTS.md` or the agent's instructions:

```md
## Servers

This machine reaches servers through Flint. Never ask for, read or use SSH passwords,
keys or `ssh` directly.

- List hosts: `flint --json host list`
- Run a command: `flint --json exec <alias> -- '<command>'`. Quote the whole remote
  command: the remote shell parses it.
- Long jobs: add `--exec-timeout <secs>` (default 600).
- Exit code 5 (`locked`): ask me to unlock Flint. 11 (`host_key`): ask me to check the
  server's key. Never pass `--accept-new-host-key`.
- `sudo` needs a password Flint does not give out: print the exact command for me to run.
```

## Commands an agent uses

| Command | What it gives the agent |
|---|---|
| `flint --json host list` | Every host: alias, hostname, user, group, tags. No secret |
| `flint --json host show <alias>` | One host, with `has_password` instead of the password |
| `flint --json exec <alias> -- '<cmd>'` | `{host, exit_code, signal, stdout, stderr, duration_ms}` |
| `flint --json known-host list` | The server keys Flint has recorded |

Everything after `--` is joined with spaces and parsed by the **remote** shell, like `ssh`.
Quote the remote command as one word, or the local shell splits it first:

```sh
flint exec web-01 -- 'cd /var/log && tail -n 50 syslog'   # one remote command
flint exec web-01 -- sh -c 'echo $HOME'                   # the remote shell sees: sh -c echo $HOME
```

The second line is a common trap: the quotes are gone by the time the remote shell reads
the line, so `sh -c` gets only `echo`. Quote the whole thing instead:
`flint exec web-01 -- 'sh -c "echo \$HOME"'`, or just `flint exec web-01 -- 'echo $HOME'`.

`flint exec` closes the command's stdin and gives it no terminal, so a program that waits
for input (a password prompt, a "continue? [y/N]") gets none. Prefer non-interactive flags
(`apt-get -y`, `--no-pager`).

## Errors an agent can act on

With `--json`, a Flint error is one JSON object on stderr and nothing on stdout; a remote
command's own failure comes as the usual object on stdout with its `exit_code`.

| Exit | Code | What the agent should do |
|---|---|---|
| 5 | `locked` | Stop and ask you to unlock the vault |
| 11 | `host_key` | Stop. The key is unknown, or it **changed**, which Flint always refuses |
| 12 | `auth` | Report it: the server refused every login method in the vault |
| 13 | `network` | The host is unreachable: VPN, address, firewall |
| 14 | `timeout` | The command ran past `--exec-timeout` |

The full list is in the [CLI reference](/reference/cli/#output-and-errors).

## sudo

A command that needs `sudo` with a password fails under `flint exec`: there is no terminal
for the prompt, and Flint never hands the password to the caller. Have the agent print the
command so you run it. `flint exec --sudo`, on the roadmap, will show you the exact command
in a Flint window and type the password itself after you approve.

If a host lets its login user run `sudo` with no password (`NOPASSWD`), or logs in as
`root`, the agent gets root there with no question asked. Keep agents away from such hosts,
or remove that rule.

## Limits today

The cached key opens the vault for **any program that runs `flint` as you**, not only the
agent you started, and an agent can run any command on any host in the vault, as that
host's user. It cannot take a password or key away, but a command can, for example, add a
key to `~/.ssh/authorized_keys`. Ways to narrow it today:

- **A vault for agents.** Put only the hosts an agent may use in a vault of its own, and
  have the agent pass `--vault`:

  ```sh
  flint vault create ~/Sync/agent.flint --name Agent
  flint --vault Agent host add web-01 --hostname 10.0.0.5 --user deploy
  ```

  Keep your main vault's key out of the cache on that machine: run
  `flint --vault <main> vault lock` when you are done (opening it in the app caches it
  again), or set `FLINT_KEYCHAIN=off` for the app.
- **Limit the server side.** Agents log in as a user without `NOPASSWD` sudo and not as
  `root`, with access only to what they need.
- **Watch the transcript.** Every remote command an agent runs is in its own
  `flint exec` line.

Flint is moving to a model where it approves each program that asks for the vault, in its
own window, for chosen hosts and a set time, with an activity log. See the
[Security model](/reference/security-model/#next).
