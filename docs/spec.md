# Flint — v15 Technical Specification: Flint waits for you

**Scope of this document:** version 15 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts),
[`spec-v13.md`](./spec-v13.md) (Releases) and [`spec-v14.md`](./spec-v14.md) (RDP for daily
work, root for a while, server resources); everything beyond v15 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v14 shipped (milestones 55-60, `v0.27.0`). Agents now do real work through `flint exec`: the
owner's own tests on the Windows VM and on Zorin run that way, under grants of an hour or
four. What breaks is the waiting (D-134):

- **An approval gives up after a fixed two minutes.** At the desk that is plenty; away from
  it (lunch, a meeting, another room) the agent gets `approval_timeout` again and again.
- **A locked vault fails at once** with `locked` (D-042). The owner unlocks later, nothing
  tells the agent, and the command is never run again.
- **A locked vault does not say why** (a Keychain *Deny* looks like no cached key).
- **Nobody away from the desk knows an agent is waiting.** A content-free alert on the phone
  lets someone a few minutes away come back in time.

v15 makes the wait one setting the person chooses, makes a locked vault wait like an
approval, and sends an optional alert through ntfy. Signing and installers move to v16.

## Scope

**In scope (v15):**
- **Flint waits for you** (61): one approval wait, 2, 5, 10 or 30 minutes, for every
  approval window; a locked vault waits for the unlock within it; `flint vault status` says
  why a vault is locked; the agent guide on how an agent waits that long.
- **Polish** (62): spelling correction off in the remaining fields, the palette's search by
  whole words, one diagnosis pass of `cfire test src/application` on macOS.
- **Alerts on your phone** (63): Settings → **Notifications**, with the wait and ntfy, off by
  default, two content-free alerts, the activity log marking an approval that timed out
  after an alert.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check; the
Windows parts on the Windows VM (`windows/vm/`), as the milestone needs them.

**Out of scope (v15), tracked in the roadmap:** signing and installers (**v16**); other
alert providers (Pushover, Bark), each an adapter later; answering an approval from the
phone (the phone app in `../flint-cloud`; Telegram set aside, D-134 (5)); the CLI on
another machine approved by the desktop's Flint; system notifications and a setting per
kind of notice (D-117 (5)); unlocking the vault from anywhere but the machine.

## Stack

v14's, unchanged, plus a QR encoder in the frontend for 63.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned to `v0.12.2` (D-105) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK / WebView2) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Toasts | **Flint's own component** (`ui/`, v12) | Notices, updates and grants share one corner | A toast library |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | Covers PTY, exec channels, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp` (D-070) | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control (`later`), the system client |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305; Ed25519 for updates; random topics | Vetted, constant-time | cfire `core:crypto` |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption, a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine** (D-092) | The one table that grows with use | A plain log file, keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, Windows Credential Manager | *Remember on this computer* (D-048) and the server token | Storing either in a file |
| HTTP client | **libcurl** | Sync, the manifest, the download, and now an ntfy publish | A second HTTP stack |
| Alerts | **ntfy** (ntfy.sh or the person's own server), behind a notifier port | Open source, free, iOS and Android, no account: one `POST` per alert (D-134 (4)) | Telegram (reads what it relays, and answering would approve from outside the machine), Pushover (paid, closed), Bark (iOS only), Gotify (no iOS app); each may be an adapter later |
| QR code | **A small QR encoder in the frontend**, chosen at 63's plan (pinned, no network) | Subscribing from the phone is a scan | Drawing QR in the core; a link only |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http` (D-050, D-092) | Same language and toolchain, same repo | A repo of its own |
| Packages and updates | v13's: portable packages, `.deb`/`.rpm`, Flint's signed self-update (D-111, D-124) | Every v15 release reaches people on its own | — |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v14. v15 changes how long a request on the socket may wait, and adds one
outbound port.

- **One approval wait.** `Settings.approval_wait` (this machine's, not the vault's): 2, 5,
  10 or 30 minutes, 2 by default. Every approval window (grant, root, token, copy, tunnel)
  takes its deadline from it; `FLINT_APPROVAL_WAIT_MS` stays as the tests' way to shorten
  it. The app tells the CLI how long it will wait (a `wait` frame with the deadline), so the
  CLI has no wait of its own to keep in step, and keeps reading past its socket timeout
  while those frames say the request is alive.
- **A locked vault waits** (revisits D-042). A command that finds its vault locked while the
  app runs no longer fails at once: the app shows its unlock screen and the command waits,
  within the same approval wait, then goes on to its approval or runs under a live grant.
  `locked` (exit 5) remains for nobody unlocking in time and for Flint not starting.
  The CLI still never reads the keychain or holds a key (Principle 11).
- **Why a vault is locked.** The holder keeps the last reason (auto-lock, locked by hand or
  on sleep, never unlocked since start, Keychain access denied) and `vault status` reports it
  (text and `--json`).
- **Alerts** (63). A `Notifier` port in the application layer, one adapter: `ntfy` (libcurl,
  `POST` to `<server>/<topic>`, the network timeout of Principle 8, never retried in a
  loop). The use case sends exactly two kinds, both content-free: *an agent is waiting for
  your approval*, *Flint is locked and an agent is waiting*. Sent once per request, only
  when the setting is on, never for a request the person is already looking at (the window
  is focused) where that can be known. The topic is random (libsodium), per machine, shown
  with a QR and a link; *Send test* publishes a fixed sample. A failure to publish is shown
  in Settings and never blocks or changes the approval.
- **The activity log** records an approval that ended in a timeout after an alert was sent
  (an appended migration of the activity file if a column is needed), so the person can see
  how many were missed away from the desk.

Contracts (v14's stand, plus):
- **An alert carries no content:** no host, user, command, caller, vault name or count.
- **An alert never approves anything;** approving still happens at the machine.
- **One wait value** governs every approval and the locked-vault wait.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v14's, with
8 extended and 19 added (D-134).

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

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v14.

| # | Milestone | Delivers |
|---|---|---|
| 61 | **Flint waits for you** | `Settings.approval_wait` (2, 5, 10, 30 min; 2 by default) for every approval window, chosen in Settings → Access with a note at 30 that the agent must be able to wait that long; the deadline sent to the CLI in a `wait` frame, the CLI reading past its socket timeout while frames come; **a locked vault waits for the unlock** within the same wait and then goes on to its approval (D-042 revisited; `locked` only when nobody unlocks in time or Flint cannot start); `flint vault status` with the reason a vault is locked (text and `--json`). Verified: `cfire test` of the wait's deadline and of the locked-vault path (unlocked in time, not in time, the setting's four values with `FLINT_APPROVAL_WAIT_MS` shortening them); cli-e2e of a command that waits through an unlock; gui-e2e of the setting; docs (*AI agents*: exit codes 5, 15 and 16 as they now behave, and how an agent waits past its own tool's limit, such as running `flint exec` in the background; *Access*; the CLI reference; the CLI demo) |
| 62 | **Polish** | Spelling correction and autocorrect off in every search and name field (one shared input or a pass over them); the palette's search by whole words (the rule agreed in the roadmap row: every word whole and exact in alias, label, hostname, tags or folder, each from any field); one diagnosis pass of `cfire test src/application` spinning on macOS (rule 9: under a pty to see the last test; fixed, rewritten, or closed if it no longer happens). Verified: the fuzzy module's tests with the roadmap's examples (`pinf`, `code`); gui-e2e of the palette; docs where the palette's search is described |
| 63 | **Alerts on your phone (ntfy)** | Settings → **Notifications** (design to come): the approval wait moves here with its explanation; **ntfy**, off by default, server (ntfy.sh by default) and a random topic, a QR and a link to subscribe, *Send test*, the last publish's error; turning it on recommends 5 minutes or more. The `Notifier` port and its ntfy adapter (libcurl, timeout, no retry loop); the two content-free alerts, *an agent is waiting for your approval* and *Flint is locked and an agent is waiting* (higher priority), once per request; the activity log marks an approval that timed out after an alert. Verified: `cfire test` of the use case with a fake notifier (when it sends, which kind, never content, never twice, nothing when off) and of the adapter against a local HTTP stub; gui-e2e of the section; the owner's phone receives both alerts; docs (*Notifications*, *AI agents*, the security model's line on what leaves the machine), the landing if it earns a place |

## Open questions

None open at the start. Settled with the owner on 2026-11-22 (D-134):

- **The wait** is one value, 2, 5, 10 or 30 minutes, for every approval window and for a
  locked vault.
- **ntfy** is the first provider, behind a port; others are adapters later.
- **The QR** is drawn in the frontend.
- **Telegram** was considered and set aside (it reads what it relays, and approving through
  it would move the approval off the machine).
- **Signing and installers** are v16.
