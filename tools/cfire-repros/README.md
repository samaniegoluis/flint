# cfire repros

One folder per entry of [`docs/cfire-upstream.md`](../../docs/cfire-upstream.md), each a
workspace of its own (`build.cf`, `repro_test.cf`) that links nothing of Flint. A test
asserts the **fixed** behaviour, so `PASS` means the entry is fixed and a failure (or a
build error) means it is still open; `fixed-when` holds the text that decides it (CF-098:
the diagnostic that now rejects its code).

```sh
tools/cfire-repros/run.sh                         # macOS, or Linux natively
FLINT_LINUX_STEPS=repros scripts/linux-check.sh   # Docker Linux
windows/remote.sh <a script that sources windows/bin/env.sh, then runs run.sh>
```

Milestone 78 added the threads, sockets and HTTP entries: 098, 112, 137, 138, 140, 141,
142, 146, 208-211.
