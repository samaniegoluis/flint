---
title: Copying files
description: Copy files and folders between this machine and a host, or from one host to another, with flint cp, over SFTP, with the logins in the vault.
---

`flint cp` copies files and folders between this machine and a host, or from one host
to another, over SFTP. In
the desktop app, [the Files view](/guides/files-view/) does the same beside a session's
terminal, and copies between two servers in two side-by-side panes. It logs
in the way `flint exec` does, with the key or password in the vault, through the host's
jump hosts, after checking the server's key. You need no `scp`, no `~/.ssh/config` and no
key on disk.

A host's side is written `<alias>:<path>`. When only one side names a host, the other is
a path on this machine:

```sh
flint cp ./app.conf web-01:/etc/app/          # to the host, into /etc/app/
flint cp web-01:/var/log/app.log .             # from the host, into the current folder
flint cp web-01:/var/log/app.log ./today.log   # from the host, under a new name
flint cp -r ./site web-01:/srv/                # a folder and everything in it
flint cp web-01: ./                            # needs -r: web-01: alone is the login folder
```

A path on the host that does not start with `/` is relative to the login folder. A local
path is relative to the folder you run `flint` in. A local file with a colon in its name
is written `./a:b`, as with `scp`.

## From one host to another

When both sides name a host, the file goes from the first host to the second:

```sh
flint cp db-01:/var/backups/db.sql nas:/srv/backups/   # db-01 → nas
flint cp -r staging:/etc/app prod-01:/etc/            # a folder, merged into /etc/app
```

Flint logs in to both hosts, each with its own login and jump hosts, and the bytes pass
through this machine: they are read from the first host and written to the second as they
arrive, without being saved here. The copy is no faster than this machine's link to both
hosts, but no key or password is ever put on a host, and neither host needs to reach the
other. Every rule below applies the same way; messages name the host they are about
(`/srv/backups/db.sql on nas already exists`).

## Where a copy lands

`flint cp` places files as `cp` and `scp` do:

- When the destination is a folder, the file (or folder) goes **into** it, under its own
  name.
- Otherwise it is copied **to** that path, whose folder must already exist. A path that
  ends in `/` must be an existing folder.
- With `-r`, a folder that is already there is merged into: its other files stay.

An existing file is never replaced unless you pass `--force`: Flint stops with `exists`
(exit 20) and copies nothing more.

## While it copies

On a terminal, stderr shows each file with its size and percentage. When stderr is not a
terminal, or with `--json`, it stays silent. Once done, `flint cp` prints one line:

```text
Copied 1 file (2.4 KB) to web-01:/etc/app/app.conf in 180 ms.
Copied 1 file (48.0 MB) from db-01:/var/backups/db.sql to nas:/srv/backups/db.sql in 4.2 s.
```

Each file is written under a temporary name in the folder it lands in,
`.<name>.flint-part`, and gets its own name only once it is complete. A copy that fails
halfway removes that file, so the destination never holds half a file under the real
name. A copy stopped with Ctrl-C, or one whose connection dropped, can leave a
`.flint-part` file behind (the error then says where); the next copy of that file removes
it first, and `flint cp -r` never copies one.

Links to files are copied as the files they point to. Links to folders, and special
files such as sockets, are left out of a `-r` copy; Flint names them on stderr.

## With `--json`

```sh
flint --json cp -r ./site web-01:/srv/
```

```json
{"host":"web-01","to_host":"","direction":"upload","files":[{"source":"./site/index.html","target":"/srv/site/index.html","bytes":12}],"folders":1,"bytes":12,"skipped":[],"duration_ms":240}
```

`direction` is `upload`, `download` or `relay` (from one host to another), `to_host` is
the destination host of a `relay` copy (empty otherwise), `folders` counts the folders it
created, and `skipped` lists what a `-r` copy left out.

## Errors

| Exit | Code | Meaning |
|---|---|---|
| 3 | `not_found` | The file or folder to copy, or the folder to copy into, does not exist (here or on the host), or an alias is not in the vault |
| 7 | `invalid` | A folder given without `-r`, or something that is not a file or a folder |
| 19 | `permission_denied` | The user may not read the file, or write in the folder |
| 20 | `exists` | The file is already there; pass `--force` to replace it |
| 21 | `not_a_directory` | A path that has to be a folder is a file |

The login errors are those of [Connecting](/guides/connecting/): `host_key` (11),
`auth` (12), `network` (13).

## With Flint open, and for agents

With Flint open and the vault unlocked there, `flint cp` runs through the app, like
`exec`, and needs no master password. The files on this machine are still read and
written by `flint` itself, never by the app, so the app needs no access to your folders.

A program that runs `flint cp` needs the same approval as `flint exec`: copying a host's
files has the power of a command there, so a grant's **Run commands** covers both. Flint's
window says **copy files**, with the direction, the host and both paths, and every copy is
in **Settings → Activity**. See [Use Flint with an AI agent](/guides/ai-agents/).

A copy from one host to another runs on both, so the grant must reach **both** hosts: one
window names both, says the bytes pass through Flint, and proposes a grant for the two of
them (or their groups). A grant that reaches only one is not enough: the window asks again
and marks which host is already allowed and which one the new grant adds. A token that
reaches only one is refused with `denied`. Activity shows it as
`db-01 → nas`.
