# Flint — v16 Technical Specification: Hardening and polish

**Scope of this document:** version 16 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts),
[`spec-v13.md`](./spec-v13.md) (Releases), [`spec-v14.md`](./spec-v14.md) (RDP for daily
work, root for a while, server resources) and [`spec-v15.md`](./spec-v15.md) (Flint waits
for you); everything beyond v16 lives in [`ROADMAP.md`](../ROADMAP.md). This file is
static: a decision that changes goes into [`decisions.md`](./decisions.md), which
supersedes the line here.

## Problem

v15 shipped (milestones 61-63, `v0.30.0`; `v0.30.1` fixed Windows' Relaunch). Before the
larger work of the app in two languages (v17) and signing (v18), the owner wants the small
rough edges that touch security or daily use closed (D-138):

- **The window behaves like a browser in places.** cfire `v0.12.2` already turns the web
  inspector and the engine's right-click menu off in a release (`cfire build`), but all or
  nothing: a text field lost *Copy* and *Paste* on right-click, nobody can open the
  inspector on a release to diagnose it, and on Windows the browser's own keys (F5,
  Ctrl+R, Ctrl+P) may still reload or print the page over open sessions.
- **WebView2 keeps what is typed.** Its form autofill stores host names, users and domains
  typed in the editors in its profile on disk, outside the vault and its encryption, and
  offers them back. Flint never turned it off, and what it already stored is still there.
- **✕ on a desktop with no tray hides Flint for good.** On Zorin the window disappears,
  Flint keeps running with no icon, and only the palette's Quit gets out.
- **The QR in Settings → Notifications opens a web page,** not the ntfy app; on Android a
  `ntfy://` link would subscribe in one scan.
- **A failed update swap names no program.** On Windows, a file held open in Flint's
  folder stops the Relaunch with "a program has a file open", and the person has to guess
  which.

## Scope

**In scope (v16):**
- **A release is not a browser** (64): Flint's own Cut/Copy/Paste/Select all menu in text
  fields, `FLINT_DEVTOOLS=1` to get the inspector and the engine's menu back on a release,
  the browser's reload and print keys blocked, form autofill and password autosave off and
  what WebView2 already stored removed, `autocomplete="off"` on every field.
- **Close, alerts and updates** (65): ✕ quits on a Linux desktop with no tray, or asks
  once, the answer kept in Settings; the QR with an iPhone / Android choice; the swap
  names the programs that hold the folder (Windows Restart Manager).
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check; the
Windows parts on the Windows VM, the Linux tray parts on Zorin, as the milestone needs them.

**Out of scope (v16), tracked in the roadmap:** the app in English and Spanish (**v17**,
D-084); signing, the keychain by signed identity, installers and Touch ID (**v18**); a
StatusNotifierItem tray icon on Linux (CF-082, cfire's); a tray menu that follows the state;
the iPhone QR opening the ntfy app (waits for ntfy-ios#51); a native menu filtered item by
item (cfire offers on or off only).

## Stack

v15's, unchanged. 64 uses cfire `v0.12.2`'s `app.set_devtools`, `app.set_context_menu` and
`app.set_autofill`; 65 adds two small native shims inside `adapters/`, tagged as Principle 3
asks: the X11 tray check on Linux and the Restart Manager (`rstrtmgr`) on Windows.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned to `v0.12.2` (D-105) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK / WebView2) | Wails-like typed RPC + events, native webview, no bundled browser. Release builds have no inspector and no engine menu | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Toasts | **Flint's own component** (`ui/`, v12) | Notices, updates and grants share one corner | A toast library |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | Covers PTY, exec channels, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp` (D-070) | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control (`later`), the system client |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305; Ed25519 for updates; random topics | Vetted, constant-time | cfire `core:crypto` |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption, a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine** (D-092) | The one table that grows with use | A plain log file, keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, Windows Credential Manager | *Remember on this computer* (D-048) and the server token | Storing either in a file |
| HTTP client | **libcurl** | Sync, the manifest, the download, an ntfy publish | A second HTTP stack |
| Alerts | **ntfy** (ntfy.sh or the person's own server), behind a notifier port | Open source, free, iOS and Android, no account (D-134 (4)) | Telegram, Pushover, Bark, Gotify; each may be an adapter later |
| QR code | **`qrcode-generator` 2.0.4** in the frontend (M63) | Subscribing from the phone is a scan | Drawing QR in the core |
| Linux tray check | **The X11 `_NET_SYSTEM_TRAY_S0` selection** (D-138 (3)) | cfire's Linux icon is a `GtkStatusIcon` (XEmbed): a tray that shows it owns that selection; a Wayland session shows none | A D-Bus `StatusNotifierWatcher` check (says "tray" where an XEmbed icon still never shows) |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http` (D-050, D-092) | Same language and toolchain, same repo | A repo of its own |
| Packages and updates | v13's: portable packages, `.deb`/`.rpm`, Flint's signed self-update (D-111, D-124) | Every v16 release reaches people on its own | — |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v15. v16 changes how the window is set up and adds two read-only native
queries; no new port, no vault or socket format change.

- **The window's setup** (`drivers/gui`). At start the app calls `set_autofill(false)`
  always, and `set_devtools(true)` with `set_context_menu(true)` only when `FLINT_DEVTOOLS=1`
  (a debug build, `cfire run`, has both already). Before the window opens on Windows, it
  removes the autofill data WebView2 already wrote in Flint's profile folder, once, recorded
  in `ui-state.json` (the exact files settled at 64's plan from the VM).
- **The field menu** (`ui/`). One handler for `contextmenu`: inside an `input` or a
  `textarea` it opens Flint's context-menu component with Cut, Copy, Paste and Select all
  (disabled where they do nothing: Cut and Copy with no selection, Cut and Paste in a
  read-only field); elsewhere it does nothing, and the terminal, the tabs and the lists
  keep their own menus. Paste reads the clipboard through the core, as the terminal's
  paste does, never through a browser permission.
- **The browser's keys.** The page cancels the engine's reload, print and save shortcuts
  (F5, Ctrl/⌘+R, Ctrl/⌘+P, Ctrl/⌘+S) where nothing in Flint uses them. If WebView2 acts
  on them before the page, 64 files a CF-NNN for `AreBrowserAcceleratorKeysEnabled`.
- **Is there a tray?** (Linux, 65). A function in `adapters/uievents` answers whether an X11
  tray manager owns `_NET_SYSTEM_TRAY_S0` on the window's display, and *no* on Wayland.
  macOS and Windows always have one. With none, `window:close_requested` does not lock and
  hide: the first time the page asks *Keep Flint running in the background? It serves the
  flint command and your grants* (Quit / Keep running), and the answer is a setting of this
  machine (Settings → General) that later closes follow. Kept running, a second launch of
  Flint shows the window, as today.
- **The QR's phone** (65). Settings → Notifications gets an iPhone / Android choice beside
  the QR, kept per machine: iPhone shows `https://<server>/<topic>` with the "subscribe
  with +" step, Android `ntfy://<host>/<topic>?display=Flint` with no step.
- **Who holds the folder** (Windows, 65). When `flint update-apply` gives up on the rename,
  it asks the Restart Manager (`RmStartSession`, `RmRegisterResources` with the files in the
  folder, `RmGetList`) and names each program and pid in its error; the toast shows it. Any
  failure of that query keeps today's message.

Contracts (v15's, plus):
- **A release build opens no inspector** unless `FLINT_DEVTOOLS=1` is set in its
  environment.
- **The webview stores nothing typed into Flint's fields** (autofill and password autosave
  off on every OS).

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v15's, with
20 added (D-138).

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, HTTP, keychain, files).
2. No business logic in drivers: a GUI binding, socket handler, HTTP handler or CLI command
   body only parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens,
   signatures and random secrets go through libsodium only.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration. The per-machine activity file is
   encrypted in full the same way.
6. **(owner review)** Secret values never appear in RPC results, socket responses, CLI
   output (`--json` included), logs or error messages. **One exception (D-029):** the GUI's
   explicit *reveal* action on a password, while the vault is unlocked, returns that one
   value to the page. *Copy* and *Type <host>'s password* never do: the core writes it to
   the clipboard or types it itself. The CLI has no reveal. A token's secret is shown once,
   at creation, to whoever created it. The server token is a secret under this rule.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec, SFTP request, forward channel open, RDP
   connect and reconnect, every sync request, the update check and download, the
   resources channel, an alert's publish) and every socket and HTTP request the server
   handles has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.
11. **(owner review)** The CLI never opens a vault with a key it did not derive from a
    master password typed for that command: it goes through the app's socket, or the
    person types the password. The socket is mode 0600 in the config folder, and a peer
    whose uid differs from the app's is refused before any request is read.
12. **(owner review)** Every request on the socket is checked against a live grant or token
    before its use case runs. A privileged step (`--sudo`) is approved one by one, **except
    inside a root period** (D-117): given in the root window, only while *Allow sudo for a
    while* is on, for one caller anchor on one host, at most 15 minutes, with presence
    confirmed once and every command it allows shown in a notice. No grant, token or
    exec grant ever implies root, and no root period covers a group or the whole vault.
13. **(owner review)** The sync server never receives a key, a master password or anything
    decrypted: its API carries only the encrypted vault file, a version, the vault id, the
    bearer token and an optional label the person chose, which the server keeps in clear
    and never logs (D-103). It never logs a blob or a token, compares the token in constant
    time through libsodium, refuses to start with a weak one, and caps request size and
    rate.
14. A sync never loses a change: the client never overwrites its local copy with a
    downloaded one, and never uploads over a version it has not merged. Plain `http://` is
    refused for any server other than `localhost`.
15. **(owner review)** An update is applied only after the manifest's Ed25519 signature
    verifies against the public key compiled into Flint and the package's SHA-256 matches
    the verified manifest; a failure discards the download and is never retried from the
    toast (D-106 (5)). The update check sends one GET and nothing else, can be turned off,
    and never restarts Flint without the person's Relaunch. The signing key's secret lives
    only in the workflow's `release` environment and the owner's Infisical, never in the
    repository, a log or a package.
16. The packaging scripts hold all the build logic and read no secret: the workflow only
    installs the pinned cfire and calls them, so every package can be rebuilt by a person
    on the Mac, Linux or the Windows VM (D-107 (2)). User data never lives in the
    package's folder.
17. **(owner review)** A Linux update gets root only through `flint-update-root` and its
    polkit action `dev.flint.update` (`auth_admin`, never kept). The helper accepts no path
    or URL from its caller and verifies a copy root owns, never the file the user's process
    wrote: the manifest's Ed25519 signature against the compiled-in key, the package's
    SHA-256 from that manifest, and a version newer than the installed one. Only a file that
    passed all three is handed to `apt` or `dnf`; any failure installs nothing and is never
    retried from the toast (D-106 (5)). A package built with a test feed or key is refused
    by `release-draft.sh`.
18. Flint never leaves a process of its own running on a server: anything it starts there
    for itself (the resources loop) ends with the channel, the tab or the session, and is
    read-only (it writes no file and changes nothing on the server).
19. **(owner review)** Nothing leaves the machine to tell a person something unless that
    person turned it on, and what leaves carries no content: an alert names no host, user,
    command, caller, vault or count, and no alert can approve, deny or unlock anything.
20. The webview is never a browser in a release: no inspector, no engine menu and no
    autofill unless `FLINT_DEVTOOLS=1` is set (autofill stays off even then), and nothing
    in the page reloads, prints or saves it.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v15.

| # | Milestone | Delivers |
|---|---|---|
| 64 | **A release is not a browser** | `set_autofill(false)` always; `FLINT_DEVTOOLS=1` turns the inspector and the engine's menu on in a release; Flint's own field menu (Cut, Copy, Paste, Select all, disabled where they do nothing, Paste through the core) in every `input` and `textarea`, nothing elsewhere; the reload, print and save keys cancelled (a CF-NNN if WebView2 ignores the page); `autoComplete="off"` in the shared `plainText` props; on Windows, WebView2's stored autofill data removed once before the window opens; CF-121 and CF-122 marked resolved at `v0.12.2`. Verified: vitest of the field menu's items and of the keys; gui-e2e of right-click in a field and outside one; a release build on the Mac, the Windows VM and Docker Linux with no inspector, and with it under `FLINT_DEVTOOLS=1`; on the VM, no autofill offer in the host editor after typing a host twice, and the old data gone; docs (desktop app: the field menu, build from source: `FLINT_DEVTOOLS`, the security model's line on the webview) |
| 65 | **Close, alerts and updates** | The Linux tray check (X11 `_NET_SYSTEM_TRAY_S0`, none on Wayland) in `adapters/uievents`; with no tray, ✕ asks once *Keep Flint running in the background?* and the answer is a setting in Settings → General that later closes follow (Quit, or hide as today with a second launch showing the window); the QR's iPhone / Android choice (Android `ntfy://<host>/<topic>?display=Flint`, iPhone the `https` link and the + step); on Windows, `update-apply` naming the programs and pids that hold the folder (`RmGetList`) in its error and the toast. Verified: `cfire test` of the close decision (tray or none, each answer) and of the update error's text with a fake holder list; vitest of the QR's two links; gui-e2e of the close question and the setting; on Zorin, ✕ with no tray asks, then quits or hides as answered; on the VM, a file held open in the folder (a PowerShell in it) named by the Relaunch; the owner scans the Android QR on a real phone if one is at hand; docs (desktop app: closing the window, *Alerts on your phone*, updating) |

## Open questions

None open at the start. Settled with the owner on 2026-11-23 (D-138):

- **v16 is two milestones**, 64 then 65; the Restart Manager is in (65).
- **The tray check** is the X11 tray selection, not the D-Bus StatusNotifierWatcher.
- **The field menu** offers Cut, Copy, Paste and Select all; right-click elsewhere does
  nothing in a release.
- **Then:** v17 the app in English and Spanish (D-084), v18 signing and installers.
