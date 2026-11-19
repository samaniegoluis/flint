# Flint — v13 Technical Specification: Releases

**Scope of this document:** version 13 only. The versions it builds on are archived in
[`spec-v1.md`](./spec-v1.md) (MVP), [`spec-v2.md`](./spec-v2.md) (daily driver),
[`spec-v3.md`](./spec-v3.md) (Flint holds the vault), [`spec-v4.md`](./spec-v4.md) (Files),
[`spec-v5.md`](./spec-v5.md) (Between servers), [`spec-v6.md`](./spec-v6.md) (Tunnels),
[`spec-v7.md`](./spec-v7.md) (Paste into the terminal), [`spec-v8.md`](./spec-v8.md)
(Embedded RDP), [`spec-v9.md`](./spec-v9.md) (Versions and a faster desktop),
[`spec-v10.md`](./spec-v10.md) (The desktop, finished), [`spec-v11.md`](./spec-v11.md)
(Your vault on every machine) and [`spec-v12.md`](./spec-v12.md) (Toasts); everything
beyond v13 lives in [`ROADMAP.md`](../ROADMAP.md). This file is static: a decision that
changes goes into [`decisions.md`](./decisions.md), which supersedes the line here.

## Problem

v12 shipped (milestones 46-47, `v0.14.0`). Flint has versions, a changelog and a Releases
page on the site (D-077, D-078), but **no published binaries**: the only way to run it is
to build it from source, and the only way to update it is to build it again.

- **macOS:** the `.app` links libssh, libsodium, SQLCipher, OpenSSL and FreeRDP from
  Homebrew, and its executable's minimum macOS is the build machine's (CF-149), so a copy
  taken to another Mac does not open. The CLI lives apart from the app.
- **Linux:** `scripts/install.sh` puts the app in the home folder; approvals use polkit only
  when its policy file is in `/usr/share/polkit-1/actions/`, which nothing installs.
- **Windows:** `windows/package.sh` makes a portable zip, but its folder carries the version
  in its name, so a folder put on `PATH` breaks at the next version.
- **Updating** means noticing a release by hand, downloading it and replacing the files.

v13 ships Flint as **portable, unsigned downloads** built by scripts a person runs on the
Mac, Linux or the Windows VM, then the same scripts in a GitHub Actions workflow on a tag,
then an update notice and a **signed self-update** (Flint's own Ed25519 key) on v12's toast.
Code signing and installers are v14 (D-111): an unsigned download is normal for a young
open-source app, and the owner wants updates working first so every later version,
signed ones included, reaches people on its own.

## Scope

**In scope (v13):**
- **Portable packages, unsigned** (milestones 48-50): macOS `Flint.app` (arm64) in a
  `.zip`; Linux `.deb` and `.rpm` (x86_64); Windows a portable `.zip` (x86_64). Each one
  holds the app **and the CLI**, so one download gives both.
- **The CLI from the package** (48, 50): the app offers *Install the flint command* once,
  on its first launch, in a toast, and in Settings at any time: a link to the CLI inside
  the package (macOS) or the package's folder on the user's `PATH` (Windows). A moved app
  is noticed at launch and the offer comes back. On Linux the package puts `flint` in
  `/usr/bin`.
- **The release workflow** (51): a `v*` tag on `main` → GitHub's hosted runners → a draft
  release with every package, `SHA256SUMS` and the changelog section (D-107 (1)-(3)); the
  site's Download buttons; **funding links** (GitHub Sponsors and Ko-fi: the repo's Sponsor
  button, a README line, the site).
- **The update notice** (52): a manifest checked at launch and once a day (can be turned
  off); designs 24c, 24e, 24f, 24g, 24i on v12's toast.
- **The signed self-update** (53): download, Ed25519 verification, the folder swapped by
  `flint update-apply`, the relaunch confirm 24d; app and CLI updated together.
- Docs site, the landing and the CLI demo follow every user-visible change (CLAUDE.md rules
  5 and 6), and a release closes each milestone with a `feat` or `fix` (rule 10).

**Every system:** each milestone is verified on macOS and the Docker Linux check; the
Windows parts on the Windows VM (`windows/vm/`), and Linux packages on Zorin, as the
milestone needs them.

**Out of scope (v13), tracked in the roadmap:** code signing on macOS (Developer ID,
notarization) and Windows (SignPath), installers (a Windows setup, a macOS `.dmg`),
keychain access lists by signed identity (D-099) and Touch ID: **v14 · Signing and
installers**. Intel Macs, Linux and Windows on arm64 (asked for through an issue, they are
added later). Homebrew, winget, an apt/dnf repository, AppImage. A self-update of a `.deb`
or `.rpm` (the package manager updates them; Flint only says a new version exists). An
update notice in the CLI. Applying an update at the next launch without asking.

## Stack

v12's, plus the pieces that build and update packages.

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **cfire** (→ C++23), pinned to `v0.12.2` (D-105) | Dogfood the friend's language and feed back real gaps. Native speed, a single binary | Go + Wails (Tether's stack, known-good), Rust + Tauri |
| Desktop shell | **cfire `ext:webui`** (WKWebView / WebKitGTK / WebView2) | Wails-like typed RPC + events, native webview, no bundled browser | Electron (heavy), raygui (no rich UI) |
| Frontend | **React + Vite**, CSS Modules + design tokens | Proven in Tether; the frontend is largely portable | Svelte/Solid: no strong reason to switch while the backend is new |
| Toasts | **Flint's own component** (`ui/`, v12) | The update's states are toasts with a key that changes in place | A toast library |
| Terminal | **xterm.js** (pinned beta + WebGL addon) | Kitty keyboard protocol; WebGL renderer fixes cell sizing | — |
| SSH | **libssh** via `import cpp` (D-012) | cfire has no SSH. Covers PTY, SFTP, agent, forwarding and known_hosts | libssh2, writing SSH ourselves |
| RDP | **FreeRDP 3** via `import cpp`, core library only (D-070) | One engine on macOS, Linux and Windows; Apache 2.0 | The RDP ActiveX control, the system client |
| Crypto | **libsodium**: Argon2id + XChaCha20-Poly1305; **Ed25519** (`crypto_sign_verify_detached`) for updates | Vetted, constant-time; already linked by the app and the CLI | cfire `core:crypto`, minisign/signify as a second dependency |
| Vault store | **SQLite, whole-file encrypted** with SQLCipher (D-013) | Queryable and transactional. No plaintext metadata on a synced disk | Per-field encryption, a KeePass-style blob |
| Activity store | **A second SQLCipher file per machine** (D-092) | The one table that grows with use | A plain log file, keeping it in the vault |
| Keychain | macOS Security.framework, Linux libsecret, Windows Credential Manager | *Remember on this computer* (D-048) and the server token | Storing either in a file |
| HTTP client | **libcurl** (`adapters/vaultremote/`, M43), reused for the manifest and the download | Already linked, with timeouts and size caps | A second HTTP stack |
| Sync server | **`flint-vault-server`**, cfire on `core:net/http` (D-050, D-092) | Same language and toolchain, same repo | A repo of its own |
| Packages | **macOS:** the `.app` with its libraries inside (rpath), zipped; **Linux:** `nfpm` (`.deb`, `.rpm`); **Windows:** the existing portable zip | Plain archives a person can open; `nfpm` writes both Linux formats from one config with no distro tooling | Installers before signing (D-111), AppImage, Flatpak, a `.dmg` |
| Release CI | **GitHub Actions, hosted runners**, calling the same scripts (D-107) | Free for a public repo; a failure reproducible on the owner's machines | Logic in YAML, self-hosted runners |
| Updater | **Flint's own**: a signed manifest, `flint update-apply` swapping the folder | One binary on every system, testable with `cfire test`; the app and the CLI move together | Sparkle (macOS only), Squirrel, a shell or PowerShell script per system |
| Docs | **Astro + Starlight** | Landing and Docs in one site | Docusaurus, VitePress |
| Changelog | **git-cliff**, run locally | Reads the Conventional Commits already in use | release-please, semantic-release |

## Architecture

Hexagonal, as in v12. v13 adds packaging scripts, a workflow, and one use case with its
ports.

- **Packages are folders.** macOS `Flint.app/Contents/{MacOS/{Flint,flint},Frameworks,
  Resources}`; Windows `Flint\{flint-app.exe,flint.exe,ui\,…}` (the version only in the
  zip's name); Linux the files the `.deb`/`.rpm` place (`/usr/bin/flint`,
  `/usr/lib/flint/`, the `.desktop` file, the icon, the polkit policy). Each package
  carries a small `install-kind` file (`portable` or `package`) the app reads to know
  whether it can update itself.
- **`scripts/package.sh <macos|linux|windows>`** builds one system's packages into `dist/`
  and prints each file's SHA-256. It has no secret and needs none; the workflow calls it
  and nothing else does the building.
- **The update use case** (`application/update.cf`) over two ports: `UpdateFeed` (GET the
  manifest and its signature; download a package, both through libcurl, with timeouts and
  size caps) and `UpdateVerifier` (Ed25519 through libsodium, the public key compiled in).
  It decides: newer or not, which asset fits this system and install kind, verified or
  discarded (D-106 (5)).
- **The manifest** is a release asset, `manifest.json` with `manifest.json.sig`, reached at
  `releases/latest/download/…`, so only a published (not draft) release is ever offered. It
  names the version, the notes, and per asset (`macos-arm64`, `windows-x86_64`,
  `linux-x86_64-deb`, `linux-x86_64-rpm`) a URL, a size and a SHA-256. The workflow signs
  it with a key held in its `release` environment.
- **Applying an update:** the app unpacks the verified package **beside** the installed
  folder (same volume, so a rename is atomic), copies the new `flint` binary out to a
  temporary folder, starts it as `flint update-apply --wait <pid> --from <new> --to
  <installed>` and quits. That process waits for the app to exit (and for any `flint`
  running from the folder), renames the installed folder aside, renames the new one into
  place, starts the app, and removes the old folder once the new app reports it started;
  otherwise it renames the old one back. A running program cannot replace its own files on
  Windows, but a copy of it running from elsewhere can; macOS and Linux behave the same
  way, so there is one path.
- **The page** shows the update with v12's toast (`key: 'update'`, changing in place), the
  status bar's version item, About's Updates block and What's new.

Contracts (v12's stand, plus):
- **Nothing downloaded is applied unverified.** The manifest's signature is checked before
  it is read, and the package's SHA-256 (from the verified manifest) before it is
  unpacked.
- **The person decides.** Download and Relaunch are theirs; ✕ only hides a toast (D-111).
- **No telemetry.** The check is one GET of the manifest; nothing about the machine or its
  use is sent (D-107 (5)).

## Principles

Checkable rules. Every milestone is checked against them before it is closed. Rules marked
**(owner review)** stop `lean-build` for the owner whenever a diff touches them. v12's,
plus 15 and 16.

1. The domain and application layers import no adapter and no I/O module (`ext:webui`,
   `ext:db/sqlite`, sockets, HTTP, keychain, files).
2. No business logic in drivers: a GUI binding, socket handler, HTTP handler or CLI command
   body only parses input, calls one use case and formats output.
3. Native C++ appears only inside `adapters/`, and each block carries
   `// CFIRE-UPSTREAM: CF-NNN` with a matching entry in `docs/cfire-upstream.md`.
4. **(owner review)** No hand-rolled cryptography. Key derivation, AEAD, hashing of tokens,
   signatures and random secrets go through libsodium only.
5. **(owner review)** The vault file on disk is encrypted in full. No hostname, user or label
   from inside a vault is ever written in clear text, including in logs. (The recent-vaults
   list keeps each vault's file path and name in clear, D-021.) The vault schema and file
   format change only through an appended migration. The per-machine activity file is
   encrypted in full the same way.
6. **(owner review)** Secret values never appear in RPC results, socket responses, CLI
   output (`--json` included), logs or error messages. **One exception (D-029):** the GUI's
   explicit *reveal* action on a password, while the vault is unlocked, returns that one
   value to the page. *Copy* never does: the core writes it to the clipboard itself. The
   CLI has no reveal. A token's secret is shown once, at creation, to whoever created it.
   The server token is a secret under this rule.
7. Every CLI command supports `--json`, writes data to stdout and diagnostics to stderr, and
   exits non-zero with a stable error code on failure.
8. Every network operation (dial, auth, exec, SFTP request, forward channel open, RDP
   connect and reconnect, every sync request, the update check and download) and every
   socket and HTTP request the server handles has an explicit timeout.
9. Every user-visible change updates the docs site (`site/`) in the same commit.
10. Schema migrations are append-only. An applied migration is never edited or reordered.
11. **(owner review)** The CLI never opens a vault with a key it did not derive from a
    master password typed for that command: it goes through the app's socket, or the
    person types the password. The socket is mode 0600 in the config folder, and a peer
    whose uid differs from the app's is refused before any request is read.
12. Every request on the socket is checked against a live grant or token before its use case
    runs. A privileged step (`--sudo`) is approved one by one, never by a grant.
13. **(owner review)** The sync server never receives a key, a master password or anything
    decrypted: its API carries only the encrypted vault file, a version, the vault id, the
    bearer token and an optional label the person chose, which the server keeps in clear
    and never logs (D-103). It never logs a blob or a token, compares the token in constant
    time through libsodium, refuses to start with a weak one, and caps request size and
    rate.
14. A sync never loses a change: the client never overwrites its local copy with a
    downloaded one, and never uploads over a version it has not merged. Plain `http://` is
    refused for any server other than `localhost`.
15. **(owner review)** An update is applied only after the manifest's Ed25519 signature
    verifies against the public key compiled into Flint and the package's SHA-256 matches
    the verified manifest; a failure discards the download and is never retried from the
    toast (D-106 (5)). The update check sends one GET and nothing else, can be turned off,
    and never restarts Flint without the person's Relaunch. The signing key's secret lives
    only in the workflow's `release` environment and the owner's Infisical, never in the
    repository, a log or a package.
16. The packaging scripts hold all the build logic and read no secret: the workflow only
    installs the pinned cfire and calls them, so every package can be rebuilt by a person
    on the Mac, Linux or the Windows VM (D-107 (2)). User data never lives in the
    package's folder.

## Milestones

Each milestone is built **whole** with `lean-build` and verified by the agent. Owner checks
happen only where a human is required (see `CLAUDE.md`). Progress is recorded in
`docs/build-log.md`, not here. Numbering continues from v12.

| # | Milestone | Delivers |
|---|---|---|
| 48 | **macOS: a portable `Flint.app`** | `scripts/package.sh macos` → `dist/Flint-<version>-macos-arm64.zip`. libssh, libsodium, SQLCipher, OpenSSL and FreeRDP copied into `Contents/Frameworks` with their install names rewritten (rpath), no path to Homebrew left (`otool -L` checked by the script); a deployment target matching `LSMinimumSystemVersion` for the app and the libraries (CF-149); ad-hoc signed as today; the `flint` CLI inside `Contents/MacOS`, linking the same libraries. **The CLI from the package:** *Install the flint command* offered once in a toast on the first launch and in Settings at any time: a link in `~/.local/bin` (or `/usr/local/bin` when chosen) to the CLI inside the app, told when that folder is not on `PATH`; a link left pointing at a moved or missing app is noticed at launch and the offer comes back. The `install-kind` file. Verified: the zip opened on a Mac with no Homebrew libraries on the loader's path (a clean user or a renamed prefix), the app and the linked CLI both run, the release suites; docs (*Install* for macOS, Gatekeeper's *Open anyway* for an unsigned app, the CLI link) |
| 49 | **Linux: `.deb` and `.rpm`** | `scripts/package.sh linux` with `nfpm`, built in Docker on the oldest base that has FreeRDP 3 and WebKitGTK 4.1 (or FreeRDP bundled into `/usr/lib/flint/` if none does; decided at plan time by a spike) → `flint_<version>_amd64.deb`, `flint-<version>.x86_64.rpm`. `/usr/bin/flint`, the app under `/usr/lib/flint/`, a `.desktop` file with the icon (ROADMAP §7), the polkit policy in `/usr/share/polkit-1/actions/`, dependencies declared per format. `install-kind` = `package`. Verified: installed, run and removed in clean containers of Ubuntu, Debian and Fedora, and installed on Zorin; docs (*Install* for Linux) |
| 50 | **Windows: the portable zip, finished** | `scripts/package.sh windows` (over `windows/package.sh`) → `Flint-<version>-windows-x86_64.zip` holding one folder `Flint\` with no version in its name; third-party notices; one app name; WebView2 checked at launch with a clear message and the download link when it is missing. **The CLI from the package:** *Add flint to PATH* offered as on macOS (the folder on the user's `PATH`, no admin), and noticed when the folder moved. `install-kind` = `portable`; `install.ps1` stays until v14's installer. Verified on the Windows VM: the zip unpacked anywhere runs, the PATH offer works in a new shell; docs (*Install* for Windows, SmartScreen's *Run anyway*) |
| 51 | **The release workflow** | `.github/workflows/release.yml` on a `v*` tag: a guard step (the tag's commit is on `main`), a job per system on hosted runners (`macos-14` arm64, `ubuntu`, `windows`) installing the pinned cfire and calling `scripts/package.sh`, then a **draft** release with every package, `SHA256SUMS` and the version's changelog section (from the tag's message and `CHANGELOG.md`). The site's `/releases` page gets **Download** buttons that pick the visitor's system. **Funding:** `.github/FUNDING.yml` (GitHub Sponsors, Ko-fi), a README line and a link on the site; passive only. Verified: a pre-release tag run end to end on GitHub, its packages downloaded and opened on the Mac, the VM and Zorin; docs (*Releases*, *Install*) |
| 52 | **The update notice** | The manifest (`manifest.json`, `manifest.json.sig`) added to the workflow, signed with the `release` environment's key (`scripts/sign-manifest.sh`, also runnable by hand). `application/update.cf` with `UpdateFeed` and `UpdateVerifier`: checked at launch and once a day, a setting to turn it off; a newer version shown with the toast 24c (*Flint 0.15.0 is available* · **Download** in ember, or **How to update** for a `.deb`/`.rpm` or a folder Flint cannot write), the status bar's version item 24f, About's Updates block 24e with *Check now*, the palette's commands 24i, and **What's new** 24g once per version after an update. Verified: `cfire test` (signature good, bad, wrong key, older version, the asset per system and install kind), a local manifest server in gui-e2e; docs (*Updates*, the security model's update section) |
| 53 | **The signed self-update** | **Download:** progress in the toast (`key: 'update'`) and in the status bar item; ✕ hides the toast and the download goes on; when it finishes, a sticky *Ready* toast with **Relaunch**. A package whose SHA-256 does not match is discarded (D-106 (5)). **Relaunch:** 24d asks first when sessions or tunnels are open; the package unpacked beside the installed folder; `flint update-apply` (from a temporary copy) waits for the app and any `flint` from the folder, swaps the folders, starts the new app and removes the old folder once it started, or puts it back. ✕ on *Ready* applies nothing; the status bar item and About keep **Relaunch** (D-111). macOS `.app` and the Windows folder; a folder Flint cannot write gets *How to update*. Verified: `cfire test` of `update-apply` (swap, rollback, a held file on Windows), an end-to-end update from one local build to the next on macOS, the VM and Linux (portable test layout), the keychain prompt after an unsigned macOS update documented; docs (*Updates*) |

## Open questions

None open at the start. Settled with the owner on 2026-11-19 (D-111):

- **Portable and unsigned first**; installers and code signing in v14.
- **The CLI** inside every package, offered once and never linked without asking.
- **✕** on *Downloading* hides; ✕ on *Ready* applies nothing (no update at the next launch).
- **Keychain prompts** after each unsigned macOS update are accepted until v14.
- **macOS arm64, Linux and Windows x86_64** only.
- **Funding** ships with the release workflow.

**At milestone 51 (with the owner):** the GitHub Sponsors and Ko-fi accounts, set up together when the milestone starts (the owner has not used either). **During
milestone 52:** an Ed25519 key pair made with the script the milestone adds; the owner puts
its secret in Infisical (folder `/flint`, name `FLINT_UPDATE_SIGNING_KEY`) and in the
repo's `release` environment, and its public key is committed.
