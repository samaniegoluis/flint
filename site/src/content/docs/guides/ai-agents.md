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

The agent runs `flint` as you, on your machine. It never opens the vault itself: every
command goes through the **Flint app**, which holds the vault unlocked
([how](/guides/vaults/#flint-holds-the-unlocked-vault)).

1. Open Flint and unlock the vault. Keep it open while the agent works.
2. Check that a command runs without a prompt:

   ```sh
   flint vault status
   flint --json host list
   ```

3. Trust each server's host key yourself before the agent uses it, with
   `flint host test <alias>` or a first `flint connect`. An agent has no terminal to
   answer the host key question, so an unknown key stops it with `host_key`.

The first time the agent runs `flint`, Flint asks you in its own window
([Approve a program](#approve-a-program)). The command waits while you decide.

When the vault locks (idle time, screen lock, sleep) or Flint is closed, the agent's next
command fails with `locked`, and Flint's window, started if needed, asks you for the
master password and names the command that asked. Unlock (with **Allow … for 1 hour**
ticked, the agent is approved in the same step), and the agent can run it again.
**Settings → Vault → Lock after** sets the idle time (1 hour by default).

## Approve a program

Flint answers no `flint` command until you approve the program behind it. The window
names it after the program that started `flint`, skipping shells: *"flint, started by
Claude Code"*, *"flint, started by tmux"*. It shows the chain of processes and the exact
command, and lets you choose:

| | |
|---|---|
| **Hosts** | The host the command runs on, its group, or the whole vault |
| **Actions** | **Read** (list and show; never a secret), **Run commands** (`exec`, `connect`, `host test` on the hosts chosen), **Change the vault** (add, edit, remove; needs the whole vault) |
| **Duration** | 15 minutes, 1 hour, 4 hours, or until the vault locks |

**Allow** asks you to prove you are at the machine: Touch ID or your Mac's password on
macOS, your login password through polkit on Linux, or the vault's master password where
neither is available. **Deny**, or no answer within two minutes, refuses the command.

The grant covers every `flint` that program starts until it expires, the vault locks or
Flint quits; it is tied to that process, so another program, or the same one started
again, asks again. **Settings → Access** lists the grants, and **Revoke** ends one now.
The status bar counts them (**Agents: N**), and shows **N waiting** while a request waits
behind another app.

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
- Exit code 5 (`locked`): Flint is asking me to unlock it; wait for me, then retry.
  15 (`denied`) or 16 (`approval_timeout`): I did not approve it in Flint; ask me first.
  11 (`host_key`): ask me to check the server's key. Never pass `--accept-new-host-key`.
- As root: `flint --json exec <alias> --sudo -- <command> [args]`. I approve each one
  in Flint, which types the sudo password; you never see it. Pass the arguments as
  separate words, not one quoted string. Exit 17 (`not_sudoer`) or 18 (`sudo_password`):
  tell me.
```

## Commands an agent uses

| Command | What it gives the agent |
|---|---|
| `flint --json host list` | Every host: alias, hostname, user, group, tags. No secret |
| `flint --json host show <alias>` | One host, with `has_password` instead of the password |
| `flint --json exec <alias> -- '<cmd>'` | `{host, exit_code, signal, stdout, stderr, duration_ms}` |
| `flint --json exec <alias> --sudo -- <cmd> [args]` | The same, run as root once you allow that exact command in Flint |
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
| 5 | `locked` | Stop: Flint's window is asking you to unlock. Retry once you have |
| 11 | `host_key` | Stop. The key is unknown, or it **changed**, which Flint always refuses |
| 12 | `auth` | Report it: the server refused every login method in the vault |
| 13 | `network` | The host is unreachable: VPN, address, firewall |
| 14 | `timeout` | The command ran past `--exec-timeout` |
| 15 | `denied` | You denied it in Flint, or the grant does not cover it. Ask before retrying |
| 16 | `approval_timeout` | Nobody answered Flint's window within two minutes |
| 17 | `not_sudoer` | The host's login user may not use `sudo` |
| 18 | `sudo_password` | sudo refused the password Flint typed, or Flint has none for that host |

The full list is in the [CLI reference](/reference/cli/#output-and-errors).

## sudo

A plain `flint exec` cannot answer a `sudo` password prompt: there is no terminal for it,
and Flint never hands a password to the caller. `flint exec --sudo` runs one command as
root instead:

```sh
flint exec web-01 --sudo -- systemctl restart nginx
```

1. Flint's window shows the program that asks, the host, the login user and the
   **exact arguments**, one per chip. No grant or token covers it: every `--sudo`
   command is asked for, and confirmed with Touch ID, polkit or the master password.
2. Flint runs `sudo -S -k -p <random prompt> -- <arguments>` on the host, each argument
   quoted as one word: the arguments are never parsed by a shell. For pipes or
   redirections the agent passes them on purpose, and you see them:
   `--sudo -- sh -c 'journalctl -u nginx | tail -n 50'`.
3. Flint types the sudo password only when sudo prints that random prompt, so a command
   that prints a fake `password:` gets nothing. The prompt and the password never reach
   the agent's output. `-k` leaves no cached sudo session behind for later commands.

The password is the host's **sudo password** if you set one (`flint host edit <alias>
--sudo-password`, or the host editor), else its login password. When Flint has neither,
the window asks for it, for that command, with **Save it for this host**.

`--sudo` runs only through Flint: with Flint closed or the vault locked it fails with
`locked`, even for a person who could type the master password. The command gets no
terminal and its stdin is closed once sudo has the password, as with `flint exec`. Every
decision is in the activity log, with the full command.

If a host lets its login user run `sudo` with no password (`NOPASSWD`), or logs in as
`root`, a plain `flint exec` gets root there with no window. Keep agents away from such
hosts, or remove that rule.

## Limits today

An approved program can run any command on the hosts you allowed, as each host's login
user. It cannot take a password or key away, but a command can, for example, add a key
to `~/.ssh/authorized_keys`. Ways to narrow it:

- **Allow one host or one group**, not the whole vault, and only **Run commands** when
  the agent does not need to change the vault.
- **A short grant**: 15 minutes, or until the vault locks, with a short
  **Settings → Vault → Lock after**.
- **A vault for agents.** Put only the hosts an agent may use in a vault of its own, keep
  that vault open in Flint while the agent works, and have the agent pass `--vault`.
  Flint holds one vault at a time, so your main vault stays locked meanwhile.
- **Limit the server side.** Agents log in as a user without `NOPASSWD` sudo and not as
  `root`, with access only to what they need.
- **Watch the transcript.** Every remote command an agent runs is in its own
  `flint exec` line.
- **Read the activity log** in **Settings → Access**: every command a program ran or
  changed through Flint, and every request refused or left to time out, newest first.
  Commands run as root carry a `root` badge and are always shown in full.

## Tokens for scheduled jobs

A cron job, a launchd agent or a CI runner on this machine has nobody at a terminal and
no Flint window to wait on: every run is a new process, so a grant would be asked for each
time. Give it a **token** instead:

```sh
flint token create --name nightly-backup --allow exec --hosts nas,@homelab --ttl 30d
```

Flint shows the request in its window, the token's name, what it allows, which hosts and
for how long, and creates it only once you allow it, with Touch ID or your password. It
asks every time: no grant covers `token create`, so an agent you approved for an hour
cannot mint itself a token that lasts a month. The token is printed **once**, alone on
stdout:

```sh
FLINT_TOKEN=$(flint token create --name ci --allow read)   # keep it in the job's secret store
```

The job passes it in the `FLINT_TOKEN` environment variable, never as an argument (it would
show in `ps`):

```sh
FLINT_TOKEN=flint_… flint exec nas -- /usr/local/bin/backup.sh
```

With a token, Flint decides on the token alone and never opens a window: a request it
covers runs; anything else fails at once with `denied` (15), saying why (outside its
hosts, revoked, expired). A token never unlocks the vault, so Flint must be running with
it unlocked, and it never creates another token.

| Flag | Meaning |
|---|---|
| `--name` | What `token list`, `token revoke` and the activity log call it |
| `--allow` | `read`, `exec`, `write`, comma-separated. `write` needs `--all` |
| `--hosts` | Host aliases and `@group` paths (with their subgroups). Not needed for `read` alone |
| `--all` | The whole vault |
| `--ttl` | `15m`, `1h`, `4h`, `1d` (the default), `7d`, `30d`, `90d`. There is no "never" |

`flint token list` shows every token with its status; `flint token revoke <name|id>`, or
**Revoke** in **Settings → Access**, ends one at once. Flint keeps only a hash of the
token's secret, inside the encrypted vault. See the [CLI reference](/reference/cli/#tokens).
