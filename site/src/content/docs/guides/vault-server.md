---
title: Self-host a remote vault
description: Run flint-vault-server, the small server that keeps one encrypted copy of your vault for every machine you use, in Docker or as a bare binary behind your own TLS.
---

`flint-vault-server` keeps your vault in step between your machines. Every machine still
holds its full copy and works offline; the server keeps one more copy, exactly as Flint
uploads it, encrypted in full, with a version number. It never receives your master
password or any key, and it never opens the file: a stolen server, or a stolen token,
gives only ciphertext.

:::note[Coming next]
This page sets up the server. Connecting Flint to it (`flint vault connect`, and
*Connect remote vault* in the app) arrives in the next releases.
:::

One server holds one person's vault, behind one token. Run your own instance; there are no
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
answers on HTTPS with a Let's Encrypt certificate. Set `FLINT_VAULT_TRUST_PROXY=1` there
(see [Limits](#limits)).

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
  exposed directly, a client could forge that header.
- **Size**: an upload over `FLINT_VAULT_MAX_BYTES` is refused with `413`.

The log has one line per request (client, method, path, status, time) and never a token,
a header's value or the vault file.

## Rotate the token

Make a new token, set its hash on the server, restart it, and give the new token to each
machine. Until a machine has the new one, its sync fails with `401` and its changes wait
on that machine.

## The data folder and backups

Everything lives in one folder (`/data` in the image):

```text
/data/
  head.json          the newest version: number, vault id, size, time
  versions/
    41.blob  41.json the vault file as it was uploaded (encrypted) and its record
    42.blob  42.json
    …                the newest 10 versions; older ones are removed
```

Back up the whole folder, with the volume backup of Dokploy or any file backup. The
`.blob` files are encrypted in full, so a backup reveals nothing without the master
password. A copy taken while the server runs is safe: each file is written aside and
renamed into place, and `head.json` is written last. A `.lock` folder or a `.tmp` file
seen in passing belongs to a write in progress.

## Restore an older version

The server keeps the last 10 versions. List them, then make one the newest again:

```sh
docker exec <container> flint-vault-server versions
```

```text
VERSION  STORED (UTC)              SIZE      VAULT
     42  2026-11-13T18:20:11Z     104448  00112233445566778899aabbccddeeff
     41  2026-11-13T18:19:02Z     104448  00112233445566778899aabbccddeeff
```

```sh
docker exec <container> flint-vault-server restore 41
```

`restore` stores version 41 again as version 43. Every machine downloads it at its next
sync and **merges** it into its own copy, so this repairs a bad upload (a damaged file,
or an upload made with a stolen token) without losing what your machines hold. It does
not undo your own later edits: the merge keeps the newer change of each record.

To look at an old version as it was, copy it out and open it in Flint with the master
password it had then:

```sh
docker cp <container>:/data/versions/41.blob ./vault-v41.flint
```

## The protocol

For the curious, and for anyone writing a client. Every request carries
`Authorization: Bearer <token>`.

| Request | Answer |
|---|---|
| `GET /v1/vault` | `200` with the file, `ETag: "<version>"` and `X-Flint-Vault-Id`; `404` before the first upload |
| `PUT /v1/vault` with `If-None-Match: *`, `X-Flint-Vault-Id` and the file | `200 {"version":1}`: the first upload |
| `PUT /v1/vault` with `If-Match: "<version>"` | `200` with the next version, or `409` with the newest `ETag` when another machine uploaded first |

A `PUT` for another vault id is refused with `412`, one without a precondition with
`428`, a chunked one with `411`. A client that gets `409` downloads the newest version,
merges it with its own copy, and uploads the result over that version.
