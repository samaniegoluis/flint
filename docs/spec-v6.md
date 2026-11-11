# Flint — v6 Technical Specification: Tunnels

**Scope of this document:** version 6 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files)
and [`spec-v5.md`](./spec-v5.md) (Between servers); everything beyond v6 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v5 shipped (milestones 18-20, [`build-log.md`](./build-log.md)): files move between two
servers through Flint, and a tab splits into up to four panes. Flint still cannot reach a
service that only listens inside a server:

- **No tunnels.** Reaching `db1`'s Postgres or a panel bound to `localhost` on a server
  means leaving Flint for `ssh -L` with a key on disk, which the vault was meant to avoid.
  Tether, which Flint replaces, has local forwards saved per host; Flint is the one gap
  left in parity with it (ROADMAP §1). An agent cannot open one under a grant either.
- **Tether's importer has no audience left.** The owner has moved his vault to Flint, and
  he was Tether's only user. The importer keeps libargon2 and the one exception to P4
  (D-034) alive for nothing.
- **v5 left debts in the tests and the layout.** gui-e2e on macOS freezes in its vim step
  (2 runs in 12 on `main`), a wait that times out late never reports which check failed,
  and the Files view in a narrow window is drawn behind the terminal.

v6 pays the debts first, then adds local port-forward tunnels saved per host, in the core,
the CLI and the app, and removes the Tether importer.

## Scope

**In scope (v6), macOS and Linux:**
- **v5 debts** (milestone 21): the Files view under 1040 px wide drawn with its own
  background, above the terminal and below the title bar; gui-e2e's vim step isolated so a
  freeze in it cannot hang the rest of the run; a wait that times out late reports the
  check that failed. The owner's Zorin check of `Ctrl+Alt+D` and `Ctrl+Alt+1-4` (M20).
- **Tunnels saved in the host**: a host holds any number of local forwards, each with a
  name, a local port, a destination as seen from the server (`localhost:5432` by default,
  or another machine on its network) and *Open when I connect*. A tunnel uses its host's
  login, credentials and jump hosts; there is no separate tunnel entity (D-062). Stored in
  the vault through a new migration.
- **A tunnel runs on its host's own session with no terminal** (the piece built for the
  second Files pane in M19): one login per host carries all of that host's running
  tunnels, independent of any tab. Closing a tab, or its session dropping, leaves the
  tunnels up; a tunnel needs no tab (D-062). The listener binds `127.0.0.1` only.
- **Three ways to open, all from the same host:** SSH only (connect as today); SSH and
  tunnels (connecting starts the host's *Open when I connect* tunnels, and the session
  toolbar's *Tunnels* menu toggles each); tunnels only (the Tunnels view, the palette
  action *Start tunnel <name> on <host>*, or `flint tunnel up`), with no terminal.
- **`flint tunnel`**: `add`, `edit`, `rm`, `ls` for the saved tunnels (as `flint host`
  edits hosts), and `up`, `down`, `status` for running ones, through the app's socket,
  with `--json` (P7). `up` needs a grant whose `exec` scope covers the host, or one
  approval window naming the host, the local port and the destination. With the app
  closed, `up` fails with `locked`: a tunnel needs a process that stays. Every `up` and
  `down` in the activity log.
- **Tunnels in the app**: the host editor's *Tunnels* section; a *Tunnels* view in the
  rail listing every tunnel by host with a switch and its state (`listening
  127.0.0.1:5432 · 2 connections`, `port in use`, `connection lost`); a mark on a host's
  tab while it has tunnels up. Needs new Claude Design screens (message 7).
- **Remove `flint import tether`** (milestone 24): the command, its Settings → Vault entry,
  libargon2, the Tether fixture and their tests, the docs pages. P4 loses its exception.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6).

**Out of scope (v6), tracked in the roadmap:** remote (`-R`) and dynamic (`-D`, SOCKS)
forwards; a tunnel that runs with the app closed (`flint serve`); binding beyond loopback;
Flint's own vault export / import (it replaces the Tether importer later); the side panel
pinned or floating (§6, design message 6); `flint agent`; restoring sessions or tunnels on
relaunch; Windows; the remote vault (D-050).

## Stack

Unchanged from v5. Milestone 24 drops **libargon2**, which only the Tether importer used
(D-034).

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-060) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal, as in v5. v6 adds tunnels to the domain, a session with no terminal that
carries a host's tunnels, and a local listener port.

```
 drivers        GUI (webui + React: host editor Tunnels,    socket server   CLI (socket
                Tunnels view, toolbar menu)                  (in the app)    client)
                        │                                         │
 application     use cases: … v5 …, SaveTunnel, StartTunnel, StopTunnel, TunnelStatus
                        │
 domain          … v5 …, Tunnel (host, name, local port, destination, open on connect)
                        │  ports
 ports           … v5 …, TunnelTransport (forward channel over a link), LocalListener
                        │
 adapters        … v5 … · libssh direct-tcpip (already used for jump hosts) · TCP listener
```

Contracts (v5's stand; new ones are marked):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to the SSH transport at connect
  time. Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes, transfer progress and tunnel state travel
  through `EventSink` and stdio, never as RPC return values.
- **Per-machine state lives in the config folder, never in the vault** (D-030).
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **One holder of an unlocked vault** (v3). Lock zeroes the key and ends every grant.
- **SFTP rides an SSH session** (D-053, D-055). A transfer is a use case with an id.
- **A pane is a session, a tab is a layout** (D-061).
- **(new) A tunnel is a host's, not a tab's.** A host's running tunnels share one session
  with no terminal, opened on the first `StartTunnel` and hung up when its last tunnel
  stops. No tab, pane or Files view ever carries a tunnel.
- **(new) One forward channel per accepted connection.** Each local TCP connection the
  listener accepts opens its own `direct-tcpip` channel to the destination; closing either
  side closes both. Stopping a tunnel closes its listener and every live connection.
- **(new) A listener binds loopback only.** `127.0.0.1` (and `::1` where asked); the
  address is not configurable in v6.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. Unchanged
from v5, except P4 once milestone 24 ships.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, keychain, files).
2. No business logic in drivers: a GUI binding, socket handler or CLI command body only
   parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens
   and random secrets go through libsodium only. **One exception (D-034), until milestone
   24 removes it:** reading a Tether vault derives its key with the reference libargon2,
   confined to `adapters/vault/tether.cf`.
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
8. Every network operation (dial, auth, exec, SFTP request, forward channel open) and every
   socket request has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.
11. **(owner review)** The CLI never opens a vault with a key it did not derive from a
    master password typed for that command: it goes through the app's socket, or the
    person types the password. The socket is mode 0600 in the config folder, and a peer
    whose uid differs from the app's is refused before any request is read.
12. Every request on the socket is checked against a live grant or token before its use case
    runs. A privileged step (`--sudo`) is approved one by one, never by a grant.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v5.

**Owner walkthroughs use a copy of a vault**: a build with migration 007 writes a vault an
older Flint refuses.

**Design first:** milestone 23 needs screens the design lacks: the host editor's Tunnels
section, the Tunnels view, the session toolbar's Tunnels menu, a tab with tunnels up and
the approval window for `flint tunnel up`. Message 7 in
[`design-prompt.md`](./design-prompt.md) covers them and is applied to `docs/design/`
before 23 is built; 22's approval window may use 16a's layout until then.

| # | Milestone | Delivers |
|---|---|---|
| 21 | **v5 debts** | The Files view in a window under 1040 px wide opens with its own background, above the terminal and below the title bar, checked in the real app at 900 px. gui-e2e's vim step runs on its own (its own page or run), so a freeze in it fails that step by name and the rest of the suite still reports; a wait that times out late reports the failed check instead of an empty verdict (ROADMAP §5, §6). The owner's Zorin check of `Ctrl+Alt+D` and `Ctrl+Alt+1-4` reaching Flint (M20) |
| 22 | **Tunnels in the core and the CLI** | Migration 007: tunnels per host (name, local port, destination host and port, open on connect), with names unique per host. `SaveTunnel`, `StartTunnel`, `StopTunnel`, `TunnelStatus` over a host's session with no terminal, one `direct-tcpip` channel per accepted connection, a loopback listener, timeouts on dial and channel open (P8), `port_in_use` as a stable error. `flint tunnel add\|edit\|rm\|ls` and `flint tunnel up\|down\|status <host>:<name>` through the socket, `--json`; `up` under a grant whose `exec` scope covers the host, or one approval window naming host, local port and destination; `locked` with the app closed. Every `up` and `down` in the activity log. Starts with a spike: two connections through one tunnel on Zorin's libssh 0.10 while a terminal on the same host runs. Docs, the CLI demo and its tour, the agents guide |
| 23 | **Tunnels in the app** | The design's tunnel screens: the host editor's *Tunnels* section (add, edit, remove, *Open when I connect*); the *Tunnels* view in the rail with every tunnel by host, a switch and its live state; the session toolbar's *Tunnels* menu with a check per tunnel; connecting a host starts its *Open when I connect* tunnels; the palette actions *Start tunnel <name> on <host>* and *Stop tunnel …*; a mark on a host's tab while it has tunnels up. Prompts for the tunnel session (password, unknown host key) as a connect does. Docs, the landing ("What's next" loses tunnels; a screenshot if it earns a place, asked at plan time), `shots:gui` |
| 24 | **Remove the Tether importer** | `flint import tether`, its Settings → Vault entry, `adapters/vault/tether.cf`, the domain and application code, libargon2 (build, installer docs, the Linux image), the Tether fixture and tests, and the docs pages go. P4 loses its exception, recorded as a decision that supersedes D-034 (1). The CLI demo and the landing drop any mention. A vault imported from Tether before keeps working: nothing in the vault format depends on the importer |

## Open questions

- **Locking the vault with tunnels up**: do they stop with the lock (as grants end), or
  keep running as open terminals do? Settle at 22's plan, after checking what lock does to
  open sessions today.
- **A tunnel's session dropping**: the listener stays and the next accepted connection
  redials, or the tunnel shows `connection lost` and waits for a switch. Settle at 22's
  plan.
- **A host with 2FA or keyboard-interactive auth** asks twice when its terminal and its
  tunnels both run (two logins, D-062). Accepted for v6; revisit if it bites.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
