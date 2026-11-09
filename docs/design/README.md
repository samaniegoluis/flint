# Flint — desktop UI handoff (MVP)

Direction **A (Editor)** as the base, plus B's command palette and unlock layout and C's in-pane session cards.

## What's in this folder

| Path | What it is |
|---|---|
| `screens/NN-screen-name.{dark,light}.html` | One plain HTML file per screen and theme. Open in a browser at ≥ 1280 px wide. |
| `screens/16*.{dark,light}.html` | v3 · milestones 12a and 12b: caller approval, unlock with a waiting caller, Settings › Access, and the Agents status item. |
| `screens/17*.{dark,light}.html` | v3 · milestone 13: the approval window as root (`exec --sudo`), the host's sudo password, and Activity with sudo rows. |
| `screens/16e*.{dark,light}.html` | v4 · milestone 15: whole commands (summary + "Show full command", the full-command modal), the activity entry, and activity retention. |
| `screens/16f*.{dark,light}.html` | v4 · milestone 16: the approval window for `flint cp` (direction, both paths, `-r` and `--force`). |
| `screens/16g*`, `14d*`, `18*` `.{dark,light}.html` | v5 · milestones 18–20: the approval for a copy between two hosts (18), two file panes in the Files view (19), split terminal panes (20). |
| `tokens.css` | **The source of truth.** CSS custom properties keyed by `html[data-theme="dark"\|"light"]`. Import once at the app root. |
| `flint.css` | The mockups' component classes. It's a reference for your CSS Modules, not production CSS. It uses tokens only. |
| `components.{dark,light}.html` | The component sheet. |
| `tokens.html`, `terminal-palette.html`, `notes.html` | Spec boards: swatches, ANSI tables and these notes, rendered. |
| `fonts/` | The bundled font files, their `@font-face` rules and their OFL licences. |

The screens use only `var(--…)`. The only hex values live in `tokens.css`.

## Tokens (summary)

- **Surface scale**, from back to front: `--surface-desk`, `--surface-sunken` (terminal, inputs), `--surface-base` (window), `--surface-chrome` (title bar, rail, sidebar, tabs, status bar), `--surface-raised` (cards, footers), `--surface-hover`, `--surface-active` (selected row, pressed segment), `--surface-overlay` (popover, menu, modal, drawer).
- **Borders:** `--border-subtle`, `--border-default`, `--border-strong`.
- **Text:** `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-disabled`, `--text-on-accent`, `--text-on-danger`.
- **Accent (ember):** `--accent`, `--accent-hover`, `--accent-press`, `--accent-text` (ember used as text), `--accent-subtle`, `--accent-border`. `data-accent="sapphire|moss|iris"` swaps the accent.
- **Status:** `--info` (sapphire), `--success`, `--warning` and `--danger`, each with `-subtle` and `-border` variants.
- **Layout:** `--rail-w` 68, `--sidebar-w` 264 (Hosts), `--sidebar-files-w` 340 (Files, 200–480), `--agent-panel-w` 380 (reserved).
- **Spacing (4 px scale):** `--sp-0-5` 2 · `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-8` 32 · `--sp-10` 40 · `--sp-12` 48 · `--sp-16` 64.
- **Radius:** xs 4 · sm 6 · md 8 · lg 10 · full.
- **Type:** 10.5 / 11 / 12 / 13 / 15 / 18 / 22 / 28 px. UI text is 13 px with line height 1.45. The terminal is 13 px with line height 1.5 by default.
- **Motion:** 60 / 120 / 180 / 240 ms, `--ease-out` cubic-bezier(.2,.8,.2,1). Reduced motion sets every duration to 0.
- **Density:** `data-density="compact|comfortable"` changes `--row-h` (22 / 26 / 30), `--control-h`, `--tabbar-h` and `--toolbar-h`.

Contrast: body text, secondary text, tertiary text (also on selected rows), accent text and status text on their subtle backgrounds all reach at least 4.5:1 in both themes.

## Terminal palette

xterm.js `ITheme`: `black … brightWhite` → `--ansi-0 … --ansi-15`. `background`, `foreground`, `cursor`, `cursorAccent` and `selectionBackground` map to `--term-bg`, `--term-fg`, `--term-cursor`, `--term-cursor-text` and `--term-selection`. Read the values with `getComputedStyle` when the theme changes. The pane padding is 12 × 20 px.

| # | Name | Variable | Dark | Light |
|---|---|---|---|---|
| 0 | black | `--ansi-0` | `#1A1C20` | `#2A2824` |
| 1 | red | `--ansi-1` | `#EE7A66` | `#C2412E` |
| 2 | green | `--ansi-2` | `#A3D17F` | `#3F7D2A` |
| 3 | yellow | `--ansi-3` | `#F2C46D` | `#8F6508` |
| 4 | blue | `--ansi-4` | `#78A9F2` | `#2F6BC9` |
| 5 | magenta | `--ansi-5` | `#C9A0EE` | `#8A4FC4` |
| 6 | cyan | `--ansi-6` | `#72CEC7` | `#1F7F79` |
| 7 | white | `--ansi-7` | `#C9C5BD` | `#D3CEC4` |
| 8 | bright black | `--ansi-8` | `#8F8B84` | `#6B675F` |
| 9 | bright red | `--ansi-9` | `#F59A89` | `#D9553F` |
| 10 | bright green | `--ansi-10` | `#BEE29D` | `#4F9636` |
| 11 | bright yellow | `--ansi-11` | `#F7D68E` | `#A87A12` |
| 12 | bright blue | `--ansi-12` | `#9CC1F7` | `#4683E0` |
| 13 | bright magenta | `--ansi-13` | `#DBBDF4` | `#A266DB` |
| 14 | bright cyan | `--ansi-14` | `#96DED8` | `#2A9A92` |
| 15 | bright white | `--ansi-15` | `#F2EFE9` | `#F6F4F0` |
| — | background | `--term-bg` | `#0B0C0E` | `#FBFAF7` |
| — | foreground | `--term-fg` | `#D9D5CD` | `#2A2824` |
| — | cursor | `--term-cursor` | `#F29A52` | `#D9752A` |
| — | cursor text | `--term-cursor-text` | `#0B0C0E` | `#FBFAF7` |
| — | selection | `--term-selection` | `rgba(120, 169, 242, 0.30)` | `rgba(47, 107, 201, 0.20)` |


## Fonts (bundled locally — no Google Fonts)

| Font | Use | Licence | File |
|---|---|---|---|
| **Geist** (Vercel, with basement.studio) | UI chrome | SIL Open Font License 1.1 | `Geist-Variable.woff2`, weights 100–900 |
| **JetBrains Mono** (JetBrains) | Hostnames, paths, terminal | SIL Open Font License 1.1 | `JetBrainsMono-Variable.woff2`, weights 100–800, Latin subset. For full coverage (box drawing, Greek, Cyrillic), bundle the upstream build from github.com/JetBrains/JetBrainsMono. |
| *JetBrainsMono Nerd Font* (optional, not bundled) | Prompt glyphs | OFL 1.1 (the Nerd Fonts patcher is MIT) | Used first in `--font-mono` if the user has it installed. Settings → Terminal lists every installed monospaced font. |

The licence texts are in `fonts/`. Icons are an in-house stroke set (`icons.svg`) under no third-party licence.

## Keyboard map

The rule is: **macOS ⌘ → Linux Ctrl+Shift**, and **⇧⌘ → Ctrl+Alt+Shift**. Plain Ctrl combos always reach the terminal (Kitty keyboard protocol).

| Action | macOS | Linux |
|---|---|---|
| Command palette | ⌘K | Ctrl+Shift+K |
| Go to host (palette limited to Hosts) | ⌘P | Ctrl+Shift+P |
| Switch vault | ⇧⌘O | Ctrl+Alt+Shift+O |
| Open vault file · Create vault | ⌘O · ⇧⌘N | Ctrl+Shift+O · Ctrl+Alt+Shift+N |
| New session · Close tab | ⌘T · ⌘W | Ctrl+Shift+T · Ctrl+Shift+W |
| Go to tab 1–9 (**tabs only**) | ⌘1…⌘9 | Ctrl+Shift+1…9 |
| Reconnect · Duplicate session | ⌘R · ⌘D | Ctrl+Shift+R · Ctrl+Shift+D |
| Files view (sidebar, SFTP) | ⌘E | Ctrl+Shift+E |
| Split (disabled, "coming soon") | ⌘\ | Ctrl+Shift+\ |
| Toggle sidebar (same as clicking the active view) | ⌘B | Ctrl+Shift+B |
| Activity bar: Hosts view · Keys · Credentials | ⇧⌘H · ⇧⌘K · ⇧⌘C | Ctrl+Alt+Shift+H · K · C |
| Settings | ⌘, | Ctrl+Shift+, |
| New host · Edit host | ⌘N · ⌘I | Ctrl+Shift+N · Ctrl+Shift+I |
| Lock vault | ⌘L | Ctrl+Shift+L |
| Copy · Paste in the terminal | ⌘C · ⌘V | Ctrl+Shift+C · Ctrl+Shift+V |
| Font size | ⌘+ ⌘− ⌘0 | Ctrl+Shift+= − 0 |
| Cycle regions (leave the terminal) | F6 / ⇧F6 | F6 / Shift+F6 |

**Collision you should know about:** with only the ⌘ → Ctrl+Shift rule, ⇧⌘K (Keys) and ⌘K (palette) would both become Ctrl+Shift+K on Linux, and the same goes for ⇧⌘C (Credentials) vs ⌘C (Copy). That is why ⇧⌘ maps to Ctrl+Alt+Shift. The alternative is to drop the rail shortcuts on Linux and reach those views through the palette.

## Interaction notes

**Focus order (main shell).** Title-bar palette button → activity bar → sidebar view → tab bar → session toolbar → terminal → status bar.
- The activity bar is one Tab stop; ↑↓ move between Hosts, Files, Keys, Credentials and Settings.
- In the Hosts view: vault button → filter → tree. In the Files view: path bar → file list → transfer queue.
- The tree, the file list and the tab bar each use a roving tabindex: one Tab stop each, arrow keys inside.
- Tree keys: ↑↓ move, ←→ collapse or expand, ↵ connect (or switch to the open tab), ⌘↵ new tab, ⌘I edit, ⌫ delete with confirmation.
- The terminal keeps Tab for the shell. F6 / ⇧F6 cycles regions, so keyboard users can always leave the terminal.

**States.**
- Hover: `--surface-hover` with text raised to primary, 120 ms ease-out.
- Active: `--surface-active`. Primary buttons use `--accent-press`.
- Focus-visible (keyboard only): `--focus-ring`, a 2 px gap in the base colour plus a 2 px accent ring. Mouse focus shows nothing.
- Inputs on focus: accent border plus a 3 px `--focus-glow`. On error: danger border plus `--danger-glow` and a message tied to the field with `aria-describedby`.
- Disabled: 45 % opacity. Controls with a reason (Split, Delete credential in use) use `aria-disabled`, stay focusable and show their tooltip on focus.

**Activity bar and sidebar views.**
- The rail is a 68 px activity bar. Each item is an icon with a 10.5 px label; the active item is tinted ember (`--accent-subtle` behind `--accent-text`).
- Top group, which switches the single sidebar slot: **Hosts** (⇧⌘H) and **Files** (⌘E). After a divider come the full-page views **Keys** and **Credentials**, which hide the sidebar. **Settings** is pinned to the bottom.
- Clicking the already-active view hides the sidebar; clicking it again restores it. ⌘B does the same. While hidden, the item keeps its ember tint without the fill.
- Each view remembers its own width: Hosts is 264 px by default (200–400 px), Files is 340 px (200–480 px). Drag the sidebar's right edge to resize; a double-click resets it.
- Below about 1040 px of window width, the sidebar starts hidden and opens as an overlay over the terminal; esc or clicking outside closes it. Toolbar labels become icons with tooltips (screen 04c, 900 × 600).
- Width changes animate over 240 ms, or instantly under reduced motion.
- The right side of the window stays free. It is reserved for the future agent activity panel (`--agent-panel-w`).

**Prompts over the terminal.**
- Password, passphrase and host-key prompts belong to their tab, not the window. They render inside the pane over `--pane-dim`, and other tabs keep working.
- The tab shows a short accent label ("needs input", "verify host"). If the prompt opened in a background tab, a toast says "prod-api-02 needs your input ⌘2".
- Focus moves into the prompt when its tab becomes active. ↵ runs the primary action and esc cancels the connection attempt.
- **Host key changed** has no default ↵ action. "Replace key and connect" turns on only after the user types the host label. The safe action, "Close session", gets initial focus.
- Session cards (connecting, auth failed, connection lost) use the same layer. The dimmed terminal and its scrollback stay visible for context, and reconnecting keeps the scrollback.

**Files view (SFTP, in the sidebar).**
- Files belongs to the active tab's session, and its header reads "Files · <host label>". When you switch tabs it follows, keeping each session's last folder and scroll position. The session toolbar's Files button (⌘E) opens the same view.
- Without a connected session, it shows "Open a session to browse its files" with Reconnect or Go to host (screen 14c).
- Path bar: `..` (⌘↑), a breadcrumb, and a crosshair that syncs to the terminal's current folder (OSC 7). Below it: Upload and New folder.
- The context menu offers Download, Rename, Copy path, New folder and Delete.
- Dragging files from the OS turns the **whole sidebar** into the drop target and shows the remote path. Existing files ask before they're replaced.
- The transfer queue is docked at the bottom of the sidebar, with per-file progress and cancel. "Clear done" keeps failed items (with Retry) until they're dismissed, and the queue collapses when it's empty.

**Kept out of the MVP screens:** splits (the button is disabled), saved workspaces, session restore, per-host health or latency in the tree, and agent tokens. Caller approval (v3) is designed separately; see below.

## Agent access — v3, milestones 12a & 12b (screens 16*)

| Screen | What it shows |
|---|---|
| `16a1` approval | A modal over the main shell; Flint comes to the front. It names the program ("flint, started by Claude Code wants to use this vault"), shows the process chain zsh → herdr → zsh → flint with its pid, and the request in mono. There's a "1 of 3 waiting" counter. **Hosts** is a radio list: this host, its group (long paths truncate with a tooltip), whole vault. **Actions** are checkboxes: Read, Run commands (pre-ticked, marked needed), and Change the vault (disabled unless Whole vault). **Duration** is a segmented control. The footer has the countdown, Deny (esc) and Allow (⌘↵). |
| `16a2` | The choice doesn't cover the request. A warning line says so, Allow stays enabled, and this request will be refused. |
| `16a3` | Waiting for Touch ID: the system sheet sits on top and Allow reads "Confirm with Touch ID…". On Linux, polkit's dialog takes the same place. |
| `16a4` / `16a5` | Master-password fallback inside the card, and its error: "That is not the master password. Nothing was allowed." |
| `16b` | The unlock screen when the CLI asked while the vault was locked. A top panel shows the request, "Allow flint, started by Claude Code for 1 hour" (ticked), the hint line and Dismiss. |
| `16c1` | Settings → Access, below Vault, with a shield icon. An intro, then Active grants: program, hosts, actions, time left ("42 min left" / "until the vault locks"), anchor pid, Revoke, and Revoke all. |
| `16c2` | Empty state: "No program may use this vault right now". |
| `16c3` / `16c4` | (12b) The "New token…" sheet: name, hosts, actions, expiry (30 days by default; Never is an option). After creation the secret is shown once, with Copy and a strong "you will not see this again" note. |
| `16c5` | (12b) Activity: caller or token, host, action (exec / connect / test / write, plus approved / denied / revoked events), result, time; filters by host and caller. A note says reads aren't logged. |
| `16d` | The status bar item "Agents: 2" opens Settings → Access. While an approval is pending and the window isn't in front, it shows a highlighted "1 waiting". |

**Behaviour**
- Clicking outside the card does nothing; only Deny, esc or the countdown deny.
- Only the box and its label are clickable on options, not the whole row.
- Deny has initial focus. Allow needs ⌘↵ and then the presence step: Touch ID, polkit, or the master password.
- **As built:** initial focus goes to the first password field when the window shows one (16a4, 17a2, 17a4 draw it focused), otherwise to Deny. 17a2 draws both the field and Deny focused; only one can be. Deny's ring shows on `:focus`, not only `:focus-visible`, so it is visible however the window was opened.

## Run as root — v3, milestone 13 (screens 17*)

| Screen | What it shows |
|---|---|
| `17a1` | The approval window in sudo mode. It's 16a1 without Hosts, Actions or Duration, with a danger tone: tinted header and border, plus "Runs as root, once. Nothing else is allowed by this." It shows Where (label, alias, address), As (`lsamaniego → root (sudo)`), the command as **argument chips** with the Flint-added `sudo --` tinted, and the line "Flint types the sudo password saved for CodeBox". The footer has the countdown, Deny (esc) and Run as root (⌘↵). |
| `17a2` | No saved sudo password: the field "Sudo password for lsamaniego on CodeBox" and "Save it for CodeBox", unticked. |
| `17a3` / `17a4` | Waiting for Touch ID (system sheet on top), and the master-password fallback. The fallback field says it's the vault password, not the host's sudo password. |
| `17a5` | A long command (10 arguments, long paths, an `sh -c` script). The chips wrap inside a scrollable block with an argument count and are never truncated. A multi-line argument gets a full-width chip. |
| `17a6` | "1 of 2 waiting", with a "Next" strip showing the queued grant request. |
| `17b1` / `17b2` | Host editor: the Sudo password setting in the auth section. Options: Same as the login password (the default, offered only when the host or its credential has a password), Its own password (Saved · Change · Remove), None: ask each time. One hint line. |
| `17c` | Activity as shipped (When, Caller, Command, Result). Sudo rows get a danger edge and a `root` badge, show the full command, and carry results Allowed, Denied, Timed out, Not a sudoer, Sudo password refused. |

No grant or token ever covers a root command. Each one needs its own approval with presence.

## Whole commands & activity retention — milestone 15 (screens 16e*)

| Screen | What it shows |
|---|---|
| `16e1a` | The approval (16a1) with a long command. The Request box holds a one-line summary ending in "...", then a quiet row with "+1,240 more characters" and a ghost button, "Show full command". |
| `16e1b` | The same treatment on the unlock screen's caller panel (16b), aligned with its text. |
| `16e2a` | The **Full command** modal over the approval. It sits on a second, darker scrim. The command is a wrapped mono block that scrolls (max 360 px) and here holds a heredoc script; under it, "1,397 characters". The footer has Copy and Close. A footer tag reads "Approval still waiting · 1:31 — Esc returns to it", and the countdown keeps running underneath. |
| `16e2b` | The same modal opened from an activity entry, cut: "Cut at 16 KB: 3,100 more bytes not kept.", with a dashed cut marker at the end of the block. Copy is in its "Copied ✓" state. |
| `16e3a` / `16e3b` | **Activity entry**: a key/value block (When with seconds and offset, Caller with process chain, Allowed via a grant / via token / asked you, Host, Action, Result badge) above the command. The sudo variant (`16e3b`) uses the root tint and argument chips, as in 17a/17c. |
| `16e4a` | Activity (16c5) with **Keep**: 30 days · 90 days · 1 year · No limit, with 90 selected. Rows are buttons with hover and focus states, and commands are clamped to 3 lines. |
| `16e4b` | Confirm when a shorter period removes entries: "Keep activity for 30 days?" / "412 entries are older than 30 days and will be removed now. This cannot be undone." / Cancel (focused) and **Remove 412 entries** (destructive). |

## flint cp — grant request variant, milestone 16 (screens 16f*)

These are 16a1 with Hosts, Actions (Run commands marked "needed") and Duration unchanged. The header reads "<caller> wants to copy files to <host>" (or "from <host>"). Under the Request line, a transfer block shows:
- **Direction**, as a strip with a pill for each end and an arrow between them: `This computer → CodeBox` or `CodeBox → This computer`, plus an Upload or Download badge.
- **Paths**: one row for each end, labelled From and To, source first. The path on this computer is always absolute, with `~` expanded. Paths wrap after each `/`, never mid-name, and are never truncated.
- **Optional notes**: "A folder, with everything in it `-r`", and for `--force` a warning that files already in the destination will be replaced.

| Screen | Case |
|---|---|
| `16f1` | Upload a folder (`-r`), with long paths on both ends |
| `16f2` | Download a single file |
| `16f3` | Download a folder with `--force`, showing the warning strip |

- **As built:** the window does not connect before it asks, so **To** is the destination as given, with the source's name added when it ends in `/` (a folder, D-054). `.` and a destination without a trailing `/` stay as given: whether they are folders is only known once connected. A remote path is shown as `flint cp` was given it, relative to the login folder when it does not start with `/`.

## v5 — server to server, and split panes (screens 16g*, 14d*, 18*)

The bytes always flow server A → Flint → server B; no key or password is ever put on a server. The approval window and the Files header both say this ("via Flint").

| Screen | What it shows |
|---|---|
| `16g1` / `16g2` / `16g3` | The approval for copying between two servers, a variant of 16f1. A direction strip reads `prod-api-01 → via Flint → db-primary`. From and To rows show host, alias and path; paths wrap at `/` and are never truncated. Flag chips: "folder (-r)", and "overwrite (--force)" in the warning tone, with the 16f3 strip. Hosts offers "These two hosts" with both chips. 16g3 tags each chip: "already allowed · 32 min left" or "new — this grant adds it". |
| `14d1` | Files header: **Copy to another server…** opens a host picker with a filter, folders as in the sidebar, and the current host greyed out as "this tab". |
| `14d2` | Two file panes. Each has its own header (colour dot, label, role tag **This tab** or **Other server · no tab, Flint-only session**, breadcrumb, `..`, refresh) and its own list. The Files view widens to 700 px, the terminal stays visible with an icon-only toolbar, and **One pane** returns to a single pane. |
| `14d3a` / `14d3b` | Dragging to the other pane: the target pane and folder highlight, and the drag label reads "Copy to db-primary · scripts/". The context menu has **Copy to db-primary** (⌘→). |
| `14d4` | The queue between servers. Each row shows `A → B`, with per-file progress and cancel. A name clash shows a Replace / Skip strip with "Do this for the other N conflicts". |
| `14d5a–d` | The other server, logging in without a terminal, inside its pane: connecting, password (10a), unknown host key (10c), auth failed. |
| `18a1` / `18a2` | Two panes side by side with the **Split** menu open (Split right ⌘D, Split down ⇧⌘D, the four layouts ⌥⌘1–4, Focus next pane ⌘], Close pane ⌘W). Two panes stacked on the same host, with the divider being dragged. |
| `18b` / `18c` | Grid 2 × 2; one large + two small. |
| `18d` | One pane connecting (11a), one with connection lost (11c), two running. The others are untouched. |
| `18e` | Palette: "Open db-primary in a new pane" (⇧⌘↵). |
| `18f` | Four panes at 900 × 600, with the sidebar collapsed and an icon-only toolbar. |
| `18g` | Split panes with the Files view. Files follows the focused pane, and its header carries the same pane number badge. |

**Focus in split panes:** the focused pane has an ember border and a tinted header, and the other panes' output is dimmed to 60 %. Either cue alone is weak with busy output or in light mode; together they hold up. Pane numbers 1–4 appear in pane headers, the toolbar badge ("pane 2 of 4") and the Files header.

**Shortcut change:** Split right takes ⌘D, so **Duplicate session moves to ⌥⌘D**.

## What Flint left out (2026-11-07)

The design is adapted to what Flint has; these parts wait on the roadmap.

- **14a / 14b (milestone 17)**: a finished download has no **Show in Finder** button yet. An upload onto an existing name asks in its queue row (**Replace** / **Skip**), not in a dialog. Upload picks one file; folders upload by dragging them in. The crosshair is greyed out, with a tooltip, while the shell sends no OSC 7. The status bar has no transfer item.

- **16c3 / 16c4**: creating a token from the app. Tokens are made with `flint token create` and approved in the window.
- Token expiry **Never**, and a token's **Last used** column.
- Activity's **exit code**, its **approved / revoked** event rows, its **filters**, and the sudo results **Not a sudoer** and **Sudo password refused**. Activity shows Allowed, Denied and Timed out.
- **17b**: the sudo option **None: ask each time**. Without a password to type (none of the host's, no login password), the window asks for one.
- **17a1**: the command label says "Command", not "runs exactly as shown": Flint runs `sudo -S -k -p <prompt> --`, and the `sudo` chip says so in its tooltip.
- **16e2a**: the size line says "1,397 characters", not "runs exactly as shown" (the request is the caller's command line, not what the host runs).
- **16e3a / 16e3b**: the activity entry has no process chain, grant detail, exit code, duration or sudo result: the log keeps the caller's label, how it was let in, the host, the action and Allowed / Denied / Timed out. A sudo entry's argument chips are read back from the logged command, and shown as text when it was cut.
- **16e4b**: the confirm is the app's shared one (Cancel as a ghost button).
