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

Flint is built against cfire commit `2d8613d`. cfire's installer builds whatever its `main`
points to and cannot pick a commit, so build that commit from a checkout instead:

```sh
git clone https://github.com/gsandoval/cfire && cd cfire
git checkout 2d8613d
make build
mkdir -p ~/.local/bin ~/.cfire
rm -f ~/.local/bin/cfire && cp cfire ~/.local/bin/cfire
rm -rf ~/.cfire/runtime && cp -R runtime ~/.cfire/runtime
cfire --version     # cfire 0.9.5 (2d8613d, …)
cfire doctor
```

On macOS, remove the old binary before copying the new one (`rm`, then `cp`): copying
over an existing signed binary makes macOS kill the new one on launch.

## 2. Install the native libraries

### macOS (Homebrew)

```sh
brew install libssh libsodium sqlcipher argon2 pkg-config
```

### Debian and Ubuntu

```sh
sudo apt install libssh-dev libsodium-dev libsqlcipher-dev libargon2-dev libsecret-1-dev pkg-config openssh-server
```

#### Ubuntu 24.04 and Zorin OS 18

Flint builds there with libssh 0.10, with two adjustments in your home folder (no `sudo`):

- **`clang++` by name.** The `clang-19` package installs `clang++-19` only, and cfire runs
  `clang++`:

  ```sh
  ln -sf /usr/bin/clang++-19 ~/.local/bin/clang++
  ```

- **A newer simdjson.** Ubuntu's simdjson 3.6 does not compile with clang 19
  (`no member named 'print_newline'`). Build simdjson 4 as a static library and point the
  build at it:

  ```sh
  mkdir -p ~/.local/src/simdjson ~/.local/include ~/.local/lib && cd ~/.local/src/simdjson
  for f in simdjson.h simdjson.cpp; do
    curl -fsSLO https://raw.githubusercontent.com/simdjson/simdjson/v4.6.6/singleheader/$f
  done
  clang++-19 -O2 -std=c++17 -DSIMDJSON_THREADS_ENABLED=1 -pthread -c simdjson.cpp
  ar rcs ~/.local/lib/libsimdjson.a simdjson.o && cp simdjson.h ~/.local/include/
  export CPLUS_INCLUDE_PATH=~/.local/include LIBRARY_PATH=~/.local/lib   # before cfire build
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
`PKG_CONFIG_PATH`. The adapters reach their native headers and link flags through it:
cfire's `build.cf` can declare frameworks, but only for `cfire build` of an executable, not
for `cfire test` of a package. Without it, `cfire build` fails to find `flint-native`.

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
the command; and with the app closed, `flint` starts it on its unlock screen.

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
