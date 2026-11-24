---
title: Self-host a remote vault
description: Run flint-vault-server, the small server that keeps an encrypted copy of each of your vaults for every machine you use, in Docker or as a bare binary behind your own TLS.
---

`flint-vault-server` keeps your vaults in step between your machines. Every machine still
holds its full copy and works offline; the server keeps one more copy of each vault,
exactly as Flint uploads it, encrypted in full, with a version number. It never receives your master
password or any key, and it never opens the file: a stolen server, or a stolen token,
gives only ciphertext.

This page sets up the server. Connecting your vaults to it is
[Sync a vault across machines](/guides/remote-vault/).

One server holds one person's vaults, as many as you connect (Personal, Work…), each under
its id with its own versions, behind one token. Run your own instance; there are no
accounts.

## What it needs

- A machine that is always on: a home server, a VPS, a Dokploy or Coolify host.
- **TLS from a reverse proxy** in front of it (Caddy, Nginx Proxy Manager, Dokploy's
  Traefik). The server speaks plain HTTP on port `8787`, and Flint refuses `http://` for
  anything other than `localhost`.
- A strong master password on the vault: the file sits on a disk you do not watch all the
  time, where it can be attacked offline. Flint asks you to raise a weak one before it
  connects ([Changing the master password](/guides/vaults/)).

## Make a token

```sh
docker run --rm ghcr.io/samaniegoluis/flint-vault-server token
```

```text
token  1274efffed057806991fdd74f9ce80e70b69ca3eca2b51c7084383da47611122
hash   63d0ef544730329b59d126013f0b5341acdb1331d86d97aa105262af0eea910e
```

The **token** is what Flint sends with every request; keep it in your password manager,
Flint asks for it once and keeps it in the OS keychain. The **hash** is what you give the
server, so the server's configuration never holds the token itself. `--json` prints both
as JSON.

## Run it with Docker Compose

`packaging/vault-server/docker-compose.yml` in Flint's repository:

```yaml
services:
  flint-vault-server:
    image: ghcr.io/samaniegoluis/flint-vault-server:latest
    init: true
    restart: unless-stopped
    environment:
      FLINT_VAULT_TOKEN_HASH: ${FLINT_VAULT_TOKEN_HASH}
      FLINT_VAULT_TRUST_PROXY: ${FLINT_VAULT_TRUST_PROXY:-0}
    ports:
      - "8787:8787"
    volumes:
      - flint-vault-data:/data

volumes:
  flint-vault-data:
```

Put `FLINT_VAULT_TOKEN_HASH=<hash>` in a `.env` file beside it and run
`docker compose up -d`. On **Dokploy**, create a Compose service from this file, set the
variable in its Environment tab, and add a domain for port `8787`: Dokploy's Traefik
answers on HTTPS with a Let's Encrypt certificate. Set `FLINT_VAULT_TRUST_PROXY=1` there:
behind Traefik, or behind Docker Swarm's ingress, every client reaches the server from one
internal address (see [How the server counts clients](#how-the-server-counts-clients)).

The image runs as an unprivileged user and keeps everything in the `/data` volume.

## Run the bare binary

Build it from source ([Build from source](/start/build-from-source/), then
`cfire build flint-vault-server`; it needs libsodium only) and run it under your service
manager:

```sh
FLINT_VAULT_TOKEN_HASH=<hash> \
FLINT_VAULT_DATA=/var/lib/flint-vault \
FLINT_VAULT_LISTEN=127.0.0.1:8787 \
flint-vault-server
```

| Variable | Default | What it sets |
|---|---|---|
| `FLINT_VAULT_TOKEN_HASH` | | The token's hash from `flint-vault-server token` |
| `FLINT_VAULT_TOKEN` | | The token itself, instead of its hash (32 characters at least) |
| `FLINT_VAULT_DATA` | `./flint-vault-data` (`/data` in the image) | The data folder |
| `FLINT_VAULT_LISTEN` | `0.0.0.0:8787` | Address and port; `127.0.0.1:8787` behind a proxy on the same machine |
| `FLINT_VAULT_MAX_BYTES` | `33554432` (32 MiB) | The largest upload accepted |
| `FLINT_VAULT_MAX_VAULTS` | `50` | The most vaults the server keeps; a new one past it is refused with `507` |
| `FLINT_VAULT_TRUST_PROXY` | `0` | `1` to count clients by the proxy's `X-Forwarded-For` |

Set the token **or** its hash, not both. A token shorter than 32 characters is refused
at start.

## TLS with a reverse proxy

With **Caddy**:

```text
vault.example.com {
	reverse_proxy 127.0.0.1:8787
	request_body {
		max_size 32MB
	}
}
```

With **Nginx Proxy Manager**, add a proxy host for `http://<server>:8787`, request a
certificate, and under *Advanced* set `client_max_body_size 32m;`. Nginx reads each
upload whole before it passes it on, which also keeps a slow client away from the server.

The server serves **one request at a time** and gives each one 10 seconds for its headers
and 60 for its body; a client that stalls is cut off at those limits. A proxy that buffers
requests (Nginx does by default) keeps that from delaying anyone.

## Limits

- **Rate**: 120 requests a minute per client; past that the server answers `429` with
  `Retry-After`. Each machine syncs about once a minute.
- **Lockout**: 10 wrong tokens from one client within 10 minutes lock that client out for
  15 minutes, even with the right token.
- **Behind a proxy**, every request comes from the proxy's address, so one client
  typing a wrong token would lock out all your machines. Set `FLINT_VAULT_TRUST_PROXY=1`
  to count clients by the address the proxy forwards. Only set it behind a proxy you run:
  exposed directly, a client could forge that header. More in
  [How the server counts clients](#how-the-server-counts-clients).
- **Size**: an upload over `FLINT_VAULT_MAX_BYTES` is refused with `413`.
- **Vaults**: at most `FLINT_VAULT_MAX_VAULTS`. A stolen token could add vaults, so the
  cap bounds the disk it can fill.

The log has one line per request (client, method, path, status, time) and never a token,
a header's value, a vault's label or a vault file. A `500` adds its cause, an I/O error
naming a file under the data folder (`io: cannot read /data/vaults/…/head.json`); the
client gets only "the server could not read its store". A vault whose `head.json` cannot
be read is left out of the list (`skipped vault <id>: …` in the log) and answers `500`,
while every other vault keeps syncing.

## How the server counts clients

The rate limit and the lockout count **clients by address**: the address the connection
comes from, or with `FLINT_VAULT_TRUST_PROXY=1` the one the proxy forwards. That address
is rarely one machine:

- **A home or an office** reaches a server on the internet through its router, so every
  machine there is one public address. A **VPN** that masquerades its clients does the
  same. Ten wrong tokens from them, together, lock all of them out for 15 minutes.
- **Docker Swarm's ingress** (Dokploy, Coolify in Swarm mode) hands the server every
  connection from one internal address, such as `10.0.0.2`, whoever sent it. Behind it,
  set `FLINT_VAULT_TRUST_PROXY=1` and reach the server through a proxy that sets
  `X-Forwarded-For` (Traefik and Nginx Proxy Manager do).
- **A chain of proxies** (Nginx Proxy Manager in front of Dokploy's Traefik) forwards the
  address the first proxy saw, which for a machine on the internet is its public address.

This is why the desktop app stops syncing a vault after the server refuses its token
([A refused token](/guides/remote-vault/#a-refused-token)): a few machines still holding
an old token cannot lock out the ones that have the new one.

**Reading the client in the log.** Each line starts with the client the server counted:

```text
flint-vault-server: 203.0.113.7 GET /v1/vaults/00112233445566778899aabbccddeeff 304 1ms not modified
flint-vault-server: 203.0.113.7 GET /v1/vaults/00112233445566778899aabbccddeeff 401 0ms unauthorized
```

The same address for every machine means they share one (a router, a VPN, a proxy
without `FLINT_VAULT_TRUST_PROXY=1`); `10.0.0.2` or the proxy's own address on every line
means the forwarded address is not read.

**A port published for a proxy.** A typical homelab path is Nginx Proxy Manager at
`https://vault.example.com`, forwarding to a port Dokploy publishes on its host
(`http://192.0.2.10:22201`, Swarm's ingress, to the container's `8787`):

```text
machine ──https──▶ Nginx Proxy Manager ──http──▶ 192.0.2.10:22201 (ingress) ──▶ flint-vault-server:8787
```

That published port also answers anyone on the LAN who goes to it directly: in plain
HTTP, so the token crosses the network in clear, and with whatever `X-Forwarded-For`
they send, so with `FLINT_VAULT_TRUST_PROXY=1` they can pose as any address. Where the
host allows it, publish the port to the proxy alone (a firewall rule on the host, or the
port bound to an address only the proxy reaches), and give every machine the `https://`
address.

**Machines at home that count apart.** A local DNS name for the proxy (your router's or
Pi-hole's DNS pointing `vault.example.com` at the proxy's LAN address) makes machines at
home reach it directly, each by its own LAN address, while machines away keep reaching it
through the internet. Then one machine with an old token locks out only itself.

## Rotate the token

Make a new token, set its hash on the server, restart it, and give the new token to each
machine. Until a machine has the new one, its sync fails with `401` and its changes wait
on that machine; the desktop app tries once and then stops syncing that vault on its own
until it gets the new token (see [A refused token](/guides/remote-vault/#a-refused-token)). On each machine, run `flint vault token` (or **Settings → Vault → Server →
Replace token…** in the app) and give it the new token: it is checked against the server,
then kept in the keychain, and the waiting changes sync on the next round. Nothing is lost.

## Several vaults on one server

Each vault you connect goes to the server under its id, beside the others, and keeps its
own versions. The server cannot read a vault's name, so it tells them apart by id, and by
an optional **label** you give when you connect one (`flint vault connect <url> --label
Work`, or the *Label* field in the app). The label is stored **in clear** on the server:
leave it empty if the name itself is private, and the vault shows by its id alone.

On the server, list them:

```sh
docker exec <container> flint-vault-server vaults
```

```text
VAULT                             VERSION  UPDATED (UTC)             SIZE      LABEL
00112233445566778899aabbccddeeff       42  2026-11-13T18:20:11Z     104448
ffeeddccbbaa99887766554433221100        7  2026-11-17T09:02:40Z      61440  Work
```

`flint-vault-server label <id> <label>` sets a label (an empty one clears it). Every
command that names a vault takes its id or the first characters of it (4 or more, as long
as one vault starts with them), and needs none while the server keeps a single vault.

## Delete a vault

`delete` removes a vault the server keeps, with every version of it, after naming it and
asking:

```sh
docker exec -it <container> flint-vault-server delete ffee
```

```text
vault ffeeddccbbaa99887766554433221100 ('Work'): version 7, 7 versions kept, 61440 bytes
A machine still connected to it uploads its copy again at its next sync: disconnect them first.
Delete it and every version kept? [y/N]
```

Only `y` or `yes` deletes it. `--yes` skips the question for a script, and `--json` prints
the vault that was deleted. Each machine's own copy is untouched: disconnect them first
(`flint vault disconnect`, or **Settings → Vault → Server → Disconnect**), or the next sync
uploads the vault again as a new history.

## Updating from 0.11 or earlier

A server from 0.11 or earlier kept one vault at the top of its data folder. The first time
0.12 starts on that folder it moves the vault into `vaults/<id>/` and says so in its log.
Machines still on Flint 0.11 keep syncing through the old path (`/v1/vault`) while the
server keeps one vault; once a second vault is connected they are asked to update
(`410`), and their changes wait on them until they do. Update the server first, then the
machines.

**Back up the data folder before updating.** Going back to an older server afterwards is
not supported: it would not see the moved vault and would take the next upload as a new
history.

## The data folder and backups

Everything lives in one folder (`/data` in the image), a folder per vault:

```text
/data/
  vaults/
    00112233445566778899aabbccddeeff/
      head.json          the newest version: number, vault id, size, time
      label.json         the label, when it has one
      versions/
        41.blob  41.json the vault file as it was uploaded (encrypted) and its record
        42.blob  42.json
        …                the newest 10 versions; older ones are removed
    ffeeddccbbaa99887766554433221100/
      …
```

Back up the whole folder, with the volume backup of Dokploy or any file backup. The
`.blob` files are encrypted in full, so a backup reveals nothing without the master
password. A copy taken while the server runs is safe: each file is written aside and
renamed into place, and `head.json` is written last. A `.lock` folder or a `.tmp` file
seen in passing belongs to a write in progress.

## Restore an older version

The server keeps the last 10 versions of each vault. List them, then make one the newest
again (name the vault by its id, or a prefix of it, when the server keeps several):

```sh
docker exec <container> flint-vault-server versions 0011
```

```text
VERSION  STORED (UTC)              SIZE      VAULT
     42  2026-11-13T18:20:11Z     104448  00112233445566778899aabbccddeeff
     41  2026-11-13T18:19:02Z     104448  00112233445566778899aabbccddeeff
```

```sh
docker exec <container> flint-vault-server restore 0011 41
```

`restore` stores version 41 again as version 43 (`--json` prints its record). Every machine downloads it at its next
sync and **merges** it into its own copy, so this repairs a bad upload (a damaged file,
or an upload made with a stolen token) without losing what your machines hold. It does
not undo your own later edits: the merge keeps the newer change of each record.

To look at an old version as it was, copy it out and open it in Flint with the master
password it had then:

```sh
docker cp <container>:/data/vaults/00112233445566778899aabbccddeeff/versions/41.blob ./vault-v41.flint
```

## The protocol

For the curious, and for anyone writing a client. Every request carries
`Authorization: Bearer <token>`.

| Request | Answer |
|---|---|
| `GET /v1/vaults` | `200 {"vaults":[{"id","label","version","size","updated_at"}]}`: what a machine may download, before any password |
| `GET /v1/vaults/<id>` | `200` with the file, `ETag: "<version>"` and `X-Flint-Vault-Id`; `404` (`"error":"empty"`) while the server does not keep that vault |
| `GET /v1/vaults/<id>` with `If-None-Match: "<version>"` | `304` with no body while that is still the newest version, else `200` with the file: how a machine checks for changes without downloading the vault |
| `PUT /v1/vaults/<id>` with `If-None-Match: *`, `X-Flint-Vault-Id: <id>` and the file | `200 {"version":1}`: the vault's first upload |
| `PUT /v1/vaults/<id>` with `If-Match: "<version>"` | `200` with the next version, or `409` with the newest `ETag` when another machine uploaded first |
| `PUT /v1/vaults/<id>/label` with `{"label":"Work"}` | `200`; an empty label clears it, one over 64 characters or with a control character is `400` |
| `GET`/`PUT /v1/vault` | The single vault of Flint 0.11 and earlier: served while the server keeps at most one, `410` once it keeps several |

A `PUT` whose `X-Flint-Vault-Id` is not the id in its path is refused with `400`, one
without a precondition with `428`, a chunked one with `411`, a new vault past
`FLINT_VAULT_MAX_VAULTS` with `507`. A client that gets `409` downloads the newest version,
merges it with its own copy, and uploads the result over that version.
