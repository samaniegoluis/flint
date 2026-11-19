# Claude Design brief: Flint desktop UI

Messages to Claude Design, all in one chat:

1. **Message 1: explore.** Product context plus three layout directions for the two key
   screens only. Cheap to compare.
2. **Message 2: build out.** Send it after picking (or mixing) a direction. It asks for
   every screen, the tokens and the component sheet.
3. **Later messages** add the screens of a milestone the base design lacks, in the same
   chat (message 3: caller approval and agent access; message 4: `--sudo`).

---

## Message 1: explore

Design the desktop UI for **Flint**, an open-source SSH client for developers who live in
the terminal. Before any full design, I want **three distinct layout directions**, so I can
pick one or mix them.

### What Flint is

- Hosts, SSH keys and reusable login credentials live in an **encrypted vault file**. A
  user can have several vaults (Personal, Work…).
- Flint reopens the last vault on launch and auto-unlocks it with a key cached in the OS
  keychain. Switching vaults works like Obsidian's vault switcher.
- Inside a vault:
  - **Folders** (nested up to 3 levels) containing **hosts**.
  - **SSH keys**: stored by content, each with a name, type and fingerprint.
  - **Credentials**: a username plus a password or a key, e.g. "Domain login". Many hosts
    link to one credential, so you never retype a password.
- Each SSH session opens as a **tab** with a modern terminal (xterm.js).
- A CLI shares the same vault. Later, AI agents will run commands on hosts through scoped
  tokens, with the user approving risky commands from the app.
- Target feeling: **fast, calm, keyboard-first, quietly beautiful.** A precision tool, not
  a dashboard.

### Identity (shared by all three directions)

- A flint is the stone that strikes a spark. Use one warm **ember** accent (orange-amber)
  on a deep **graphite** base. An optional cool **sapphire** secondary accent for
  informational states nods to the language Flint is written in.
- Logo idea: a faceted flint shard with a single spark, readable at 16 px.
- Dark theme first; a light theme must be possible from the same tokens.
- A clean UI sans for chrome; a monospace (Nerd Font–friendly) for hostnames, paths and
  the terminal.
- Small radii (6–8 px), 1 px borders, soft elevation, restrained motion.
- Avoid: neon gradients, glassmorphism everywhere, illustrations, marketing hero blocks.

### Constraints

- Desktop window 1280×800 (minimum 900×600), macOS and Linux. macOS traffic lights sit
  top-left in an integrated, draggable title bar.
- The terminal is an xterm.js canvas. Design its frame, padding and ANSI palette, and show
  realistic output (shell prompt, git log, htop-like colours).
- Every action has a keyboard shortcut; show hints.

### The three directions

**A. Editor**
- Familiar pro-tool layout in the spirit of modern code editors.
- A thin icon rail, then a sidebar with a vault switcher on top, search, and a folder/host
  tree with colour and status dots.
- A tab bar over a terminal pane, plus a status bar.
- Dense, scannable, everything visible.

**B. Terminal-first**
- The terminal owns almost the whole window, with minimal chrome.
- The host list is hidden by default. You reach hosts through a command palette (⌘K) and
  a floating quick switcher that also lists recent hosts and vaults.
- Tabs are slim. The sidebar slides in on demand.
- Feels like a launcher plus a terminal.

**C. Workspace**
- A home view of hosts as compact cards grouped by folder, with status, latency, tags and
  last-connected time.
- Opening hosts creates a workspace of **tiled panes**: several sessions visible at once,
  splits as a first-class concept.
- A slim left rail switches between Home, open workspaces, Keys, Credentials and Settings.
- More visual and spatial.

### For each direction, show

1. **Main shell** with three open sessions, one of them disconnected, and the vault
   switcher popover open (recent vaults + Open… / Create… / Manage…).
2. **Unlock screen**, shown when the last vault has no cached key on this machine: vault
   name and path, password, "Remember on this device", "Switch vault".

Dark theme only for now. Add a short note per direction: who it suits, its strengths, its
risks.

---

## Message 2: build out (sent 2026-11-05, direction A + B + C pieces)

Go with **direction A (Editor)** as the base, plus:
- **B's quick switcher as the command palette** (⌘K): one fuzzy list grouped into Hosts,
  Actions and Vaults, with Tab to cycle groups.
- **B's unlock layout**: centred, no fake sidebar behind it.
- **C's in-pane "Connection lost" card** for session states, overlaid on a dimmed terminal
  inside the tab.

Changes to A:
- Remove the per-host latency figures and live status dots from the tree. The MVP shows
  only whether a host has an open session. Latency appears only in the session toolbar and
  status bar.
- Remove "Agent tokens" from the rail. The rail is Hosts, Keys, Credentials, Settings.
- Style the rail like C's: an icon with a small label under it, and the active item
  tinted ember. Settings is pinned to the bottom. Leave room above Keys for workspace items,
  which C shows as Deploy and Homelab and which arrive with splits after the MVP.
- The Split button stays visible but disabled, with a "coming soon" tooltip. The Files
  button opens the SFTP side panel (below).
- Fix the shortcut collisions:
  - ⌘1–9 switch tabs only.
  - Vaults switch through ⇧⌘O and the palette, never digit shortcuts.
  - Rail items use ⇧⌘H, ⇧⌘K, ⇧⌘C and ⌘,.
- Provide the Linux shortcut map alongside the macOS one: ⌘ becomes Ctrl+Shift, so plain
  Ctrl combos always reach the terminal (Kitty keyboard protocol).
- Provide a Linux title bar variant: window controls top-right, no traffic lights.
- The "Remember on this device" hint names only the current OS's store (Keychain on
  macOS, Secret Service on Linux), never both.
- Show how the layout collapses at the 900×600 minimum: the sidebar collapses to the rail.
- Nothing from the roadmap leaks in: no splits, saved workspaces, session restore,
  per-host health or agent tokens in MVP screens.

Now design the complete app in dark **and** light themes.

### Data shown in the UI

A **host** has: label, hostname, port, auth (linked credential | stored key | password |
SSH agent), optional jump host, tags, colour, notes.

### Screens (high fidelity, both themes)

1. **Welcome (no vault)**: create a vault or open an existing file. One line saying the
   vault can live in a cloud-synced folder.
2. **Create vault**: name, location, master password with a strength meter, "Remember on
   this device" checked by default.
3. **Unlock**, plus its wrong-password state.
4. **Main shell**:
   - host tree;
   - tabs with state (connecting, connected, disconnected);
   - session toolbar: host · user · latency; reconnect, duplicate, Files, Split (disabled);
   - status bar: lock state, session count, update hint.
5. **Vault switcher popover** and a **Manage vaults** dialog (rename, reveal in folder,
   forget on this device, remove from list).
6. **Host editor**. The auth section is a segmented control: *Credential* (pick, or
   "+ New credential") · *Key* (pick or import) · *Password* · *Agent*. Plus a jump host
   picker, tags input and colour swatches.
7. **SSH keys manager**: name, type, fingerprint, "used by N hosts"; add by paste or file;
   optional passphrase; copy public key.
8. **Credentials manager**: name, username, auth kind, "used by N hosts"; create and edit.
9. **Command palette**: the B-style quick switcher with results from all three groups
   (Hosts, Actions, Vaults) and shortcut hints.
10. **Connection prompts**, each an overlay on the terminal:
    - password (with "save to vault");
    - key passphrase;
    - **unknown host key** (fingerprint, trust / cancel);
    - **host key changed** (serious warning).
11. **Session states** inside the pane: connecting, auth failed, and the "Connection lost"
    card with Reconnect.
12. **Settings**:
    - Appearance: theme, accent, density.
    - Terminal: font from installed fonts with search, size, line height, cursor.
    - Keyboard shortcuts: editable, showing the macOS and Linux maps.
    - Vault: path, lock now, change master password.
13. **Empty states**: an empty vault, and no sessions open (recent hosts + palette call to
    action).
14. **SFTP side panel**. It is the first post-MVP feature, and Tether already has it, so
    the layout must make room for it now.
    - Placement: docked to the right of the terminal inside a session tab, resizable,
      toggled by the toolbar's Files button.
    - Navigation: breadcrumb, `..`, and a "jump to the terminal's current folder" button.
    - File list: name, size, modified, with a context menu (download, rename, delete, new
      folder).
    - An upload button, and a drop-zone state for files dragged in from the OS.
    - A transfer queue with per-file progress, cancel and "clear done".

### Wireframe only (to reserve layout space)

- **Agent activity panel**: a live timeline of agent commands per host and a
  pending-approval card ("Agent X wants to run `systemctl restart nginx` on prod-web-1 —
  Approve / Deny").

### Deliverables

- **Screens:**
  - Screens 1–14 in high fidelity, both themes, plus the wireframe.
  - **One HTML file per screen and theme**, named `NN-screen-name.{dark|light}.html`.
- **A standalone `tokens.css`**, with CSS custom properties keyed by
  `html[data-theme="dark"|"light"]`, to be implemented in React + CSS Modules:
  - Colour, type scale, spacing, radius, shadow and motion.
  - Consolidate the greys into a **named surface scale**. Screens use tokens only, no
    ad-hoc hex.
  - Use a **4 px spacing scale**.
- **Terminal palette:** the full 16-colour ANSI set plus background, foreground, cursor and
  selection, for each theme, both as a table and as CSS variables.
- **Fonts:** list each one with its licence. They will be bundled locally, so no Google
  Fonts link.
- **Component sheet:**
  - buttons (primary, secondary, ghost, danger);
  - input, segmented control, searchable select, tag input, colour swatches;
  - tree item, tab, toast, modal, drawer, popover;
  - tooltip with shortcut, key chip, status dot, progress bar, empty state.
- **Interaction notes:** focus order; hover, active and focus-visible states; sidebar
  collapse; how prompts overlay the terminal; how the SFTP panel resizes and toggles.

---

## Message 3: caller approval and agent access (sent 2026-11-07, milestones 12a and 12b)

Sent in the same Claude Design chat after milestone 12a. The output is the handoff zip of
2026-11-07 09:58 (screens `16a1`…`16d`). What shipped differs from it in places: tokens
are created from the CLI only (no "New token…" sheet), expire in 15 min to 90 days (no
"Never"), and the activity log has no exit code and no filters yet (ROADMAP ideas).

```
Flint follow-up: caller approval and agent access (v3, milestones 12a and 12b). Same
tokens.css, components and dark/light pairs as the existing screens. The agent-activity
wireframe (15) is the starting point; these screens replace it. Name the new files 16a…,
16b…, and so on.

Context: the `flint` CLI talks to the running app over a local socket. Before Flint runs
anything for a program, the owner approves that program in Flint's own window. A grant
covers the program that started `flint` (Claude Code, a terminal app, tmux), is scoped,
and expires. Allow is confirmed with Touch ID (macOS), the login password via polkit
(Linux), or the vault's master password where neither exists. A working version ships
today; lessons from the owner's walkthrough are noted below.

16a · Approval window: a modal card over the main shell (04); the app comes to the front.
  - Header: "flint, started by Claude Code wants to use this vault". Below it, the caller's
    process chain as a breadcrumb (zsh → herdr → zsh → flint) and its pid.
  - The request, in mono: "flint exec CodeBox -- uptime".
  - Hosts: three choices. The host itself, its group (paths can be long, e.g.
    "HomeLabLS/Proxmox2"; they must not wrap awkwardly inside a segmented button; consider
    radio rows or truncation with a tooltip), and the whole vault.
  - Actions: checkboxes. Read (list and show, never a secret), Run commands (exec, connect,
    host test on the hosts in scope), Change the vault (needs the whole vault, so it is
    disabled otherwise). Only the box and its text are clickable, never the whole row.
  - Duration: 15 min, 1 hour, 4 hours, Until locked.
  - A warning line when the choice does not cover the request.
  - Footer: "Denied automatically in 1:52" countdown, Deny (esc), Allow (⌘↵).
  - Clicking outside the card does nothing: only Deny, Esc or the countdown deny.
  - Variants: (a) waiting for Touch ID (the system sheet sits on top; the Allow button reads
    "Confirm with Touch ID…"); (b) master-password fallback, a password field inside the
    card like 10a; (c) error state ("that is not the master password").
  - Optional: a "1 of 3 waiting" indicator when several requests queue.

16b · Unlock screen with a caller (variant of 03): the CLI asked while the vault was locked.
  - Top panel: "flint exec CodeBox -- hostname wants to use this vault", a checkbox
    "Allow flint, started by Claude Code for 1 hour" (ticked by default), a hint line
    ("What this command needs, on its host. The master password you type confirms it.
    Change or revoke it in Settings → Access"), and Dismiss.

16c · Settings → Access: a new section below Vault (12d), with a shield icon.
  - An intro paragraph.
  - Active grants: rows with the caller label, scope (Whole vault / host / group …),
    actions, time left ("42 min left" / "until the vault locks"), the anchor pid, and
    Revoke; Revoke all; an empty state ("No program may use this vault right now").
  - Tokens (milestone 12b): rows with name, scope, actions, expiry, last used, and Revoke;
    "New token…" opens a sheet with name, scope, actions and expiry (30 days default,
    never). After creation the secret is shown ONCE with Copy and a strong "you will not
    see this again" note.
  - Activity (milestone 12b): a timeline of what each grant or token ran: caller or token,
    host, action (exec/connect/test/write, plus approved / denied / revoked events),
    result (exit code), time. Filters by host and caller. Reads are not logged; say so in
    the empty or footer text.

16d · Status bar item (04): "Agents: 2" opens Settings → Access. A highlighted
  "1 waiting" state while an approval is pending and the window is not in front.

Dark and light for every screen. Keep the density of the existing settings pages.
```

---

## Message 4: `flint exec --sudo` (milestone 13, to send)

```
Flint follow-up: running a command as root (v3, milestone 13). Same tokens.css,
components and dark/light pairs as the existing screens, and the approval window of
16a1 as the base. Name the new files 17a…, 17b…, and so on.

Context: `flint exec CodeBox --sudo -- systemctl restart nginx` asks the running Flint to
run that command as root on the host. Flint runs `sudo` itself and types the host's sudo
password only when sudo asks for it, so the program that asked never sees the password.
Every such command is approved on its own, in Flint's window, with presence (Touch ID,
polkit, or the master password). No grant or token ever covers it.

17a · Approval window, sudo mode (a variant of 16a1, with no Hosts, Actions or Duration):
  - Header: "flint, started by Claude Code wants to run a command as root on CodeBox".
    Below it, the process chain and pid as in 16a1.
  - Where: host label and alias, the login user and "→ root (sudo)".
  - The command, in mono, exactly as it will run. Each argument's boundary must be
    visible (Flint runs these arguments as given, never re-split by a shell): consider
    argument chips, or alternating subtle backgrounds. It must handle long commands
    (10+ arguments, long paths, a `sh -c '…'` script) by wrapping inside a scrollable
    block, never truncating.
  - A clear warning tone, stronger than the grant window's: "Runs as root, once. Nothing
    else is allowed by this."
  - Sudo password line, two states:
    (a) Flint has one for this host: "Flint types the sudo password saved for CodeBox."
    (b) It has none: a password field "Sudo password for lsamaniego on CodeBox" and a
        checkbox "Save it for CodeBox" (unticked by default).
  - Footer: the countdown, Deny (esc) and a primary "Run as root" (⌘↵).
  - Variants: waiting for Touch ID (as 16a3); master-password fallback (as 16a4); the
    long-command case; and "1 of 2 waiting" when a grant request and a sudo request queue.

17b · Host editor (06): a "Sudo password" setting in the auth section, three choices:
  "Same as the login password" (default; only offered when the host or its credential
  has a password), "Its own password" (a password field, with Saved · Change · Remove
  once stored), and "None: ask each time". One hint line: Flint types it only when sudo
  asks, and only for a command you approved.

17c · Activity (16c5, as shipped: When, Caller, Command, Result; no filters yet): a sudo
  row stands out (a small "root" or "sudo" badge), shows the full command, and the
  results Allowed, Denied, Timed out, and "Not a sudoer" / "Sudo password refused".

Dark and light for every screen.
```

---

## Message 5: between servers (v5, milestones 18-20, to send)

```
Flint follow-up: copying between two servers and split panes (v5). Same tokens.css,
components and dark/light pairs as the existing screens. Name the new files 14d…, 16g…
and 18…, as below.

Context: v4 shipped the Files view (14a-c: a sidebar view over the active tab's session,
with breadcrumb, `..`, a file list, a context menu, a transfer queue and a drop zone) and
`flint cp` between this machine and one host, approved in the copy files window (16f1-3).
v5 lets a file go from one server to another. The bytes always pass through Flint
(server A → Flint → server B): no key or password is ever put on a server. It also splits
a tab into up to four terminal panes.

16g · Approval window, copy between two servers (a variant of 16f1):
  - Header: "flint, started by Claude Code wants to copy files between two servers".
    The process chain and pid as in 16f1.
  - Both ends must read at a glance as FROM → TO: source host (label, alias) and path,
    an arrow, destination host and path. Mono for paths, long paths wrap, never truncate.
  - Flags as chips when present: "folder (-r)", "overwrite (--force)", the latter in the
    warning tone of 16f3.
  - The grant this creates must visibly cover both hosts (the Hosts row of 16a1 shows two).
  - 16g1 a file, 16g2 a folder with --force, 16g3 when one of the two hosts already has a
    grant and the other does not (say which one is new).

14d · Files view with two panes (copy between servers):
  - 14d1 · Entry: a button in the Files view header, "Copy to another server…", opens a
    host picker (vault hosts, with a filter, folders as in the sidebar, the current host
    greyed out).
  - 14d2 · Two panes side by side, each a server: its own header (host label, colour dot,
    breadcrumb, `..`, refresh) and its own list. The view widens for it (it may take most
    of the window; the terminal stays visible, narrower). A close button returns to one
    pane. Which pane is "this tab's session" and which is the other server must be clear.
  - 14d3 · Dragging a file or folder from one pane to the other: the drop target pane and
    folder highlight, the cursor says "Copy to <host>". Also a context-menu item
    "Copy to <other host>".
  - 14d4 · The transfer queue for a copy between servers: each row names both hosts
    (A → B), per-file progress, cancel, and the Replace / Skip choice when the name
    exists on the destination.
  - 14d5 · The second server is connecting (it has no open tab, so Flint logs in to it
    without a terminal): the pane shows the connecting state, then a password prompt or
    an unknown host key inside the pane, reusing 10a and 10c, and an auth-failed state.

18 · Split panes (up to four panes per tab, each its own SSH session):
  - 18a · Two panes side by side, then stacked; 18b · 2×2; 18c · one large + two small.
    A thin divider that can be dragged; the focused pane clearly marked (accent border or
    a dimmed inactive pane, your call, it must survive both themes and busy output).
  - Each pane has a slim header: host label, colour dot, and a close button on hover. Two
    panes may be the same host.
  - The session toolbar's Split button (disabled today) becomes a menu: split right, split
    down, and the four layouts, with their shortcuts (⌘D, ⌘⇧D).
  - 18d · One pane connecting, one with connection lost (reusing 11a and 11c inside the
    pane), two running: one dropping leaves the others alone.
  - 18e · The command palette with "Open <host> in a new pane".
  - 18f · At 900×600 (as 04c): what four panes look like at the smallest window.
  - 18g · Split panes with the Files view open: it follows the focused pane, and its
    header says which pane it is showing.
```

## Message 6: side panel, pinned or floating (ROADMAP §6, sent; screens 19* imported 2026-11-10)

Written at milestone 19's close (2026-11-09). The order against milestone 20 (split
panes) is still the owner's call; these screens are needed either way.

```
Flint follow-up: the side panel, pinned or floating. Same tokens.css, components and
dark/light pairs as the existing screens. Name the new files 19…, as below.

Context: today every side view (Hosts, Files, Keys, Credentials, and later ones) opens
docked to the left of the terminal and takes its width. Each time it opens or closes the
terminal is resized: full-screen programs (vim, htop, tmux) redraw and the shell prompt
reflows, and with split panes (18a-g) every pane shrinks at once. Milestone 19 already
shipped one floating layer: the second file pane of "Copy to another server…" floats over
the terminal beside the Files view and never resizes it (it departs from 14d2, which drew
it docked and 700 px wide). Now the whole side panel gets the same choice, with a pin.

The rule (owner): one panel and one width for every side view, with a pin.
  - Pinned: as today. It stays open and takes the terminal's space; ⌘E (Files) and the
    rail icons show or hide it, and it stays as it was left.
  - Unpinned: it looks the same but floats over the terminal (a shadow or an edge that
    reads as "over", in both themes) and never resizes it. It always goes away again:
    hovering a rail icon opens it after ~150 ms, leaving it hides it after ~300-500 ms,
    but never during a drag, an open context menu, a focused input or a waiting question
    (Replace / Skip). Opened with the keyboard it stays until Esc or a click back in the
    terminal. Dragging files from the OS onto a rail icon opens it (spring-loaded).
  - The rail always stays docked. A docked panel never grows past its own width: anything
    wider floats (as the second file pane does).

19 · Side panel, pinned or floating:
  - 19a · The pin: where it lives in the panel header, and how pinned and unpinned read
    (icon state, tooltip "Pin the panel" / "Unpin"), on Hosts and on Files.
  - 19b · Unpinned, floating over a busy terminal (vim or htop full width behind it):
    the panel's edge, shadow and the terminal visibly not resized. Both themes.
  - 19c · Opening on hover: the rail icon under the pointer and the panel appearing; a
    hint of what keeps it open (a context menu open in the Files view, or a Replace /
    Skip strip waiting).
  - 19d · Unpinned with the two file panes (as built in M19): Files floating, the second
    pane floating beside it, and the chip "⇄ nas · 2 copying" when the second pane is
    hidden. Everything over the terminal, nothing resizes it.
  - 19e · Spring-loaded drop: a file dragged from the OS over the Files rail icon, the
    panel opening under the drag and the drop zone of 14b.
  - 19f · Unpinned with split panes (redo of 18g): the panel floating over a 2×2 split,
    its header saying which pane Files is showing, the focused pane still marked.
  - 19g · At 900×600 (as 04c and 18f): pinned and unpinned side by side, to judge which
    should be the default on a small window.
  - Settings → Appearance: a row "Side panel: Pinned / Floating" (the default), if you
    think it belongs there and not only on the pin.
```

## Message 7: tunnels (v6, milestone 23, sent 2026-11-10)

Written at v6's planning (2026-11-09, D-062), brought up to date with milestone 22 as built
(D-063) on 2026-11-10. Send it in the same chat as messages 1-6; it is needed before
milestone 23 is built.

```
Flint follow-up: tunnels (local port forwards, `ssh -L`). Same tokens.css, components and
dark/light pairs as the existing screens. Name the new files 06c…, 16h… and 20…, as below.

Context: a tunnel lets something on this machine (a database client, a browser) reach a
service that only listens inside a server: 127.0.0.1:5432 here goes to localhost:5432 on
db1. The rules (owner):
  - A tunnel is saved in its host: name, local port, destination as seen from the server
    (localhost:5432 by default, or another machine on its network, e.g. 10.0.0.5:5432),
    and "Open when I connect". It uses the host's login, credentials and jump hosts.
  - A host's running tunnels do not live in a tab. They ride a session of their own with no
    terminal, so closing the tab (or the terminal reconnecting) leaves them up, and a tunnel
    can run with no terminal at all.
  - Three ways to open, all from the same host: SSH only (connect as today), SSH with
    tunnels (connecting starts the "Open when I connect" ones; the session toolbar toggles
    each), tunnels only (a Tunnels view in the rail, the palette, or `flint tunnel up`).
  - Local side is always 127.0.0.1, never the LAN: say so, do not offer a bind address.
  - A lost session (the server went away) stops every tunnel of that host and shows
    "connection lost" with the reason. Nothing reconnects by itself: the switch tries again.
  - Locking the vault leaves running tunnels up, like open terminals; quitting Flint closes
    them all.
  - Two saved tunnels may share a local port (only one can run at a time): a warning, not
    an error.

06c · Host editor, Tunnels section (beside 06 and 17b):
  - 06c1 · A list of the host's tunnels, each row "pg · 127.0.0.1:5432 → localhost:5432"
    with an "Open when I connect" check, edit and remove; an "Add tunnel" button. Mono for
    ports and addresses. Empty state: one line saying what a tunnel is.
  - 06c2 · Adding or editing one: name, local port, destination host (placeholder
    "localhost") and port, the check. Inline errors: a name already used on this host, a
    port out of range; a warning (not an error) when another tunnel of the vault already
    uses that local port.

20 · Tunnels in the app:
  - 20a · The Tunnels view (a rail item, same panel width as Hosts): every tunnel grouped by
    host (colour dot and label as in the sidebar), each with a switch and its live state:
    "listening 127.0.0.1:5432 · 2 connections", stopped, starting, "port 5432 in use",
    "connection lost · <reason>" (no retrying: the switch is off, flipping it logs in
    again). A filter at the top. Empty state (no tunnels yet): what a tunnel is and where
    to add one (the host editor). Both themes.
  - 20b · The tunnels' session connecting for a host with no open tab: the row shows the
    connecting state, then a password prompt or an unknown host key, reusing 10a and 10c
    (as 14d5 did for the second file pane), and an auth-failed state.
  - 20c · The session toolbar's Tunnels button and its menu: a check per tunnel of this
    host with its state, "Manage tunnels…" opening 06c. The button shows a count when
    some are up.
  - 20d · A host's tab while it has tunnels up: a small mark on the tab (and on the host
    in the sidebar), with a tooltip listing them. Also a closed tab: the host still shows
    its tunnels running in the sidebar.
  - 20e · Command palette: "Start tunnel pg on db1", "Stop tunnel …", "Connect to db1 with
    tunnels".
  - 20f · At 900×600 (as 04c): the Tunnels view and the toolbar menu.

16h · Approval window, a program opening a tunnel (a variant of 16a1 and 16f1). Today's
build already names the tunnel, 127.0.0.1:<port> and the destination on 16a's layout;
this is its proper design:
  - Header: "flint, started by Claude Code wants to open a tunnel". The process chain and
    pid as in 16a1.
  - What it opens, at a glance: the host (label, alias), "127.0.0.1:5432 on this Mac →
    localhost:5432 on db1". Mono for addresses.
  - The grant it creates covers the host's exec scope (Hosts row of 16a1): say that the
    program could also run commands there.
  - 16h1 a tunnel; 16h2 the same when the local port is already in use on this machine:
    the window says so plainly before Allow, so the person is not asked to approve a
    tunnel that cannot open.
```

---

## Message 8: RDP hosts and the RDP tab (v8, milestones 29-30, to send)

Written at milestone 29's plan (2026-11-11, D-070). Send it in the same chat as messages
1-7. Screens 21a-21d are needed by milestone 29, 22a-22e by milestone 30.

```
Flint follow-up: remote desktop (RDP) hosts. Same tokens.css, components and dark/light
pairs as the existing screens. Name the new files 21… and 22…, as below.

Context: Flint v8 adds Windows remote desktops beside SSH. A host now has a type, SSH or
RDP, chosen when it is created and fixed after (to change it, remove the host and add it
again). Both types live in the same vault, the same sidebar tree (folders mixed), the same
search and the same command palette. An RDP session opens in a tab of its own showing the
remote Windows desktop (one session per tab, never in a split pane); the target feeling
is "a VM on my own computer", so the tab must also work full screen with Flint's chrome
out of the way. The owner's hosts: Windows Server, Windows 10/11 Pro and Windows VMs on
Proxmox, reached directly or over a VPN. Self-signed certificates are the normal case.

An RDP host has: label, address, port (3389 by default), user, an optional Windows domain,
a login (its own password, or a saved credential that has a password; RDP never uses an
SSH key), folder, tags, colour and notes. It has no jump host, initial command, sudo
password or tunnels: those sections must not appear for it.

21a · New host: the first step asks the type. Two large cards side by side, "SSH" (a
  terminal on a Linux or Unix server) and "Remote desktop (RDP)" (a Windows desktop in a
  tab), each with its type icon and one line saying what it is. Keyboard: arrows and ↵,
  1/2 as shortcuts. Entry points: the sidebar "+" and the palette's "New host…" both land
  here; "New SSH host" / "New RDP host" palette commands skip it.

21b · Host editor for an RDP host (beside 06, same layout and sections where they apply):
  - The type shown in the header as a fixed badge with its icon (not editable; a tooltip
    says how to change it).
  - Connection: label, address, port (placeholder 3389), user, domain (placeholder
    "optional, e.g. CORP"). One hint: "DOMAIN\user and user@domain also work in User".
  - Login: own password (Saved · Change · Remove once stored, as 06) or a credential
    (the picker lists only credentials with a password; one with only a key is shown
    disabled with the reason).
  - Folder, tags, colour, notes as 06.
  - Footer as 06: Save, Cancel, and no "Test connection" until milestone 30 (reserve its
    place).
  - Inline errors: address missing, port out of range.

21c · Type icons everywhere a host appears: a small glyph for SSH (a terminal prompt) and
  for RDP (a monitor or window), readable at 12-16 px in both themes, next to the colour
  dot without crowding it. Show them in the sidebar tree (a folder holding both types),
  in search results, in the palette ("Connect to win-01" with the RDP glyph), in the
  host list of 16a1's Hosts row, and on tabs (an RDP tab vs SSH tabs in one strip).

21d · Sidebar context menu and session toolbar for an RDP host: only what applies
  (Connect, Edit, Duplicate, Remove; no Files, no Tunnels, no "Open in a new pane").
  Hovering a greyed SSH-only action in the palette says "SSH hosts only".

22a · The RDP tab, connected: the remote desktop fills the tab's content area, scaled to
  fit with letterboxing in the graphite background when the ratio differs; a slim tab
  toolbar (host, resolution, latency, Full screen, Disconnect) that can auto-hide.
  Show a realistic Windows 11 desktop inside (a generic wallpaper, the taskbar, an
  Explorer window).

22b · Full screen: the remote desktop takes the whole screen; Flint's chrome is gone except
  a thin drop-down bar at the top centre (host name, Exit full screen, Disconnect),
  shown on hover or with a shortcut, in the spirit of mstsc's connection bar. Keys like
  Alt+Tab and the Windows key go to the remote while in it; say so once, quietly.

22c · States inside the tab (reuse 11a and 11c where they fit): connecting ("Connecting to
  win-01…", with Cancel); failed, one per reason: wrong user or password, certificate
  changed, network unreachable, timed out, the server refused (e.g. RDP is not enabled, or
  too many sessions); each with its reason in plain words and the next action (Edit host,
  Retry). Connection lost, with Reconnect (milestone 31).

22d · The certificate prompt on first connection (the RDP twin of 10c, the unknown host key
  dialog): the host, "This server's certificate is not known yet", the certificate's
  subject and issuer, its validity dates, and its SHA-256 fingerprint in mono grouped for
  reading; a note that self-signed is normal for Windows hosts and VMs; Trust and connect
  (⌘↵) and Cancel (esc). Variant: the certificate changed since last time, a refusal in
  the warning tone of 10c's changed-key screen, with both fingerprints and how to forget
  the old one (Settings → Known hosts).

22e · At 900×600 (as 04c): 21a, 21b and 22a.

22f · Multiple monitors (milestone 38, D-089; follows 22b). An RDP tab can go full screen
  across two monitors: Flint's window stays in full screen on its own monitor (Windows'
  primary, with the taskbar), and each extra monitor shows a chrome-less full-screen
  window with its part of the same remote desktop.
  22f1 · Entering: the RDP toolbar's Full screen button gains a small menu, "Full screen"
  and "Full screen on all monitors"; the same two items in the tab's context menu
  (22b4a). Disabled variants with a one-line reason: "Only one monitor connected", "Not
  supported on this system yet", and on macOS "Turn on 'Displays have separate Spaces'".
  22f2 · The connection bar gains "Monitors": a popover with a to-scale map of this
  computer's monitors as arranged, each a tile with its name and size; checked tiles are
  in the session. The main one is always checked, tagged "Main · taskbar". A cap: "Up to
  2 monitors". A change applies at once ("Rearranging the desktop…" on the bar).
  22f3 · An extra monitor's window: just the desktop, edge to edge, no bar of its own.
  States: drawing; connection lost (dimmed, "Connection lost — see the main screen");
  rearranging (dimmed, a small spinner).
  22f4 · The first-time note, once: "The desktop spans N monitors. Move the pointer to the
  top of the main screen for the bar."

Dark and light for every screen.
```

---

## Message 9: Connect remote vault and the sync's state (v11, milestone 44, sent)

Written at milestone 44's plan (2026-11-13), after milestone 43 built the sync in the core
and the CLI (D-098). Send it in the same chat as messages 1-8. Screens 23a-23h are needed
before milestone 44 is built.

```
Flint follow-up: a vault kept in step across machines by a server the person runs. Same
tokens.css, components and dark/light pairs as the existing screens. Name the new files
23…, as below, and update 01 and 12d where noted.

Context: every machine keeps its own full copy of the vault and works offline. An
optional server the person self-hosts (flint-vault-server, behind their own HTTPS proxy)
keeps the copies in step. The server never holds the key: it stores the encrypted file
and a version number, and nothing else. Flint syncs on its own: at unlock, a few seconds
after a change, when the window comes back to the front, and every minute (configurable).
When two machines changed the vault apart, Flint downloads the other copy, merges it
record by record (the newer edit wins; a host alias created on both sides is renamed,
e.g. "web-01-2") and uploads the result. Nothing is ever lost, so a merge is news, not an
alarm. The rules (owner):
  - A server keeps one vault today; a later version lets one server keep several, each
    under its id (23a3 leaves room for the choice). Its address must be https://
    (http:// only for localhost). It is reached with a token (a long random string
    the server printed); the token is a secret: typed or pasted once, kept in the OS keychain, never shown again,
    only "Saved in the keychain" and Replace.
  - A vault may only go to a server with a Strong master password (3 of 4 on the strength
    meter Flint already shows in Change master password). A weaker one is refused with a
    way to change it first.
  - A locked vault cannot sync (there is no key to merge with): its changes wait and are
    merged at the next unlock.
  - If the master password was changed on another machine, this one's copy no longer
    opens the server's: Flint asks for the new password once, then carries on.
  - Offline is normal (a laptop on a train): calm, never red.

01 · Welcome, updated: a third card under "Create a new vault" and "Open a vault file…":
  "Connect to a remote vault" (a server icon), one line "Download a vault kept on your
  own server and keep it in step", its shortcut. The old footnote about iCloud/Dropbox
  goes or says the server is the way now.

23a · Connect to a remote vault, from Welcome (a page like 02 Create vault, in steps):
  - 23a1 · Server: address (placeholder "https://vault.example.com") and token (a
    password field, a paste button). Below, a quiet line: "No server yet? Self-host one
    in a few minutes" linking to the docs. Continue checks the server.
  - 23a2 · The checks failing, inline under the field each belongs to: http:// refused
    ("Use https:// — plain http is allowed only for localhost"), server unreachable,
    not a Flint vault server, wrong token, too many attempts (try again in N minutes),
    and the server holding no vault yet ("This server is empty. Connect it from a machine
    that already has the vault: Settings → Vault → Connect to a server").
  - 23a3 · The vault found: the server cannot read it, so only "A vault was found", its
    size and version (its name appears once it opens). A server may hold several vaults
    (milestone 45, D-101): then a short list to pick one, each row an id (short, mono),
    size, version and last change; the name shows once it opens. Then the master
    password of that vault; where to keep the
    local copy (folder picker and file name, as 02); "Remember on this computer" as 03.
    Errors: wrong master password, a file already exists there.
  - 23a4 · Downloading and opening: one progress line, then straight into the main shell
    (no extra success screen).

23b · Settings → Vault, a new "Server" section in 12d (above Lock after):
  - 23b1 · Not connected: one line on what it does and a "Connect to a server…" button.
  - 23b2 · Connecting this open vault (a modal): address, token, then the master password
    typed again with the strength meter. A Weak or Fair password: the Connect button
    disabled and "A vault on a server needs a Strong password — Change master password…".
    Outcomes: the server was empty ("Uploaded. Other machines can connect now"), it
    already held this same vault ("Merged with the server's copy", the merge summary as
    23e), it holds another vault (refused for now: "This server already keeps a different
    vault").
  - 23b3 · Connected: the address (mono), state as in 23c with its last sync time
    ("In step · 2 min ago"), version number (faint), "Sync now", "Check every" (Only on
    changes and at unlock · 1 min · 5 min · 15 min), "Replace token…", and "Disconnect…"
    (a confirm: the local copy stays as it is and keeps working, the server keeps its
    copy, nothing is deleted).
  - 23b4 · Replace token (a modal from 23b3): one password field with a paste button,
    "Replace". Flint checks the new token against the server before the old one is
    dropped; a refused token is an inline error and the old one stays.

23c · The sync's state in the status bar (beside the lock state, as 16d placed the agents'
  item): a small cloud glyph plus a word, each state at a glance:
  - In step (quiet, no colour; tooltip "Synced 2 min ago").
  - Syncing (a subtle motion).
  - Waiting (changes not uploaded yet; a neutral dot. Flint knows that changes wait,
    not how many: no count).
  - Offline (server unreachable; neutral, "will sync when back").
  - Merged (sapphire, info tone, for a short while after a merge brought changes; click
    opens 23e).
  - Needs the new password (warning tone; click opens 23f).
  - Needs attention (the token was refused, the server now holds another vault: warning,
    click opens Settings → Server).
  Clicking the item opens a small popover: state, last sync, server address, "Sync now",
  "Server settings…". A vault not connected shows nothing in the status bar.

23d · The vault switcher (⇧⌘O popover) and the recents on Welcome: a small cloud mark on a
  vault connected to a server, with its address in the tooltip.

23e · A merge brought changes: a toast "Changes from another machine: 2 hosts added,
  1 updated" with "Details". The details dialog lists what changed, grouped by kind
  (hosts, credentials, SSH keys, tunnels, tokens), each line "added / updated / removed"
  and the record's label (labels only, no secrets), then the notes the merge made in plain
  words ("web-01 existed on both machines: this one is now web-01-2", "a tunnel whose
  host was removed was removed too"). Empty notes: no section.

23f · The master password was changed on another machine: a modal over the unlocked app,
  calm, not an error: "The master password of Personal was changed on another machine.
  Type the new one to keep syncing." A password field, "Sync" and "Later" (the status bar
  keeps 23c's warning state). Wrong one: inline error. This machine's vault then opens
  with the new password from now on (say so in one line).

23g · Unlock (03) for a connected vault: one faint line under the field when changes wait
  ("Changes from this machine will sync after unlocking"; no count, as 23c).

23h · Command palette: "Sync vault now", "Connect vault to a server…", "Disconnect vault
  from server…", "Show last merge". And 900×600 (as 04c): 23a3, 23b3 and the status bar.

Dark and light for every screen.
```

## Message 10: updates, What's new and the toast component (spec v12, sent 2026-11-19)

Written with the owner on 2026-11-19, before any spec: the toast reworked into one
reusable component (any corner, durations per call, up to two buttons, progress), and the
screens for the self-update of ROADMAP §7. Send it in the same chat as messages 1-9. The
handoff came back as screens 24*, 12e and changes to 12a, 20d2 and 23e1; message 10b
corrected it.

```
Flint follow-up: updates, a "What's new" screen, and the toast reworked into a reusable
component. Same tokens.css, components and dark/light pairs as the existing screens.
Name the new files 24…, as below, and update 12 (Settings → About and Appearance) and
the status bar where noted.

Context: Flint will ship releases (semver, a CHANGELOG with a short summary per version
and Added / Fixed sections). The app checks for a new version and can update itself.
The rules (owner):
  - Never a forced restart: Flint holds open SSH and RDP sessions and tunnels. It tells,
    downloads when asked, and relaunches only when the person says so.
  - Releases are signed with Flint's own key and verified before anything is applied;
    the screens may say "Verified" but never show keys or hashes.
  - The check can be turned off; it only fetches a manifest, it sends nothing about the
    person.
  - The app and the command-line tool update together (one install).
  - Installs managed by a package manager (Linux .deb/.rpm, Homebrew, winget) do not
    self-update: Flint only says a new version exists and shows the command to run.
  - Calm, never alarming: an update is good news, like the merge toast of 23e.

24a · The toast, as a component (replaces the single toast of today, see 23e and 20d2).
  One look for every toast in the app: a status mark (a small dot or icon in the kind's
  colour: ok, info, error), the text, up to two buttons, an optional progress value on
  the right ("7%", faint, fixed width so the text never moves), and a ✕ always.
  Show: an ok toast ("Saved prod-api"), an error toast with a long message wrapping to
  two lines, an info toast with one button ("Tab closed. 2 tunnels still up on prod-db ·
  Stop them"), and a stack of three (newest closest to the corner; at most three).
  Reference for the feel: a compact pill-like bar, rounded, the accent used only for
  the action button and the dot.

24b · Toast position: the same stack in each corner of the window. Bottom-right is the
  default. Bottom corners sit above the status bar and the stack grows upward; top
  corners sit under the tab bar and the stack grows downward. Never over the rail.

24c · The update toast, one toast that changes in place (it stays until acted on or ✕):
  1. "Flint 1.4.0 is available" · [Download] [✕]
  2. "Downloading Flint 1.4.0" · 7% · [✕ cancels the download]
  3. "Flint 1.4.0 is ready" · [Relaunch] [✕ = later; it applies at the next launch]
  4. Failed: "Couldn't download Flint 1.4.0" · [Retry] [✕]
  5. Package-managed install: "Flint 1.4.0 is available" · [How to update] (opens 24e)

24d · Relaunch with work open: a small confirm when sessions or tunnels are up.
  "Relaunch to update? 3 sessions and 2 tunnels will close." [Cancel] [Relaunch].
  With nothing open, Relaunch goes straight through.

24e · Settings → About, updated (12): a "Version" block with the current version, the
  update state and its action, matching 24c (Up to date · last checked 10 min ago ·
  [Check now]; Available · [Download]; Downloading 42%; Ready · [Relaunch]; package
  manager: the command to run, e.g. `brew upgrade --cask flint`, with Copy). A toggle
  "Check for updates automatically". A link "What's new in 1.4.0" that opens 24g.
  Keep the existing libraries table below.

24f · The status bar's version item (today "v0.12.1", bottom right, opens About):
  when an update is available or ready, a small accent dot on it; a click opens a
  popover (like the sync popover of 23c) with the state and its one action, and a link
  to About. Idle and up to date: it looks as today.

24g · What's new: the first thing after a relaunch into a new version (once per
  version), and reachable from About and the palette. A modal over the unlocked app,
  wide enough to read: "Flint 1.4.0", the date, the version's summary as a short
  paragraph, then Added and Fixed as lists (scope in bold, as the CHANGELOG writes
  them). When versions were skipped (1.2.0 → 1.4.0), each version in between as its
  own section, newest first. A link "Full changelog" (the docs site) and [Close]
  (Esc). Show it with a long changelog (scrolls inside the modal) and a short one.

24h · Settings → Appearance: "Notifications" with the corner picker (a small window
  diagram with four clickable corners, bottom-right selected).

24i · Command palette: "Check for updates", "What's new in Flint".

24j · At 900×600 (as 04c): 24a stack, 24c state 3, 24e and 24g.
```

## Message 10b: corrections to message 10 (sent 2026-11-19)

After reviewing the first handoff of 24*: the top corners covered the session toolbar,
a failed download did not tell a network failure from a failed verification, a long
error lost its end, and some screens disagreed. With the owner's decisions on timing,
button colour and the check's frequency. The second handoff was imported as is, except
that its README dropped milestone 45's note on 23a3, which was kept.

```
Flint follow-up to message 10 (screens 24*): corrections and the owner's decisions.
Same files and names; update the screens in place and the README section.

Decisions (owner):
  - Timing: toasts leave after 6 s, paused while hovered or focused. Error toasts are
    sticky: they stay until ✕ or their action. Progress toasts and toasts waiting for
    a decision (update available, ready) stay too.
  - Button colour: ember (btn-primary) only for the update's actions: Download,
    Relaunch, How to update. Every other toast action is btn-secondary: Stop them,
    Retry (upload), Details, Retry (download). Update 24a1, 24a2, 24b1-4, 24j1, 20d2
    and 23e1.
  - The update check runs at launch and then once a day. About's toggle text:
    "Fetches a small manifest at launch and once a day. Nothing about you is sent."

Corrections:
  1. Top corners (24b3, 24b4): the stack covers the session toolbar (Duplicate, Files,
     Split). Place it under the tab bar AND the session toolbar:
     top: calc(var(--titlebar-h) + var(--tabbar-h) + var(--toolbar-h) + var(--sp-3)),
     with a --toolbar-h token if there is none. On a page without a session toolbar
     (Settings, Keys) it sits under the title bar.
  2. Download failed (24c4) has two cases, shown as two screens:
     24c4a · Network: "Couldn't download Flint 1.4.0 · no connection" · [Retry] [✕].
     24c4b · Verification failed: "Flint 1.4.0 didn't pass verification and was
     discarded" · [Details] [✕]. No Retry: a download that fails verification is never
     applied. Details opens About (24e6, below).
     24e6 · About after a failed verification: a calm danger line "The download of
     1.4.0 didn't pass verification and was discarded. Nothing was installed." with
     [Check again] and a link "Download from the website ↗". Still no keys or hashes.
  3. Long text: a toast clamps to 2 lines, so a long error loses its end. When the
     text is clamped, show a small "More" link after it that expands the toast to its
     full text (up to ~8 lines, then it scrolls). Show it in 24a1: the error toast
     clamped with "More", and the same toast expanded.
  4. Consistency:
     - 24g2: the app is on 1.3.2, so the skipped versions are 1.3.0 – 1.3.1. The
       header reads "18 Nov 2026 · since your 1.3.2" or similar; list 1.4.0, then
       what the person did not see. Keep the long scrolling case: make the current
       version 1.2.4 if needed so there are several sections.
     - 24e3 (downloading): the status bar's version item shows the accent dot, as in
       24c2.
     - Settings nav must match the app's on every Settings screen (12a, 12e, 24e*,
       24h1, 24j3): Appearance, Terminal, Remote desktop, Keyboard shortcuts, Vault,
       Access, About. About is not new: it already exists in the app.
  5. README: the section belongs to spec v12, not v10; drop "Settings gains an About
     item"; keep every existing line of the README unchanged (do not drop the 23a3
     note about milestone 45). List the new screens 24c4a, 24c4b and 24e6.
```
