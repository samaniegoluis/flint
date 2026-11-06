# Vault access model

How a person, the `flint` CLI and an AI agent get to an unlocked vault: what protects it
today, why that is not enough, and the model Flint moves to. Decided in D-038 (milestone 10,
2026-11-06); built in a later spec. The site's [Security model](../site/src/content/docs/reference/security-model.md)
page is the short public version of this file.

## Why this matters

Flint's headline feature is that a person and their AI agent work over **one vault**: the
owner uses the desktop app, the agent runs `flint exec <alias> -- …`, and neither the
agent nor its transcript ever holds a password or a key. That only stays a strength if
reaching the vault is itself controlled. A caller that can run `flint` without being asked
can run commands on every host in the vault, even though it never sees a credential.

## Who we protect against

| | Who | Example |
|---|---|---|
| **A** | A person at the owner's unlocked computer | Someone at home or in the office |
| **B** | Another program running as the owner | Malware, a malicious `npm install` script, a compromised editor extension |
| **C** | An agent the owner started | Claude Code, Codex, a script. Trusted in general, but it can be steered by prompt injection (instructions hidden in a file or page it reads) |
| **D** | Whoever copies the vault file | From a cloud-synced folder or a backup |

**D** is covered by the file format (SQLCipher over the whole file, secrets sealed again with
XChaCha20-Poly1305, the key from Argon2id; see `reference/vault-format.md`). This document is
about **A**, **B** and **C**: callers on the owner's own machine.

## What a caller can do with `flint`

`flint` never prints a stored password, key or passphrase (P6, D-036). A caller cannot take
the credentials away. What it can do is **run commands on the owner's servers**, as each
host's login user:

- read and copy files, configs and databases;
- add its own key to `~/.ssh/authorized_keys`, which keeps it in after Flint is gone and
  after the password changes (the worst case);
- leave a `crontab` entry or a user service behind;
- become root wherever the login user is `root` or has `NOPASSWD` sudo. `flint exec --sudo`
  (ROADMAP §3) asks the owner for each command, but only on hosts that need a password for
  sudo in the first place.

So the question is not "can the caller read a password" but "can the caller run `flint`
without the owner knowing".

## Today (milestone 09)

On every unlock, the CLI and the app store the vault key (the Argon2id output, never the
password) in the OS keychain: service `Flint`, account = the vault id
(`src/adapters/keychain/`). Every later `flint` command, from anyone, opens the vault with
it. `FLINT_KEYCHAIN=off` turns the cache off; then every command asks for the master
password on the terminal (or `--master-stdin`), and an agent, with no terminal, gets exit 5
`locked`.

What the OS keychain protects depends on the OS:

| OS | Can another program read the vault key? | Notes |
|---|---|---|
| macOS (Keychain, `SecItem*` from Flint's binary) | **Not without a dialog.** The item's access list names Flint's binary | An unsigned build gets a new code identity every build, so each update shows the "wants to use your confidential information" dialog again (D-020). Owners learn to click **Always Allow**, so a replaced binary would likely get the same click |
| Linux (Secret Service: GNOME Keyring, KWallet) | **Yes.** Items have no per-application access list; any program in the session can look them up (`secret-tool lookup service Flint account <id>`) | Only Flatpak's portal isolates apps, and Flint is not a Flatpak |
| Windows (Credential Manager) | **Yes**, any process running as the user | Flint has no Windows build yet (ROADMAP §7) |

And on every OS, **any program can run `flint` itself**, which then opens the vault with
the cached key. Against **A**, the keychain does nothing once access is allowed: a person
at the unlocked machine opens the app or runs `flint`.

### Why not Tether's way

Tether caches its key with `zalando/go-keyring`, which on macOS runs `/usr/bin/security`.
The item's access list then names `/usr/bin/security`, an Apple binary that never changes,
so a rebuilt Tether never shows a dialog. The price: any program can run
`security find-generic-password -s tether -w` and read the key silently, and with the
vault file that is every secret. Flint keeps the stricter macOS behaviour; the dialogs after
each update end with a signed build (one stable identity).

## The options

| | A: person | B: program | C: agent | Ease | Same on macOS, Linux, Windows |
|---|---|---|---|---|---|
| 1. Today: the key always in the OS keychain | ✗ | ✗ (macOS: the key is safe, `flint` is not) | No control | Highest | ✗ |
| 2. Never remember (KeePass default) | ✓ | ✓ | Cannot work | Low | ✓ |
| **3. Flint holds the session and grants access** | ✓ with auto-lock and a window lock | ✓ with approval | ✓ scoped, expiring | High after one approval | ✓ |

Option 3 is the model of 1Password's CLI and desktop app, of `ssh-agent` and of sudo's
timestamp. **Chosen (D-038).**

## The model

### Layers

1. **Flint grants access, not the OS keychain.** The unlocked vault key lives only in the
   memory of a running Flint: the desktop app, or later `flint serve` (ROADMAP §5). It is
   zeroed on lock. The access decision is Flint's own, so it is the same on every OS and
   can say *who* asks and *for what*, which no OS keychain dialog can.
2. **The CLI is a client.** `flint` no longer opens the vault file with a cached key. It
   asks the running Flint over a local socket (a Unix socket in the config folder, mode
   0600; a named pipe on Windows) and Flint runs the use case.
3. **Callers are approved.** Flint identifies the caller from the socket (peer uid and pid,
   then the executable and its parent chain: "`flint` started by `claude`") and, the first
   time, shows its own window: *"`flint` CLI, started by Claude Code, wants to use the vault
   Homelab: hosts in @homelab, for 1 hour. Deny / Allow"*. A grant is scoped (hosts or
   groups, actions such as exec or read) and expires. Tokens (`flint token create`) are the
   same grant handed to a process that is not a child of a terminal.
4. **Locks.** The vault locks after a configurable idle time, on screen lock and on sleep.
   **Two locks** in the tray: closing the window leaves Flint in the menu bar or system tray
   with the vault still serving approved grants, but the **window** is locked. Opening it
   asks for the master password (or Touch ID / Windows Hello), so a person at the machine
   gets nothing from a Flint running in the background.
5. **Remember on this computer** becomes a checkbox at unlock, off by default. On, the
   vault key goes into the OS keychain so **Flint** reopens without the master password
   (behind Touch ID where available). It no longer means "any program opens the vault": the
   CLI still goes through Flint and its approvals. The checkbox says both sides in place:
   *"Flint, the `flint` CLI and the agents you approve open this vault without the master
   password. Anyone using this computer while it is unlocked can open Flint too."*
6. **Privileged steps are approved one by one.** `flint exec --sudo` shows the exact command
   in the same approval window (D-036).
7. **An activity log** records what each grant ran, shown in the app (ROADMAP §3).

### Flows

- **First open.** The app asks for the master password. Not negotiable.
- **Normal day.** The owner keeps Flint open (or in the tray). The agent runs
  `flint exec …`; the first call shows the approval window; later calls within the grant
  run with no prompt.
- **The CLI with Flint closed.** `flint` starts the app on its unlock screen, which names
  the caller: *"`flint` CLI, started by Claude Code, wants to use your vault"*. One step
  unlocks and approves. A person at a terminal can instead type the master password for a
  single command (today's behaviour, no cache written). An agent with no terminal gets
  `locked` with a message to open Flint.
- **Back from the tray.** Opening the window asks for the master password or Touch ID; the
  approved grants keep working while the window is locked.
- **Touch ID without signing.** Asking macOS to confirm presence (`LAContext`) needs no
  signature: it can unlock the window and approve a caller on an unsigned build. What
  needs a signed build is a Keychain item that only Touch ID releases
  (`SecAccessControl`, ROADMAP §4); until then "Remember" keeps today's Keychain dialog
  once per update.

### What it costs

- Work: a local socket server in the app, a client mode in the CLI, caller identification
  per OS, the approval window, grants and tokens, idle/screen/sleep locks, a tray icon.
  Several may need cfire support (local sockets with peer credentials, a tray icon in
  `ext:webui`); gaps go to `docs/cfire-upstream.md` as they are found.
- Friction: one approval per agent session, and Flint must be open for the CLI to work
  without the master password.
- `flint serve` moves from `later` to `next`: it is the base, not an extra.

## Order of work (proposed for the next spec)

1. **Flint holds the session:** local socket, the CLI as a client, unlock asked for by the
   CLI, idle/screen/sleep auto-lock.
2. **Caller approval:** the approval window, scoped and expiring grants, tokens, the
   activity log.
3. **Tray and presence:** the tray with the window lock, Touch ID / Windows Hello / polkit
   for the window and approvals, the "Remember on this computer" checkbox with its warning.
4. **`flint exec --sudo`** on the same approval window.

The MCP server (ROADMAP §3) sits on top of grants and tokens.

## What the docs say until then

The site is honest about today: agents reach servers by alias and never see a credential,
but with the key cached, any program that runs `flint` can do the same, and on Linux (and
Windows) any program in the session can read the cached key. The ways to narrow it today:
a separate vault holding only the hosts an agent may use, with the owner's main vault not
cached on that machine (`flint --vault <main> vault lock` when done, or the app started
with `FLINT_KEYCHAIN=off`), and server-side limits (no root logins, no `NOPASSWD`).
