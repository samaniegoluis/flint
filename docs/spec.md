# Flint — v10 Technical Specification: The desktop, finished

**Scope of this document:** version 10 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP) and [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop); everything
beyond v10 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that
changes goes into [`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v9 shipped (milestones 32-34, `v0.2.0`): every build has a version, the site lists the
releases, and the RDP tab decodes the graphics pipeline (RDPGFX) and draws through WebGL
(D-080). The owner uses the RDP tab every day, and his check of milestone 34 (2026-11-12,
macOS, his real Windows 11) left four things between it and "a VM on my own computer":

- **The graphics mode is not chosen well.** *Automatic* (RDPGFX) drew 32 fps for 32 updates
  at about 1.6 Mbit/s but left a few stale blocks that only a repaint by Windows cleared;
  *Compatible* (bitmaps) drew 33/32 at up to 13 Mbit/s and felt smoother, with no blocks.
  The shim sets no `ConnectionType`, so Windows may be told the link is slow and keep the
  pipeline's quality low. A real case to cover: the office, 20 Mbit/s over a VPN, where
  bitmaps at 13 Mbit/s would show. And the mode is a setting: changing it means a new tab.
- **The RDP path has not had a security pass.** Six risks were noted at milestone 30's
  close (ROADMAP §9): password copies not wiped from memory, FreeRDP's own NLA copy,
  CredSSP handing the password to the server, NTLM only, the loopback frame channel guarded
  only by its token, the certificate trusted on first use.
- **The desktop always sits inside Flint's window**, with the sidebar and tab strip around
  it and system keys (Alt+Tab, the Windows key) caught by this machine.
- **One monitor only.** A desktop cannot cover two screens; a friend of the owner works on
  a work VM over RDP with two monitors, and the owner's own pair is one landscape and one
  portrait.

v10 finishes the RDP desktop before the remote vault, which becomes v11 (D-081).

## Scope

**In scope (v10), macOS and Linux here; Windows checked by the owner:**
- **The graphics mode, well chosen** (milestone 35): the stale blocks traced and cleared
  (a full re-read of the desktop after about a second with no update, which also tells
  whether Flint or FreeRDP lost the region); `ConnectionType` with network auto-detect so
  Windows sets the pipeline's quality from the link, measured with `scripts/rdp-bench.sh`
  and the owner's feel, and *Automatic*'s choice settled from it; a per-tab switch
  *Automatic* / *Compatible* in the RDP toolbar beside Stats, through the invisible
  reconnect a resize already uses (D-072 (4)), Settings keeping the default.
- **The RDP security review** (milestone 36): each of the six risks fixed or accepted in
  `decisions.md`; the password-wiping fix shared with the SSH side ("Wipe key material
  from memory", ROADMAP §5).
- **An immersive full-screen RDP tab** (milestone 37): the window borderless and full
  screen, sidebar and tab strip hidden, the desktop at the screen's resolution (Display
  Control), a clear way out (a bar from the top edge or a chord), system keys sent to the
  remote where the plan finds it affordable.
- **Two monitors** (milestone 38): starting with a spike on whether `ext:webui` opens one
  borderless window per monitor on all three systems. If it does, **true multi-monitor**:
  the remote sees each monitor with its size, position and orientation, each window shows
  its part. If not, **span** (one window across both screens, one large monitor on the
  remote; fit for two equal monitors side by side), a `CF-NNN` entry, and true
  multi-monitor stays `next`.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Windows:** as in v8 and v9. The owner runs Flint on Windows from his own branch over a
patched cfire and checks each milestone there at its close. His check of milestone 34 on
Windows (both modes with Stats, against `mstsc`) feeds milestone 35's plan.

**Out of scope (v10), tracked in the roadmap:** the remote vault (now v11, D-081);
graphics choices beyond *Automatic* / *Compatible* (an H.264-only setting, a mode per host,
stepping down by itself); RDPGFX in Flint's test server; more than two monitors; the RDP
ActiveX engine; a sharp desktop on HiDPI screens; the other RDP extras (audio, drives,
gateway, RDP through SSH); everything v9 left out.

## Stack

v9's, unchanged.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-060) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** (`libfreerdp3`, `libwinpr3`) via `import cpp`, core library only, frames drawn by Flint (D-070) | One engine on macOS, Linux and Windows; Apache 2.0; NLA/CredSSP, Display Control, clipboard, graphics pipeline and monitor layout | The RDP ActiveX control (Windows only: a later second adapter), handing off to the system client, writing RDP ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally (a development tool, not linked) | Reads the Conventional Commits already in use; no GitHub PRs or CI needed | release-please and semantic-release, a hand-written changelog |

## Architecture

Hexagonal, as in v9. v10 adds no port; the `RemoteDesktop` port may gain operations (a
mode switch, the monitor layout), each behind the same adapter.

- **Frames keep the local frame channel** (D-071). The re-read after a quiet second marks
  the whole surface dirty in the shim; nothing above `adapters/` learns why a region
  arrived. With two monitors the server still sends one surface (the monitors' bounding
  box); each window draws its part of it.
- **A mode switch is a reconnect, not a renegotiation.** The codecs are fixed when the
  graphics channel opens, so the per-tab switch rides D-072 (4)'s reconnect: the Windows
  session and its apps stay.
- **Windows and screens are the driver's.** Full screen, the monitor list and one window
  per monitor are native shims in `adapters/` (likely `CF-NNN`), reached through the GUI
  driver; the core sees only the desktop size and the monitor layout as data.

Contracts (v9's stand):
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
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v9's,
unchanged. Milestone 36 touches 4 and 6 by design: expect the owner's review there.

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
v9. Automated RDP input against the owner's real session stays harmless (no text, no
shortcuts that open or close anything) until a Windows test VM exists.

| # | Milestone | Delivers |
|---|---|---|
| 35 | **The graphics mode, well chosen** | In this order. (1) **Stale blocks:** after about a second with no server update the shim marks the whole desktop dirty once; whether that clears the blocks tells Flint from FreeRDP (recorded in `decisions.md`), and the re-read stays as the fix if it was Flint's path. (2) **`ConnectionType`** set with network auto-detect, *Automatic* and *Compatible* measured again with `scripts/rdp-bench.sh` and judged by the owner's feel; *Automatic*'s choice settled from that (the pipeline with better quality, a choice by measured bandwidth and round trip at connect, or *Compatible* as the default), never reconnecting by itself in a loop. (3) **A per-tab switch** *Automatic* / *Compatible* in the RDP toolbar beside Stats, through D-072 (4)'s invisible reconnect (the Windows session kept, the password read again from the vault, unavailable while locked); Settings keeps the default. gui-e2e for the switch and the re-read against the test server; docs (remote-desktop), the landing if the switch earns a line |
| 36 | **The RDP security review** | The six risks of ROADMAP §9, each fixed or accepted with a reason in `decisions.md`: password copies in cfire and the shim wiped after use (`sodium_memzero`), shared with the SSH side's "Wipe key material from memory"; FreeRDP's NLA copy (what FreeRDP frees and when); CredSSP and whether Restricted Admin or Remote Credential Guard can be offered; NTLM only (Kerberos off since M28); the loopback frame channel (token strength and lifetime, binding, what a local process can learn); trust on first use of the certificate (what a changed certificate shows). Unit tests on what is fixed, a short "Security" section in the remote-desktop docs. Owner review (Principles 4 and 6) |
| 37 | **An immersive full-screen RDP tab** | *Full screen* from the palette, the tab's menu and a chord: the window goes borderless full screen, sidebar and tab strip hide, the desktop follows the screen's resolution (Display Control). A clear way out (a bar from the top edge, as `mstsc`'s, and a chord), designed first in Claude Design. System keys (Alt+Tab, the Windows key, Ctrl+Esc) sent to the remote through a per-OS low-level hook only if the plan finds it affordable; otherwise left in the roadmap. Full screen in `ext:webui` or a small per-OS shim (Win32, `NSWindow`, GTK) with its `CF-NNN`. gui-e2e for entering and leaving, the owner's feel on macOS and Windows, docs |
| 38 | **Two monitors** | Starts with a spike: one borderless full-screen window per monitor from `ext:webui` on macOS, Linux and Windows, and each monitor's position, size, orientation and scale read per OS. **If it works:** true multi-monitor, the remote told the monitor layout (FreeRDP's monitor definitions), each window drawing its part of the one surface and mapping its own mouse; mixed orientation (landscape + portrait) and mixed scales handled. **If not:** span (one window across both screens, one large monitor on the remote, for equal monitors side by side), a `CF-NNN` entry, and true multi-monitor stays `next`. Entered from full screen (37). Frames twice as large measured with `rdp-bench.sh`. The owner checks with two monitors; docs |

## Open questions

- **The owner's Windows check of milestone 34** (both modes with Stats, against `mstsc`,
  AltGr and dead keys, `flint connect`, copy and paste, a cut network, the version in the
  status bar): its result goes into the build-log and feeds milestone 35's plan.
- **What *Automatic* should pick**: settled by milestone 35's measurements, not before.
- **Milestone 35's size**: three parts; if the plan finds it over one sitting, the switch
  may split into 35b.
- **System keys in full screen** (37): a low-level keyboard hook on each OS (macOS needs
  the Accessibility permission) may cost more than the rest of the milestone; settled at
  its plan.
- **Multi-window in `ext:webui`** (38): settled by the spike; it decides true multi-monitor
  or span.
- **A Windows host only for tests** (ROADMAP §9, `next`): without it the bench measures only
  the Start menu and Task view; the owner's feel carries 35 and 38.
- **Bundling FreeRDP into a release**: a dynamic system package for now (D-015); bundling
  stays in ROADMAP §7.
- **A host with 2FA or keyboard-interactive auth** asks twice when its terminal and its
  tunnels both run (two logins, D-062). Accepted since v6; revisit if it bites.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
