// CFIRE-UPSTREAM: CF-125, CF-031
//
// Full screen for the window (milestone 37). `ext:webui` offers only a toggle
// (`App.fullscreen()`, `WindowFullscreen()` in the page) whose state is a flag flipped
// on every call: it has no "enter" or "leave", nothing on Windows, and it never learns
// that the window left full screen another way (the green button, the system's own
// ⌃⌘F, a window manager's key). So this header sets the state explicitly, reads the
// window's real state, and tells the page each time it changes, from the UI thread,
// through the `window:fullscreen` event ({ "on": true|false }).
//
// macOS: the system's own full screen (the window gets its own Space, as Windows App's
// does), entered with -toggleFullScreen: only when the state differs, and heard through
// NSWindowDidEnterFullScreen / NSWindowDidExitFullScreen.
// Linux: gtk_window_fullscreen / gtk_window_unfullscreen, heard through
// "window-state-event" (GDK emulates full screen when the window manager lacks
// _NET_WM_STATE_FULLSCREEN, and still reports the state).
// Windows (built on the owner's branch, not here): the window's style becomes WS_POPUP
// over its monitor's rectangle, and the old style and placement come back on leaving.
#pragma once
#include "core/webui.hpp"
#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <string>

#if defined(__APPLE__)
#if defined(__OBJC__)
#import <AppKit/AppKit.h>
#endif
#elif defined(_WIN32)
#include <windows.h>
#else
#include <gtk/gtk.h>
#endif

namespace flint_window {

inline std::atomic<bool>& state() {
    static std::atomic<bool> on{false};
    return on;
}

// What macOS shows over the top of a full-screen window when the pointer reaches the
// top edge: the menu bar and the window's title bar, in points. 0 elsewhere.
inline std::atomic<int>& top_inset() {
    static std::atomic<int> px{0};
    return px;
}

inline std::mutex& app_mtx() {
    static std::mutex m;
    return m;
}

inline std::shared_ptr<cfire::webui::App>& app_slot() {
    static std::shared_ptr<cfire::webui::App> app;
    return app;
}

// Records the window's state and tells the page when it changed. Runs on the UI thread.
inline void report(bool on) {
    bool was = state().exchange(on);
    if (was == on) return;
    std::shared_ptr<cfire::webui::App> app;
    {
        std::lock_guard<std::mutex> lock(app_mtx());
        app = app_slot();
    }
    if (app) app->eval("window.__cfire_event_dispatch(\"window:fullscreen\", {\"on\":" +
                       std::string(on ? "true" : "false") + ",\"top\":" + std::to_string(top_inset().load()) + "});");
}

#if defined(__APPLE__) && defined(__OBJC__)
// Flint has one window; the key or main one, else the first visible one.
inline NSWindow* main_window() {
    NSWindow* w = [NSApp keyWindow];
    if (!w) w = [NSApp mainWindow];
    if (!w) {
        for (NSWindow* c in [NSApp windows]) {
            if ([c isVisible] && [c canBecomeMainWindow]) { w = c; break; }
        }
    }
    return w;
}
#elif defined(_WIN32)
struct WinSaved {
    bool saved = false;
    LONG_PTR style = 0;
    WINDOWPLACEMENT placement{ sizeof(WINDOWPLACEMENT) };
};

inline WinSaved& win_saved() {
    static WinSaved s;
    return s;
}

inline HWND main_hwnd() {
    struct Find { HWND hwnd = nullptr; DWORD pid = 0; } f{ nullptr, ::GetCurrentProcessId() };
    ::EnumWindows([](HWND h, LPARAM lp) -> BOOL {
        auto* f = reinterpret_cast<Find*>(lp);
        DWORD pid = 0;
        ::GetWindowThreadProcessId(h, &pid);
        if (pid == f->pid && ::IsWindowVisible(h) && !::GetWindow(h, GW_OWNER)) {
            f->hwnd = h;
            return FALSE;
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&f));
    return f.hwnd;
}
#elif !defined(__APPLE__)
inline gboolean on_window_state(GtkWidget*, GdkEventWindowState* ev, gpointer) {
    if (ev->changed_mask & GDK_WINDOW_STATE_FULLSCREEN) {
        report((ev->new_window_state & GDK_WINDOW_STATE_FULLSCREEN) != 0);
    }
    return FALSE;
}
#endif

// Keeps the app for the `window:fullscreen` event and starts hearing the window's
// state. Call once, before the window runs; the hooks are installed on the UI thread
// once its loop starts.
inline void install(const cfire::webui::App& app) {
    {
        std::lock_guard<std::mutex> lock(app_mtx());
        app_slot() = std::make_shared<cfire::webui::App>(app);
    }
#if defined(__APPLE__)
#if defined(__OBJC__)
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
        NSNotificationCenter* nc = [NSNotificationCenter defaultCenter];
        [nc addObserverForName:NSWindowDidEnterFullScreenNotification object:nil queue:nil
                    usingBlock:^(NSNotification*) { report(true); }];
        [nc addObserverForName:NSWindowDidExitFullScreenNotification object:nil queue:nil
                    usingBlock:^(NSNotification*) { report(false); }];
    }});
#endif
#elif defined(_WIN32)
    // Only Flint changes the style on Windows, so set() reports it itself.
#else
    g_idle_add(+[](gpointer) -> gboolean {
        GList* tops = gtk_window_list_toplevels();
        for (GList* l = tops; l; l = l->next) {
            GtkWidget* w = GTK_WIDGET(l->data);
            if (gtk_widget_get_visible(w) && !g_object_get_data(G_OBJECT(w), "flint-fs")) {
                g_object_set_data(G_OBJECT(w), "flint-fs", GINT_TO_POINTER(1));
                g_signal_connect(w, "window-state-event", G_CALLBACK(on_window_state), nullptr);
            }
        }
        g_list_free(tops);
        return G_SOURCE_REMOVE;
    }, nullptr);
#endif
}

// Stands in for the OS in the headless end-to-end run, whose hidden window cannot go
// full screen: the window "entered" or "left" it, and the page hears so.
inline void inject(bool on) {
    report(on);
}

// Whether the window is full screen, as last heard from the OS.
inline bool is_on() {
    return state().load();
}

// Puts the window in full screen or takes it out, from any thread. Does nothing when it
// already is in that state. The page learns the result from `window:fullscreen`.
inline void set(bool on) {
#if defined(__APPLE__)
#if defined(__OBJC__)
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
        NSWindow* w = main_window();
        if (!w) return;
        [w setCollectionBehavior:[w collectionBehavior] | NSWindowCollectionBehaviorFullScreenPrimary];
        bool now = ([w styleMask] & NSWindowStyleMaskFullScreen) != 0;
        if (!now) {
            // Measured outside full screen, where the title bar has its real height.
            CGFloat title = NSHeight([w frame]) - NSHeight([w contentLayoutRect]);
            CGFloat menu = [[NSApp mainMenu] menuBarHeight];
            if (menu <= 0) menu = 24;
            top_inset().store(static_cast<int>(menu + (title > 0 ? title : 0)));
        }
        if (now != on) [w toggleFullScreen:nil];
    }});
#endif
#elif defined(_WIN32)
    HWND h = main_hwnd();
    if (!h) return;
    WinSaved& s = win_saved();
    if (on && !s.saved) {
        s.style = ::GetWindowLongPtrW(h, GWL_STYLE);
        s.placement.length = sizeof(WINDOWPLACEMENT);
        ::GetWindowPlacement(h, &s.placement);
        MONITORINFO mi{ sizeof(MONITORINFO) };
        ::GetMonitorInfoW(::MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), &mi);
        ::SetWindowLongPtrW(h, GWL_STYLE, (s.style & ~WS_OVERLAPPEDWINDOW) | WS_POPUP);
        ::SetWindowPos(h, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top,
                       mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
                       SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        s.saved = true;
        report(true);
    } else if (!on && s.saved) {
        ::SetWindowLongPtrW(h, GWL_STYLE, s.style);
        ::SetWindowPlacement(h, &s.placement);
        ::SetWindowPos(h, nullptr, 0, 0, 0, 0,
                       SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        s.saved = false;
        report(false);
    }
#else
    g_idle_add(+[](gpointer data) -> gboolean {
        bool want = GPOINTER_TO_INT(data) != 0;
        GList* tops = gtk_window_list_toplevels();
        for (GList* l = tops; l; l = l->next) {
            GtkWidget* w = GTK_WIDGET(l->data);
            if (!gtk_widget_get_visible(w)) continue;
            if (want) gtk_window_fullscreen(GTK_WINDOW(w));
            else gtk_window_unfullscreen(GTK_WINDOW(w));
        }
        g_list_free(tops);
        return G_SOURCE_REMOVE;
    }, GINT_TO_POINTER(on ? 1 : 0));
#endif
}

} // namespace flint_window
