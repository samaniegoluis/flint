---
title: Alerts on your phone
description: A content-free alert on your phone when an agent waits for you, through ntfy.
---

An agent that needs your approval, or finds the vault locked, waits for you in Flint's
window ([How long Flint waits](/guides/ai-agents/#how-long-flint-waits)). Away from the
desk, nobody sees that window. Flint can tell your phone, through
[ntfy](https://ntfy.sh): an open-source push app for iOS and Android that needs no
account.

The alert only says *come back*. It carries nothing about the request, and nothing on the
phone can answer it: you still approve or unlock at the machine.

## Turn it on

Alerts are **off** until you turn them on, in **Settings → Notifications → Phone alerts**.

1. Install **ntfy** on your phone (App Store, Google Play or F-Droid).
2. Turn **Phone alerts** on. Flint makes a random topic for this machine
   (`flint-` and 24 letters and digits) and shows it with a QR code and a link.
3. Pick your phone above the code, **iPhone** or **Android** (kept on this computer):
   - **Android:** scan the code with the camera. It is an `ntfy://` link: the ntfy app
     opens and subscribes to the topic, named *Flint*. On a plain `http://` server the
     link says so (`secure=false`).
   - **iPhone:** in ntfy, tap **+** and subscribe to the topic (Copy puts it on the
     clipboard; on the default server, the topic is all you type). Scanning the code
     opens the topic's page on the ntfy website, which shows alerts only while it is
     open: the iOS app does not take a subscription from a link yet.
4. **Send test**: the phone gets *Test from Flint*. The line under it says when the test
   went out, or why it did not.

With the [approval wait](/guides/ai-agents/#how-long-flint-waits) at 2 minutes, the
section suggests 5 minutes or more: time to see the alert and come back. The wait is in
the same section.

## What arrives

Two alerts, with the title *Flint*:

| Alert | When | ntfy priority |
|---|---|---|
| *An agent is waiting for your approval* | A program asks for approval (a grant, a root command, a token, a copy, a tunnel) | default |
| *Flint is locked and an agent is waiting* | A command finds the vault locked and waits for you to unlock it | high |

Each request sends at most one alert, when it starts waiting. None is sent while you are at
Flint's window: when the window has the focus and you pressed a key or used the mouse in it
in the last minute. (The focus alone is not enough: a Flint left in front of a screen that
then locked still has it.) A second command that finds Flint already asking for the unlock
sends nothing more.

An approval that timed out after an alert is marked **Missed · alerted** in the activity
log (**Settings → Access**), so you can see how many you missed away from the desk.

## What never leaves the machine

An alert names no host, user, command, program, vault and no count: only one of the two
texts above. Nothing it carries can approve, deny or unlock anything, and nothing is sent
unless you turned alerts on. See the [security model](/reference/security-model/#alerts-on-your-phone).

Anyone who knows the topic can subscribe to it and see those two texts, or send alerts to
your phone; they can never read anything else. The topic is long and random for that
reason. **New topic** makes another one; the phone stops getting alerts until you
subscribe to the new one.

## Your own ntfy server

**Server** is `https://ntfy.sh` by default. A self-hosted ntfy works the same: put its
address there and subscribe the phone to the topic on that server. A plain `http://`
address is allowed for a server on your own network; the topic then travels unencrypted.

## When an alert is not sent

Each alert is one request with a deadline (10 seconds to connect, 15 in all) and is never
retried. If it fails (no network, the server refused it), the request it was about goes on
waiting as usual, and **Settings → Notifications** shows the last error: *Last alert
couldn't be sent · 10:42 · couldn't reach ntfy.sh*.

The topic belongs to this machine: it is not in the vault and does not sync. Each machine
running Flint has its own, and the phone can subscribe to several.
