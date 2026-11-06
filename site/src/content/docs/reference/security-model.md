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

When you unlock a vault, Flint caches its key (never the password) in the OS keychain, so
this machine opens it without asking. That cache opens the vault for anyone and anything
that runs Flint as you:

| Who | Today |
|---|---|
| You, in the app or a terminal | Opens without a prompt |
| An AI agent you started | Same as you: any host in the vault, any command, as the host's login user. Never a password or a key |
| Another program running as you | Same, by running `flint`. On Linux it can also read the cached key from the Secret Service, which has no per-app access list. On macOS the Keychain item belongs to Flint's binary and asks first |
| A person at your unlocked computer | Opens Flint |
| A person with your file but not your computer | Nothing, without the master password |

[Vaults](/guides/vaults/#what-the-cache-protects-and-what-it-does-not) shows how to turn
the cache off, and [Limits today](/guides/ai-agents/#limits-today) how to narrow what an
agent can reach.

## Next

Flint is moving the access decision from the OS keychain into Flint itself, the same on
macOS, Linux and Windows:

- **Flint holds the unlocked vault.** The key lives only in the running app (later a
  background service) and is wiped when it locks. The `flint` CLI asks it, instead of
  opening the vault on its own.
- **Each caller is approved.** The first time a program or agent asks, Flint names it
  ("`flint` started by Claude Code") and asks you, in its own window, which hosts it may
  use and for how long. Grants are scoped and expire.
- **The CLI asks you to unlock.** With Flint closed, `flint` opens the app on its unlock
  screen, saying who is asking.
- **Auto-lock** after a set idle time, on screen lock and on sleep. Closed to the menu bar
  or tray, Flint keeps serving approved callers but locks its **window**: opening it asks for
  the master password or Touch ID.
- **Remember on this computer** becomes a choice at unlock, off by default, with the risk
  in plain words: it lets Flint reopen without the master password.
- **`sudo` you approve.** `flint exec --sudo` shows you the exact command; Flint types the
  password only after you allow it.
- **An activity log** of what each approved caller ran.

None of this is built yet; it is planned for the next version. The design and the reasons
behind it are in the repository: `docs/vault-access-model.md`.
