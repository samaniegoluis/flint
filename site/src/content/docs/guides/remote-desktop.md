---
title: Remote desktop
description: Open a Windows machine's desktop in a Flint tab, with the login from the vault, its certificate trusted on first use, and the keyboard and mouse sent to it.
---

An [RDP host](/guides/hosts/#remote-desktop-rdp-hosts) opens in a tab of its own, next to
your SSH tabs: the Windows desktop, signed in with the login saved in the vault. Flint
speaks RDP through [FreeRDP](https://www.freerdp.com/) 3 on macOS and Linux; nothing else
needs to be installed on the Windows side but Remote Desktop itself.

## Open one

Double-click the host in the sidebar, press <kbd>↵</kbd> on it, pick it in the palette
(<kbd>⌘K</kbd>), or from a terminal:

```sh
flint connect win-01
```

The CLI never shows a desktop: with Flint open and the vault unlocked, it asks Flint to
open the tab (under the same [approval](/guides/ai-agents/#approve-a-program) as an SSH
`connect`), prints `Opened win-01 in Flint (remote desktop).` and exits 0. With no Flint
serving the vault it fails with `wrong_host_type` (exit 23) and says to open Flint first.

The tab shows the connection's progress and how long it may take (30 seconds), with
**Cancel** (<kbd>esc</kbd>). A host with no saved password asks for one, for that
connection only.

## The certificate

The first time, Flint shows the server's certificate before it signs in: its subject,
issuer, validity and the SHA-256 fingerprint. A self-signed certificate is the normal case
for a Windows machine or a VM, and is marked so. To compare the fingerprint, run this in
PowerShell on the server:

```powershell
$c = Get-ChildItem 'Cert:\LocalMachine\Remote Desktop'
[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData))
```

**Trust and connect** keeps it in the vault, beside SSH host keys (Settings → Vault →
Known hosts, or `flint known-host list`, as `rdp://<address>:<port>`), and later
connections go straight in.

A **changed** certificate stops the connection before any password is sent, and there is
no button to continue. It happens when Windows renews its certificate or a VM is rebuilt,
but also when someone sits in the middle. If you know why it changed, forget the old one
in **Known hosts** (or `flint known-host rm win-01`) and connect again: you are asked to
verify it as on a first connection.

## In the tab

The desktop is drawn at the size of the tab and follows it: make the window bigger, or
hide the sidebar (<kbd>⌘B</kbd>), and Windows gets the new size. A server with Display
Control (Windows 8 and Server 2012 on) resizes in place; an older one, or another RDP
server without it, is reconnected at the new size, back to the same Windows session. If
it cannot follow, the desktop is scaled down to fit and letterboxed.

The toolbar shows the host, the user, the desktop's size and, when it is scaled, by how
much. **Disconnect** ends the connection and keeps the tab: your Windows session keeps
running on the server, and **Connect again** brings you back to it.

### Keyboard and mouse

Keys go to Windows by their place on the keyboard, and Windows reads them with **your**
keyboard layout, which Flint hands to the server when it connects (on macOS, the input
source in use; on Linux, the X keyboard map or the locale). Dead keys and <kbd>AltGr</kbd>
work as on the remote.

Almost every key belongs to the remote desktop:

- On macOS <kbd>⌘</kbd> is sent as <kbd>Ctrl</kbd>, as Microsoft's Windows App does:
  <kbd>⌘C</kbd>, <kbd>⌘V</kbd>, <kbd>⌘Z</kbd> and <kbd>⌘W</kbd> act on Windows.
- Flint keeps only the palette (<kbd>⌘K</kbd>, <kbd>Ctrl+Shift+K</kbd> on Linux) and the
  tab switches (<kbd>⌘1</kbd> … <kbd>⌘9</kbd>). Everything else Flint does is in the
  palette and the toolbar. <kbd>⌘Q</kbd> and <kbd>⌘Tab</kbd> stay with macOS.

The mouse, its buttons and the wheel (vertical and horizontal) go to the desktop.

A remote desktop tab has no split panes, and the Files view, tunnels and **Open in a new
pane** are for SSH hosts: the palette shows them greyed with *SSH hosts only*.

## When it does not connect

The tab says why, with **Retry** (<kbd>↵</kbd>), **Edit host** and **Close tab**:

| The tab says | What happened |
|---|---|
| Wrong user or password | Windows refused the login. Several wrong tries can lock the account |
| Can't reach … | No route to the address: a VPN that is not connected, a wrong address. The first line of the host's notes is shown, a good place for "office VPN" |
| … didn't answer | Nothing came back within 30 seconds: the machine is asleep or off, or a firewall drops RDP |
| … refused the session: nothing answers on its Remote Desktop port | Remote Desktop is off (Settings → System → Remote Desktop; Windows Home has none) or a firewall rejects it |
| … refused the session | The server answered and would not open one: all its sessions are in use (Windows 10/11 Pro allows one at a time) |
| The certificate … has changed | See [The certificate](#the-certificate) |
| Connection lost | The connection dropped. Your Windows session keeps running for a while; **Connect again** brings it back |

## Locking

Locking the vault (or Flint locking itself when idle, or with the screen) leaves an open
remote desktop running behind the lock screen, as SSH sessions do: the session holds no
key of the vault, and Flint wipes the password from FreeRDP's memory once it is signed in.
Typing into it waits until you unlock. A new connection, or a reconnect to follow a new
size, needs the vault unlocked.

## Not yet

Copy and paste between the desktop and this computer comes next. Full screen, sound, drive
and printer redirection, several monitors, RD Gateway and RDP through an SSH tunnel are
planned for later.
