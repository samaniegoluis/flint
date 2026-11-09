// The system clipboard for the desktop app (src/adapters/uievents/clipboard.cf).
// ext:webui has no clipboard API (CF-053), so this shim talks to AppKit on macOS
// (through the Objective-C runtime, so it also builds as plain C++ for the tests) and
// to GTK 3 on Linux (the toolkit WebKitGTK already runs on).
//
// A copied secret is marked so clipboard managers skip it where the OS has a
// convention for that (org.nspasteboard.ConcealedType on macOS, the
// x-kde-passwordManagerHint target on Linux), and cleared after a delay unless
// something else was copied since (D-029).
//
// Windows (windows-port branch): CF_UNICODETEXT through the Win32 clipboard. A secret
// carries the formats Windows' own clipboard history and cloud sync, and well-behaved
// clipboard managers, honour (ExcludeClipboardContentFromMonitorProcessing,
// CanIncludeInClipboardHistory = 0, CanUploadToCloudClipboard = 0).
// GetClipboardSequenceNumber is the change count. The clipboard owner is a
// message-only window made on the calling thread: Flint copies from RPC handlers on
// the UI thread, whose loop also runs this window (WM_DESTROYCLIPBOARD from another
// program must not wait on a thread that never reads messages) and its clear timer.
#pragma once

#include <cstdint>
#include <cstring>
#include <string>

#if defined(__APPLE__)
#include <dispatch/dispatch.h>
#include <objc/message.h>
#include <objc/runtime.h>
extern "C" void* objc_autoreleasePoolPush(void);
extern "C" void objc_autoreleasePoolPop(void*);
#elif defined(_WIN32)
#include <windows.h>
#include <mutex>
#include <unordered_map>
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

inline void release_board(const std::string& name) {
    Pool pool;
    id pb = board(name);
    if (pb && !name.empty()) reinterpret_cast<void (*)(id, SEL)>(objc_msgSend)(pb, sel("releaseGlobally"));
}

#elif defined(_WIN32)

inline std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

inline void wipe_w(std::wstring& w) {
    volatile wchar_t* p = w.data();
    for (size_t i = 0; i < w.size(); i++) p[i] = 0;
    w.clear();
}

// The clipboard owner on this thread (see the header comment).
inline HWND owner_window() {
    thread_local HWND hwnd = nullptr;
    if (!hwnd) hwnd = ::CreateWindowExW(0, L"STATIC", L"Flint clipboard", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr,
                                        ::GetModuleHandleW(nullptr), nullptr);
    return hwnd;
}

// Another program may hold the clipboard for a moment: retry briefly.
inline bool open_board() {
    HWND owner = owner_window();
    for (int i = 0; i < 20; i++) {
        if (::OpenClipboard(owner)) return true;
        ::Sleep(10);
    }
    return false;
}

inline bool put_dword(const wchar_t* format, DWORD value) {
    UINT f = ::RegisterClipboardFormatW(format);
    if (!f) return false;
    HGLOBAL h = ::GlobalAlloc(GMEM_MOVEABLE, sizeof(DWORD));
    if (!h) return false;
    auto* p = static_cast<DWORD*>(::GlobalLock(h));
    if (!p) {
        ::GlobalFree(h);
        return false;
    }
    *p = value;
    ::GlobalUnlock(h);
    if (!::SetClipboardData(f, h)) {
        ::GlobalFree(h);
        return false;
    }
    return true;
}

inline long change_count(const std::string&) { return static_cast<long>(::GetClipboardSequenceNumber()); }

inline bool clear_if_unchanged(const std::string&, long count) {
    if (static_cast<long>(::GetClipboardSequenceNumber()) != count) return false;
    if (!open_board()) return false;
    ::EmptyClipboard();
    ::CloseClipboard();
    return true;
}

// Timer id → the sequence number the copy left; the timer runs on the owner's thread.
inline std::mutex& timers_mtx() { static std::mutex m; return m; }
inline std::unordered_map<UINT_PTR, long>& timers() { static std::unordered_map<UINT_PTR, long> t; return t; }

inline void CALLBACK clear_timer(HWND hwnd, UINT, UINT_PTR id, DWORD) {
    ::KillTimer(hwnd, id);
    long seq = 0;
    {
        std::lock_guard<std::mutex> lock(timers_mtx());
        auto it = timers().find(id);
        if (it == timers().end()) return;
        seq = it->second;
        timers().erase(it);
    }
    clear_if_unchanged("", seq);
}

inline int copy_to(const std::string&, const std::string& text, int64_t clear_after_ms, bool concealed) {
    if (!open_board()) return 1;
    ::EmptyClipboard();
    std::wstring w = widen(text);
    size_t bytes = (w.size() + 1) * sizeof(wchar_t);
    HGLOBAL h = ::GlobalAlloc(GMEM_MOVEABLE, bytes);
    bool ok = false;
    if (h) {
        if (void* p = ::GlobalLock(h)) {
            std::memcpy(p, w.c_str(), bytes);
            ::GlobalUnlock(h);
            ok = ::SetClipboardData(CF_UNICODETEXT, h) != nullptr;
        }
        if (!ok) ::GlobalFree(h);
    }
    wipe_w(w);
    if (ok && concealed) {
        put_dword(L"ExcludeClipboardContentFromMonitorProcessing", 1);
        put_dword(L"CanIncludeInClipboardHistory", 0);
        put_dword(L"CanUploadToCloudClipboard", 0);
    }
    ::CloseClipboard();
    if (!ok) return 1;
    if (clear_after_ms > 0) {
        long seq = change_count("");
        static UINT_PTR next_id = 0x464C;
        std::lock_guard<std::mutex> lock(timers_mtx());
        UINT_PTR id = ++next_id;
        if (::SetTimer(owner_window(), id, static_cast<UINT>(clear_after_ms), clear_timer)) timers()[id] = seq;
    }
    return 0;
}

inline std::string read_text(const std::string&) {
    if (!open_board()) return "";
    std::string out;
    if (HANDLE h = ::GetClipboardData(CF_UNICODETEXT)) {
        if (const auto* w = static_cast<const wchar_t*>(::GlobalLock(h))) {
            int n = ::WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
            if (n > 1) {
                out.assign(static_cast<size_t>(n - 1), '\0');
                ::WideCharToMultiByte(CP_UTF8, 0, w, -1, out.data(), n, nullptr, nullptr);
            }
            ::GlobalUnlock(h);
        }
    }
    ::CloseClipboard();
    return out;
}

inline bool is_concealed(const std::string&) {
    UINT f = ::RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
    return f != 0 && ::IsClipboardFormatAvailable(f);
}

inline void release_board(const std::string&) {}

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

inline bool is_concealed(const std::string&) { return live_seq() != 0 && live_concealed(); }
inline void release_board(const std::string&) {}

#else

inline long change_count(const std::string&) { return -1; }
inline bool clear_if_unchanged(const std::string&, long) { return false; }
inline int copy_to(const std::string&, const std::string&, int64_t, bool) { return 2; }
inline std::string read_text(const std::string&) { return ""; }
inline bool is_concealed(const std::string&) { return false; }
inline void release_board(const std::string&) {}

#endif

inline int copy_secret(const std::string& name, const std::string& text, int64_t clear_after_ms) {
    return copy_to(name, text, clear_after_ms, true);
}
inline int copy_text(const std::string& name, const std::string& text) {
    return copy_to(name, text, 0, false);
}

}  // namespace flint_clip
