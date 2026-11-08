# Flint — v4 Technical Specification: Files

**Scope of this document:** version 4 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver) and
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault); everything beyond v4 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v3 shipped (milestones 11a-14, [`build-log.md`](./build-log.md)): the running Flint holds
the vault, and the CLI and agents reach it only through approved grants and tokens. Two
gaps remain in daily use:

- **Moving a file still needs another tool.** Tether has an SFTP browser and Flint does
  not, so the owner opens `scp` or Tether to send a config or fetch a log. `scp` uses keys
  on disk, which the vault was meant to replace. An agent has no way to copy a file under
  a grant, so it falls back on `exec cat` or a heredoc.
- **An approval is given on half a command.** The approval window and the activity log cut
  every command at 160 characters, so an agent's long `exec` is approved and logged
  half-seen. Under a grant the log is the only record (D-049). The log also keeps the
  newest 10,000 entries, which says nothing about how far back it goes.

v4 shows and keeps whole commands, then adds SFTP: `flint cp` between this machine and a
host, and a **Files** view in the app over the session's own connection, as Tether has.

## Scope

**In scope (v4), macOS and Linux:**
- **Whole commands** in the approval window and in Settings → Activity: a modal with the
  full command (capped at 16 KB, marked *truncated* beyond it), Copy and Close, with no
  presence check to view it (D-049). Older entries stay cut.
- **Activity retention by days** per vault: 30 days, 90 days (default), 1 year, no limit,
  stored in the vault, pruned at unlock and on each write, with a fixed size cap as a
  safety net. Shortening it asks first and says how many entries go. Replaces "the newest
  10,000" (D-046).
- **SFTP in the core** through libssh, behind a port, with the use cases list, stat,
  upload, download, rename, remove and mkdir.
- **`flint cp`** between this machine and one host, by alias, in either direction, with
  `-r` for folders, progress on stderr and `--json`. It runs through the app's socket under
  a grant's `exec` scope (D-051), or with a typed master password, like `exec`. Every copy
  goes into the activity log.
- **The Files view** (design screens 14a-c, D-011): a sidebar view that follows the active
  session tab, over that session's connection. Breadcrumb, `..`, a file list (name, size,
  modified), a context menu (download, rename, delete, new folder), an upload button, a
  drop zone for files dragged in from the OS, a transfer queue with per-file progress,
  cancel and *Clear done*, the no-session state, and **Go to the terminal's folder** from
  OSC 7.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6). SFTP leaves the landing's "What's next".

**Out of scope (v4), tracked in the roadmap:** **`flint cp` remote ↔ remote** and the
**two-pane copy between servers** in the app (a milestone of their own, roadmap §2 and §6);
quick-edit of remote files; tunnels; `flint agent`; split panes; `flint serve`; Windows;
the remote vault (D-050).

## Stack

Unchanged from v3.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-037) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal, as in v3. v4 adds one port (SFTP) and its use cases, a streamed socket request
for `flint cp`, and the Files view as a GUI driver.

```
 drivers        GUI (webui + React, Files view)   socket server (in the app)   CLI (socket
                        │                                 │                    client, or
 application     use cases: … v3 …, ListDir, StatPath, Upload, Download,       one-command
                 RenamePath, RemovePath, MakeDir, Copy (cp), PruneActivity      unlock)
                        │
 domain          … v3 …, RemotePath, FileEntry, Transfer, RetentionPolicy
                        │  ports
 ports           … v3 … · SftpTransport · LocalFiles
                        │
 adapters        … v3 … · libssh_sftp · local_fs
```

Contracts (v3's stand; new ones are marked):
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
- **(new) SFTP rides an SSH session.** The Files view opens its SFTP channel on the active
  tab's session, so it needs no second login (as in Tether). `flint cp` opens its own
  session, the same way `exec` does. How a channel shares a libssh session with the
  terminal's reader is settled by M16's spike (see Open questions).
- **(new) A transfer is a use case with an id.** Upload and download report progress
  through `EventSink`, can be cancelled, and write a download to a temporary name in the
  destination folder, renamed only once it is complete.
- **(new) The socket's streamed mode carries `cp`**: file bytes for uploads from the CLI,
  progress and the result back. The CLI's output and exit codes are the same through the
  app or with a typed master password.
- **(new) Retention is a vault setting.** The activity log is pruned by age in the same
  savepoint that writes an entry, and at unlock.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. Unchanged
from v3 but for 12, whose milestone qualifier no longer applies.

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
`docs/build-log.md`, not here. Numbering continues from v3.

**Owner walkthroughs use a copy of a vault**: a build without a migration refuses a vault
written by a newer Flint.

| # | Milestone | Delivers |
|---|---|---|
| 15 | **Whole commands and retention by days** | D-049. The CLI sends the whole command to the app (capped at 16 KB, marked *truncated* beyond it); the approval window keeps the short summary, says when it was cut ("+N more characters") and has **Show full command**; Settings → Activity stores the whole command and opens an entry's detail on click or Enter (exact time with seconds, full caller chain, via, token, host, outcome, command). One shared modal: monospace, wrapped, scrollable, **Copy** and **Close** (Esc, a click outside), focus back where it was; no presence check to view it. **Retention by days** in Settings → Activity (30 days, 90 days default, 1 year, no limit), stored in the vault, pruned at unlock and on each write, a fixed size cap (about 50 MB) as a safety net; shortening it asks first with the number of entries that go; a CLI equivalent named at plan time. The whole command never leaves the vault and the app (P5). The `caller_summary` test, the access pages in `site/`, the CLI demo if the CLI changes, and `shots:gui` if a changed screen is on the landing |
| 16 | **SFTP in the core and `flint cp`** | **Spike first:** an SFTP channel through libssh from cfire on macOS and Linux, and whether it can share a session with a running PTY channel (the Files view needs it in 17); gaps to `docs/cfire-upstream.md`. The `SftpTransport` port and its adapter; the use cases list, stat, upload, download, rename, remove, mkdir, with timeouts (P8), cancel, and downloads written to a temporary name then renamed. **`flint cp <src> <dst>`** with `alias:/path` on one side and a local path on the other, `-r` for folders, progress on stderr (silent when stderr is not a terminal), `--json` with the files and bytes copied, stable errors (not found, permission denied, exists, not a directory). Through the socket under a grant's `exec` scope, the approval window saying *copy files* with the direction, host and paths; with a typed master password when the app is closed. Every copy in the activity log. Docs, the CLI demo and the agents guide updated |
| 17 | **The Files view** | Design screens 14a-c: a sidebar view (⌘E, the toolbar's Files button) that follows the active session tab, over that tab's connection. Breadcrumb, `..`, refresh, a file list (name, size, modified); a context menu with download, rename, delete (asks first), new folder; an upload button and the drop zone for files dragged in from the OS (`files:dropped`, CF-004); a transfer queue with per-file progress, cancel and *Clear done*; the no-session state (14c). **Go to the terminal's folder** from OSC 7, disabled with a hint when the shell sends none, and the docs say how to enable it. Downloads go through a save dialog. Docs, the landing (SFTP leaves "What's next"; a Files screenshot if it earns a place, asked at plan time) and `shots:gui` |

## Open questions

- **SFTP beside the terminal:** whether libssh lets an SFTP channel share the session the
  PTY's reader thread uses, or the Files view needs a second session on the same host
  (a second login, which prompts again for keyboard-interactive hosts). Settle at 16's
  spike.
- **Retention on the CLI:** the command's name and shape (`flint activity retention 90d`,
  or a flag of an existing command). Settle at 15's plan.
- **Downloads in the CLI with no destination folder** (`flint cp web:/var/log/app.log .`
  versus an implicit current folder), and what `cp` does when the destination exists
  (refuse with `exists` unless `--force`?). Settle at 16's plan.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
