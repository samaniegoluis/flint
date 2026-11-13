# Changelog

What changed in each version of Flint, newest first. Versions follow
[SemVer](https://semver.org): a release with a new feature bumps the minor version, one
with only fixes the patch. Written by `scripts/release.sh` from the commit history.

## 0.5.0 — 2026-11-13

A remote desktop can now span two monitors: Full screen on all monitors opens the desktop on the main monitor, with the taskbar, and on a second one, and the Monitors button picks which and rearranges them live, keeping your Windows session. Windows sees each monitor, so windows maximise per monitor and move from one to the other. Automatic switches to the graphics pipeline while the desktop spans monitors, where it keeps drawing as a window crosses. Available on macOS and on Linux with X11; Windows comes once it has been checked there. Also fixed: Compatible now really uses bitmaps on Linux.

### Added

- **rdp:** Monitor layouts in the core: the desktop across monitors, kept by a reconnect (milestone 38)
- **rdp:** The frame channel serves one view per monitor, and the layout reaches FreeRDP (milestone 38)
- **rdp:** Full screen on all monitors: a window per extra monitor drawing its part (milestone 38)
- **rdp:** Automatic takes the graphics pipeline across monitors (milestone 38, D-091)

### Fixed

- **rdp:** A drag across monitors goes on into the next one instead of sticking at the edge (milestone 38)
- **rdp:** A drag that leaves the window keeps its moves and its release (milestone 38)
- **rdp:** Compatible draws bitmaps on Linux too: the connection type goes before the graphics settings (milestone 38)
- **rdp:** Going back to one monitor during a reconnect is kept, at the area's size (milestone 38)


## 0.4.0 — 2026-11-12

A remote desktop can take the whole screen. Full screen, from the RDP toolbar, the tab's menu, the palette or ⌃⌘F (Ctrl+Alt+Enter on Linux and Windows), hides Flint's chrome and gives Windows the screen's size; on macOS it is the system's own full screen in a Space of its own. A bar drops from the top edge to leave or disconnect, and can be pinned. The toolbar now shows the desktop's real size after a resize.

### Added

- **rdp:** An immersive full-screen RDP tab

### Fixed

- **rdp:** The toolbar shows the desktop's size after a resize, not the size it connected at
- **rdp:** Full screen survives leaving and entering again during macOS's animation


## 0.3.1 — 2026-11-12

A security pass over the remote desktop. Flint now refuses the old Standard RDP Security, which let a machine on the network skip the certificate check and read the password that signs you in. Passwords, keys and passphrases opened from the vault are wiped from memory as soon as SSH or RDP has them, and so are the keys derived from the master password. The channel that carries the desktop to the window is tighter, and a server that only offers the old security says so plainly.

### Fixed

- **rdp:** Refuse standard RDP security, wipe FreeRDP's backup of the password, harden the frame channel
- **security:** Wipe vault keys and opened secrets once used
- **rdp:** Name a server that offers only Standard RDP Security, and document the RDP security review


## 0.3.0 — 2026-11-12

### Added

- **rdp:** Re-read the desktop after a quiet second, auto-detect the link, switch graphics per tab
- **rdp:** Automatic, Pipeline and Compatible graphics; Automatic picks by the link's round trip


## 0.2.0 — 2026-11-12

A faster remote desktop. RDP tabs now use the graphics pipeline (progressive, and H.264 where FreeRDP decodes it) and draw through WebGL: about ten times the frames under a whole-screen animation at half the bandwidth, measured against a real Windows 11 host. Settings → Remote desktop → Graphics keeps the old bitmap path as Compatible, and Stats in the tab's toolbar shows frames, bandwidth and codecs. The status bar now shows the version.

### Added

- **gui:** The version at the right of the status bar, opening Settings → About
- **rdp:** The graphics pipeline, drawing through WebGL, and desktop statistics

### Fixed

- **ui:** Draw a terminal again a second time after a lost WebGL context


## 0.1.0 — 2026-11-11

The first numbered release of Flint, gathering everything built so far: one encrypted vault (SQLCipher, Argon2id) behind a desktop app and a CLI; SSH sessions in tabs and split panes, with OSC 52 copy and image paste; the Files view and `flint cp` between this machine and servers, or between two servers; saved tunnels; approvals and scoped grants for programs and AI agents that use the CLI; and Windows remote desktops (RDP) in a tab through FreeRDP, with the clipboard both ways and reconnect. From now on every build says which version it is.

### Added

- Scaffold hexagonal layout with libsodium, SQLCipher and libssh adapters
- Prove an SSH PTY streams to xterm.js in a webui window
- Verify the Linux build and the webui spike under Xvfb
- Add the vault core with format v1, SQLCipher store, keychain and use cases
- Add the flint vault, group, host, key and cred commands
- Add known hosts (migration 002) and the connect, exec and auth use cases
- Add the libssh transport with jump-host tunnels, password, agent and exec
- Add flint connect, flint exec and flint known-host
- **core:** GUI session adapters, a thread-safe vault store and per-machine settings
- **gui:** The Flint desktop app
- **gui:** The macOS menu bar, with Quit and the Edit shortcuts
- **gui:** The app icon
- **gui:** ⌘T opens a new session even for a host that already has a tab
- **core:** Initial command per host, host test and password reveal/copy use cases
- **cli:** Host test, --command with --keep-shell, connect --no-command
- **gui:** Test connection, reveal and copy a password, initial command in the host editor
- **vault:** Vault ids, rename a vault, moved vaults replace their recent entry
- **gui:** Remembered layout, collapse/expand all, vault rename, terminal colour themes
- **terminal:** OSC 52 copy, in-order input, dead-key rules under test
- **import:** Flint import tether copies a Tether vault into the open vault
- **gui:** Import from Tether in Settings → Vault
- **ssh:** Send keepalives on idle interactive sessions
- **gui:** Connect without the initial command from the palette
- **ipc:** Local Unix socket with peer credentials
- **gui:** Unlock and create off the UI thread
- The CLI runs vault commands through the running app
- Sessions through the app, unlock asked by the CLI, auto-lock
- **access:** Caller chains and grants in the domain
- **access:** The socket asks the owner before a caller runs anything
- **gui:** The approval window and Settings → Access
- **access:** Unlock and allow the waiting command in one step
- **access:** Tokens and the activity log in the vault (migration 004)
- **sudo:** Exec --sudo runs one command as root through Flint (migration 005)
- **sudo:** The approval window's sudo mode, the host's sudo password, end-to-end checks
- **ui:** The access views as designed (16*, 17*)
- Tray with two locks and Remember on this computer (milestone 14)
- Scripts/install.sh installs the app and the CLI as an everyday copy
- Whole commands and activity retention by days in the core (milestone 15)
- **ui:** Show full command, activity detail and retention choice (milestone 15)
- **ui:** Apply the Claude Design screens for milestone 15 (16e*)
- **ssh:** SFTP adapter over libssh, sharing the session with a PTY (M16 spike)
- **files:** Copy use cases over SFTP and the local file system
- **cli:** Flint cp between this machine and a host, served by the app over the socket
- **ui:** The approval window says copy files, with direction, host and paths
- **ui:** Design 16f* for the copy files approval: direction strip, whole paths, -r and --force notes
- **files:** The Files view's backend over the tab's own session
- **files:** Stage files dropped from the OS for upload
- **ui:** The Files view (design 14a-c) beside the session's terminal
- **cp:** Copy from one host to another through Flint
- **ui:** Design 16g for the copy between two hosts approval
- **core:** A Files session with no terminal, and a copy between two lent sessions
- **ui:** Copy between servers in the Files view (design 14d, D-059)
- Split panes in a tab
- Tunnel spike: one forwarder thread per host session over a handed-over link
- Tunnels saved in hosts (migration 007) and their use cases
- Flint tunnel add|edit|rm|ls|up|down|status
- The approval window names a tunnel's two ends; a stopped tunnel frees its port at once
- Tunnels in the app: host editor section, Tunnels view, toolbar menu, palette, approval 16h
- The approval window names the program that holds a tunnel's port
- Remove the Tether importer and libargon2
- Paste an image into the terminal, written on the server (milestone 25)
- **e2e:** Run gui-e2e in the real window on macOS, and repeat one run N times (milestone 27)
- **e2e:** Gui-e2e runs in the real window on macOS by default (milestone 27)
- **rdp:** Libfreerdp 3 adapter for the RDP spike (milestone 28)
- **rdp:** Spike app measuring the frame transport (milestone 28)
- **rdp:** RDP hosts in the vault and the CLI (milestone 29)
- **ui:** RDP hosts in the app: type step, RDP editor, type glyphs, RDP menu (milestone 29)
- **rdp:** RemoteDesktop port, open/watch use cases and the FreeRDP tab adapter (milestone 30)
- **ui:** The RDP tab, and flint connect opens it through the app (milestone 30)
- **rdp:** Clipboard both ways, a reconnect card and Mac modifier-key presets
- **version:** The version from git at build time, Settings → About, and a release script

### Fixed

- Build and pass the keychain and CLI checks on Linux
- Build the SSH link on Linux and check password logins there
- Negotiate a known host's recorded key type first and re-check migrations under the lock
- **build:** Build the desktop app into build/gui
- **gui:** Vim froze the terminal, and the last row was cut off
- **gui:** Unlock and status bar follow the design
- **gui:** Default terminal line height 1.0
- **gui:** The accent setting had no effect in the dark theme
- **gui:** Terminals lost their scrollback when another view was opened
- **gui:** Coming back from another view resized the shell twice
- **gui:** Esc did not close a dialog whose focus went back to the terminal
- **gui:** The host label placeholder read like a real value
- **gui:** The palette offered ⌘I and ⌘↵ on actions, where they do nothing
- **gui:** Settings → Vault unlocked the open vault again through the keychain
- **gui:** The host key card got no focus, so ↵ and esc did nothing
- **gui:** Clicks on a session card went to the terminal behind it
- **gui:** Known hosts did not show keys trusted in a session
- **ssh:** Do not read OpenSSH's known_hosts files
- **gui:** Owner review of milestones 07 and 08
- **gui:** An import with nothing to add says so in its report too
- **ssh:** Build against libssh 0.10 (Ubuntu 24.04, Zorin OS 18)
- **ssh:** Keep the preferred host key type on libssh 0.10
- **gui:** Open and save file dialogs on Linux
- **ssh:** Try every address a hostname resolves to
- **gui:** Redraw terminal glyphs once the font is ready
- **gui:** Larger logo on the no-sessions screen
- **gui:** Serve the CLI on a first launch
- **cli:** No-terminal master password error no longer points at vault unlock
- **gui:** Coming back to Hosts keeps the sidebar as it was left
- **gui:** The Hosts shortcut keeps the sidebar as it was left
- **gui:** Approval window fixes from the owner's walkthrough
- **access:** Name a revoked or expired token in the activity log; clearer token copy
- **ui:** Activity caller shows the program's name, with how it was let in below
- **ui:** Esc leaves the create screen wherever the focus is
- **ui:** Full command over the lock screen; Allow label as wide as its text
- **ui:** Activity rows reachable with Tab in WebKit
- **ui:** Sudo activity entry names the login user from the credential
- **ui:** The Files breadcrumb keeps the current folder in a narrow panel
- **ssh:** Split SFTP writes to 32 KB on libssh 0.10
- **ssh:** Drain the jump-host tunnel instead of one read per poll
- **ui:** The approval card scrolls its body in a short window
- **ui:** One copy per ⌘→/⌘← press, Skip reads Skipped, dates on one line
- Clean glyphs and one resize per split in split panes
- Draw the sidebar whole over the terminal in a narrow window
- Gui-e2e.sh no longer aborts on an empty failure list under bash 3.2
- **ui:** Palette finds tunnels by their action and has no autocorrect
- **ui:** A palette search by a tunnel's action ranks that tunnel first
- **paste:** Paste an image into the terminal on Linux (milestone 25b)
- **ui:** Host editor header aligns when the host has no colour; Domain placeholder without the repeated 'optional'
- **rdp:** Keep FreeRDP's log off (it names server addresses, Principle 5); FreeRDP's sample server in the Linux image
- **ui:** The certificate prompt's PowerShell line wraps inside the card; ROADMAP: the Windows key from a Mac
- **test:** FreeRDP 3.15's sample server in the Linux image gets its test icon
- **rdp:** Announce a new copy on this machine without waiting for the focus
- **terminal:** Draw the whole terminal again after a lost WebGL context
- **terminal:** Never fit a hidden terminal
- **release:** Keep the blank line between the changelog's header and its first version



