# Flint — v8 Technical Specification: Embedded RDP

**Scope of this document:** version 8 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels) and
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal); everything beyond v8 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v7 shipped (milestones 25, 25b and 27, [`build-log.md`](./build-log.md); 26 left for
later, D-069): a pasted image lands on the server and its path in the terminal. The owner
uses Flint every day for SSH, and **RDP every day too**, outside it:

- **RDP logins live outside the vault.** The owner reaches Windows Server hosts, Windows
  10/11 Pro machines and Windows VMs on Proxmox, directly or over a VPN. Their passwords sit
  in each client's own store, not in the one encrypted vault Flint was built to be.
- **Two different clients, neither inside Flint.** From the Windows office PC (where he uses
  RDP most) it is `mstsc`; from the Mac it is Microsoft's Windows App, a closed app that
  takes no password from outside and cannot be embedded. Linux has no official client.
- **There is one engine that runs on all three.** FreeRDP 3 (C, Apache 2.0) is a client
  library: Flint can link its core, receive frames and draw them itself, so the session
  lives in a Flint tab beside the SSH tabs. On Windows, Microsoft's own engine can also be
  embedded (the RDP ActiveX control, `mstscax.dll`); v8 keeps the design open for it as a
  second adapter, built later only if FreeRDP on Windows falls short (D-070).

v8 puts RDP hosts in the vault and opens them in a Flint tab, through FreeRDP, on macOS,
Linux and Windows.

## Scope

**In scope (v8), macOS and Linux here; Windows checked by the owner** (see below):
- **Spike first** (milestone 28): libfreerdp 3 linked through a shim on macOS and Linux,
  a connection to a real Windows host with NLA, frames drawn on a canvas in a bare page;
  the frame transport from the core to the page measured and chosen (see Architecture).
- **RDP hosts in the vault** (milestone 29): a host has a **type**, `ssh` (every existing
  host) or `rdp`. An RDP host has an address, a port (default 3389), a user, an optional
  domain, a credential from the vault (a password; the same credentials as SSH hosts), a
  group and a label. Through an appended migration. Hosts of both types share the sidebar
  tree, the palette and search, each marked by its type.
- **The server's certificate, trusted on first use**, like SSH host keys (D-019): its
  fingerprint is kept in the vault on the first accepted connection; a changed one stops the
  connection and says so. Self-signed certificates (Proxmox VMs, most Windows hosts) are the
  normal case.
- **The RDP tab** (milestone 30): the remote desktop in a tab of its own, one session per
  tab (no split panes). Keyboard with the person's layout and the usual mapping (on macOS,
  ⌘ to Ctrl for copy, paste and the like, as Windows App does), mouse, wheel, and the
  resolution following the tab's size (the Display Control channel, with a reconnect at the
  new size when the server lacks it). NLA/CredSSP and TLS. Each failure's reason (auth,
  certificate, network, timeout, the server refused) on the tab, never a silent failure.
- **Clipboard and reconnect** (milestone 31): text copied and pasted in both directions;
  a session that drops offers to reconnect, as the SSH tab does.
- **CLI, minimal:** `flint host add/edit/list/rm` take `--type rdp` and its fields, so the
  vault stays scriptable for every host type; `flint connect <rdp-host>` asks the app over
  the socket to open the RDP tab (the CLI never shows a desktop). `flint exec`, `flint cp`
  and tunnels refuse an RDP host with a clear error and code.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6).

**Windows:** the owner runs Flint on Windows from a branch of his own over a patched cfire,
which takes everything from `main`; Windows stays out of this repo's verification until it
merges. FreeRDP builds and runs on Windows, so v8's features are designed for it too, and
the owner checks them there at each milestone's close. **That check also decides the next
step** (D-070): if FreeRDP on Windows does not satisfy the owner next to `mstsc`, a second
engine for Windows, the RDP ActiveX control, goes into a later spec as another adapter of
the same port.

**Out of scope (v8), tracked in the roadmap:** the RDP ActiveX engine on Windows (later,
D-070); handing off to the system client (`mstsc`, Windows App, `xfreerdp`); audio; drive,
printer and smartcard redirection; files over the clipboard; multiple monitors; RD Gateway;
an RDP session in a split pane; reaching an RDP host through an SSH tunnel or jump host;
recording sessions; VNC and other protocols; the remote vault; `flint agent`.

## Stack

v7's, plus one row.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-060) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| **(new) RDP** | **FreeRDP 3** (`libfreerdp3`, `libwinpr3`) via `import cpp`, core library only, frames drawn by Flint (D-070) | One engine on macOS, Linux and Windows; Apache 2.0; NLA/CredSSP, Display Control and clipboard channels | The RDP ActiveX control (`mstscax.dll`, Windows only: a later second adapter), handing off to the system client (Windows App takes no password), writing RDP ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module. Used only by *Remember on this computer* (D-048) | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal, as in v7. v8 adds one port, its FreeRDP adapter, a host type and a migration.

```
 drivers        GUI (webui + React: the RDP tab's canvas,    socket server   CLI (socket
                host editor with a type)                      (in the app)    client)
                        │                                         │
 application     use cases: … v7 …, OpenRemoteDesktop, CloseRemoteDesktop,
                 ResizeRemoteDesktop, TrustRdpCertificate; host CRUD gains the type
                        │
 domain          … v7 …, HostType (ssh | rdp), RDP host fields and validation,
                 certificate trust rules (first use, changed)
                        │  ports
 ports           … v7 …, RemoteDesktop (connect, input, resize, clipboard, close;
                 frames and state out through EventSink or the frame channel)
                        │
 adapters        … v7 …, rdp/ (FreeRDP 3 shim, CF-NNN) · later: rdp/ActiveX (Windows)
```

Contracts (v7's stand; new ones are marked):
- **Drivers hold no business logic.** A GUI binding, a socket request and a CLI command for
  the same action call the same use case.
- **Secrets never leave the core in clear text** except to a transport at connect time:
  SSH, and now **RDP** (the password handed to FreeRDP for NLA). Drivers see derived flags
  such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes, transfer progress, tunnel state and
  **desktop frames** travel outside RPC return values.
- **Per-machine state lives in the config folder, never in the vault** (D-030).
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry.
- **One holder of an unlocked vault** (v3). Lock zeroes the key and ends every grant;
  **it also closes every RDP session**, as it does SSH sessions.
- **SFTP rides an SSH session** (D-053, D-055). **A pane is a session, a tab is a layout**
  (D-061). **A tunnel is a host's, not a tab's** (D-062, D-063). A pasted file travels over
  its pane's own session (v7).
- **(new) The RDP engine sits behind one port.** Nothing above `adapters/` knows it is
  FreeRDP: input arrives as Flint's own key and pointer events, frames leave as dirty
  rectangles, so a second engine (the ActiveX control on Windows, D-070) is another adapter.
- **(new) Frames take the cheapest path the spike measures.** Milestone 28 compares dirty
  rectangles over webui events against serving them from the core through the webview's
  own `app://` scheme (or another local channel), at 1920×1080, and picks one by frame rate
  and input latency; the choice goes into `decisions.md`.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v7's, with
P8 naming RDP (D-070).

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
8. Every network operation (dial, auth, exec, SFTP request, forward channel open, **RDP
   connect and reconnect**) and every socket request has an explicit timeout.
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
v7. The agent needs a Windows host to connect to (a Windows VM on the owner's Proxmox,
reachable from the Mac and the Zorin box); the owner provides it before milestone 28.

**New design screens:** the host editor with a type and the RDP fields, the RDP tab (its
connecting, failed and reconnect states, the certificate prompt). At milestone 29's plan
time the agent writes the prompt for the owner's Claude Design chat (`docs/design-prompt.md`).

| # | Milestone | Delivers |
|---|---|---|
| 28 | **Spike: FreeRDP in Flint** | libfreerdp 3 and libwinpr 3 linked through a shim in `adapters/rdp/` (a `CF-NNN` entry) on macOS (Homebrew) and Linux (Zorin and the Docker image); a connection to the owner's Windows VM with NLA, a password typed for the spike (no vault yet), frames drawn on a canvas in a bare page of the app, mouse and keys enough to log in and open a window. The frame transport measured both ways (webui events, the `app://` scheme or another local channel) at 1920×1080: frame rate while dragging a window, input latency, CPU; one chosen, in `decisions.md`. A timeout on connect (P8). Fails here if FreeRDP cannot live inside cfire's webview app. A short note for the owner's Windows build: what FreeRDP needs there |
| 29 | **RDP hosts in the vault and the CLI** | A host type (`ssh` default, `rdp`), RDP fields (address, port 3389, user, domain, credential, group, label) through an appended migration; the certificate fingerprint table (trust on first use, a changed one refused with the reason). The host editor with a type (design from Claude Design), both types in the sidebar tree, the palette and search, each marked. `flint host add/edit/list/rm --type rdp` with `--json`; `flint exec`, `flint cp` and tunnels refuse an RDP host with a stable code. Unit tests on the domain rules, cli-e2e, docs and the CLI demo |
| 30 | **The RDP tab** | Opening an RDP host from the sidebar, the palette or `flint connect <rdp-host>` (over the socket, under its grant) opens a tab with the desktop, through the `RemoteDesktop` port and the transport chosen in 28. The vault's password for NLA, the certificate prompt on first use. Keyboard with the layout and the macOS ⌘→Ctrl mapping, mouse, wheel, the resolution following the tab's size. The tab's connecting and failed states with each failure's reason; lock closes it. gui-e2e: a tab against a test RDP server (`xrdp` in the Docker image, or FreeRDP's own test server) for connect, a frame and a resize; the owner checks the real Windows VM and his Windows build. Docs, the landing (RDP is a new surface: asked at plan time where it goes) |
| 31 | **Clipboard and reconnect** | Text copied on the remote desktop pastes on this machine and the reverse (the clipboard channel, text only); a dropped session shows the reason and *Reconnect*, as the SSH tab does, with a timeout. gui-e2e on the clipboard both ways against the test server; the owner checks it on Windows Server and on his Windows build. Docs |

## Open questions

- **The frame transport**: settled by milestone 28's measurements.
- **FreeRDP on the owner's Windows branch**: how it is built and shipped there (vcpkg, the
  project's own build) is the owner's, guided by 28's note. Its result decides whether the
  ActiveX engine is needed (D-070).
- **Bundling FreeRDP into a release**: like libssh, it is a dynamic system package for now
  (D-015); bundling stays in ROADMAP §7.
- **A test RDP server for gui-e2e on Linux and macOS**: `xrdp` in the Docker image is the
  likely answer, settled in 28 or 30.
- **A host with 2FA or keyboard-interactive auth** asks twice when its terminal and its
  tunnels both run (two logins, D-062). Accepted since v6; revisit if it bites.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
