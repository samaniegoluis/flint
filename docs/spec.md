# Flint — v17 Technical Specification: The app in English and Spanish

**Scope of this document:** version 17 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts),
[`spec-v13.md`](./spec-v13.md) (Releases), [`spec-v14.md`](./spec-v14.md) (RDP for daily
work, root for a while, server resources), [`spec-v15.md`](./spec-v15.md) (Flint waits
for you) and [`spec-v16.md`](./spec-v16.md) (Hardening and polish); everything beyond v17
lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes
into [`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v16 shipped (milestones 64-65, `v0.31.0` and `v0.32.0`). The desktop app speaks only
English, and the owner and the people around him work in Spanish. D-084 (2026-11-12)
agreed how to translate it without translating the core; D-138 placed it here, before
signing (v18). Today:

- **Every string is written inline** in ~11,700 lines of page components (68 `.tsx`
  files, ~800-1,200 strings), and some formats pin `'en-US'` (`lib/rdpStats.ts`).
- **The core's messages are English text only.** 841 `coded(...)` calls carry an error
  category and a sentence; the page shows the sentence as it comes, so it cannot render
  it in another language.
- **Native text is fixed at start:** the tray's *Open Flint*, *Lock Vault* and *Quit
  Flint*, the native file dialogs' titles and the reason Touch ID shows.

## Scope

**In scope (v17), four milestones sized for one session each (D-140):**
- **The catalog and the setting** (66): Flint's own `t()` helper, the language setting
  (System / English / Español), `en.json`, and the strings of the shell, the palette,
  Settings, the lock and unlock screens, the update toasts and the shared `ui/` components
  moved into it. Nothing changes on screen.
- **The rest of the page** (67): sessions, access, files, editors, sync, tunnels and the
  text built in `lib/`, moved into the catalog, and a guard that fails on a string left
  outside it. Nothing changes on screen.
- **Spanish** (68): `es.json` complete (neutral Spanish, *tú*), a test that every `en` key
  exists in `es`, the tray, the native dialogs' titles and Touch ID's reason in the chosen
  language; the owner checks long strings on screen.
- **The core's messages** (69): `{code, id, params, message}` (D-084), the ids in one place,
  the page rendering an id from its catalog and falling back to `message`; the first
  messages migrated (connection cards, the changed certificate, unlock, RDP) and a script
  that lists ids with no translation.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10): 66 and 67
  are refactors and make none.

**Every system:** each milestone is verified on macOS and the Docker Linux check; the
native text of 68 on the Windows VM and Zorin too.

**Out of scope (v17), tracked in the roadmap:** the CLI in any language other than English
(never, D-084); the docs site and the landing in Spanish (later, Starlight's `/es/`
routes); every one of the 841 core messages migrated (they move a few at a time after 69,
the English fallback keeps the rest readable); languages other than English and Spanish;
polkit's message (it comes from the `.policy` file, in English); signing and installers
(**v18**).

## Stack

v16's, plus the translation helper. No new dependency.

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

Hexagonal, as in v16. v17 adds a catalog to the page, one setting to the core, and an id
and parameters to the core's messages; no new port, no vault or socket format change.

- **The setting** (core). `Settings.language` is `system`, `en` or `es`, per machine like
  the theme, saved through the settings use case. `system` reads the OS language once at
  start: `es` when it starts with `es`, `en` otherwise. The page receives the resolved
  language with the settings and re-renders when it changes; no restart.
- **The catalog** (`ui/src/i18n/`). `en.json` and `es.json`, flat keys grouped by area
  (`shell.*`, `access.*`, …). `t(key, params)` interpolates `{name}` parameters and picks
  plural forms (`key.one`, `key.other`) through `Intl.PluralRules`; numbers, sizes and
  dates go through `Intl` with the chosen language, never a pinned `'en-US'`. A missing
  key renders the English entry, and in tests fails.
- **Guards.** A vitest walks `ui/src` and fails on visible text written outside the catalog
  (JSX text, `title`, `placeholder`, `aria-label`, toast and dialog text), with a short
  allow-list (brand names, key names such as ⌘R). Another fails when a key of `en.json` is
  missing from `es.json` or when `es` has a key `en` lacks.
- **Native text** (`drivers/gui`). The tray's items, the native dialogs' titles and the
  Touch ID reason come from a small table in the driver keyed by language, set at start and
  again when the language changes. If cfire cannot relabel a tray item at run time, 68
  files a CF-NNN and the tray follows the language from the next start.
- **The core's messages** (69, D-084). A message is `{code, id, params, message}`: `code`
  the error category as today, `id` a stable dotted name (`ssh.host_key_changed`), `params`
  its values as strings, `message` the English sentence. The ids and their English text are
  defined in one file of the core, which `coded(...)` call sites name; `message` is built
  from that text and the params, so the CLI prints exactly what it prints today. RPC results
  and `--json` carry `id` and `params` beside `message`. The page looks up `core.<id>` in
  its catalog and falls back to `message`. A script lists the core's ids with no entry in
  `en.json` or `es.json`.

Contracts (v16's, plus):
- **The CLI's output does not change:** same text, same codes; `--json` gains `id` and
  `params` only.
- **A message is never blank:** a missing translation shows the English entry, a missing
  core id shows the core's `message`.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v16's, with
21 added (D-140).

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

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent, sized to fit
one session; each commits per area so a cut session resumes from `git log`. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v16.

| # | Milestone | Delivers |
|---|---|---|
| 66 | **The catalog and the setting** | `ui/src/i18n/` with `t(key, params)`, plurals through `Intl.PluralRules`, `Intl` formatters bound to the language; `Settings.language` (`system`, `en`, `es`) in the core with the OS language resolved at start; the Language row in Settings → Appearance (System / English / Español, Español hidden or marked until 68 fills `es.json`); `en.json` holding every string of `shell/`, `palette/`, `pages/`, `screens/`, `update/` and `ui/`, and `App.tsx`. Verified: vitest of `t()` (params, plurals, a missing key), `cfire test` of the setting and the resolution of `system`; gui-e2e and vitest unchanged (the same English on screen); docs (desktop app: the Language row) |
| 67 | **The rest of the page** | Every string of `sessions/`, `access/`, `files/`, `editors/`, `sync/`, `tunnels/`, `state/` and the text built in `lib/` (`rdpStats.ts` and the rest) moved into `en.json`; the guard that fails on visible text outside the catalog, with its allow-list. Verified: the guard green over all of `ui/src`; gui-e2e every run and vitest unchanged; no docs (nothing changes on screen) |
| 68 | **Spanish** | `es.json` complete in neutral Spanish with *tú*; the parity test (`en` ⇔ `es`); the language switch live, no restart; the tray's items, the native dialogs' titles and Touch ID's reason from the driver's table in the chosen language (a CF-NNN if the tray cannot relabel at run time); dates and numbers in Spanish format. Verified: the parity test; gui-e2e runs in Spanish for the vault, settings and a terminal tab; the tray and a native dialog in Spanish on the Mac, the Windows VM and Zorin; the owner reads the main screens in Spanish for text that overflows or reads wrong; docs (desktop app: changing the language; the landing names the two languages) |
| 69 | **The core's messages** | `{code, id, params, message}` (D-084) with the ids and English text in one core file; RPC results and `--json` carrying `id` and `params`; the page's lookup of `core.<id>` with the `message` fallback; the first messages migrated: connection cards (dial, auth, host key unknown and changed), unlock (wrong password, locked, keychain), RDP (connect, credentials, certificate); `scripts/i18n-missing.sh` listing ids without an entry in `en.json` or `es.json`. Verified: `cfire test` that `message` is unchanged for every migrated call; cli-e2e unchanged (the same text and codes) with `--json` showing `id`; vitest of the fallback; gui-e2e of a failed connection and a wrong password in Spanish; docs (CLI reference: `id` and `params` in `--json`; the demo's JSON if it shows an error) |

## Open questions

Settled with the owner on 2026-11-23 (D-140): four milestones of one session each, Flint's
own helper, the system language by default, neutral Spanish with *tú*, no Claude Design run
(the Language row is a select like the theme's). Open, to settle at the milestone's plan:

- **Can cfire `v0.12.2` relabel a tray item at run time?** (68.) If not, a CF-NNN, and the
  tray follows the language from the next start.
- **Where `system` reads the OS language** on each OS (68 for Windows and Linux; macOS's
  `NSLocale` at 66), and whether the webview's `navigator.language` is enough.
