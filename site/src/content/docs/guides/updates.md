---
title: Updates
description: How Flint tells you a new version is out, downloads and checks it, and relaunches into it when you say so.
---

Flint checks for a new version on its own and tells you when one is out. It downloads
it when you choose **Download**, checks it, and relaunches into it only when you choose
**Relaunch**. The app and the `flint` command update together.

## When Flint checks

At launch, and then every hour while it runs, Flint fetches one small file from Flint's
latest release on GitHub: `manifest.json` and its signature. That is the whole check.
Nothing about you, your vaults or this computer is sent, and no other request is made.

Turn it off in **Settings → About → Updates → Check for updates automatically**. You can
still check by hand from there, from the version in the status bar, or with **Check for
updates** in the command palette (<kbd>⌘K</kbd>).

## When a new version is out

- **A notification**: *Flint 0.18.0 is available*, with **Download** (or **How to
  update**, below). It shows once per version; closing it does not lose the update.
  When the version's panel or **Settings → About** is open, it already says so with its
  own button, so no notification comes on top of it.
- **The status bar**: **Update** appears beside the version and stays until you update.
  Clicking it does what the notification's button does. Clicking the version opens a
  small panel with what is available, **Check now**, **What's new** and **About Flint**.
- **Settings → About → Updates** says the same, with when Flint last checked.

## Download and relaunch

1. **Download.** The notification turns into *Downloading Flint 0.18.0* with its
   percentage, and the status bar counts it too. Closing the notification only hides
   it: the download goes on.
2. **Checked before anything else.** When it finishes, Flint checks the file against
   the SHA-256 the signed manifest gives for it. A file that does not match is deleted
   at once: *Flint 0.18.0 didn't pass verification and was discarded*. Nothing was
   installed, and Flint does not try again on its own. A download that fails on the way
   (no connection, a stalled transfer) offers **Retry**.
3. **Ready.** *Flint 0.18.0 is ready*, with **Relaunch**. It stays until you choose. If
   you close it, nothing happens at the next launch either: **Relaunch** stays in the
   status bar and in **Settings → About**.
4. **Relaunch.** With sessions or tunnels open, or a `flint` command running through
   Flint (a `flint exec` or `connect` from a terminal or an agent), Flint asks first:
   *3 sessions and 2 tunnels will close. 1 running flint command will stop.* Then it quits, the new version takes the old one's place, and
   the new Flint opens. Your vaults and settings live in your user folder, so they stay.
   On macOS the `flint` command is a link into the app, and on Windows the `Flint\bin`
   folder on your `PATH` is inside the new folder, so it is the new one too.

When Flint quits, for an update or otherwise, a `flint exec` or `connect` still running
through it gets five seconds to finish and is then stopped; the command reports that
Flint went away (exit code 10). If the new version does not start, Flint puts the old
one back and opens it, and says so. If the old Flint takes more than ten minutes to quit,
nothing is changed and Flint says so the next time it opens, with the download kept. If a `flint` command is still running from the app when you relaunch (a long `flint
exec`, say), Flint waits for it for half a minute, then opens the old version again and
keeps the download, so you can choose **Relaunch** once it ends.

**macOS:** an update downloaded by Flint carries no download flag, so Gatekeeper does
not stop it as it did the zip from your browser (no **Open Anyway** this time). But an
unsigned Flint is a new app to macOS after each update, so the Keychain asks once more
for the vault you keep with *Remember on this computer* and for a vault server's token:
choose **Always Allow**. Signed builds, which keep that permission, are planned.

**Windows:** the whole `Flint` folder is replaced, by renaming it, never by writing over
a file in use. A program that keeps a file in it open (a terminal whose current folder is
inside it, an Explorer preview) stops that: Flint tries for ten seconds, then leaves
everything as it was, opens the old version, keeps the download and says which programs
hold the folder, as Windows' Restart Manager reports them (*close Windows PowerShell (pid
4120) and Relaunch again*); close them and choose **Relaunch** again. When Windows cannot
tell, the message says *a program has a file in Flint open*. Up to version 0.30.0, Flint itself held
its folder this way when it was opened from its Start menu shortcut (or any shortcut
that starts it in its own folder), so **Relaunch** failed every time with *a program has
a file in Flint open*. The fix is in the new version's own updater, so from 0.29.0 or
0.30.0 a **Relaunch** to 0.30.1 or later works with no step of yours. An update
downloaded by Flint carries no download mark, so SmartScreen does not ask again.

**Linux (`.deb` and `.rpm`):** a package's files belong to the system, not to you, so
the package manager installs the update, as it installed Flint. Flint downloads the new
package into `~/.cache/flint/update/`, with the signed manifest beside it. **Relaunch**
asks for your system password (*Flint needs the system password to install its
update*), every time. Then a small helper inside the package,
`/usr/lib/flint/flint-update-root`, copies the files where only the system can change
them, checks that copy again (the signature, the SHA-256, and that the version is newer
than the one installed) and has `apt` or `dnf` install it, exactly as
`sudo apt install ./flint_<version>_amd64.deb` would: removing Flint later still works
the usual way. Then the old Flint quits and the new one opens.

- **Cancel the password** and nothing is installed; the download stays, so **Relaunch**
  can ask again.
- **`apt` or `dnf` fails** (another update is running, say) and Flint says why and keeps
  the download.
- **The second check fails** and the download is deleted: *didn't pass verification*.
- There is no going back to the old version on its own: if the new one does not open,
  Flint says so the next time it opens.

This works from the first version that has it (0.21.0): a Flint installed from a package
before that shows **How to update**, so install the new package by hand once.

Applying an update is the job of `flint update-apply`, which the app starts from a copy
of the new version's `flint`; it is not a command you type.

## How to update

Some copies cannot replace themselves. For them the notification offers **How to
update**, which opens **Settings → About** with what to do:

| Your copy | How it updates |
|---|---|
| A `.deb` or `.rpm` from a package repository | Your system's updater installs it (Flint shows the command, with **Copy**: `sudo apt update && sudo apt install --only-upgrade flint`, or `sudo dnf upgrade flint`). Flint has no repository yet; a package installed from a file updates itself, above |
| A `.deb` or `.rpm` before 0.21.0 | Download the new package from the release page and install it the same way (`sudo apt install ./flint_<version>_amd64.deb`, `sudo dnf install ./flint-<version>.x86_64.rpm`) |
| Built from source | Pull the new version and build it again ([Build from source](/start/build-from-source/)) |
| In a folder you can't write | Download the new version from the release page and replace the copy |
| A system with no package yet | Build from source, or watch the release page for one |

## What's new

After an update, the first time you open your vault Flint shows **What's new**: every
version since the one you had, newest first, from the changelog inside the app. Open it
again from **Settings → About**, the version in the status bar, or **What's new in Flint**
in the command palette. The full history is in the
[changelog](https://github.com/samaniegoluis/flint/blob/main/CHANGELOG.md).

## Why the check can be trusted

Every release's manifest is signed with Flint's own Ed25519 key, and Flint carries the
public half inside it. A manifest whose signature does not verify is ignored before
Flint reads it, and one that names anything but this project's own releases is refused.
The package is checked against the manifest's SHA-256 before it is unpacked. On Linux,
where installing takes the system's password, the system checks it all again on its own
copy before the package manager sees it. Details in the
[security model](/reference/security-model/#updates).
