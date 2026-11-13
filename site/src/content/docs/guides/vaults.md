---
title: Vaults
description: Create, open, lock and switch between encrypted vaults, and how Flint holds the unlocked one.
---

A **vault** is one file that holds your hosts, groups, SSH keys and credentials. The
whole file is encrypted with a key derived from its **master password**, so you can keep
it in a cloud-synced folder (iCloud Drive, OneDrive, Dropbox, Syncthing). Nothing about
your servers is readable on disk. [Vault format](/reference/vault-format/) covers how
the encryption works.

## Create a vault

```sh
flint vault create ~/Sync/home.flint --name "Home Lab"
```

Flint asks for the master password twice. It must be at least 8 characters. Without
`--name`, the vault is named after its file (`home`).

The new vault becomes the **current vault**: the one every `host`, `key`, `group` and
`cred` command uses unless you pass `--vault`.

:::caution
There is no way to recover a vault whose master password is lost. Keep it in a password
manager.
:::

## Flint holds the unlocked vault

An unlocked vault's key lives in the **running Flint app**, and only there. Everything
else asks the app:

- **The app** unlocks a vault with its master password. On launch it reopens the last
  vault without a prompt only if you ticked
  [Remember on this computer](#remember-on-this-computer) for it. The password itself is
  never stored.
- **The `flint` CLI** never reads that keychain. While Flint is open with the vault
  unlocked, every command on that vault runs **inside the app**: the CLI hands it the
  command line over a local socket and prints what comes back. `connect`, `exec` and
  `host test` run there too, with your terminal, the prompts and the remote PTY relayed.
  The output and exit codes are the same either way.
- Otherwise the CLI asks for the master password **for that one command**, on your
  terminal or from `--master-stdin`, and keeps nothing.
- With **no terminal** (an agent, a script, a cron job) and no `--master-stdin`, `flint`
  asks Flint to unlock: it starts the app if it is closed, the unlock screen names the
  command (*"`flint exec web -- uptime` wants to use this vault"*), and the command fails
  with `locked`. Unlock in the window and run it again.

| Command | What it does |
|---|---|
| `flint vault unlock` | Asks Flint to unlock the vault (starting it if needed) and waits up to 2 minutes for you to unlock it there |
| `flint vault lock` | Locks the vault in Flint and removes any key cached on this machine |
| `flint vault status` | Shows whether Flint holds the vault unlocked, and what it holds when it does |

A command that needs a secret of its own (`--password`, `--passphrase`, a host's
password at login) asks for it in your terminal, and only sends it to
Flint. The socket is `flint.sock` in the config folder, usable by you only; Flint closes
any connection from another user before reading it.

If Flint has **another** vault open, a command on this one asks for its master password,
or fails with `locked` (*"Flint has vault 'Work' open"*) when nobody can type it.

`FLINT_APP` tells `flint` where the app is when it is not in the usual place (a path to
the `Flint` program or to `Flint.app`); `FLINT_APP=off` never starts it.

### What this protects, and what it does not

| | |
|---|---|
| A program reads the vault key from the keychain through `flint` | **No.** The CLI never reads it |
| A program runs `flint` while the vault is unlocked in Flint | Only once you approve it in Flint's window, for the hosts, actions and time you choose ([Approve a program](/guides/ai-agents/#approve-a-program)) |
| A program runs `flint` while the vault is locked or Flint is closed | No. It gets `locked`, and Flint's window asks you |
| On Linux, another program reads the app's remembered key from the Secret Service | Only if you ticked **Remember on this computer**: the Secret Service has no per-app access list. Without it no key is ever written there |
| Someone at your unlocked computer opens Flint's window | Not when you closed it to the menu bar or tray: it asks for the master password or Touch ID. Yes while the window is open |

No program gets your passwords or keys through `flint`: no command prints them. What an
approved program can do is run commands on the servers you allowed through `flint exec`. To narrow that, see
[Use Flint with an AI agent](/guides/ai-agents/#limits-today).

## Locking

A vault locks **on its own**:

- after a time with nobody using it: no typing or clicking in Flint, no `flint` command.
  **Settings → Vault → Lock after** sets it: 1, 5, 15 or 30 minutes, 1 hour (the
  default), 4 hours, or never;
- when the screen locks;
- before the computer goes to sleep.

And when you choose: **Lock** in the status bar, ⌘L (Ctrl+Shift+L on Linux), the
command palette, or `flint vault lock`.

Locking overwrites the vault key in memory. The window shows the lock screen, and the
CLI gets `locked` until you unlock. **Open sessions keep running** behind the lock
screen: they hold no key, and you find them as you left them. Once locked, the vault opens
again **only with its master password**, never from the keychain, until Flint is
restarted. **Close vault** on the lock screen ends its sessions instead.

On Linux, Flint hears the screen lock and sleep from logind (`Lock`, `PrepareForSleep`)
and from the desktop's screensaver (`org.freedesktop.ScreenSaver` or
`org.gnome.ScreenSaver`). A desktop that sends none of them still locks on the idle time.

## Remember on this computer

The unlock and create screens have a **Remember on this computer** box, **off by
default**. Ticked, the vault key goes into the OS keychain (Keychain on macOS, the Secret
Service on Linux) and Flint reopens the vault on launch without the master password. The
box says what that costs: *Flint, the `flint` CLI and the agents you approve open this
vault without the master password. Anyone using this computer while it is unlocked can
open Flint too.* The CLI still goes through Flint and its approvals; it never reads the
keychain.

Left unticked, no key reaches the keychain, and Flint asks for the master password on
every launch. Unticking it on a vault this computer remembers removes its key, as do
**Forget on this device** in **Settings → Vault** and `flint vault lock`.

Before version 3 (milestone 14) Flint cached the key on every unlock. The first time a
newer Flint starts, it removes those keys once; tick the box at the next unlock to keep a
vault remembered.

On macOS, each new Flint build has a new code identity until releases are signed, so the
first time the app reads a remembered key macOS asks whether Flint may use your
confidential information. **Always Allow** asks for your login password and stops the
dialog until the next build; **Deny** makes Flint ask for the master password instead.

## The window's own lock

Closing Flint's window does not quit it: Flint stays in the **menu bar** (macOS) or the
**system tray** (Linux), the vault stays unlocked, and the programs you approved keep
working. The **window** is locked: opening it again, from the menu bar icon (**Open
Flint**), the Dock, or by launching Flint again, shows a lock screen that opens with
Touch ID (or your Mac's password), polkit on Linux, or the vault's master password.
Until then the window shows the vault's name and how many commands wait for an answer,
nothing from inside the vault, and nobody can type into the sessions behind it.

A new program that asks while the window is locked waits, as usual, for up to two
minutes: Flint comes to the front, and you answer once the window is open.

The menu bar icon also has **Lock Vault** (the vault's own lock, which ends every grant)
and **Quit Flint**. ⌘Q, **Quit Flint** in the command palette and Ctrl+Shift+Q on Linux
quit too. On a Linux desktop that shows no tray icon (GNOME without the AppIndicator
extension, some Wayland sessions), launch Flint again to bring its window back.

## Several vaults

Flint remembers every vault it has opened on this machine, most recent first.

```sh
flint vault list                    # * marks the current vault
flint vault open ~/Work/work.flint  # open a vault file and make it current
flint vault use "Home Lab"          # switch by name (or by path)
flint --vault work host list        # use another vault for one command
flint vault rename "Home Lab"       # rename the current vault
flint vault forget work             # drop it from the list; the file is kept
```

`--vault` takes a vault's name (any case) or a path to its file.

## Rename or move a vault

`flint vault rename <new-name>` changes the name stored inside the vault, and its entry in
the list. The file keeps its name and place, so a test vault can become your real one
without being copied. Two vaults in the list cannot share a name (ignoring case), since
`--vault <name>` could no longer tell them apart. The desktop app has **Rename** in
**Manage vaults** and in **Settings → Vault**, for the open vault.

To move a vault, move its file (in Finder, a file manager or with `mv`) and open it from
its new place: Flint recognises it and replaces the old entry in the list instead of
keeping a dead one.

## Change the master password

```sh
flint vault passwd                 # the current vault
flint --vault work vault passwd    # another one
```

Flint asks for the current master password, then the new one twice, and prints how
strong the new one is, from **Very weak** (0) to **Very strong** (4). The estimate is
[zxcvbn](https://github.com/dropbox/zxcvbn)'s, run inside Flint: common passwords, words
and names (also reversed or with `@` for `a`), rows of keys, repeats, sequences, years
and dates all count as easy to guess, and so does the vault's own name. Any password of 8
characters or more is accepted, but under **Strong** (3) Flint warns you: a vault shared
through a remote vault will need at least that.

In the desktop app it is **Change master password…** in **Settings → Vault**, with the
estimate shown as you type. While the app holds the vault unlocked, `flint vault passwd`
is refused and points you there, so two programs never re-key one vault at once.

What changes and what stays:

- The vault gets a new salt and a new key. Every saved password, private key and
  passphrase is sealed again under the new key, and this machine's activity file is
  re-encrypted with it.
- The vault keeps its **id**, so its place in the vault list, the app's layout and its
  activity log stay with it.
- **Remember on this computer** stays on if it was on: the new key replaces the old one
  in the keychain.
- Other machines that use the vault through a synced folder need the new password the
  next time they open it.

Flint writes the re-encrypted vault as a copy next to it (`home.flint.rekey`) and only
then puts it in place, in one rename. If the computer stops halfway, the vault on disk is
either the old one, which opens with the old password, or the new one; a leftover copy is
removed the next time the vault is unlocked.

## The vault list

The list lives in a small file in your config folder. It holds file paths, vault names and
each vault's id (a random number kept inside the vault, so it survives a new master
password), never anything from inside a vault:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/Flint/vaults.json` |
| Linux | `$XDG_CONFIG_HOME/flint/vaults.json` (default `~/.config/flint/`) |

Set `FLINT_CONFIG_DIR` to use another folder.

## Syncing a vault

A vault is a single file, written with a rollback journal that is removed after each
change, so a sync client only ever sees the `.flint` file. Flint does not merge changes:
if two machines change the vault before it syncs, your sync client keeps one version and
usually sets the other aside as a conflict copy.
