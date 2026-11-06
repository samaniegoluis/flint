// CFIRE-UPSTREAM: CF-084, CF-031
//
// Screen lock and sleep, for the app's auto-lock (D-042). cfire has no way to hear
// these system events (CF-084). The OS callbacks only count events; the app's
// lock timer takes them once a second (src/adapters/uievents/sysevents.cf), so no
// callback ever runs cfire code or touches the vault.
//
// macOS: the distributed notification "com.apple.screenIsLocked" (posted when the
// screen locks or the screen saver asks for a password) and IOKit's system power
// notifications (kIOMessageSystemWillSleep). Both deliver on the main run loop, which
// the webview runs.
//
// Linux: D-Bus through GIO (already linked by GTK): logind's Session.Lock for this
// session and Manager.PrepareForSleep(true) on the system bus, and ActiveChanged(true)
// of org.freedesktop.ScreenSaver and org.gnome.ScreenSaver on the session bus.
// Signals are dispatched by the GTK main loop.
#pragma once
#include <atomic>
#include <cstdint>
#include <string>

#if defined(__APPLE__)
#if defined(__OBJC__)
#import <AppKit/AppKit.h>
#endif
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/pwr_mgt/IOPMLib.h>
#include <IOKit/IOMessage.h>
#else
#include <gio/gio.h>
#include <gtk/gtk.h>
#include <unistd.h>
#endif

namespace flint_sysevents {

inline std::atomic<int>& screen_count() {
    static std::atomic<int> n{0};
    return n;
}

inline std::atomic<int>& sleep_count() {
    static std::atomic<int> n{0};
    return n;
}

// "screen", "sleep" or "" — one event, oldest kind first; the counters are cleared.
inline std::string take() {
    if (sleep_count().exchange(0) > 0) {
        screen_count().store(0);
        return "sleep";
    }
    if (screen_count().exchange(0) > 0) return "screen";
    return "";
}

// The headless end-to-end run stands in for the OS.
inline void inject(const std::string& kind) {
    if (kind == "sleep") sleep_count()++;
    else if (kind == "screen") screen_count()++;
}

#if defined(__APPLE__)

inline io_connect_t& power_port() {
    static io_connect_t p = 0;
    return p;
}

inline void on_screen_locked(CFNotificationCenterRef, void*, CFNotificationName, const void*, CFDictionaryRef) {
    screen_count()++;
}

inline void on_power(void*, io_service_t, natural_t type, void* arg) {
    switch (type) {
        case kIOMessageCanSystemSleep:
            IOAllowPowerChange(power_port(), reinterpret_cast<long>(arg));
            break;
        case kIOMessageSystemWillSleep:
            sleep_count()++;
            IOAllowPowerChange(power_port(), reinterpret_cast<long>(arg));
            break;
        default:
            break;
    }
}

// Call once, on the main thread, before the run loop starts. Returns what it could
// subscribe to, for the log.
inline std::string start() {
    std::string got;
    CFNotificationCenterAddObserver(CFNotificationCenterGetDistributedCenter(), nullptr, on_screen_locked,
        CFSTR("com.apple.screenIsLocked"), nullptr, CFNotificationSuspensionBehaviorDeliverImmediately);
    got = "screen";
    IONotificationPortRef port = nullptr;
    io_object_t notifier = 0;
    power_port() = IORegisterForSystemPower(nullptr, &port, on_power, &notifier);
    if (power_port() != 0 && port != nullptr) {
        CFRunLoopAddSource(CFRunLoopGetMain(), IONotificationPortGetRunLoopSource(port), kCFRunLoopCommonModes);
        got += ",sleep";
    }
    return got;
}

#else

inline void on_signal(GDBusConnection*, const gchar*, const gchar*, const gchar* iface, const gchar* signal,
                      GVariant* params, gpointer) {
    std::string i = iface ? iface : "";
    std::string s = signal ? signal : "";
    if (s == "Lock") {
        screen_count()++;
        return;
    }
    gboolean flag = FALSE;
    if (params && g_variant_is_of_type(params, G_VARIANT_TYPE("(b)"))) g_variant_get(params, "(b)", &flag);
    if (!flag) return;
    if (s == "PrepareForSleep") sleep_count()++;
    else if (s == "ActiveChanged") screen_count()++;
}

// This process's logind session object, or "" (then Lock of any session counts,
// which can only lock more often, never less).
inline std::string session_path(GDBusConnection* sys) {
    GError* err = nullptr;
    GVariant* r = g_dbus_connection_call_sync(sys, "org.freedesktop.login1", "/org/freedesktop/login1",
        "org.freedesktop.login1.Manager", "GetSessionByPID", g_variant_new("(u)", (guint32)getpid()),
        G_VARIANT_TYPE("(o)"), G_DBUS_CALL_FLAGS_NONE, 2000, nullptr, &err);
    if (!r) {
        if (err) g_error_free(err);
        return "";
    }
    const gchar* path = nullptr;
    g_variant_get(r, "(&o)", &path);
    std::string out = path ? path : "";
    g_variant_unref(r);
    return out;
}

inline std::string start() {
    std::string got;
    GError* err = nullptr;
    if (GDBusConnection* sys = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, &err)) {
        std::string session = session_path(sys);
        g_dbus_connection_signal_subscribe(sys, "org.freedesktop.login1", "org.freedesktop.login1.Session", "Lock",
            session.empty() ? nullptr : session.c_str(), nullptr, G_DBUS_SIGNAL_FLAGS_NONE, on_signal, nullptr, nullptr);
        g_dbus_connection_signal_subscribe(sys, "org.freedesktop.login1", "org.freedesktop.login1.Manager",
            "PrepareForSleep", "/org/freedesktop/login1", nullptr, G_DBUS_SIGNAL_FLAGS_NONE, on_signal, nullptr, nullptr);
        got = "logind";
    } else if (err) {
        g_error_free(err);
        err = nullptr;
    }
    if (GDBusConnection* ses = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &err)) {
        g_dbus_connection_signal_subscribe(ses, nullptr, "org.freedesktop.ScreenSaver", "ActiveChanged", nullptr,
            nullptr, G_DBUS_SIGNAL_FLAGS_NONE, on_signal, nullptr, nullptr);
        g_dbus_connection_signal_subscribe(ses, nullptr, "org.gnome.ScreenSaver", "ActiveChanged", nullptr,
            nullptr, G_DBUS_SIGNAL_FLAGS_NONE, on_signal, nullptr, nullptr);
        got += got.empty() ? "screensaver" : ",screensaver";
    } else if (err) {
        g_error_free(err);
    }
    return got;
}

#endif

// Runs the main loop for `ms` milliseconds so pending OS events are delivered; for
// tests, where no window runs it.
inline void pump(int ms) {
#if defined(__APPLE__)
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, ms / 1000.0, false);
#else
    gint64 end = g_get_monotonic_time() + static_cast<gint64>(ms) * 1000;
    while (g_get_monotonic_time() < end) {
        if (!g_main_context_iteration(nullptr, FALSE)) g_usleep(10000);
    }
#endif
}

// Shows the window in front of the others, from any thread: a CLI asked Flint to
// unlock, and the person should see the unlock screen that names it.
inline void bring_to_front() {
#if defined(__APPLE__)
#if defined(__OBJC__)
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
        [NSApp activateIgnoringOtherApps:YES];
        for (NSWindow* w in [NSApp windows]) {
            if ([w isMiniaturized]) [w deminiaturize:nil];
            [w makeKeyAndOrderFront:nil];
        }
    }});
#endif
#else
    g_idle_add(+[](gpointer) -> gboolean {
        GList* tops = gtk_window_list_toplevels();
        for (GList* l = tops; l; l = l->next) {
            if (gtk_widget_get_visible(GTK_WIDGET(l->data))) gtk_window_present(GTK_WINDOW(l->data));
        }
        g_list_free(tops);
        return G_SOURCE_REMOVE;
    }, nullptr);
#endif
}

} // namespace flint_sysevents
