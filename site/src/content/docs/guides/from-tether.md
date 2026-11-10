---
title: Moving from Tether
description: Copy a Tether vault into Flint in one step, and what changes on the way.
---

Flint replaces Tether, the author's earlier SSH
client. `flint import tether` copies a Tether vault into the open Flint vault: groups,
hosts, stored keys, credentials, saved passwords and the host keys you already trusted.
The Tether file is only read, never changed, so you can keep using Tether until you
are happy with Flint.

## Import in the desktop app

Open (or create) the Flint vault to import into, then go to **Settings → Vault → Import
from Tether…**. Choose the Tether file (Tether shows its path under its own **Settings →
Vault**; it ends in `.tether`), type Tether's master password, and press **Preview** to
see what would be imported without writing anything. **Import** writes it and shows the
same report: what was added, what was already there, what changed on the way and what
could not be imported.

## Import from the command line

The same import, for the current vault (`--vault` picks another):

```sh
flint import tether ~/OneDrive/Tether/vault.tether --dry-run
flint import tether ~/OneDrive/Tether/vault.tether
```

Flint asks for **Tether's** master password (and for the Flint vault's, if it is locked).
`--dry-run` reports everything the import would do and writes nothing. To script it,
pipe Tether's password with `--password-stdin`; with `--master-stdin` too, the Flint
master password is the first line and Tether's the second.

```
Imported the Tether vault into 'Home'.
  added      10 groups, 28 hosts, 1 key, 1 credential, 28 known hosts
  already in 0 groups, 0 hosts, 0 keys, 0 credentials, 0 known hosts

Not imported (2):
  KIND    NAME                DETAIL
  tunnel  pve-01: proxmox ui  localhost:8006 → localhost:8006; Tether's tunnels are not imported: add it with `flint tunnel add`
```

Running it again adds only what is missing, so an import that stopped half way, or a
Tether vault you kept using for a while, can be imported again safely.

## What comes over

| Tether | Flint |
|---|---|
| Groups and subgroups | Groups with the same path. A name with `/` gets `-` instead |
| Host label | The host's label. Its **alias** is made from the label (`Code Box` → `code-box`; a second `Code Box` → `code-box-2`) |
| Hostname, port, user, notes, colour, tags | The same fields. Tags become valid tag names (`home lab` → `home-lab`) |
| Saved host password | A saved password, sealed again under the Flint vault's key |
| Stored SSH key and its passphrase | A stored key (reused if the vault already has one with the same fingerprint) |
| A key file path on disk | The file is read and stored in the vault, if it has no passphrase |
| Credential | A credential with the same user, password or key |
| Jump host | The same jump host |
| Initial command | The host's command on connect, with **return to shell** off: as in Tether, the session ends when the program exits. Turn it on in the host editor |
| Trusted host keys | Known hosts, so the first connect does not ask again |

A host already in the Flint vault (same label, hostname, port and user) is left alone.

## What does not come over

The report lists each item and why:

- **Tunnels**: add each one with `flint tunnel add` (see [Tunnels](/guides/tunnels/)).
- **A key file** that is missing, unreadable or passphrase-protected. Add it with
  `flint key add <name> --file <path> --passphrase` and set it on the host.
- **A colour** that is not `#rrggbb`.
- **A known host key** for an address the Flint vault already trusts with another key:
  Flint keeps its own and never replaces a key silently.

Tether's settings (theme, font, layout) live outside its vault and are not read.

## Security

The import holds Tether's master password and key only in memory, for the length of the
command. Each secret is opened and immediately sealed again under the Flint vault's
key; none is printed, including with `--json`. Tether derives its key with Argon2id over
four lanes, which libsodium cannot compute, so this one step uses the reference Argon2
library (libargon2). Everything Flint stores still goes through libsodium.
