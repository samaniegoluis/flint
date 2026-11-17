---
title: Sync a vault across machines
description: Connect a vault to your own flint-vault-server and keep it in step on every machine, offline edits included, merged record by record.
---

A vault on one machine stays a local file. Connect it to a
[`flint-vault-server`](/guides/vault-server/) you run, and every machine you connect keeps
its own full copy of that vault in step with the others. It is **local-first**: each
machine works on its own copy, offline too, and the server only passes the encrypted
file between them. Vaults you do not connect stay on their own machine.

Everything here works from the desktop app and from the CLI; each section shows both.

## Connect a vault

On the machine that has the vault, with the server's URL and token at hand.

**In the app:** open the vault, then **Settings → Vault → Server → Connect to a server…**.
Type the server's address, paste the token, and type the vault's master password again.
The strength meter shows whether it is strong enough; **Connect** stays off until it is.
The dialog ends with what happened: *Uploaded* (the server was empty) or *Merged with the
server's copy* (it already held this vault).

**From the CLI:**

```sh
flint vault connect https://vault.example.com
```

```text
Server token: ••••••••
Master password for 'home': ••••••••
Connected vault 'home' to https://vault.example.com and uploaded it (version 1).
On another machine: `flint vault connect https://vault.example.com --to <path>`.
```

Flint checks three things before the vault leaves the machine:

- **`https://`**. Plain `http://` is refused for anything but this machine
  (`localhost`, `127.0.0.1`): your reverse proxy does TLS
  ([Self-host a remote vault](/guides/vault-server/#tls-with-a-reverse-proxy)).
- **A strong master password**, **Strong** (3 of 4) or better. The file will sit on a disk
  where it can be attacked offline; change a weaker one first with
  [`flint vault passwd`](/guides/vaults/#change-the-master-password).
- **The vault's own master password**, typed for this command.

The token goes to the OS keychain (macOS Keychain, the Secret Service on Linux), never to
a file. While the desktop app holds the vault unlocked, `flint vault connect` is refused:
connect it from the app, or lock it there first.

## Add another machine

**In the app:** on the Welcome screen (or from the vault switcher, ⇧⌘O), choose
**Connect to a remote vault** (⌥⌘O). Type the server's address and paste the token;
**Continue** checks them with the server. The server cannot read the vault, so all it
shows is that one was found, with its size and version. Type that vault's master
password, choose where to keep the local copy, and **Download and open**. The vault
opens in the window, already connected.

**From the CLI**, download the vault to a new file:

```sh
flint vault connect https://vault.example.com --to ~/Vaults/home.flint
```

Flint opens the server's copy with the master password you type before it writes
anything; a path that already holds a file is refused. The new file is an ordinary vault,
already connected.

A machine that already has a copy of the same vault (from a cloud folder, say) connects
it with plain `flint vault connect <url>`: the two copies are merged.

## When it syncs

You do not run anything after connecting. Changes travel both ways:

- **In the desktop app**, while the vault is unlocked: at unlock, a few seconds after a
  change (a burst of changes makes one upload), when the window comes back to the front,
  and about **every 60 seconds** to pick up other machines' changes. Each check asks the
  server whether its copy changed, and downloads it only if it did.
- **From the CLI on its own**, without the app: right after a command that changed the
  vault. If the server cannot be reached, the command still succeeds, says so, and the
  change waits.
- **On demand**: `flint vault sync`.

The 60 seconds is **Settings → Vault → Server → Check every**: *1 min*, *5 min*,
*15 min*, or *Only on changes and at unlock* (it is `sync_interval` in your config folder's
`settings.json`, in seconds: `60`, `300`, `900` or `0`). **Sync now** is beside it, in the
status bar's sync menu and in the command palette (*Sync vault now*).

When a sync brings other machines' changes, the app says so in a toast (*Changes from
another machine: 2 hosts added, 1 updated*). **Details** lists what changed, by kind and
by name (labels only, never a secret), and what the merge did, such as a renamed alias.
*Show last merge* in the command palette opens it again.

```sh
flint vault sync
```

```text
Synced vault 'home' with https://vault.example.com: 1 added, 0 updated, 0 removed here, and this machine's changes uploaded (version 7).
CHANGE  KIND  NAME
added   host  db
```

## Offline, and two machines at once

Every machine keeps working without the server: hosts on your network still connect, and
edits are kept. When the server is back, each machine's next sync takes the others'
changes and sends its own.

When two machines changed the vault apart, the second to upload is told another machine
went first (`409`). It downloads that copy, opens it with the key it already holds, merges
it with its own record by record, and uploads the result. The merge is the one
[`flint vault merge`](/guides/vaults/#syncing-a-vault) uses: a record changed on both
keeps the later change, a record removed on one stays removed unless the other changed
it afterwards, and everything else from both is kept. When both added a host with the same
alias, the one added first keeps it and the other becomes `web-2`, and the report says so.

A machine never replaces its own copy with a download: the download is merged into it,
in one transaction, so nothing typed on this machine is lost. And it never uploads over a
version it has not merged.

## A master password changed on another machine

[`flint vault passwd`](/guides/vaults/#change-the-master-password) on a connected vault
syncs first, then changes the password, then uploads the re-keyed vault; it is refused
while the server cannot be reached, so no other machine's change made under the old
password is left behind.

The other machines' next sync cannot open the new copy with the old key:

```text
flint: the vault's master password was changed on another machine: sync again with the new one (`flint vault sync` asks for it)
```

`flint vault sync` asks for the new master password (or reads it with
`--new-master-stdin`), re-keys this machine's copy to it, merges and uploads. The app asks
for it in its window: *The master password of home was changed on another machine*. Type
the new one and **Sync**; from then on this machine's vault opens with it too. **Later**
leaves the status bar saying *Needs the new password* until you click it.

## Where it stands

**In the app**, the status bar shows the sync's state beside the lock state, with a cloud:

| State | What it means |
|---|---|
| In step | This machine and the server hold the same version; hover for when it last synced |
| Syncing… | A sync is under way |
| Waiting | Changes made here wait to be uploaded |
| Offline | The server cannot be reached; changes wait here and go up when it is back |
| Merged | Another machine's changes just came in; click for the details |
| Needs the new password | The master password was changed on another machine; click to type it |
| Needs attention | The server refused this machine (a wrong token, or it now keeps another vault); click for Settings |

Clicking it shows the last sync, the server, the version, **Sync now** and **Server
settings…**. A vault that is not connected shows nothing there. The vault switcher marks
connected vaults with a cloud, and the unlock screen says when changes from this machine
wait for the unlock.

**From the CLI**, `flint vault status` shows the server, the version last merged, when the last sync was,
and whether this machine holds changes the server does not have yet:

```text
vault      home
path       /Users/me/Vaults/home.flint
state      unlocked in Flint
...
remote     https://vault.example.com
version    7
last sync  2 min ago
waiting    nothing
```

A failed attempt shows as `last attempt`, with its error. With `--json` it is the
`remote` object: `connected`, `url`, `version`, `last_sync` and `last_attempt` (Unix
milliseconds), `last_error`, `pending`.

## Replace the token

When the server's token was [rotated](/guides/vault-server/#rotate-the-token), give each
machine the new one:

```sh
flint vault token
```

It asks for the new token (or reads it with `--token-stdin`), tries it against the server,
and only then replaces the old one in the keychain. A token the server refuses changes
nothing. In the app: **Settings → Vault → Server → Replace token…**, which checks it the
same way.

## Disconnect

**In the app:** Settings → Vault → Server → **Disconnect…**, or *Disconnect vault from
server…* in the command palette. **From the CLI:**

```sh
flint vault disconnect
```

This machine stops syncing the vault and forgets the token. The vault file stays as it
is, and so does the server's copy and every other machine's.

## What each machine keeps

| What | Where |
|---|---|
| The vault | Its `.flint` file, wherever you keep it |
| The server's URL, the version last merged, a hash of the file at the last sync | `remotes.json` in the [config folder](/guides/vaults/#the-vault-list): no host, user or label |
| The server's token | The OS keychain, account `remote-token:<vault id>` |

Without an OS keychain (`FLINT_KEYCHAIN=off`, or a Linux machine with no Secret Service),
`vault connect` is refused: the token is never kept in a file.

On macOS, the first time the desktop app reads a token the CLI saved, macOS asks whether
Flint may use it: choose **Always Allow**. A token saved from the app is its own, and
macOS does not ask. Until Flint's builds are signed, the question
comes back after each update; until it is answered, the app's sync waits.
