---
title: The Files view
description: Browse a host's files beside its terminal, upload and download with a queue, drag files in from your computer, copy files between two servers, and jump to the terminal's folder.
---

The **Files** view browses the host of the active tab, over that tab's own connection.
In a tab split into panes, it browses the focused pane's host.
It needs no second login: a host that asks for a password or a one-time code asks once,
for the terminal. Open it with **Files** in the activity bar, the session toolbar's
**Files** button, or <kbd>⌘E</kbd> (<kbd>Ctrl+Shift+E</kbd> on Linux). Press it again to
hide it.

The view follows the active tab, and in a split tab its [focused pane](/guides/desktop-app/#split-panes).
Its header reads **Files · <host>**, with the pane's number when the tab has several, and
each tab or pane keeps its own folder and scroll position, so switching and coming back
puts you where you were.
When the active tab is not connected, the view says so and offers **Reconnect** (or
**Go to host…** with no tab open).

## Moving around

- **..** and <kbd>⌘↑</kbd> go up one folder; double-click a folder (or select it and
  press <kbd>↵</kbd>) to open it. The breadcrumb takes you to any folder above.
- The list shows folders first, then files, with their size and when they changed.
  **Refresh** in the header lists the folder again.
- The crosshair at the end of the path bar goes to **the terminal's current folder**. It
  needs the shell to report its folder (see [below](#go-to-the-terminals-folder)); while
  it does not, the button is greyed out and says so. When the list shows the terminal's
  folder, the bar reads **Synced with terminal**.

When the shell has reported its folder (see [below](#go-to-the-terminals-folder)), the
view **opens on the terminal's folder**: each time you open it, not as you `cd` while it
is open, so the list never moves under you. Otherwise it opens where you left it, or in
the login folder the first time. A folder that is gone takes you back to the login
folder.

## Files and folders

Right-click a file or folder (or press the context-menu key) for these; the keys work
while the list has the focus:

| Action | Keys | What it does |
|---|---|---|
| **Download…** | <kbd>⌘↓</kbd> | Asks where to save it on this computer, then queues the download. A folder comes with everything in it |
| **Rename** | <kbd>↵</kbd> on a file | Renames it in place. A name already taken is refused |
| **Copy path** | | Puts its full path on the host on the clipboard |
| **New folder…** | | Creates a folder in the current one |
| **Delete…** | <kbd>⌘⌫</kbd> | Asks first, then deletes it. A folder is deleted with everything in it |

**Upload** above the list picks a file on this computer and uploads it into the current
folder. **New folder** creates one there.

## Dragging files in

Drag files or folders from Finder or your file manager onto the view: the whole sidebar
becomes the drop target and shows the folder they go to. Drop them and they upload into
the folder the list shows, folders with everything in them.

The window cannot read a dropped file from its place on disk, so Flint first copies it
into its own folder on this computer (`drops/` in Flint's config folder, readable only by
you), uploads it from there, and deletes that copy once the upload ends. A large drop
takes a moment to read before its upload starts; its row says **Reading the dropped
files…** meanwhile.

## The transfer queue

Transfers line up at the bottom of the view, one at a time for each session, with their
progress, speed and the time left. **×** cancels one, or takes it out of the queue before
it starts.

- **An existing file is never replaced without asking.** An upload onto a name that is
  already there stops with **Already there**, and the row offers **Replace** or **Skip**.
  A download asks in the save dialog, the way your system does.
- A file is written under a temporary name (`.<name>.flint-part`) and gets its own name
  only once complete, so a cancelled or failed transfer never leaves half a file under
  the real name.
- A failed transfer stays in the queue with the reason (**Permission denied**,
  **Connection lost**…) and **Retry**. **Clear done** removes the finished and cancelled
  rows and keeps the failed ones until you dismiss them.
- Closing the tab, or the session ending, stops its transfers.

A running transfer keeps going while Flint's window is locked; the next ones in the queue,
and browsing, wait until you open it again. Transfers are not written to **Settings → Activity**, which records what programs do
with the vault, not what you do in the window.

The same copies from a terminal, or from a script, are [`flint cp`](/guides/files/).

## Copying between two servers

**Copy to another server…** in the view's header copies files from this host straight to
another one. Pick the other server in the list (type to filter; the current host is
greyed out as *this tab*), and a second file pane opens beside the view, on that server.

- The bytes go **host → Flint → host**: Flint reads from one server and writes to the
  other as it reads, with nothing saved on this computer, and no key or password is ever
  put on either server.
- The second pane uses the server's open tab when it has a connected one (*its tab's
  session*). Otherwise Flint logs in to it **without a terminal**, just for the pane
  (*Flint-only session*): a password or a new host key is asked inside the pane,
  as a connect would, and that session ends when the pane closes. A host key that has
  changed is never accepted there; open a tab on the host to review it.
- **Drag** a file or folder from one pane onto the other. The pane, and the folder under
  the pointer, light up, and a label says where the copy goes (*Copy to db-primary ·
  scripts/*). Dropped on the pane, it goes into the folder the pane shows; on a folder
  row, into that folder.
- Or right-click it and choose **Copy to <server>**, or press <kbd>⌘→</kbd>
  (<kbd>Ctrl+Shift+→</kbd> on Linux) in the first pane; <kbd>⌘←</kbd>
  (<kbd>Ctrl+Shift+←</kbd>) copies from the second pane back to the first.
- The copies line up in the first pane's queue, each row reading *host → host*, with
  progress, cancel and **Retry**. A name that is already there asks **Replace** or
  **Skip**; with several clashes, **Do this for the other N conflicts** answers them all.

The second pane **floats over the terminal**: the terminal keeps its size, so nothing in
it redraws. <kbd>esc</kbd>, a click in the terminal or the pane's **‹** button hide it,
but the copies, the pane's folder and its session carry on: the header's
**⇄ <server> · N copying** shows it again as it was. **One pane** closes it and ends its
own session; closing the tab or locking the vault does too.

Like the rest of the window's transfers, these copies are not written to **Settings →
Activity**. From a terminal or a script, the same copy is
[`flint cp a:/path b:/path`](/guides/files/).

## Go to the terminal's folder

Shells can report the folder they are in with an escape sequence known as **OSC 7**.
Flint reads it from the session and offers that folder in the Files view. Some setups send
it already (fish, many zsh themes and terminal integrations). Otherwise add one of these
on the **host**, in the shell's startup file, and open a new session:

**zsh** (`~/.zshrc`):

```zsh
_flint_osc7() { printf '\e]7;file://%s%s\e\\' "$HOST" "${PWD// /%20}" }
autoload -Uz add-zsh-hook && add-zsh-hook chpwd _flint_osc7 && _flint_osc7
```

**bash** (`~/.bashrc`):

```bash
PROMPT_COMMAND='printf "\e]7;file://%s%s\e\\" "$HOSTNAME" "${PWD// /%20}"'"${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

**fish** (`~/.config/fish/config.fish`), if your version does not send it:

```fish
function __flint_osc7 --on-variable PWD
    printf '\e]7;file://%s%s\e\\' $hostname (string replace -a ' ' '%20' $PWD)
end
__flint_osc7
```

Flint takes only the path from the report; the host name in it is not checked.

## Width

Drag the view's right edge to make it wider or narrower (200 to 480 px); double-click the
edge for the default 340 px. It keeps its own width, apart from the Hosts sidebar's, on
this machine.
