---
title: Copying files
description: Copy files and folders between this machine and a host with flint cp, over SFTP, with the logins in the vault.
---

`flint cp` copies files and folders between this machine and one host, over SFTP. It logs
in the way `flint exec` does, with the key or password in the vault, through the host's
jump hosts, after checking the server's key. You need no `scp`, no `~/.ssh/config` and no
key on disk.

One side names the host, written `<alias>:<path>`. The other side is a path on this
machine:

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
```

Each file is written under a temporary name in the folder it lands in,
`.<name>.flint-part`, and gets its own name only once it is complete. A copy that fails
halfway removes that file, so the destination never holds half a file under the real
name. A copy stopped with Ctrl-C can leave a `.flint-part` file behind; the next copy of
that file replaces it, and `flint cp -r` never copies one.

Links to files are copied as the files they point to. Links to folders, and special
files such as sockets, are left out of a `-r` copy; Flint names them on stderr.

## With `--json`

```sh
flint --json cp -r ./site web-01:/srv/
```

```json
{"host":"web-01","direction":"upload","files":[{"source":"./site/index.html","target":"/srv/site/index.html","bytes":12}],"folders":1,"bytes":12,"skipped":[],"duration_ms":240}
```

`direction` is `upload` or `download`, `folders` counts the folders it created, and
`skipped` lists what a `-r` copy left out.

## Errors

| Exit | Code | Meaning |
|---|---|---|
| 3 | `not_found` | The file or folder to copy, or the folder to copy into, does not exist (here or on the host), or the alias is not in the vault |
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

Copying between two hosts (`flint cp a:/x b:/y`) is not there yet; it is on the roadmap.
