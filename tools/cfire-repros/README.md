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

Milestone 86 (cfire `v0.13.1`) added 218, 220, 221 and 222; 215, 216 and 222's packages
mark what the test uses `pub`, as `v0.13.0` requires, and 217's file fails to parse on
something other than `pub`. A folder whose entry is about the build rather than a test has
a `check.sh` (215, 218, 220, 221, 222). CF-219 has no repro: a local build renews the mtime
of every object it reuses, so the case milestone 83 hit needs a restored cache. CF-220 only
shows on Linux (`SKIP` on macOS).
