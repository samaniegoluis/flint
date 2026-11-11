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

Dark and light for every screen.
```

## Message 9: a Releases page on the docs site (ROADMAP §8, to send)

Written at milestone 32 (2026-11-11, D-077). Send it in the same chat as messages 1-8. It is
for the public site (the landing and docs, Astro + Starlight), not the app.

```
Flint follow-up: a Releases page for Flint's public site (the landing and the docs). Same
tokens.css, type, accent and dark/light pairs as the landing; name the files 23….

Context: Flint now has versions (SemVer, one git tag per release, the first is 0.1.0) and a
changelog. There are no downloads yet: people build Flint from source, and binaries come
later. The page should show Flint's evolution, version by version, and be ready for the day
downloads exist. One version covers the CLI and the desktop app together (no per-platform
releases). Reference for the idea, not the look: zennotes.org/releases (a list of versions
on the side, the latest one highlighted, a summary per release, newest first).

Each release has: its number (0.3.0), its date, a summary of a few sentences written for a
person (what the version brings, in plain words), and its lists of changes grouped as
Added / Fixed / Faster, each item one line with an optional scope in bold ("rdp:", "vault:").
A first release can have 100+ items: the lists need to collapse ("Show all 74 changes").

23a · Releases page, desktop width:
  - A page title and one line ("What changed in each version of Flint, newest first").
  - The latest release featured on top: number, date, its summary large, its lists below.
  - Earlier releases below it, each collapsed to number, date, summary and a count
    ("12 changes"), expanding in place.
  - A list of versions to jump to (sticky on the side on wide screens), with "Complete
    changelog" at its end (the Markdown changelog on GitHub).
  - Where downloads will go: a "Build from source" button (to the build guide) and a small
    "Downloads coming soon" note. Show it per release or once, whichever reads better.
23b · The same at phone width: the version list becomes a select or chips at the top.
23c · The site header with a "Releases" link beside Docs, on the landing and on a docs page.
23d · The future state, wireframe only: the same release with Download buttons for macOS,
  Windows and Linux in place of the note, so the layout keeps their place.

Dark and light for 23a-23c.
```
