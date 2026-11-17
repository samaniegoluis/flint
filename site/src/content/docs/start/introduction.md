---
title: Introduction
description: What Flint is, and what works today.
---

Flint is an open-source SSH and RDP client for macOS and Linux, with Windows on the way.
It has a desktop GUI and a command-line interface, and both read the same **vault**: one
file that holds your hosts, SSH keys and login credentials.

## What makes it different

- **The whole vault is encrypted.** Hostnames, users and labels are encrypted too, not only
  passwords. You can keep the vault in a cloud-synced folder, or sync it across machines
  through a server you run yourself, which never sees your key.
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

Flint is in early development: a preview, with no release builds yet. Here is what works
today:

| Area | Status |
|---|---|
| Build on macOS and Linux | Works ([Build from source](/start/build-from-source/)) |
| Windows | In progress, waiting on cfire |
| Encrypted vaults, unlock in the app, auto-lock, recent vaults, master password change | Works ([Vaults](/guides/vaults/)) |
| Hosts, groups, keys, credentials from the CLI | Works ([CLI reference](/reference/cli/)) |
| `flint connect` / `flint exec`, jump hosts, known hosts | Works ([Connecting](/guides/connecting/)) |
| Desktop app: vaults, host tree, tabs, split panes, terminal, prompts, palette, settings | Works ([The desktop app](/guides/desktop-app/)) |
| Files over SFTP: `flint cp` and the app's Files view, server to server | Works ([Copying files](/guides/files/), [The Files view](/guides/files-view/)) |
| Tunnels: `flint tunnel` and the app's Tunnels view | Works ([Tunnels](/guides/tunnels/)) |
| Remote desktop (RDP) in a tab, full screen, two monitors | Works ([Remote desktop](/guides/remote-desktop/)) |
| AI agents: approvals, scoped tokens, activity log | Works ([Use Flint with an AI agent](/guides/ai-agents/)) |
| A conflict copy merged back: `flint vault merge` | Works ([Syncing a vault](/guides/vaults/#syncing-a-vault)) |
| `flint-vault-server` and sync from the CLI | Works ([Self-host a remote vault](/guides/vault-server/), [Sync a vault across machines](/guides/remote-vault/)) |
| Connecting a remote vault from the app | In progress |

To try the CLI without installing anything, open the [demo on the home page](/#try-the-cli):
a simulated terminal with a demo vault and a short guided tour. It runs entirely in your
browser and connects to nothing. To use Flint for real, [build it from
source](/start/build-from-source/).
