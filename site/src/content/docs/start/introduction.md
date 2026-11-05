---
title: Introduction
description: What Flint is, and what works today.
---

Flint is an open-source SSH client for macOS and Linux. It has a desktop GUI and a
command-line interface, and both read the same **vault**: one file that holds your hosts,
SSH keys and login credentials.

## What makes it different

- **The whole vault is encrypted.** Hostnames, users and labels are encrypted too, not only
  passwords. You can keep the vault in a cloud-synced folder.
- **The CLI is a first-class citizen.** Every command supports `--json`, so scripts and AI
  agents can reach your servers by alias without ever seeing a credential.
- **One master password per vault.** The key derived from it can be cached in the OS
  keychain, so a machine you trust opens the vault without asking.

## Status

Flint is in early development. Here is what works today:

| Area | Status |
|---|---|
| Build on macOS and Linux | Works |
| Encrypted vaults, keychain unlock, recent vaults | Works ([Vaults](/guides/vaults/)) |
| Hosts, groups, keys, credentials from the CLI | Works ([CLI reference](/reference/cli/)) |
| `flint connect` / `flint exec`, jump hosts, known hosts | Works ([Connecting](/guides/connecting/)) |
| Desktop GUI | Planned |

To try it, [build it from source](/start/build-from-source/).
