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
// A secret is concealed and cleared later; plain text (OSC 52) is neither.
inline int copy_to(const std::string& name, const std::string& text, int64_t clear_after_ms, bool concealed) {
    Pool pool;
    id pb = board(name);
    if (!pb) return 2;
    reinterpret_cast<long (*)(id, SEL)>(objc_msgSend)(pb, sel("clearContents"));
    auto set = reinterpret_cast<signed char (*)(id, SEL, id, id)>(objc_msgSend);
    if (!set(pb, sel("setString:forType:"), ns_string(text), ns_string("public.utf8-plain-text"))) return 1;
    // nspasteboard.org: clipboard managers do not record or show concealed items.
    if (concealed) set(pb, sel("setString:forType:"), ns_string(""), ns_string("org.nspasteboard.ConcealedType"));
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

// What a paste would take (milestone 25 on Linux; also built here so one test covers
// both): the board's text, else its PNG. 0, or 2 when there is no board.
inline int read_paste(const std::string& name, std::string& text, std::string& mime, std::string& data) {
    Pool pool;
    id pb = board(name);
    if (!pb) return 2;
    text = read_text(name);
    if (!text.empty()) return 0;
    id d = reinterpret_cast<id (*)(id, SEL, id)>(objc_msgSend)(pb, sel("dataForType:"), ns_string("public.png"));
    if (!d) return 0;
    auto bytes = reinterpret_cast<const void* (*)(id, SEL)>(objc_msgSend)(d, sel("bytes"));
    auto len = reinterpret_cast<unsigned long (*)(id, SEL)>(objc_msgSend)(d, sel("length"));
    if (bytes && len > 0) {
        data.assign(static_cast<const char*>(bytes), len);
        mime = "image/png";
    }
    return 0;
}

// For the tests: puts PNG bytes alone on the board.
inline int copy_png(const std::string& name, const std::string& png) {
    Pool pool;
    id pb = board(name);
    if (!pb) return 2;
    reinterpret_cast<long (*)(id, SEL)>(objc_msgSend)(pb, sel("clearContents"));
    id d = reinterpret_cast<id (*)(id, SEL, const void*, unsigned long)>(objc_msgSend)(cls("NSData"), sel("dataWithBytes:length:"), png.data(), png.size());
    auto set = reinterpret_cast<signed char (*)(id, SEL, id, id)>(objc_msgSend);
    return set(pb, sel("setData:forType:"), d, ns_string("public.png")) ? 0 : 1;
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
inline bool& live_concealed() { static bool b = false; return b; }

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

inline int copy_to(const std::string&, const std::string& text, int64_t clear_after_ms, bool concealed) {
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
    if (!gtk_clipboard_set_with_data(cb, targets, concealed ? 5 : 4, get_cb, clear_cb, d)) {
        wipe(d->text);
        delete d;
        return 1;
    }
    live_seq() = d->seq;
    live_concealed() = concealed;
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

// What a paste would take, read by the core because WebKitGTK hands the page's paste
// event neither text nor image (milestone 25 on Linux): the clipboard's text, else an
// image as PNG (`image/png` as offered, or any image GTK can read, converted). 0, or 2
// with no display. GTK's waits run a nested main loop: called on the UI thread.
inline int read_paste(const std::string&, std::string& text, std::string& mime, std::string& data) {
    if (!gdk_display_get_default()) return 2;
    GtkClipboard* cb = gtk_clipboard_get(GDK_SELECTION_CLIPBOARD);
    GdkAtom* targets = nullptr;
    gint n = 0;
    if (!gtk_clipboard_wait_for_targets(cb, &targets, &n)) return 0;
    if (gtk_targets_include_text(targets, n)) {
        gchar* t = gtk_clipboard_wait_for_text(cb);
        text = t ? t : "";
        g_free(t);
        if (!text.empty()) {
            g_free(targets);
            return 0;
        }
    }
    GdkAtom png = gdk_atom_intern_static_string("image/png");
    bool has_png = false;
    for (gint i = 0; i < n; i++) has_png = has_png || targets[i] == png;
    bool has_image = gtk_targets_include_image(targets, n, FALSE);
    g_free(targets);
    if (has_png) {
        GtkSelectionData* sd = gtk_clipboard_wait_for_contents(cb, png);
        if (sd) {
            gint len = 0;
            const guchar* p = gtk_selection_data_get_data_with_length(sd, &len);
            if (p && len > 0) {
                data.assign(reinterpret_cast<const char*>(p), static_cast<size_t>(len));
                mime = "image/png";
            }
            gtk_selection_data_free(sd);
            if (!data.empty()) return 0;
        }
    }
    if (has_image) {
        GdkPixbuf* pb = gtk_clipboard_wait_for_image(cb);
        if (pb) {
            gchar* buf = nullptr;
            gsize len = 0;
            if (gdk_pixbuf_save_to_buffer(pb, &buf, &len, "png", nullptr, nullptr) && buf && len > 0) {
                data.assign(buf, len);
                mime = "image/png";
            }
            g_free(buf);
            g_object_unref(pb);
        }
    }
    return 0;
}

// For the tests: puts PNG bytes alone on the clipboard.
struct PngData {
    std::string png;
};

inline void png_get_cb(GtkClipboard*, GtkSelectionData* sd, guint, gpointer p) {
    auto* d = static_cast<PngData*>(p);
    gtk_selection_data_set(sd, gtk_selection_data_get_target(sd), 8, reinterpret_cast<const guchar*>(d->png.data()), static_cast<gint>(d->png.size()));
}

inline void png_clear_cb(GtkClipboard*, gpointer p) { delete static_cast<PngData*>(p); }

inline int copy_png(const std::string&, const std::string& png) {
    if (!gdk_display_get_default()) return 2;
    static GtkTargetEntry targets[] = {{const_cast<gchar*>("image/png"), 0, 0}};
    auto* d = new PngData{png};
    if (!gtk_clipboard_set_with_data(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), targets, 1, png_get_cb, png_clear_cb, d)) {
        delete d;
        return 1;
    }
    live_seq() = 0;
    return 0;
}

inline bool is_concealed(const std::string&) { return live_seq() != 0 && live_concealed(); }
inline void release_board(const std::string&) {}

#else

inline long change_count(const std::string&) { return -1; }
inline bool clear_if_unchanged(const std::string&, long) { return false; }
inline int copy_to(const std::string&, const std::string&, int64_t, bool) { return 2; }
inline std::string read_text(const std::string&) { return ""; }
inline bool is_concealed(const std::string&) { return false; }
inline int read_paste(const std::string&, std::string&, std::string&, std::string&) { return 2; }
inline int copy_png(const std::string&, const std::string&) { return 2; }
inline void release_board(const std::string&) {}

#endif

inline int copy_secret(const std::string& name, const std::string& text, int64_t clear_after_ms) {
    return copy_to(name, text, clear_after_ms, true);
}
inline int copy_text(const std::string& name, const std::string& text) {
    return copy_to(name, text, 0, false);
}

}  // namespace flint_clip
