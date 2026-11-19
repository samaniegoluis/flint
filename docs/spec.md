# Flint — v12 Technical Specification: Toasts

**Scope of this document:** version 12 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished) and [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine); everything beyond v12 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v11 shipped (milestones 39-45, up to `v0.12.1`; `v0.13.0` moved Flint to cfire `v0.12.2`,
D-105). Every message the app gives (a saved host, a failed upload, a merge, a tunnel left
up) goes through one toast, and that toast loses things:

- **One at a time.** A new toast replaces the one on screen, so a toast with a button can
  vanish before it is seen.
- **4 s for everything, errors included,** with no ✕, no pause on hover and no Escape: a
  long error is gone before it is read.
- **Fixed at the bottom left,** over the terminal's prompt.
- **Ids from `Date.now()` and timers never cleared:** two toasts in the same millisecond
  share an id, and the first one's timer closes the second.
- **Test connection's result** is a line at the bottom of the host editor, out of sight on
  a small window.

v12 makes the toast one reusable component with options per call, as designed (screens
24a, 24b, 24h, 24j1; D-106), and moves every existing call onto it. It is also the base
the next version's update notice and self-update are built on (ROADMAP §7, v13).

## Scope

**In scope (v12), macOS and Linux here; Windows on the VM with the owner's ok:**
- **The toast component and its corner** (milestone 46): `notify` with options, every
  behaviour of D-106 (1) and (2), the corner as a setting in the core and in Settings →
  Appearance.
- **Every toast on the new component** (milestone 47): the ~58 existing calls reviewed one
  by one, 20d2 and 23e1 on the new design, and Test connection's result in a toast.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Windows:** builds from `main` on stock cfire since D-105. Each milestone is checked on
the Windows VM, and on Zorin, only with the owner's ok; macOS and the Docker Linux check
are the default.

**Out of scope (v12), tracked in the roadmap:** everything of the update (the toast's
update states 24c, the relaunch confirm 24d, About's Updates block 24e, the status bar's
version item 24f, What's new 24g, the palette's commands 24i: ROADMAP §7, v13); ember on a
toast action (reserved for the update's, D-106 (2)); free content in a toast (JSX,
colours); more than two buttons; a notification history; OS notifications; the quick wins
of Order of work block 0.

## Stack

v11's, unchanged. The toast is plain React and CSS Modules over the design tokens: no
toast library, no animation library.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned to `v0.12.2` (D-105) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK / WebView2) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Toasts | **Flint's own component** (`ui/`), CSS transitions | Two buttons, a key that replaces in place, progress and a corner setting are a few hundred lines; a library would bring its own look and timing rules | react-hot-toast, sonner (another look to override, their timing rules, a dependency for little) |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp`, core library only, frames drawn by Flint (D-070) | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control, the system client, writing RDP ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine**, keyed from the vault key (D-092) | The one table that grows with use; synced, it would re-upload the vault on each command | A plain log file (clear text on disk), keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, Windows Credential Manager, via `import cpp` | *Remember on this computer* (D-048) and the server token | Storing either in a file |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http` (D-050, D-092) | Same language, toolchain and version as Flint, in the same repo | A repo of its own, an off-the-shelf store |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v11. v12 changes the page and adds one setting.

- **The toast lives in the page.** One provider owns the stack (ids from a counter, one
  timer per toast, cleared on close and on unmount) and one view renders it in the chosen
  corner. `notify(text, kind?, action?)` keeps its signature, so every existing call works
  unchanged on day one; `notify({ text, kind, duration, actions, key, progress, keepOpen })`
  is the full form. `fail(e)` stays the one path for errors and is sticky by default.
- **The corner is a per-machine setting** in the core: a field of `Settings`
  (`src/domain/settings.cf`), stored in the config folder's settings file like the theme,
  read and saved through the existing settings use case and binding. It is not in the
  vault.
- **Nothing in the core sends a toast.** Events the core already emits (`vault:sync`,
  tunnel and session events) stay as they are; the page decides what becomes a toast.

Contracts (v11's stand, plus):
- **One toast component.** No screen draws its own toast; every message goes through
  `notify` or `fail`.
- **A toast never holds a secret.** It shows what an error message shows, so Principle 6
  covers it as it covers errors today.
- **Accessible by construction.** The `aria-live` region is mounted before the first toast
  (polite for ok and info, assertive for errors), the ✕ and the buttons are reachable by
  keyboard, and the motion honours `prefers-reduced-motion`.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v11's,
unchanged. v12 touches only the page and one per-machine setting: no milestone is expected
to touch an owner-review rule.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, HTTP, keychain, files).
2. No business logic in drivers: a GUI binding, socket handler, HTTP handler or CLI command
   body only parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens
   and random secrets go through libsodium only.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration. The per-machine activity file is
   encrypted in full the same way.
6. **(owner review)** Secret values never appear in RPC results, socket responses, CLI
   output (`--json` included), logs or error messages. **One exception (D-029):** the GUI's
   explicit *reveal* action on a password, while the vault is unlocked, returns that one
   value to the page. *Copy* never does: the core writes it to the clipboard itself. The
   CLI has no reveal. A token's secret is shown once, at creation, to whoever created it.
   The server token is a secret under this rule.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec, SFTP request, forward channel open, RDP
   connect and reconnect, every sync request) and every socket and HTTP request the server
   handles has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.
11. **(owner review)** The CLI never opens a vault with a key it did not derive from a
    master password typed for that command: it goes through the app's socket, or the
    person types the password. The socket is mode 0600 in the config folder, and a peer
    whose uid differs from the app's is refused before any request is read.
12. Every request on the socket is checked against a live grant or token before its use case
    runs. A privileged step (`--sudo`) is approved one by one, never by a grant.
13. **(owner review)** The sync server never receives a key, a master password or anything
    decrypted: its API carries only the encrypted vault file, a version, the vault id, the
    bearer token and an optional label the person chose, which the server keeps in clear
    and never logs (D-103). It never logs a blob or a token, compares the token in constant time
    through libsodium, refuses to start with a weak one, and caps request size and rate.
14. A sync never loses a change: the client never overwrites its local copy with a
    downloaded one, and never uploads over a version it has not merged. Plain `http://` is
    refused for any server other than `localhost`.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v11.

| # | Milestone | Delivers |
|---|---|---|
| 46 | **The toast component and its corner** | `notify` takes options as well as today's arguments (`notify({ text, kind, duration, actions, key, progress, keepOpen })`; every existing call keeps working). **Duration** per call, 6 s by default, paused while hovered or focused; `'sticky'` stays until closed; **errors are sticky**, and so are progress toasts. **A ✕ on every toast**, and Escape closes the newest. **Up to two buttons**, all secondary (ember is the update's, D-106 (2)); `keepOpen` lets an action leave the toast up. **A stack of three**, newest closest to the corner; a sticky toast is never pushed out by a plain one. **`key`** replaces a toast in place, **`progress`** shows a fixed-width percentage. A text clamped at two lines gets **More** / **Less**. A short entry and exit animation that honours reduced motion; an `aria-live` region always mounted. Ids from a counter, every timer cleared. **The corner** as a setting: a field in the core's `Settings` (bottom right by default), Settings → Appearance → Notifications with the corner picker (24h, 12a); bottom corners above the status bar growing up, top corners under the tab bar and the session toolbar growing down, never over the rail (24b1-24b4, 24j1 at 900×600). Vitest for the component (timers, pause, stack, key, sticky), `cfire test` for the setting, gui-e2e for the stack, ✕, Escape and a corner change; docs (Appearance, a short *Notifications* note) |
| 47 | **Every toast on the new component** | The ~58 calls of `notify` and `fail` across the page reviewed one by one: kind, duration, actions, `key` where one toast should replace another. 20d2 (*Tab closed. 2 tunnels still up on prod-db · Stop them*) and 23e1 (the merge toast with *Details*) on the new design. **Test connection's result in a toast too**, in the SSH and the RDP host editors: success as an ok toast, failure as a sticky error; the inline line stays as the record. `scripts/gui-e2e.js` follows (`data-toast-action`, the new markup), `npm run shots:gui` re-run if a landing screen shows a toast; docs where a page describes a message that changed |

## Open questions

None open at the start. Settled with the owner on 2026-11-19 (D-108):

- **Two milestones**, the component first with the old signature kept, then the calls.
- **Test connection** shows its result in a toast both on success and on failure.

Carried past v11: **the owner's Windows checks** of milestones 34-45, tracked as *Pending
owner checks* in `docs/build-log.md`.
