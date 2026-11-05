# Claude Design brief: Flint desktop UI

Two messages to Claude Design:

1. **Message 1: explore.** Product context plus three layout directions for the two key
   screens only. Cheap to compare.
2. **Message 2: build out.** Send it after picking (or mixing) a direction. It asks for
   every screen, the tokens and the component sheet.

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
