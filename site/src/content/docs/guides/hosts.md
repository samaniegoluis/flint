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
| `--sudo-password` | Ask for the password [`exec --sudo`](/guides/ai-agents/#sudo) types, when it is not the login password | the login password |
| `--sudo-password-stdin` | Read that password from stdin | none |
| `--command <cmd>` | Run this on every interactive connect, e.g. `herdr` or `tmux new -A -s main` | none |
| `--no-keep-shell` | End the session when that command exits, instead of starting a login shell | keep the shell |

The password is encrypted again inside the encrypted vault and is never printed. Output
only says whether one is set. In the desktop app you can [reveal or copy
it](/guides/desktop-app/#hosts-keys-and-credentials). The sudo password is never
revealed, not even in the app: it is only typed for a `sudo` you approved.

## Remote desktop (RDP) hosts

A host is an **SSH** host unless you say otherwise. A Windows machine you reach with
Remote Desktop is an **RDP** host. In the app, **New host** asks for the type first (see
[the desktop app](/guides/desktop-app/#remote-desktop-rdp-hosts)); from the CLI:

```sh
flint host add win-01 --type rdp --hostname 10.20.30.50 --user admin --domain CORP --password
```

| Flag | Meaning | Default |
|---|---|---|
| `--type rdp` | A remote desktop host. Chosen when the host is added, fixed after | `ssh` |
| `--port <n>` | RDP port | `3389` |
| `--user <user>` | Windows user. `DOMAIN\user` and `user@domain` work too | none |
| `--domain <name>` | Windows domain | none |
| `--password` / `--password-stdin` / `--cred <name>` | The login: its own password, or a credential that has one | none |

Label, group, tags, colour and notes work as for SSH hosts. An RDP host logs in with a
password only, so `--key`, `--jump`, `--command` and `--sudo-password` are refused for it.
To change a host's type, remove it and add it again.

Commands that need SSH (`exec`, `cp`, `connect`, `host test`, tunnels, and using it as a
jump host) refuse an RDP host with `wrong_host_type` (exit 23). Opening the remote desktop
in a Flint tab is on its way (v8); until then RDP hosts keep their logins in the vault.

## Run a command on connect

A host can start a program every time you open a shell on it, the way you would type it
yourself after logging in:

```sh
flint host edit codebox --command herdr                 # then a login shell
flint host edit db-01 --command "tmux new -A -s main" --no-keep-shell
flint host edit codebox --command ""                    # back to a plain shell
```

The command runs on the remote terminal through your interactive login shell, so your
profile, rc files and `PATH` are loaded as in a shell you opened yourself. By default a
login shell follows when the command exits; with `--no-keep-shell` the session ends
with the command. `flint connect --no-command` and `flint exec` never run it; in the
app, search the host in the command palette and pick **Connect without command**.
`host show` lists it.

## Check that a host works

```sh
flint host test web-01
# Connection to 'web-01' works: root@10.20.30.40:2222, host key verified, logged in (184 ms).
```

`host test` goes through the same steps as a connect: every jump host, the known-host
check (an unknown key is asked about, a changed one refused) and the login. Then it
hangs up without opening a shell or running anything. It never asks for a password:
when no saved method is accepted it fails with `auth` (exit 12), naming what it tried.

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
