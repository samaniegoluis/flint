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

- **The app** unlocks a vault with its master password. On launch it can reopen the last
  vault without a prompt, from the key it saved in the OS keychain (Keychain on macOS,
  the Secret Service on Linux). The password itself is never stored.
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

A command that needs a secret of its own (`--password`, `--passphrase`, Tether's master
password, a host's password at login) asks for it in your terminal, and only sends it to
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
| On Linux, another program reads the app's cached key from the Secret Service | Yes: the Secret Service has no per-app access list. *Forget on this device* in **Settings → Vault** removes it, and the app then asks for the master password on each launch |
| Someone at your unlocked computer opens Flint | Yes, while the vault is unlocked |

On macOS, each new Flint build has a new code identity until releases are signed, so the
first time the app reads its cached key macOS asks whether Flint may use your
confidential information. **Always Allow** asks for your login password and stops the
dialog until the next build; **Deny** makes Flint ask for the master password instead.

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

## The vault list

The list lives in a small file in your config folder. It holds file paths, vault names and
a vault id (a hash of the vault's salt, which is already in clear at the start of the
file), never anything from inside a vault:

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
