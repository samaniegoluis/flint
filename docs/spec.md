# Flint — v11 Technical Specification: Your vault on every machine

**Scope of this document:** version 11 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop) and
[`spec-v10.md`](./spec-v10.md) (The desktop, finished); everything beyond v11 lives in
[`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that changes goes into
[`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v10 shipped (milestones 35-38, `v0.5.0`): the RDP desktop is finished, full screen and on
two monitors. Every machine still holds its own `.flint` file. Sharing one vault between
five machines means passing the file around or putting it in a cloud folder, and a cloud
folder that sees two machines edit at once keeps one side and drops the other (or leaves a
conflict copy nobody merges).

v11 is the self-hosted remote vault decided in D-050: **local-first**, like Obsidian Sync.
Every machine keeps its full copy and works offline (hosts on the local network still
connect); an optional server the owner runs keeps the copies in step. The server never
holds the key and never decrypts anything: it stores the vault file exactly as it is,
encrypted in full, with a version number. When two machines change the vault apart, the
one that uploads second gets a `409`, downloads the other copy, opens both with the key it
already holds, merges them record by record and uploads the result.

One person, one server, one token: each user runs their own instance. Accounts, many users
on one server and a hosted paid service are later (ROADMAP §10, D-092).

## Scope

**In scope (v11), macOS and Linux here; Windows checked by the owner:**
- **The activity log leaves the vault** (milestone 39): a second encrypted database per
  machine in the app's data folder, so the synced file never carries it.
- **Change the master password** (milestone 40): `flint vault passwd` and its place in
  Settings, with a strength estimate shown, so a weak password can be replaced before the
  vault leaves the machine.
- **A sync-ready vault and the per-record merge** (milestone 41): `updated_at` and
  tombstones on every synced table; the merge in pure cfire; `flint vault merge` for a
  cloud folder's conflict copy as its first user.
- **`flint-vault-server`** (milestone 42): a separate binary in this repo, in cfire, run in
  Docker or bare; the Docker image and a *Self-host a remote vault* docs page.
- **Sync in the core and the CLI** (milestone 43): `flint vault connect <url>`, the sync
  itself, conflicts merged, offline edits pushed on reconnect.
- **Connect remote vault in the app** (milestone 44): the screen beside *Create* and
  *Open*, the sync's state, Settings.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Windows:** as in v8-v10. The owner runs Flint on Windows from his own branch over a
patched cfire and checks each milestone there at its close. The server runs on Linux
(Docker) and on macOS bare; a Windows build of the server is not a goal.

**Out of scope (v11), tracked in the roadmap:** accounts and many users on one server, the
hosted paid service (its code may stay private, D-092); shared vaults between users
(ruled out, D-050); the change log + snapshot protocol (`/v2`); a server status page;
built-in TLS in the server (the reverse proxy does it); GHCR publishing from GitHub Actions
(arrives with CI, ROADMAP §7); importing another vault (a different key) and the quick wins
of Order of work block 0; everything v10 left out.

## Stack

v10's, plus the server.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned (D-060) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp`, core library only, frames drawn by Flint (D-070) | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control, the system client, writing RDP ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine**, keyed from the vault key (D-092) | The one table that grows with use and changes on every `flint exec`; synced, it would re-upload the vault on each command | A plain log file (clear text on disk), keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | Used by *Remember on this computer* (D-048) and now the server token | Storing either in a file |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http`, one static binary and a Docker image (D-050, D-092) | A few hundred lines; the hard logic lives in the client. Same language, toolchain and version as Flint, in the same repo, so client and protocol change in one commit | A repo of its own, another language, an off-the-shelf store (WebDAV, S3: no `If-Match` contract of ours, no history rule) |
| Server storage | **Files on a volume**, one per kept version, written by temp file + rename | Atomic, trivially backed up, and the version history falls out of it | SQLite on the server (nothing to query), Postgres |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v10. v11 adds a driver and three ports.

- **`src/drivers/vault-server/`** is a third binary beside the CLI and the app, with its
  own `build.Executable("flint-vault-server", …)`. It shares the protocol's types and
  nothing that pulls in libssh, FreeRDP or SQLCipher. Its storage is a port (`BlobStore`),
  with a file adapter first.
- **The protocol, `/v1`:** `GET /v1/vault` returns the blob, its version and the vault's
  id; `PUT /v1/vault` with `If-Match: <version>` stores a new version, `409` when another
  machine uploaded first, `412`/`400` for a blob of another vault id. A bearer token on
  every request. Versioned from the start so accounts (`/v1/vaults/:id`) and a change log
  (`/v2`) are additions, not rewrites.
- **The client side:** a `VaultRemote` port (HTTP adapter) and a sync use case in
  `application/`; the merge itself in `domain/` (two record sets in, one out, plus a
  report). The CLI, grants, tokens, Touch ID, the tray and `exec --sudo` keep working on
  the local copy and never learn the vault is remote.
- **Per-machine sync state lives in the config folder** (D-030): the server URL, the last
  version seen, whether local changes wait to be uploaded. The server token lives in the
  OS keychain, never in the config.
- **The activity log is per machine** (39): its own file in the app's data folder, tied to
  the vault's stable id (40 decides how the id survives a password change: today it is
  derived from the salt) and keyed from the vault key.

Contracts (v10's stand, plus):
- **Drivers hold no business logic.** A GUI binding, a socket request, a CLI command and an
  HTTP handler for the same action call the same use case.
- **Secrets never leave the core in clear text** except to a transport at connect time
  (SSH, RDP). The server token goes only to the server, in a header, over TLS.
- **Streaming is out-of-band.** Sync progress and state travel as events, not RPC results.
- **One holder of an unlocked vault** (v3). A sync that needs to merge needs the key: a
  locked machine keeps its changes and merges at the next unlock.
- **A downloaded blob replaces nothing until it is opened.** It must open with the vault's
  key and carry the same vault id; then it is merged with the local copy, never written
  over it.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v10's,
plus 13 and 14. Milestones 39-43 touch 5 and 10 (migrations), 40 touches 4, and 42-43
touch 13: expect the owner's review there.

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
    decrypted: its API carries only the encrypted vault file, a version, the vault id and
    the bearer token. It never logs a blob or a token, compares the token in constant time
    through libsodium, refuses to start with a weak one, and caps request size and rate.
14. A sync never loses a change: the client never overwrites its local copy with a
    downloaded one, and never uploads over a version it has not merged. Plain `http://` is
    refused for any server other than `localhost`.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`), plus the owner's Windows check at
each close. Progress is recorded in `docs/build-log.md`, not here. Numbering continues from
v10.

| # | Milestone | Delivers |
|---|---|---|
| 39 | **The activity log leaves the vault** | A second SQLCipher file per machine in the app's data folder (not beside the `.flint`), tied to the vault's id and keyed from the vault key through libsodium's KDF, so it never syncs, not even through a cloud folder. An appended migration moves existing rows out and drops the `activity` table from the vault (the copy runs in code, then the migration; a failure leaves the vault as it was). Retention becomes per machine. Settings → Activity gains *Back up activity…*, which copies the file as it is (still encrypted). Lock closes both files. The CLI's and the app's activity views unchanged in behaviour; adapter and use-case tests for the move, an e2e on a vault with rows from before; docs (activity, security model) |
| 40 | **Change the master password** | `flint vault passwd` and *Change master password* in Settings → Vault: the current password, the new one twice, a strength estimate shown as it is typed (pure cfire in the domain; not cryptography); a new salt, the vault re-keyed (`sqlcipher_export`), every sealed secret re-sealed with the new secrets key, the activity file re-keyed, *Remember on this computer* moved to the new keychain account (D-017), recents and per-machine state kept. **The vault's identity survives the change:** today its id is derived from the salt, so the plan settles a stable id (likely a random id in `meta` by an appended migration, the salt-derived one kept for what already uses it). A crash mid-change leaves the old vault usable. Owner review (Principles 4, 5). Unit tests, cli-e2e, gui-e2e; docs |
| 41 | **A sync-ready vault and the per-record merge** | An appended migration adds `updated_at` and tombstones (deleted records kept as markers) to every synced table: groups, hosts, host tags, credentials, SSH keys, known hosts, tunnels and CLI tokens; every write sets them. **The merge** in `domain/`, pure cfire: two copies of the same vault in, one out, plus a report. Rules (D-093): the newer `updated_at` wins a record changed on both sides; a tombstone newer than an edit wins; records the client does not show are kept; an alias created on both sides offline keeps the first and renames the second (`web-01 (2)`), reported; a token's *last used* takes the later value and is never a conflict. Fuzz and table tests. **First user:** `flint vault merge <copy.flint>` merges a cloud folder's conflict copy of the same vault (same key) into the open one and prints the report (ROADMAP §4). May split into 41b (the CLI) if the plan finds it over one sitting |
| 42 | **`flint-vault-server`** | Starts with a spike on `core:net/http`: a `PUT` route, a request body cap, read and write timeouts, the request's headers; gaps as `CF-NNN`. Then `src/drivers/vault-server/`: `GET` / `PUT /v1/vault` with `If-Match` and `409`, the vault id checked on every upload; the token from `FLINT_VAULT_TOKEN`, or only its hash from `FLINT_VAULT_TOKEN_HASH`, compared in constant time; `flint-vault-server token` prints a new 32-byte random token; it refuses to start with a short one; a rate limit per client, a lockout after repeated bad tokens, a size cap; storage as files on a volume, written by temp file + rename, **the last 10 versions kept** (a history a person restores by hand: documented). A `Dockerfile` and a `docker-compose.yml` with a volume, a local `scripts/server-image.sh` that builds the image (and pushes it to GHCR when asked). Server tests over `Router.dispatch` and a real listening server; docs page *Self-host a remote vault* (Docker, bare binary, a reverse proxy for TLS: Dokploy, NPM, Caddy, rotating the token). Owner review (Principle 13) |
| 43 | **Sync in the core and the CLI** | The `VaultRemote` port with its HTTP adapter and the sync use case. `flint vault connect <url>`: asks for the token (kept in the keychain), refuses `http://` beyond `localhost` and a master password under the strength threshold (pointing to `flint vault passwd`), then uploads the local vault or, if the server already holds one, downloads it as a new local copy. The sync runs at unlock, after each change (batched), and about every 60 s while the app runs; offline edits wait and are pushed on reconnect. A `409` downloads, opens, merges (41) and uploads again; a locked machine keeps its changes and merges at the next unlock; a blob that does not open with the key asks for the new master password (changed on another machine, 40). `flint vault status` shows the remote, the last sync and what waits; `flint vault disconnect`. cli-e2e against a real server with two config folders as two machines (both offline, both edit, both reconnect); docs and the CLI demo. Owner review (Principles 13, 14) |
| 44 | **Connect remote vault in the app** | *Connect remote vault* beside *Create vault* and *Open vault* (URL, token, master password; the same checks as 43), the sync's state in the status bar and Settings → Vault (in step, waiting, offline, merged with a report, needs the new password), *Sync now* and *Disconnect*. Screens designed first in Claude Design. gui-e2e against a real server; docs (remote vault, security model), the landing (a card for the remote vault, the "What's next" item leaves) |

## Open questions

- **The strength threshold** for a master password that may leave the machine (40, 43):
  which estimate (a zxcvbn-style score in pure cfire) and where the line sits; settled at
  40's plan with the owner.
- **The vault's stable id** across a password change (40): a random id in `meta`, and how
  existing per-machine state (keychain account, recents, ui-state, the activity file of
  39) moves to it.
- **Milestone 41's size**: the migration and the merge first; the CLI may split into 41b.
- **How a person restores an older version** from the server's history (42): documented
  by hand first; a `flint vault history` / restore only if it earns a milestone.
- **The owner's Windows checks of milestones 34-38** (the shims written but not compiled
  there: full screen, multi-monitor, CF-127 at 100 % and 150 %): pending, independent of
  v11.
- **Bundling FreeRDP and the other libraries into a release**: a dynamic system package for
  now (D-015); bundling stays in ROADMAP §7.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
