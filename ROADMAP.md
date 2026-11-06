# Flint — Roadmap

The full backlog. **Nothing we want to build is allowed to live only in a chat.** New
ideas land here first. When the current spec ships, the next spec (`docs/spec-v2.md`, …)
is drawn from the `next` items, and the shipped one is archived as `docs/spec-v<N>.md` (the MVP is [`docs/spec-v1.md`](./docs/spec-v1.md)).

Status: `mvp` (in the current spec, [`docs/spec.md`](./docs/spec.md)) · `next` (candidate for the next spec)
· `later` · `idea` (not yet evaluated) · `done`.

## 1. Parity with Tether

What Tether already does and Flint must not lose.

| Feature | Status | Notes |
|---|---|---|
| Encrypted vault, master password, OS keychain auto-unlock | `done` | Flint encrypts the whole file, not only secrets |
| Multiple vaults + switcher | `done` | Obsidian-style: reopen the last one, switch from the sidebar |
| Nested folders, hosts, tags, colour, notes | `done` | |
| Stored SSH keys (by content) + import from file | `done` | |
| Reusable credentials ("domain login") | `done` | |
| Password / key / agent auth, passphrase prompt | `done` | |
| Known-hosts verification + prompt | `done` | |
| Jump host (ProxyJump) | `done` | |
| Tabs, xterm.js, Kitty keyboard protocol, WebGL | `done` | |
| Command palette | `done` | |
| Theme, accent colour, terminal font from installed fonts | `done` | |
| SFTP browser over the same connection: list, up/download with queue, drag & drop, rename, delete, mkdir, `..` | `next` | File drag & drop from the OS: cfire `466751b` emits `files:dropped` (CF-004), not tried yet |
| File browser opens in the terminal's cwd (OSC 7 shell integration, herdr focused pane) | `next` | |
| Local port-forward tunnels (`-L`), saved per host | `next` | When it ships, `flint import tether` should carry Tether's tunnels too (today it lists them as not imported, D-034) |
| OSC 52 clipboard (copy from Neovim/tmux/Zellij) | `done` | Milestone 08 (D-034): write only, through the core |
| Dead-key / IME correctness, in-order input delivery | `done` | Milestone 08. Both were real Tether bugs; now under unit and gui-e2e tests |
| Customisable keyboard shortcuts | `next` | |
| Remember collapsed groups per vault | `done` | Milestone 07 (D-030) |
| Auto-updater from GitHub releases + "What's new" screen | `later` | |
| Import an existing Tether vault | `done` | Milestone 08 (D-034): `flint import tether` and Settings → Vault |
| **Remove `flint import tether`** and its GUI entry, libargon2 and the Tether fixture once the owner has moved his vault: the owner is Tether's only user, so the importer has no other audience. Replace it with Flint's own export / import (section on vaults: "Split / export…", "Import / merge…") | `next` | Owner, after the M08 build (2026-11-06). Removing it also drops the one P4 exception (D-034); record the removal as a new decision |
| **Test connection** in the host editor (on the unsaved draft) and `flint host test <alias>`: dial, verify the host key like a real connect, authenticate, close | `mvp` | Milestone 06. Tether has it (`TestConnection`); raised by the owner while using the MVP |
| **Reveal and copy a password** in the host and credential editors: hidden by default, only while unlocked, hides again after a few seconds; copy is written by the core straight to the clipboard and cleared after ~30 s. GUI only, no CLI `--reveal` | `mvp` | Milestone 06 (D-029, narrows P6). Tether has the eye button (`RevealHostPassword`) |
| **Initial command per host** (e.g. `herdr` on codebox), with a per-host "return to shell when it exits" option. Run through the remote login shell, like `ssh -t host cmd`, not instead of it as Tether did; `flint connect` honours it, `--no-command` skips it | `mvp` | Milestone 06 (D-031, migration 003). Tether has `InitialCommand` |
| GUI: open a session **without the initial command** (a palette action, e.g. "Connect to codebox without herdr"), like `flint connect --no-command` | `next` | Found while building milestone 06: in the app a broken initial command can only be cleared in the host editor |
| `flint host test @group` / test every host in a folder from the GUI, with a summary | `idea` | Milestone 06 tests one host |
| Sidebar open/closed remembered, and **Collapse all / Expand all** in the host tree, all remembered per machine | `done` | Milestone 07 (D-030). Tether has both (config file beside the app) |

## 2. CLI

| Feature | Status | Notes |
|---|---|---|
| `flint vault\|host\|key\|cred` CRUD, `--json` everywhere | `done` | |
| `flint connect <alias>` | `done` | |
| Fuzzy host picker when `flint connect` has no alias | `next` | Slipped from the MVP (milestone 03) |
| `flint exec <alias> -- cmd` | `done` | |
| `flint exec` forwards local stdin to the remote command (`cat file \| flint exec web -- 'cat > x'`) | `next` | Today stdin is closed at start (milestone 03) |
| `flint exec --tty` / `connect -- <cmd>`: a command on a PTY | `next` | `flint exec --sudo` (section 3) depends on it |
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
| **Flint grants vault access, not the OS keychain** (D-038, `docs/vault-access-model.md`): the unlocked key lives in the running app (later `flint serve`); `flint` becomes a client of it over a local socket (Unix socket 0600, named pipe on Windows) | `next` | The base for everything below. Today any program that runs `flint` opens a cached vault, and on Linux/Windows any program can read the cached key itself |
| **Caller approval window**: who asks (peer pid/uid, executable and parent chain: "`flint` started by Claude Code"), which vault, which hosts, for how long; Deny / Allow | `next` | Same isolated window as the sudo approval below. A grant is scoped (hosts/groups, actions) and expires |
| **The CLI asks for an unlock**: with Flint closed or locked, `flint` starts the app on its unlock screen naming the caller; one step unlocks and approves. A person at a terminal can still type the master password for one command; an agent with no terminal gets `locked` with "open Flint" | `next` | Owner, M10 planning (2026-11-06): "I want to use the CLI, so I open Flint" |
| **Tray with two locks**: closing the window keeps Flint in the menu bar / system tray, still serving approved grants, but the **window** is locked: opening it asks for the master password or Touch ID | `next` | Owner idea, M10 planning. Protects against a person at the machine while agents keep working. Needs a tray icon in `ext:webui` (check, then a CF entry) |
| **Auto-lock** the vault after a configurable idle time, on screen lock and on sleep; zero the key on lock | `next` | Replaces the "forget the cached key after N idle days" idea in section 4 |
| **Remember on this computer**: an opt-in checkbox at unlock (off by default) that caches the key so Flint reopens without the master password, with the risk in place: "Flint, the `flint` CLI and the agents you approve open this vault without the master password. Anyone using this computer while it is unlocked can open Flint too" | `next` | Today the key is cached on every unlock (D-005). After D-038 the checkbox no longer opens the vault to any program, only to Flint |
| **Presence check without signing**: Touch ID (`LAContext`), Windows Hello, polkit/fprintd to unlock the window and approve callers | `next` | Works on an unsigned build, unlike a Touch ID-gated Keychain item (section 4), which still needs Developer ID |
| **`flint agent`**: SSH agent serving keys from the vault, so `ssh`, `git`, VS Code Remote and `scp` work with no key on disk | `next` | Like 1Password's SSH agent. Speaks the ssh-agent protocol on a socket of its own (e.g. `~/Library/Application Support/Flint/agent.sock`); signs challenges, never hands a key out. Nothing finds it on its own: `ssh` reads the socket path from `IdentityAgent` in `~/.ssh/config` (preferred: apps started from the Dock, such as VS Code, never see `.zshrc`) or from `SSH_AUTH_SOCK`. Everything built on OpenSSH (`git`, `scp`, `rsync`, Ansible, VS Code Remote-SSH) inherits it; JetBrains Gateway needs "OpenSSH config and authentication agent". Locked vault → the agent offers no keys and `ssh` moves on to its other methods |
| **Use Flint as SSH agent** setup: a button in Settings and `flint agent setup` that show the `IdentityAgent` line, ask, and write it into `~/.ssh/config` inside a marked block that **Turn off** removes cleanly | `next` | Raised by the owner while reviewing `flint agent`: other tools must be told where the agent is, and Flint should do that in one click |
| The agent starts on demand when its socket is touched (launchd on macOS, a systemd user socket on Linux), so `git push` works with the app closed; optionally offers the unlock dialog when a locked vault is asked for a key | `next` | Without it, a closed Flint means "could not open a connection to your authentication agent" |
| Per-use confirmation in the GUI: "`git` wants to use key `github-personal`. Allow?" | `next` | Stops a script or an AI agent from using keys unnoticed |
| The agent offers only the key that belongs to each host (`IdentityFile` with the public key, written by `flint ssh-config export`), to avoid "Too many authentication failures" after ~6 keys | `next` | Pairs with `flint ssh-config export` (section 2): the agent gives keys, the export gives host aliases |
| **Scoped agent tokens**: `flint token create --hosts @homelab --allow exec,read --ttl 1h`. The agent never sees credentials | `next` | |
| **Per-host policies**: read-only, command allowlist, "ask me in the GUI before running on prod" | `next` | |
| **Audit log** of every command run through a token | `next` | |
| **`flint exec --sudo -- <argv>`**: run a command as root on a host whose login user is a sudoer, approved by the owner, never by the caller | `next` | Raised while an AI agent set up a Linux box over `flint exec` and had to hand every `sudo` step to the owner (2026-11-06). Flint builds the line itself, `sudo -p <random nonce> -- <argv>` with each argument quoted (never a shell string), on a PTY; it types the host's password from the vault once, and only when it sees its own nonce prompt, so a command that prints a fake `password:` gets nothing. Then `sudo -k`, so the 15-minute sudo cache cannot carry unapproved commands. The caller sees output and exit code only. Distinct errors for *denied by the owner*, *approval timed out* and *user is not a sudoer*. Without `--sudo`, `sudo` fails as today. Depends on `flint exec --tty`. D-036 |
| **Sudo approval window**: Flint's own dialog (not the keychain prompt, which cannot show the command) naming the caller, host, user and the exact argv, with Deny / Approve | `next` | Part of `flint exec --sudo`. **An isolated window, the same whether the app is open or closed**: the CLI has already opened the vault (keychain-cached key, D-005) and resolved host, user and password, so the window loads no vault and starts no app; it shows what the CLI hands it and answers yes or no. The CLI spawns it as a child and reads the answer on a private pipe, so the caller cannot forge an "approved" (a socket to the running app could be). Approve proves presence, not knowledge of the host password: Touch ID on macOS, the vault password where there is no biometric. Only when the CLI cannot open the vault on its own does the window first ask for the vault password. No answer in ~2 min = denied. Every decision goes to the audit log. Open question: whether `ext:webui` can open a small window without the full app, or this needs its own helper |
| Per-host **sudo password** field, defaulting to the login password | `next` | Part of `flint exec --sudo`, for hosts that log in with a key: the approval window asks once and offers to save it |
| Sudo through `flint agent` (`pam_ssh_agent_auth`): sudo on the server authenticates with a key in the forwarded agent, no password | `idea` | **May never ship: weigh the risk first.** The agent signs for any program on its socket (git, VS Code, scripts) and only sees a challenge, never the command, so its prompt can say "something on ZorinOS asks to authorize sudo" but not what will run. That is why the CLI path above comes first. If ever built, three locks: a dedicated sudo-only key, never a login key; confirmation on every use for that key, not switchable off; agent forwarding (`ssh -A`, which this needs) only on request, since root on the server can use a forwarded socket while you are connected. Needs a one-time root setup of PAM and sudoers on each host. For people using plain `ssh` or VS Code, not for AI agents. Prior art: Secretive, 1Password and `ssh-add -c` confirm-per-use, Teleport per-session MFA, `sudoreplay`/`sudo_logsrvd` |
| **MCP server**: list hosts, exec, read file, tail logs. All under tokens + policies | `next` | cfire has `McpServer` in `ext:ai` |
| Agent activity panel in the GUI: live timeline, pending approvals | `later` | Very demo-able |
| Session recording (asciicast) | `idea` | |

## 4. Sharing & vaults

| Feature | Status | Notes |
|---|---|---|
| Sync via any cloud folder (OneDrive, Dropbox, iCloud) | `done` | Journal mode `DELETE`, not WAL |
| Detect cloud-sync conflict copies and offer to merge | `next` | |
| Split / export a subset of hosts into a new vault ("give these 20 to my team") | `later` | |
| Import / merge another vault | `later` | The successor of `flint import tether`: same report (added, already present, changed, not imported) and the same re-run rule, so most of `src/application/tether.cf` carries over. Possible uses: moving hosts between a personal and a work vault, restoring from an export, merging a vault a teammate shared |
| **Import from other SSH clients** (MobaXterm sessions, mRemoteNG `confCons.xml`, Termius export, SecureCRT, `~/.ssh/config`) through the same import as "Import / merge another vault": one report, the same re-run rule | `idea` | Owner, M08 review (2026-11-06): grow the Flint import into the place other clients' exports come in, testing each against a real export |
| The generic import's GUI as a **large centred modal** (`min(90vw, 1040px) × min(85vh, 760px)`) with a real preview table (filter, perhaps choose what to import), not a side drawer | `idea` | Owner, M08 review (2026-11-06): the Tether drawer was widened to 50% with wrapping notes as a stopgap, since it will be removed |
| Multi-recipient vaults: encrypt to teammates' public keys (age-style), revoke access | `later` | Replaces "share the master password" |
| Short-lived SSH certificates: the vault acts as a CA, `flint share --host X --ttl 8h` | `idea` | Teleport/Smallstep, personal-sized |
| Local change log + per-record merge for concurrent edits on two machines | `idea` | Only if conflicts become a real problem |
| Rename a vault: `flint vault rename <name>` and **Rename** in Manage vaults / Settings → Vault (the name lives in the vault's meta and is copied to `recents.json`, D-021). Moving the file stays a Finder job, but opening a moved vault replaces its stale recent entry (same salt, D-017) instead of leaving a dead one | `done` | Milestone 07. Raised in the M04 owner walkthrough: the owner wants to turn a test vault into the real one. Today the name is fixed at creation |
| Change the master password (`flint vault passwd`): new salt, `sqlcipher_export` re-key, re-seal secrets | `next` | Not in M02. Changes the keychain account (salt-based, D-017) |
| Auto-lock: forget the cached key after N idle days, or require Touch ID / the login password to read it | `idea` | Superseded by **Auto-lock** and **Presence check** in section 3 (D-038). Today the cache lasts until `flint vault lock` |
| **Touch ID to open a vault** (macOS): the cached key is released only after Touch ID, or the login password when there is no sensor; a per-machine setting, offered when the Mac has biometrics (`LAContext.canEvaluatePolicy`) | `next` | For **Remember on this computer** (section 3, D-038); presence checks for the window and approvals do not need this and come first. Raised in the M04 owner walkthrough. Today, once **Always Allow** is given, anyone using the logged-in Mac opens the vault with no prompt. Strongest form: a Keychain item with `SecAccessControl` `.userPresence`, which needs the data-protection keychain and so a Developer ID-signed build with a keychain-access-groups entitlement; **no interim `LAContext` check**: on an unsigned build it would add Touch ID on top of the Keychain dialog after every update, and the owner prefers no Touch ID to two prompts (M04 owner walkthrough). So this lands with the signed build, as one Touch ID per open. Linux: polkit/fprintd, later |
| `flint vault check`: verify every sealed secret opens and every reference resolves | `idea` | Cheap integrity check before a sync |

## 5. Architecture

| Feature | Status | Notes |
|---|---|---|
| Hexagonal core + adapters + drivers | `done` | |
| `flint serve`: daemon holding live sessions over a local socket. GUI, CLI and MCP become clients | `next` | Enables shared sessions, a persistent agent and tunnels. Moved up from `later` by D-038: the app plays this role first (vault access, section 3), and `flint serve` is the headless form of it |
| `flint attach`: attach the CLI to a session open in the GUI, and vice versa | `later` | Needs the daemon |
| Rewrite native shims in pure cfire as `CF-NNN` entries land | ongoing | See `docs/cfire-upstream.md`. Milestone 09 (cfire `466751b`) did the first pass; what is left is listed there as `partly resolved` / `not adopted` |
| GUI session mailboxes and vault/SSH locks in cfire (`sync` channels with `recv_timeout`, `sync.Mutex`) instead of `flint_gui.hpp` / `flint_vault_lock.hpp` | `idea` | CF-026: possible now in part, but cfire's `Mutex` neither owns its data nor is recursive (`LockedVaultStore` needs re-entry), and `ch.len()` does not compile. A rewrite of the GUI's threading, worth its own milestone |
| Terminal output as bytes instead of base64 text in `terminal:output` | `idea` | CF-003: only worth it once webui has a real binary channel; `emit_bytes` today is base64 plus one `eval_js`, like Flint's `emit` |
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
| Terminal colour themes in Settings → Terminal, as in Tether: Default, Catppuccin, Tokyo Night, Aura, Dracula, Nord, each with a dark and a light palette | `done` | Milestone 07. Raised in the M04 owner walkthrough (the owner uses Aura). Port the palettes from Tether's `frontend/src/theme/terminalThemes.js`; they replace only the 16 ANSI colours and the terminal background/foreground/cursor, so no new design pass is needed |
| Passphrase prompt for a key whose passphrase is not stored (design screen 10b), and an encrypted on-disk key | `next` | M04 has no such prompt: keys added to the vault keep their passphrase |
| Host key prompt: **Connect once** (trust without recording) | `idea` | Needs a third trust state in the core (D-025) |
| Password prompt: **Save to vault** (create and link a credential from the typed password) | `next` | Left out of M04 |
| Connection lost: automatic retry with backoff and a countdown (design screen 11c) | `next` | M04 offers Reconnect only |
| Connecting card with per-hop progress (jump host, TCP, key exchange, auth, shell — design screen 11a) | `idea` | Needs progress events from the connect use case |
| "No open sessions" page lists recently used hosts (design screen 13b) | `next` | M04 lists hosts alphabetically; recency needs a per-machine history |
| Unlock and create run off the UI thread (Argon2id holds it about a second) | `next` | The page keeps painting, but the window does not respond meanwhile. cfire `466751b` has `app.bind_async` (CF-046), a direct fit for these two calls |
| Opt out of caching the vault key at unlock ("Remember on this device" unchecked) | `idea` | Today every unlock caches it (D-005); Settings → Vault can forget it |
| Command palette actions in context, as in design screen 09: "New host in <group>", "Reconnect <tab>", "Open Files on <host>", and the `⌘P hosts only` hint in its footer | `next` | Raised in the M04 owner walkthrough; M04 lists the same generic actions everywhere |
| Drag a host between groups in the tree | `next` | M04 changes the folder in the host editor |
| Remember the sidebar width per view and resize it by dragging | `mvp` | Milestone 07 (D-030). M04 uses the design's default widths |
| gui-e2e's vim step fails on Linux (Xvfb): vim starts and shows `[New]`, but after `ihello`, Esc and `:wq` the file is never written (`vim-42` never appears). The Linux image had no vim at all until milestone 06, so the step had never run there | `next` | Found in the milestone 06 Linux check. Since 2026-11-06 gui-e2e skips the step on Linux and logs `skip vim`; `FLINT_E2E_VIM=1 scripts/linux-check.sh` runs it, for whoever fixes it (then drop the switch). Start by dumping the terminal buffer on timeout; suspect the synthetic keydowns under WebKitGTK |
| A hostname that resolves to IPv6 first (`localhost` → `::1` on Debian) fails with "Connection refused" when the server listens only on IPv4: Flint does not fall back to the next address, as `ssh` does | `next` | Found in the milestone 06 Linux check (the test sshds listen on 127.0.0.1). Check libssh's address handling; may need to resolve and try each address in the adapter |
| gui-e2e on macOS sometimes ends with an empty `e2e:` line: the page stops with no failed step and no report (about 1 run in 6) | `next` | Seen in the M04 owner walkthrough, not diagnosed. Start by logging `window.onerror` and the WebContent process state before `run_webview_test` times out. Later runs narrowed it: the report stops right after `vim redraws after its start-up queries (DECRQM)`, the step that types into vim, in 5 of 6 empty runs; one sat in a check waiting on a synthetic ↵, which never submits a form |
| Selected terminal text can render in another font: the WebGL renderer rasterises glyphs into its atlas when the terminal opens, and a selection redraws those cells (new background) with whatever font is available by then. Seen with `MesloLGL Nerd Font Mono`; changing the font in Settings (which rebuilds the atlas) made it near invisible | `next` | Found in the M09 owner review; not caused by M09 (no `ui/` change). Fix in `ui/src/sessions/TerminalView.tsx`: after `document.fonts.ready` (and on later font loads), call `webgl.clearTextureAtlas()`. Tether avoids it by opening with `monospace` and setting the font later |
| macOS: one title bar. The native traffic lights over the in-app bar (webui `set_frameless`: full-size content, transparent title bar), as in the design | `next` | Found in the M04 owner walkthrough: today the OS title bar ("Flint") sits above the app's bar (D-024). Needs a drag region and left padding for the traffic lights; Linux keeps the OS chrome |

## 7. Platforms & distribution

| Feature | Status | Notes |
|---|---|---|
| macOS + Linux | `done` | |
| Windows | `later` | cfire `466751b` added a Win32 runtime and a "WebView2" backend, but a cross-compile (2026-11-06) shows the prelude does not compile for Windows and the backend opens an empty window with no WebView2 (CF-001, CF-010 reopened); Flint's own native shims (keychain, process, fonts, clipboard) have no Windows side yet. The owner wants it (M04 owner walkthrough), not urgently: until then, keep new platform code behind adapters so Windows stays a port, not a rewrite. The shortcut table and keychain copy name macOS and Linux only |
| Signed macOS `.app`, Linux AppImage/tarball, Homebrew tap | `next` | A stable Developer ID signature also stops the Keychain prompt after every update (D-020) |
| Bundle libssh, libsodium, SQLCipher and libcrypto into the `.app` (rpath fix-up) or link them statically | `next` | Today they are dynamic system packages (D-015); a release cannot rely on Homebrew being installed |
| App icon on Linux: the GTK window icon and a `.desktop` file with `assets/app-icon/flint-256.png`; Windows `.ico` when Windows lands | `next` | macOS has it since the M04 owner walkthrough (`assets/app-icon/`; declared in `build.cf` since M09). cfire `466751b` has `app.set_icon(path)` for the GTK window (CF-052), not tried; GTK takes a PNG, not the `.icns` |
| Public landing + docs site deployed | `next` | The site itself is built from milestone 01 |

## 8. Docs site

| Feature | Status | Notes |
|---|---|---|
| Interactive CLI demo on the landing: overlay terminal, guided tour, demo vault, fake Linux | `done` | Milestone 05 (D-026) |
| Landing sections: the desktop app beside the CLI, scripts and agents, security, what's next | `done` | D-027; screenshots from `npm run shots:gui` |
| Landing section for AI agents (MCP server, scoped tokens, policies, the approval flow in the GUI) | `next` | Once the MCP server ships; today it is one line in "What's next" |
| Comparison with other SSH clients on the landing (Termius, MobaXterm, Tether) | `later` | Only once SFTP and tunnels ship; today it would argue against Flint |
| More app screenshots on the landing and the desktop-app guide (command palette, host editor, host-key prompt) | `idea` | `shots:gui` can drive them; one more `screens` entry each |
| The hero terminal plays the demo tour by itself (typing animation, termynal-style) before the visitor opens the demo | `idea` | Left out of M05; respect `prefers-reduced-motion` |

## 9. Other protocols

| Feature | Status | Notes |
|---|---|---|
| **RDP hosts, step 1: hand off to the native client.** An `rdp` host type in the vault; `flint connect` and the GUI open the system client with the vault's credentials (`cmdkey` + `mstsc` on Windows, `xfreerdp /from-stdin` on Linux, Windows App on macOS) | `later` | Cheap, and the vault becomes the single place for RDP logins too. Weak spot: the macOS Windows App takes no password from a `.rdp` file or the command line, so there it is copy-to-clipboard or `xfreerdp` under XQuartz. Tether tried RDP and gave up |
| **RDP hosts, step 2: embedded RDP sessions with libfreerdp** (FreeRDP 3, C, Apache 2.0) in a tab, like SSH sessions: framebuffer to a canvas in the webview, keyboard/mouse mapping (layouts, Cmd vs Ctrl), clipboard, resize, NLA/CredSSP | `later` | The owner's preferred option. Works on macOS, Linux and Windows: Flint would use only the core library and render frames itself, so FreeRDP's own per-platform clients do not matter. Linking C fits cfire (a shim in `adapters/` + a `CF-NNN` entry), unlike cgo in Tether. A spec of its own, not a milestone. Windows inherits Flint's own Windows blockers (CF-001, CF-010). Not rdpwrap: that is a server-side `termsrv.dll` patch that enables incoming RDP on Windows Home, not a client library |
