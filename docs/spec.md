# Flint — v7 Technical Specification: Paste into the terminal

**Scope of this document:** version 7 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers) and [`spec-v6.md`](./spec-v6.md) (Tunnels);
everything beyond v7 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a
decision that changes goes into [`decisions.md`](./decisions.md), which supersedes the line
here.

## Problem

v6 shipped (milestones 21-24, [`build-log.md`](./build-log.md)): tunnels saved per host,
and the Tether importer is gone. The owner now uses Flint every day, and the one thing he
misses most is Tether's **image paste**:

- **An agent on a server cannot see the screen.** The owner works with Claude Code running
  on a server inside a Flint tab: it guides him through something, and he answers with
  screenshots. Claude Code reads an image (or any file) from a path, but the file has to be
  *on the server*. Today pasting an image into Flint's terminal does nothing.
- **Tether did it, unsafely.** It wrote the bytes to `/tmp/tether-<uuid>.<ext>` on the
  server with default permissions (world-readable), never cleaned them up, and swallowed
  every error.
- **Files only arrive through the Files view.** Dropping a PDF or a CSV onto the terminal
  to hand it to the agent means opening Files, uploading, and typing the path by hand.
- **Unexplained test freezes cost time.** gui-e2e on macOS freezes in its vim step and
  after one more tab (M21, M23). Both are worked around, not understood, and each attempt
  to find them reran a whole suite for ten minutes.

v7 makes a pasted image land on the server and its path land in the terminal, does the
same for files dropped onto the terminal, and hunts the test freezes with the window
visible.

## Scope

**In scope (v7), macOS and Linux here; Windows checked by the owner** (see below):
- **Paste an image** (milestone 25): on a paste whose clipboard holds an image and no
  `text/plain`, Flint writes the image **on the server** over the focused pane's own SFTP
  session (D-053, D-055; jump hosts included) and pastes its path as text, inside
  bracketed paste, into that pane. Nothing is typed after it (no Enter). A clipboard that
  carries text too (spreadsheet cells, an app that puts a picture beside the text) pastes
  the text. Works the same in split panes: each pane uses its own session.
- **Where the file lands:** `~/.cache/flint/paste/`, created `0700`, the file `0600`; or
  `/tmp/flint-<uid>/` at `0700` when the home folder is not writable. The file keeps a
  cleaned version of its name (a screenshot with no name gets `paste-<time>.png`), inside
  a short unique sub-folder so two pastes never collide. Each paste removes that folder's
  entries older than 24 h; nothing is removed at session close (a multiplexed agent may
  read the path later).
- **A size limit, set per machine** in Settings → Terminal: *Largest file to paste*, one of
  10, **20 (default)**, 50 or 100 MB (per-machine state, D-030). Over it, the paste fails
  with the size and a pointer to the Files view, which has no limit and a progress bar.
- **Visible progress and errors:** a short notice while it uploads (*Pasting image to
  codebox…*), and the reason when it fails (no SFTP on the server, permission denied, too
  large, timeout). Never a silent failure. The upload has the SFTP timeout (P8).
- **Files dropped onto the terminal** (milestone 26): one or more files of any type dragged
  from Finder or the file manager onto a pane go the same way, and their paths are pasted
  separated by spaces, quoted when they need it. Reuses the Files view's drop path
  (`readDrop`, `files_stage`, D-055). No type filter.
- **A file copied in Finder or the file manager** (⌘C on a file, then paste in the
  terminal) goes the same way **only if milestone 25's spike shows it works on macOS,
  Linux and Windows**: all or none. Otherwise it goes to the roadmap as `later`, and the
  drop covers files.
- **Test freezes** (milestone 27): gui-e2e on macOS can run with its window visible
  (likely the new default there, decided by the experiment); `scripts/repeat.sh` runs one
  isolated step N times and reports a failure rate; an experiment, hidden against visible,
  on the vim freeze and the one-more-tab freeze. Time-boxed with the owner: if no cause is
  found, what was learned is written down and the milestone closes.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6). v7 adds nothing to the CLI, so the demo should not change.

**Windows:** the owner runs Flint on Windows from a branch of his own over a patched cfire,
whose changes are being folded into cfire upstream; that branch takes everything from
`main`. Windows stays out of this repo's verification until it merges, but v7's features
are designed for it too (WebView2 is Chromium, not WebKit: the spike asks what each
webview gives), and the owner checks them on Windows at each milestone's close.

**Out of scope (v7), tracked in the roadmap:** dropping or pasting folders onto the
terminal (the Files view takes folders); pasting into the CLI (`flint connect` runs in the
person's own terminal); recording pastes in the activity log (as the window's own copies,
D-055); anything that changes with the program on the server (Flint pastes a path, the
same for Claude Code or a shell); choosing which monitor the e2e window opens on; embedded
RDP (the next spec); the remote vault; `flint agent`.

## Stack

Unchanged from v6.

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

Hexagonal, as in v6. v7 adds one use case over the SFTP port that already exists; no new
port, no migration.

```
 drivers        GUI (webui + React: the terminal's paste    socket server   CLI (socket
                and drop, Settings → Terminal)               (in the app)    client)
                        │                                         │
 application     use cases: … v6 …, PasteToRemote (write a file in the paste folder,
                 prune entries older than 24 h, return the remote path)
                        │
 domain          … v6 …, paste naming and pruning rules (clean name, unique folder, age)
                        │  ports
 ports           … v6 … (SFTP, unchanged)
                        │
 adapters        … v6 … · drop staging (D-055) reused for the bytes
```

Contracts (v6's stand; new ones are marked):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to the SSH transport at connect
  time. Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes, transfer progress and tunnel state travel
  through `EventSink` and stdio, never as RPC return values.
- **Per-machine state lives in the config folder, never in the vault** (D-030). The paste
  size limit is one of these.
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **One holder of an unlocked vault** (v3). Lock zeroes the key and ends every grant.
- **SFTP rides an SSH session** (D-053, D-055). A transfer is a use case with an id.
- **A pane is a session, a tab is a layout** (D-061).
- **A tunnel is a host's, not a tab's** (D-062, D-063).
- **(new) A pasted or dropped file travels over its pane's own session.** It never opens
  a login of its own and never goes to another pane's host. The page hands over bytes (or
  a staged local file), the core writes them and returns the path; the page pastes it.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. Unchanged
from v6, with P4's exception gone (D-065).

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, keychain, files).
2. No business logic in drivers: a GUI binding, socket handler or CLI command body only
   parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens
   and random secrets go through libsodium only.
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
happen only where a human is required (see `CLAUDE.md`), plus the owner's Windows check at
each close. Progress is recorded in `docs/build-log.md`, not here. Numbering continues from
v6.

**No new design screens:** the upload notice reuses the app's existing notice style, and
the size limit is one row in Settings → Terminal.

| # | Milestone | Delivers |
|---|---|---|
| 25 | **Paste an image into the terminal** | Starts with a **spike** on macOS (WKWebView) and Zorin (WebKitGTK), with a page the owner runs on Windows (WebView2): what the paste event gives for a screenshot, an image file copied in Finder, a PDF copied in Finder; and what a drop onto the terminal gives. It settles the order among file, image and text, and whether a copied file is in v7 (all three or none). Then: an image pasted into a pane is written over that pane's SFTP session to the paste folder (`0700`/`0600`, cleaned name, unique sub-folder, `/tmp/flint-<uid>/` fallback), entries older than 24 h pruned on each paste, its path pasted inside bracketed paste; text wins when the clipboard has both. *Largest file to paste* in Settings → Terminal (10 / 20 / 50 / 100 MB, default 20). The upload notice and every failure's reason. Split panes and jump hosts. gui-e2e: a `paste` run of its own. Docs, the landing (a line where it fits, asked at plan time if not clear) |
| 26 | **Files onto the terminal** | One or more files of any type dropped onto a pane are uploaded the same way and their paths pasted, separated by spaces and quoted when needed; folders are refused with a pointer to the Files view. Built on the Files view's drop staging (D-055). If 25's spike allowed it on all three systems, a file copied in Finder or the file manager pastes the same way, and wins over the file name the clipboard also carries as text. Otherwise that item goes to the roadmap. gui-e2e on the drop. Docs |
| 27 | **Test freezes** | Time-boxed, with the owner. gui-e2e on macOS runs with its window **visible** (`FLINT_E2E_VISIBLE`, or the default if the experiment says so; hidden stays available). `scripts/repeat.sh <step> <N>` runs one isolated gui-e2e step N times and prints the failure rate. The experiment: the vim step and the one-more-tab run, 10 times hidden against 10 visible, plus a short manual check by the owner. If visible ends the freezes, it becomes the macOS default and the M21/M23 workarounds are reviewed; whatever the result, the rates and findings go into the ROADMAP entries. `repeat.sh` is the tool `CLAUDE.md` rule 9 (unexplained failures are isolated first) relies on |

## Open questions

- **A copied file on the three systems**: settled by 25's spike. It also tells whether
  WebView2 differs from WebKit for screenshots, which the owner then checks on Windows.
- **Visible e2e window as the macOS default**: settled by 27's experiment. Linux keeps
  Xvfb.
- **A host with 2FA or keyboard-interactive auth** asks twice when its terminal and its
  tunnels both run (two logins, D-062). Accepted since v6; revisit if it bites.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
