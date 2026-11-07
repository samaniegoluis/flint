# Flint — v3 Technical Specification: Flint holds the vault

**Scope of this document:** version 3 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP) and [`spec-v2.md`](./spec-v2.md) (daily driver);
everything beyond v3 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a
decision that changes goes into [`decisions.md`](./decisions.md), which supersedes the line
here. The design behind v3 is [`vault-access-model.md`](./vault-access-model.md) (D-038).

## Problem

v2 shipped (milestones 06-10 and the quick wins, [`build-log.md`](./build-log.md)) and
Flint replaced Tether for daily work. AI agents and scripts now drive the `flint` CLI, and
that exposes how the vault is opened:

- **Whoever can run `flint` can use the vault.** Once a key is cached in the OS keychain,
  any program that runs `flint exec` reaches every host in the vault, with no one asked.
- **On Linux the cached key itself is readable** by any program in the session (libsecret
  does not isolate applications), and the macOS Keychain dialog cannot say *who* asks or
  *for what*.
- **An agent cannot run a privileged step.** Every `sudo` has to be handed back to the
  owner, because the password must not pass through the agent (D-036).
- **Nothing locks.** An unlocked vault stays unlocked while the app runs, and the window
  shows everything to whoever sits at the machine.

v3 makes the running Flint the only holder of an unlocked vault (D-038): the CLI and agents
ask it over a local socket, each caller is approved in Flint's own window with a scoped,
expiring grant, the owner approves each `sudo` there (D-039), and the vault and the window
lock on their own.

## Scope

**In scope (v3), macOS and Linux:**
- **The app serves the vault over a local socket** (a Unix socket in the config folder,
  mode 0600, peers of another uid refused). A vault holder that is safe across threads;
  unlock and create run off the UI thread.
- **The CLI is a client.** With the app running, every command goes through the socket,
  including `exec` and `connect` (output and the PTY stream relayed). The CLI no longer
  reads a cached key from the OS keychain.
- **The CLI asks for an unlock.** With Flint closed or locked, `flint` starts the app on its
  unlock screen naming the caller. A person at a terminal may instead type the master
  password for one command (nothing cached). Without a terminal, `flint` fails with
  `locked` and "open Flint".
- **Auto-lock** after a configurable idle time, on screen lock and on sleep; the key is
  zeroed on lock.
- **Caller approval:** the caller identified from the socket (uid, pid, executable, parent
  chain), an approval window in the app, grants scoped to hosts or groups and actions and
  expiring, `flint token create` for processes that are not children of a terminal, an
  **activity log** of what each grant ran, and a **presence check** (Touch ID through
  `LAContext` on macOS, polkit on Linux) to approve.
- **`flint exec --sudo -- <argv>`** run by the app and approved in the same window (D-036,
  D-039), with a per-host sudo password field.
- **Tray with two locks:** closing the window keeps Flint in the menu bar / system tray,
  still serving approved grants, with the window locked until the master password or
  Touch ID. **Remember on this computer** at unlock, off by default, with its warning;
  replaces the always-on key cache of D-005.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6); the site's "today / next" for agents (M10) becomes "today".

**Out of scope (v3), tracked in the roadmap:** `flint serve` (the headless holder); Windows
(named pipe, Windows Hello); a Keychain item released only by Touch ID (needs a signed
build); per-host policies and command allowlists; the MCP server; `flint agent`; SFTP;
tunnels; vault sync, snapshots and master-password change; split panes, snippets and the
rest of section 6.

## Stack

Unchanged from v2.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-037) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. From M14 used only by *Remember on this computer* | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal, as in v2. v3 adds a driver (the socket server inside the app), turns the CLI
into a client of it, and adds the ports for callers, presence and system lock events.

```
 drivers        GUI (webui + React)   socket server (in the app)   CLI (socket client,
                        │                       │                   or one-command unlock)
 application     use cases: OpenVault, UnlockVault, LockVault, Host/Key/Cred CRUD, Connect,
                 Exec, ExecSudo, TestConnection, RevealSecret, RenameVault, ImportTether,
                 ApproveCaller, CreateToken, RecordActivity
                        │
 domain          Vault, Group, Host, SSHKey, Credential, KnownHost, AuthMethod,
                 Caller, Grant, Token, ActivityEntry
                        │  ports
 ports           VaultStore · Crypto · Keychain · SshTransport · Terminal · EventSink · Clock
                 · SettingsStore · RecentStore · UiStateStore · Clipboard
                 · LocalSocket · CallerIdentity · Presence · SystemEvents · Tray
                        │
 adapters        sqlite_vault · sodium_crypto · keychain_{macos,linux} · libssh_transport
                 · webui_events · stdio_terminal · unix_socket · peer_{macos,linux}
                 · presence_{macos,linux} · system_events_{macos,linux} · webui_tray
```

Contracts (v2's stand; new or changed ones are marked):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to the SSH transport at connect
  time. Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes travel through `EventSink` and stdio, never as
  RPC return values. The caller mints the session id and subscribes before starting.
- **Per-machine state lives in the config folder, never in the vault** (D-030).
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **(new) One holder of an unlocked vault.** The running app owns the unlocked
  `VaultSession`; the GUI's handlers, the socket server and background work (unlock,
  create, sessions) reach it through one thread-safe holder. Lock zeroes the key and ends
  every grant.
- **(new) The socket protocol** is framed JSON requests and responses with the CLI's error
  contract (D-018), plus a streamed mode for `exec` and `connect`. The CLI's output and
  exit codes are the same whether it ran through the app or with a typed master password.
- **(new) Grants live in memory** and end on expiry, on lock and when the app quits.
  **Tokens and the activity log live in the vault** (encrypted, through a migration): a
  token is a grant with a secret handed to a process, stored as a hash (D-040).
- **Vault lifecycle (changed):**
  - *Open* means the file is known and readable. *Unlocked* means the key is held in the
    app's memory. Only the app unlocks for longer than one CLI command.
  - Startup reopens the last vault; it auto-unlocks only if *Remember on this computer* was
    ticked for it (from M14; until then, as v2).
  - The vault locks after the idle time, on screen lock and on sleep.
  - The window has its own lock in the tray (M14).

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, keychain).
2. No business logic in drivers: a GUI binding, socket handler or CLI command body only
   parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens
   and random secrets go through libsodium only. **One exception (D-034):** reading a
   Tether vault derives its key with the reference libargon2 (4 lanes, which libsodium
   cannot do), confined to `adapters/vault/tether.cf`; Tether's secrets are still opened
   with libsodium.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration.
6. **(owner review)** Secret values never appear in RPC results, socket responses, CLI
   output (`--json` included), logs or error messages. **One exception (D-029):** the GUI's
   explicit *reveal* action on a password, while the vault is unlocked, returns that one
   value to the page. *Copy* never does: the core writes it to the clipboard itself. The
   CLI has no reveal. A token's secret is shown once, at creation, to whoever created it.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec) and every socket request has an explicit
   timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.
11. **(owner review)** The CLI never opens a vault with a key it did not derive from a
    master password typed for that command: it goes through the app's socket, or the
    person types the password. The socket is mode 0600 in the config folder, and a peer
    whose uid differs from the app's is refused before any request is read.
12. Every request on the socket is checked against a live grant or token before its use case
    runs (from milestone 12; in 11a and 11b, the same-uid check of P11 is the gate).
    A privileged step (`--sudo`) is approved one by one, never by a grant.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v2.

**Owner walkthroughs use a copy of a vault**, as in v2: a build without a migration refuses
a vault written by a newer Flint.

| # | Milestone | Delivers |
|---|---|---|
| 11a | **Socket and the CLI as a client** | **Spike first:** Unix sockets with peer credentials (uid, pid) from cfire on macOS and Linux, and whether `ext:webui` can show a tray icon (for 14); gaps to `docs/cfire-upstream.md`. A **thread-safe vault holder** in the app; **unlock and create off the UI thread** (`app.bind_async`, CF-046). The app serves the socket (0600, other uid refused, P11). Every CLI command that opens no SSH session (`vault`, `group`, `host`, `key`, `cred`, `known-host`, `import`) runs through the socket when the app is running, with the same output and exit codes. Docs updated |
| 11b | **`exec` and `connect` through the app, unlock asked for by the CLI, auto-lock** | `flint exec` (stream and `--json`) and `flint connect` (PTY, resize, exit status) relayed through the app. The CLI stops reading the OS keychain. With Flint closed or locked: the app opens on its unlock screen naming the caller; a person at a terminal may type the master password for one command; no terminal → `locked`, "open Flint". **Auto-lock** (idle time in Settings, screen lock, sleep) zeroing the key. Docs, the CLI demo and the agents guide updated |
| 11c | **Move to cfire `43431f2`** | Flint pinned to cfire `43431f2` (its answer to CF-001..CF-085). Every answered entry re-run against its repro and marked in `docs/cfire-upstream.md` as it really behaves; what still fails gets the detail needed to fix it; what cfire chose not to do is marked as its decision (`declined upstream` / `deferred upstream`), not as a bug. Workarounds the new build makes unnecessary removed. All suites on macOS and Linux |
| 12 | **Caller approval** | Caller identity (uid, pid, executable, parent chain: "`flint` started by Claude Code"). The **approval window**: vault, hosts or groups, actions, duration; Deny / Allow; **grants** in memory, scoped and expiring (P12). **`flint token create|list|revoke`** (stored hashed in the vault, migration 004). The **activity log** in the vault and a view of it in the app. **Presence check** to approve: Touch ID (`LAContext`) on macOS, polkit on Linux, the master password where neither exists. Docs, landing and the CLI demo updated |
| 13 | **`flint exec --sudo`** | D-039: the CLI asks over the socket; the app runs `sudo -p <nonce> -- <argv>` on its own PTY, types the host's sudo password only at its own nonce prompt, then `sudo -k`; the approval window shows caller, host, user and exact argv with presence; no answer in ~2 min = denied. Distinct errors for *denied*, *timed out* and *not a sudoer*. **Per-host sudo password** field (defaults to the login password), offered for saving by the window. Every decision in the activity log. Docs and the CLI demo updated |
| 14 | **Tray with two locks, Remember on this computer** | Closing the window keeps Flint in the menu bar / system tray serving approved grants, with the **window locked** (master password or Touch ID to reopen). **Remember on this computer** at unlock, off by default, with the warning of `vault-access-model.md`; without it no key reaches the OS keychain, and existing cached keys are removed once (D-005 superseded). Docs, landing and security model updated |

## Open questions

- **Tray icon:** if `ext:webui` has no tray (checked in 11a's spike), 14 needs a native
  adapter or a cfire change; decide at 14's plan.
- **Screen lock and sleep on Linux:** which signals to trust across desktops (logind's
  `Lock`/`PrepareForSleep` over D-Bus, the session's screensaver). Settle at 11b's plan.
- **Caller identity on macOS:** the parent chain through `proc_pidinfo` / `sysctl`, and what
  to show when a parent has exited. Settle at 12's plan.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
