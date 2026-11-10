---
title: The desktop app
description: Open or create a vault, browse your hosts, connect in tabs, and answer the prompts a connection can raise.
---

The desktop app reads and writes the same vault as the CLI. A host added in one shows up
in the other, and a server key trusted in one is trusted in both.

## First launch

With no vault yet, Flint shows the welcome screen:

- **Create a new vault**: a name, where to save the file, and a master password (at
  least 8 characters). Put the file in a synced folder (iCloud Drive, Dropbox,
  Syncthing) to use it on several machines.
- **Open a vault file…**: pick an existing `.flint` file.

After that, Flint reopens the last vault on every launch and asks for its master
password, or opens it without a prompt if you ticked **Remember on this computer** at
unlock ([what that means](/guides/vaults/#remember-on-this-computer)). You can turn the
reopening off in **Settings → Appearance → Window**.

**Closing the window keeps Flint running** in the menu bar (macOS) or the system tray
(Linux), serving the programs you approved, with the window locked: opening it again
asks for Touch ID, polkit or the master password
([the window's own lock](/guides/vaults/#the-windows-own-lock)). **Quit Flint** in the
menu bar icon, ⌘Q or the command palette quits it.

## The main window

| Area | What it holds |
|---|---|
| Title bar | The vault and the active session; the command palette button |
| Activity bar (left) | **Hosts**, **Files** and **Tunnels** (all three in the sidebar; Tunnels counts the ones running), **Keys**, **Credentials**, and **Settings** at the bottom |
| Sidebar | **Hosts**: the vault button (switch vaults), a filter, and your hosts in their groups. **Files**: the focused pane's host, over SFTP ([The Files view](/guides/files-view/)). **Tunnels**: every tunnel by host, with a switch and its state ([Tunnels](/guides/tunnels/#in-the-app)) |
| Main area | The tabs, the session toolbar and the terminals: up to four panes in a tab ([Split panes](#split-panes)) |
| Status bar | Lock state, the number of open sessions, **N tunnels up** while any runs (it opens the Tunnels view), **Lock**, and **Agents: N** while programs you approved may use the vault (it opens Settings → Access, and shows **N waiting** while a request waits and Flint is not in front) |

Click **Hosts** again (or press <kbd>⌘B</kbd>) to hide the sidebar and give the terminal
the whole width; it stays hidden when you come back to **Hosts** from another view. Drag the sidebar's right edge to make it wider or narrower (200 to 400 px;
double-click the edge for the default width, or focus it and use <kbd>←</kbd> <kbd>→</kbd>).
Below about 1040 px of window width the sidebar starts hidden and opens over the terminal.

Flint remembers the layout on this machine: whether the sidebar is open, its width, and
which groups are collapsed in each vault. See [Layout on this machine](#layout-on-this-machine).

### The host tree

- Double-click a host, or select it and press <kbd>↵</kbd>, to connect. If the host
  already has an open tab, Flint switches to it; <kbd>⌘↵</kbd> always opens a new tab.
- <kbd>↑</kbd> <kbd>↓</kbd> move, <kbd>←</kbd> <kbd>→</kbd> collapse and expand groups,
  <kbd>⌘I</kbd> edits the selected host, <kbd>⌫</kbd> deletes it after a confirmation.
- Right-click a host to connect, edit or delete it. Right-click a group for **New host
  here**, **New subgroup**, **Rename** and **Delete** (only an empty group can be
  deleted).
- The filter matches aliases, labels, hostnames and tags.
- A host with tunnels up carries a small tunnel mark with their count; hover it for the
  list. Its tabs carry the same mark.
- **Collapse all** and **Expand all** sit beside **New group** at the top of the tree, and
  in the command palette.

## Hosts, keys and credentials

**New host** (<kbd>⌘N</kbd>) opens the host editor: alias, label, hostname and port,
folder, authentication, user, jump host, a command to run on connect, tags, colour and
notes. Authentication is one of:

- **Credential**: a saved login shared by many hosts. The host's **User** field, when
  set, overrides the credential's user.
- **Key**: a key stored in the vault.
- **Password**: saved in the vault, sealed. It stays hidden; leave the field empty to
  keep it. The eye button shows it for 10 seconds, read-only, and the copy button puts
  it on the clipboard without showing it. Flint marks the copy so clipboard managers do
  not keep it (macOS, KDE) and clears the clipboard after 30 seconds, unless you copied
  something else since. The CLI never prints a password.
- **Agent**: the keys in your SSH agent (`SSH_AUTH_SOCK`).

Whatever the choice, Flint tries the methods in the [order the CLI
uses](/guides/connecting/#how-flint-logs-in), then the agent, then asks for a password.

Below authentication, **Sudo password** sets what [`flint exec
--sudo`](/guides/ai-agents/#sudo) types when sudo asks: **Same as the login password**
(it says where that comes from, the host's password or its credential's, or that there is
none and the approval window asks each time), or **Its own password**. A saved one shows
as **Saved**, never its value, with **Change** and **Remove**.

**On connect** is a command that every new session on the host runs, such as `herdr`
or `tmux new -A -s main`. It runs in your login shell with your profile and `PATH`, as
if you had typed it. With **Return to a shell when it exits** (the default) a shell
follows; without it, the session ends with the command. See [Run a command on
connect](/guides/hosts/#run-a-command-on-connect).

**Test connection** tries what the form says right now, saved or not: it goes through
every jump host, checks each host key and logs in, then hangs up. A server Flint has not
seen asks to be verified inside the editor; a key you trust there is kept, and belongs
to the host once you save it. The result appears above the buttons: **Connection
works** with the address it reached and how long it took, or **Test failed** with the
reason. A test never asks for a password. `flint host test` does the same in the CLI.

**Keys** lists the vault's SSH keys with their type, fingerprint and how many hosts or
credentials use them. **Add key** takes a pasted private key or a file, plus its
passphrase if it has one. **Copy** puts the public key on the clipboard. A key or a
credential that is in use cannot be deleted.

**Credentials** lists your shared logins. Each one is a username plus a password, a key,
or the agent. A saved password can be shown or copied the same way as a host's.

## Connecting

A session opens in its own tab. While it connects, the tab shows a card over the
terminal; other tabs keep working. When a background tab needs you, a toast names it and
its shortcut.

### A host Flint has not seen before

Flint shows the server's address, key type and SHA-256 fingerprint. Compare it with one
from the server's admin or console, then **Trust and connect**. The key is stored in the
vault, so the CLI trusts it too. **Cancel** (<kbd>esc</kbd>) stops the connection.

### A host whose key changed

Flint stops before logging in and shows both fingerprints: the trusted one and the one
presented now. Someone may be intercepting the connection; it also happens when a
server is rebuilt. **Close session** is the default. To accept the new key, type the
host's alias, then **Replace key and connect**: Flint forgets the old key (as
`flint known-host rm` does) and asks you to verify the new one.

### A password prompt

When no saved method is accepted, Flint asks for the password once. It is used for that
connection only; save it in the host editor to skip the prompt next time.

### When a session ends

The terminal and its scrollback stay. A card says why the session ended (the shell's
exit status, a failed login, a lost connection) with **Reconnect** (<kbd>⌘R</kbd>), which
keeps the scrollback. **Duplicate** (<kbd>⌥⌘D</kbd>, <kbd>Ctrl+Alt+D</kbd> on Linux)
opens another session to the same host in a new tab.

### Tunnels from a session

The session toolbar's **Tunnels** button counts the host's tunnels that are up; its menu
has a check per tunnel, with its state, and **Manage tunnels…** (the host editor's
Tunnels section). Connecting to a host starts its tunnels marked *Open when I connect*.
Tunnels run in a session of their own, so reconnecting or closing the tab leaves them up.
See [Tunnels](/guides/tunnels/#in-the-app).

### Split panes

A tab holds up to four panes, each its own SSH session with its own login, scrollback,
prompts and **Reconnect**. One pane losing its connection leaves the others alone.

- **Split right** (<kbd>⌘D</kbd>) and **Split down** (<kbd>⇧⌘D</kbd>) open a new pane on
  the focused pane's host, beside it. On Linux they are <kbd>Ctrl+Shift+D</kbd> and
  <kbd>Ctrl+Alt+Shift+D</kbd>. The session toolbar's **Split** button has the same
  actions, the layouts and **Close pane**.
- To open *another* host in a new pane, search for it in the command palette and press
  <kbd>⇧⌘↵</kbd>, or pick **Open <host> in a new pane**.
- Two panes sit side by side or stacked, as you split them; three become one large and
  two small, four a 2 × 2 grid. Change the layout from the **Split** menu or with
  <kbd>⌥⌘1</kbd> to <kbd>⌥⌘4</kbd> (<kbd>Ctrl+Alt+1</kbd> to <kbd>4</kbd> on Linux):
  side by side, stacked, grid, one large + two small.
- Drag the line between two panes to resize them; double-click it to even them out, or
  focus it with <kbd>Tab</kbd> and use the arrow keys. New panes and new layouts start
  even.

The **focused pane** has an ember border and a tinted header, and the others' output is
dimmed. Click a pane to focus it, or press <kbd>⌘]</kbd> and <kbd>⌘[</kbd> for the next
and previous one (<kbd>Ctrl+Shift+]</kbd> and <kbd>[</kbd> on Linux). The tab's title,
the session toolbar (with **pane 2 of 4**), **Reconnect**, the title bar and the
[Files view](/guides/files-view/) follow the focused pane.

<kbd>⌘W</kbd> closes the focused pane and hangs up its session; the last pane closes the
tab. The tab's **×** closes the tab and every pane in it. A prompt that opens in a pane
without the focus shows a note naming its pane. Layouts are not kept when Flint quits.

### The terminal

The terminal is xterm.js with the Kitty keyboard protocol. Plain <kbd>Ctrl</kbd> chords
always reach the shell; on Linux, Flint's own shortcuts use <kbd>Ctrl+Shift</kbd>. Copy
and paste with <kbd>⌘C</kbd> <kbd>⌘V</kbd> on macOS and <kbd>Ctrl+Shift+C</kbd>
<kbd>Ctrl+Shift+V</kbd> on Linux. Right-click copies the selection, or pastes when
nothing is selected. <kbd>⌘+</kbd> <kbd>⌘−</kbd> <kbd>⌘0</kbd> change the font size of
open sessions. Its colours come from **Settings → Terminal → Colours**.

**Copy from a remote program.** Neovim, tmux and Zellij can copy to your clipboard over
SSH with the OSC 52 sequence: a yank in Neovim (with `clipboard=unnamedplus`, or its
built-in OSC 52 provider), a copy-mode selection in tmux (`set -g set-clipboard on`) or
in Zellij lands on your Mac's or Linux desktop's clipboard. Flint only lets a remote
program *write* the clipboard: a request to read it is ignored, so nothing on the server
can see what you copied. A single copy is limited to 1 MB.

**Accents and other layouts.** Dead keys (US International, ABC Extended, most ISO
layouts) and input methods (Japanese, Chinese, Korean) compose as they do in any other
app: <kbd>'</kbd> <kbd>e</kbd> types `é`, and <kbd>'</kbd> <kbd>s</kbd> types `'s`, not
`''s`. Dictation and text expansion insert the whole phrase. Everything you type reaches
the server in the order you typed it, also when the terminal answers a burst of
queries from a full-screen program.

## The command palette

<kbd>⌘K</kbd> searches hosts, actions and vaults. <kbd>⌘P</kbd> (**Go to host**)
searches hosts only, and <kbd>↵</kbd> takes you to the host's open tab or connects it if it
has none. <kbd>⌘T</kbd> (**New session**) searches hosts too, but <kbd>↵</kbd> always opens
a new tab, so pressing it twice on the same host gives you two sessions. In the other
palettes <kbd>⌘↵</kbd> opens a host in a new tab. With a tab open, <kbd>⇧⌘↵</kbd> opens
the host in a new pane of that tab ([Split panes](#split-panes)), and while you search the
best matches are also offered as **Open <host> in a new pane**. <kbd>⌘I</kbd> edits the
host, and <kbd>Tab</kbd> moves between result groups.

While you search, tunnels are offered too: **Start tunnel <name> on <host>**, **Stop
tunnel …**, **Connect to <host> with tunnels** and **Manage tunnels of <host>…** (see
[Tunnels](/guides/tunnels/#in-the-app)).

When the search finds a host with an [initial command](/guides/hosts/#run-a-command-on-connect),
a second row, **Connect without command**, opens it in a new tab with a plain shell, as
`flint connect --no-command` does. Use it when that program is broken: the command
stays saved, and **Reconnect** in that tab keeps skipping it.

## Vaults

The vault button at the top of the sidebar (<kbd>⇧⌘O</kbd>) lists your recent vaults,
with **Open vault…**, **Create vault…** and **Manage vaults…**. Switching vaults closes
the sessions of the current one. **Manage vaults** can forget a vault's remembered key on
this machine, or remove it from the list; the file itself is never deleted. It also has
**Rename** for the open vault, as does **Settings → Vault**: the name changes inside the
vault and in the list, and the file keeps its name and place (see
[Rename or move a vault](/guides/vaults/#rename-or-move-a-vault)).

**Lock** (<kbd>⌘L</kbd>) wipes the vault key from memory and shows the lock screen over
the window. **Open sessions keep running** behind it and are there when you unlock; the
`flint` CLI and new sessions wait. Once locked, the vault opens again only with its master
password, never from the keychain, until Flint restarts. The unlock screen keeps
**Remember on this computer** ticked for a vault this computer remembers; untick it to
remove its key. **Close vault** on the lock
screen ends its sessions instead.

The vault also locks on its own: after **Settings → Vault → Lock after** (1 hour by
default; 1 minute to 4 hours, or never) with nobody using Flint or its CLI, when the
screen locks, and before the computer sleeps. See [Locking](/guides/vaults/#locking).

When a `flint` command finds the vault locked and has no terminal to ask on (an agent, a
script), Flint comes to the front on the unlock screen and names the command: *"`flint
exec web -- uptime` wants to use this vault."* A command longer than one line says how
much is left (*+1,240 more characters*) and has **Show full command**. With **Allow … for 1 hour** ticked, the
program that ran it is approved in the same step, for that host (or the whole vault for a
command that names none); the master password you type confirms it. Unlock, and the
command can run again. With Flint closed, `flint` starts it.

### Approving a program

The first time a program runs `flint` while the vault is unlocked, Flint comes to the
front with the approval window: who asks (*"flint, started by Claude Code"*, with its
chain of processes), the command, and what to allow: the host, its group or the whole
vault; reading, running commands, changing the vault; for 15 minutes, 1 hour, 4 hours or
until the vault locks. The action the command needs is marked *needed*; a choice that
does not cover it says so, and that request will still be refused. **Allow**
(<kbd>⌘↵</kbd>, <kbd>Ctrl+↵</kbd> on Linux) asks for Touch ID or your Mac's password
(macOS), your login password through polkit (Linux), or the master password. **Deny**
has the focus (<kbd>Esc</kbd>), unless the window asks for a password; it refuses, and so
does no answer within two minutes (the countdown shows it). Several requests wait in
turn: the window says *1 of N waiting* and names the next one. See
[Approve a program](/guides/ai-agents/#approve-a-program).

The command is shown on one line. When it is longer, the window says how much is left
and **Show full command** opens all of it (up to 16 KB) in a scrolling panel with
**Copy**; <kbd>Esc</kbd> or **Close** goes back to the request, which is still waiting.
Viewing it asks for no Touch ID or password. What the window shows is read from the
arguments Flint will run, not from words the program sends.

`flint cp` is a request to run commands on that host (reading or writing its files has
that power), and the window says so: **wants to copy files to** (or **from**) the host.
A strip shows the direction (*This computer → host*, marked Upload or Download), then
**From** and **To** with the whole path on each end, never cut. A folder copy (`-r`) says
so, and `--force` adds a warning that files already in the destination are replaced. See
[Copying files](/guides/files/).

`flint tunnel up` shows the host, then `127.0.0.1:<port>` on this machine → the
destination on the host, and says the grant would also let the program run commands
there. When that port is already in use here, the window says so, names the program that
holds it when it runs as you, and **Allow** is off: the tunnel could not open. See [Tunnels](/guides/tunnels/#through-an-agent).

`flint token create` brings up the same window showing the token instead: its name, what
it allows, which hosts and when it expires. **Allow** (with presence) creates that one
token; it never becomes a grant, so the next `token create` asks again. See
[Tokens for scheduled jobs](/guides/ai-agents/#tokens-for-scheduled-jobs).

`flint exec <alias> --sudo -- <command>` brings it up for one command as root: the
host, the login user, and the command's arguments, one per chip, after the `sudo --`
Flint adds (tinted), never cut short. **Run as root** (with presence) allows that command
only. When Flint holds no
password for sudo on that host, the window asks for one, with **Save it for this
host**. See [sudo](/guides/ai-agents/#sudo).

## Settings

Settings belong to this machine, not to the vault, and save as you change them.

- **Appearance**: dark, light or matching the system; the accent colour; row density;
  whether to follow the system's reduce-motion setting; reopening the last vault.
- **Terminal**: the colours (Default, Catppuccin, Tokyo Night, Aura, Dracula or Nord, each
  in a dark and a light variant that follows the app's theme), the font (any monospaced
  font installed on this machine, or the bundled JetBrains Mono), size, line height and
  cursor.
- **Keyboard shortcuts**: the full map for macOS and Linux. Custom shortcuts are coming
  in a later version.
- **Vault**: the open vault's file and counts, **Rename**, whether this machine remembers
  its key, **Lock now**, **Lock after**, and the known hosts, each of which you can forget.
- **Access**: the programs you approved, with what they may do and until when, and
  **Revoke** for each (or all). Grants end when the vault locks or Flint quits. Below
  them, the vault's **tokens** (**Revoke** ends one; **Show ended** lists the expired
  and revoked ones) and the **activity log**: when, which program or token, the command
  and whether it was allowed, denied or left unanswered, newest first, with **Load
  more**. Allowed reads are not recorded; refused ones are. Click an entry, or press
  <kbd>Enter</kbd> on it, for its detail: the exact time with seconds, the caller, how it
  was allowed, the host and the whole command, with **Copy**. **Keep** sets how long the
  vault keeps entries: 30 days, 90 days (the default), 1 year or no limit. A shorter
  choice that removes entries says how many and asks first. This setting is in the vault,
  not on this machine, and only this window changes it.

They are kept in `settings.json` in Flint's config folder (`~/Library/Application
Support/Flint` on macOS, `~/.config/flint` on Linux), next to the recent-vaults list.

## Layout on this machine

The sidebar (open or closed, and its width) and the collapsed groups of each vault are
kept in `ui-state.json` in the same config folder, not in the vault: a vault synced
between machines is not rewritten each time you fold a group, and each machine keeps its
own layout. The file holds only ids: a vault is named by a hash of its salt, and a group
by its random id, so it never contains a vault, group or host name. A vault that is moved
or renamed keeps its layout, and so does a renamed group. If the file is damaged, Flint
starts from the default layout.
