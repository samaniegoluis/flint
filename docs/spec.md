# Flint — v18 Technical Specification: Tunnels and the remote vault, in daily use

**Scope of this document:** version 18 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts),
[`spec-v13.md`](./spec-v13.md) (Releases), [`spec-v14.md`](./spec-v14.md) (RDP for daily
work, root for a while, server resources), [`spec-v15.md`](./spec-v15.md) (Flint waits
for you), [`spec-v16.md`](./spec-v16.md) (Hardening and polish) and
[`spec-v17.md`](./spec-v17.md) (The app in English and Spanish); everything beyond v18
lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes
into [`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v17 shipped (milestones 66-69, `v0.33.0`). The owner's daily use on 2026-11-24, a tunnel
to a database at work and the remote vault behind his homelab's proxy, found two places
where Flint says something that is not true and leaves the person guessing (D-146):

- **A tunnel read `listening · no connections` with nothing on its port.** On the office
  Windows, after a first connect that timed out and a Retry, `netstat` showed no listener on
  `127.0.0.1:5433` and DataGrip was refused; switching the tunnel off and on opened it.
  `states()` (`src/adapters/ssh/native/flint_tunnel.hpp`) reports every listener in a host's
  list as up, and nothing checks that the port answers. The tunnel's error, when there is
  one, is cut to one line with an ellipsis and cannot be read whole.
- **A refused server token reads as a 15-minute lockout, and keeps being sent.** Every 401
  says "a wrong token, or too many wrong ones from here: wait 15 minutes"; a real lockout
  answers 429, which says "try again in a minute". After a 401 the app's sync loop retries
  with a back-off (30 s doubling to 15 min): about five attempts in the first ten minutes
  per machine. Behind NAT
  every machine of a home or an office reaches the server as one public address (the
  owner's server logs `187.145.116.27` for all of his), so a few machines holding an old
  token lock every one of them out (10 wrong tokens in 10 minutes). The self-host guide
  does not explain this, nor Docker Swarm's ingress mesh (Dokploy), which makes every
  client `10.0.0.2` unless `FLINT_VAULT_TRUST_PROXY=1`.

Signing and installers wait for outside steps (the Apple Developer membership, SignPath's
approval), so they move to v19 and this version goes first.

## Scope

**In scope (v18), two milestones sized for one session each:**
- **A tunnel that says what it is** (70): a tunnel reads *listening* only while its port
  answers, a listener that did not open or was lost shows its error, and a tunnel's error
  or warning wraps to as many lines as it needs, with the whole text on hover.
- **A remote vault that stops on a refused token** (71): a 401 pauses automatic sync for
  that vault, with honest 401 and 429 messages; the self-host guide on how clients are
  counted; and the server's small debts: the cause of a `500` in its log, one damaged
  `head.json` no longer failing the listing, `flint-vault-server delete <id>`, and the hint
  of *Connect to a remote vault* on one line.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check; 70's
tunnel on the Windows VM too, where it was seen.

**Out of scope (v18), tracked in the roadmap:** a trusted-proxy count for chained proxies
(`FLINT_VAULT_TRUST_PROXY=2`, until someone needs it); retrying a refused token on its own
(owner, 2026-11-24: a paused vault resumes by hand); tunnels that listen on `::1` (`localhost`
reaches `127.0.0.1` from the clients tried); remote and dynamic forwards; signing and
installers (**v19**).

## Stack

v17's. No new dependency.

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

Hexagonal, as in v17. v18 changes what two existing parts report; no new port, no vault,
socket or server API format change.

- **A tunnel's state** (`adapters/ssh`, 70). A listener is *up* only while it is open: not
  `closed`, holding a socket, and its host session not lost. `listen()` checks once it is
  bound that `127.0.0.1:<port>` answers (`port_answers`, already in the adapter) and returns
  a failure with its reason otherwise, so the use case reports *not started · <why>* instead
  of *listening*. Whether a check while the tunnel is on is needed is decided at 70's plan,
  from what the Windows reproduction shows. The page's row (`TunnelsView.tsx`,
  `TunnelsMenu.tsx`) wraps a `danger` or `warn` state and carries the whole text as `title`.
- **A paused vault** (71). The sync clock (`domain/sync.cf`) learns one more state beside
  its failures: *refused*, set when a sync ends in `ERR_AUTH` from the server. While a vault
  is refused, `sync_due` returns false for every automatic reason (unlock of the same vault
  included, the interval, focus, a pending change, the back-off); it syncs only on the
  person's *Sync now*, a new token saved for that vault (*Replace token*), or a new start of
  the app. The CLI keeps no state between commands and is paced by a person: a command
  that changes a vault still tries once after it and warns, and `flint vault sync` tries
  and says the token was refused. The page shows the vault as refused with *Sync now* and
  *Replace token* at hand. Nothing about the refusal is kept on disk: a restart tries once.
- **The refusal's message** (`adapters/vaultremote`). 401: the server refused the token.
  429: the server asks to wait, with the wait from its `Retry-After` (a lockout says up to
  15 minutes, a rate limit about a minute). Both through the core's message ids (D-145),
  with entries in `en.json` and `es.json`.
- **The server** (`flint-vault-server`). A `500`'s cause (an I/O error naming paths under
  the data folder, never a token or a byte of a vault) goes into the reply's `note`, which
  reaches the log only. `blob_vaults` skips a vault whose `head.json` cannot be read and
  logs its id. `delete <id>` removes one vault's folder after asking, taking the id or a
  unique prefix as `versions`, `restore` and `label` do.

Contracts (v17's, plus):
- **A tunnel never reads *listening* while its port refuses a connection.**
- **One refused token makes one attempt per machine until the person acts** in the app (a
  restart, a *Sync now*, a new token); the CLI tries once per command that changes it.
- **The server's API does not change:** same routes, same codes; only its log says more.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v17's, unchanged.

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
`docs/build-log.md`, not here. Numbering continues from v17.

| # | Milestone | Delivers |
|---|---|---|
| 70 | **A tunnel that says what it is** | First the reproduction on `Windows11-Flint-SSH` (a host whose first connect times out, then Retry, then `netstat`), with `diag:` lines if it does not show at once (CLAUDE.md rule 9); `states()` reports a listener that is closed, has no socket or whose session is lost as down; `listen()` checks that its port answers once bound and fails with the reason otherwise; the cause found by the reproduction fixed; `danger` and `warn` states wrap (`white-space: normal`, `overflow-wrap: anywhere`, the icon at the first line) and carry `title` in the Tunnels view and the toolbar's menu. Verified: `cfire test` of the adapter (a listener closed under it reads down; a bind that does not answer fails); the reproduction on the Windows VM passes after the fix, `netstat` showing the port whenever the row says *listening*; gui-e2e of a long tunnel error read whole in a narrow pane; docs (Tunnels: what *listening* means, a tunnel that did not start) |
| 71 | **A remote vault that stops on a refused token** | The sync clock's *refused* state and `sync_due` honouring it; the app not syncing a refused vault on its own, *Sync now*, *Replace token* and a restart trying again (the CLI unchanged: one attempt per command that changes the vault); the vault's status in the page saying it is refused, with its two actions; the 401 and 429 messages through core ids in both catalogs; the self-host guide: how the server counts a client (a public address: a home, an office or a VPN with masquerade is one client), Docker Swarm's ingress mesh and `FLINT_VAULT_TRUST_PROXY=1` behind a proxy, the path through a proxy to a published port (Nginx Proxy Manager → Dokploy), reading the client in the server's log, a published port open on the LAN (the token in plain HTTP, a forgeable `X-Forwarded-For`: publish it to the proxy alone where the host allows it), and a local DNS name so machines on the LAN count apart; a `500`'s cause in the server's log; a damaged `head.json` skipped and logged; `flint-vault-server delete <id>` asking first; the *Connect to a remote vault* hint in one span. Verified: `cfire test` of `sync_due` (refused: no automatic reason syncs, *now* does) and of the server (a 500's note, a damaged head skipped, delete); sync-e2e: a wrong token makes one request and then none for several intervals, *Sync now* makes one more, a new token resumes; server-e2e of `delete`; cli-e2e of the messages; docs (Self-host a remote vault; the CLI reference of `delete`; the remote vault page: a refused vault; the CLI demo if it shows a refusal) |

## Open questions

Settled with the owner on 2026-11-24 (D-146): two milestones of one session each, before
signing; a refused vault resumes by hand or at a restart, never on a timer. Open, to settle
at each milestone's plan:

- **What left the tunnel without its port** (70): a stale listener after the Retry, a bind
  that failed silently, or something else; the reproduction decides whether a periodic
  check while it is on earns its place.
- **What counts as "refused"** (71): only a 401 from the server, or also a 429 during a
  lockout (likely not: a 429 says to wait, and the back-off already does).
