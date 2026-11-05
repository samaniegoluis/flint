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

Flint is built against cfire commit `3963814`. The installer builds whatever cfire's `main`
points to, so check the commit first:

```sh
git ls-remote https://github.com/gsandoval/cfire refs/heads/main
curl -fsSL https://cfire.memo.engineer/install.sh | sh
cfire doctor
```

## 2. Install the native libraries

### macOS (Homebrew)

```sh
brew install libssh libsodium sqlcipher pkg-config
```

### Debian and Ubuntu

```sh
sudo apt install libssh-dev libsodium-dev libsqlcipher-dev libsecret-1-dev pkg-config openssh-server
```

## 3. Build

From the repository root:

```sh
. scripts/env.sh
cfire build
./build/flint --version
```

`scripts/env.sh` adds Flint's own pkg-config folder (`src/adapters/pkgconfig/<os>/`) to
`PKG_CONFIG_PATH`. The keychain and process adapters reach their native headers and link
flags through it, because cfire cannot yet link an Apple framework or select a source file
per platform. Without it, `cfire build` fails to find `flint-native`.

The output lists the library versions that were linked:

```text
flint 0.0.0-dev
  libssh     0.12.2/openssl/zlib
  libsodium  1.0.22
  sqlite     3.54.1 (SQLCipher 4.20.0 community)
```

## 4. Run the tests

```sh
scripts/test.sh
```

The script runs the suites in `src/` and `spike/`. It starts a throwaway `sshd` on
`127.0.0.1:2222`, with its own host key, user key and config in a temporary directory, so
the SSH tests can open a real PTY. On macOS the spike test also opens the PTY in a hidden
WebView and checks that the output reaches the terminal. It does not
touch your system `sshd` or `~/.ssh`. To use another port, set `FLINT_TEST_SSH_PORT`.

To run only the tests that need no network, call `cfire test src` (after
`. scripts/env.sh`). The SSH tests then print `SKIP`. One test stores, reads and deletes a
throwaway entry in your real OS keychain; set `FLINT_TEST_KEYCHAIN=off` to skip it.

### The CLI end to end

```sh
scripts/cli-e2e.sh
```

It builds `flint` and drives it against throwaway vaults in a temporary folder: every
command, every exit code, `--json` output, the keychain cache (and `FLINT_KEYCHAIN=off`).
It also checks that no password, key or passphrase appears in any output, and that no
hostname, user, label or note appears in clear text in the vault files. It removes its
keychain entries when it finishes.

## Check the Linux build from macOS

With Docker running:

```sh
scripts/linux-check.sh
```

It builds a Debian image with cfire pinned to the same commit and the apt packages
above, builds `flint` and the terminal spike, and runs the tests and the CLI end-to-end
run twice: once against gnome-keyring on a private D-Bus session (keychain cache on), and
once with no Secret Service at all (every command takes the master password). Then it
opens the spike's real GTK window under Xvfb to check that SSH output reaches the
terminal.

:::note
cfire's prelude PCH does not match `-pthread`, which WebKitGTK requires, so a WebView
build on Linux needs a `clang++` wrapper that drops `-pthread`. The image installs one.
The plain `flint` CLI is not affected.
:::
