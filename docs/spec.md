# Flint — v5 Technical Specification: Between servers

**Scope of this document:** version 5 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault) and [`spec-v4.md`](./spec-v4.md)
(Files); everything beyond v5 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static:
a decision that changes goes into [`decisions.md`](./decisions.md), which supersedes the
line here.

## Problem

v4 shipped (milestones 15-17, [`build-log.md`](./build-log.md)): `flint cp` and the Files
view move files between this machine and **one** host. Two gaps remain in daily use:

- **A file cannot go from one server to another.** Moving a backup from `db1` to `nas`, or
  a config from `staging` to `prod`, means downloading it and uploading it again by hand,
  or putting a key on one host so it can reach the other, which the vault was meant to
  avoid. An agent has the same problem under a grant.
- **Two sessions cannot be seen at once.** Each host lives in its own tab, so watching a
  log on one server while working on another means switching tabs.

v5 copies between two servers through Flint, in the CLI and in the app, and splits a tab
into up to four panes, each its own session.

## Scope

**In scope (v5), macOS and Linux:**
- **`flint cp` remote ↔ remote**: `flint cp a:/path b:/path`, with `-r`, `--force`,
  progress and `--json` as in v4 (D-054). The bytes go host-a → Flint → host-b, so no
  credential ever reaches a host (P6). Two SFTP sessions at once, each with its own login
  and jump hosts. Through the app's socket under a grant's `exec` scope covering **both**
  hosts, asked for in **one** approval window that names both (D-056), or with a typed
  master password. Every copy in the activity log.
- **Stale part files**: a copy cut part-way (a dropped channel, Ctrl-C) may leave
  `.<name>.flint-part` on a host; the next copy of that name to that folder removes it
  first (roadmap §5).
- **Copy between servers in the app**: a button in the Files view picks a second server
  and shows two panes side by side, each a server, with drag from one to the other over
  the same use case as `flint cp` remote ↔ remote. A server with no open tab gets its own
  session with no terminal (D-056). As in v4, the window's own transfers are not logged
  (D-055).
- **The Files view opens on the terminal's folder** by itself when the shell has reported
  one through OSC 7: only when the view opens, never following each `cd` while it is open
  (D-056). Without OSC 7 nothing changes.
- **Split panes**: up to four panes in a tab (side by side, stacked, 2×2, one large + two
  small), opened with `⌘D` / `⌘⇧D` (Ctrl+Shift on Linux), the session toolbar's Split
  button and a palette action *Open <host> in a new pane*. Each pane is its own SSH session
  with its own reconnect; one dropping leaves the others alone. Focus moves between panes
  by click and shortcut; the Files view follows the focused pane.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6).

**Out of scope (v5), tracked in the roadmap:** a direct host-to-host route (keys or agent
forwarding on a host); broadcast input and workspaces (they build on split panes, block 8);
restoring open sessions and layouts on relaunch; `flint cp -p`; tunnels; `flint agent`;
removing `flint import tether`; `flint serve`; Windows; the remote vault (D-050).

## Stack

Unchanged from v4.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-044) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal, as in v4. v5 adds a relay copy use case over two SFTP sessions, a session with
no terminal for the app's second pane, and panes as a GUI concern over the existing
per-session workers.

```
 drivers        GUI (webui + React: Files with two panes,   socket server   CLI (socket
                split panes)                                 (in the app)    client, or
                        │                                         │          one-command
 application     use cases: … v4 …, RelayCopy (remote → remote)              unlock)
                        │
 domain          … v4 …, RelayTransfer (source host, destination host)
                        │  ports
 ports           … v4 … (SftpTransport opened twice; no new port expected)
                        │
 adapters        … v4 … · libssh_sftp (a session with no PTY channel)
```

Contracts (v4's stand; new ones are marked):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to the SSH transport at connect
  time. Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes and transfer progress travel through
  `EventSink` and stdio, never as RPC return values. The caller mints the session or
  transfer id and subscribes before starting.
- **Per-machine state lives in the config folder, never in the vault** (D-030).
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **One holder of an unlocked vault** (v3). Lock zeroes the key and ends every grant.
- **SFTP rides an SSH session** (D-053, D-055). The Files view uses the tab's own session.
- **A transfer is a use case with an id**, reports progress through `EventSink`, can be
  cancelled, and writes to `.<name>.flint-part`, renamed once complete.
- **(new) A relay copy streams, it does not stage.** Bytes read from the source's SFTP
  channel are written to the destination's as they arrive, in bounded chunks; nothing is
  written to this machine's disk. Cancel or a failure on either side removes the
  destination's part file while its channel is alive.
- **(new) A pane is a session, a tab is a layout.** Each pane owns one session worker,
  exactly as a v4 tab does; the tab holds only the layout (up to four panes) and which
  pane has focus. Closing a tab hangs up each of its sessions.
- **(new) A session with no terminal** serves the app's second Files pane when that host
  has no open tab: a login and an SFTP channel, no PTY, hung up when the pane closes.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. Unchanged
from v4.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, keychain, files).
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
8. Every network operation (dial, auth, exec, SFTP request) and every socket request has an
   explicit timeout.
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
`docs/build-log.md`, not here. Numbering continues from v4.

**Owner walkthroughs use a copy of a vault**: a build without a migration refuses a vault
written by a newer Flint.

**Design first:** milestones 18-20 need screens the design lacks: the approval window
naming two hosts (a variant of 16f), the Files view with two panes (beside 14a-c) and split
panes. One Claude Design run covers all three, message 5 in
[`design-prompt.md`](./design-prompt.md), and is applied to `docs/design/` before 18 is
built.

| # | Milestone | Delivers |
|---|---|---|
| 18 | **`flint cp` remote ↔ remote** | `flint cp a:/path b:/path` with `-r`, `--force`, progress on stderr and `--json`, the destination rules and error codes of D-054. The `RelayCopy` use case over two SFTP sessions opened at once (each with its own login and jump hosts), streaming source → destination in bounded chunks with nothing written locally, per-request timeouts (P8), cancel, and the destination's part file removed on cancel or failure. Through the socket: one approval window naming both hosts and paths (the design's 16f variant), a grant whose `exec` scope covers both hosts, or an existing grant only if it covers both; with a typed master password when the app is closed. Every copy in the activity log. **Stale part files:** a copy removes an old `.<name>.flint-part` of the same name in the destination folder before it starts (local ↔ remote too). Docs, the CLI demo and its tour, the agents guide |
| 19 | **Copy between servers in the app** | The design's two-pane screens: a button in the Files view picks a second server (vault hosts, with a filter), and the view shows two panes side by side, each with its own breadcrumb, `..`, refresh and list. Drag a file or folder from one pane to the other (and a context-menu *Copy to <other host>*), running `RelayCopy` with the transfer queue, per-file progress, cancel and Replace / Skip on an existing name. The second server uses its open tab's session if it has one, otherwise a session with no terminal (prompts as a connect does), hung up when the pane closes. Not logged (D-055). **The Files view opens on the terminal's folder** when the session has reported one by OSC 7, only at opening; otherwise where it was or the login folder, as in v4. Docs, the landing (a screenshot if it earns a place, asked at plan time), `shots:gui` |
| 20 | **Split panes** | The design's split-pane screens: up to four panes in a tab as side by side, stacked, 2×2, or one large + two small; split with `⌘D` / `⌘⇧D` (the Linux chords named at plan time), the session toolbar's Split button and the palette action *Open <host> in a new pane*. Each pane its own session worker with its own connecting, auth-failed and connection-lost states and reconnect; closing a pane hangs up its session, closing the tab hangs up all. Focus by click and shortcut, a visible focused pane, resize by dragging the divider. The Files view, OSC 7 and the tab title follow the focused pane. Docs, the landing ("What's next" loses split panes), `shots:gui`. May split into 20a (layout and sessions) and 20b (shortcuts, palette, resize) at plan time |

## Open questions

- **A relay copy's throughput and memory**: the chunk size and how many reads are in
  flight between the two SFTP channels, given libssh 0.10 on Zorin (no `sftp_aio`, writes
  split to 32 KB, D-053). Settle at 18's plan with a measurement.
- **Where a remote ↔ remote copy runs when the app is closed**: in the CLI itself, with the
  typed master password, as `exec` and v4's `cp` do. Confirm at 18's plan.
- **Split pane shortcuts on Linux**, where `Ctrl+Shift+D` may clash with the terminal's own
  keys; and whether panes are equal by default or keep the ratio last dragged. Settle at
  20's plan.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
