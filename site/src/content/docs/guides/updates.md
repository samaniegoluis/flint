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
4. **Relaunch.** With sessions or tunnels open, Flint asks first: *3 sessions and 2
   tunnels will close*. Then it quits, the new version takes the old one's place, and
   the new Flint opens. Your vaults and settings live in your user folder, so they stay.
   On macOS the `flint` command is a link into the app, so it is the new one too.

If the new version does not start, Flint puts the old one back and opens it, and says
so. If a `flint` command is still running from the app when you relaunch (a long `flint
exec`, say), Flint waits for it for half a minute, then opens the old version again and
keeps the download, so you can choose **Relaunch** once it ends.

**macOS:** an unsigned Flint is a new app to macOS after each update, so two things
come back once. Gatekeeper stops its first launch: open **System Settings → Privacy &
Security** and choose **Open Anyway**. Then the Keychain asks again for the vault you
keep with *Remember on this computer* and for a vault server's token: choose **Always
Allow**. Signed builds, which keep both, are planned.

Applying an update is the job of `flint update-apply`, which the app starts from a copy
of the new version's `flint`; it is not a command you type.

## How to update

Some copies cannot replace themselves. For them the notification offers **How to
update**, which opens **Settings → About** with what to do:

| Your copy | How it updates |
|---|---|
| A `.deb` or `.rpm` package | Download the new package from the release page and install it the same way |
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
The package is checked against the manifest's SHA-256 before it is unpacked. Details in
the [security model](/reference/security-model/#updates).
