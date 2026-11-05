---
title: Hosts and groups
description: Add hosts, organise them in nested groups, and find them by group or tag.
---

A **host** is a server you connect to. You refer to it by its **alias**, a short name
such as `web-01`. Aliases are 1–64 letters, digits, `.`, `_` or `-`, are unique in the
vault (ignoring case), and cannot start with `-` or `.`.

## Add a host

```sh
flint host add web-01 --hostname 10.20.30.40 --user root \
  --group homelab/web --tag prod --tag web --label "Web server"
```

| Flag | Meaning | Default |
|---|---|---|
| `--hostname <host>` | DNS name or IP address. Required | |
| `--port <n>` | SSH port | `22` |
| `--user <user>` | Login user | none |
| `--label <text>` | A display name | none |
| `--group <path>` | Group path such as `homelab/web`. Missing groups are created | none |
| `--tag <tag>` | A tag. Repeat the flag for several tags | none |
| `--color <#rrggbb>` | A colour for the GUI | none |
| `--notes <text>` | Free text | none |
| `--jump <alias>` | Connect through this host (ProxyJump) | none |
| `--cred <name>` | Log in with a saved [credential](/guides/credentials/) | none |
| `--key <name>` | Log in with a stored [key](/guides/keys/) | none |
| `--password` | Ask for a password for this host | none |
| `--password-stdin` | Read that password from stdin | none |

The password is encrypted again inside the encrypted vault and is never printed. Output
only says whether one is set.

## Find hosts

```sh
flint host list                      # every host
flint host list --group homelab      # hosts in homelab and its subgroups
flint host list --tag prod           # hosts tagged prod (any case)
flint host show web-01
```

## Change or remove a host

`host edit` changes only the flags you give:

```sh
flint host edit web-01 --port 2222 --tag only   # --tag replaces all tags
flint host edit web-01 --alias web-1            # rename
flint host edit web-01 --group ""               # take it out of its group
flint host edit web-01 --jump "" --no-password  # clear the jump host and the password
flint host edit web-01 --no-tags
flint host rm web-01
```

An empty value (`--group ""`, `--jump ""`, `--cred ""`, `--key ""`) clears that field.

Flint refuses changes that would break the vault:

- A host cannot jump through itself, and jump hosts cannot form a loop.
- A host that another host uses as its jump host cannot be removed.

To open a shell or run a command on a host, see [Connecting](/guides/connecting/).

## Groups

Groups nest, and you address them by path. Names compare ignoring case within one parent.

```sh
flint group add homelab/proxmox
flint group list
flint group rename homelab lab        # homelab/proxmox becomes lab/proxmox
flint group rm lab/proxmox            # only an empty group can be removed
```
