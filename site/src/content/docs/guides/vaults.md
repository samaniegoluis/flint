---
title: Vaults
description: Create, open, lock and switch between encrypted vaults.
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

## The keychain cache

When you create or unlock a vault, Flint stores the key derived from your master password
in the OS keychain: Keychain on macOS, or the Secret Service (GNOME Keyring, KWallet) on
Linux. From then on this machine opens the vault without a prompt. The password itself
is never stored.

| Command | What it does |
|---|---|
| `flint vault unlock` | Asks for the master password and caches the key on this machine |
| `flint vault lock` | Removes the cached key. The next command asks for the password again |
| `flint vault status` | Shows whether the vault is locked, and what it holds when it is not |

If no keychain is available (for example, a headless Linux box with no keyring daemon),
Flint asks for the master password each time. To turn the cache off on purpose, set
`FLINT_KEYCHAIN=off`.

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
