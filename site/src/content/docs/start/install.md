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

Packages are published for macOS, for Linux from the first release after 0.18.2, and for
Windows from the first release after 0.19.0. Until one is published for your system, build
it from a checkout:
[Build a release package](/start/build-from-source/#build-a-release-package).

## macOS

**Needs:** a Mac with Apple silicon (M1 or later) and macOS 13.3 Ventura or later.

1. Unzip `Flint-<version>-macos-arm64.zip`.
2. Move `Flint.app` where you keep apps, usually **Applications**. It runs from any
   folder.
3. Open it. From 0.38.0 Flint is signed with a Developer ID and notarized by Apple, so
   macOS asks only whether to open an app downloaded from the internet: choose **Open**.

   A version before 0.38.0 is not signed, and macOS refuses it the first time: it says
   *"Flint.app" Not Opened*. Choose **Done**, open **System Settings → Privacy &
   Security**, choose **Open Anyway** beside *"Flint.app" was blocked* and confirm with
   your password, then open Flint again and choose **Open Anyway** once more. If there
   is no such button, remove the download's quarantine flag instead:
   `xattr -dr com.apple.quarantine /Applications/Flint.app`.

Your vaults and settings live in your user folder, never inside `Flint.app`, so replacing
the app keeps them.

The first signed version (0.38.0) is a new app to macOS, under a new id
(`engineer.samaniego.flint.desktop`): the Keychain asks once more for a vault opened with
**Remember on this computer** and for a remote vault's server token (choose **Always
Allow**), and a remote desktop asks once more for the microphone. From then on an update
signed by the same developer keeps those permissions. An unsigned version before it asks
again after every update.

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
built for macOS 13.3. Its FreeRDP has no FFmpeg, and of the redirections only sound and the
microphone (on macOS's own audio) and the device channel they need, with no drive,
printer or smartcard; it decodes H.264 with macOS's own VideoToolbox, so the remote
desktop's graphics pipeline works as in a build from source. Sound comes as PCM or
ADPCM, which Windows and GNOME Remote Desktop both send.

## Windows

**Needs:** 64-bit Windows 10 or 11 (x86_64) and the Microsoft Edge WebView2 Runtime,
which Windows 11 and an up-to-date Windows 10 already have. If it is missing, Flint says
so when it starts and offers Microsoft's
[download page](https://developer.microsoft.com/microsoft-edge/webview2/); install the
*Evergreen* runtime and start Flint again.

1. Unzip `Flint-<version>-windows-x86_64.zip` (right-click → **Extract All**). It holds
   one folder, `Flint`.
2. Move the `Flint` folder where you keep programs, for example
   `%LOCALAPPDATA%\Programs\Flint`. It runs from any folder you can write to, which
   Flint needs in order to update itself. A USB drive works too.
3. Open `Flint.exe`. Windows SmartScreen stops it the first time, because the program is
   not signed: it says *Windows protected your PC*. Choose **More info**, then
   **Run anyway**. Windows remembers the choice for this copy.

The folder holds:

| Where | What |
|---|---|
| `Flint.exe` | The app |
| `bin\flint.exe` | The CLI, alone in its folder so that folder can go on your `PATH` |
| `ui\`, `WebView2Loader.dll` | The app's page and Microsoft's WebView2 loader |
| `licenses\` | Flint's licence and each bundled library's |
| `install.ps1` | An optional installer for this user (below) |

Your vaults and settings live in your user folder (`%APPDATA%\Flint`), never inside the
`Flint` folder, so replacing the folder keeps them.

Flint tells you when a new version is out, at launch and every hour, downloads and checks
it when you choose **Download**, and relaunches into it when you choose **Relaunch**:
see [Updates](/guides/updates/).

### The flint command

The first time the app opens, a notification offers **Add to PATH**; it never does so on
its own. You can also do it later from **Settings → About → Command line**. It adds the
`Flint\bin` folder to your own `PATH` (no administrator needed), first, so a terminal
opened afterwards finds `flint`. **Remove from PATH** takes it off again. Since the entry
points into the folder, an update to Flint updates the command too, and a `flint` you
start opens the `Flint.exe` it came with when it needs the app.

If you move or rename the `Flint` folder, the old entry points at a copy that is gone:
Flint says so at launch and offers **Use this copy**, which replaces it. Only entries that
name a Flint folder's `bin` are ever changed.

### Install it for this user (optional)

The zip's `install.ps1` copies the folder to `%LOCALAPPDATA%\Programs\Flint`, adds Flint
to the Start menu and puts `bin` on your `PATH`:

```powershell
powershell -ExecutionPolicy Bypass -File .\Flint\install.ps1
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\Flint\install.ps1" -Uninstall
```

`-Uninstall` removes the folder, the Start menu entry and the `PATH` entry; your vaults
and settings stay. The installed copy updates itself like any other. A setup program comes
with signed packages, later.

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
| `/usr/lib/flint/` | The app, the CLI, the app's page, and `flint-update-root`, the small helper that installs an update ([Updates](/guides/updates/)) |
| `/usr/bin/flint` | A link to the CLI, so a `flint` you start opens the app it came with |
| `/usr/share/applications/dev.flint.app.desktop` | The menu entry, with its icon in `/usr/share/icons/hicolor/` |
| `/usr/share/polkit-1/actions/dev.flint.policy` | The two actions Flint asks your desktop to confirm: when a program wants your vault, and the system password before an update is installed ([Security model](/reference/security-model/)) |

Your vaults and settings live in your home folder, never in `/usr/lib/flint`, so
removing or replacing the package keeps them. To remove it: `sudo apt remove flint` or
`sudo dnf remove flint`.

Flint updates itself through your package manager: when a new version is out,
**Download** fetches the new package, and **Relaunch** asks for your system password and
has `apt` or `dnf` install it, as you installed it ([Updates](/guides/updates/)). This
works from 0.21.0 on: a copy installed before that is updated by hand once, the same way
you installed it. The package depends on `pkexec` (Debian, Ubuntu) or `polkit` (Fedora)
for that password.

The packages are not signed with a repository key. Check a download against
`SHA256SUMS` (above) before installing it.

If you installed a build of your own with `scripts/install.sh`, remove its copy first
(`~/.local/bin/flint`, `~/.local/bin/flint-app`, `~/.local/share/flint` and
`~/.local/share/applications/flint.desktop`): `~/.local/bin` comes before `/usr/bin` on
your `PATH`, so its `flint` would keep answering.
