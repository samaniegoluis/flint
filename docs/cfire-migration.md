# Moving Flint to the new cfire

A working plan, not a spec. It orders the move off cfire `c5b1d4b` (0.10.0, D-060) onto
the next cfire release so that it happens one step at a time, with every step green
before the next. It can be deleted when the move closes (step 7); what must outlive it
goes into `decisions.md`, `cfire-upstream.md` and the Windows port guide.

Facts below were read on 2026-11-17 from a clone of `gsandoval/cfire` at `2d830cd`
(not installed anywhere), and again on 2026-11-18 at `7b68799` (`v0.12.0`, see *Re-read
on 2026-11-18*). Re-read them when the release this plan targets is out.

## Where cfire is

| Fact | Detail |
|---|---|
| History | Rewritten twice since our pin: `c5b1d4b` is `2d9daec` upstream today. 33 commits since, 602 files, ~690k lines added (most of it the vendored SQLite and simdjson) |
| Releases | Latest `v0.11.0` (2026-11-11) ships **macOS arm64 only**. `main` has a 6-target pipeline (Linux x86_64/arm64, macOS arm64/x86_64, Windows x86_64/arm64, `release.yml`) that no tag has used yet. `install.sh` and `install.ps1` exist and fetch the release's archive with SHA-256 checks; on Windows they fail until a release carries a Windows archive |
| Windows toolchain | MSYS2 **CLANG64**, native (`clang++` only, Q55). Cross-compiling from Linux with llvm-mingw, as the port does today, is not their supported path |
| Windows CI | Red on `main`: the Windows job stops at its first step, `make: command not found` in MSYS2 (a CI setup problem, our W-07). The author reports Windows VM gates passing locally (190/190) |
| Flint backlog upstream | `docs/planning/flint.md`: **CF-211 – CF-239**, written for Flint's move off `c5b1d4b`; all done but three excluded (CF-231 multi-socket wait, CF-233 fd canary for `import cpp`, CF-238 tags for downstream pins). Its *Flint ref* column maps each item to our `cfire-upstream.md` entries. Our numbers from CF-086 up collide with theirs: cite theirs as `upstream CF-NNN` |
| Pins | Upstream tags immutable SemVer releases only (CF-238 excluded): pin a `vX.Y.Z` tag, never a commit |

### Breaking changes that reach Flint

| Change (upstream commit) | Flint's exposure (`main`, 2026-11-17) |
|---|---|
| `@pkg(...)` on `import` retired → `build.cf` `PkgConfig` / `Includes` (`597fd87`) | 34 `import cpp ... @pkg(...)` lines; the per-OS `pkgconfig/` folders and `scripts/env.sh` |
| `@define` on `import` retired (`14a1a51`) | none found |
| One canonical import path per module, `cfire/INVALID-IMPORT` with a `cfire fix` rewrite (`2d830cd`) | 289 relative imports plus `core:`/`ext:` ones; to check after `cfire fix` |
| `byte` is `u8`; byte literals (`5869497`, `cdccc09`) | 253 uses of `byte` |
| String view parameters by default (`cdccc09`) | every `str` parameter; mostly invisible, breaks where a parameter is stored or returned |
| Explicit integer narrowing, element-wise literal checks (`dcb513a`) | unknown until it compiles |
| Language soundness, typed sema, uniform builtin API (`05b7834`) | unknown until it compiles |
| Three-tier test gates, FFI-only pointers (`b0f9b65`) | the native shims (22 `.hpp`, ~8k lines) and how `cfire test` builds |
| webui: DevTools and context menu **off** in release builds (upstream CF-218) | the gui-e2e runs may rely on DevTools or a dev build |
| Cache root moved to the OS user cache; `cfire clean` rules (upstream CF-216/217/237) | scripts that point at `.cfire_cache` or `CFIRE_CACHE_DIR` |

Flint today: 164 `.cf` files (~41k lines), 358 `CFIRE-UPSTREAM` tags, 150 entries in
`cfire-upstream.md`.

### Re-read on 2026-11-18 (`7b68799`)

| Fact | Detail |
|---|---|
| `v0.12.0` | Tagged 2026-11-17 on `7b68799`, today's `main` (nothing after it). Since `2d830cd` one commit, `c515dfe`: `cfire upgrade`, the release pipeline, installers, formatter. **No language change**; `pkg:*` imports retired (`cfire/RETIRED-API`), and Flint has none |
| Its release | **No archives.** The release run failed: both Linux builds at the archive's smoke test (`no matching member function for call to 'query'`, SQLite), both Windows builds with exit 127 (a command not found, as W-07); macOS cancelled with them. `v0.11.0` is still GitHub's latest |
| CI on `main` | Red on one TSan test (`busy + waiting are served and the next is 503`, got three 200s); the Linux, Windows and fuzz jobs pass |
| Releases from now on | **Every green `main` CI publishes a patch release** with the six archives and `SHA256SUMS.txt` (`release.yml` `workflow_run`); minor and major by hand. So the first release with archives is likely `v0.12.1`, as soon as the pipeline is fixed, and later patches come often: `cfire upgrade --version <tag>` makes a bump one command |
| History | `main` and the `v0.10.0`/`v0.11.0` tags were rewritten between 2026-11-10 and 2026-11-15; nothing since. Record the tag's commit when it is pinned and check it again before step 7 |
| Runtime lookup | A binary under `<prefix>/bin` finds `<prefix>/share/cfire/runtime` (or `CFIRE_RUNTIME_DIR`). **`cfire setup` copies the runtime to `~/.cfire/runtime`**, which is where the installed `c5b1d4b` reads its headers: never run the new `cfire setup` while the old one is in use |
| LSP and MCP | Both in the binary (`cfire lsp`, `cfire mcp`). The project's `.mcp.json` runs `cfire` from `PATH`, the old one |

**Why Windows still waits** (owner asked, 2026-11-18). Not a hard block: the test VM has
MSYS2 CLANG64 and could build `v0.12.0` from source. It waits because Windows is step 6
anyway (after the Mac and Linux are green and the workarounds are gone), because the
Windows packaging is exactly what fails in the release, so a hand-built cfire may differ
from the archive a user installs, and because the point of the VM is Flint installed and
tested as a user would (`install.ps1`). A cheap early probe, if wanted: build `v0.12.0`
on the VM and run `cfire doctor` and a WebView2 hello world, without starting the port.

## Rules for the move

1. **One target.** The release with a Windows archive (the first tag after `v0.11.0`
   that uses the 6-target pipeline). Not `main` at a commit, not the fork with our
   patches. If the owner chooses to start before that tag, do steps 1-4 on the
   macOS archive of the newest tag and redo nothing later but the version bump.
   **The owner chose to start (2026-11-18)**: steps 1-3 on the Mac with `v0.12.0` built
   from source at its tag (no archive exists yet), replaced by the first release's
   archive when it is out. Windows (step 6) starts from an archive.
2. **Side by side, never in place.** The new cfire goes into its own prefix
   (`~/.local/opt/cfire-<version>`) and is put on `PATH` only by a script of the
   migration branch. The installed `c5b1d4b` and the Windows fork stay as they are
   until step 7, so `main` and `windows-port-2` keep building throughout.
3. **One branch:** `cfire-<version>` from `main`. Merges from `main` only between
   steps. Nothing from it reaches `main` before step 7.
4. **First make it work, then make it simpler.** Steps 2-4 change only what the new
   cfire forces. A workaround cfire made unnecessary is removed in step 5, one commit
   each, with behaviour unchanged. A new capability (`core:net/ipc` in place of the
   socket shim, for one) is a ROADMAP item, not part of this move.
5. **Bottom up, a package at a time:** `domain` → `ports` → `application` →
   `adapters/*` → `drivers/*`. A package compiles and its tests pass before the next
   one starts.
6. **Rule 9 holds.** A failure is read and understood before anything is rerun. A cfire
   bug gets an entry in `cfire-upstream.md` at once, with a repro, citing upstream's
   numbers where one exists.
7. **A baseline first.** Every check's result on the old cfire, on every host, written
   down before step 1, so a regression is told apart from something that was already
   red.

## Test hosts

| Host | Role | Runs | State |
|---|---|---|---|
| Mac (owner) | Primary; first platform migrated | everything: `scripts/test.sh`, `cli-e2e`, `gui-e2e`, `serve-e2e`, `sync-e2e`, `server-e2e`, the site | in use |
| Docker on the Mac | Linux, headless | `scripts/linux-check.sh` (every step) | in use |
| Zorin OS 18.1 box | Linux with a real desktop (WebKitGTK, GNOME on Wayland) | the GUI checks a person or a real session needs | in use for owner checks; to make official for the automatic suites |
| Windows test VM (new, dedicated) | Windows, native, reachable every day | the whole Windows battery on stock cfire, started over SSH | to create (below); an existing VM was used on 2026-11-17 to prove SSH and `flint exec` work |
| WSL2 on the work machine | Today's Windows host for the fork | the `windows/` scripts over WSL interop | kept until the VM takes over, then retired; its network is restrictive and it is not always at hand |

### How the hosts are used (owner, 2026-11-17)

- **Every host runs its battery from one command, started over SSH** (`flint exec
  <host> -- …`) from wherever the work happens (the Mac, Zorin or this machine). The
  command builds, runs everything and ends with a summary and an exit code: whoever
  started it only reads whether something failed, and the log when it did.
- **A release gate.** Before a version is tagged, the battery passes on the Mac, on
  Zorin and on the Windows VM. Then the tag goes up, and GitHub Actions builds the
  release files for the three systems (ROADMAP, "Releases, a Releases page and
  self-update"). CI builds and packages; it does not replace the local battery, so a
  release never fails, or ships, on a system nobody ran.
- This starts after the move: with cfire's prebuilt releases, a host needs only the
  release archive, not a cfire built by hand.

### The Windows VM: native, not WSL

The port ran from WSL2 because Claude Code runs there on the work machine and the old
cfire only cross-compiled for Windows. That bridge cost real time (`WSLENV` letting
`flint.exe` use the owner's real config, SQLite unable to lock on `\\wsl.localhost`,
mirrored networking's reserved ports, kills that do not cross interop, tests copied
to `%TEMP%`). On the VM, Flint is built and tested **as a Windows user runs it**:

| Piece | On the VM |
|---|---|
| Toolchain | MSYS2 CLANG64 (upstream's supported Windows path) and cfire's Windows release (`install.ps1`) |
| Build | `cfire build` natively: no cross-compiling, no copied sysroot |
| Unit tests | `cfire test` natively: no runner copying suites to `%TEMP%` |
| e2e scripts | MSYS2's bash with native paths. Better still: `main`'s scripts made portable, instead of `windows/` rewriting them at run time |
| RDP test servers | Already built for Windows (`windows/rdp-testserver.sh`) |
| SSH test servers and the vault server | **Open.** Either on a Linux machine on the LAN (Zorin, or a container on Proxmox: realistic, since Flint on Windows talks to Linux servers, but the battery then depends on that machine), or a throwaway `sshd.exe` on the VM itself (Windows' OpenSSH runs as a SYSTEM service; whether it runs as a throwaway process with its own config is unchecked). `flint-vault-server` is Linux-only, so it goes to the LAN machine either way |
| GUI runs | **Need the desktop session.** A program sshd starts has no desktop, so no WebView2 window opens from a plain SSH command (under WSL it did, because WSL runs inside the logged-in session). The SSH command must start the GUI runs as a scheduled task "run only when the user is logged on", in the owner's session, and wait for it. That session must exist: automatic logon, and `tscon <id> /dest:console` before leaving RDP so it keeps drawing |

No WSL2, so no nested virtualization needed.

### The Windows test VM

On 2026-11-17 the owner's existing Windows VM was set up for SSH and measured through
`flint exec`. It proved the path works, and showed why it should not be the test host:
it is a work machine with a **corporate antivirus** (behaviour monitoring, real-time
scanning). That antivirus may quarantine or slow freshly built unsigned `.exe`s and,
worse, hold a file for a moment while scanning it, which turns Flint's write-then-rename
of a vault into a failure that comes and goes (rule 9's worst case). It stays useful as
an occasional "corporate machine" check, not as the gate.

**The test host is a new, dedicated VM** (owner, 2026-11-17), switched on in place of
the work VM when testing (they never run together):

- Stock Windows 11 Pro from Microsoft's ISO, a clean install. No "lite" builds (Tiny11
  and the like): they remove pieces Flint depends on or the battery uses (Edge's update
  service behind WebView2, winget, optional features such as OpenSSH), and they are
  third-party images. No clone of the work VM (it carries the antivirus).
- 6 vCPU (owner, 2026-11-17: the node has no more to give) with CPU type `host`: AVX2
  for faster builds, and the SSE4.2/POPCNT that Windows 11 24H2 and later require. 12 GB
  RAM, about 100 GB of disk.
- OpenSSH Server: the stock firewall rule allows only the Private profile, so on a
  network Windows marks Public the port stays closed; a rule of its own for any profile,
  limited to the LAN and the VPN subnet. PowerShell as SSH's default shell. Key login.
- Defender stays on, with exclusions for the build and test folders.
- Automatic logon and the scheduled-task launcher for the GUI runs.
- A Proxmox snapshot once set up.

**Over SSH, an administrator account is already elevated.** OpenSSH on Windows gives a
member of Administrators its full token, with no UAC prompt, so every `flint exec` to
such an account runs as administrator, with no window (the case the agents guide warns
about for `root` on Linux). The battery's account should be a standard user unless a
step needs more (ROADMAP §3, Windows elevation).

#### Its state (2026-11-18)

Flint host `Windows11-Flint-SSH` (RDP: `Windows11-Flint-RDP`), on the secondary node.

| Piece | State |
|---|---|
| Windows | 11 Pro 22H2 (22621), updated. **22H2 is out of servicing** (its last cumulative update is 2024-10), and Windows Update will not offer 25H2: the host's i7-6700 is not on Windows 11's CPU list. Open, for the owner: an in-place upgrade to 25H2 from the ISO (`AllowUpgradesWithUnsupportedTPMOrCPU`), a clean 25H2 install, or a physical machine instead |
| CPU, RAM, disk | `host` (i7-6700, AVX2), 6 vCPU, 8 GB (12 wanted, see below), 99 GB |
| SSH | Works through `flint exec`; PowerShell 5.1 as the default shell. **Password login** (no `authorized_keys` yet); the firewall rule covers every profile but is not limited to the LAN and VPN yet |
| Account | `lsamaniego`, an administrator, so every `flint exec` runs elevated. The standard battery user is still to create |
| Defender | On, with exclusions `C:\flint-work` and `C:\msys64` |
| WebView2, winget | Present (WebView2 157). winget is 1.2 and crashes over SSH (`0xC0000005`): install things from their own installers |
| MSYS2 | `C:\msys64`, from the official `msys2-x86_64-latest.sfx.exe`, updated. CLANG64: clang 23.1.5, make 4.4.1, git 2.56.1, pkgconf 3.0.11. Over SSH: `$env:MSYSTEM="CLANG64"; C:\msys64\usr\bin\bash.exe -lc "…"` |
| Flint | Cloned anonymously over HTTPS to `C:\flint-work\flint`: the VM only pulls, so no GitHub credential lives on it. Git: `core.autocrlf=false`, `core.eol=lf` |
| Still to do | Automatic logon and the GUI launcher (the owner, at the console); key login; the battery user; a Proxmox snapshot; cfire itself waits for its Windows release |

### Where the VMs run (2026-11-17)

Two Proxmox hosts, not clustered. The secondary already holds the Linux desktop (Zorin,
8 GB) and the Windows VM (12 GB) on 16 GB of RAM, and is swapping; the primary's RAM is
fully allocated. So the Windows and Linux test VMs fit side by side only if:

1. the secondary gets more RAM (32 GB holds both with room), or
2. Zorin moves to the primary, once about 8 GB is freed there (then each test VM has a
   node of its own, and two agents, one per VM, can build in parallel), or
3. both shrink (Windows 8 GB, Zorin 6 GB) and build more slowly.

The owner decides. Disk is not the limit on either host.

### Where the work happens

- **The Mac is the base**: the code is edited, committed and pushed there, and Claude
  Code runs there. It goes everywhere with the owner.
- **The test VMs are driven over SSH through Flint** (`flint exec <host> -- …`): a VM
  pulls the branch and runs its battery; the owner approves the grant in Flint and every
  command is in the activity log. Flint is tested by being used for what it is for. Two
  agents, one per VM, may run at once when each VM has its own node.
- **The WSL2 work machine retires** from Flint work: `windows-port-2` stays as it is
  (pushed, frozen at `d191abd`) as the reference for the Windows port; nothing new goes
  there. Claude Code's notes about it live on that machine only, so whatever matters is
  in this file and in `docs/windows-port-guide.md` on that branch.
- **The battery's scripts are bash** on every system (MSYS2's on Windows, which comes
  with the toolchain anyway); PowerShell only for glue that exists only on Windows (the
  scheduled task, the firewall, automatic logon). One language, so a check is written
  once.

## Steps

Each step ends with a line in the table at the end, its checks and the commit.

### 0. Ready the hosts and the baseline (now, before the release)

- The Windows test VM: created and set up as above (SSH, desktop session, snapshot).
  MSYS2 and cfire can wait for step 6, since they come with the release.
- Where the VMs run: the owner's choice among the three above.
- Zorin: which automatic suites it runs (`scripts/test.sh`, `cli-e2e`, `gui-e2e`
  with a real WebKitGTK), and how they are started over SSH.
- The baseline on the old cfire: every check, on every host, with its numbers. The Mac
  and Docker before step 1; Zorin's may wait until just before step 4 (owner,
  2026-11-18: the box is off and shares the secondary node's RAM), on the same `main`
  commit and with its cfire untouched, since only step 4 compares against it.

### 1. Install the new cfire beside the old one (Mac)

- The release's macOS archive in `~/.local/opt/cfire-<version>`; `cfire --version`,
  `cfire doctor`. Until an archive exists: the tag built from source and installed with
  `./cfire install --prefix ~/.local/opt/cfire-<version>`. Never its `cfire setup` (it
  overwrites `~/.cfire/runtime`, the old cfire's headers); a missing library is
  installed by hand.
- `scripts/cfire-next.sh` on the branch: puts it first on `PATH` for one command.
- A second MCP server in `.mcp.json` on the branch, `cfire-next`, running the new binary
  (`cfire mcp`), so lookups and checks answer for the new language; the editor's LSP
  pointed at the new `cfire lsp` while working on the branch.
- Read upstream's GUIDE for `build.cf` `PkgConfig` / `Includes`, and its notes for
  each breaking change in the table above.

### 2. Compile on the Mac

- `cfire fix` for the machine-applicable rewrites (imports), reviewed as its own commit.
- `@pkg` out of every `import cpp`, into `build.cf`; `pkgconfig/` and `scripts/env.sh`
  follow.
- Then `cfire check` package by package, bottom up (rule 5), one commit per package or
  per kind of fix.

### 3. Tests green on the Mac

- `cfire test` per package, bottom up; the `[auto]` JSON round-trips and fd checks
  included.
- Then the CLI (`cli-e2e`), the server (`server-e2e`, `sync-e2e`), the app
  (`build-gui.sh`, `gui-e2e`, `serve-e2e`), the site build. Compared with the baseline.

### 4. Linux green

- `scripts/linux-check.sh` with the new cfire's Linux archive in the image.
- Zorin: the build and the automatic suites; the GUI on a real WebKitGTK.

### 5. Remove what cfire made unnecessary

- Walk upstream's `flint.md` table (*Flint ref* column) and the 358 `CFIRE-UPSTREAM`
  tags: for each, covered (remove the shim, keep the behaviour, its test still passes),
  covered differently (adapt), or still missing (keep, re-file upstream).
- `cfire-upstream.md`: each entry marked fixed with the version, or kept.
- One commit per workaround. The Mac and Linux checks after each batch.

### 6. Windows on stock cfire

- On the Windows VM, natively (no WSL): MSYS2 CLANG64, the release's Windows archive
  (`install.ps1`), `cfire doctor`. The WSL bridge in `windows/` (`wslpath`, `WSLENV`,
  interop, the `%TEMP%` copies) is replaced, not carried over: the battery runs in
  MSYS2's bash and is started over SSH.
- A branch from the migrated `cfire-<version>`, with `windows-port-2`'s **Flint-side**
  changes brought over (the `_windows` shims, the `windows/` scripts, the UI changes),
  none of cfire patches 0001-0009.
- Each W-NN in `cfire-windows.md`: covered upstream (drop the workaround), covered
  differently (adapt Flint), still missing (a new upstream report with a repro; the
  port waits or keeps a Flint-side shim). Expected covered, from reading the source:
  WebView2 in the window with its own declarations (W-06, W-09, W-10), `.exe` names
  (W-02), `_unix.cf` (W-08), UTF-8 `os.args()` (W-11), the embedded icon (W-13),
  AF_UNIX sockets in `fs.exists` (W-14). Expected still open: focus after Alt+Tab
  (W-16), Windows CI (W-07). [read], not [ran].
- The checks in the port guide's order, on the VM.
- Then the owner decides whether the Windows port joins `main` (it was kept apart only
  while cfire lacked Windows support).

### 7. Close

- `decisions.md`: the new pin (a `vX.Y.Z` tag), superseding D-060; how it is installed
  on each OS.
- `.claude/rules/cfire.md` and `CLAUDE.md` follow the new language and toolchain.
- The branch into `main`; a release (rule 10), the first one gated by the battery on
  the Mac, Zorin and the Windows VM. The GitHub Actions release workflow (ROADMAP,
  "Releases") is its own milestone after this move.
- The old cfire and the fork uninstalled; this file deleted, or kept as the record of
  the move.

## Baseline (step 0)

What every check gives on the old cfire, to tell a regression from something already red,
and to measure how much faster the new cfire makes the battery (owner, 2026-11-18). Times
are wall clock, one run each, nothing else running.

### Mac, 2026-11-18

Flint `38d3e3c` (`main`), cfire **0.10.0 `c5b1d4b`**; Apple M3 Pro (11 cores, 18 GB),
macOS 27.2.1, Apple clang 21.0.0, Node 24.19.0.

| Check | Result | Time |
|---|---|---|
| `scripts/test.sh` (17 suites, then release-test) | 17/17 PASS, release-test 24/24 | 7 min 44 s |
| `scripts/cli-e2e.sh` (builds the CLI first) | 483/483 | 2 min 51 s |
| `scripts/server-e2e.sh` | 70/70 | 19 s |
| `scripts/sync-e2e.sh` | 105/105 | 1 min 47 s |
| `scripts/serve-e2e.sh` | 223/223 | 2 min 58 s |
| `scripts/gui-e2e.sh` (`FLINT_E2E_NOBUILD=1`) | terminal 95, vault 125, tunnels 33, paste 24, rdp 70, webgl 20, fullscreen 49, vim 16 | 2 min 6 s |
| `ui/`: `tsc --noEmit`, `npm test` | ok, 141/141 (22 files) | 4 s, 3 s |
| `site/`: `npm test`, `test:e2e`, `build` | 45/45, demo 64/64, 22 pages | 0 s, 12 s, 2 s |
| `cfire build Flint` (the CLI) | ok | 27 s |
| `cfire build Flint`, empty `CFIRE_CACHE_DIR` | ok; the cache stayed empty | 25 s |
| `scripts/build-gui.sh` (page + app) | ok | 53 s |

**0.10 has no build cache:** a build with an empty `CFIRE_CACHE_DIR` takes as long as one
with the usual cache and writes nothing to it, so every build compiles everything (only
the prelude PCH is reused). The new cfire's per-package objects should show here first.

Each suite alone (`scripts/test.sh <dir>`, its own throwaway sshds; every run pays a
fixed ~30 s, so the sum is above the whole run's):

| Suite | cfire tests | Time |
|---|---|---|
| `src/adapters/config` | 134 | 33 s |
| `src/adapters/crypto` | 133 | 33 s |
| `src/adapters/fonts` | 124 | 32 s |
| `src/adapters/ipc` | 136 | 32 s |
| `src/adapters/keychain` | 126 | 35 s |
| `src/adapters/process` | 133 | 37 s |
| `src/adapters/rdp` | 145 | 49 s |
| `src/adapters/serverfs` | 136 | 35 s |
| `src/adapters/ssh` | 164 | 49 s |
| `src/adapters/uievents` | 142 | 44 s |
| `src/adapters/vault` | 174 | 45 s |
| `src/adapters/vaultremote` | 129 | 36 s |
| `src/application` (with `vaultserver`) | 323 + 145 | 1 min 42 s |
| `src/application/vaultserver` | 145 | 37 s |
| `src/domain` | 152 | 38 s |
| `src/drivers/clicmd` | 203 | 49 s |
| `src/drivers/vault-server` | 138 | 36 s |

### Docker (Linux), 2026-11-18

Same commits, `scripts/linux-check.sh` (Debian trixie image, cfire `c5b1d4b` built in it)
on Docker 29.7.2 on the Mac above (11 CPUs, 8 GB to the VM). Each run builds the image's
cfire, the CLI, the app and the server first.

| Check | Result | Time |
|---|---|---|
| Full `scripts/linux-check.sh` (build, tests, cli, gui, serve; stops at serve) | exit 1 | 34 min 40 s |
| ↳ `scripts/test.sh` | 17/17 PASS | |
| ↳ cli-e2e | 494/494 | |
| ↳ gui-e2e (vim skipped under Xvfb) | terminal 96, vault 125, tunnels 33, paste 24, rdp 65, webgl 20, fullscreen 49, multimon 32 | |
| ↳ serve-e2e | **47/224, already red**: the known first-launch failure (ROADMAP §5, "serve-e2e is flaky on Linux"; 47/224 at M42 too). `the app serves the socket` fails after *a first launch*, the window's unlock times out (`timed out waiting for the unlocked tree`) and every later check fails as `locked`. Not rerun (rule 9: known, and only a baseline) | |
| `FLINT_LINUX_STEPS=server,sync` (the steps the full run did not reach) | server-e2e 70/70, sync-e2e 110/110 | 10 min 50 s |

Per-step times inside the container are not printed by `inside.sh`; the totals stand
for now. On the new cfire, serve-e2e at 47/224 is the baseline, and anything else red
there is new.

### Zorin

Before step 4 (see step 0).

### Windows

No old-cfire baseline on the test VM: stock 0.10 has no Windows build, and the port ran
on the patched fork from WSL. Its reference is the last port results in
`docs/windows-port-guide.md` on `windows-port-2` (`d191abd`).

## Step 1 on the Mac (2026-11-18)

| Fact | Detail |
|---|---|
| Release check | **`v0.12.1` tagged** (`71adeb7`, 2026-11-18): `v0.12.0` plus a CI fix (`2802756`, only `release.yml` and a test), so the same compiler. **Still no release**: its run built five archives (Linux x86_64/arm64, macOS x86_64, Windows x86_64/arm64) and failed on **macOS arm64** at the quality gate, on the same TSan-red test as `main` (`busy + waiting are served and the next is 503`, three 200s). Nothing published; `v0.11.0` is still GitHub's latest. So `v0.12.0` built from source, as the owner asked |
| Built | `v0.12.0` = `7b68799` (tag checked after fetch), `make -j10 build` in 23 s, then `./cfire install --prefix ~/.local/opt/cfire-0.12.0`: binary in `bin/`, runtime in `share/cfire/runtime` (`0.12.0 7b68799`). `cfire setup` not run. A checksum of `~/.cfire/runtime` before and after the install matched. The old `cfire` on `PATH` still answers `0.10.0 (c5b1d4b)` |
| `cfire doctor` | 17 passed, 1 optional warning (`em++`, only for `--target=wasm`). Nothing to install: libsodium 1.0.22, sqlcipher 3.54.1, libzstd, sqlite3, OpenSSL 4.1.0, pkg-config, cmake. The PCH cache is now `~/Library/Caches/cfire/pch` (upstream CF-216) |
| `scripts/cfire-next.sh` | Puts `~/.local/opt/cfire-0.12.0/bin` first on `PATH` and pins `CFIRE_RUNTIME_DIR` to its runtime for one command (`CFIRE_NEXT=<prefix>` for another version) |
| `.mcp.json` | `cfire-next` runs `scripts/cfire-next.sh cfire mcp`; its `initialize` answers `cfire-compiler 0.12.0`. The `cfire` server stays on the old binary |
| `main` on 0.10 | `main` (`38d3e3c`) in a fresh worktree: `cfire build` of `Flint`, `FlintVaultServer` and `FlintGui` all ok, no warnings, `flint --version` runs |
| cfire checkout | Left detached at `v0.12.0`. Its local `v0.10.0`/`v0.11.0` tags predate upstream's rewrite (fetch refuses to clobber them); the remote's are `f36e3ac` and `38895b8` |
| **Switched to `v0.12.1`** (later the same day) | The release is **published with all six archives** and `SHA256SUMS.txt` (2026-11-18 14:19 UTC). `v0.12.0..v0.12.1` touches CI (`release.yml`), one test, docs and the version; `runtime/cfire_prelude.hpp` differs only in its `CFIRE_RUNTIME_VERSION` line, so the compiler and runtime are those of step 2. `cfire-v0.12.1-macos-arm64.tar.gz` verified against `SHA256SUMS.txt` (`ce4e34e0…`) and unpacked by hand into `~/.local/opt/cfire-0.12.1` in `install.sh`'s layout (`bin/cfire`, `share/cfire/runtime`, `0.12.1 71adeb7`); no `cfire setup`, no installer. A checksum of `~/.cfire/runtime` before and after matched. `cfire --version`: `0.12.1 (71adeb7)`; `cfire doctor`: 17 passed, the same optional `em++` warning. `scripts/cfire-next.sh` and so the `cfire-next` MCP server (`initialize` answers `0.12.1`) default to it; `CFIRE_NEXT=~/.local/opt/cfire-0.12.0` still reaches the source build, kept until step 7 |

**What `build.cf` gives in place of `@pkg`** (GUIDE Ch3 and Ch11, read in `src/build/manifest.hpp`):

- `build.Executable` takes `PkgConfig`, `Libraries`, `Frameworks` (Apple only, ignored
  elsewhere), `Includes` (paths from `build.cf`'s folder) and `Defines`; top-level
  `build.PkgConfig(...)` / `build.Includes(...)` apply to every target.
- `cfire build <target>` uses the fields of the executable whose `Entry` it builds, so the
  CLI still links neither FreeRDP nor AppKit. **`cfire test` (and a file that is no
  executable's entry) takes the union of every executable's fields**: every suite links
  everything the app does.
- **No per-OS selection in `build.cf`**: its values are literals only, no conditions.
  `Frameworks` covers the Mac's link flags, but Linux's `libsecret-1` and `gtk+-3.0` have
  no place a Mac build skips. Per-OS `.cf` files (`_darwin`, `_linux`, `_unix`) exist for
  sources only.

## Step 2 on the Mac (2026-11-18)

Every package checks and passes on 0.12 (`scripts/cfire-next.sh`, after `. scripts/env.sh`).
The suites that need servers ran under `scripts/test.sh` (throwaway sshds, FreeRDP's
sample server and Flint's RDP test server, a local `flint-vault-server`), so their counts
compare with the baseline's; `vault-server` was migrated before the remaining adapters
for that reason, since `test.sh` builds it first.

| Suite | 0.12 | Baseline | Suite | 0.12 | Baseline |
|---|---|---|---|---|---|
| `domain` | 154 | 152 | `rdp` | 146 | 145 |
| `application` | 324 | 323 | `serverfs` | 137 | 136 |
| `application/vaultserver` | 146 | 145 | `ssh` | 165 | 164 |
| `adapters/config` | 135 | 134 | `uievents` | 143 | 142 |
| `adapters/crypto` | 134 | 133 | `vault` | 175 | 174 |
| `adapters/fonts` | 125 | 124 | `vaultremote` | 130 | 129 |
| `adapters/ipc` | 138 | 136 | `drivers/clicmd` | 204 | 203 |
| `adapters/keychain` | 127 | 126 | `drivers/vault-server` | 139 | 138 |
| `adapters/process` | 134 | 133 | | | |

Every suite runs the tests of the packages it imports, and `domain` gained one in step 2
(`byte_slice`), hence the +1 everywhere; `domain` also gained the negative-seed test and
`ipc` a test that relay frames are cut by byte. Nothing was removed or skipped.
`src/drivers/gui` and `src/drivers/cli` have no tests; both check clean.

The three `cfire build`s: `flint` (CLI, 1 min 20 s cold, 0.4 s with nothing changed:
0.12's per-package cache works), `FlintGui` (`build/gui/Flint.app`, 3 min 51 s cold) and
`flint-vault-server` (14 s). `flint --version` runs. Cold builds are slower than 0.10's
27 s for the CLI; step 3 times the warm ones.

**How 0.12 differs, and what each fix looks like** (bugs in `cfire-upstream.md` CF-151..157):

| On 0.12 | Fix in Flint |
|---|---|
| `s.substr(a, n)` is gone (it was a raw `std::string` member) | `s[a..a + n]`, `s[a..]`. A `str` slice **panics on a bound inside a UTF-8 character**: a cut by byte count or position (caps, byte loops, terminal output, binary data in a `str`) uses `byte_slice` / `byte_tail` (`src/domain/bytes.cf`). A slice also panics past the end, where `substr` clamped: check the bound |
| `index_of` / `last_index_of` return `usize?`, not `i64` with -1 | `x := s.index_of(":") or { return … }`, `if x := s.index_of(":") { … }`, or `or 0` / `or s.len()` where that keeps what "not found" did. Read each site |
| `cfire fix` rewrote `str.replace` (replace-all on 0.10) to `.replace` (first match) | `.replace_all` (CF-151). The other rewrites were probed and keep their meaning |
| `u8(x)`, `usize(x)` panic when the value does not fit (0.10 wrapped) | `% 256` where wrapping was meant; a seed's bits through `seed_bits` (`src/domain/merge_test.cf`) |
| An interface method called on a `mut self` implementer | `mut name(…)` in the interface (`src/ports/ports.cf`) |
| Returning a slice of a local (CF-152) | `str(s[a..b])` |
| Two `for i, x in` loops in one block (CF-153) | another index name in the later one |
| `join` on a `[]str` parameter (CF-154); `json.stringify` of one gives `{}` (CF-157) | `mut own := list` first |
| In an imported package, a builtin method on a value inferred from a parameter's field lowers to a C++ member; a loop item over `param.field` loses its type (CF-156) | a typed local, a function (`join_with`), an index loop, or the field reached directly (`self.bank.blobs`) |
| `str.push`, `char(b)` | `str(bytes)`, with `one: []u8 = [b]` for one byte |
| `(*p).x` on a `shared[T]` | `p.x` |
| `x.has_value()`, `x.value()` | `x != none`, `x or …` |
| `build.cf` top-level `var X =` | `X :=` |
| `byte` is `u8`, a read-only `[]byte` a `slice_ref<u8>` (a `std::span<const u8>`) | native headers take `std::span<const std::uint8_t>` and fill `std::vector<std::uint8_t>`, not `std::byte` |
| A read-only slice or `str` is a const view in a `cpp` block; a `str` has no `.c_str()` (CF-161) | cast the pointer, not the container; `std::string(x).c_str()` for a call, `flint_ssh::CText` where the text is a secret |
| `*mut cpp::T` is rejected (CF-160) | an opaque alias of the pointer, `cpp.flint_ssh::SshSession`, `cpp.flint_db::Db` |
| A stdlib or Flint call takes the coercion of any C++ function of the same last name, program-wide (CF-158) | `str(view)` for each view argument of `fs.rename`/`remove`/`open`; colliding native helpers renamed `native_*` |
| `{name}` interpolates in every string; `{{` is `{` only in an interpolated one (CF-159) | a raw string, `` `%{http_code}` `` |
| A value from `try f[T](…)` keeps the type `T` (CF-162) | call the inner function directly |
| `os.exec_output` of a built string is `cfire/SHELL-INJECTION-RISK` | `os.command(binary, args)` |
| A `str` slice of binary data (a relay frame, an HTTP body, a byte loop on untrusted text) panics on a continuation byte | `byte_slice` / `byte_tail` |

## Step 3 on the Mac (2026-11-18)

Flint `383e5c1` (`cfire-0.12`), cfire **`v0.12.1` `71adeb7`** (the published archive),
the Mac of the baseline, every check through `scripts/cfire-next.sh`. Wall clock, one run
each, nothing else running; "warm" means cfire's caches already hold the build.

| Check | 0.12.1 | Time | Baseline 0.10 |
|---|---|---|---|
| `scripts/test.sh` (17 suites, then release-test), first run on 0.12.1 | 17/17 PASS, release-test 24/24 | 18 min 59 s (compiles every suite cold) | 17/17, 24/24, 7 min 44 s |
| `scripts/test.sh`, warm | 17/17 PASS, release-test 24/24 | 11 min 54 s | |
| `scripts/cli-e2e.sh`, first run (builds the CLI cold) | 483/483 | 7 min 18 s | 483/483, 2 min 51 s |
| `scripts/cli-e2e.sh`, warm | 483/483 | 1 min 52 s | |
| `scripts/server-e2e.sh` | 70/70 | 13 s | 70/70, 19 s |
| `scripts/sync-e2e.sh` | 105/105 | 47 s | 105/105, 1 min 47 s |
| `scripts/build-gui.sh`, warm | ok | 5 s | 53 s |
| `scripts/gui-e2e.sh` (`FLINT_E2E_NOBUILD=1`) | terminal 95, vault 125, tunnels 33, paste 24, rdp 70, webgl 20, fullscreen 49, vim 16 | 2 min 2 s | the same counts, 2 min 6 s |
| `scripts/serve-e2e.sh` | 223/223 | 1 min 9 s | 223/223, 2 min 58 s |
| `ui/`: `tsc --noEmit`, `npm test` | ok, 141/141 (22 files) | 3 s, 1 s | the same, 4 s, 3 s |
| `site/`: `npm test`, `test:e2e`, `build` | 45/45, demo 64/64, 22 pages | 0 s, 10 s, 2 s | the same, 0 s, 12 s, 2 s |

Every count matches the baseline's, or step 2's table for the cfire suites (each at its
step 2 count). Nothing failed, nothing was skipped or rerun to pass.

**Builds.** Truly cold means an empty `CFIRE_CACHE_DIR` **and** no `.cfire/` folders in
`src/`: 0.12 keeps its per-package objects and shards in `<package>/.cfire/` next to the
sources (git-ignored), not in the user cache. Step 2's "1 min 20 s cold" was this cold.

| Build | Cold | Cold, PCH already built | Warm, nothing changed | One edit | 0.10 |
|---|---|---|---|---|---|
| `flint` (CLI) | 1 min 25 s | 1 min 20 s | 0.5 s | 18 s (a new function in `domain` or in `drivers/cli`: 85 s of CPU over 11 cores); 0.4 s for a comment | 27 s, every build |
| `flint-vault-server` | 13 s | 11 s | 0.2 s | | |
| `FlintGui` (the executable) | 3 min 56 s | 3 min 57 s | 0.6 s | | `build-gui.sh` 53 s |

The prelude PCH is a few seconds of a cold build; the rest is compiling. So a build from
nothing is three times 0.10's for the CLI and over four times for the app, and every
build after it is faster than 0.10's ever was: the cost moved to the first build, which
is what a fresh machine, a version bump (the first `test.sh` and `cli-e2e` above) and the
release build pay. Two timings are not understood and were not chased (they are no
failure): the first edit after the cold CLI build took 61 s, later edits 18 s; and the
first `cli-e2e` spent ~5 min 26 s building where a cold build takes 1 min 25 s (it ran
right after the first `test.sh`, with step 2's `.cfire/` folders from 0.12.0 in place).

**Why `test.sh` is slower warm than 0.10 cold (CF-163).** `cfire test` on 0.12 builds at
`-O0 -g` (the DevDebug profile, unless `--release` or `--bench`); 0.10 optimized. One fuzz
test, `the estimate never fails and stays in range` (`src/domain/strength.cf`), rebuilds
the estimator's dictionaries (~93k words, `src/domain/strength_words.cf`) on each of its 200 calls: 32 s at `-O0`, run in each of the 17
suites, **549 s of the warm run's 714**; the estimator's other tests add ~2 min. The same
test alone: ~2.5 s on 0.10, 3.5 s with `cfire test --release` on 0.12.1, 31 s by default.
Found with per-line timestamps on the warm run and `sample` on the test binary (un-inlined
`std::string::size()`). Options for the owner, none applied: pass `--release` in
`scripts/test.sh` (the test mode's UB traps stay on), build the dictionaries once per
process, or fewer `--fuzz-runs` for that block.

## Progress

| Step | Date | Result | Commit |
|---|---|---|---|
| 0 | 2026-11-18 | Mac and Docker baselines on 0.10 `c5b1d4b`: all green but Linux serve-e2e 47/224 (known, ROADMAP §5). Zorin before step 4; the Windows VM still needs autologon, the battery user and a snapshot | `81d5fa0` |
| 1 | 2026-11-18 | `v0.12.0` (`7b68799`) from source in `~/.local/opt/cfire-0.12.0` (no `v0.12.x` release yet: `v0.12.1`'s macOS arm64 build failed); `cfire doctor` 17/17 needed, nothing to install; `scripts/cfire-next.sh` and the `cfire-next` MCP server; `~/.cfire/runtime` untouched; `main` builds its three binaries on 0.10. Then the published `v0.12.1` macOS arm64 archive (`71adeb7`, same compiler and runtime as `v0.12.0`) in `~/.local/opt/cfire-0.12.1`, the default of `cfire-next.sh` and the MCP server from step 3 on | `435858d`; `v0.12.1`: this commit |
| 2 | 2026-11-18 | `cfire fix`, `@pkg` into `build.cf`; every package checks and passes on 0.12, each suite at its baseline count plus the tests step 2 added (table above), nothing skipped; `flint`, `FlintGui` and `flint-vault-server` build; 12 new cfire entries (CF-151..162) | `f1d664b` .. this commit |
| 3 | 2026-11-18 | On `v0.12.1`: `scripts/test.sh` 17/17 and release-test 24/24, cli-e2e 483/483, server-e2e 70/70, sync-e2e 105/105, gui-e2e the baseline's eight counts, serve-e2e 223/223, `ui/` and `site/` green; nothing failed or skipped. Warm, every e2e is faster than 0.10 and builds take under a second; cold builds are 3-4x slower (CLI 1 min 25 s, app 3 min 56 s). `test.sh` warm 11 min 54 s against 7 min 44 s: `cfire test` builds at `-O0` (CF-163), one fuzz test is 549 s of it; the fix waits for the owner | this commit |
