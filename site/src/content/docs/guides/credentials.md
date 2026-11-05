---
title: Credentials
description: Reusable login profiles that many hosts share.
---

A **credential** is a reusable login: a user, plus a password or a key, or both. Link
it to many hosts and change it in one place, for example a domain account used
on many servers.

## Add a credential

```sh
flint cred add domain --user 'CORP\luis' --password
flint cred add deploy --user deploy --key deploy-key
```

| Flag | Meaning |
|---|---|
| `--user <user>` | Login user. Required |
| `--key <name>` | A stored [key](/guides/keys/) |
| `--password` | Ask for the password |
| `--password-stdin` | Read the password from stdin |

## Link it to hosts

```sh
flint host add dc1 --hostname dc1.corp.example --cred domain
flint host edit web-01 --cred domain
```

## Change or remove a credential

```sh
flint cred show domain
flint cred edit domain --password            # new password, asked on the terminal
flint cred edit domain --name corp --key ""  # rename and unlink the key
flint cred edit corp --no-password
flint cred list
flint cred rm corp
```

The password is encrypted and never printed; output shows only whether it is set. A
credential that a host uses cannot be removed.
