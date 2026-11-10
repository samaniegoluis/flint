---
title: Tunnels
description: Reach a service that only listens inside a server, such as a database or a panel on localhost, through a local port forward saved in the host and run by Flint.
---

A tunnel makes a service that only listens inside a server reachable from this machine.
`db-01`'s Postgres listens on `localhost:5432` there; a tunnel saved in `db-01` listens
on `127.0.0.1:5432` here and forwards each connection over `db-01`'s SSH login. It is
`ssh -L`, with the login, the key and the jump hosts taken from the vault: nothing on
disk, no `~/.ssh/config`.

```sh
flint tunnel add db-01 postgres --local 5432          # saved in db-01
flint tunnel up db-01:postgres                        # Flint listens on 127.0.0.1:5432
psql -h 127.0.0.1 -p 5432 -U app                      # Postgres on db-01
flint tunnel down db-01:postgres
```

In the app you do the same from the host editor's *Tunnels* section and the *Tunnels*
view; the CLI and the app see the same tunnels, running in the same place.

## In the app

**Add one.** Open the host's editor (`⌘I`, or *Edit host* in its menu) and find
*Tunnels*. **Add tunnel** asks for a name, the port on this machine (always on
`127.0.0.1`), and the destination as the server sees it: leave the host empty for the
server itself (`localhost`), or type an address on its network. A tunnel is saved as soon
as you confirm it, apart from the host's own **Save**. If another tunnel already uses the
same local port, the dialog says so: you can save it, but only one of them can run at a
time.

**Start and stop.** The **Tunnels** view in the rail (`⇧⌘T`, `Ctrl+Alt+Shift+T` on
Linux) lists every tunnel by host, each with a switch and its state: `listening · 2
connections`, `stopped`, `starting…`, `port 5432 in use`, `connection lost`. The first
switch you flip on a host logs in, without a terminal: a password or an unknown host key
is asked right there, in the host's group. A login that fails says why, with *Retry* and
*Edit host*. The view's filter matches a name, a host or a port.

**From a session.** The session toolbar's **Tunnels** button shows how many of the
host's tunnels are up; its menu has a check per tunnel and *Manage tunnels…*. A tab, and
the host in the sidebar, carry a small mark while the host has tunnels up; hover it for
the list. The status bar counts every running tunnel.

**When you connect.** Tick *Open when I connect* on a tunnel and connecting to the host
starts it, once the terminal is in. Reconnecting the terminal or closing the tab leaves it
up: closing a host's last tab while its tunnels run says so, with *Stop them*. The palette
(`⌘K`) finds a tunnel by name, host or port, or by its action (`stop pg`): *Start tunnel pg on db-01*, *Stop tunnel …*,
*Connect to db-01 with tunnels* (a tab, and every one of its tunnels) and *Manage
tunnels of db-01…*.

## Save a tunnel in a host

```sh
flint tunnel add db-01 postgres --local 5432
flint tunnel add db-01 redis --local 16379 --to 6379
flint tunnel add bastion grafana --local 3000 --to grafana.internal:3000
flint tunnel add nas admin --local 8443 --to '[fd00::20]:443' --open-on-connect
```

| Part | Meaning |
|---|---|
| `<host>` | The host the tunnel goes through: its login, credentials and jump hosts |
| `<name>` | Letters, digits, `-`, `.` and `_`, unique in that host whatever its case. The tunnel is then `<host>:<name>` |
| `--local <port>` | The port Flint listens on, on `127.0.0.1` only |
| `--to <destination>` | Where each connection goes, **as the host sees it**: `6379` (the host itself), `host:port`, or `[address]:port` for IPv6. Without it, the same port on the host itself (`localhost:<port>`) |
| `--open-on-connect` | Start it whenever you connect to the host in the app |

`flint tunnel ls` lists every tunnel, `flint tunnel ls <host>` one host's. `flint tunnel
edit <host>:<name>` changes any part (`--name`, `--local`, `--to`, `--open-on-connect` or
`--no-open-on-connect`); a running tunnel keeps its old settings until you start it
again. `flint tunnel rm <host>:<name>` stops it if it runs, then forgets it. Removing a
host removes its tunnels.

Tunnels are stored in the vault, encrypted with everything else. A vault with tunnels is
opened only by a Flint that knows them (see [Vault format](/reference/vault-format/)).

## Start and stop

```sh
flint tunnel up db-01:postgres
flint tunnel status                 # every running tunnel
flint tunnel status db-01:postgres  # one, with its state
flint tunnel down db-01:postgres
```

A tunnel runs **in Flint**, the desktop app, which keeps it up after `flint tunnel up`
returns. With Flint closed, `up`, `down` and `status` fail with `locked` (exit 5): open
Flint, unlock the vault and run them again. They never ask for the master password on the
terminal, since there would be no process left to run the tunnel.

`up` logs in to the host as `flint connect` does: it checks the server's key, asks for a
password the vault does not hold, and goes through the jump hosts.
`--accept-new-host-key` and `--timeout` work as for `exec`. Starting a tunnel that
already runs changes nothing; stopping one that is stopped is not an error.

A port another program already uses fails with `port_in_use` (exit 22). Pick another
`--local`, or stop what holds it. A port below 1024 needs rights a normal user lacks on
Linux, and fails with `permission_denied`.

## How it runs

- **One session per host.** All of a host's running tunnels share one SSH session that
  has no terminal, apart from any tab you have open on that host. Closing a tab, or its
  connection dropping, leaves the tunnels up. The first tunnel on a host logs in; the last
  one to stop hangs up. A host that asks for a second factor asks again for its tunnels.
- **One channel per connection.** Each program that connects gets its own forward channel
  to the destination; closing either side closes both. Stopping a tunnel closes its
  listener and every connection through it.
- **Loopback only.** Flint listens on `127.0.0.1`, never on the network. Any program on
  this machine can connect to a running tunnel, as with `ssh -L`.
- **A lost connection** stops the host's tunnels: `status` and the Tunnels view say
  `connection lost` with the reason, and nothing reconnects on its own, since a login may
  need you. Flipping its switch, or `flint tunnel up`, starts it again.
- **One login at a time per host.** Two starts on one host (the app's *Open when I
  connect*, a `flint tunnel up`) take turns: the second rides the first one's session.
- **Locking the vault** leaves running tunnels up, as it leaves open terminals: they hold
  no key. `status` and `down` need the vault unlocked again. **Quitting Flint** closes
  every tunnel.

## Through an agent

`flint tunnel up` and `down` run on the host, so a program needs a grant or a token whose
**Run commands** reaches that host, or your **Allow** in Flint's window, which shows the
host, `127.0.0.1:<port>` on this machine and the destination on the host, and says that
the grant would also let the program run commands there. When the port is already in use
on this machine, the window says so and offers no **Allow**, since the tunnel could not
open. `ls` and `status` only read. Every
`up` and `down` is in the activity log. See [Use Flint with an AI
agent](/guides/ai-agents/).
