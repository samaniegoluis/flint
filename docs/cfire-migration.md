# Moving Flint to the new cfire

A working plan, not a spec. It orders the move off cfire `c5b1d4b` (0.10.0, D-060) onto
the next cfire release so that it happens one step at a time, with every step green
before the next. It can be deleted when the move closes (step 7); what must outlive it
goes into `decisions.md`, `cfire-upstream.md` and the Windows port guide.

Facts below were read on 2026-11-17 from a clone of `gsandoval/cfire` at `2d830cd`
(not installed anywhere). Re-read them when the release this plan targets is out.

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

## Rules for the move

1. **One target.** The release with a Windows archive (the first tag after `v0.11.0`
   that uses the 6-target pipeline). Not `main` at a commit, not the fork with our
   patches. If the owner chooses to start before that tag, do steps 1-4 on the
   macOS archive of the newest tag and redo nothing later but the version bump.
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
- The baseline on the old cfire: every check, on every host, with its numbers.

### 1. Install the new cfire beside the old one (Mac)

- The release's macOS archive in `~/.local/opt/cfire-<version>`; `cfire --version`,
  `cfire doctor`.
- `scripts/cfire-next.sh` on the branch: puts it first on `PATH` for one command.
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

## Progress

| Step | Date | Result | Commit |
|---|---|---|---|
| — | | | |
