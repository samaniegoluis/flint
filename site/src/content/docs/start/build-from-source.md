---
title: Build from source
description: Install the toolchain and native libraries, then build and test Flint.
---

Flint is written in [cfire](https://github.com/gsandoval/cfire) and links these native
libraries: **libssh** (SSH), **libsodium** (key derivation and encryption),
**SQLCipher** (the encrypted vault file) and, on Linux, **libsecret** (the keychain). They
are found through `pkg-config` and linked dynamically. On macOS the keychain is
Security.framework.

## 1. Install cfire

Flint is built against cfire's release `v0.12.2`. cfire's installer downloads that
release's archive for your system and checks it against the release's `SHA256SUMS.txt`:

```sh
curl -fsSL https://raw.githubusercontent.com/gsandoval/cfire/v0.12.2/docs/install.sh \
  | sh -s -- --version v0.12.2
cfire --version     # cfire 0.12.2 (5be0987, …)
```

It installs `cfire` into `~/.local/bin` and its runtime beside it, in
`~/.local/share/cfire/runtime`, then runs `cfire doctor`. Do not run `cfire setup`: Flint
needs nothing it adds.

**Coming from cfire 0.10 (`c5b1d4b`)?** The new `cfire` replaces the old one in
`~/.local/bin`, and finds its runtime next to itself. The old runtime in `~/.cfire/runtime`
is no longer read and can be deleted. A `CFIRE_RUNTIME_DIR` left in your environment still
wins over both: unset it.

On Windows, cfire comes from the same release through Flint's own setup script: see
[Build on Windows](#build-on-windows).

## 2. Install the native libraries

### macOS (Homebrew)

```sh
brew install libssh libsodium sqlcipher pkg-config
```

### Debian and Ubuntu

```sh
sudo apt install libssh-dev libcurl4-openssl-dev libsodium-dev libsqlcipher-dev libsecret-1-dev \
  pkg-config openssh-server
```

If you install one of them after a build failed for want of it, delete cfire's probe cache
(`rm ~/.cache/cfire/probes.json`): cfire 0.12.2 keeps the miss.

#### Ubuntu 24.04 and Zorin OS 18

Flint builds there with libssh 0.10. The `clang-19` package installs `clang++-19` only,
and cfire runs `clang++`, so link it by name:

```sh
ln -sf /usr/bin/clang++-19 ~/.local/bin/clang++
```

With libssh 0.10, a command killed by a signal still exits 255, but `flint exec --json`
reports an empty `signal`: 0.10 does not give its name.

## 3. Build

Get the source from [GitHub](https://github.com/samaniegoluis/flint) and build from the
repository root:

```sh
git clone https://github.com/samaniegoluis/flint.git
cd flint
. scripts/env.sh
cfire build
./build/flint --version
```

`cfire build` makes all three programs: the `flint` CLI, the desktop app in `build/gui/`,
and [`flint-vault-server`](/guides/vault-server/) in `build/`. `cfire build flint-vault-server`
makes the server alone; it needs libsodium and nothing else.

`scripts/env.sh` adds Flint's own pkg-config folder (`src/adapters/pkgconfig/<os>/`) to
`PKG_CONFIG_PATH`. The adapters reach their native headers, per-OS link flags and libsecret
through it. Without it, `cfire build` fails to find `flint-native`.

The output names the version and lists the library versions that were linked:

```text
flint 0.1.0-4-g83f876b
  libssh     0.12.2/openssl/zlib
  libsodium  1.0.22
  sqlite     3.54.1 (SQLCipher 4.20.0 community)
```

### The version

Every build reads its version from git: `cfire build` runs `scripts/version.sh` first,
which writes it into `src/drivers/version/version.cf` (generated, not committed).

| You build | The version reads |
|---|---|
| A release tag, such as `v0.1.0` | `0.1.0` |
| Four commits after it | `0.1.0-4-g83f876b` (the last part is the commit) |
| With uncommitted changes | the same, ending in `-dirty` |
| Outside git (a source archive) | `0.0.0-dev` |

`FLINT_VERSION=0.1.0 cfire build` sets it by hand, for an archive or a shell with no git.
The script runs under `sh`: on Windows, build from Git Bash or set `FLINT_VERSION`.

### The desktop app

The app's page is a React project in `ui/`, so it also needs **Node.js** (20 or later).

```sh
scripts/build-gui.sh
open build/gui/Flint.app                     # macOS
./build/gui/Flint                            # Linux (the page is in build/gui/ui)
```

The script builds the page with Vite, builds the `Flint` executable, and puts the page
where the executable looks for it: `Flint.app/Contents/Resources/ui` on macOS, `build/gui/ui`
on Linux. On macOS it signs the bundle again ad hoc, because adding the page invalidates
cfire's signature. The app also needs FreeRDP 3 (`brew install freerdp` on macOS), and on
Linux WebKitGTK: `sudo apt install libwebkit2gtk-4.1-dev freerdp3-dev`.

On Linux, approving a program in Flint's window asks for your login password through
polkit once Flint's action is installed; without it, Flint asks for the vault's master
password instead. A `.deb` or `.rpm` installs it; for a build from source:

```sh
sudo cp packaging/linux/dev.flint.policy /usr/share/polkit-1/actions/
```

## 4. Run the tests

```sh
scripts/test.sh
```

The script runs the suites in `src/`. It starts a throwaway `sshd` on `127.0.0.1:2222`,
with its own host key, user key and config in a temporary directory, so the SSH tests can
open a real PTY. It does not touch your system `sshd` or `~/.ssh`. To use another port, set `FLINT_TEST_SSH_PORT`.

To run only the tests that need no network, call `cfire test --release src` (after
`. scripts/env.sh`; without `--release` the tests build unoptimized and run far slower). The SSH tests then print `SKIP`. One test stores, reads and deletes a
throwaway entry in your real OS keychain; set `FLINT_TEST_KEYCHAIN=off` to skip it.

### The CLI end to end

```sh
scripts/cli-e2e.sh
```

It builds `flint` and drives it against throwaway vaults in a temporary folder: every
command, every exit code, `--json` output, and that the CLI never caches a vault key. It
also checks that no password, key or passphrase appears in any output, and that no
hostname, user, label or note appears in clear text in the vault files. It sets
`FLINT_APP=off`, so a locked vault never starts your installed Flint.

The page's own unit tests (keyboard map, host tree, the palette's search) run with Vitest:

```sh
cd ui && npm test
```

### The desktop app end to end

```sh
scripts/gui-e2e.sh
```

It builds the app and drives its real UI in its window against the throwaway
`sshd`s: creates a vault, adds a key and hosts, trusts a host key, types in the terminal,
checks the PTY size, reconnects, connects through a jump host, meets a changed host key
behind a TCP forwarder and replaces it, uses the palette and settings, saves and starts tunnels, then locks
(with a session that keeps running behind the lock screen, and on a simulated screen lock
and sleep) and unlocks. It also checks that no password reaches the page and that nothing from the vault
is readable in its file. It uses its own config folder and `FLINT_KEYCHAIN=off`, so your
keychain is not touched.

It runs as five short runs, each a fresh launch of the app on its own vault: `terminal`
(the shell, files, a jump host, tabs, split panes, a changed host key), `vault` (the
palette, settings, groups, locking), `tunnels`, `paste` (an image pasted into the
terminal) and `vim`. To repeat only some of them:

```sh
FLINT_E2E_ONLY=tunnels,vim scripts/gui-e2e.sh
```

On macOS each run opens the app's real window, on screen, and you can watch it click and
type. Leave it alone until the run ends: covered, or on another Space, the window is
hidden again. `FLINT_E2E_VISIBLE=0` uses an offscreen WebView instead, with nothing on
screen; WebKit suspends that page about a second after nothing happens in it, so a check
that times out there stops the run until its cap instead of failing.

To measure a run that fails now and then, repeat it alone and read its failure rate:

```sh
scripts/repeat.sh vim 10
```

It builds the app and starts the `sshd`s once, then launches the run N times and lists
each failure with the last step its page logged.

### The CLI through the app

```sh
scripts/serve-e2e.sh
```

It opens the app headless on a throwaway vault, unlocks it, and drives `flint` with no
terminal and no master password: commands, `exec`, `host test` and `connect` (on a
pseudo-terminal, with the host key question and a resize relayed) run in the app, with
the same output and exit codes as the CLI on its own; a long `exec` does not hold up other
commands; `flint vault lock` locks the window and the next command makes it ask, naming
the command; and with the app closed, `flint` starts it on its unlock screen. The page
plays the owner in the approval window, with the master password as presence
(`FLINT_PRESENCE=password`): it denies one request, leaves one unanswered, allows one host
only, and checks that a lock ends every grant.

## Install your build

To use the build you just made every day, install the app and the CLI together, so they
speak the same socket protocol:

```sh
scripts/install.sh
```

It builds both, quits a running Flint (its vault locks and its grants end), and installs:

| | macOS | Linux |
|---|---|---|
| App | `/Applications/Flint.app` | `~/.local/share/flint/`, started by `~/.local/bin/flint-app` and a menu entry |
| CLI | `~/.local/bin/flint` | `~/.local/bin/flint` |

`flint` starts the installed app when it needs one (`open -a Flint` on macOS, `flint-app`
beside it on Linux), so run the script again after each update. `FLINT_PREFIX` puts the
CLI in another folder.

- A build is signed ad hoc, so each install is a new program to the macOS Keychain: a
  vault opened with **Remember on this computer** asks for Keychain access again.
- A build with a new migration updates the vault the first time it opens it, and an older
  Flint then refuses that vault. Try a new build on a copy of the vault first.
- One Flint runs per config folder. With the installed app open, starting a build from
  `build/gui` only shows the installed app's window: quit it first.

## Build a release package

A release package is the app and the CLI together, linked against libraries of its own
rather than the ones your package manager installed, so it runs on a machine with none
of them. The release workflow runs the same script.

```sh
scripts/package.sh macos      # → dist/Flint-<version>-macos-arm64.zip
scripts/package.sh linux      # → dist/flint_<version>_amd64.deb, dist/flint-<version>.x86_64.rpm
scripts/package.sh windows    # → dist/Flint-<version>-windows-x86_64.zip (in MSYS2 CLANG64)
```

On Windows it is `windows/package.sh`, described in [Build on Windows](#build-on-windows).

On macOS (Apple silicon) it first runs `scripts/deps-macos.sh`, which downloads pinned
sources of OpenSSL, libsodium, libssh, SQLCipher and FreeRDP 3, checks their SHA-256 and
builds them as static libraries for macOS 13.3 into `build/deps/macos-arm64` (a few
minutes the first time; kept while the versions stay). It needs `cmake`, `ninja` and
`pkg-config` (`brew install cmake ninja pkg-config`) and never reads Homebrew's libraries.
Then it links the app and the CLI against them (`cfire build --portable --macos-min
13.3`), checks that neither links anything outside macOS nor asks for a newer one, puts
the CLI in `Contents/Helpers`, writes the version into `Info.plist`, adds every library's
licence, signs the bundle ad hoc and zips it. It prints the zip's SHA-256.

The script leaves `build/flint` and `build/gui/Flint.app` as the release build, so the
end-to-end suites can run on exactly what ships:

```sh
FLINT_E2E_NOBUILD=1 scripts/cli-e2e.sh
FLINT_E2E_NOBUILD=1 scripts/gui-e2e.sh
```

On a packaged app the desktop suite skips its `update` and `selfupdate` runs: a package
checks only Flint's own update feed with Flint's key, and those runs need a feed and a key
of their own, which only a build from source accepts.

On Linux (or a Mac with Docker), `scripts/package.sh linux` builds each package in a
container of its own, x86_64: the `.deb` on Ubuntu 24.04 and the `.rpm` on Fedora 43,
the oldest releases with FreeRDP 3 and WebKitGTK 4.1 in their own repositories. The app
and the CLI link that system's libraries, and the package depends on them by name, so
`apt` or `dnf` installs them. It needs Docker and `npm` (the page is built first, on
your machine); the images install cfire's and nfpm's pinned releases, checked against
their SHA-256 (`scripts/linux/package.Dockerfile`). `scripts/package.sh linux deb` builds
one of the two. On a Mac the containers run under emulation: the first build takes a
while.

```sh
scripts/linux/package-test.sh     # install, run and remove them in clean containers
```

installs the `.deb` on Ubuntu 24.04 and Debian 13 and the `.rpm` on Fedora 43, each
with only what its package manager pulls in, checks every file and library, opens the
app's window under Xvfb, removes the package and checks nothing is left.

Installing a package is described in [Install](/start/install/).

### The release workflow

A release on GitHub is built by the **Release** workflow
(`.github/workflows/release.yml`) on GitHub's hosted runners. It is started by hand, with
a tag that is already pushed:

```sh
gh workflow run release.yml -f tag=v0.16.0       # or Actions → Release → Run workflow
```

The workflow holds no logic of its own: each step is a script you can run the same way.

| Step | Runs | Does |
|---|---|---|
| guard | `scripts/release-draft.sh guard <tag>` | Fails unless the tag is `vX.Y.Z` or `vX.Y.Z-rc.N` and its commit is on `main` |
| macos | `scripts/install-cfire.sh`, `scripts/package.sh macos` | Installs cfire's pinned release (its SHA-256 is kept in the script) and builds the macOS zip on an Apple silicon runner. The built libraries are cached while `scripts/deps-macos.sh` stays the same |
| linux | `scripts/package.sh linux`, `scripts/linux/package-test.sh` | Builds the `.deb` and the `.rpm` in their containers on an x86_64 runner, then installs, runs and removes each in clean ones |
| draft | `scripts/release-draft.sh draft <tag> <dir>` | Writes `SHA256SUMS` and makes a **draft** release with every package; a `-rc` tag makes a pre-release |

The notes are the version's section of `CHANGELOG.md` (`scripts/release-draft.sh notes
<tag>` prints them); an `-rc` tag, which has none, gets its tag's message. Nothing is
published on its own: open the draft on GitHub, check it, and publish it. Only then does
the site's [Releases](/releases/) page offer it, since it asks GitHub for the latest
published release. A draft that already exists is updated, never a published release.

When a runner fails, run the same script on your machine, then upload the file by hand:

```sh
gh release upload v0.16.0 dist/Flint-0.16.0-macos-arm64.zip --clobber
```

and write `SHA256SUMS` again (`scripts/release-draft.sh draft v0.16.0 <folder>` with
every package in the folder). Trial tags (`v0.16.0-rc.1`) are deleted with their
release afterwards: `gh release delete v0.16.0-rc.1 --cleanup-tag`.

## Check the Linux build from macOS

With Docker running:

```sh
scripts/linux-check.sh
```

It builds the page on the host (the image has no Node), then builds a Debian image with
cfire's same release and the apt packages above. Inside, it builds `flint` and
the desktop app, and runs the tests and the CLI end-to-end run against gnome-keyring on
a private D-Bus session (the keychain adapter's tests use it; a screensaver signal sent
on that bus must lock the vault). Then it runs the desktop app's end-to-end check and the
CLI-through-the-app check in the real GTK window under Xvfb.

To run only some of it, name the steps after the build (`tests`, `cli`, `gui`, `serve`)
and, for `tests`, the suites:

```sh
FLINT_LINUX_STEPS=serve scripts/linux-check.sh
FLINT_LINUX_STEPS=tests FLINT_LINUX_SUITES=src/adapters/ssh scripts/linux-check.sh
```

## Build on Windows

Flint builds natively on Windows 11 (x64) in [MSYS2](https://www.msys2.org)'s CLANG64
environment, the toolchain cfire's Windows release uses. No administrator rights are
needed beyond installing MSYS2. The app needs the Microsoft Edge WebView2 Runtime, which
Windows 11 ships with.

**In one command**, with MSYS2 installed in `C:\msys64` (`-Msys <folder>` for another
place), from PowerShell in a checkout of Flint (cloned with `core.autocrlf=false`, so the
scripts keep Unix line endings):

```powershell
powershell -ExecutionPolicy Bypass -File windows\build.ps1 -Install
```

It does steps 3 to 5 below. Leave out `-Install` for the zip only. The steps it runs,
by hand:

1. Install MSYS2 into `C:\msys64` and open **MSYS2 CLANG64** from the Start menu.
2. Get the code, keeping Unix line endings:

   ```sh
   pacman -S --needed git
   git clone -c core.autocrlf=false https://github.com/samaniegoluis/flint.git
   cd flint
   ```

3. Fetch everything else the build needs:

   ```sh
   windows/bin/setup.sh
   ```

   It installs the native libraries from pacman (libsodium, libssh, SQLCipher, libcurl,
   and FreeRDP's build tools), then puts cfire's Windows release, a static FreeRDP built
   from source, Microsoft's `WebView2Loader.dll` and Node into
   `%LOCALAPPDATA%\flint-build` (`FLINT_WIN_HOME` for another folder). Every download is pinned to a version and
   checked against its SHA-256. Run it again after pulling a change to its versions:
   each piece already in place says `ready` and nothing is fetched again. The first run
   takes a while: FreeRDP builds from source.

4. Build the portable zip:

   ```sh
   . windows/bin/env.sh
   windows/package.sh
   ```

   It builds the CLI and the desktop app and writes
   `dist\Flint-<version>-windows-x86_64.zip`, the same package a release carries: one
   `Flint` folder with `Flint.exe`, `bin\flint.exe`, the app's `ui\` folder,
   `WebView2Loader.dll`, the licences and `install.ps1`. Every program links statically
   and needs only Windows' own DLLs, so the unpacked folder runs where it is
   ([Install](/start/install/#windows)). `scripts/package.sh windows` runs the same.

5. Install it for your user (optional): unpack the zip, then in PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\Flint\install.ps1
   ```

   | | Windows |
   |---|---|
   | App | `%LOCALAPPDATA%\Programs\Flint\Flint.exe`, with a Start menu entry |
   | CLI | `bin\flint.exe` in that folder; `bin` is added to your user's `PATH` |

   `flint` starts the `Flint.exe` one folder up when it needs the app. A running Flint is
   quit first. `-Uninstall` removes the program, the Start menu entry and the `PATH`
   entry; your vaults and settings in `%APPDATA%\Flint` stay. Without installing, the
   unpacked folder runs as it is, and the app offers to put its `bin` on the `PATH`
   itself.

The programs are not signed yet, so Windows SmartScreen may warn about them the first
time.
