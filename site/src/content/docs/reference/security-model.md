---
title: Security model
description: What protects your vault today, from whom, and the access model Flint is moving to.
---

Flint protects two things: the **vault file**, wherever it is copied, and **access to an
unlocked vault** on your own machine. The first is settled. The second is where Flint is
heading next, and this page says plainly where it stands today.

## The vault file

Whoever copies the file (from a cloud folder, a backup, a stolen disk) gets nothing
without the master password:

- the **whole file** is encrypted with SQLCipher (AES-256), hostnames, users, notes and
  known host keys included;
- passwords, private keys and passphrases are **sealed again** with XChaCha20-Poly1305,
  each bound to its own field, and opened only to connect;
- the key comes from the master password through **Argon2id** (256 MiB), so guessing it is
  slow.

[Vault format](/reference/vault-format/) has the details.

## Secrets never reach the caller

No `flint` command prints a stored password, key or passphrase, with or without `--json`,
and Flint never takes a secret from a command-line argument or an environment variable,
where it would leak into `ps` and shell history. The desktop app shows a saved password
only when you press **reveal**, and **copy** writes it to the clipboard without passing it
to the page, then clears it after 30 seconds.

So a script or an AI agent that uses Flint gets results, never credentials. See
[Use Flint with an AI agent](/guides/ai-agents/).

## Servers are checked

Flint asks before it trusts a new server key, records it in the vault, and always refuses a
**changed** key before any credential is sent. It does not read `~/.ssh/known_hosts`. Jump
hosts are checked the same way, one hop at a time. See
[Connecting](/guides/connecting/#known-hosts).

## Access to an unlocked vault: today

The key of an unlocked vault lives in the **running Flint app**. The `flint` CLI never
reads it from the OS keychain: it asks the app over a local socket (mode 0600 in the
config folder; a connection from another user is closed unread), or you type the master
password for one command ([details](/guides/vaults/#flint-holds-the-unlocked-vault)).

| Who | Today |
|---|---|
| You, in the app | Unlock with the master password. The app may reopen the last vault on launch from a key it saved in the OS keychain |
| You, in a terminal | Through the app while the vault is unlocked there; otherwise the master password, for that one command |
| An AI agent you started | Through the app while the vault is unlocked there: any host in the vault, any command, as the host's login user. Never a password or a key. While it is locked, `locked`, and Flint's window asks you to unlock, naming the command |
| Another program running as you | The same as an agent. On Linux it can also read the app's cached key from the Secret Service, which has no per-app access list; **Forget on this device** in Settings → Vault removes it |
| A person at your unlocked computer | Opens Flint while the vault is unlocked |
| A person with your file but not your computer | Nothing, without the master password |

The vault **locks on its own**: after the idle time in Settings (1 hour by default), when
the screen locks and before sleep. Locking wipes the key from memory; until you type the
master password again, nothing (the CLI, an agent, a new session) can use the vault.
Sessions already open keep running. See [Locking](/guides/vaults/#locking).

[Limits today](/guides/ai-agents/#limits-today) shows how to narrow what an agent can
reach while the vault is unlocked.

## Next

The access decision moves further into Flint itself, the same on macOS, Linux and
Windows:

- **Each caller is approved.** The first time a program or agent asks, Flint names it
  ("`flint` started by Claude Code") and asks you, in its own window, which hosts it may
  use and for how long. Grants are scoped and expire.
- **Closed to the menu bar or tray**, Flint keeps serving approved callers but locks its
  **window**: opening it asks for the master password or Touch ID.
- **Remember on this computer** becomes a choice at unlock, off by default, with the risk
  in plain words: it lets Flint reopen without the master password.
- **`sudo` you approve.** `flint exec --sudo` shows you the exact command; Flint types the
  password only after you allow it.
- **An activity log** of what each approved caller ran.

Done so far: Flint holds the unlocked vault, the CLI (`connect` and `exec` included) runs
through it, a locked vault makes the window ask, and the vault locks on its own. The
design and the reasons behind it are in the repository: `docs/vault-access-model.md`.
