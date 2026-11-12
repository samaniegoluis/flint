// CFIRE-UPSTREAM: CF-126, CF-127, CF-128
//
// This computer's monitors, and one window per extra monitor for a remote desktop that
// spans them (milestone 38, D-089). `ext:webui` has one window per App and lists no
// screens (CF-126), so this header reads the monitors per system and opens each extra
// window natively, with its own web view loading `monitor.html` from the app's page
// folder. The extra page talks to the process through its own message handler
// (`flintMonitor`); what it sends reaches the main page as `monitor:message`
// ({ id, data }), and the main page answers through `send`. A window that goes away on
// its own (closed, taken out of full screen) is reported as `monitor:closed` ({ id });
// a change of monitors as `monitors:changed`.
//
// macOS: an NSWindow subclass (FlintMonitorWindow) with a WKWebView and its own app://
// handler serving the page folder, put in the system's full screen on its monitor (its
// own Space, as the main window's, D-088); this needs "Displays have separate Spaces".
// Frames in points, origin at the top-left of the menu-bar screen, y down.
// Linux (X11): a GtkWindow with a WebKitWebView in the default context, where webui
// already serves app://, full screen on its monitor. Wayland is not offered yet.
// Windows (written for the owner's branch, not compiled here): an owned WS_POPUP window
// over the monitor with a WebView2 controller of its own, the page folder mapped to a
// virtual host. The process is made aware of each monitor's DPI (CF-127) before webui
// opens its window, so monitors are read in physical pixels with their own scale and
// the core lays them out in points (domain logical_monitors).
#pragma once
#include "core/webui.hpp"
#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <functional>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#if defined(__APPLE__)
#if defined(__OBJC__)
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <objc/runtime.h>
#endif
#elif defined(_WIN32)
#include <windows.h>
#include <shellscalingapi.h>
#include <wrl.h>
#include <WebView2.h>
#else
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#endif

namespace flint_monitors {

// Where multi-monitor is verified (D-089 (3)): elsewhere the page says "not supported
// on this system yet". Windows turns on once the owner has checked it on his branch.
#if defined(_WIN32)
inline constexpr bool VERIFIED = false;
#else
inline constexpr bool VERIFIED = true;
#endif

inline const char* NOT_YET = "Not supported on this system yet";

struct Monitor {
    std::string id, name;
    int x = 0, y = 0, w = 0, h = 0, scale = 100;
    bool primary = false, physical = false;
};

inline std::mutex& app_mtx() { static std::mutex m; return m; }
inline std::shared_ptr<cfire::webui::App>& app_slot() { static std::shared_ptr<cfire::webui::App> a; return a; }
inline std::string& page_dir() { static std::string d; return d; }

inline std::string jstr(const std::string& s) {
    std::string o = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (static_cast<unsigned char>(c) < 0x20) o += ' ';
        else o += c;
    }
    return o + "\"";
}

// An event to the main page.
inline void to_main(const std::string& event, const std::string& json) {
    std::shared_ptr<cfire::webui::App> app;
    {
        std::lock_guard<std::mutex> g(app_mtx());
        app = app_slot();
    }
    if (app) app->eval("window.__cfire_event_dispatch(" + jstr(event) + "," + json + ");");
}

// A message an extra page sent: passed on as text, never parsed here.
inline void from_window(const std::string& id, const std::string& data) {
    if (data.size() > 65536) return;
    to_main("monitor:message", "{\"id\":" + jstr(id) + ",\"data\":" + jstr(data) + "}");
}

inline void window_gone(const std::string& id) {
    to_main("monitor:closed", "{\"id\":" + jstr(id) + "}");
}

// The script an extra page runs to receive `json` from the main page.
inline std::string deliver_js(const std::string& json) {
    return "window.__flint_monitor && window.__flint_monitor(" + json + ");";
}

// Files the extra pages may load: inside the page folder, no climbing out.
inline bool safe_path(const std::string& p) {
    return !p.empty() && p[0] == '/' && p.find("..") == std::string::npos && p.find('\\') == std::string::npos;
}

inline const char* mime_of(const std::string& p) {
    auto ends = [&](const char* s) { size_t n = std::strlen(s); return p.size() >= n && p.compare(p.size() - n, n, s) == 0; };
    if (ends(".html")) return "text/html";
    if (ends(".js") || ends(".mjs")) return "text/javascript";
    if (ends(".css")) return "text/css";
    if (ends(".svg")) return "image/svg+xml";
    if (ends(".png")) return "image/png";
    if (ends(".woff2")) return "font/woff2";
    if (ends(".woff")) return "font/woff";
    if (ends(".ttf")) return "font/ttf";
    if (ends(".json")) return "application/json";
    if (ends(".wasm")) return "application/wasm";
    return "application/octet-stream";
}

} // namespace flint_monitors

// ---------------------------------------------------------------------------------
#if defined(__APPLE__) && defined(__OBJC__)

@interface FlintMonitorWindow : NSWindow
@property(nonatomic, copy) NSString* flintId;
@property(nonatomic) BOOL flintClosing;
@end
@implementation FlintMonitorWindow
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface FlintMonitorScheme : NSObject <WKURLSchemeHandler>
@end
@implementation FlintMonitorScheme
- (void)webView:(WKWebView*)wv startURLSchemeTask:(id<WKURLSchemeTask>)task {
    (void)wv;
    std::string path = task.request.URL.path ? std::string([task.request.URL.path UTF8String]) : "/";
    if (path == "/" || path.empty()) path = "/monitor.html";
    NSData* data = nil;
    if (flint_monitors::safe_path(path)) {
        std::string full = flint_monitors::page_dir() + path;
        data = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:full.c_str()]];
    }
    NSString* mime = [NSString stringWithUTF8String:flint_monitors::mime_of(path)];
    NSHTTPURLResponse* r = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL statusCode:(data ? 200 : 404)
        HTTPVersion:@"HTTP/1.1" headerFields:@{ @"Content-Type": mime, @"Cache-Control": @"no-store" }];
    [task didReceiveResponse:r];
    [task didReceiveData:(data ? data : [NSData data])];
    [task didFinish];
}
- (void)webView:(WKWebView*)wv stopURLSchemeTask:(id<WKURLSchemeTask>)task { (void)wv; (void)task; }
@end

@interface FlintMonitorMessages : NSObject <WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, copy) NSString* flintId;
@end
@implementation FlintMonitorMessages
- (void)userContentController:(WKUserContentController*)ucc didReceiveScriptMessage:(WKScriptMessage*)msg {
    (void)ucc;
    if (![msg.body isKindOfClass:[NSString class]]) return;
    flint_monitors::from_window(std::string([self.flintId UTF8String]), std::string([(NSString*)msg.body UTF8String]));
}
// The page's load, on stderr: a page that never loads explains a window that never
// says it is ready.
- (void)webView:(WKWebView*)wv didFinishNavigation:(WKNavigation*)nav {
    (void)wv; (void)nav;
    fprintf(stderr, "flint-gui: monitors: the page on monitor %s loaded\n", [self.flintId UTF8String]);
}
- (void)webView:(WKWebView*)wv didFailProvisionalNavigation:(WKNavigation*)nav withError:(NSError*)err {
    (void)wv; (void)nav;
    fprintf(stderr, "flint-gui: monitors: the page on monitor %s failed: %s\n", [self.flintId UTF8String], [[err localizedDescription] UTF8String]);
}
@end

namespace flint_monitors {

struct MacWin {
    FlintMonitorWindow* __strong win = nil;
    WKWebView* __strong view = nil;
};

inline std::map<std::string, MacWin>& wins() { static std::map<std::string, MacWin> m; return m; }

inline void on_ui_sync(void (^body)(void)) {
    if ([NSThread isMainThread]) body(); else dispatch_sync(dispatch_get_main_queue(), body);
}

inline std::string screen_id(NSScreen* s) {
    CGDirectDisplayID did = [[[s deviceDescription] objectForKey:@"NSScreenNumber"] unsignedIntValue];
    return std::to_string(did);
}

inline NSWindow* main_window() {
    for (NSWindow* w in [NSApp windows]) {
        if (![w isKindOfClass:[FlintMonitorWindow class]] && [w isVisible] && [w canBecomeMainWindow]) return w;
    }
    return nil;
}

inline std::vector<Monitor> list() {
    __block std::vector<Monitor> out;
    on_ui_sync(^{
        NSArray<NSScreen*>* screens = [NSScreen screens];
        if ([screens count] == 0) return;
        CGFloat top = NSMaxY([screens[0] frame]);
        for (NSScreen* s in screens) {
            NSRect f = [s frame];
            CGDirectDisplayID did = [[[s deviceDescription] objectForKey:@"NSScreenNumber"] unsignedIntValue];
            Monitor m;
            m.id = std::to_string(did);
            m.name = [[s localizedName] UTF8String];
            m.x = static_cast<int>(f.origin.x);
            m.y = static_cast<int>(top - NSMaxY(f));
            m.w = static_cast<int>(NSWidth(f));
            m.h = static_cast<int>(NSHeight(f));
            m.scale = static_cast<int>([s backingScaleFactor] * 100);
            m.primary = CGDisplayIsMain(did);
            out.push_back(m);
        }
    });
    return out;
}

inline std::string main_id() {
    __block std::string id;
    on_ui_sync(^{
        NSWindow* w = main_window();
        NSScreen* s = w ? [w screen] : [NSScreen mainScreen];
        if (s) id = screen_id(s);
    });
    return id;
}

inline std::string unsupported() {
    if (!VERIFIED) return NOT_YET;
    __block bool separate = true;
    on_ui_sync(^{ separate = [NSScreen screensHaveSeparateSpaces]; });
    if (!separate) return "Turn on \"Displays have separate Spaces\" in System Settings → Desktop & Dock";
    return "";
}

inline NSScreen* screen_of(const std::string& id) {
    for (NSScreen* s in [NSScreen screens]) {
        if (screen_id(s) == id) return s;
    }
    return nil;
}

inline void close_one(const std::string& id) {
    auto it = wins().find(id);
    if (it == wins().end()) return;
    FlintMonitorWindow* w = it->second.win;
    WKWebView* v = it->second.view;
    wins().erase(it);
    w.flintClosing = YES;
    [v.configuration.userContentController removeScriptMessageHandlerForName:@"flintMonitor"];
    if (([w styleMask] & NSWindowStyleMaskFullScreen) != 0) {
        // Out of its Space first, then closed once macOS has moved it back.
        [w toggleFullScreen:nil];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(900 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{ [w orderOut:nil]; [w close]; });
    } else {
        [w orderOut:nil];
        [w close];
    }
}

inline void hear_window(FlintMonitorWindow* w) {
    NSNotificationCenter* nc = [NSNotificationCenter defaultCenter];
    __weak FlintMonitorWindow* weak = w;
    auto gone = ^(NSNotification*) {
        FlintMonitorWindow* s = weak;
        if (!s || s.flintClosing) return;
        std::string id([s.flintId UTF8String]);
        s.flintClosing = YES;
        dispatch_async(dispatch_get_main_queue(), ^{ close_one(id); window_gone(id); });
    };
    [nc addObserverForName:NSWindowWillCloseNotification object:w queue:nil usingBlock:gone];
    [nc addObserverForName:NSWindowDidExitFullScreenNotification object:w queue:nil usingBlock:gone];
}

// Opens a full-screen window on each monitor of `ids` that has none, and closes the
// windows on monitors no longer listed.
inline void open(const std::vector<std::string>& ids) {
    std::vector<std::string> want = ids;
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
        std::vector<std::string> stale;
        for (auto& [id, mw] : wins()) {
            if (std::find(want.begin(), want.end(), id) == want.end()) stale.push_back(id);
        }
        for (auto& id : stale) close_one(id);
        for (const auto& id : want) {
            if (wins().count(id)) continue;
            NSScreen* s = screen_of(id);
            fprintf(stderr, "flint-gui: monitors: a window on monitor %s%s\n", id.c_str(), s ? "" : " (gone)");
            if (!s) { window_gone(id); continue; }
            NSRect vf = [s visibleFrame];
            FlintMonitorWindow* w = [[FlintMonitorWindow alloc] initWithContentRect:NSInsetRect(vf, 80, 80)
                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
                backing:NSBackingStoreBuffered defer:NO screen:s];
            w.flintId = [NSString stringWithUTF8String:id.c_str()];
            [w setReleasedWhenClosed:NO];
            [w setTitle:@"Flint"];
            [w setBackgroundColor:[NSColor blackColor]];
            [w setCollectionBehavior:NSWindowCollectionBehaviorFullScreenPrimary];
            WKWebViewConfiguration* cfg = [[WKWebViewConfiguration alloc] init];
            [cfg setURLSchemeHandler:[[FlintMonitorScheme alloc] init] forURLScheme:@"app"];
            WKUserContentController* ucc = [[WKUserContentController alloc] init];
            FlintMonitorMessages* handler = [[FlintMonitorMessages alloc] init];
            handler.flintId = w.flintId;
            [ucc addScriptMessageHandler:handler name:@"flintMonitor"];
            cfg.userContentController = ucc;
            WKWebView* v = [[WKWebView alloc] initWithFrame:[[w contentView] bounds] configuration:cfg];
            [v setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
            [w setContentView:v];
            [v setNavigationDelegate:handler];
            objc_setAssociatedObject(v, "flintNav", handler, OBJC_ASSOCIATION_RETAIN);
            std::string url = "app://localhost/monitor.html?id=" + id;
            [v loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]]]];
            wins()[id] = MacWin{ w, v };
            hear_window(w);
            [w setFrame:NSInsetRect(vf, 80, 80) display:YES];
            [w orderFront:nil];
            dispatch_async(dispatch_get_main_queue(), ^{ [w toggleFullScreen:nil]; });
        }
        // The main window keeps the keyboard.
        NSWindow* m = main_window();
        if (m) [m makeKeyAndOrderFront:nil];
    }});
}

inline void close_all() {
    dispatch_async(dispatch_get_main_queue(), ^{
        std::vector<std::string> ids;
        for (auto& [id, mw] : wins()) ids.push_back(id);
        for (auto& id : ids) close_one(id);
    });
}

inline void send(const std::string& id, const std::string& json) {
    std::string js = deliver_js(json);
    std::string target = id;
    dispatch_async(dispatch_get_main_queue(), ^{
        for (auto& [wid, mw] : wins()) {
            if (!target.empty() && wid != target) continue;
            [mw.view evaluateJavaScript:[NSString stringWithUTF8String:js.c_str()] completionHandler:nil];
        }
    });
}

inline void hear_screens() {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:nil
            usingBlock:^(NSNotification*) { to_main("monitors:changed", "{}"); }];
    });
}

} // namespace flint_monitors

// ---------------------------------------------------------------------------------
#elif defined(__APPLE__)
// Read as plain C++ (cfire's own pass over the header): the Objective-C++ build above
// is the one that runs.
namespace flint_monitors {
inline std::vector<Monitor> list() { return {}; }
inline std::string main_id() { return ""; }
inline std::string unsupported() { return NOT_YET; }
inline void open(const std::vector<std::string>&) {}
inline void close_all() {}
inline void send(const std::string&, const std::string&) {}
inline void hear_screens() {}
} // namespace flint_monitors

// ---------------------------------------------------------------------------------
#elif defined(_WIN32)
// Written for the owner's branch (the Windows port), not compiled here.
namespace flint_monitors {

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

struct WinWin {
    HWND hwnd = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> view;
};

inline std::map<std::string, WinWin>& wins() { static std::map<std::string, WinWin> m; return m; }
inline ComPtr<ICoreWebView2Environment>& env() { static ComPtr<ICoreWebView2Environment> e; return e; }
inline DWORD& ui_thread() { static DWORD t = 0; return t; }

inline std::wstring widen(const std::string& s) {
    if (s.empty()) return L"";
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

inline std::string narrow(const wchar_t* w) {
    if (!w) return "";
    int n = ::WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
    if (n > 1) ::WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

// Flint's main window: the visible, unowned top-level window of this process (the
// extra windows are owned by it, so they never match).
inline HWND main_hwnd() {
    struct Find { HWND hwnd = nullptr; DWORD pid = 0; } f{ nullptr, ::GetCurrentProcessId() };
    ::EnumWindows([](HWND h, LPARAM lp) -> BOOL {
        auto* f = reinterpret_cast<Find*>(lp);
        DWORD pid = 0;
        ::GetWindowThreadProcessId(h, &pid);
        if (pid == f->pid && ::IsWindowVisible(h) && !::GetWindow(h, GW_OWNER)) { f->hwnd = h; return FALSE; }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&f));
    return f.hwnd;
}

// A hidden message-only window of ours on webui's UI thread (made by `install`, before
// the window runs, on that thread): calls posted to it run there, where windows and
// WebView2 must be made. webui's own window procedure is left alone.
inline UINT run_msg() { static UINT m = ::RegisterWindowMessageW(L"FlintMonitorsRun"); return m; }
inline HWND& helper() { static HWND h = nullptr; return h; }

inline LRESULT CALLBACK helper_proc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == run_msg()) {
        auto* f = reinterpret_cast<std::function<void()>*>(l);
        (*f)();
        delete f;
        return 0;
    }
    return ::DefWindowProcW(h, m, w, l);
}

inline void make_helper() {
    WNDCLASSW wc{};
    wc.lpfnWndProc = helper_proc;
    wc.hInstance = ::GetModuleHandleW(nullptr);
    wc.lpszClassName = L"FlintMonitorsHelper";
    ::RegisterClassW(&wc);
    helper() = ::CreateWindowExW(0, L"FlintMonitorsHelper", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, wc.hInstance, nullptr);
}

template <typename F>
inline void on_ui(F fn) {
    if (!helper()) return;
    if (::GetCurrentThreadId() == ::GetWindowThreadProcessId(helper(), nullptr)) { fn(); return; }
    auto* p = new std::function<void()>(std::move(fn));
    ::PostMessageW(helper(), run_msg(), 0, reinterpret_cast<LPARAM>(p));
}

struct EnumAcc { std::vector<Monitor> list; };

inline std::vector<Monitor> list() {
    EnumAcc acc;
    ::EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR hm, HDC, LPRECT, LPARAM lp) -> BOOL {
        auto* a = reinterpret_cast<EnumAcc*>(lp);
        MONITORINFOEXW mi{};
        mi.cbSize = sizeof(mi);
        ::GetMonitorInfoW(hm, &mi);
        UINT dx = 96, dy = 96;
        ::GetDpiForMonitor(hm, MDT_EFFECTIVE_DPI, &dx, &dy);
        Monitor m;
        m.id = narrow(mi.szDevice);
        m.name = m.id;
        m.x = mi.rcMonitor.left;
        m.y = mi.rcMonitor.top;
        m.w = mi.rcMonitor.right - mi.rcMonitor.left;
        m.h = mi.rcMonitor.bottom - mi.rcMonitor.top;
        m.scale = static_cast<int>(dx * 100 / 96);
        m.primary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0;
        m.physical = true;
        a->list.push_back(m);
        return TRUE;
    }, reinterpret_cast<LPARAM>(&acc));
    return acc.list;
}

inline std::string main_id() {
    HWND m = main_hwnd();
    if (!m) return "";
    MONITORINFOEXW mi{};
    mi.cbSize = sizeof(mi);
    ::GetMonitorInfoW(::MonitorFromWindow(m, MONITOR_DEFAULTTONEAREST), &mi);
    return narrow(mi.szDevice);
}

inline std::string unsupported() { return VERIFIED ? "" : NOT_YET; }

inline bool monitor_rect(const std::string& id, RECT& r) {
    for (const auto& m : list()) {
        if (m.id == id) { r = RECT{ m.x, m.y, m.x + m.w, m.y + m.h }; return true; }
    }
    return false;
}

inline LRESULT CALLBACK win_proc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_SIZE) {
        for (auto& [id, w] : wins()) {
            if (w.hwnd == h && w.controller) {
                RECT rc;
                ::GetClientRect(h, &rc);
                w.controller->put_Bounds(rc);
            }
        }
    }
    if (msg == WM_CLOSE) {
        for (auto& [id, w] : wins()) {
            if (w.hwnd == h) { std::string gone = id; wins().erase(id); ::DestroyWindow(h); window_gone(gone); return 0; }
        }
    }
    return ::DefWindowProcW(h, msg, wp, lp);
}

inline void close_one(const std::string& id) {
    auto it = wins().find(id);
    if (it == wins().end()) return;
    if (it->second.controller) it->second.controller->Close();
    HWND h = it->second.hwnd;
    wins().erase(it);
    if (h) ::DestroyWindow(h);
}

inline void attach_view(const std::string& id) {
    auto it = wins().find(id);
    if (it == wins().end() || !env()) return;
    HWND h = it->second.hwnd;
    env()->CreateCoreWebView2Controller(h, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
        [id, h](HRESULT hr, ICoreWebView2Controller* c) -> HRESULT {
            auto it = wins().find(id);
            if (FAILED(hr) || !c || it == wins().end()) return S_OK;
            it->second.controller = c;
            c->get_CoreWebView2(&it->second.view);
            RECT rc;
            ::GetClientRect(h, &rc);
            c->put_Bounds(rc);
            ComPtr<ICoreWebView2_3> v3;
            if (SUCCEEDED(it->second.view.As(&v3))) {
                v3->SetVirtualHostNameToFolderMapping(L"flint-monitor.localhost", widen(page_dir()).c_str(),
                                                      COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
            }
            EventRegistrationToken tok;
            it->second.view->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [id](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    LPWSTR s = nullptr;
                    if (SUCCEEDED(args->TryGetWebMessageAsString(&s)) && s) {
                        from_window(id, narrow(s));
                        ::CoTaskMemFree(s);
                    }
                    return S_OK;
                }).Get(), &tok);
            std::wstring url = L"https://flint-monitor.localhost/monitor.html?id=" + widen(id);
            it->second.view->Navigate(url.c_str());
            return S_OK;
        }).Get());
}

inline void open(const std::vector<std::string>& ids) {
    std::vector<std::string> want = ids;
    on_ui([want] {
        std::vector<std::string> stale;
        for (auto& [id, w] : wins()) {
            if (std::find(want.begin(), want.end(), id) == want.end()) stale.push_back(id);
        }
        for (auto& id : stale) close_one(id);
        static bool registered = false;
        if (!registered) {
            WNDCLASSW wc{};
            wc.lpfnWndProc = win_proc;
            wc.hInstance = ::GetModuleHandleW(nullptr);
            wc.lpszClassName = L"FlintMonitorWindow";
            wc.hbrBackground = static_cast<HBRUSH>(::GetStockObject(BLACK_BRUSH));
            ::RegisterClassW(&wc);
            registered = true;
        }
        HWND owner = main_hwnd();
        for (const auto& id : want) {
            if (wins().count(id)) continue;
            RECT r;
            if (!monitor_rect(id, r)) { window_gone(id); continue; }
            HWND h = ::CreateWindowExW(WS_EX_APPWINDOW, L"FlintMonitorWindow", L"Flint", WS_POPUP | WS_VISIBLE,
                                       r.left, r.top, r.right - r.left, r.bottom - r.top, owner, nullptr,
                                       ::GetModuleHandleW(nullptr), nullptr);
            wins()[id] = WinWin{ h, nullptr, nullptr };
        }
        auto attach_all = [want] {
            for (const auto& id : want) {
                auto it = wins().find(id);
                if (it != wins().end() && !it->second.controller) attach_view(id);
            }
        };
        if (env()) { attach_all(); return; }
        wchar_t local[MAX_PATH] = {};
        ::GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH);
        std::wstring data = std::wstring(local) + L"\\Flint\\WebView2-monitors";
        ::CreateCoreWebView2EnvironmentWithOptions(nullptr, data.c_str(), nullptr,
            Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [attach_all](HRESULT hr, ICoreWebView2Environment* e) -> HRESULT {
                    if (SUCCEEDED(hr) && e) { env() = e; attach_all(); }
                    return S_OK;
                }).Get());
        if (owner) ::SetForegroundWindow(owner);
    });
}

inline void close_all() {
    on_ui([] {
        std::vector<std::string> ids;
        for (auto& [id, w] : wins()) ids.push_back(id);
        for (auto& id : ids) close_one(id);
    });
}

inline void send(const std::string& id, const std::string& json) {
    std::wstring js = widen(deliver_js(json));
    std::string target = id;
    on_ui([js, target] {
        for (auto& [wid, w] : wins()) {
            if ((!target.empty() && wid != target) || !w.view) continue;
            w.view->ExecuteScript(js.c_str(), nullptr);
        }
    });
}

inline void hear_screens() {}

} // namespace flint_monitors

// ---------------------------------------------------------------------------------
#elif !defined(__APPLE__)
namespace flint_monitors {

struct GtkWin {
    GtkWidget* win = nullptr;
    WebKitWebView* view = nullptr;
};

inline std::map<std::string, GtkWin>& wins() { static std::map<std::string, GtkWin> m; return m; }

template <typename F>
inline void on_ui(F f) {
    auto* p = new F(std::move(f));
    g_idle_add(+[](gpointer d) -> gboolean { auto* fp = static_cast<F*>(d); (*fp)(); delete fp; return G_SOURCE_REMOVE; }, p);
}

template <typename F>
inline void on_ui_sync(F f) {
    if (g_main_context_is_owner(g_main_context_default())) { f(); return; }
    std::mutex m;
    std::condition_variable cv;
    bool done = false;
    on_ui([&] { f(); std::lock_guard<std::mutex> g(m); done = true; cv.notify_one(); });
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [&] { return done; });
}

// A monitor's id while it stays where it is: its model and its place.
inline std::string monitor_id(GdkMonitor* m) {
    GdkRectangle g;
    gdk_monitor_get_geometry(m, &g);
    const char* model = gdk_monitor_get_model(m);
    return std::string(model ? model : "monitor") + "@" + std::to_string(g.x) + "," + std::to_string(g.y);
}

inline bool is_monitor_window(GtkWidget* w) { return g_object_get_data(G_OBJECT(w), "flint-monitor") != nullptr; }

inline GtkWidget* main_widget() {
    GtkWidget* found = nullptr;
    GList* tops = gtk_window_list_toplevels();
    for (GList* l = tops; l; l = l->next) {
        GtkWidget* w = GTK_WIDGET(l->data);
        if (gtk_widget_get_visible(w) && !is_monitor_window(w) && gtk_window_get_window_type(GTK_WINDOW(w)) == GTK_WINDOW_TOPLEVEL) {
            found = w;
            break;
        }
    }
    g_list_free(tops);
    return found;
}

inline std::vector<Monitor> list() {
    std::vector<Monitor> out;
    on_ui_sync([&] {
        GdkDisplay* d = gdk_display_get_default();
        int n = gdk_display_get_n_monitors(d);
        for (int i = 0; i < n; ++i) {
            GdkMonitor* gm = gdk_display_get_monitor(d, i);
            GdkRectangle g;
            gdk_monitor_get_geometry(gm, &g);
            Monitor m;
            m.id = monitor_id(gm);
            const char* model = gdk_monitor_get_model(gm);
            m.name = model ? model : "Monitor";
            m.x = g.x; m.y = g.y; m.w = g.width; m.h = g.height;
            m.scale = gdk_monitor_get_scale_factor(gm) * 100;
            m.primary = gdk_monitor_is_primary(gm);
            out.push_back(m);
        }
    });
    return out;
}

inline std::string main_id() {
    std::string id;
    on_ui_sync([&] {
        GtkWidget* w = main_widget();
        GdkDisplay* d = gdk_display_get_default();
        GdkMonitor* m = nullptr;
        if (w && gtk_widget_get_window(w)) m = gdk_display_get_monitor_at_window(d, gtk_widget_get_window(w));
        if (!m) m = gdk_display_get_primary_monitor(d);
        if (!m && gdk_display_get_n_monitors(d) > 0) m = gdk_display_get_monitor(d, 0);
        if (m) id = monitor_id(m);
    });
    return id;
}

inline std::string unsupported() {
    if (!VERIFIED) return NOT_YET;
    std::string why;
    on_ui_sync([&] {
        GdkDisplay* d = gdk_display_get_default();
        // X11 is verified; Wayland waits for a real check (D-089 (3)).
        if (!d || std::strcmp(G_OBJECT_TYPE_NAME(d), "GdkX11Display") != 0) why = NOT_YET;
    });
    return why;
}

inline void on_msg(WebKitUserContentManager*, WebKitJavascriptResult* r, gpointer data) {
    JSCValue* v = webkit_javascript_result_get_js_value(r);
    if (!v || !jsc_value_is_string(v)) return;
    char* s = jsc_value_to_string(v);
    from_window(static_cast<const char*>(data), s);
    g_free(s);
}

inline void close_one(const std::string& id) {
    auto it = wins().find(id);
    if (it == wins().end()) return;
    GtkWidget* w = it->second.win;
    wins().erase(it);
    g_object_set_data(G_OBJECT(w), "flint-closing", GINT_TO_POINTER(1));
    gtk_widget_destroy(w);
}

inline int gdk_monitor_number(const std::string& id) {
    GdkDisplay* d = gdk_display_get_default();
    int n = gdk_display_get_n_monitors(d);
    for (int i = 0; i < n; ++i) {
        if (monitor_id(gdk_display_get_monitor(d, i)) == id) return i;
    }
    return -1;
}

inline void open(const std::vector<std::string>& ids) {
    std::vector<std::string> want = ids;
    on_ui([want] {
        std::vector<std::string> stale;
        for (auto& [id, w] : wins()) {
            if (std::find(want.begin(), want.end(), id) == want.end()) stale.push_back(id);
        }
        for (auto& id : stale) close_one(id);
        for (const auto& id : want) {
            if (wins().count(id)) continue;
            int idx = gdk_monitor_number(id);
            fprintf(stderr, "flint-gui: monitors: a window on monitor %s%s\n", id.c_str(), idx < 0 ? " (gone)" : "");
            if (idx < 0) { window_gone(id); continue; }
            GdkRectangle g;
            gdk_monitor_get_geometry(gdk_display_get_monitor(gdk_display_get_default(), idx), &g);
            GtkWidget* w = gtk_window_new(GTK_WINDOW_TOPLEVEL);
            g_object_set_data(G_OBJECT(w), "flint-monitor", GINT_TO_POINTER(1));
            gtk_window_set_title(GTK_WINDOW(w), "Flint");
            gtk_window_set_decorated(GTK_WINDOW(w), FALSE);
            WebKitUserContentManager* ucm = webkit_user_content_manager_new();
            char* key = g_strdup(id.c_str());
            g_object_set_data_full(G_OBJECT(w), "flint-id", key, g_free);
            g_signal_connect(ucm, "script-message-received::flintMonitor", G_CALLBACK(on_msg), key);
            webkit_user_content_manager_register_script_message_handler(ucm, "flintMonitor");
            // The default WebKitWebContext, where webui serves app:// from the page folder.
            GtkWidget* v = webkit_web_view_new_with_user_content_manager(ucm);
            gtk_container_add(GTK_CONTAINER(w), v);
            std::string url = "app://localhost/monitor.html?id=" + id;
            webkit_web_view_load_uri(WEBKIT_WEB_VIEW(v), url.c_str());
            g_signal_connect(w, "destroy", G_CALLBACK(+[](GtkWidget* self, gpointer) {
                if (g_object_get_data(G_OBJECT(self), "flint-closing")) return;
                const char* wid = static_cast<const char*>(g_object_get_data(G_OBJECT(self), "flint-id"));
                if (!wid) return;
                std::string gone = wid;
                wins().erase(gone);
                window_gone(gone);
            }), nullptr);
            wins()[id] = GtkWin{ w, WEBKIT_WEB_VIEW(v) };
            gtk_window_move(GTK_WINDOW(w), g.x, g.y);
            gtk_window_resize(GTK_WINDOW(w), g.width, g.height);
            gtk_widget_show_all(w);
            gtk_window_fullscreen_on_monitor(GTK_WINDOW(w), gtk_widget_get_screen(w), idx);
        }
        // The main window keeps the keyboard.
        if (GtkWidget* m = main_widget()) gtk_window_present(GTK_WINDOW(m));
    });
}

inline void close_all() {
    on_ui([] {
        std::vector<std::string> ids;
        for (auto& [id, w] : wins()) ids.push_back(id);
        for (auto& id : ids) close_one(id);
    });
}

inline void send(const std::string& id, const std::string& json) {
    std::string js = deliver_js(json);
    std::string target = id;
    on_ui([js, target] {
        for (auto& [wid, w] : wins()) {
            if (!target.empty() && wid != target) continue;
#if WEBKIT_CHECK_VERSION(2, 40, 0)
            webkit_web_view_evaluate_javascript(w.view, js.c_str(), -1, nullptr, nullptr, nullptr, nullptr, nullptr);
#else
            webkit_web_view_run_javascript(w.view, js.c_str(), nullptr, nullptr, nullptr);
#endif
        }
    });
}

inline void hear_screens() {
    on_ui([] {
        GdkDisplay* d = gdk_display_get_default();
        auto changed = +[](GdkDisplay*, GdkMonitor*, gpointer) { to_main("monitors:changed", "{}"); };
        g_signal_connect(d, "monitor-added", G_CALLBACK(changed), nullptr);
        g_signal_connect(d, "monitor-removed", G_CALLBACK(changed), nullptr);
    });
}

} // namespace flint_monitors
#endif

namespace flint_monitors {

// Keeps the app and the page folder. Call once, before the window runs: on Windows the
// process becomes aware of each monitor's DPI before webui opens its window (CF-127).
inline void install(const cfire::webui::App& app, const std::string& dir) {
    {
        std::lock_guard<std::mutex> g(app_mtx());
        app_slot() = std::make_shared<cfire::webui::App>(app);
        page_dir() = dir;
    }
#if defined(_WIN32)
    ::SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    make_helper();
#endif
    hear_screens();
}

// The monitors as lines of tab-separated fields (id, name, x, y, w, h, scale,
// primary, physical), for the cfire side to read.
inline std::string list_text() {
    auto clean = [](std::string v) {
        for (auto& c : v) if (c == '\t' || c == '\n' || c == '\r') c = ' ';
        return v;
    };
    std::string out;
    for (const auto& m : list()) {
        out += clean(m.id) + "\t" + clean(m.name) + "\t" + std::to_string(m.x) + "\t" + std::to_string(m.y) + "\t" +
               std::to_string(m.w) + "\t" + std::to_string(m.h) + "\t" + std::to_string(m.scale) + "\t" +
               (m.primary ? "1" : "0") + "\t" + (m.physical ? "1" : "0") + "\n";
    }
    return out;
}

// Ids joined by '\n' (no id holds one).
inline void open_text(const std::string& ids) {
    std::vector<std::string> v;
    size_t at = 0;
    while (at <= ids.size()) {
        size_t end = ids.find('\n', at);
        if (end == std::string::npos) end = ids.size();
        if (end > at) v.push_back(ids.substr(at, end - at));
        at = end + 1;
    }
    open(v);
}

} // namespace flint_monitors
