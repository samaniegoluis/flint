# Flint — v2 Technical Specification: Daily driver

**Scope of this document:** version 2 only. The MVP it builds on is archived in
[`spec-v1.md`](./spec-v1.md); everything beyond v2 lives in [`ROADMAP.md`](../ROADMAP.md).
This file is static: a decision that changes goes into [`decisions.md`](./decisions.md),
which supersedes the line here.

## Problem

The MVP shipped (milestones 01-05, [`build-log.md`](./build-log.md)): an encrypted vault, a
CLI and a desktop app over it. Using it every day showed the gaps that still keep the
author on **Tether** for daily work:

- Creating or editing a host gives no way to **check it works** before saving it.
- A stored password cannot be **seen or copied** to use somewhere else.
- A host cannot **start a program on connect** (the author opens `herdr` on `codebox`).
- The app **forgets its layout**: the sidebar, its width and which folders were collapsed
  are reset on every launch, and there is no collapse all / expand all.
- A vault cannot be **renamed**, so a test vault cannot become the real one.
- The terminal has one colour scheme; the author uses Aura in Tether.
- Copy from Neovim/tmux/Zellij (OSC 52), dead keys and IME, and the author's existing Tether
  vault are still missing to retire Tether.

v2 closes those gaps. Tether (`~/Personal/Proyectos/go/tether`) is
the reference for behaviour, not for design: where a better way exists, Flint takes it and
records why (D-030, D-031).

## Scope

**In scope (v2):**
- **Test connection:** a button in the host editor that works on the unsaved draft, and
  `flint host test <alias>`. It dials, verifies the host key exactly like a connect (an
  unknown key prompts, a changed key is refused), authenticates and closes.
- **Reveal and copy a password** in the host and credential editors (D-029): hidden by
  default, only while unlocked, hidden again after a few seconds; copy is written by the
  core and the clipboard is cleared after about 30 s. GUI only.
- **Initial command per host** (D-031), with a per-host *return to shell when it exits*
  option. Stored in the vault (migration 003), set from the host editor and
  `flint host add|edit`, honoured by the GUI and `flint connect`; `--no-command` skips it.
- **UI state per machine** (D-030): sidebar open or closed, sidebar width with
  drag-to-resize, collapsed groups per vault, **Collapse all / Expand all** in the tree.
- **Rename a vault:** `flint vault rename <name>` and **Rename** in Manage vaults and
  Settings → Vault. Opening a vault whose file moved replaces its stale recent entry
  (same salt, D-017).
- **Terminal colour themes** in Settings → Terminal, ported from Tether: Default,
  Catppuccin, Tokyo Night, Aura, Dracula, Nord, each dark and light.
- **Leave Tether:** OSC 52 clipboard, dead-key / IME correctness with in-order input, and a
  one-shot import of a Tether vault.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6).

**Out of scope (v2), tracked in the roadmap:** `flint agent` and its setup, agent tokens,
policies, audit log and MCP; SFTP; tunnels; vault sync backends, conflict detection and
snapshots; master-password change; Touch ID; signed builds and packaging; Windows; split
panes; snippets; restoring sessions.

## Stack

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305 | Vetted, constant-time, the same primitives as Tether | cfire `core:crypto/aes` (hand-rolled) |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption (Tether: leaks metadata), a KeePass-style blob |
| Keychain | macOS Security.framework, Linux libsecret, via `import cpp` | cfire has no keychain module | Storing the key in a file |
| Docs | **Astro + Starlight** | Landing and Docs in one site; Markdown docs written alongside code | Docusaurus, VitePress |

## Architecture

Hexagonal. A core that knows nothing about I/O, ports it declares, adapters that
implement them, and thin drivers that expose the same use cases to every surface.

```
 drivers        GUI (webui + React)   CLI   [later: MCP, ssh-agent, daemon API]
                        │              │
 application     use cases: OpenVault, UnlockVault, SwitchVault, Host/Key/Cred CRUD,
                 Connect, Exec, ResolveAuth, TestConnection, RevealSecret, RenameVault
                        │
 domain          Vault, Group, Host, SSHKey, Credential, KnownHost, AuthMethod
                        │  ports
 ports           VaultStore · Crypto · Keychain · SshTransport · Terminal · EventSink · Clock
                 · SettingsStore · RecentStore · UiStateStore · Clipboard
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
- **Per-machine state lives in the config folder, never in the vault** (D-030):
  `settings.json` (preferences), `vaults.json` (recent vaults, D-021) and `ui-state.json`
  (sidebar and tree state). Per-vault entries are keyed by a hash of the vault's salt and
  hold only opaque ids.
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
   libsodium only. **One exception (D-034):** reading a Tether vault derives its key with
   the reference libargon2 (4 lanes, which libsodium cannot do), confined to
   `adapters/vault/tether.cf`; Tether's secrets are still opened with libsodium.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration.
6. **(owner review)** Secret values never appear in RPC results, CLI output (`--json` included), logs or error
   messages. **One exception (D-029):** the GUI's explicit *reveal* action on a password,
   while the vault is unlocked, returns that one value to the page. *Copy* never does: the
   core writes it to the clipboard itself. The CLI has no reveal.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec) has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v1.

**Owner walkthroughs use a copy of a vault.** A build without a migration refuses a vault
written by a newer Flint, and the demo build kept aside (`~/Applications/Flint Demo.app`,
tag `demo-2026-11-05`) must keep opening the owner's vaults. Migration 003 lands in 06.

| # | Milestone | Delivers |
|---|---|---|
| 06 | **Host editor and connect** | **Test connection** (host editor button on the draft + `flint host test <alias>`, with the host-key prompt and the D-019 exit codes). **Reveal and copy** a host or credential password (D-029: one reveal RPC, a `Clipboard` port written by the core and cleared after ~30 s). **Initial command** per host with *return to shell* (D-031, migration 003): host editor fields, `flint host add\|edit --command/--keep-shell`, `flint host show` lists it, GUI tabs and `flint connect` run it, `--no-command` skips it. Docs and the CLI demo updated |
| 07 | **App state and vaults** | `ui-state.json` in the config folder (D-030): sidebar open/closed and width (drag to resize), collapsed groups per vault (salt hash → group ids), **Collapse all / Expand all**; debounced, atomic writes; a damaged file falls back to defaults. **Rename a vault** (`flint vault rename`, Manage vaults, Settings → Vault) and a moved vault's recent entry replaced by salt. **Terminal colour themes** from Tether's `terminalThemes.js`. Docs and the CLI demo updated |
| 08 | **Leave Tether** | **OSC 52** copy into the system clipboard (through the `Clipboard` port). **Dead keys / IME** composed correctly and input delivered in order (the Tether bugs). **`flint import tether <file>`** (and a GUI entry): reads a Tether vault with its master password and writes groups, hosts, keys and credentials into the open Flint vault, reporting what it could not carry over. Docs updated |

## Open questions

- **Flint's licence.** MIT or Apache-2.0. It also depends on cfire publishing a licence
  (CF-009).
- **macOS packaging:** is `cfire build --subsystem=gui` enough for a distributable signed
  `.app`? (Roadmap §7; not in v2.)
- **Tether import (08):** which Tether vault versions to accept, and whether its plaintext
  metadata file is read directly or through a Tether export. Settle at 08's plan.
