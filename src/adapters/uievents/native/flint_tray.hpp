// CFIRE-UPSTREAM: CF-189, CF-031
//
// Whether the tray icon `ext:webui` puts up is shown anywhere (milestone 65, D-138 (3)).
// cfire's Linux icon is a GtkStatusIcon, an XEmbed tray icon: it shows only when an
// X11 tray manager owns the `_NET_SYSTEM_TRAY_S<screen>` selection (a panel's system
// tray), and never in a Wayland session. cfire says nothing about it (CF-189), so the
// app asks X itself, on a connection of its own (Xlib calls on GDK's from another
// thread are not safe). macOS's menu bar and Windows' notification area always show
// it.
#pragma once
#include <string>

#if defined(__APPLE__) || defined(_WIN32)
#else
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <X11/Xlib.h>
#endif

namespace flint_tray {

inline bool has_tray() {
#if defined(__APPLE__) || defined(_WIN32)
    return true;
#else
    GdkDisplay* gd = gdk_display_get_default();
    if (gd == nullptr || !GDK_IS_X11_DISPLAY(gd)) {
        return false;
    }
    const char* name = gdk_display_get_name(gd);
    Display* d = XOpenDisplay(name);
    if (d == nullptr) {
        return false;
    }
    std::string sel = "_NET_SYSTEM_TRAY_S" + std::to_string(DefaultScreen(d));
    Atom a = XInternAtom(d, sel.c_str(), True);
    bool owned = a != None && XGetSelectionOwner(d, a) != None;
    XCloseDisplay(d);
    return owned;
#endif
}

}  // namespace flint_tray
