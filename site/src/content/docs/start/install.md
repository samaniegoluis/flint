---
title: Install
description: Install Flint from a release package, and put the flint command on your PATH.
---

Flint ships as a portable package per system: the desktop app with the `flint` CLI
inside it. Packages are not code-signed yet, so the first launch needs one extra step,
described below. Signed packages and installers come later.

Download the package for your system from [Releases](/releases/), which offers the
latest version's, or from the [releases on GitHub](https://github.com/samaniegoluis/flint/releases),
which list every file with a `SHA256SUMS` to check them against:

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing     # on Linux: sha256sum -c …
```

Packages are published for macOS, and for Linux from the first release after 0.18.2; Windows follows. Until one is published for
your system, build it from a checkout:
[Build a release package](/start/build-from-source/#build-a-release-package).

## macOS

**Needs:** a Mac with Apple silicon (M1 or later) and macOS 13.3 Ventura or later.

1. Unzip `Flint-<version>-macos-arm64.zip`.
2. Move `Flint.app` where you keep apps, usually **Applications**. It runs from any
   folder.
3. Open it. macOS refuses the first time, because the app is not signed by an identified
   developer: it says *"Flint.app" Not Opened* and offers **Move to Trash** or **Done**.
   Choose **Done**, open **System Settings → Privacy & Security**, and under
   **Security** choose **Open Anyway** beside *"Flint.app" was blocked*, then confirm with
   your password. Open Flint again and choose **Open Anyway** once more. macOS remembers
   the choice for this copy. Updates from inside Flint do not ask again
   ([Updates](/guides/updates/)).

   If Privacy & Security shows no such button, remove the download's quarantine flag
   instead: `xattr -dr com.apple.quarantine /Applications/Flint.app`.

Your vaults and settings live in your user folder, never inside `Flint.app`, so replacing
the app keeps them.

An unsigned app is a new program to the macOS Keychain each time it is replaced: a vault
opened with **Remember on this computer**, and a remote vault's server token, ask for
Keychain access again after an update. Choose **Always Allow**.

Flint tells you when a new version is out, at launch and every hour, downloads and checks
it when you choose **Download**, and relaunches into it when you choose **Relaunch**:
see [Updates](/guides/updates/).

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

### What a macOS package build leaves out

The package links its own copies of libssh, libsodium, SQLCipher, OpenSSL and FreeRDP,
built for macOS 13.3. Its FreeRDP has no FFmpeg, audio or device redirection, which Flint
never turns on; it decodes H.264 with macOS's own VideoToolbox, so the remote desktop's
graphics pipeline works as in a build from source.

## Linux

**Needs:** a 64-bit PC (x86_64) with Ubuntu 24.04 or later, Debian 13 or later, or
Fedora 43 or later, or a distribution built on one of them (Zorin OS 18, Linux Mint 22,
Pop!_OS 24.04). Older releases have no FreeRDP 3, which Flint's remote desktop needs.

Install the package with your package manager, which brings in the libraries it needs:

```sh
sudo apt install ./flint_<version>_amd64.deb        # Debian, Ubuntu
sudo dnf install ./flint-<version>.x86_64.rpm       # Fedora
```

Flint is then in your desktop's applications, and `flint` is on your `PATH`
(`/usr/bin/flint`). The package puts:

| Where | What |
|---|---|
| `/usr/lib/flint/` | The app, the CLI and the app's page |
| `/usr/bin/flint` | A link to the CLI, so a `flint` you start opens the app it came with |
| `/usr/share/applications/dev.flint.app.desktop` | The menu entry, with its icon in `/usr/share/icons/hicolor/` |
| `/usr/share/polkit-1/actions/dev.flint.policy` | The action Flint asks your desktop to confirm when a program wants your vault ([Security model](/reference/security-model/)) |

Your vaults and settings live in your home folder, never in `/usr/lib/flint`, so
removing or replacing the package keeps them. To remove it: `sudo apt remove flint` or
`sudo dnf remove flint`.

The package manager updates a package, not Flint: when a new version is out, Flint says
so and **How to update** points to the release page; install the new package the same
way ([Updates](/guides/updates/)).

The packages are not signed with a repository key. Check a download against
`SHA256SUMS` (above) before installing it.

If you installed a build of your own with `scripts/install.sh`, remove its copy first
(`~/.local/bin/flint`, `~/.local/bin/flint-app`, `~/.local/share/flint` and
`~/.local/share/applications/flint.desktop`): `~/.local/bin` comes before `/usr/bin` on
your `PATH`, so its `flint` would keep answering.
