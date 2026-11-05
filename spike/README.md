# Spikes

Throwaway proofs from milestone 01. Nothing here is product code. They exist to show
that a risky combination works before the real feature is built, and they can be
deleted once that feature lands.

## `pty-webui`

An SSH PTY opened with libssh (`src/adapters/ssh`), streamed through the `EventSink`
port (`src/adapters/uievents`) to xterm.js in an `ext:webui` window. Keystrokes go back
over RPC. The real GUI is milestone 04.

```sh
cd spike/pty-webui
cfire build
open build/flint-pty-spike.app      # fill in host, port, user and private key path
```

`scripts/test.sh` runs it headless against a throwaway sshd: the page connects, types
`echo flint-$((40+2))-webui`, waits for `flint-42-webui` in the terminal and reports
back. On Linux, cfire's headless WebView runner is a no-op (CF-029), so there the
spike is only built.
