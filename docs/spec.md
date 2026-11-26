# Flint — v19 Technical Specification: Many hosts in one tab

**Scope of this document:** version 19 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts),
[`spec-v13.md`](./spec-v13.md) (Releases), [`spec-v14.md`](./spec-v14.md) (RDP for daily
work, root for a while, server resources), [`spec-v15.md`](./spec-v15.md) (Flint waits
for you), [`spec-v16.md`](./spec-v16.md) (Hardening and polish),
[`spec-v17.md`](./spec-v17.md) (The app in English and Spanish) and
[`spec-v18.md`](./spec-v18.md) (Tunnels and the remote vault, in daily use); everything
beyond v19 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that
changes goes into [`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v18 shipped (milestones 70-71, `v0.34.0`). Split panes (milestone 20, D-061) give a tab up
to four panes, but they serve one server better than several, and the owner's daily work is
several (D-149):

- **A split repeats the host it came from.** ⌘D and ⇧⌘D connect the focused pane's host
  again, so four splits are four sessions to one server; another host needs the palette's
  ⇧⌘↵, which is hard to find. The owner asked on 2026-11-09 and 2026-11-12 for splits and
  layouts that leave the new panes empty, each connected to the host he picks.
- **Nothing typed reaches more than one pane.** Running the same command on four servers
  (`sudo apt update`) means typing it four times.
- **A layout of hosts is built again every time.** "My four production servers" is four
  splits and four picks after every start, and there is no way to keep it or have it on
  another machine.
- **A restart loses every tab.** Quitting Flint (an update's Relaunch included) closes every
  session, and its tabs, layouts and hosts come back only by hand.

Signing and installers still wait for outside steps (the Apple Developer membership,
SignPath's approval), so they move to v20 and this version goes first (owner, 2026-11-26).

## Scope

**In scope (v19), six milestones sized for one session each** (76 and 77 added on 2026-11-26, D-153):
- **Split with another host** (72): a split or a layout opens empty panes, each with a host
  picker in its middle, the focused pane's host first, so ⌘D then ↵ still repeats today's
  split. Duplicate (⌥⌘D) is unchanged. What does not take the keys is dimmed: the panes
  that are not focused, and the whole window while another app has the focus.
- **Broadcast input** (73): a per-pane toggle picks which panes of a tab receive what is
  typed or pasted, shown on every receiving pane and in a bar over the tab; it never turns
  on by itself.
- **Workspaces** (74): a tab saved as a workspace (its layout, divider positions and each
  pane's host), or one made from scratch, kept in the vault so it syncs; opened in one
  click from the side rail.
- **Restore open sessions** (75): at start, after the vault is unlocked, the tabs open at
  the last quit come back in their layouts and connect, with a setting to turn it off.
- **The window's size from the screen, and remembered** (76): the first launch opens at 85 %
  of the screen's height, 16:10, centred; the window then reopens filling the screen if it
  filled it when closed, or at its last size and place when they fit the screen it lands on.
- **`flint agent-guide`** (77): the CLI's long-form guide for the person's agents, named by
  `--help`, generated from the CLI's own command table; an agent may offer to turn it into
  a skill. Flint installs nothing in other apps' folders.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check, and on the
Windows VM where it touches keys (73), the vault's format (74) or the window (76).

**Out of scope (v19), tracked in the roadmap:** workspaces in the CLI (`flint workspace`);
broadcast across tabs, or saved in a workspace; snippets; the last command's duration per
pane (OSC 133); RDP tabs in splits, broadcast or workspaces (an RDP tab stays alone in its
tab, spec v8; restore does bring it back); signing and installers (**v20**).

## Stack

v18's. No new dependency.

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
| Translation | **Flint's own `t(key, params)`** over JSON catalogs (`ui/src/i18n/en.json`, `es.json`), `Intl.PluralRules` for plurals, `Intl.NumberFormat`/`DateTimeFormat` for numbers and dates (D-140) | A few dozen lines, no dependency to pin or update, the same choice as Flint's own toasts | i18next + react-i18next (two dependencies for what Flint uses of them) |

## Architecture

Hexagonal, as in v18. v19 is mostly the page's: the core gains one vault table and its use
cases (74) and one more key in the per-machine UI state (75); no socket, CLI or server API
change.

- **An empty pane** (72, refines D-061 (1)). A pane is a session **or a place waiting for
  one**: the session store (`ui/src/sessions/store.ts`) gets a pane kind with no session
  worker and no terminal. `split()` opens one and focuses it; choosing a layout on a tab
  with fewer panes fills the new places with empty ones. The empty pane shows a host picker
  in its middle: the focused pane's host first and preselected, then recent hosts, then a
  search with the palette's matching (`ui/src/lib/fuzzy.ts`). Choosing a host turns the
  place into that host's session (`sessions.connect`), with the same prompts as any connect;
  Esc or ⌘W closes the empty pane. The core is unchanged: an empty pane makes no
  `session_open`.
- **Dimmed when it does not take the keys** (72, page only, D-150). One rule: what is drawn
  at full contrast receives what is typed. In a split, every pane but the focused one is
  dimmed; while the window does not have the focus (`blur`/`focus` of the page), every pane
  is. The dim is a CSS change on the pane's container (lower contrast, about 70-80 %, the
  value from the design), never a change to xterm.js's renderer; an RDP pane is dimmed less
  or not at all, as the design decides. *Dim what does not have focus* in Settings turns it
  off, on by default.
- **Broadcast input** (73, page only). A tab holds the set of its panes that receive input,
  off on every tab and never saved. A key typed into the focused pane is handed to each
  receiving pane's own terminal to encode, so a pane in Kitty keyboard mode (herdr, Neovim)
  and a plain shell each get the bytes their program asked for, as does application cursor
  mode; how the key is handed over (the keydown re-dispatched to each terminal, or an
  xterm.js API) is settled at 73's plan with a test. A text paste goes to each receiving
  pane through its own paste path (bracketed paste per terminal, the paste limit per pane);
  an image or a file goes to the focused pane only. A pane that is lost, reconnecting or
  empty receives nothing. Receiving panes are drawn at full contrast, as the focused one
  is (72's rule). Every receiving pane draws a border in the broadcast colour and the
  tab shows a bar *Typing into N panes* with a way to stop.
- **A workspace** (74). One appended migration adds a `workspaces` table to the vault: an id
  (128 bits), a name, the layout, the track sizes and the ordered places, each a host id or
  empty. It syncs like every other table, record by record (D-093). A workspace changes only on an explicit action (save, *Update workspace*, rename, delete): a divider drag or a split in a tab opened from one never rewrites the vault, which is why UI state stays out of it (D-030). An older Flint refuses a vault with the new table ("written by a newer Flint", as after every migration), so every machine on that vault updates; the self-update carries it. Application use cases
  save, rename, delete and list workspaces; the GUI's RPC calls them. Opening a workspace
  switches to the tab already opened from it, or opens a new tab in its layout with every
  place connecting; a place whose host was deleted opens as an empty pane. *Save as
  workspace* reads the tab's layout, tracks and hosts. No CLI command in v19; vault export
  and import carry the table.
- **Restore** (75, per machine, D-030). `ui-state.json` keeps, per vault (keyed by the hash
  of its salt, as the collapsed groups are), the open tabs in order: each tab's kind, layout,
  tracks and places (host ids, or empty), and the active tab. Only opaque ids, never a name
  (Principle 5). It is written, debounced, when a tab opens, closes, splits or changes
  layout. At start, once that vault is unlocked, the tabs come back and their panes connect
  as a workspace's do; a deleted host's place is an empty pane. Locking keeps sessions
  running (D-042), so restore runs only at a start. A setting (*Reopen tabs at start*, on by
  default) turns it off. The shape of a tab (layout, tracks, places) is one type shared by
  74 and 75.

Contracts (v18's, plus):
- **A split never connects a host the person did not choose**: an empty pane holds no
  session until a host is picked.
- **Broadcast never starts by itself**: off on every new, opened or restored tab; nothing
  stores it.
- **A broadcast key reaches each pane encoded for that pane's own terminal.**
- **What restore keeps on disk is ids and layout only**; a workspace's name lives inside the
  vault.
- **The vault's format changes by one appended migration** (74); the socket, the CLI and
  the server's API do not change.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v18's, plus 22 (broadcast).

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

21. The core is never translated and the page holds every translation: text the page shows
    comes from its catalog (`t()`), or from a core message's `message` when the catalog has
    no entry for its id; a core message's `params` carry only what its English `message`
    already shows (Principle 6 unchanged).

22. **(owner review)** Input reaches a pane other than the focused one only while broadcast
    is on for that tab, shown on every receiving pane and in the tab's bar. No workspace,
    restore, start or setting turns broadcast on, and it is never saved.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent, sized to fit
one session; each commits per area so a cut session resumes from `git log`. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v18. The new screens come from a
Claude Design run (designs 28) before 72's plan.

| # | Milestone | Delivers |
|---|---|---|
| 72 | **Split with another host** | The store's empty pane; `split()` and the layouts opening empty panes; the empty pane's picker (the focused pane's host first and preselected, recent hosts, search), ↵ or a click connecting it, Esc and ⌘W closing it; the Split menu, the toolbar's Split button and the palette's actions saying what they open; ⇧⌘↵ in the palette unchanged; an RDP host in the picker as the open question below settles; the panes that are not focused, and every pane while the window has no focus, dimmed, with *Dim what does not have focus* in Settings. Verified: vitest of the store (a split adds an empty pane, a layout on one pane adds empty ones, connecting one turns it into a session, closing one leaves the others); gui-e2e: ⌘D then ↵ connects the same host as before, ⌘D then a typed host connects another, a 2 × 2 from one pane connected place by place, Esc closes an empty pane, an empty pane makes no `session_open`, an unfocused pane and a blurred window read as dimmed and the setting turns it off; gui-e2e's existing split steps updated; docs (the desktop app guide's split panes; keyboard shortcuts); the landing's split section if its wording changes |
| 73 | **Broadcast input** | The per-tab broadcast set and its toggle (per pane, all panes, stop), with a shortcut chosen at plan; keys handed to each receiving terminal to encode; text paste through each pane's own paste path, image and file paste to the focused pane only; lost, reconnecting, empty and RDP panes excluded; the border on each receiving pane, receiving panes at full contrast, and the *Typing into N panes* bar; nothing of it saved. Verified: vitest of the broadcast set (off on a new tab, a pane that drops leaves it, never in a saved shape); gui-e2e on macOS, Linux and the Windows VM: one pane in Kitty mode and one plain shell, Shift+Enter and a Ctrl chord typed once reach each as its own encoding (checked on the remote side), a pasted line arrives once in each, an image paste reaches the focused pane only; docs (the desktop app guide: broadcast, its warning; keyboard shortcuts); the landing if the owner wants it there |
| 74 | **Workspaces** | The `workspaces` table by an appended migration and its record merge; save, rename, delete and list use cases and their RPC; *Save as workspace* and *Update workspace* on a tab (only these write the vault, never a drag or a split), a workspace made from scratch (a name, a layout and a host per place), opening one (switch to its tab or open it, a deleted host's place empty), the workspaces in the side rail. Verified: `cfire test` of the migration, the use cases and the merge (a workspace added on two machines merges; a deleted host leaves an empty place); vitest of the tab shape; sync-e2e: a workspace saved on one client opens on the other; gui-e2e: save a 2 × 2 of hosts, quit, open it, every pane connects; a second open switches to its tab; docs (a Workspaces guide; the vault format reference: the new table); the landing (workspaces as a headline feature, in the split section or its own) |
| 75 | **Restore open sessions** | The tabs of each vault in `ui-state.json` (ids and layout only), written debounced; restore after the vault's unlock at start, panes connecting, a deleted host's place empty, RDP tabs coming back as tabs; *Reopen tabs at start* in Settings, on by default. Verified: vitest of the restore state (written on a split, a close, a layout change; ids only; a damaged file falls back to no tabs); gui-e2e: open two tabs (one split in a grid), quit, start, unlock, the same tabs and layout come back connected; with the setting off nothing comes back; `ui-state.json` read back holding no host name; docs (the desktop app guide: restore and its setting) |
| 76 | **The window's size from the screen, and remembered** | Native code beside `flint_window.hpp` and `flint_monitors.hpp` (a CF entry for what `ext:webui` lacks): the screen's work area, the window's frame, moving and sizing it. First launch, and the fallback: 85 % of the work area's height, 16:10 wide but never over 85 % of its width, centred on the screen it opens on. On close, per machine in `ui-state.json` (D-030): whether the window filled its screen's work area (a flag with a few pixels' tolerance, so Windows' and Linux's maximize, the Mac's zoom and tiling tools count alike), else its size and place. On open: filling the screen it lands on with the flag; else the saved size and place when they fit a connected screen, else the first-launch size, centred. System full screen reopens filling the screen, not in its own Space. Verified: `cfire test` of the size rules (first launch on a MacBook, 2K and ultrawide work area; a saved size larger than the screen; a place on a screen no longer connected; the flag on a smaller screen); gui-e2e on macOS, Linux and the Windows VM: fill the screen, quit, start: it fills again; a manual size comes back; a damaged `ui-state.json` falls back to the first-launch size; docs (the desktop app guide: the window) |
| 77 | **`flint agent-guide`** | A CLI command printing Markdown for the person's agents: the reference generated from the CLI's own command table (commands and flags, `--json`, exit codes, grants and approval, `exec --sudo`, `cp`, root periods) and the rhythm of use `--help` cannot give (status first, wait on approval and never retry in a loop, never ask for a password in the chat), ending with a note to offer the person a skill made from it that keeps a summary and points back to `flint agent-guide`. `--help` names it. Verified: `cfire test` that every command of the table appears in the guide and the guide's exit codes match the CLI's; cli-e2e: `flint agent-guide` prints it, `flint --help` names it; docs (the AI agents page gains the guide, generated from the same text); the landing's CLI demo and the agents section (rules 5 and 6) |

## Open questions

Settled with the owner on 2026-11-26 (D-149): ⌘D and ⇧⌘D open an empty pane with the
current host preselected; workspaces live in the vault; broadcast stays inside one tab and
never turns on by itself; restored tabs connect on their own, with a setting to turn it off;
what does not take the keys is dimmed (D-150).
Open, to settle at each milestone's plan:

- **An RDP host chosen in an empty pane** (72): left out of the picker, or listed as opening
  in a tab of its own (the empty pane then stays).
- **How a key is handed to another terminal** (73): the keydown re-dispatched to each
  terminal, or an xterm.js API; a test with Kitty mode on one pane decides.
- **Where workspaces sit in the side rail** (74): the design brief left room above Keys; the
  design run decides how many show and how the rest are reached.
- **A restored tab whose vault is not the one unlocked** (75): restore runs per vault, at
  that vault's first unlock after a start; whether opening a second vault later also
  restores its tabs.
