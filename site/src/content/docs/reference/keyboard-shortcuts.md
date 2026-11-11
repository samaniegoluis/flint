---
title: Keyboard shortcuts
description: Every shortcut of the desktop app, on macOS and Linux.
---

On Linux, <kbd>⌘</kbd> becomes <kbd>Ctrl+Shift</kbd>, <kbd>⇧⌘</kbd> becomes
<kbd>Ctrl+Alt+Shift</kbd> and <kbd>⌥⌘</kbd> becomes <kbd>Ctrl+Alt</kbd>. Plain <kbd>Ctrl</kbd> chords always reach the terminal, which
speaks the Kitty keyboard protocol.

| Action | macOS | Linux |
|---|---|---|
| Command palette | ⌘K | Ctrl+Shift+K |
| Go to host (switches to its open tab, or connects) | ⌘P | Ctrl+Shift+P |
| Switch vault | ⇧⌘O | Ctrl+Alt+Shift+O |
| Open vault file | ⌘O | Ctrl+Shift+O |
| Create vault | ⇧⌘N | Ctrl+Alt+Shift+N |
| New session (pick a host; always a new tab) | ⌘T | Ctrl+Shift+T |
| Close the focused pane (the last one closes the tab) | ⌘W | Ctrl+Shift+W |
| Go to tab 1–9 | ⌘1 … ⌘9 | Ctrl+Shift+1 … 9 |
| Reconnect | ⌘R | Ctrl+Shift+R |
| Duplicate session (a new tab on the same host) | ⌥⌘D | Ctrl+Alt+D |
| Split right · split down | ⌘D · ⇧⌘D | Ctrl+Shift+D · Ctrl+Alt+Shift+D |
| Focus the next · previous pane | ⌘] · ⌘[ | Ctrl+Shift+] · Ctrl+Shift+[ |
| Layout: side by side · stacked · grid · one large + two small | ⌥⌘1 … ⌥⌘4 | Ctrl+Alt+1 … 4 |
| Toggle the sidebar | ⌘B | Ctrl+Shift+B |
| Hosts · Keys · Credentials | ⇧⌘H · ⇧⌘K · ⇧⌘C | Ctrl+Alt+Shift+H · K · C |
| Files view (show or hide) | ⌘E | Ctrl+Shift+E |
| Tunnels view (show or hide) | ⇧⌘T | Ctrl+Alt+Shift+T |
| Settings | ⌘, | Ctrl+Shift+, |
| New host: asks SSH or RDP first (new key or credential on those pages) | ⌘N | Ctrl+Shift+N |
| Edit host | ⌘I | Ctrl+Shift+I |
| Lock vault | ⌘L | Ctrl+Shift+L |
| Quit Flint (closing the window only hides it in the menu bar or tray) | ⌘Q | Ctrl+Shift+Q |
| Copy · paste in the terminal | ⌘C · ⌘V | Ctrl+Shift+C · Ctrl+Shift+V |
| Terminal font size | ⌘+ ⌘− ⌘0 | Ctrl+Shift+= − 0 |
| Move between regions (leave the terminal) | F6 · ⇧F6 | F6 · Shift+F6 |

## In a remote desktop tab

Keys go to the remote desktop, by their place on the keyboard. On macOS <kbd>⌘</kbd> is
sent as <kbd>Ctrl</kbd> (<kbd>⌘C</kbd> is <kbd>Ctrl+C</kbd> on Windows). Flint keeps only
the command palette (<kbd>⌘K</kbd> · <kbd>Ctrl+Shift+K</kbd>) and **Go to tab 1–9**; the
rest is in the palette. See [Remote desktop](/guides/remote-desktop/#keyboard-and-mouse).

## In lists and dialogs

| Where | Keys |
|---|---|
| Host tree | ↑ ↓ move · ← → collapse or expand · ↵ connect · ⌘↵ new tab · ⌘I edit · ⌫ delete |
| Files list | ↑ ↓ move · ↵ open a folder, rename a file · ⌘↑ up one folder · ⌘↓ download · ⌘⌫ delete · context-menu key for the menu |
| Files with two servers | ⌘→ copy to the second pane's server · ⌘← (in the second pane) copy back to the first · esc hide the second pane |
| Command palette | ↑ ↓ move · ↵ open · ⌘↵ new tab · ⇧⌘↵ new pane · ⌘I edit host · Tab next group · esc close |
| Divider between panes | ← → or ↑ ↓ resize · double-click to even out |
| Prompts over a session | ↵ the primary action · esc cancel. A changed host key has no ↵ action |
| Editors | ⌘↵ save · esc cancel |
