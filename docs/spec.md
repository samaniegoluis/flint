# Flint — v9 Technical Specification: Versions and a faster desktop

**Scope of this document:** version 9 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal) and [`spec-v8.md`](./spec-v8.md)
(Embedded RDP); everything beyond v9 lives in [`ROADMAP.md`](../ROADMAP.md). This file is
static: a decision that changes goes into [`decisions.md`](./decisions.md), which supersedes
the line here.

## Problem

v8 shipped (milestones 28-31, [`build-log.md`](./build-log.md)): RDP hosts live in the vault
and open in a Flint tab through FreeRDP, with the clipboard and reconnect. Two things now
stand in the way of using it every day:

- **No build says what it is.** Every binary reports `0.0.0-dev`. The owner builds Flint
  himself on macOS and on Windows (his own branch, which takes everything from `main`), and
  cannot tell which version runs on which machine, or what changed between two of them.
  Nothing records the changes for a person: the history is commits.
- **The desktop is slower than a native client.** Milestone 28 measured 20-22 frames drawn
  per second at 1920×1080 against the owner's Windows 11 host, about 29 sent by the server
  with FreeRDP's default bitmap updates (D-071); `mstsc` and Windows App reach 30-60. The
  owner's measure of success is the feeling of a VM on his own computer (ROADMAP §9), and
  the decision on a second engine for Windows (the RDP ActiveX control, D-070) waits for
  this to be done (D-073).

v9 gives every build a version and a changelog, then makes the desktop as fast as FreeRDP
and the page can make it.

## Scope

**In scope (v9), macOS and Linux here; Windows checked by the owner:**
- **Versions** (milestone 32): SemVer from `v0.1.0`, one git tag `vX.Y.Z` per release, bumped
  once per release (not per commit) from the Conventional Commits already in use: a `feat`
  since the last tag bumps the minor, only `fix`es bump the patch, `1.0.0` by hand when the
  owner calls Flint stable. The version is set from git at build time: a tagged build shows
  the tag, a build between tags `git describe`'s form (`0.2.0-3-gabc1234`), a build with no
  git `0.0.0-dev`. Shown by `flint --version` (and `--json`), the app (Settings → About) and
  the docs site.
- **A changelog** (milestone 32): `CHANGELOG.md` generated locally with git-cliff from the
  commits, grouping `feat` and `fix` and leaving out `docs`, `test` and `chore`, each
  version headed by a short summary written for a person. The release step (bump, changelog,
  tag) runs at a milestone's close in `lean-build`, by a script the owner can also run.
- **A faster desktop** (milestone 33): the RDP graphics pipeline (RDPGFX) with a codec the
  build's FreeRDP decodes, and the page drawing frames through WebGL instead of
  `putImageData`. Measured against milestone 30's tab before and after (frame rate dragging
  a window, input latency, CPU, bandwidth), with targets set at the milestone's plan. A
  server without RDPGFX keeps today's bitmap path.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6).

**Windows:** as in v8. The owner runs Flint on Windows from his own branch over a patched
cfire, checks each milestone there at its close, and carries its build changes over
(milestone 32 leaves a note on how a Windows build gets its version). Milestone 33's result
on Windows decides whether the ActiveX engine goes into a later spec (D-070).

**Out of scope (v9), tracked in the roadmap:** GitHub Releases with binaries, CI, installers,
a downloads page and self-update (§7, `later`); signing and notarization; bundling the
libraries into the app; the immersive full-screen RDP tab and the RDP security review
(§9, `next`); the RDP ActiveX engine; everything v8 left out.

## Stack

v8's, plus one row.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-060) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** (`libfreerdp3`, `libwinpr3`) via `import cpp`, core library only, frames drawn by Flint (D-070) | One engine on macOS, Linux and Windows; Apache 2.0; NLA/CredSSP, Display Control, clipboard and graphics pipeline channels | The RDP ActiveX control (Windows only: a later second adapter), handing off to the system client, writing RDP ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |
| **(new) Changelog** | **git-cliff**, run locally (a development tool, not linked) | Reads the Conventional Commits already in use; no GitHub PRs or CI needed, as the owner merges and pushes locally | release-please and semantic-release (they work through PRs or CI), a hand-written changelog |

## Architecture

Hexagonal, as in v8. v9 adds no port.

- **The version is a build input, not code.** The build passes the version string it reads
  from git into both drivers (the CLI and the app); the core takes it as data. Nothing at
  run time calls git.
- **Frames keep the local frame channel** (D-071). With RDPGFX the shim decodes into the
  same RGBA surface and dirty region; what changes is how the page draws it (a WebGL
  texture updated by region) and what the server sends. Nothing above `adapters/` knows the
  codec.

Contracts (v8's stand):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to a transport at connect time
  (SSH, RDP). Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes, transfer progress, tunnel state and desktop
  frames travel outside RPC return values.
- **Per-machine state lives in the config folder, never in the vault** (D-030).
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **One holder of an unlocked vault** (v3). Lock zeroes the key, ends every grant and closes
  every SSH and RDP session.
- **SFTP rides an SSH session** (D-053, D-055). **A pane is a session, a tab is a layout**
  (D-061). **A tunnel is a host's, not a tab's** (D-062, D-063). **The RDP engine sits
  behind one port** (v8).

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v8's,
unchanged.

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
8. Every network operation (dial, auth, exec, SFTP request, forward channel open, RDP
   connect and reconnect) and every socket request has an explicit timeout.
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
v8; milestone 33 is the one D-073 approved as "milestone 32" (D-076).

| # | Milestone | Delivers |
|---|---|---|
| 32 | **Versions and a changelog** | The version read from git at build time (tag, `git describe` between tags, `0.0.0-dev` with no git) and passed into the CLI and the app; `flint --version` (and `--json`), Settings → About and the docs site show it. A release script: the next version from the commits since the last tag (`feat` → minor, only `fix` → patch, or one given by hand), `CHANGELOG.md` regenerated with git-cliff with a person-written summary on top of the new version, a commit and the tag `vX.Y.Z`; no push. `lean-build`'s close runs it (a note for the skill, not a change to it here). First release `v0.1.0`, its changelog covering the history so far in one section. A note for the owner's Windows build. Unit tests on the bump rule, cli-e2e on `--version`, docs (a "Versions" page or section) and the CLI demo |
| 33 | **A faster desktop** | Milestone 30's tab measured first at 1920×1080 against the owner's Windows 11 host (frames drawn per second dragging a window and under a whole-screen animation, Start-menu latency, CPU of the app and WebKit, bandwidth), targets set at the plan. The `rdpgfx` channel loaded with a codec the build's FreeRDP decodes (progressive, or AVC/H.264 where FreeRDP is built with it), decoded into the same surface; the page draws through WebGL by region; a server without RDPGFX keeps the bitmap path. The same measurements after, in `decisions.md`. gui-e2e: the desktop still connects, draws, resizes and survives a drop against the test server; the owner checks the feel on his Windows host and on his Windows build. Docs |

## Open questions

- **Codecs on each system's FreeRDP.** Homebrew's, Debian's and the owner's Windows build may
  differ in AVC/H.264 support (OpenH264, FFmpeg). Settled at milestone 33's plan from what
  each build reports; progressive needs no external decoder.
- **RDPGFX against the test server.** Flint's test server (`libfreerdp-server3`, v8) sends
  bitmap updates; whether it can offer the graphics pipeline for gui-e2e is settled in 33.
- **Where the version shows in the app**: Settings → About if it exists, else the nearest
  place in Settings; settled at milestone 32's plan.
- **FreeRDP on the owner's Windows branch** (from v8): its result after 33 decides whether
  the ActiveX engine is needed (D-070).
- **Bundling FreeRDP into a release**: a dynamic system package for now (D-015); bundling
  stays in ROADMAP §7.
- **A host with 2FA or keyboard-interactive auth** asks twice when its terminal and its
  tunnels both run (two logins, D-062). Accepted since v6; revisit if it bites.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
