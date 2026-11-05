---
title: SSH keys
description: Store private keys inside the vault, by content.
---

Flint stores SSH private keys **by content**, inside the vault. There is no key file to
keep on disk next to it, and the vault works the same on every machine you sync it to.

## Add a key

Import a key file, or pipe the key in:

```sh
flint key add laptop --file ~/.ssh/id_ed25519
pbpaste | flint key add deploy --key-stdin
```

Flint parses the key before storing it. If the key has a passphrase, give it with
`--passphrase` (Flint asks for it) or `--passphrase-stdin`:

```sh
flint key add laptop --file ~/.ssh/id_ed25519 --passphrase
```

A wrong passphrase, a public key or anything that is not an SSH private key is refused.
Flint keeps the passphrase too (encrypted), so it never has to ask for it again.

## See and manage keys

```sh
flint key list
flint key show laptop      # type, SHA-256 fingerprint and public key
flint key rename laptop work-laptop
flint key rm work-laptop
```

Output shows the public key and fingerprint only. The private key and the passphrase are
never printed, with or without `--json`.

A key that a host or a credential uses cannot be removed. Unlink it first
(`flint host edit <alias> --key ""`).

## Use a key

Link a key to a host directly, or through a [credential](/guides/credentials/):

```sh
flint host edit web-01 --key laptop
```
