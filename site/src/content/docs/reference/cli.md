---
title: CLI reference
description: Every flint command and flag.
---

:::note
Only `--version` exists today. The `vault`, `host`, `key`, `cred`, `connect` and `exec`
commands arrive in the next milestones.
:::

## `flint --version`

Prints the Flint version and the native library versions linked into the binary.

| Flag | Meaning |
|---|---|
| `--version`, `-V` | Print the version |
| `--json` | Write one JSON object to stdout instead of text |

```sh
flint --version --json
```

```json
{"flint":"0.0.0-dev","libssh":"0.12.2/openssl/zlib","libsodium":"1.0.22","sqlite":"3.54.1 (SQLCipher 4.20.0 community)"}
```
