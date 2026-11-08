---
title: Build from source
description: Install the toolchain and native libraries, then build and test Flint.
---

Flint is written in [cfire](https://github.com/gsandoval/cfire) and links these native
libraries: **libssh** (SSH), **libsodium** (key derivation and encryption),
**SQLCipher** (the encrypted vault file), **libargon2** (only to read a Tether vault on
import) and, on Linux, **libsecret** (the keychain). They
are found through `pkg-config` and linked dynamically. On macOS the keychain is
Security.framework.

## 1. Install cfire

Flint is built against cfire commit `43431f2`. cfire's installer takes the commit in
`CFIRE_VERSION`:

```sh
rm -rf ~/.cfire/runtime     # the installer copies over it and leaves stale headers
curl -fsSL https://raw.githubusercontent.com/gsandoval/cfire/43431f2/docs/install.sh \
  | CFIRE_VERSION=43431f2 sh
cfire --version     # cfire 0.9.5 (43431f2, …)
```

It installs `cfire` into `~/.local/bin` and its runtime into `~/.cfire/runtime`, then runs
`cfire doctor`.

If an older cfire was installed from a checkout, its runtime in `~/.local/share/cfire`
takes precedence over the new one, and the build fails in clang. `cfire doctor` names the
runtime it uses; if it says `~/.local/share/cfire`, move that folder aside and clear the
precompiled-header cache:

```sh
mv ~/.local/share/cfire ~/.local/share/cfire-old && rm -rf /tmp/cfire_pch_cache
```

## 2. Install the native libraries

### macOS (Homebrew)

```sh
brew install libssh libsodium sqlcipher argon2 pkg-config
```

### Debian and Ubuntu

```sh
sudo apt install libssh-dev libsodium-dev libsqlcipher-dev libargon2-dev libsecret-1-dev pkg-config openssh-server
```

#### simdjson 4 (Debian, Ubuntu 24.04, Zorin OS 18)

cfire refuses a system simdjson older than 4 when it builds with clang 19 or later
(`system simdjson 3.12.3 is incompatible with Clang 19`), and Debian and Ubuntu ship 3.x.
Ubuntu's 3.6 really does fail to compile; Debian's 3.12 builds, but cfire refuses it too.
Build simdjson 4 as a static library in your home folder (no `sudo`) and point the build
at it:

```sh
mkdir -p ~/.local/src/simdjson ~/.local/include ~/.local/lib && cd ~/.local/src/simdjson
for f in simdjson.h simdjson.cpp; do
  curl -fsSLO https://raw.githubusercontent.com/simdjson/simdjson/v4.6.6/singleheader/$f
done
clang++ -O2 -std=c++17 -DSIMDJSON_THREADS_ENABLED=1 -pthread -c simdjson.cpp
ar rcs ~/.local/lib/libsimdjson.a simdjson.o && cp simdjson.h ~/.local/include/
export CPLUS_INCLUDE_PATH=~/.local/include LIBRARY_PATH=~/.local/lib   # before cfire build
```

#### Ubuntu 24.04 and Zorin OS 18

Flint builds there with libssh 0.10. The `clang-19` package installs `clang++-19` only,
and cfire runs `clang++`, so link it by name before building simdjson:

```sh
ln -sf /usr/bin/clang++-19 ~/.local/bin/clang++
```

With libssh 0.10, a command killed by a signal still exits 255, but `flint exec --json`
reports an empty `signal`: 0.10 does not give its name.

## 3. Build

From the repository root:

```sh
. scripts/env.sh
cfire build
./build/flint --version
```

`scripts/env.sh` adds Flint's own pkg-config folder (`src/adapters/pkgconfig/<os>/`) to
`PKG_CONFIG_PATH`. The adapters reach their native headers, per-OS link flags and libsecret
through it. Without it, `cfire build` fails to find `flint-native`.

The output lists the library versions that were linked:

```text
flint 0.0.0-dev
  libssh     0.12.2/openssl/zlib
  libsodium  1.0.22
  sqlite     3.54.1 (SQLCipher 4.20.0 community)
```

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
cfire's signature. On Linux the app also needs WebKitGTK (`libwebkit2gtk-4.1-dev`).

On Linux, approving a program in Flint's window asks for your login password through
polkit once Flint's action is installed; without it, Flint asks for the vault's master
password instead:

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

To run only the tests that need no network, call `cfire test src` (after
`. scripts/env.sh`). The SSH tests then print `SKIP`. One test stores, reads and deletes a
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

The page's own unit tests (keyboard map, host tree, fuzzy search) run with Vitest:

```sh
cd ui && npm test
```

### The desktop app end to end

```sh
scripts/gui-e2e.sh
```

It builds the app and drives its real UI in a hidden WebView against the throwaway
`sshd`s: creates a vault, adds a key and hosts, trusts a host key, types in the terminal,
checks the PTY size, reconnects, connects through a jump host, meets a changed host key
behind a TCP forwarder and replaces it, uses the palette and settings, then locks
(with a session that keeps running behind the lock screen, and on a simulated screen lock
and sleep) and unlocks. It also checks that no password reaches the page and that nothing from the vault
is readable in its file. It uses its own config folder and `FLINT_KEYCHAIN=off`, so your
keychain is not touched.

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

## Check the Linux build from macOS

With Docker running:

```sh
scripts/linux-check.sh
```

It builds the page on the host (the image has no Node), then builds a Debian image with
cfire pinned to the same commit and the apt packages above. Inside, it builds `flint` and
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
