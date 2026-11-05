# Flint — desktop UI handoff (MVP)

Direction **A (Editor)** as the base, plus B's command palette and unlock layout and C's in-pane session cards.

## What's in this folder

| Path | What it is |
|---|---|
| `screens/NN-screen-name.{dark,light}.html` | One plain HTML file per screen and theme. Open in a browser at ≥ 1280 px wide. |
| `screens/15-wireframe-agent-activity.*.html` | Wireframe only: reserves space for the post-MVP agent panel. |
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

**Kept out of the MVP screens:** splits (the button is disabled), saved workspaces, session restore, per-host health or latency in the tree, and agent tokens. The agent panel appears only as a wireframe, on the right side of the window, which stays free now that Files lives in the left sidebar.
