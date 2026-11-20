---
title: Updates
description: How Flint tells you a new version is out, what the check sends, and how to update each kind of install.
---

Flint checks for a new version on its own and tells you when one is out. It never
updates itself or restarts without you: you choose when to download and install.

## When Flint checks

At launch, and then every hour while it runs, Flint fetches one small file from Flint's
latest release on GitHub: `manifest.json` and its signature. That is the whole check.
Nothing about you, your vaults or this computer is sent, and no other request is made.

Turn it off in **Settings → About → Updates → Check for updates automatically**. You can
still check by hand from there, from the version in the status bar, or with **Check for
updates** in the command palette (<kbd>⌘K</kbd>).

## When a new version is out

- **A notification**: *Flint 0.17.0 is available*, with **Download** (or **How to
  update**, below). It shows once per version; closing it does not lose the update.
- **The status bar**: **Update** appears beside the version and stays until you update.
  Clicking it does what the notification's button does. Clicking the version opens a
  small panel with what is available, **Check now**, **What's new** and **About Flint**.
- **Settings → About → Updates** says the same, with when Flint last checked.

**Download** opens the release's page, where the package for your system is. Replace
your copy with the new one, as when you [installed it](/start/install/): your vaults and
settings live in your user folder, so they stay. On macOS the `flint` command is a link
into the app, so it updates with it.

Downloading and installing from inside Flint, with a relaunch when you say so, is the
next step.

## How to update

Some copies are not replaced by downloading a package. For them the notification offers
**How to update**, which opens **Settings → About** with what to do:

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
Details in the [security model](/reference/security-model/#updates).
