---
title: Install
description: Install Flint from a release package, and put the flint command on your PATH.
---

Flint ships as a portable package per system: the desktop app with the `flint` CLI
inside it. Packages are not code-signed yet, so the first launch needs one extra step,
described below. Signed packages and installers come later.

Until the first release is published on GitHub, a package is built from a checkout:
[Build a release package](/start/build-from-source/#build-a-release-package).

## macOS

**Needs:** a Mac with Apple silicon (M1 or later) and macOS 13.3 Ventura or later.

1. Unzip `Flint-<version>-macos-arm64.zip`.
2. Move `Flint.app` where you keep apps, usually **Applications**. It runs from any
   folder.
3. Open it. macOS refuses the first time, because the app is not signed by an identified
   developer: open **System Settings → Privacy & Security**, find *"Flint" was blocked*,
   choose **Open Anyway** and confirm. macOS remembers the choice for this copy.

Your vaults and settings live in your user folder, never inside `Flint.app`, so replacing
the app keeps them.

An unsigned app is a new program to the macOS Keychain each time it is replaced: a vault
opened with **Remember on this computer**, and a remote vault's server token, ask for
Keychain access again after an update. Choose **Always Allow**.

### The flint command

`Flint.app` carries the CLI at `Flint.app/Contents/Helpers/flint`. The first time the app
opens, a notification offers **Install the flint command**; it never does so on its own.
You can also do it later from **Settings → About → Command line**, which lists both places
the command can go:

| Place | Needs |
|---|---|
| `/usr/local/bin/flint` | On every Mac's `PATH`. macOS asks for an administrator's password once |
| `~/.local/bin/flint` | No password; works when `~/.local/bin` is on your `PATH` |

Either is a symbolic link into the app, so an update to `Flint.app` updates the command
too. A `flint` you started from a terminal opens the app it came with when it needs it.

If you move or replace the app and the link points at a copy that is gone, or at another
copy, Flint says so at launch and offers **Use this copy**. A `flint` that is not a link
to a Flint.app (a build installed by `scripts/install.sh`, for example) is listed but
never changed.

### What a package build leaves out

The package links its own copies of libssh, libsodium, SQLCipher, OpenSSL and FreeRDP,
built for macOS 13.3. Its FreeRDP has no FFmpeg, audio or device redirection, which Flint
never turns on; the remote desktop's graphics pipeline works as in a build from source.
