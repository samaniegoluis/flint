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
- **You and your AI agent share one vault.** You work in the app; your agent runs
  `flint exec` in the terminal. It reaches your servers by alias and gets the output, never
  a password or a key. See [Use Flint with an AI agent](/guides/ai-agents/).
- **The CLI is a first-class citizen.** Every command supports `--json` and stable exit
  codes, for scripts as much as agents.
- **Flint holds the unlocked vault.** The key derived from the master password lives in
  the running app; the CLI and your agents ask it, and it locks on its own when you step
  away. The [Security model](/reference/security-model/) says what that protects and what
  Flint does next.

## Status

Flint is in early development. Here is what works today:

| Area | Status |
|---|---|
| Build on macOS and Linux | Works |
| Encrypted vaults, unlock in the app, auto-lock, recent vaults | Works ([Vaults](/guides/vaults/)) |
| Hosts, groups, keys, credentials from the CLI | Works ([CLI reference](/reference/cli/)) |
| `flint connect` / `flint exec`, jump hosts, known hosts | Works ([Connecting](/guides/connecting/)) |
| Desktop app: vaults, host tree, tabs, terminal, prompts, palette, settings | Works ([The desktop app](/guides/desktop-app/)) |
| Files over SFTP: `flint cp` and the app's Files view | Works ([Copying files](/guides/files/), [The Files view](/guides/files-view/)) |
| Tunnels, splits | Planned |

To try the CLI without installing anything, open the [demo on the home page](/#try-the-cli):
a simulated terminal with a demo vault and a short guided tour. It runs entirely in your
browser and connects to nothing. To use Flint for real, [build it from
source](/start/build-from-source/).
