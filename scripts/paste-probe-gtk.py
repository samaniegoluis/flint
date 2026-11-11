#!/usr/bin/env python3
# Opens paste-probe.html in GTK 3 + WebKit2GTK 4.1, the same engine Flint's Linux build uses.
#
#   paste-probe-gtk.py [page] [--auto]
#
# --auto makes the whole window the paste and drop target (no need to aim at the box),
# focuses it, and prints each new report block on stdout, for runs driven by xdotool.
import os, sys, gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, GLib, WebKit2

args = [a for a in sys.argv[1:] if not a.startswith("--")]
auto = "--auto" in sys.argv
page = args[0] if args else os.path.expanduser("~/Desktop/paste-probe.html")

AUTO_JS = """
const z = document.getElementById('zone');
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { if (!e.defaultPrevented) { e.preventDefault(); describe('drop', e.dataTransfer); } });
window.addEventListener('paste', (e) => { if (!e.defaultPrevented) { e.preventDefault(); describe('paste', e.clipboardData); } });
if (location.hash !== '#plain') z.contentEditable = 'true';  // Flint pastes into xterm's textarea
z.focus();
// F9: the async Clipboard API, which Flint could call on Ctrl+Shift+V instead of reading the paste event.
window.addEventListener('keydown', async (e) => {
  if (e.key !== 'F9') return;
  e.preventDefault();
  try {
    const items = await navigator.clipboard.read();
    log(`clipboard.read: ${items.length} item(s)`);
    for (const it of items) {
      for (const t of it.types) {
        const b = await it.getType(t);
        const head = [...new Uint8Array(await b.slice(0, 8).arrayBuffer())].map((x) => x.toString(16).padStart(2, '0')).join(' ');
        log(`   - ${t} size=${b.size} (first: ${head})`);
      }
    }
  } catch (err) { log(`clipboard.read failed: ${err}`); }
  try { log(`clipboard.readText: ${JSON.stringify(await navigator.clipboard.readText())}`); } catch (err) { log(`clipboard.readText failed: ${err}`); }
  log('');
});
"""

win = Gtk.Window(title="Flint paste probe (WebKit2GTK 4.1)")
win.set_default_size(1000, 800)
win.connect("destroy", Gtk.main_quit)
view = WebKit2.WebView()
s = view.get_settings()
# Off by default, as in cfire's webview (Flint); FLINT_PROBE_JS_CLIPBOARD=1 turns it on.
s.set_javascript_can_access_clipboard(os.environ.get("FLINT_PROBE_JS_CLIPBOARD") == "1")
s.set_enable_developer_extras(True)
if auto:
    view.get_user_content_manager().add_script(WebKit2.UserScript(
        AUTO_JS, WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserScriptInjectionTime.END, None, None))
    seen = {"text": ""}

    def got(v, res):
        try:
            text = v.run_javascript_finish(res).get_js_value().to_string()
        except Exception:
            return
        if text.startswith(seen["text"]) and len(text) > len(seen["text"]):
            print(text[len(seen["text"]):], end="", flush=True)
        seen["text"] = text

    def poll():
        view.run_javascript("document.getElementById('out').textContent", None, got)
        return True

    GLib.timeout_add(300, poll)
view.load_uri("file://" + os.path.abspath(page))
win.add(view)
win.show_all()
Gtk.main()
