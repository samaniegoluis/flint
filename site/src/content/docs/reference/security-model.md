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
  slow;
- a weak master password can be replaced (`flint vault passwd`, **Settings → Vault**): the
  vault is re-encrypted under a new salt and key in one rename, so a copy taken before the
  change still opens only with the old password. Flint shows a strength estimate as you
  type it, and a remote vault will need **Strong** (3 of 4) or better.

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

A remote desktop server's certificate is checked by Flint, not by FreeRDP: the first one is
shown with its SHA-256 fingerprint and kept in the vault once you trust it, and a changed
one is refused before the password is sent, with no way to continue. The old *Standard RDP
Security*, where no certificate is checked, is refused. The password goes to FreeRDP only
to sign in and is wiped from its memory once the session is up. The desktop's frames reach
the page over a channel on `127.0.0.1` that answers only requests carrying a 256-bit random
token, made per tab, sent to that port by number, and readable by no other web page. See
[Remote desktop → Security](/guides/remote-desktop/#security).

## Secrets leave memory once used

A password, key or passphrase opened from the vault is overwritten as soon as SSH or RDP
has it, and so are the bytes it was opened from; the keys derived from the master password
are overwritten once the vault has been opened with them. Locking wipes the vault's key
itself. This is done with libsodium's `sodium_memzero`, and it is best effort: the
libraries Flint hands a secret to keep their own copy while they need it.

## Access to an unlocked vault: today

The key of an unlocked vault lives in the **running Flint app**. The `flint` CLI never
reads it from the OS keychain: it asks the app over a local socket (mode 0600 in the
config folder; a connection from another user is closed unread), or you type the master
password for one command ([details](/guides/vaults/#flint-holds-the-unlocked-vault)).

| Who | Today |
|---|---|
| You, in the app | Unlock with the master password. The app reopens the last vault on launch without it only if you ticked **Remember on this computer**, which saves the key in the OS keychain |
| You, in a terminal | Through the app while the vault is unlocked there; otherwise the master password, for that one command |
| An AI agent you started | Only once you approve it in Flint's window: the hosts, actions and time you chose, as the host's login user. Never a password or a key. While the vault is locked, `locked`, and Flint's window asks you to unlock, naming the command |
| Another program running as you | The same as an agent: Flint asks you before it runs anything, naming the program. On Linux, if you ticked **Remember on this computer**, it can read that key from the Secret Service, which has no per-app access list |
| A person at your unlocked computer | Nothing from a window you closed to the menu bar or tray: it opens with Touch ID, polkit or the master password. Everything in a window left open |
| A person with your file but not your computer | Nothing, without the master password |

The vault **locks on its own**: after the idle time in Settings (1 hour by default), when
the screen locks and before sleep. Locking wipes the key from memory; until you type the
master password again, nothing (the CLI, an agent, a new session) can use the vault.
Sessions already open keep running. See [Locking](/guides/vaults/#locking).

### Approving callers

Every `flint` command that reaches the app is checked against a **grant** before it runs.
Flint identifies the caller from the socket itself (the kernel gives the peer's process
id, never a claim the caller makes), walks up its parent processes past `flint` and any
shell, and ties the grant to the first real program by its process id and start time:
Claude Code, a terminal, tmux. A grant is scoped (hosts or groups; read, run commands,
change the vault) and expires; it ends when the vault locks and when Flint quits, and it
is never written to disk.

Allowing needs **presence**: Touch ID or the Mac's password (macOS), the login password
through polkit (Linux, with `dev.flint.approve` installed from
`packaging/linux/dev.flint.policy`), or the vault's master password. A program that can
click Flint's window still cannot approve itself. Denying needs nothing.

**Tokens** (`flint token create`) are for programs nobody starts from an approved
terminal: a cron job, CI. A token is a grant with a secret, kept in the vault: Flint
stores only a BLAKE2b hash of the secret (libsodium) and compares it in constant time;
the token is printed once, to whoever created it. Creating one is approved in Flint's
window **every time**, with presence, and no grant or token covers it, so an approved
agent cannot turn its hour into a month. A request with `FLINT_TOKEN` is decided by the
token alone and refused at once outside its scope, after it expires (90 days at most) or
once revoked. A token never unlocks the vault.

The **activity log** records every command a caller ran or changed through Flint and
every request refused: when, which program (and token), the host and the whole command
(up to 16 KB), never a flag's value or a secret. Allowed reads are not recorded. It is
**this machine's**: a [file of its own](/reference/vault-format/#the-activity-file) in the
config folder, encrypted with a key derived from the vault's, and never inside the vault,
so a vault that syncs carries no log and is not rewritten on every `flint exec`. It
keeps entries for 30 days, 90 days (the default), 1 year or with no limit, set on each
machine in **Settings → Access** and nowhere else: no CLI command changes it, so a
program allowed to change the vault cannot shorten the record of what it did. Past about
50 MB the oldest entries go whatever the setting. Read it, or **Back up activity…** (a
copy of the file, still encrypted), in **Settings → Access**.

**What you approve is what runs.** The approval window shows the command read from the
arguments Flint is about to run, not from words the program sends to describe itself, and
**Show full command** opens all of it. Viewing a command needs no Touch ID or password:
presence protects allowing, not reading. A whole command never leaves the vault and the
app: it is not written to Flint's own log or to any error.

**`sudo` you approve** (`flint exec --sudo`): a command as root is approved in Flint's
window one at a time, with presence, showing the exact arguments; no grant or token
covers it. Flint runs `sudo -S -k -p <random prompt> -- <arguments>`, each argument one
shell word, and writes the host's sudo password (sealed in the vault, or the login
password) to sudo's stdin only when that random prompt appears, so a command printing a
fake prompt gets nothing. The prompt and the password never reach the caller, the log or
the activity; `-k` leaves no sudo session cached for a later command. It runs only in
Flint, never on a typed master password.

What a grant does not stop: a program running as you that is a **child of an approved
program** shares its grant, and a program that can control the approved one (debug it,
type into its terminal) can act through it. [Limits today](/guides/ai-agents/#limits-today)
shows how to narrow what an agent can reach.

### Two locks

**Closed to the menu bar or tray**, Flint keeps serving approved callers but locks its
**window**: until Touch ID (or the Mac's password), polkit or the master password opens
it, the window's page gets nothing from the vault (the app refuses it every read) and
cannot type into the sessions behind it. The vault's own lock is the stronger one: it
wipes the key and ends every grant.

**Remember on this computer** is a choice at unlock, off by default, with the risk in
plain words: it saves the vault key in the OS keychain so Flint reopens without the
master password. Without it no key is written there; the keys earlier versions cached on
every unlock are removed once.

## The remote vault server

[`flint-vault-server`](/guides/vault-server/) stores the vault file exactly as Flint
uploads it, encrypted in full, with a version and the vault's id. It never receives the
master password or any key and never opens the file, so whoever holds the server or its
token reads only ciphertext; your master password is then what stands against an offline
attack, which is why Flint asks for a strong one before it connects.

The token says who may talk to the server. The server can keep only its BLAKE2b hash
(libsodium), compares it in constant time, refuses a short one at start, and locks a
client out after 10 wrong tokens in 10 minutes. Every request has a size cap and a
deadline, and each client a rate limit. The log never holds a token, a header's value or
the file. A stolen token can still upload, so the server keeps the last 10 versions and
any of them can be [restored](/guides/vault-server/#restore-an-older-version); a machine
never replaces its own copy with a download, it merges it.

On each machine ([Sync a vault across machines](/guides/remote-vault/)):

- The token lives in the OS keychain, apart from the vault's key (which the CLI never
  reads from it), and travels only to the server, in the `Authorization` header. It is
  never printed, logged, written to the config folder or part of an error.
- Flint refuses `http://` for any server but this machine, follows no redirect, and
  bounds every request (10 s to connect, 2 minutes in all, 64 MiB at most).
- A vault connects only with a **Strong** master password, typed for that command.
- A downloaded copy is opened with the vault's key through a private file (`0600`) in the
  config folder and must carry the vault's id; then it is merged into the vault in one
  transaction, never written over it. An upload names the version it merged
  (`If-Match`), so a machine never uploads over a change it has not seen.
- `remotes.json` holds the vault's path and id, the server's URL, a version and a hash
  of the encrypted file: nothing from inside the vault.

## Next

Windows (a named pipe and Windows Hello), a headless `flint serve`, and a Keychain item
only Touch ID releases, which needs a signed build. The design and the reasons behind
the access model are in the repository: `docs/vault-access-model.md`.
