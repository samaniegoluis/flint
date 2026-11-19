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

namespace flint_focus {

inline void CALLBACK on_foreground(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG id_object, LONG, DWORD, DWORD) {
    if (event != EVENT_SYSTEM_FOREGROUND || id_object != OBJID_WINDOW || !hwnd) return;
    DWORD pid = 0;
    ::GetWindowThreadProcessId(hwnd, &pid);
    if (pid != ::GetCurrentProcessId()) return;
    // A dialog of ours (a file dialog, a message box) keeps its own focus.
    if (::GetWindow(hwnd, GW_OWNER)) return;
    HWND child = ::GetWindow(hwnd, GW_CHILD);
    if (!child) return;
    HWND now = ::GetFocus();
    if (now && now != hwnd) return;  // the focus is already inside the window
    ::SetFocus(child);
}

// Call once, on the UI thread, before the window runs: the hook's calls arrive through
// that thread's message loop.
inline void install() {
    static HWINEVENTHOOK hook = nullptr;
    if (hook) return;
    hook = ::SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, on_foreground,
                             ::GetCurrentProcessId(), 0, WINEVENT_OUTOFCONTEXT);
}

}  // namespace flint_focus
#else
namespace flint_focus {
inline void install() {}
}  // namespace flint_focus
#endif
