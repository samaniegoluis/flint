#!/bin/bash
# Milestone 25's spike, driven on a Linux desktop in an X11 session: an image paste, a text
# paste (each also read with navigator.clipboard.read() via F9) and a real XDND drop of a
# file into paste-probe.html in WebKit2GTK 4.1. Prints the page's report.
#
#   scripts/paste-probe-x11.sh [image.png]     (run on the Linux box; needs xclip, xdotool,
#                                                python3-gi, gir1.2-webkit2-4.1)
# Over Flint: flint cp the scripts/ files to the box, then
#   flint exec <host> -- 'DISPLAY=:0 XAUTHORITY=/run/user/$UID/gdm/Xauthority bash paste-probe-x11.sh'
set -u
here=$(cd "$(dirname "$0")" && pwd)
img=${1:-$here/../site/src/assets/screens/app-tunnels-dark.png}
[ -f "$img" ] || { echo "no image at $img" >&2; exit 2; }
img=$(cd "$(dirname "$img")" && pwd)/$(basename "$img")
export DISPLAY=${DISPLAY:-:0} GDK_BACKEND=x11
pkill -f paste-probe-gtk.py; pkill -x xclip; sleep 0.5
out=$(mktemp -d)
trap 'pkill -f paste-probe-gtk.py; pkill -f "$out/drag.py"; pkill -x xclip; rm -rf "$out"' EXIT

cat > "$out/drag.py" <<PY
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("Gdk", "3.0")
from gi.repository import Gtk, Gdk
win = Gtk.Window(title="probe drag source"); win.set_default_size(220, 120)
btn = Gtk.Button(label="drag me")
btn.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, [Gtk.TargetEntry.new("text/uri-list", 0, 0)], Gdk.DragAction.COPY)
btn.connect("drag-data-get", lambda w, c, sel, i, t: sel.set_uris(["file://$img"]))
win.add(btn); win.show_all(); Gtk.main()
PY

find_win() { for _ in $(seq 1 20); do w=$(xdotool search --name "$1" 2>/dev/null | head -1); [ -n "$w" ] && { echo "$w"; return; }; sleep 0.5; done; echo "no window: $1" >&2; exit 3; }

python3 "$here/paste-probe-gtk.py" "$here/paste-probe.html" --auto > "$out/report" 2>/dev/null &
w=$(find_win "Flint paste probe"); sleep 2
xdotool windowactivate "$w" 2>/dev/null; sleep 0.5
eval "$(xdotool getwindowgeometry --shell "$w")"; CX=$((X + WIDTH / 2)); CY=$((Y + HEIGHT / 2))
# The drop lands on the left of the report: GNOME centres the drag source over the page.
DX=$((X + 150)); DY=$((CY + 60))
xdotool mousemove $CX $CY click 1; sleep 0.3

xclip -selection clipboard -t image/png -i "$img" & sleep 0.5
xdotool key ctrl+v; sleep 1; xdotool key F9; sleep 1.5; pkill -x xclip
printf 'hello from xclip' | xclip -selection clipboard & sleep 0.5
xdotool key ctrl+v; sleep 1; xdotool key F9; sleep 1.5

python3 "$out/drag.py" & s=$(find_win "probe drag source"); sleep 1
eval "$(xdotool getwindowgeometry --shell "$s")"; SX=$((X + WIDTH / 2)); SY=$((Y + HEIGHT / 2))
xdotool mousemove $SX $SY; sleep 0.3; xdotool mousedown 1; sleep 0.3
for t in $(seq 1 10); do xdotool mousemove $((SX + (DX - SX) * t / 10)) $((SY + (DY - SY) * t / 10)); sleep 0.08; done
sleep 0.4; xdotool mousemove $((DX + 5)) $((DY + 3)); sleep 0.6; xdotool mouseup 1; sleep 1.5

cat "$out/report"
