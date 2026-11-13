---
title: Sync a vault across machines
description: Connect a vault to your own flint-vault-server and keep it in step on every machine, offline edits included, merged record by record.
---

A vault on one machine stays a local file. Connect it to a
[`flint-vault-server`](/guides/vault-server/) you run, and every machine you connect keeps
its own full copy of that vault in step with the others. It is **local-first**: each
machine works on its own copy, offline too, and the server only passes the encrypted
file between them. Vaults you do not connect stay on their own machine.

:::note[The CLI first]
This page is the CLI. *Connect remote vault* in the desktop app, beside *Create* and
*Open*, with the sync's state in the status bar, arrives in the next release. The app
already keeps a connected vault in step on its own (below).
:::

## Connect a vault

On the machine that has the vault, with the server's URL and token at hand:

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
a file. While the desktop app holds the vault unlocked, `vault connect` is refused: lock
it there first.

## Add another machine

On the second machine, download the vault to a new file:

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

The 60 seconds is the `sync_interval` setting, in seconds, in your config folder's
`settings.json`: `60`, `300`, `900`, or `0` to check only at unlock, after a change, when
the window comes back and on demand. Settings will show it in the next release.

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
`--new-master-stdin`), re-keys this machine's copy to it, merges and uploads. The app will
ask for it in its window (next release); until then, lock the vault in the app and run
`flint vault sync` once.

## Where it stands

`flint vault status` shows the server, the version last merged, when the last sync was,
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

## Disconnect

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
Flint may use it: choose **Always Allow**. Until Flint's builds are signed, the question
comes back after each update; until it is answered, the app's sync waits.
