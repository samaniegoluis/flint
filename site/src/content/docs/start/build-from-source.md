---
title: Build from source
description: Install the toolchain and native libraries, then build and test Flint.
---

Flint is written in [cfire](https://github.com/gsandoval/cfire) and links three native
libraries: **libssh** (SSH), **libsodium** (key derivation and encryption) and
**SQLCipher** (the encrypted vault file). They are found through `pkg-config` and linked
dynamically.

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
sudo apt install libssh-dev libsodium-dev libsqlcipher-dev pkg-config openssh-server
```

## 3. Build

From the repository root:

```sh
cfire build
./build/flint --version
```

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

The script starts a throwaway `sshd` on `127.0.0.1:2222`, with its own host key, user key
and config in a temporary directory, so the SSH tests can open a real PTY. It does not
touch your system `sshd` or `~/.ssh`. To use another port, set `FLINT_TEST_SSH_PORT`.

To run only the tests that need no network, call `cfire test src`. The SSH tests then
print `SKIP`.
