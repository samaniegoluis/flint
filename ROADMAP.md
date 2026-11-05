# Flint — Roadmap

The full backlog. **Nothing we want to build is allowed to live only in a chat.** New
ideas land here first. When the current spec ships, the next spec (`docs/spec-v2.md`, …)
is drawn from the `next` items.

Status: `mvp` (in [`docs/spec.md`](./docs/spec.md)) · `next` (candidate for the next spec)
· `later` · `idea` (not yet evaluated) · `done`.

## 1. Parity with Tether

What Tether already does and Flint must not lose.

| Feature | Status | Notes |
|---|---|---|
| Encrypted vault, master password, OS keychain auto-unlock | `mvp` | Flint encrypts the whole file, not only secrets |
| Multiple vaults + switcher | `mvp` | Obsidian-style: reopen the last one, switch from the sidebar |
| Nested folders, hosts, tags, colour, notes | `mvp` | |
| Stored SSH keys (by content) + import from file | `mvp` | |
| Reusable credentials ("domain login") | `mvp` | |
| Password / key / agent auth, passphrase prompt | `mvp` | |
| Known-hosts verification + prompt | `mvp` | |
| Jump host (ProxyJump) | `mvp` | |
| Tabs, xterm.js, Kitty keyboard protocol, WebGL | `mvp` | |
| Command palette | `mvp` | |
| Theme, accent colour, terminal font from installed fonts | `mvp` | |
| SFTP browser over the same connection: list, up/download with queue, drag & drop, rename, delete, mkdir, `..` | `next` | Needs file drag & drop from the OS (CF-004) |
| File browser opens in the terminal's cwd (OSC 7 shell integration, herdr focused pane) | `next` | |
| Local port-forward tunnels (`-L`), saved per host | `next` | |
| OSC 52 clipboard (copy from Neovim/tmux/Zellij) | `next` | |
| Dead-key / IME correctness, in-order input delivery | `next` | Both were real Tether bugs |
| Customisable keyboard shortcuts | `next` | |
| Remember collapsed groups per vault | `next` | |
| Auto-updater from GitHub releases + "What's new" screen | `later` | |
| Import an existing Tether vault | `next` | One-shot migration for the author |

## 2. CLI

| Feature | Status | Notes |
|---|---|---|
| `flint vault\|host\|key\|cred` CRUD, `--json` everywhere | `mvp` | |
| `flint connect <alias>` | `mvp` | |
| Fuzzy host picker when `flint connect` has no alias | `next` | Slipped from the MVP (milestone 03) |
| `flint exec <alias> -- cmd` | `mvp` | |
| `flint exec` forwards local stdin to the remote command (`cat file \| flint exec web -- 'cat > x'`) | `next` | Today stdin is closed at start (milestone 03) |
| `flint exec --tty` / `connect -- <cmd>`: a command on a PTY | `idea` | |
| Keepalives (`ServerAliveInterval`) for idle `flint connect` sessions | `next` | |
| `flint exec @group -- cmd`: parallel fan-out, structured JSON per host | `next` | Great for agents and scripts |
| `flint cp a:/path b:/path` (remote ↔ local ↔ remote, by alias) | `next` | |
| `flint tunnel up\|down\|ls <name>` | `next` | |
| `flint ssh-config export` / `ProxyCommand flint proxy %h` so native `ssh` and `scp` resolve aliases | `later` | |
| Shell completions (zsh, bash, fish) | `next` | |
| Auto-detect an encrypted key in `flint key add` and prompt for its passphrase | `idea` | Today `--passphrase` must be given |
| Known hosts behind different jump hosts with the same address (two `10.0.0.12`) share one record: key them by jump chain + address, like OpenSSH's `HostKeyAlias` | `later` | Found in the milestone 02/03 owner review; needs a migration |
| `flint vault status` says why a vault is locked: `locked (keychain access denied)` after a Keychain Deny | `next` | Today a denied read looks like no cached key (D-020) |

## 3. Agents & security (the differentiator)

| Feature | Status | Notes |
|---|---|---|
| **`flint agent`**: SSH agent serving keys from the vault, so `ssh`, `git`, VS Code Remote and `scp` work with no key on disk | `next` | Like 1Password's SSH agent |
| **Scoped agent tokens**: `flint token create --hosts @homelab --allow exec,read --ttl 1h`. The agent never sees credentials | `next` | |
| **Per-host policies**: read-only, command allowlist, "ask me in the GUI before running on prod" | `next` | |
| **Audit log** of every command run through a token | `next` | |
| **MCP server**: list hosts, exec, read file, tail logs. All under tokens + policies | `next` | cfire has `McpServer` in `ext:ai` |
| Agent activity panel in the GUI: live timeline, pending approvals | `later` | Very demo-able |
| Session recording (asciicast) | `idea` | |

## 4. Sharing & vaults

| Feature | Status | Notes |
|---|---|---|
| Sync via any cloud folder (OneDrive, Dropbox, iCloud) | `mvp` | Journal mode `DELETE`, not WAL |
| Detect cloud-sync conflict copies and offer to merge | `next` | |
| Split / export a subset of hosts into a new vault ("give these 20 to my team") | `later` | |
| Import / merge another vault | `later` | |
| Multi-recipient vaults: encrypt to teammates' public keys (age-style), revoke access | `later` | Replaces "share the master password" |
| Short-lived SSH certificates: the vault acts as a CA, `flint share --host X --ttl 8h` | `idea` | Teleport/Smallstep, personal-sized |
| Local change log + per-record merge for concurrent edits on two machines | `idea` | Only if conflicts become a real problem |
| Change the master password (`flint vault passwd`): new salt, `sqlcipher_export` re-key, re-seal secrets | `next` | Not in M02. Changes the keychain account (salt-based, D-017) |
| Auto-lock: forget the cached key after N idle days, or require Touch ID / the login password to read it | `idea` | Today the cache lasts until `flint vault lock` |
| **Touch ID to open a vault** (macOS): the cached key is released only after Touch ID, or the login password when there is no sensor; a per-machine setting, offered when the Mac has biometrics (`LAContext.canEvaluatePolicy`) | `next` | Raised in the M04 owner walkthrough. Today, once **Always Allow** is given, anyone using the logged-in Mac opens the vault with no prompt. Strongest form: a Keychain item with `SecAccessControl` `.userPresence`, which needs the data-protection keychain and so a Developer ID-signed build with a keychain-access-groups entitlement; until then an `LAContext` check before reading the item. Linux: polkit/fprintd, later |
| `flint vault check`: verify every sealed secret opens and every reference resolves | `idea` | Cheap integrity check before a sync |

## 5. Architecture

| Feature | Status | Notes |
|---|---|---|
| Hexagonal core + adapters + drivers | `mvp` | |
| `flint serve`: daemon holding live sessions over a local socket. GUI, CLI and MCP become clients | `later` | Enables shared sessions, a persistent agent and tunnels |
| `flint attach`: attach the CLI to a session open in the GUI, and vice versa | `later` | Needs the daemon |
| Rewrite native shims in pure cfire as `CF-NNN` entries land | ongoing | See `docs/cfire-upstream.md` |
| Wipe key material from memory: the master, page and secrets keys when a session ends, and decrypted secrets once libssh has them (`sodium_memzero`) | `next` | Found in the milestone 02/03 owner review; only the hex `PRAGMA key` text is zeroed today |

## 6. UI

| Feature | Status | Notes |
|---|---|---|
| Split panes inside a tab | `next` | |
| Broadcast input to several panes or hosts | `later` | |
| Restore open sessions on relaunch | `next` | |
| Host health and latency dot in the sidebar | `next` | |
| Snippets: saved commands per host or group | `next` | |
| Dual-pane SFTP, remote ↔ remote | `later` | |
| Quick-edit remote files (CodeMirror) | `later` | |
| Light theme polish, more accents | `next` | |
| Terminal colour themes in Settings → Terminal, as in Tether: Default, Catppuccin, Tokyo Night, Aura, Dracula, Nord, each with a dark and a light palette | `next` | Raised in the M04 owner walkthrough (the owner uses Aura). Port the palettes from Tether's `frontend/src/theme/terminalThemes.js`; they replace only the 16 ANSI colours and the terminal background/foreground/cursor, so no new design pass is needed |
| Passphrase prompt for a key whose passphrase is not stored (design screen 10b), and an encrypted on-disk key | `next` | M04 has no such prompt: keys added to the vault keep their passphrase |
| Host key prompt: **Connect once** (trust without recording) | `idea` | Needs a third trust state in the core (D-025) |
| Password prompt: **Save to vault** (create and link a credential from the typed password) | `next` | Left out of M04 |
| Connection lost: automatic retry with backoff and a countdown (design screen 11c) | `next` | M04 offers Reconnect only |
| Connecting card with per-hop progress (jump host, TCP, key exchange, auth, shell — design screen 11a) | `idea` | Needs progress events from the connect use case |
| "No open sessions" page lists recently used hosts (design screen 13b) | `next` | M04 lists hosts alphabetically; recency needs a per-machine history |
| Unlock and create run off the UI thread (Argon2id holds it about a second) | `next` | CF-046; the page keeps painting, but the window does not respond meanwhile |
| Opt out of caching the vault key at unlock ("Remember on this device" unchecked) | `idea` | Today every unlock caches it (D-005); Settings → Vault can forget it |
| Command palette actions in context, as in design screen 09: "New host in <group>", "Reconnect <tab>", "Open Files on <host>", and the `⌘P hosts only` hint in its footer | `next` | Raised in the M04 owner walkthrough; M04 lists the same generic actions everywhere |
| Drag a host between groups in the tree | `next` | M04 changes the folder in the host editor |
| Remember the sidebar width per view and resize it by dragging | `next` | M04 uses the design's default widths |
| gui-e2e on macOS sometimes ends with an empty `e2e:` line: the page stops with no failed step and no report (about 1 run in 6) | `next` | Seen in the M04 owner walkthrough, not diagnosed. Start by logging `window.onerror` and the WebContent process state before `run_webview_test` times out |
| macOS: one title bar. The native traffic lights over the in-app bar (webui `set_frameless`: full-size content, transparent title bar), as in the design | `next` | Found in the M04 owner walkthrough: today the OS title bar ("Flint") sits above the app's bar (D-024). Needs a drag region and left padding for the traffic lights; Linux keeps the OS chrome |

## 7. Platforms & distribution

| Feature | Status | Notes |
|---|---|---|
| macOS + Linux | `mvp` | |
| Windows | `later` | Blocked on CF-001 (WebView2) and CF-010 (POSIX runtime) |
| Signed macOS `.app`, Linux AppImage/tarball, Homebrew tap | `next` | A stable Developer ID signature also stops the Keychain prompt after every update (D-020) |
| Bundle libssh, libsodium, SQLCipher and libcrypto into the `.app` (rpath fix-up) or link them statically | `next` | Today they are dynamic system packages (D-015); a release cannot rely on Homebrew being installed |
| App icon on Linux: the GTK window icon and a `.desktop` file with `assets/app-icon/flint-256.png`; Windows `.ico` when Windows lands | `next` | macOS has it since the M04 owner walkthrough (`assets/app-icon/`, CF-052); webui sets no GTK window icon |
| Public landing + docs site deployed | `next` | The site itself is built from milestone 01 |

## 8. Docs site

| Feature | Status | Notes |
|---|---|---|
| Interactive CLI demo on the landing: overlay terminal, guided tour, demo vault, fake Linux | `mvp` | Milestone 05 (D-026) |
| The hero terminal plays the demo tour by itself (typing animation, termynal-style) before the visitor opens the demo | `idea` | Left out of M05; respect `prefers-reduced-motion` |
