// CFIRE-UPSTREAM: CF-179
//
// Windows (milestone 50): whether the WebView2 Runtime the window needs is installed,
// asked of Microsoft's loader beside Flint.exe (GetAvailableCoreWebView2BrowserVersion
// String, which honours WEBVIEW2_BROWSER_EXECUTABLE_FOLDER), before ext:webui opens a
// window that would stay empty; and a plain message box that offers the download page.
// Elsewhere the webview is the system's (WKWebView, WebKitGTK): always "ok".
#pragma once
#include <string>
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <objbase.h>
#endif

namespace flint_webview_runtime {

// "ok", "loader" (WebView2Loader.dll is not beside the app) or "runtime" (no runtime).
inline std::string check(std::string& version) {
#if defined(_WIN32)
    HMODULE mod = ::LoadLibraryW(L"WebView2Loader.dll");
    if (!mod) return "loader";
    using GetVersion = HRESULT(STDAPICALLTYPE*)(PCWSTR, LPWSTR*);
    auto fn = reinterpret_cast<GetVersion>(reinterpret_cast<void*>(::GetProcAddress(mod, "GetAvailableCoreWebView2BrowserVersionString")));
    if (!fn) return "loader";
    LPWSTR v = nullptr;
    HRESULT hr = fn(nullptr, &v);
    if (FAILED(hr) || !v) return "runtime";
    int n = ::WideCharToMultiByte(CP_UTF8, 0, v, -1, nullptr, 0, nullptr, nullptr);
    if (n > 1) {
        version.assign(static_cast<size_t>(n - 1), '\0');
        ::WideCharToMultiByte(CP_UTF8, 0, v, -1, version.data(), n, nullptr, nullptr);
    }
    ::CoTaskMemFree(v);
    return "ok";
#else
    (void)version;
    return "ok";
#endif
}

inline std::wstring widen(const std::string& s) {
#if defined(_WIN32)
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(static_cast<size_t>(n > 0 ? n - 1 : 0), L'\0');
    if (n > 1) ::MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
    return w;
#else
    return std::wstring(s.begin(), s.end());
#endif
}

// A Yes/No box; Yes opens `url` in the default browser. Returns whether Yes was chosen.
inline bool ask_and_open(const std::string& title, const std::string& text, const std::string& url) {
#if defined(_WIN32)
    int r = ::MessageBoxW(nullptr, widen(text).c_str(), widen(title).c_str(), MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND);
    if (r != IDYES) return false;
    if (!url.empty()) ::ShellExecuteW(nullptr, L"open", widen(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    return true;
#else
    (void)title; (void)text; (void)url;
    return false;
#endif
}

// An OK box, for what has no page to open.
inline void tell(const std::string& title, const std::string& text) {
#if defined(_WIN32)
    ::MessageBoxW(nullptr, widen(text).c_str(), widen(title).c_str(), MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
#else
    (void)title; (void)text;
#endif
}

}  // namespace flint_webview_runtime
