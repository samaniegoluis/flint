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

The app's own tunnel screens (the host editor's *Tunnels* section, the *Tunnels* view and
the session toolbar's menu) are coming next. Today you add tunnels and start them with
`flint tunnel`, and they run in the app.

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
| `--open-on-connect` | Start it whenever you connect to the host in the app (with the app's tunnel screens) |

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
- **A lost connection** stops the host's tunnels: `status` says `connection lost` with the
  reason, and nothing reconnects on its own, since a login may need you. `flint tunnel
  up` starts it again.
- **Locking the vault** leaves running tunnels up, as it leaves open terminals: they hold
  no key. `status` and `down` need the vault unlocked again. **Quitting Flint** closes
  every tunnel.

## Through an agent

`flint tunnel up` and `down` run on the host, so a program needs a grant or a token whose
**Run commands** reaches that host, or your **Allow** in Flint's window, which shows the
tunnel, the port it listens on and its destination. `ls` and `status` only read. Every
`up` and `down` is in the activity log. See [Use Flint with an AI
agent](/guides/ai-agents/).
