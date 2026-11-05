// The system clipboard for the desktop app (src/adapters/uievents/clipboard.cf).
// ext:webui has no clipboard API (CF-053), so this shim talks to AppKit on macOS
// (through the Objective-C runtime, so it also builds as plain C++ for the tests) and
// to GTK 3 on Linux (the toolkit WebKitGTK already runs on).
//
// A copied secret is marked so clipboard managers skip it where the OS has a
// convention for that (org.nspasteboard.ConcealedType on macOS, the
// x-kde-passwordManagerHint target on Linux), and cleared after a delay unless
// something else was copied since (D-029).
#pragma once

#include <cstdint>
#include <string>

#if defined(__APPLE__)
#include <dispatch/dispatch.h>
#include <objc/message.h>
#include <objc/runtime.h>
extern "C" void* objc_autoreleasePoolPush(void);
extern "C" void objc_autoreleasePoolPop(void*);
#elif defined(__linux__)
#include <gtk/gtk.h>
#endif

namespace flint_clip {

#if defined(__APPLE__)

struct Pool {
    void* p = objc_autoreleasePoolPush();
    ~Pool() { objc_autoreleasePoolPop(p); }
};

inline id cls(const char* n) { return reinterpret_cast<id>(objc_getClass(n)); }
inline SEL sel(const char* n) { return sel_registerName(n); }

inline id ns_string(const std::string& s) {
    return reinterpret_cast<id (*)(id, SEL, const char*)>(objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), s.c_str());
}

// The general pasteboard, or a private named one ("" for the general one).
inline id board(const std::string& name) {
    id c = cls("NSPasteboard");
    if (!c) return nullptr;
    if (name.empty()) return reinterpret_cast<id (*)(id, SEL)>(objc_msgSend)(c, sel("generalPasteboard"));
    return reinterpret_cast<id (*)(id, SEL, id)>(objc_msgSend)(c, sel("pasteboardWithName:"), ns_string(name));
}

inline long change_count_of(id pb) {
    return reinterpret_cast<long (*)(id, SEL)>(objc_msgSend)(pb, sel("changeCount"));
}

struct ClearJob {
    std::string name;
    long count;
};

inline long change_count(const std::string& name) {
    Pool pool;
    id pb = board(name);
    return pb ? change_count_of(pb) : -1;
}

// Clears the board if nothing was copied since `count`. True when it cleared.
inline bool clear_if_unchanged(const std::string& name, long count) {
    Pool pool;
    id pb = board(name);
    if (!pb || change_count_of(pb) != count) return false;
    reinterpret_cast<long (*)(id, SEL)>(objc_msgSend)(pb, sel("clearContents"));
    return true;
}

inline void run_clear(void* ctx) {
    auto* job = static_cast<ClearJob*>(ctx);
    clear_if_unchanged(job->name, job->count);
    delete job;
}

// 0 on success, 2 when there is no pasteboard (AppKit not loaded), 1 when the write failed.
inline int copy_secret(const std::string& name, const std::string& text, int64_t clear_after_ms) {
    Pool pool;
    id pb = board(name);
    if (!pb) return 2;
    reinterpret_cast<long (*)(id, SEL)>(objc_msgSend)(pb, sel("clearContents"));
    auto set = reinterpret_cast<signed char (*)(id, SEL, id, id)>(objc_msgSend);
    if (!set(pb, sel("setString:forType:"), ns_string(text), ns_string("public.utf8-plain-text"))) return 1;
    // nspasteboard.org: clipboard managers do not record or show concealed items.
    set(pb, sel("setString:forType:"), ns_string(""), ns_string("org.nspasteboard.ConcealedType"));
    auto* job = new ClearJob{name, change_count_of(pb)};
    if (clear_after_ms > 0) {
        dispatch_after_f(dispatch_time(DISPATCH_TIME_NOW, clear_after_ms * 1000000LL), dispatch_get_main_queue(), job, run_clear);
    } else {
        delete job;
    }
    return 0;
}

// For the tests: the board's text, and whether the concealed marker is on it.
inline std::string read_text(const std::string& name) {
    Pool pool;
    id pb = board(name);
    if (!pb) return "";
    id s = reinterpret_cast<id (*)(id, SEL, id)>(objc_msgSend)(pb, sel("stringForType:"), ns_string("public.utf8-plain-text"));
    if (!s) return "";
    const char* c = reinterpret_cast<const char* (*)(id, SEL)>(objc_msgSend)(s, sel("UTF8String"));
    return c ? std::string(c) : std::string();
}

inline bool is_concealed(const std::string& name) {
    Pool pool;
    id pb = board(name);
    if (!pb) return false;
    id s = reinterpret_cast<id (*)(id, SEL, id)>(objc_msgSend)(pb, sel("stringForType:"), ns_string("org.nspasteboard.ConcealedType"));
    return s != nullptr;
}

inline void release_board(const std::string& name) {
    Pool pool;
    id pb = board(name);
    if (pb && !name.empty()) reinterpret_cast<void (*)(id, SEL)>(objc_msgSend)(pb, sel("releaseGlobally"));
}

#elif defined(__linux__)

// One live copy at a time: `live_seq` names it until GTK reports that another owner
// took the clipboard (or Flint cleared it).
inline uint64_t& live_seq() { static uint64_t s = 0; return s; }
inline uint64_t& next_seq() { static uint64_t s = 0; return s; }

struct ClipData {
    std::string text;
    uint64_t seq;
};

inline void wipe(std::string& s) {
    volatile char* p = s.data();
    for (size_t i = 0; i < s.size(); i++) p[i] = 0;
    s.clear();
}

inline void get_cb(GtkClipboard*, GtkSelectionData* sd, guint info, gpointer p) {
    auto* d = static_cast<ClipData*>(p);
    if (info == 1) {
        gtk_selection_data_set(sd, gtk_selection_data_get_target(sd), 8, reinterpret_cast<const guchar*>("secret"), 6);
    } else {
        gtk_selection_data_set_text(sd, d->text.c_str(), static_cast<gint>(d->text.size()));
    }
}

inline void clear_cb(GtkClipboard*, gpointer p) {
    auto* d = static_cast<ClipData*>(p);
    if (live_seq() == d->seq) live_seq() = 0;
    wipe(d->text);
    delete d;
}

inline gboolean timer_cb(gpointer p) {
    auto seq = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(p));
    if (live_seq() == seq) gtk_clipboard_clear(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD));
    return G_SOURCE_REMOVE;
}

inline long change_count(const std::string&) { return static_cast<long>(live_seq()); }
inline bool clear_if_unchanged(const std::string&, long count) {
    if (count == 0 || static_cast<long>(live_seq()) != count) return false;
    gtk_clipboard_clear(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD));
    return true;
}

inline int copy_secret(const std::string&, const std::string& text, int64_t clear_after_ms) {
    if (!gdk_display_get_default()) return 2;
    GtkClipboard* cb = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
    auto* d = new ClipData{text, ++next_seq()};
    static GtkTargetEntry targets[] = {
        {const_cast<gchar*>("UTF8_STRING"), 0, 0},
        {const_cast<gchar*>("text/plain;charset=utf-8"), 0, 0},
        {const_cast<gchar*>("STRING"), 0, 0},
        {const_cast<gchar*>("TEXT"), 0, 0},
        {const_cast<gchar*>("x-kde-passwordManagerHint"), 0, 1},
    };
    if (!gtk_clipboard_set_with_data(cb, targets, 5, get_cb, clear_cb, d)) {
        wipe(d->text);
        delete d;
        return 1;
    }
    live_seq() = d->seq;
    gtk_clipboard_set_can_store(cb, nullptr, 0);
    if (clear_after_ms > 0) {
        g_timeout_add(static_cast<guint>(clear_after_ms), timer_cb, reinterpret_cast<gpointer>(static_cast<uintptr_t>(d->seq)));
    }
    return 0;
}

inline std::string read_text(const std::string&) {
    if (!gdk_display_get_default()) return "";
    gchar* t = gtk_clipboard_wait_for_text(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD));
    std::string s = t ? t : "";
    g_free(t);
    return s;
}

inline bool is_concealed(const std::string&) { return live_seq() != 0; }
inline void release_board(const std::string&) {}

#else

inline long change_count(const std::string&) { return -1; }
inline bool clear_if_unchanged(const std::string&, long) { return false; }
inline int copy_secret(const std::string&, const std::string&, int64_t) { return 2; }
inline std::string read_text(const std::string&) { return ""; }
inline bool is_concealed(const std::string&) { return false; }
inline void release_board(const std::string&) {}

#endif

}  // namespace flint_clip
