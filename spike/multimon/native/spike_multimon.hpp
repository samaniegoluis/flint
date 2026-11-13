// THROWAWAY SPIKE (milestone 38). Not product code; never imported by src/.
//
// Questions:
//   1. Can a second native window with its own web view live in the same process as
//      ext:webui's one window, load the same app:// page files, talk to the process both
//      ways, and sit borderless or full screen on another monitor?
//   2. What does each OS say about every monitor: position, size, orientation, scale,
//      and the notch's inset?
//
// ext:webui has one window per App and keeps its AppState (the app:// files, the RPC
// table, the eval target) private, so the second window here is built natively:
//   macOS: an NSWindow (a subclass, so a borderless one can become key) with its own
//          WKWebView, its own app:// scheme handler serving the same ui/ folder, and its
//          own script message handler `spike2`.
//   Linux: a GtkWindow with its own WebKitWebView in the default WebKitWebContext, where
//          ext:webui already registered app://, and its own message handler `spike2`.
//   Windows: monitors only (written, not compiled here); see the report.
#pragma once
#include "core/webui.hpp"
#include <atomic>
#include <filesystem>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>

#if defined(__APPLE__)
#if defined(__OBJC__)
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CoreGraphics.h>
#endif
#elif defined(_WIN32)
#include <windows.h>
#include <shellscalingapi.h>
#else
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#endif

namespace spike_mm {

inline std::mutex& app_mtx() { static std::mutex m; return m; }
inline std::shared_ptr<cfire::webui::App>& app_slot() { static std::shared_ptr<cfire::webui::App> a; return a; }
inline std::string& ui_dir() { static std::string d; return d; }

inline std::string jstr(const std::string& s) {
    std::string o = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (static_cast<unsigned char>(c) < 0x20) o += ' ';
        else o += c;
    }
    return o + "\"";
}

// Sends an event to ext:webui's own (main) window.
inline void to_main(const std::string& event, const std::string& json) {
    std::shared_ptr<cfire::webui::App> app;
    { std::lock_guard<std::mutex> g(app_mtx()); app = app_slot(); }
    if (app) app->eval("window.__cfire_event_dispatch(" + jstr(event) + "," + json + ");");
}

inline void install(const cfire::webui::App& app, const std::string& dir) {
    std::lock_guard<std::mutex> g(app_mtx());
    app_slot() = std::make_shared<cfire::webui::App>(app);
    ui_dir() = std::filesystem::absolute(dir).string();
}

// ---------------------------------------------------------------------------------
#if defined(__APPLE__) && defined(__OBJC__)
} // namespace spike_mm

@interface SpikeKeyWindow : NSWindow
@end
@implementation SpikeKeyWindow
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return YES; }
@end

@interface SpikeSchemeHandler : NSObject <WKURLSchemeHandler>
@end
@implementation SpikeSchemeHandler
- (void)webView:(WKWebView*)wv startURLSchemeTask:(id<WKURLSchemeTask>)task {
    (void)wv;
    NSString* path = task.request.URL.path;
    if (!path || [path length] == 0 || [path isEqualToString:@"/"]) path = @"/second.html";
    NSString* dir = [NSString stringWithUTF8String:spike_mm::ui_dir().c_str()];
    NSString* full = [dir stringByAppendingPathComponent:path];
    NSData* data = [NSData dataWithContentsOfFile:full];
    NSString* mime = [path hasSuffix:@".html"] ? @"text/html" : ([path hasSuffix:@".js"] ? @"text/javascript" : @"text/plain");
    NSHTTPURLResponse* r = [[NSHTTPURLResponse alloc] initWithURL:task.request.URL statusCode:(data ? 200 : 404)
        HTTPVersion:@"HTTP/1.1" headerFields:@{ @"Content-Type": mime, @"Cache-Control": @"no-store" }];
    [task didReceiveResponse:r];
    [task didReceiveData:(data ? data : [NSData data])];
    [task didFinish];
}
- (void)webView:(WKWebView*)wv stopURLSchemeTask:(id<WKURLSchemeTask>)task { (void)wv; (void)task; }
@end

@interface SpikeMsgHandler : NSObject <WKScriptMessageHandler>
@end
@implementation SpikeMsgHandler
- (void)userContentController:(WKUserContentController*)ucc didReceiveScriptMessage:(WKScriptMessage*)msg {
    (void)ucc;
    NSString* body = [msg.body isKindOfClass:[NSString class]] ? (NSString*)msg.body : @"{}";
    // The second page's message reaches the main page through the process.
    spike_mm::to_main("second:msg", std::string([body UTF8String]));
}
@end

namespace spike_mm {

inline SpikeKeyWindow* __strong& second_win() { static SpikeKeyWindow* __strong w = nil; return w; }
inline WKWebView* __strong& second_view() { static WKWebView* __strong v = nil; return v; }

inline NSWindow* main_window() {
    for (NSWindow* w in [NSApp windows]) {
        if (w != second_win() && [w isVisible] && [w canBecomeMainWindow]) return w;
    }
    return nil;
}

inline NSScreen* screen_at(int i) {
    NSArray<NSScreen*>* s = [NSScreen screens];
    if (i < 0 || i >= (int)[s count]) return [NSScreen mainScreen];
    return s[i];
}

inline std::string monitors_json() {
    __block std::string out;
    auto body = ^{
        NSArray<NSScreen*>* screens = [NSScreen screens];
        // Cocoa: points, origin at the bottom-left of screens[0] (the menu-bar screen), y up.
        CGFloat ph = NSHeight([screens[0] frame]);
        NSWindow* mw = main_window();
        NSScreen* mws = mw ? [mw screen] : nil;
        std::ostringstream o;
        o << "[";
        for (NSUInteger i = 0; i < [screens count]; ++i) {
            NSScreen* s = screens[i];
            NSRect f = [s frame];
            NSRect v = [s visibleFrame];
            CGDirectDisplayID did = [[[s deviceDescription] objectForKey:@"NSScreenNumber"] unsignedIntValue];
            double rot = CGDisplayRotation(did);
            CGSize mm = CGDisplayScreenSize(did);
            CGDisplayModeRef mode = CGDisplayCopyDisplayMode(did);
            size_t pw = mode ? CGDisplayModeGetPixelWidth(mode) : 0;
            size_t phh = mode ? CGDisplayModeGetPixelHeight(mode) : 0;
            double hz = mode ? CGDisplayModeGetRefreshRate(mode) : 0;
            if (mode) CGDisplayModeRelease(mode);
            CGFloat notch = 0;
            if (@available(macOS 12.0, *)) notch = [s safeAreaInsets].top;
            CGFloat menu = NSMaxY(f) - NSMaxY(v);  // menu bar (+ notch) at the top
            if (i > 0) o << ",";
            o << "{\"index\":" << i
              << ",\"name\":" << jstr([[s localizedName] UTF8String])
              << ",\"id\":" << did
              << ",\"x\":" << (int)f.origin.x << ",\"y\":" << (int)(ph - NSMaxY(f))
              << ",\"w\":" << (int)NSWidth(f) << ",\"h\":" << (int)NSHeight(f)
              << ",\"scale\":" << [s backingScaleFactor]
              << ",\"px_w\":" << pw << ",\"px_h\":" << phh << ",\"hz\":" << hz
              << ",\"rotation\":" << rot
              << ",\"orientation\":\"" << (NSWidth(f) >= NSHeight(f) ? "landscape" : "portrait") << "\""
              << ",\"mm_w\":" << (int)mm.width << ",\"mm_h\":" << (int)mm.height
              << ",\"notch_top\":" << notch << ",\"menu_top\":" << menu
              << ",\"primary\":" << (CGDisplayIsMain(did) ? "true" : "false")
              << ",\"builtin\":" << (CGDisplayIsBuiltin(did) ? "true" : "false")
              << ",\"main_window_here\":" << (s == mws ? "true" : "false")
              << "}";
        }
        o << "]";
        out = o.str();
    };
    if ([NSThread isMainThread]) body(); else dispatch_sync(dispatch_get_main_queue(), body);
    return out;
}

// mode: "borderless" covers the whole screen (menu bar and notch included) above the
// menu bar; "native" the system's full screen (its own Space on that display);
// "window" a normal titled window on that screen (an RDP tab in a window of its own).
inline void place(NSWindow* w, NSScreen* s, const std::string& mode) {
    NSRect f = [s frame];
    if (mode == "borderless") {
        [w setStyleMask:NSWindowStyleMaskBorderless];
        [w setLevel:NSMainMenuWindowLevel + 1];
        [w setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary];
        [w setFrame:f display:YES];
    } else if (mode == "native") {
        [w setStyleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable];
        [w setLevel:NSNormalWindowLevel];
        [w setCollectionBehavior:NSWindowCollectionBehaviorFullScreenPrimary];
        [w setFrame:NSInsetRect([s visibleFrame], 80, 80) display:YES];
        [w makeKeyAndOrderFront:nil];
        dispatch_async(dispatch_get_main_queue(), ^{ [w toggleFullScreen:nil]; });
    } else {
        [w setStyleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable];
        [w setLevel:NSNormalWindowLevel];
        [w setCollectionBehavior:NSWindowCollectionBehaviorFullScreenPrimary];
        [w setFrame:NSInsetRect([s visibleFrame], 60, 60) display:YES];
    }
    [w makeKeyAndOrderFront:nil];
}

inline void open_second(int index, const std::string& mode) {
    std::string m = mode;
    dispatch_async(dispatch_get_main_queue(), ^{ @autoreleasepool {
        NSScreen* s = screen_at(index);
        if (!second_win()) {
            SpikeKeyWindow* w = [[SpikeKeyWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)
                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
                backing:NSBackingStoreBuffered defer:NO];
            [w setReleasedWhenClosed:NO];
            [w setTitle:@"Flint spike — second window"];
            [w setBackgroundColor:[NSColor blackColor]];
            WKWebViewConfiguration* cfg = [[WKWebViewConfiguration alloc] init];
            [cfg setURLSchemeHandler:[[SpikeSchemeHandler alloc] init] forURLScheme:@"app"];
            WKUserContentController* ucc = [[WKUserContentController alloc] init];
            [ucc addScriptMessageHandler:[[SpikeMsgHandler alloc] init] name:@"spike2"];
            cfg.userContentController = ucc;
            WKWebView* v = [[WKWebView alloc] initWithFrame:[[w contentView] bounds] configuration:cfg];
            [v setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
            [w setContentView:v];
            [v loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"app://localhost/second.html"]]];
            second_win() = w;
            second_view() = v;
        } else if (([second_win() styleMask] & NSWindowStyleMaskFullScreen) != 0) {
            [second_win() toggleFullScreen:nil];
        }
        place(second_win(), s, m);
        to_main("second:placed", "{\"index\":" + std::to_string(index) + ",\"mode\":" + jstr(m) + "}");
    }});
}

inline void close_second() {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (second_win()) { [second_win() close]; second_win() = nil; second_view() = nil; }
        to_main("second:closed", "{}");
    });
}

inline void to_second(const std::string& json) {
    std::string js = "window.__spike_from_main && window.__spike_from_main(" + json + ");";
    dispatch_async(dispatch_get_main_queue(), ^{
        if (second_view()) [second_view() evaluateJavaScript:[NSString stringWithUTF8String:js.c_str()] completionHandler:nil];
    });
}

// The main (ext:webui) window to a monitor, in a mode, for "both full screen at once".
inline void place_main(int index, const std::string& mode) {
    std::string m = mode;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow* w = main_window();
        if (!w) return;
        if (([w styleMask] & NSWindowStyleMaskFullScreen) != 0) { [w toggleFullScreen:nil]; return; }
        if (m == "borderless") {
            // ext:webui's NSWindow cannot become key once borderless (CF-NNN in the report);
            // "native" is the one that keeps the keyboard.
        }
        place(w, screen_at(index), m);
    });
}

// ---------------------------------------------------------------------------------
#elif defined(_WIN32)
// Written for the owner's branch; not compiled here.
inline std::string monitors_json() {
    struct Acc { std::ostringstream o; int i = 0; } acc;
    acc.o << "[";
    ::EnumDisplayMonitors(nullptr, nullptr, [](HMONITOR hm, HDC, LPRECT, LPARAM lp) -> BOOL {
        auto* a = reinterpret_cast<Acc*>(lp);
        MONITORINFOEXW mi{}; mi.cbSize = sizeof(mi);
        ::GetMonitorInfoW(hm, &mi);
        DEVMODEW dm{}; dm.dmSize = sizeof(dm);
        ::EnumDisplaySettingsW(mi.szDevice, ENUM_CURRENT_SETTINGS, &dm);
        UINT dx = 96, dy = 96;
        ::GetDpiForMonitor(hm, MDT_EFFECTIVE_DPI, &dx, &dy);  // needs per-monitor DPI awareness v2
        const RECT& r = mi.rcMonitor;
        if (a->i > 0) a->o << ",";
        a->o << "{\"index\":" << a->i << ",\"x\":" << r.left << ",\"y\":" << r.top
             << ",\"w\":" << (r.right - r.left) << ",\"h\":" << (r.bottom - r.top)
             << ",\"scale\":" << (dx / 96.0) << ",\"rotation\":" << (dm.dmDisplayOrientation * 90)
             << ",\"hz\":" << dm.dmDisplayFrequency
             << ",\"primary\":" << ((mi.dwFlags & MONITORINFOF_PRIMARY) ? "true" : "false") << "}";
        a->i++;
        return TRUE;
    }, reinterpret_cast<LPARAM>(&acc));
    acc.o << "]";
    return acc.o.str();
}
inline void open_second(int, const std::string&) {}
inline void close_second() {}
inline void to_second(const std::string&) {}
inline void place_main(int, const std::string&) {}

// ---------------------------------------------------------------------------------
#elif !defined(__APPLE__)
inline GtkWidget*& second_win() { static GtkWidget* w = nullptr; return w; }
inline WebKitWebView*& second_view() { static WebKitWebView* v = nullptr; return v; }

template <typename F>
inline void on_ui(F f) {
    auto* p = new F(std::move(f));
    g_idle_add(+[](gpointer d) -> gboolean { auto* fp = static_cast<F*>(d); (*fp)(); delete fp; return G_SOURCE_REMOVE; }, p);
}

template <typename F>
inline void on_ui_sync(F f) {
    if (g_main_context_is_owner(g_main_context_default())) { f(); return; }
    std::mutex m; std::condition_variable cv; bool done = false;
    on_ui([&] { f(); std::lock_guard<std::mutex> g(m); done = true; cv.notify_one(); });
    std::unique_lock<std::mutex> lk(m);
    cv.wait(lk, [&] { return done; });
}

inline std::string monitors_json() {
    std::string out;
    on_ui_sync([&] {
        GdkDisplay* d = gdk_display_get_default();
        int n = gdk_display_get_n_monitors(d);
        std::ostringstream o;
        o << "[";
        for (int i = 0; i < n; ++i) {
            GdkMonitor* m = gdk_display_get_monitor(d, i);
            GdkRectangle g, wa;
            gdk_monitor_get_geometry(m, &g);   // application pixels (logical)
            gdk_monitor_get_workarea(m, &wa);
            const char* model = gdk_monitor_get_model(m);
            if (i > 0) o << ",";
            o << "{\"index\":" << i << ",\"name\":" << jstr(model ? model : "?")
              << ",\"x\":" << g.x << ",\"y\":" << g.y << ",\"w\":" << g.width << ",\"h\":" << g.height
              << ",\"scale\":" << gdk_monitor_get_scale_factor(m)
              << ",\"hz\":" << (gdk_monitor_get_refresh_rate(m) / 1000.0)
              << ",\"rotation\":null"  // GDK 3 has none; XRandR's CRTC rotation would give it
              << ",\"orientation\":\"" << (g.width >= g.height ? "landscape" : "portrait") << "\""
              << ",\"mm_w\":" << gdk_monitor_get_width_mm(m) << ",\"mm_h\":" << gdk_monitor_get_height_mm(m)
              << ",\"work\":[" << wa.x << "," << wa.y << "," << wa.width << "," << wa.height << "]"
              << ",\"primary\":" << (gdk_monitor_is_primary(m) ? "true" : "false") << "}";
        }
        o << "]";
        out = o.str();
    });
    return out;
}

inline void on_msg(WebKitUserContentManager*, WebKitJavascriptResult* r, gpointer) {
    JSCValue* v = webkit_javascript_result_get_js_value(r);
    if (!v || !jsc_value_is_string(v)) return;
    char* s = jsc_value_to_string(v);
    to_main("second:msg", s);
    g_free(s);
}

inline void place(GtkWidget* w, int index, const std::string& mode) {
    GdkDisplay* d = gdk_display_get_default();
    GdkMonitor* m = gdk_display_get_monitor(d, index);
    if (!m) m = gdk_display_get_primary_monitor(d);
    GdkRectangle g; gdk_monitor_get_geometry(m, &g);
    gtk_window_unfullscreen(GTK_WINDOW(w));
    if (mode == "borderless" || mode == "native") {
        gtk_window_set_decorated(GTK_WINDOW(w), FALSE);
        gtk_window_move(GTK_WINDOW(w), g.x, g.y);
        gtk_window_resize(GTK_WINDOW(w), g.width, g.height);
        gtk_window_fullscreen_on_monitor(GTK_WINDOW(w), gtk_widget_get_screen(w), index);
    } else {
        gtk_window_set_decorated(GTK_WINDOW(w), TRUE);
        gtk_window_move(GTK_WINDOW(w), g.x + 60, g.y + 60);
        gtk_window_resize(GTK_WINDOW(w), g.width - 120, g.height - 120);
    }
    gtk_widget_show_all(w);
    gtk_window_present(GTK_WINDOW(w));
}

inline void open_second(int index, const std::string& mode) {
    on_ui([index, mode] {
        if (!second_win()) {
            GtkWidget* w = gtk_window_new(GTK_WINDOW_TOPLEVEL);
            gtk_window_set_title(GTK_WINDOW(w), "Flint spike — second window");
            WebKitUserContentManager* ucm = webkit_user_content_manager_new();
            g_signal_connect(ucm, "script-message-received::spike2", G_CALLBACK(on_msg), nullptr);
            webkit_user_content_manager_register_script_message_handler(ucm, "spike2");
            // Same default WebKitWebContext as ext:webui's view: its app:// handler serves
            // this page from the same ui/ folder.
            GtkWidget* v = webkit_web_view_new_with_user_content_manager(ucm);
            gtk_container_add(GTK_CONTAINER(w), v);
            webkit_web_view_load_uri(WEBKIT_WEB_VIEW(v), "app://localhost/second.html");
            g_signal_connect(w, "destroy", G_CALLBACK(+[](GtkWidget*, gpointer) { second_win() = nullptr; second_view() = nullptr; }), nullptr);
            second_win() = w;
            second_view() = WEBKIT_WEB_VIEW(v);
        }
        place(second_win(), index, mode);
        to_main("second:placed", "{\"index\":" + std::to_string(index) + ",\"mode\":" + jstr(mode) + "}");
    });
}

inline void close_second() {
    on_ui([] { if (second_win()) gtk_widget_destroy(second_win()); to_main("second:closed", "{}"); });
}

inline void to_second(const std::string& json) {
    std::string js = "window.__spike_from_main && window.__spike_from_main(" + json + ");";
    on_ui([js] {
        if (second_view()) webkit_web_view_run_javascript(second_view(), js.c_str(), nullptr, nullptr, nullptr);
    });
}

inline void place_main(int index, const std::string& mode) {
    on_ui([index, mode] {
        GList* tops = gtk_window_list_toplevels();
        for (GList* l = tops; l; l = l->next) {
            GtkWidget* w = GTK_WIDGET(l->data);
            if (w != second_win() && gtk_widget_get_visible(w)) { place(w, index, mode); break; }
        }
        g_list_free(tops);
    });
}
#endif

} // namespace spike_mm
