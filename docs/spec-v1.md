# Flint — MVP Technical Specification

**Scope of this document:** the MVP only. Everything beyond it lives in
[`ROADMAP.md`](../ROADMAP.md) and is pulled into the *next* spec when the MVP ships.
This file is static: a decision that changes goes into [`decisions.md`](./decisions.md),
which supersedes the line here.

## Problem

The author runs a personal SSH client, **Tether** (Go + Wails), because the market
alternatives are either paid (MobaXterm, Termius) or heavy. Tether works, but it was an
early AI-era project. It is GUI-only, Go-only, and its vault keeps host metadata
(hostnames, IPs, users) in plaintext inside a file that is synced to OneDrive.

Flint is the rewrite, with three goals:

1. **A better SSH client.** Light, fast and good-looking, with a modern terminal (Kitty
   keyboard protocol, three-key chords). All state lives in a fully encrypted vault that
   can be synced through any cloud folder.
2. **A CLI as a first-class citizen.** The same encrypted vault drives a GUI, a CLI, and
   later an MCP server and an SSH agent. People and AI agents can then reach the author's
   servers by alias, without ever seeing a credential.
3. **Dogfood cfire.** Flint is written in [cfire](https://github.com/gsandoval/cfire), a
   Go/Odin-flavoured language that lowers to C++23, built by a friend of the author.
   Every gap found becomes a concrete, reproducible request in
   [`cfire-upstream.md`](./cfire-upstream.md). Flint is released as open source on top of
   cfire.

**Why "Flint":** a flint is the stone that strikes fire, a nod to cfire.

## Scope

**In scope (MVP):**
- **Vault:** a fully encrypted SQLite file, one master password per vault. It is created
  or opened wherever the user chooses, for example inside a cloud-synced folder.
- **Multi-vault:** a list of recent vaults. The app reopens the last one and lets you switch
  from a vault switcher (Obsidian-style).
- **Auto-unlock:** the key derived from the master password is cached per vault in the OS
  keychain. A vault this machine has seen before opens without a prompt.
- **Hosts:** grouped in nested folders. Each host has a label, hostname, port, tags, colour,
  notes and an optional jump host.
- **SSH keys:** stored *by content* (pasted or imported), encrypted in the vault, with an
  optional passphrase.
- **Credentials:** reusable login profiles (a user plus a password or a key) that many hosts
  link to ("use the domain credential").
- **Auth:** password, stored key, on-disk key, SSH agent. Known-hosts verification with a
  prompt.
- **CLI:** `flint vault|host|key|cred` for CRUD, `flint connect <alias>` for an interactive
  shell, and `flint exec <alias> -- <cmd>`. Every command supports `--json`.
- **GUI:** vault unlock and switcher, a sidebar tree, tabs, an xterm.js terminal with the
  Kitty keyboard protocol, and a command palette.
- **Documentation site:** Astro + Starlight, with a landing page and Docs. It grows with
  every feature.
- **Platforms:** macOS and Linux.

**Out of scope (MVP), tracked in the roadmap:** SFTP, tunnels, Windows, auto-updater,
SSH agent server, MCP, agent tokens and policies, fleet exec, vault sharing, split, import
and export, short-lived certificates, a daemon and shared sessions, splits and broadcast
input, Tether import.

## Stack

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** or **libssh2** via `import cpp` | cfire has no SSH. Both cover PTY, SFTP, agent, forwarding and known_hosts | Writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** (SQLite3MultipleCiphers or SQLCipher) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal. A core that knows nothing about I/O, ports it declares, adapters that
implement them, and thin drivers that expose the same use cases to every surface.

```
 drivers        GUI (webui + React)   CLI   [later: MCP, ssh-agent, daemon API]
                        │              │
 application     use cases: OpenVault, UnlockVault, SwitchVault, Host/Key/Cred CRUD,
                 Connect, Exec, ResolveAuth
                        │
 domain          Vault, Group, Host, SSHKey, Credential, KnownHost, AuthMethod
                        │  ports
 ports           VaultStore · Crypto · Keychain · SshTransport · Terminal · EventSink · Clock
                        │
 adapters        sqlite_vault · sodium_crypto · keychain_{macos,linux} · libssh_transport
                 · webui_events · stdio_terminal
```

Contracts:
- **Drivers hold no business logic.** A GUI binding and a CLI command for the same action
  call the same use case.
- **Secrets never leave the core in clear text** except to the SSH transport at connect
  time. Drivers see derived flags such as `hasPassword`.
- **Streaming is out-of-band.** Terminal bytes travel through `EventSink` and stdio, never as
  RPC return values. The caller mints the session id and subscribes before starting.
- **Every native C++ shim is an adapter**, tagged with its `CF-NNN` entry, so it can be
  rewritten in cfire without touching the core.
- **Vault lifecycle:**
  - *Open* means the file is known and readable. *Unlocked* means the key is held in memory.
  - Startup reopens the last vault, auto-unlocking from the keychain when a cached key exists.
  - With no cached key, startup shows the unlock screen for that vault.
  - With no vault at all, startup shows the welcome screen.
  - The vault switcher lists recent vaults and has *Open…*, *Create…* and *Manage…*.

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, keychain).
2. No business logic in drivers: a GUI binding or CLI command body only parses input, calls
   one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation and AEAD go through
   libsodium only.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration.
6. Secret values never appear in RPC results, CLI output (`--json` included), logs or error
   messages.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec) has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here.

| # | Milestone | Delivers |
|---|---|---|
| 01 | **Scaffold + risk spike** | Repo layout with the hexagonal packages. libssh, libsodium and encrypted SQLite compiling and linked via `import cpp` on macOS and Linux. A throwaway proof: open an SSH PTY and echo it in a webui window. Astro + Starlight site skeleton (landing + Docs). First `cfire-upstream.md` entries confirmed or discarded |
| 02 | **Vault core + CLI** | Encrypted vault create/open/unlock/lock. Recent-vaults list. Keychain auto-unlock. Groups (nested), hosts, keys (by content), credentials. `flint vault\|host\|key\|cred` with `--json`. Docs pages for each |
| 03 | **SSH from the CLI** | Auth resolution (credential → host → key/password/agent), known-hosts verification, jump host, `flint connect <alias>` (interactive, resize-aware) and `flint exec <alias> -- cmd` |
| 04 | **GUI** | Welcome, unlock, vault switcher, sidebar tree, host/key/credential editors, tabs, xterm.js terminal (Kitty protocol, WebGL), connect/auth/host-key prompts, command palette, settings (theme, accent, font). Built from the Claude Design output |
| 05 | **Interactive CLI demo** | A **Try the CLI** button on the landing opens a dimmed overlay with a simulated terminal, built by hand (`<pre>` log + `<input>`, no terminal library). A seeded demo vault in memory, the CLI's commands with their real output, errors and `--json`, a guided tour with a hint above each step, and a fake Linux shared by every host after `flint connect`. Hosts added in the demo live until reload. Tappable command chips on phones; the static hero stays as the no-JS fallback (D-026) |

## Open questions

- **libssh (LGPL-2.1) vs libssh2 (BSD-3).** The licence matters for a static single binary.
  Decide in milestone 01 after the spike.
- **SQLite3MultipleCiphers (MIT) vs SQLCipher (BSD).** Pick whichever is easier to compile
  through cfire's `build.CMake`/`build.CC`.
- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
- **macOS packaging:** is `cfire build --subsystem=gui` enough for a distributable signed
  `.app`?
