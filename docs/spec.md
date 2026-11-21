# Flint — v14 Technical Specification: RDP for daily work, root for a while, server resources

**Scope of this document:** version 14 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine), [`spec-v12.md`](./spec-v12.md) (Toasts) and
[`spec-v13.md`](./spec-v13.md) (Releases); everything beyond v14 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v13 shipped (milestones 48-54, `v0.21.0`): Flint is downloaded, installed and updates itself
on macOS, Linux and Windows. What the owner now meets every day is in the product itself
(D-126):

- **Agents and root.** Setting up a server with an agent, about ten `flint exec --sudo`
  commands he had agreed with each asked for its own approval and Touch ID. And under a
  one-hour grant he cannot see what the agent runs unless he opens Settings → Access.
- **The RDP tab's rough edges.** The remote cursor never changes shape; Caps Lock can come
  out inverted; a remote text field needs two clicks; a long password cannot be pasted into
  Windows' administrator prompt (the secure desktop has no clipboard); there is no audio or
  microphone, which a colleague who works inside a VM and joins calls from it needs; and
  *Automatic* fails against GNOME Remote Login, saying there is no route to a server that
  answered.
- **A server's load** (CPU, memory, network, disk) means leaving the tab to run `htop`.

v14 adds a live notice of what a grant runs, then root approved for a few minutes behind a
switch, the server's resources in the status bar, and the RDP fixes and audio. Signing and
installers move to v15 (D-126).

## Scope

**In scope (v14):**
- **Live server resources** (55, designs 25a, 25b): CPU, RAM, network, disk and uptime of
  the active tab's host in the status bar, with a detail on hover or click, read over a
  second exec channel on the tab's own SSH session; Linux servers; on by default, a setting
  to turn it off and one to colour by load.
- **The live notice of what a grant runs** (56, designs 26*, D-117 (3)-(5), D-127): a toast
  per grant updated in place, View with each command's exit status and duration, Stop; the
  default in Settings, a checkbox in the approval window, a bell per grant.
- **Root for a while** (57, design 25e, D-117 (1)-(2), D-126 (4)): *Allow sudo for a while*
  in Settings → Access (off); with it on, the root window offers 2, 5 or 15 minutes on that
  one host, with a warning every time.
- **RDP input** (58, design 25c): the remote cursor's shape, the lock keys in step, one
  click on a remote field, and **Type clipboard / Type <host>'s password** as keystrokes.
- **RDP connection** (59): *Automatic* falls back to Pipeline once when the server closes
  during the capability exchange and remembers it per host; that close gets its own error
  and card; the two connections 130 ms apart explained; `zorinos-rdp` as a live test target.
- **RDP audio and microphone** (60, design 25d): FreeRDP's `rdpsnd` and `audin`, per host.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check; the
Windows parts on the Windows VM (`windows/vm/`), and the Linux desktop on Zorin, as the
milestone needs them.

**Out of scope (v14), tracked in the roadmap:** signing and installers (**v15**); funding
links (postponed, D-126 (3)); resources of macOS and Windows servers; a per-host switch for
resources; the RDP ActiveX engine on Windows; drive, printer and smartcard redirection, RD
Gateway and the other RDP extras; choosing an audio device other than the system's default;
system notifications and a setting per kind of notice (D-117 (5)); a sudo allowlist; a
SOCKS5 proxy to reach SSH hosts.

## Stack

v13's, unchanged. FreeRDP gains its `rdpsnd` and `audin` channels in all three builds.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned to `v0.12.2` (D-105) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK / WebView2) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Toasts | **Flint's own component** (`ui/`, v12) | A notice per grant is a toast with a key that changes in place | A toast library |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | Covers PTY, exec channels, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp`, core library and the channels Flint loads (D-070), now with `rdpsnd` and `audin` | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control (`later`), the system client |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305; Ed25519 for updates | Vetted, constant-time | cfire `core:crypto` |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption, a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine** (D-092) | The one table that grows with use | A plain log file, keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, Windows Credential Manager | *Remember on this computer* (D-048) and the server token | Storing either in a file |
| HTTP client | **libcurl** | Sync, the manifest and the download | A second HTTP stack |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http` (D-050, D-092) | Same language and toolchain, same repo | A repo of its own |
| Packages and updates | v13's: portable packages, `.deb`/`.rpm`, Flint's signed self-update (D-111, D-124) | Every v14 release reaches people on its own | — |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v13. v14 adds one port on the SSH session, extends grants and the activity
entry, and widens the RDP adapter.

- **Server resources.** A `ServerStats` port on the SSH adapter opens **a second exec
  channel on the tab's own session** (no new connection or authentication) and runs one
  long-lived POSIX `sh` loop that prints a sample of `/proc/stat`, `/proc/meminfo`,
  `/proc/net/dev`, `/proc/loadavg`, `/proc/uptime` and `df -P /` about every 2 s. The
  parsers and the arithmetic (CPU % and rates from the difference of two samples, which
  interfaces count) are pure functions in `domain/`. The application emits one sample per
  tab to the page (`stats:<tab>`); the page shows the focused pane's. The channel closes
  with the tab, the session or the setting, and the loop also ends on its own when its
  stdin closes, so nothing is left on the server (Principle 18). A server that refuses
  exec or answers something unparsable shows nothing and logs no error to the page.
- **Grants that notify** (D-117 (3), D-127). `Grant` gains `notify` (memory only, like the
  grant). `activity_add` returns the entry's id; a new `activity_finish` records the exit
  status and duration when the command ends, or the reason it was refused (an appended
  migration of the activity file). `activity:added` and `activity:finished` carry the entry
  and the grant id; the page groups them per grant in a pure-TS module beside `ToastStore`
  (tested with fake timers): one toast per grant (`key: grant id`), hidden ~10 s after the
  last command, a root period's kept while it lasts.
- **Root periods** (D-117 (1)-(2), D-126 (4)). A root period is a grant of its own kind:
  one caller anchor, **one host**, `exec --sudo` only, at most 15 minutes from the approval,
  presence confirmed once, always notifying. A command that starts inside the period runs
  without a window; one already running is never cut. Flint still types the sudo password
  per command and keeps `sudo -k`. The period exists only while the setting is on; turning
  the setting off ends every period.
- **RDP input.** The adapter registers FreeRDP's pointer callbacks and sends the page each
  pointer's image and hotspot once (cached by id) and which one is active; the page sets it
  as the canvas's CSS cursor. Lock-key state is sent with FreeRDP's synchronize event at
  connect and when the tab takes the focus. **Type** sends text as key events (scan codes
  where the character has one on the session's layout, Unicode events otherwise); *Type
  <host>'s password* reads the password in the core and types it there, so it never
  reaches the page (Principle 6).
- **RDP connection.** The adapter tells a server that closed during the capability
  exchange apart from a network failure (`RDP_ERR_SERVER_CLOSED_SETUP`); in *Automatic* a
  Compatible attempt closed that way is retried once with Pipeline, and the choice is
  remembered per host on this machine (not in the vault).
- **RDP audio.** `rdpsnd` (play here, leave on the remote, or off) and `audin` (the
  microphone, off by default) loaded per host from two new host fields (an appended vault
  migration), on each system's FreeRDP audio backend and default device.

Contracts (v13's stand, plus):
- **Nothing is left running on a server** by the resources loop.
- **A notice never shows a command;** View does, to the person at the screen.
- **Root without a window happens only inside a period the person gave,** on one host,
  with each command on screen.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v13's, with
12 rewritten (owner review, D-117) and 18 added.

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
   resources channel) and every socket and HTTP request the server handles has an explicit
   timeout.
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

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v13.

| # | Milestone | Delivers |
|---|---|---|
| 55 | **Live server resources** | `domain/` parsers for the Linux sample (CPU %, memory and swap, network rates per interface with virtual ones such as `veth*`, `docker*`, `br-*` and `lo` left out, disk of `/`, load averages, uptime, cores and the OS name), tested with captured `/proc` output including a container without lxcfs; the `ServerStats` port on the SSH adapter (a second exec channel on the tab's session, one loop, the channel's timeout, closed with the tab and when the setting turns off; MaxSessions reached = nothing shown); the status bar item (25a1/25a2), the first-sample skeleton (25a7), fewer fields (25a5), none (25a6), split panes following the focused pane (25a8a), the detail (25a9), 900×600 (25a10, Agents and its *waiting* never collapse); Settings → Terminal (25b1: *Show server resources* on, *Colour values by load*). Verified: `cfire test` of the parsers and of the loop's end (no process left after the tab closes, checked on the Docker sshd); gui-e2e against the Docker sshd; the owner's look on codebox; docs (*Terminal*, the security model's line on what Flint runs on a server), the landing's screenshot if the status bar shows in it |
| 56 | **The live notice of what a grant runs** | D-117 (3)-(5) with D-127: `Grant.notify`; `activity_add` returns the id and `activity_finish` records exit status, duration or the refusal (an appended migration of the activity file; *Not a sudoer* and *Sudo password refused* written back); `activity:added`/`activity:finished` with the grant id; the toast per grant (26a1-26a4), hidden ~10 s after the last command and paused while hovered, Stop's in-toast confirm revoking the grant; View (26b1, live, newest first, *running…*, refused rows, Copy); the approval window's checkbox (26c1); Settings → Access's default and the bell per grant (26d1); three grants at once (26e1); notices cleared when the vault locks; aria-live updates throttled. Verified: the grouping module with fake timers; `cfire test` of the migration and of `activity_finish`; cli-e2e and gui-e2e (a grant running several `flint exec`, a failing one, Stop); docs (*AI agents*, *Access*, the vault format's activity file) |
| 57 | **Root for a while** | D-117 (1)-(2) with D-126 (4): *Allow sudo for a while* in Settings → Access, off (25e1/25e2); with it on, the root window's *Allow for* (25e4) and the warning line each time a period is picked (25e5), the notice's row only then (26c2); the root period as its own grant (one anchor, one host, `exec --sudo` only, ≤ 15 min, presence once, never cut mid-command), listed in Active grants and revocable; turning the setting off ends every period; Principle 12 rewritten. Verified: `cfire test` of the period's scope (another host, another caller, a plain exec, a command after the end, the setting turned off: each asks again or is refused); cli-e2e of a period end to end against the Docker sshd's sudoer; the owner's review of Principle 12 and his Touch ID check; docs (*AI agents*' sudo section, the security model) |
| 58 | **RDP input** | The remote cursor's shape (FreeRDP pointer callbacks, cached images, the hotspot, a hidden pointer); Caps Lock, Num Lock and Scroll Lock synchronized at connect and on focus; one click focuses and acts on a remote field; the **Type** menu (25c1-25c3): *Type clipboard* (its character count, disabled with no text) and *Type <host>'s password* typed by the core, with the *Typed N characters* toast; a Stream Deck *Text* action reaching the remote from an RDP tab. Verified: `cfire test` of the key events Type produces (layout scan codes, Unicode fallback); gui-e2e against FreeRDP's test server (the pointer messages, the synchronize event, the typed text); the owner on the Windows VM: the cursor over a resize edge, Caps Lock, one click, a password typed into the UAC prompt, the Stream Deck; docs (*Remote desktop*) |
| 59 | **RDP connection** | A server that closes during the capability exchange told apart from a network failure, with its own error code and card ("the server closed the connection during setup"); *Automatic* retries once with Pipeline after such a close and remembers it per host on this machine; the two connections 130 ms apart found and, if they are Flint's, fixed; `zorinos-rdp` as a live test target with free input (credentials from Infisical `FLINT_RDP_ZORIN_*`, skipped when absent). Verified: `cfire test` of the error mapping and the fallback's choice; a live run against `zorinos-rdp` (Automatic connects, the greeter's redirection followed); docs (*Remote desktop*, the errors) |
| 60 | **RDP audio and microphone** | FreeRDP's `rdpsnd` and `audin` in the three builds (the reduced macOS build included); two host fields, *Play remote audio* (on this computer · on the remote computer · off) and *Microphone* (off), an appended vault migration; the host editor's Audio section (25d1/25d2), the CLI's `host add/edit` flags and `host show`; the system's microphone permission (the macOS usage string; asked again after an unsigned update, documented until v15). Verified: `cfire test` of the migration and the settings passed to FreeRDP; the CLI demo updated; the owner on the Windows VM and on Zorin: sound plays here, the microphone reaches the remote; docs (*Remote desktop*, *CLI*) |

## Open questions

None open at the start. Settled with the owner on 2026-11-21 (D-126, D-127):

- **Order:** resources first (designs ready, easy to test), then the notice, then root.
- **Signing and installers** are v15; **funding** is postponed.
- **The sudo switch** is off by default; root periods are 2, 5 or 15 minutes, never longer.
- **Resources** live in the status bar, Linux servers first.
- **The notice** names program and hosts only, hides ~10 s after its grant's last command
  (root's stays for the period), and View shows exit status and duration.
- **Audio** uses the system's default devices; Microsoft's own RDP engine stays `later`.
