// CFIRE-UPSTREAM: W-16
//
// Windows: the page gets the keyboard back when the window comes back to the front.
// On activation (Alt+Tab, the taskbar, a click on the title bar) Windows gives the focus
// to the top-level window, and WebView2 does not take it back by itself: its host is
// meant to call ICoreWebView2Controller::MoveFocus on WM_SETFOCUS, which cfire's window
// procedure does not do (docs/cfire-windows.md, W-16). Until it does, an out-of-context
// WinEvent hook on the UI thread hears this process's windows come to the foreground
// and hands the focus to the window's first child, the WebView2's host window, which
// passes it on to the page's focused element (the terminal, a field). cfire's window
// procedure and its WebView2 objects are left alone. macOS and Linux: nothing to do.
#pragma once

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace flint_focus {

// FLINT_FOCUS_DIAG=1: each step on stderr (W-16's diagnosis on the Windows VM).
inline bool diag() { static const bool on = std::getenv("FLINT_FOCUS_DIAG") != nullptr; return on; }

inline void describe(const char* what, HWND h) {
    if (!diag()) return;
    char cls[128] = "-";
    if (h) ::GetClassNameA(h, cls, sizeof cls);
    DWORD pid = 0;
    if (h) ::GetWindowThreadProcessId(h, &pid);
    std::fprintf(stderr, "flint-focus: %s %p class=%s pid=%lu%s\n", what, static_cast<void*>(h), cls,
                 static_cast<unsigned long>(pid), pid == ::GetCurrentProcessId() ? " (ours)" : "");
}

inline void CALLBACK on_foreground(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG id_object, LONG, DWORD, DWORD) {
    if (event != EVENT_SYSTEM_FOREGROUND || id_object != OBJID_WINDOW || !hwnd) return;
    DWORD pid = 0;
    ::GetWindowThreadProcessId(hwnd, &pid);
    if (pid != ::GetCurrentProcessId()) return;
    describe("foreground", hwnd);
    // A dialog of ours (a file dialog, a message box) keeps its own focus.
    if (::GetWindow(hwnd, GW_OWNER)) return;
    // The window that takes the keys is WebView2's deepest, Chrome_RenderWidgetHostHWND
    // (in the browser's process, under the host child Chrome_WidgetWin_0); focusing the
    // host child alone left the page without focus.
    struct Found { HWND render = nullptr; } found;
    ::EnumChildWindows(hwnd, [](HWND c, LPARAM lp) -> BOOL {
        describe("  descendant", c);
        char cls[64] = "";
        ::GetClassNameA(c, cls, sizeof cls);
        auto* f = reinterpret_cast<Found*>(lp);
        if (!f->render && std::strcmp(cls, "Chrome_RenderWidgetHostHWND") == 0) f->render = c;
        return TRUE;
    }, reinterpret_cast<LPARAM>(&found));
    HWND child = found.render ? found.render : ::GetWindow(hwnd, GW_CHILD);
    if (!child) return;
    describe("target", child);
    HWND now = ::GetFocus();
    describe("focus now", now);
    if (now && now != hwnd) return;  // the focus is already inside the window
    HWND prev = ::SetFocus(child);
    if (diag()) std::fprintf(stderr, "flint-focus: SetFocus -> %s (error %lu)\n", prev || ::GetFocus() == child ? "ok" : "failed",
                             static_cast<unsigned long>(::GetLastError()));
    describe("focus after", ::GetFocus());
}

// Call once, on the UI thread, before the window runs: the hook's calls arrive through
// that thread's message loop.
inline void install() {
    static HWINEVENTHOOK hook = nullptr;
    if (hook) return;
    hook = ::SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, on_foreground,
                             ::GetCurrentProcessId(), 0, WINEVENT_OUTOFCONTEXT);
    if (diag()) std::fprintf(stderr, "flint-focus: hook %s\n", hook ? "installed" : "not installed");
}

}  // namespace flint_focus
#else
namespace flint_focus {
inline void install() {}
}  // namespace flint_focus
#endif
