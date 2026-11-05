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
| `flint connect <alias>` (fuzzy picker when no alias given) | `mvp` | Picker part can slip to `next` |
| `flint exec <alias> -- cmd` | `mvp` | |
| `flint exec @group -- cmd`: parallel fan-out, structured JSON per host | `next` | Great for agents and scripts |
| `flint cp a:/path b:/path` (remote ↔ local ↔ remote, by alias) | `next` | |
| `flint tunnel up\|down\|ls <name>` | `next` | |
| `flint ssh-config export` / `ProxyCommand flint proxy %h` so native `ssh` and `scp` resolve aliases | `later` | |
| Shell completions (zsh, bash, fish) | `next` | |

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

## 5. Architecture

| Feature | Status | Notes |
|---|---|---|
| Hexagonal core + adapters + drivers | `mvp` | |
| `flint serve`: daemon holding live sessions over a local socket. GUI, CLI and MCP become clients | `later` | Enables shared sessions, a persistent agent and tunnels |
| `flint attach`: attach the CLI to a session open in the GUI, and vice versa | `later` | Needs the daemon |
| Rewrite native shims in pure cfire as `CF-NNN` entries land | ongoing | See `docs/cfire-upstream.md` |

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

## 7. Platforms & distribution

| Feature | Status | Notes |
|---|---|---|
| macOS + Linux | `mvp` | |
| Windows | `later` | Blocked on CF-001 (WebView2) and CF-010 (POSIX runtime) |
| Signed macOS `.app`, Linux AppImage/tarball, Homebrew tap | `next` | |
| Public landing + docs site deployed | `next` | The site itself is built from milestone 01 |
