---
title: Vault format
description: How a Flint vault file is encrypted, and what is stored where.
---

This page describes vault file format **v1**. Flint never changes the format of an
existing vault silently: every change is a numbered migration that runs when a newer
Flint opens the vault.

## What is on disk

| Bytes | Content |
|---|---|
| 0–15 | A random **salt**, in clear text. It is unique per vault and is not secret |
| 16 onwards | SQLCipher pages: the schema, every row and every index, encrypted |

Nothing else is written. There is no sidecar file and no plaintext header, so hostnames,
users, labels, tags, notes, group names, the vault name and the known host keys are all
encrypted.

Outside the vault file, the [list of recent vaults](/guides/vaults/#several-vaults) in
your config folder holds each vault's path and name in clear text, so `flint vault list`
works while every vault is locked. Nothing from inside a vault is ever written there. While a
change is being written, SQLite keeps a rollback journal next to the file, encrypted as
well, and deletes it when the change commits.

## Keys

```text
master key  = Argon2id(master password, salt)      ops 3, memory 256 MiB
page key    = crypto_kdf(master key, 1, "flintvlt")
secrets key = crypto_kdf(master key, 2, "flintvlt")
```

- **Argon2id** and **crypto_kdf** come from [libsodium](https://libsodium.org). The
  Argon2id cost is fixed by the format, so a library upgrade cannot change it.
- The **page key** encrypts the whole file through
  [SQLCipher](https://www.zetetic.net/sqlcipher/) (AES-256 with an HMAC-SHA512 per page).
  SQLCipher's own password derivation is bypassed. Its settings are fixed by the format:
  `cipher_compatibility` 4, page size 4096, HMAC and KDF algorithm SHA512.
- The **secrets key** encrypts passwords, private keys and passphrases a second time,
  with XChaCha20-Poly1305 (libsodium). Each sealed value is bound to its row and field,
  so it cannot be moved to another host or field. Secrets are only decrypted to connect.

## Schema

The tables inside the encrypted file change only through numbered migrations, which
are never edited once released. Opening a vault applies the ones it lacks, each in its
own transaction; a vault from a newer Flint is refused rather than downgraded.

| Migration | Adds |
|---|---|
| 1 | The format parameters (`meta`), groups, SSH keys, credentials, hosts and host tags |
| 2 | `known_hosts`: one server key per address (key type and SHA-256 fingerprint), recorded on first connect |
| 3 | `hosts.initial_command` and `hosts.keep_shell`: the command an interactive session runs, and whether a login shell follows it |

A vault that has been opened by a Flint with migration 3 is refused by older builds.

## The keychain

The master key, not the password, is what Flint caches in the OS keychain. It is stored
as a generic password with service `Flint` and account `vault-<salt in hex>`. On macOS
it goes in your login keychain, which does not sync to iCloud. On Linux it goes in the
Secret Service's default collection. `flint vault lock` deletes it.

## What this protects against

- **Someone with the file** (a cloud provider, a stolen backup) learns its size and the
  salt, and nothing else. To read it they must guess the master password, and each guess
  costs a 256 MiB Argon2id run.
- **Someone with your unlocked user session** can use the cached key, as they could use
  any logged-in app. Run `flint vault lock` on machines you do not fully trust, or set
  `FLINT_KEYCHAIN=off`.
