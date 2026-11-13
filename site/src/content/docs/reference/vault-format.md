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

Outside the vault file, the [list of recent vaults](/guides/vaults/#the-vault-list) in
your config folder holds each vault's path and name in clear text, so `flint vault list`
works while every vault is locked, and a **vault id**: 128 bits of a BLAKE2b hash of the
salt, which is already in clear at the start of the file. The id recognises a vault after
its file moves, and keys the desktop app's layout state (`ui-state.json`, which holds only
that id and random group ids). Nothing from inside a vault is ever written there. While a
change is being written, SQLite keeps a rollback journal next to the file, encrypted as
well, and deletes it when the change commits.

## The activity file

The [activity log](/reference/security-model/#approving-callers) is not in the vault. Each
machine keeps its own, in a second SQLCipher file in the config folder:
`activity/<vault id>.db`, the folder owner-only (0700) and the file 0600. A vault that
syncs, through a cloud folder or later a remote vault, never carries it, and the log is
not rewritten on another machine. The file has its own random salt in its first 16 bytes
and is encrypted with its own key, derived from the vault's master key (below), so it
opens only while its vault is unlocked. **Back up activity…** copies it as it is, still
encrypted. A file the key no longer opens is kept beside it as `<id>.db.unreadable`
and a new log begins.

## Keys

```text
master key  = Argon2id(master password, salt)      ops 3, memory 256 MiB
page key     = crypto_kdf(master key, 1, "flintvlt")
secrets key  = crypto_kdf(master key, 2, "flintvlt")
activity key = crypto_kdf(master key, 3, "flintvlt")      the activity file's page key
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
| 4 | `tokens` (name, BLAKE2b hash of the secret, scope by group and host id, actions, created, expiry and revocation times; revoked, never deleted) and `activity` (time, caller, how it was allowed, action, host, command, outcome) |
| 5 | `hosts.sudo_password`: the password `exec --sudo` types, sealed with the secrets key like the host's password; empty means the login password |
| 6 | `activity.command_cut`: how many bytes of a command past 16 KB were cut (entries from before were cut at 160 characters and say 0). The log's retention in days is the `meta` row `activity_retention_days` (absent: 90) |
| 7 | `tunnels`: local forwards saved in a host (name, local port, destination host and port, open on connect), removed with their host; a name is unique in its host, whatever its case |
| 8 | `hosts.type` (`ssh` for every host saved before, or `rdp`) and `hosts.domain` (an RDP host's Windows domain). An RDP server's certificate is kept in `known_hosts` under `rdp://<name>:<port>`, beside SSH host keys |
| 9 | The activity log leaves the vault: `activity` is renamed `activity_moving`, and at the same unlock its rows (with their ids) and the `meta` row `activity_retention_days` are copied into this machine's [activity file](#the-activity-file), then dropped from the vault. A move cut short is finished at the next unlock, with no duplicate |

A vault that has been opened by a Flint with migration 9 is refused by older builds.

## The keychain

With **Remember on this computer** ticked at unlock (off by default), the master key, not
the password, is what Flint keeps in the OS keychain. It is stored
as a generic password with service `Flint` and account `vault-<salt in hex>`. On macOS
it goes in your login keychain, which does not sync to iCloud. On Linux it goes in the
Secret Service's default collection. Unticking the box, **Forget on this device** and
`flint vault lock` delete it.

## What this protects against

- **Someone with the file** (a cloud provider, a stolen backup) learns its size and the
  salt, and nothing else. To read it they must guess the master password, and each guess
  costs a 256 MiB Argon2id run.
- **Someone with your unlocked user session** can use a remembered key, as they could use
  any logged-in app. Leave **Remember on this computer** unticked on machines you do not
  fully trust, or set `FLINT_KEYCHAIN=off`.
