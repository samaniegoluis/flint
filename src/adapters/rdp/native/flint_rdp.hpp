// CFIRE-UPSTREAM: CF-119
// Remote desktop tabs over libfreerdp 3 (FreeRDP's core and client-channel libraries;
// no SDL, no X11 client). cfire has no RDP and cannot implement FreeRDP's C callbacks,
// so the tabs, their connections, event-loop threads and frame channels live here;
// rdp.cf wraps them as the RemoteDesktop port (milestone 30).
//
// A tab is keyed by the page's id and outlives its connections: a reconnect (a new
// size on a server without Display Control) replaces the connection and keeps the
// tab's frame channel, so the page reads on without noticing.
//
// Graphics (milestone 34): with `graphics` "auto" the graphics pipeline (RDPGFX) is
// offered, with the progressive codec and AVC/H.264 when this build of FreeRDP can
// decode it; FreeRDP's GDI decodes into the same RGBA surface, so the frames below do
// not change. "compatible", or a server without RDPGFX, keeps the bitmap updates.
//
// Frames: each connection draws into FreeRDP's software GDI as RGBA. Every EndPaint
// adds its dirty rectangle to the tab's pending union; a reader takes the union (the
// pixels inside it) and clears it, so a slow reader skips frames instead of queueing
// them (D-071). The local channel is a minimal HTTP/1.1 server on 127.0.0.1 serving
// `GET /next?t=<token>` as a long poll, the token 32 random bytes from libsodium.
//
// Quiet re-read (milestone 35): when about a second passes with no update after some,
// the run loop marks the whole desktop dirty once, so an area FreeRDP drew without
// reporting it (or a region the page lost) is sent again. Before it does, it compares
// what the frame channel handed out (`shadow`) with FreeRDP's surface and counts the
// pixels that differ: Stats shows it, and it tells whether a stale block was the
// shim's (FreeRDP drew it unreported) or the page's (handed out, then lost).
//
// Monitors (milestone 38, D-089): a tab may span several monitors, its layout sent at
// connect (FreeRDP's monitor definitions) or through Display Control without
// reconnecting. The surface is the box around them; the frame channel then serves one
// view per monitor (`GET /next?t=<token>&v=<i>`), each with its own crop and its own
// dirty union, so each window reads its part at its own pace and a slow one never
// starves another. Without `v` the first view is read, the whole desktop on one monitor.
//
// Graphics switch (milestone 35): `set_graphics` asks the core, through `wait`, to
// reconnect the tab in the other mode at its current size.
//
// The certificate is always checked here, never by FreeRDP's own store: only the
// fingerprint the core trusts is accepted, anything else is refused and kept for the
// core to decide on (trust on first use, D-019). The password is wiped from FreeRDP's
// settings once the connection is up (D-072).
#pragma once

#if defined(_WIN32)
// Before winpr, which includes <windows.h>: Winsock 2 must come first.
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

#if defined(__APPLE__)
// Before winpr: winpr defines CreateEvent as a macro, which would rename Carbon's own.
#include <Carbon/Carbon.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#endif

// winpr declares a global `typedef BYTE byte`, and cfire's prelude a global
// `using cfire::byte`: renamed while FreeRDP's headers are read (CF-119).
#define byte flint_winpr_byte
#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/client/channels.h>
#include <freerdp/client/cmdline.h>
#include <freerdp/client/cliprdr.h>
#include <freerdp/client/disp.h>
#include <freerdp/client/rdpgfx.h>
#include <freerdp/channels/cliprdr.h>
#include <freerdp/channels/channels.h>
#include <freerdp/channels/drdynvc.h>
#include <freerdp/channels/disp.h>
#include <freerdp/channels/rdpgfx.h>
#include <freerdp/codec/h264.h>
#include <freerdp/crypto/certificate.h>
#include <freerdp/event.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/gdi/gfx.h>
#include <freerdp/input.h>
#include <freerdp/locale/keyboard.h>
#include <freerdp/settings.h>
#include <freerdp/error.h>
#include <freerdp/transport_io.h>
#include <winpr/string.h>
#include <winpr/synch.h>
#include <winpr/wlog.h>
#undef byte
#include <sodium.h>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#include <cerrno>

#include <algorithm>
#include <cctype>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace flint_rdp {

// ---- Sockets: BSD on macOS and Linux, Winsock on the owner's Windows build ---------
// (docs/rdp-windows.md). The frame channel and the refused-port probe use only these.
#if defined(_WIN32)
using sock_t = SOCKET;
inline const sock_t BAD_SOCK = INVALID_SOCKET;
inline bool sock_init() {
    static const bool ok = [] { WSADATA d; return WSAStartup(MAKEWORD(2, 2), &d) == 0; }();
    return ok;
}
inline void sock_close(sock_t s) { closesocket(s); }
inline void sock_shutdown(sock_t s) { ::shutdown(s, SD_BOTH); }
inline void sock_recv_timeout(sock_t s, int ms) {
    DWORD v = static_cast<DWORD>(ms);
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&v), sizeof v);
}
inline void sock_nodelay(sock_t s) {
    BOOL one = TRUE;
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&one), sizeof one);
}
inline void sock_nonblock(sock_t s) { u_long one = 1; ioctlsocket(s, FIONBIO, &one); }
inline int sock_error() { return WSAGetLastError(); }
inline bool sock_in_progress(int e) { return e == WSAEWOULDBLOCK || e == WSAEINPROGRESS; }
inline bool sock_refused_error(int e) { return e == WSAECONNREFUSED; }
inline int sock_poll(pollfd* p, int n, int ms) { return WSAPoll(p, static_cast<ULONG>(n), ms); }
inline int sock_send(sock_t s, const char* p, size_t n) { return ::send(s, p, static_cast<int>(n), 0); }
inline int sock_recv(sock_t s, char* p, size_t n) { return ::recv(s, p, static_cast<int>(n), 0); }
#else
using sock_t = int;
inline const sock_t BAD_SOCK = -1;
inline bool sock_init() { return true; }
inline void sock_close(sock_t s) { ::close(s); }
inline void sock_shutdown(sock_t s) { ::shutdown(s, SHUT_RDWR); }
inline void sock_recv_timeout(sock_t s, int ms) {
    timeval tv{ms / 1000, (ms % 1000) * 1000};
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
}
inline void sock_nodelay(sock_t s) {
    int one = 1;
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
#if defined(SO_NOSIGPIPE)
    setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
}
inline void sock_nonblock(sock_t s) { fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK); }
inline int sock_error() { return errno; }
inline bool sock_in_progress(int e) { return e == EINPROGRESS; }
inline bool sock_refused_error(int e) { return e == ECONNREFUSED; }
inline int sock_poll(pollfd* p, int n, int ms) { return ::poll(p, static_cast<nfds_t>(n), ms); }
inline int sock_send(sock_t s, const char* p, size_t n) {
#if defined(MSG_NOSIGNAL)
    return static_cast<int>(::send(s, p, n, MSG_NOSIGNAL));
#else
    return static_cast<int>(::send(s, p, n, 0));
#endif
}
inline int sock_recv(sock_t s, char* p, size_t n) { return static_cast<int>(::recv(s, p, n, 0)); }
#endif

// Result codes shared with rdp.cf.
inline constexpr int RDP_OK = 0;
inline constexpr int RDP_ERR_AUTH = 1;
inline constexpr int RDP_ERR_NETWORK = 2;
inline constexpr int RDP_ERR_TIMEOUT = 3;
inline constexpr int RDP_ERR_REFUSED = 4;
inline constexpr int RDP_ERR_TLS = 5;
inline constexpr int RDP_ERR_OTHER = 6;
inline constexpr int RDP_ERR_CLOSED = 7;
inline constexpr int RDP_ERR_CERT = 8;
inline constexpr int RDP_ERR_PORT_CLOSED = 9;
inline constexpr int RDP_ERR_LOST = 10;
inline constexpr int RDP_ERR_ENDED = 11;
inline constexpr int RDP_ERR_UNKNOWN_KEY = 12;
inline constexpr int RDP_ERR_LEGACY_SECURITY = 13;

// Events of `wait`.
inline constexpr int EV_RUNNING = 0;
inline constexpr int EV_ENDED = 1;
inline constexpr int EV_RESIZE = 2;
inline constexpr int EV_CLIP_TEXT = 3;     // the remote copied text (in `detail`)
inline constexpr int EV_CLIP_REQUEST = 4;  // the remote pastes: it wants this machine's text
inline constexpr int EV_GRAPHICS = 5;      // reconnect in the mode in `detail`, at w x h

// A quiet second with no update, after some, before the whole desktop is read again.
inline constexpr int64_t REREAD_QUIET_MS = 1000;

// The clipboard's text format (CF_UNICODETEXT), the only one Flint exchanges (v8).
inline constexpr UINT32 CLIP_UNICODE = 13;
// Text larger than this is not exchanged (either way).
inline constexpr size_t CLIP_MAX_BYTES = 16u << 20;

struct Tab;

// One FreeRDP connection of a tab.
struct Conn {
    freerdp* inst = nullptr;
    Tab* tab = nullptr;
    std::thread loop;
    std::atomic<bool> stop{false};
    std::atomic<bool> ended{false};
    // Display Control, once the server opened the channel and sent its caps.
    DispClientContext* disp = nullptr;
    std::atomic<bool> disp_ready{false};
    std::atomic<uint32_t> disp_max{1};  // monitors Display Control takes (its caps)
    // The clipboard channel, once the server said it is ready (Monitor Ready).
    CliprdrClientContext* clip = nullptr;
    std::atomic<bool> clip_ready{false};
    // The graphics pipeline, once its channel is open, and the GDI's own surface
    // command, which Flint's wraps to count and time it.
    RdpgfxClientContext* gfx = nullptr;
    pcRdpgfxSurfaceCommand gfx_surface_command = nullptr;
    // Why the loop ended, read after `ended`.
    UINT32 last_error = 0;
    UINT32 error_info = 0;
    // The server's answer to the connection request offered only Standard RDP Security
    // (milestone 36): told apart from a network failure when the connect fails.
    std::atomic<bool> x224_seen{false};
    std::atomic<bool> legacy_only{false};
};

struct Context {
    rdpContext base;   // must be first: FreeRDP allocates ContextSize bytes
    Tab* tab;
    Conn* conn;
};

struct Cert {
    std::string subject, issuer, fingerprint, valid_from, valid_to;
};

// One reader of the frame channel (milestone 38): a window showing a part of the
// desktop. `c*` is its crop in desktop pixels (cw == 0: the whole surface); `d*` its
// pending dirty union inside the crop (dw == 0: nothing pending).
struct View {
    int32_t cx = 0, cy = 0, cw = 0, ch = 0;
    int32_t dx = 0, dy = 0, dw = 0, dh = 0;
};

// One monitor of a tab's layout, the primary first at 0,0 (domain's check_rdp_layout).
struct Mon {
    int32_t x = 0, y = 0, w = 0, h = 0;
    bool primary = false;
};

// "x,y,w,h,p;..." as rdp.cf writes it; empty or unreadable: no layout.
inline std::vector<Mon> parse_layout(const std::string& s) {
    std::vector<Mon> v;
    size_t at = 0;
    while (at < s.size()) {
        size_t end = s.find(';', at);
        if (end == std::string::npos) end = s.size();
        Mon m{};
        int p = 0;
        if (std::sscanf(s.substr(at, end - at).c_str(), "%d,%d,%d,%d,%d", &m.x, &m.y, &m.w, &m.h, &p) != 5) return {};
        m.primary = p != 0;
        if (m.w <= 0 || m.h <= 0) return {};
        v.push_back(m);
        at = end + 1;
    }
    if (v.size() > 16) return {};
    return v;
}

inline std::string layout_text(const std::vector<Mon>& v) {
    std::string s;
    for (size_t i = 0; i < v.size(); ++i) {
        if (i > 0) s += ";";
        s += std::to_string(v[i].x) + "," + std::to_string(v[i].y) + "," + std::to_string(v[i].w) + "," +
             std::to_string(v[i].h) + "," + (v[i].primary ? "1" : "0");
    }
    return s;
}

// The box around a layout's monitors.
inline void layout_box(const std::vector<Mon>& v, int32_t& x, int32_t& y, int32_t& w, int32_t& h) {
    if (v.empty()) { x = y = w = h = 0; return; }
    int32_t x1 = v[0].x, y1 = v[0].y, x2 = v[0].x + v[0].w, y2 = v[0].y + v[0].h;
    for (const auto& m : v) {
        x1 = std::min(x1, m.x); y1 = std::min(y1, m.y);
        x2 = std::max(x2, m.x + m.w); y2 = std::max(y2, m.y + m.h);
    }
    x = x1; y = y1; w = x2 - x1; h = y2 - y1;
}

// One view per monitor, cropped where it lies in the surface; one whole view without
// a layout.
inline std::vector<View> views_for(const std::vector<Mon>& layout) {
    if (layout.size() < 2) return std::vector<View>(1);
    int32_t bx, by, bw, bh;
    layout_box(layout, bx, by, bw, bh);
    std::vector<View> v(layout.size());
    for (size_t i = 0; i < layout.size(); ++i) {
        v[i].cx = layout[i].x - bx;
        v[i].cy = layout[i].y - by;
        v[i].cw = layout[i].w;
        v[i].ch = layout[i].h;
    }
    return v;
}

struct Tab {
    std::string id;
    std::mutex mu;               // frames, size, the current connection, events
    std::condition_variable cv;
    std::shared_ptr<Conn> conn;  // current connection, null between connections
    std::atomic<bool> closed{false};
    // While freerdp_connect runs, so close() can cancel it.
    std::mutex connecting_mu;
    freerdp* connecting = nullptr;
    // The frame channel's readers, one per monitor shown (never empty), and the
    // monitors the desktop spans (empty: one monitor). Under `mu`.
    std::vector<View> views = std::vector<View>(1);
    std::vector<Mon> layout;
    uint64_t seq = 0;
    int32_t width = 0, height = 0;
    // A size asked for while the server has no Display Control (0: none).
    int32_t want_w = 0, want_h = 0;
    // The certificate check of the connection being opened.
    std::string trusted;
    Cert presented;
    bool cert_refused = false;
    std::mutex input_mu;  // input is sent from the page's thread
    // Clipboard (milestone 31, D-074). `local_text`: this machine's clipboard holds
    // text and was announced to the server; it outlives a reconnect, which announces
    // it again. The remote's copied text waits here for `wait`; so does its request.
    bool local_text = false;
    bool remote_pending = false;
    std::string remote_text;
    bool request_pending = false;
    // Statistics (milestone 34): counters only, never an address or a name
    // (Principle 5). Read by `stats`; they outlive a reconnect.
    bool want_gfx = true;
    std::atomic<uint64_t> st_updates{0};     // EndPaints: updates the server drew
    std::atomic<uint64_t> st_bytes_in{0};    // bytes of PDUs received
    std::atomic<uint64_t> st_commands{0};    // RDPGFX surface commands
    std::atomic<uint64_t> st_decode_us{0};   // time spent decoding them
    std::atomic<uint64_t> st_frames_read{0}; // regions taken by the frame channel
    std::atomic<uint32_t> st_codecs{0};      // codec ids seen, one bit each
    std::atomic<bool> st_gfx{false};         // the graphics pipeline is open
    std::atomic<uint64_t> st_rereads{0};     // quiet re-reads of the whole desktop
    std::atomic<uint64_t> st_stale_px{0};    // pixels they found differing from what was handed out
    // Quiet re-read (milestone 35), under `mu`: the last update, whether one came since
    // the last re-read, and a copy of the surface as the frame channel handed it out.
    std::chrono::steady_clock::time_point last_update{};
    bool reread_due = false;
    std::vector<uint8_t> shadow;
    int32_t shadow_w = 0, shadow_h = 0;
    // A graphics mode the page asked for, waiting for `wait` ("": none).
    std::string want_graphics;
    // Whether the last open wiped the password from FreeRDP's backup of the settings
    // too (milestone 36): for the tests.
    std::atomic<bool> creds_wiped{false};
    // Frame channel.
    sock_t listen_fd = BAD_SOCK;
    int port = 0;
    std::string token;
    std::thread server;
    std::atomic<int> serving{0};  // frame-channel connections open now
};

inline std::mutex& registry_mu() { static std::mutex m; return m; }
inline std::map<std::string, std::shared_ptr<Tab>>& registry() {
    static std::map<std::string, std::shared_ptr<Tab>> r;
    return r;
}

inline std::shared_ptr<Tab> find(const std::string& id) {
    std::lock_guard<std::mutex> g(registry_mu());
    auto it = registry().find(id);
    return it == registry().end() ? nullptr : it->second;
}

inline Context* ctx_of(rdpContext* ctx) { return reinterpret_cast<Context*>(ctx); }

// ---- Drawing -------------------------------------------------------------------

// The crop of view `v`: the whole surface when it has none.
inline void view_crop(const Tab& t, const View& v, int32_t& x, int32_t& y, int32_t& w, int32_t& h) {
    if (v.cw == 0) { x = 0; y = 0; w = t.width; h = t.height; return; }
    x = v.cx; y = v.cy; w = v.cw; h = v.ch;
}

// Adds a changed rectangle to every view it touches. Called with `t.mu` held.
inline void mark_locked(Tab& t, int32_t x, int32_t y, int32_t w, int32_t h) {
    for (auto& v : t.views) {
        int32_t cx, cy, cw, ch;
        view_crop(t, v, cx, cy, cw, ch);
        const int32_t ix = std::max(x, cx), iy = std::max(y, cy);
        const int32_t ix2 = std::min(x + w, cx + cw), iy2 = std::min(y + h, cy + ch);
        if (ix2 <= ix || iy2 <= iy) continue;
        if (v.dw == 0) {
            v.dx = ix; v.dy = iy; v.dw = ix2 - ix; v.dh = iy2 - iy;
        } else {
            const int32_t x2 = std::max(v.dx + v.dw, ix2), y2 = std::max(v.dy + v.dh, iy2);
            v.dx = std::min(v.dx, ix); v.dy = std::min(v.dy, iy);
            v.dw = x2 - v.dx; v.dh = y2 - v.dy;
        }
    }
    t.seq += 1;
}

inline void mark_all_locked(Tab& t) { mark_locked(t, 0, 0, t.width, t.height); }

inline bool view_pending(const Tab& t, size_t vi) { return vi < t.views.size() && t.views[vi].dw != 0; }

// Whether pixel x, y is about to go out to some view anyway.
inline bool pending_at(const Tab& t, int32_t x, int32_t y) {
    for (const auto& v : t.views) {
        if (v.dw != 0 && x >= v.dx && x < v.dx + v.dw && y >= v.dy && y < v.dy + v.dh) return true;
    }
    return false;
}

inline BOOL on_begin_paint(rdpContext* ctx) {
    rdpGdi* gdi = ctx->gdi;
    if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return FALSE;
    HGDI_WND hwnd = gdi->primary->hdc->hwnd;
    if (!hwnd->invalid) return FALSE;
    hwnd->invalid->null = TRUE;
    hwnd->ninvalid = 0;
    return TRUE;
}

// Set while on_desktop_resize holds the tab's lock: with the graphics pipeline,
// gdi_resize paints (EndPaint) on the same thread, and the resize marks the whole
// desktop dirty anyway.
inline thread_local bool in_resize = false;

inline BOOL on_end_paint(rdpContext* ctx) {
    if (in_resize) return TRUE;
    rdpGdi* gdi = ctx->gdi;
    if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return FALSE;
    HGDI_WND hwnd = gdi->primary->hdc->hwnd;
    if (!hwnd->invalid || hwnd->invalid->null) return TRUE;
    int32_t x = std::max<int32_t>(0, hwnd->invalid->x);
    int32_t y = std::max<int32_t>(0, hwnd->invalid->y);
    int32_t w = std::min<int32_t>(hwnd->invalid->w, static_cast<int32_t>(gdi->width) - x);
    int32_t h = std::min<int32_t>(hwnd->invalid->h, static_cast<int32_t>(gdi->height) - y);
    if (w <= 0 || h <= 0) return TRUE;
    Tab* t = ctx_of(ctx)->tab;
    {
        std::lock_guard<std::mutex> g(t->mu);
        mark_locked(*t, x, y, w, h);
        t->last_update = std::chrono::steady_clock::now();
        t->reread_due = true;
    }
    t->st_updates.fetch_add(1, std::memory_order_relaxed);
    t->cv.notify_all();
    return TRUE;
}

inline BOOL on_desktop_resize(rdpContext* ctx) {
    rdpSettings* st = ctx->settings;
    Tab* t = ctx_of(ctx)->tab;
    UINT32 w = freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight);
    std::lock_guard<std::mutex> g(t->mu);
    in_resize = true;
    BOOL ok = gdi_resize(ctx->gdi, w, h);
    in_resize = false;
    if (!ok) return FALSE;
    t->width = static_cast<int32_t>(w);
    t->height = static_cast<int32_t>(h);
    mark_all_locked(*t);
    t->cv.notify_all();
    return TRUE;
}

// ---- Display Control -------------------------------------------------------------

inline UINT on_disp_caps(DispClientContext* disp, UINT32 max_monitors, UINT32 a, UINT32 b) {
    (void)a; (void)b;
    auto* c = static_cast<Conn*>(disp->custom);
    if (c) c->disp_max.store(std::max<UINT32>(1, max_monitors));
    if (c) c->disp_ready.store(true);
    return CHANNEL_RC_OK;
}

// ---- Clipboard (milestone 31, D-074) ----------------------------------------------
//
// Text only, both ways. The remote's copies are fetched at once and wait in the tab for
// the core, which writes them to this machine's clipboard. This machine's text is only
// announced (a format list); the server gets it when it asks, that is when someone
// pastes there, and the core decides then whether to answer. Windows keeps text as
// CRLF, this machine as LF.

inline std::string crlf_to_lf(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\r' && i + 1 < s.size() && s[i + 1] == '\n') continue;
        out += s[i];
    }
    return out;
}

inline std::string lf_to_crlf(const std::string& s) {
    std::string out;
    out.reserve(s.size() + s.size() / 16);
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\n' && (i == 0 || s[i - 1] != '\r')) out += '\r';
        out += s[i];
    }
    return out;
}

inline UINT clip_send_format_list(CliprdrClientContext* clip, bool has_text) {
    CLIPRDR_FORMAT f{};
    f.formatId = CLIP_UNICODE;
    f.formatName = nullptr;
    CLIPRDR_FORMAT_LIST list{};
    list.common.msgType = CB_FORMAT_LIST;
    list.numFormats = has_text ? 1 : 0;
    list.formats = has_text ? &f : nullptr;
    return clip->ClientFormatList(clip, &list);
}

inline UINT clip_send_data(CliprdrClientContext* clip, bool ok, const std::string& text) {
    CLIPRDR_FORMAT_DATA_RESPONSE r{};
    r.common.msgType = CB_FORMAT_DATA_RESPONSE;
    std::vector<BYTE> data;
    if (ok) {
        std::string win = lf_to_crlf(text);
        size_t n = 0;
        WCHAR* w = win.empty() ? nullptr : ConvertUtf8NToWCharAlloc(win.data(), win.size(), &n);
        if (!win.empty() && !w) ok = false;
        if (ok) {
            data.assign((n + 1) * sizeof(WCHAR), 0);
            if (n) std::memcpy(data.data(), w, n * sizeof(WCHAR));
        }
        if (w) {
            sodium_memzero(w, n * sizeof(WCHAR));
            free(w);
        }
        if (!win.empty()) sodium_memzero(win.data(), win.size());
    }
    r.common.msgFlags = ok ? CB_RESPONSE_OK : CB_RESPONSE_FAIL;
    r.common.dataLen = ok ? static_cast<UINT32>(data.size()) : 0;
    r.requestedFormatData = ok ? data.data() : nullptr;
    UINT rc = clip->ClientFormatDataResponse(clip, &r);
    if (!data.empty()) sodium_memzero(data.data(), data.size());
    return rc;
}

inline Conn* clip_conn(CliprdrClientContext* clip) { return static_cast<Conn*>(clip->custom); }

inline UINT on_clip_monitor_ready(CliprdrClientContext* clip, const CLIPRDR_MONITOR_READY*) {
    Conn* c = clip_conn(clip);
    if (!c) return CHANNEL_RC_OK;
    CLIPRDR_GENERAL_CAPABILITY_SET general{};
    general.capabilitySetType = CB_CAPSTYPE_GENERAL;
    general.capabilitySetLength = CB_CAPSTYPE_GENERAL_LEN;
    general.version = CB_CAPS_VERSION_2;
    general.generalFlags = CB_USE_LONG_FORMAT_NAMES;
    CLIPRDR_CAPABILITIES caps{};
    caps.common.msgType = CB_CLIP_CAPS;
    caps.cCapabilitiesSets = 1;
    caps.capabilitySets = reinterpret_cast<CLIPRDR_CAPABILITY_SET*>(&general);
    UINT rc = clip->ClientCapabilities(clip, &caps);
    if (rc != CHANNEL_RC_OK) return rc;
    bool has_text;
    {
        std::lock_guard<std::mutex> g(c->tab->mu);
        has_text = c->tab->local_text;
    }
    // A format list is required here, empty or not, for the server to send its own.
    rc = clip_send_format_list(clip, has_text);
    c->clip_ready.store(true);
    return rc;
}

inline UINT on_clip_server_caps(CliprdrClientContext*, const CLIPRDR_CAPABILITIES*) { return CHANNEL_RC_OK; }

// The remote copied something: text is fetched now, anything else is ignored.
inline UINT on_clip_server_format_list(CliprdrClientContext* clip, const CLIPRDR_FORMAT_LIST* list) {
    Conn* c = clip_conn(clip);
    CLIPRDR_FORMAT_LIST_RESPONSE r{};
    r.common.msgType = CB_FORMAT_LIST_RESPONSE;
    r.common.msgFlags = CB_RESPONSE_OK;
    UINT rc = clip->ClientFormatListResponse(clip, &r);
    if (rc != CHANNEL_RC_OK || !c) return rc;
    {
        // The server's clipboard is the remote's own now; ours is no longer offered.
        std::lock_guard<std::mutex> g(c->tab->mu);
        c->tab->local_text = false;
    }
    bool text = false;
    for (UINT32 i = 0; list && i < list->numFormats; i++) {
        if (list->formats[i].formatId == CLIP_UNICODE) text = true;
    }
    if (!text) return CHANNEL_RC_OK;
    CLIPRDR_FORMAT_DATA_REQUEST req{};
    req.common.msgType = CB_FORMAT_DATA_REQUEST;
    req.requestedFormatId = CLIP_UNICODE;
    return clip->ClientFormatDataRequest(clip, &req);
}

inline UINT on_clip_server_format_list_response(CliprdrClientContext*, const CLIPRDR_FORMAT_LIST_RESPONSE*) { return CHANNEL_RC_OK; }

inline UINT on_clip_server_data_response(CliprdrClientContext* clip, const CLIPRDR_FORMAT_DATA_RESPONSE* r) {
    Conn* c = clip_conn(clip);
    if (!c || !r || !(r->common.msgFlags & CB_RESPONSE_OK) || !r->requestedFormatData) return CHANNEL_RC_OK;
    size_t wlen = r->common.dataLen / sizeof(WCHAR);
    if (wlen * 3 > CLIP_MAX_BYTES) return CHANNEL_RC_OK;
    std::vector<WCHAR> w(wlen);
    if (wlen) std::memcpy(w.data(), r->requestedFormatData, wlen * sizeof(WCHAR));
    while (wlen > 0 && w[wlen - 1] == 0) wlen--;
    size_t n = 0;
    char* s = wlen ? ConvertWCharNToUtf8Alloc(w.data(), wlen, &n) : nullptr;
    std::string text = s ? crlf_to_lf(std::string(s, n)) : std::string();
    if (s) {
        sodium_memzero(s, n);
        free(s);
    }
    if (!w.empty()) sodium_memzero(w.data(), w.size() * sizeof(WCHAR));
    if (wlen && text.empty()) return CHANNEL_RC_OK;
    Tab* t = c->tab;
    {
        std::lock_guard<std::mutex> g(t->mu);
        if (!t->remote_text.empty()) sodium_memzero(t->remote_text.data(), t->remote_text.size());
        t->remote_text = std::move(text);
        t->remote_pending = true;
    }
    t->cv.notify_all();
    return CHANNEL_RC_OK;
}

// The remote pastes. Only text announced from here is answered, by the core; anything
// else is refused at once.
inline UINT on_clip_server_data_request(CliprdrClientContext* clip, const CLIPRDR_FORMAT_DATA_REQUEST* req) {
    Conn* c = clip_conn(clip);
    if (!c) return clip_send_data(clip, false, "");
    Tab* t = c->tab;
    {
        std::lock_guard<std::mutex> g(t->mu);
        if (!req || req->requestedFormatId != CLIP_UNICODE || !t->local_text) {
            // falls through to the refusal below, outside the lock
        } else {
            t->request_pending = true;
            t->cv.notify_all();
            return CHANNEL_RC_OK;
        }
    }
    return clip_send_data(clip, false, "");
}

// ---- Graphics pipeline (milestone 34) ------------------------------------------------

inline Conn* gfx_conn(RdpgfxClientContext* gfx) {
    // gdi_graphics_pipeline_init sets `custom` to the GDI.
    auto* gdi = static_cast<rdpGdi*>(gfx ? gfx->custom : nullptr);
    if (!gdi || !gdi->context) return nullptr;
    return ctx_of(gdi->context)->conn;
}

// FreeRDP's GDI decodes the command; Flint counts it, times it and keeps its codec.
inline UINT on_gfx_surface_command(RdpgfxClientContext* gfx, const RDPGFX_SURFACE_COMMAND* cmd) {
    Conn* c = gfx_conn(gfx);
    if (!c || !c->gfx_surface_command) return ERROR_INTERNAL_ERROR;
    auto started = std::chrono::steady_clock::now();
    UINT rc = c->gfx_surface_command(gfx, cmd);
    auto us = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - started).count();
    Tab* t = c->tab;
    t->st_commands.fetch_add(1, std::memory_order_relaxed);
    t->st_decode_us.fetch_add(static_cast<uint64_t>(us), std::memory_order_relaxed);
    if (cmd && cmd->codecId < 32) t->st_codecs.fetch_or(1u << cmd->codecId, std::memory_order_relaxed);
    return rc;
}

// Whether this build of FreeRDP can decode AVC/H.264 (FFmpeg, VideoToolbox, Media
// Foundation or OpenH264, whichever it was built with): only then is it offered.
inline bool h264_available() {
    static const bool ok = [] {
        H264_CONTEXT* h = h264_context_new(FALSE);
        if (!h) return false;
        h264_context_free(h);
        return true;
    }();
    return ok;
}

inline void on_channel_connected(void* context, const ChannelConnectedEventArgs* e) {
    auto* ctx = static_cast<rdpContext*>(context);
    Conn* c = ctx_of(ctx)->conn;
    if (!c || !e || !e->name) return;
    if (std::strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
        auto* disp = static_cast<DispClientContext*>(e->pInterface);
        disp->custom = c;
        disp->DisplayControlCaps = on_disp_caps;
        c->disp = disp;
    } else if (std::strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) {
        auto* clip = static_cast<CliprdrClientContext*>(e->pInterface);
        clip->custom = c;
        clip->MonitorReady = on_clip_monitor_ready;
        clip->ServerCapabilities = on_clip_server_caps;
        clip->ServerFormatList = on_clip_server_format_list;
        clip->ServerFormatListResponse = on_clip_server_format_list_response;
        clip->ServerFormatDataResponse = on_clip_server_data_response;
        clip->ServerFormatDataRequest = on_clip_server_data_request;
        c->clip = clip;
    } else if (std::strcmp(e->name, RDPGFX_DVC_CHANNEL_NAME) == 0) {
        auto* gfx = static_cast<RdpgfxClientContext*>(e->pInterface);
        if (!ctx->gdi || !gdi_graphics_pipeline_init(ctx->gdi, gfx)) return;
        c->gfx = gfx;
        c->gfx_surface_command = gfx->SurfaceCommand;
        gfx->SurfaceCommand = on_gfx_surface_command;
        c->tab->st_gfx.store(true);
    }
}

inline void on_channel_disconnected(void* context, const ChannelDisconnectedEventArgs* e) {
    auto* ctx = static_cast<rdpContext*>(context);
    Conn* c = ctx_of(ctx)->conn;
    if (!c || !e || !e->name) return;
    if (std::strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
        c->disp_ready.store(false);
        c->disp = nullptr;
    } else if (std::strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) {
        c->clip_ready.store(false);
        c->clip = nullptr;
    } else if (std::strcmp(e->name, RDPGFX_DVC_CHANNEL_NAME) == 0) {
        auto* gfx = static_cast<RdpgfxClientContext*>(e->pInterface);
        if (gfx && c->gfx_surface_command) gfx->SurfaceCommand = c->gfx_surface_command;
        if (ctx->gdi && gfx) gdi_graphics_pipeline_uninit(ctx->gdi, gfx);
        c->gfx = nullptr;
        c->gfx_surface_command = nullptr;
        c->tab->st_gfx.store(false);
    }
}

// ---- Connecting ----------------------------------------------------------------

inline BOOL on_pre_connect(freerdp* inst) {
    rdpContext* ctx = inst->context;
    PubSub_SubscribeChannelConnected(ctx->pubSub, on_channel_connected);
    PubSub_SubscribeChannelDisconnected(ctx->pubSub, on_channel_disconnected);
    return TRUE;
}

// Only the channels Flint uses: the dynamic channel carrier, Display Control, the
// graphics pipeline when it is offered, and the clipboard (FreeRDP's own loader also
// asks for device redirection, which Flint leaves out).
inline BOOL load_channels(freerdp* inst) {
    rdpContext* ctx = inst->context;
    rdpSettings* st = ctx->settings;
    // drdynvc finds its plugins (disp) through the registered provider, which FreeRDP's
    // own clients register when they start.
    static std::once_flag registered;
    std::call_once(registered, [] { freerdp_register_addin_provider(freerdp_channels_load_static_addin_entry, 0); });
    const char* const disp[] = { DISP_CHANNEL_NAME };
    if (!freerdp_client_add_dynamic_channel(st, 1, disp)) return FALSE;
    if (freerdp_settings_get_bool(st, FreeRDP_SupportGraphicsPipeline)) {
        const char* const gfx[] = { RDPGFX_CHANNEL_NAME };
        if (!freerdp_client_add_dynamic_channel(st, 1, gfx)) return FALSE;
    }
    if (!freerdp_settings_set_bool(st, FreeRDP_SupportDynamicChannels, TRUE)) return FALSE;
    PVIRTUALCHANNELENTRY entry = freerdp_channels_load_static_addin_entry(
        DRDYNVC_SVC_CHANNEL_NAME, nullptr, nullptr, FREERDP_ADDIN_CHANNEL_STATIC | FREERDP_ADDIN_CHANNEL_ENTRYEX);
    if (!entry) return FALSE;
    if (freerdp_channels_client_load_ex(ctx->channels, st, reinterpret_cast<PVIRTUALCHANNELENTRYEX>(entry), st) != 0) return FALSE;
    PVIRTUALCHANNELENTRY clip = freerdp_channels_load_static_addin_entry(
        CLIPRDR_SVC_CHANNEL_NAME, nullptr, nullptr, FREERDP_ADDIN_CHANNEL_STATIC | FREERDP_ADDIN_CHANNEL_ENTRYEX);
    if (!clip) return FALSE;
    return freerdp_channels_client_load_ex(ctx->channels, st, reinterpret_cast<PVIRTUALCHANNELENTRYEX>(clip), nullptr) == 0;
}

inline BOOL on_post_connect(freerdp* inst) {
    if (!gdi_init(inst, PIXEL_FORMAT_RGBA32)) return FALSE;
    rdpContext* ctx = inst->context;
    ctx->update->BeginPaint = on_begin_paint;
    ctx->update->EndPaint = on_end_paint;
    ctx->update->DesktopResize = on_desktop_resize;
    return TRUE;
}

inline void on_post_disconnect(freerdp* inst) {
    if (!inst || !inst->context) return;
    PubSub_UnsubscribeChannelConnected(inst->context->pubSub, on_channel_connected);
    PubSub_UnsubscribeChannelDisconnected(inst->context->pubSub, on_channel_disconnected);
    if (inst->context->gdi) gdi_free(inst);
}

inline std::string take_c_string(char* s) {
    std::string out = s ? s : "";
    free(s);
    return out;
}

// Every certificate comes here (ExternalCertificateManagement): only the one the core
// trusts passes, for this session only (FreeRDP keeps no store of its own).
inline int on_verify_x509(freerdp* inst, const BYTE* data, size_t length, const char* host, UINT16 port, DWORD flags) {
    (void)host; (void)port; (void)flags;
    Tab* t = ctx_of(inst->context)->tab;
    std::string pem(reinterpret_cast<const char*>(data), length);
    rdpCertificate* cert = freerdp_certificate_new_from_pem(pem.c_str());
    Cert c;
    if (cert) {
        c.fingerprint = take_c_string(freerdp_certificate_get_fingerprint_by_hash(cert, "sha256"));
        c.subject = take_c_string(freerdp_certificate_get_subject(cert));
        c.issuer = take_c_string(freerdp_certificate_get_issuer(cert));
        c.valid_from = take_c_string(freerdp_certificate_get_validity(cert, TRUE));
        c.valid_to = take_c_string(freerdp_certificate_get_validity(cert, FALSE));
        freerdp_certificate_free(cert);
    }
    for (auto& ch : c.fingerprint) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    std::lock_guard<std::mutex> g(t->mu);
    t->presented = c;
    bool ok = !c.fingerprint.empty() && !t->trusted.empty() && c.fingerprint.size() == t->trusted.size() &&
              sodium_memcmp(c.fingerprint.data(), t->trusted.data(), c.fingerprint.size()) == 0;
    t->cert_refused = !ok;
    return ok ? 2 : 0;
}

inline int classify(UINT32 err) {
    switch (err) {
        case FREERDP_ERROR_CONNECT_LOGON_FAILURE:
        case FREERDP_ERROR_CONNECT_WRONG_PASSWORD:
        case FREERDP_ERROR_CONNECT_NO_OR_MISSING_CREDENTIALS:
        case FREERDP_ERROR_CONNECT_ACCOUNT_DISABLED:
        case FREERDP_ERROR_CONNECT_ACCOUNT_RESTRICTION:
        case FREERDP_ERROR_CONNECT_ACCOUNT_LOCKED_OUT:
        case FREERDP_ERROR_CONNECT_ACCOUNT_EXPIRED:
        case FREERDP_ERROR_CONNECT_PASSWORD_EXPIRED:
        case FREERDP_ERROR_CONNECT_PASSWORD_MUST_CHANGE:
        case FREERDP_ERROR_CONNECT_PASSWORD_CERTAINLY_EXPIRED:
        case FREERDP_ERROR_CONNECT_LOGON_TYPE_NOT_GRANTED:
        case FREERDP_ERROR_AUTHENTICATION_FAILED:
        case FREERDP_ERROR_CONNECT_ACCESS_DENIED:
            return RDP_ERR_AUTH;
        case FREERDP_ERROR_CONNECT_TRANSPORT_FAILED:
        case FREERDP_ERROR_DNS_ERROR:
        case FREERDP_ERROR_DNS_NAME_NOT_FOUND:
        case FREERDP_ERROR_CONNECT_FAILED:
            return RDP_ERR_NETWORK;
        case FREERDP_ERROR_TLS_CONNECT_FAILED:
        case FREERDP_ERROR_CONNECT_CANCELLED:
            return RDP_ERR_TLS;
        case FREERDP_ERROR_SECURITY_NEGO_CONNECT_FAILED:
        case FREERDP_ERROR_CONNECT_CLIENT_REVOKED:
        case FREERDP_ERROR_SERVER_DENIED_CONNECTION:
        case FREERDP_ERROR_INSUFFICIENT_PRIVILEGES:
            return RDP_ERR_REFUSED;
        default:
            return RDP_ERR_OTHER;
    }
}

// After a network failure: whether the port actively refused (nothing listens there:
// Remote Desktop is off or a firewall rejects), as opposed to no answer at all.
inline bool port_refused(const std::string& host, int32_t port, int64_t wait_ms) {
    if (!sock_init()) return false;
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    std::string p = std::to_string(port);
    if (getaddrinfo(host.c_str(), p.c_str(), &hints, &res) != 0 || !res) return false;
    bool refused = false;
    for (addrinfo* ai = res; ai; ai = ai->ai_next) {
        sock_t fd = ::socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd == BAD_SOCK) continue;
        sock_nonblock(fd);
        int rc = ::connect(fd, ai->ai_addr, static_cast<int>(ai->ai_addrlen));
        int e = rc != 0 ? sock_error() : 0;
        if (rc != 0 && sock_refused_error(e)) refused = true;
        if (rc != 0 && sock_in_progress(e)) {
            pollfd pfd{};
            pfd.fd = fd;
            pfd.events = POLLOUT;
            if (sock_poll(&pfd, 1, static_cast<int>(wait_ms)) == 1) {
                int err = 0;
                socklen_t len = sizeof err;
                getsockopt(fd, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&err), &len);
                if (sock_refused_error(err)) refused = true;
            }
        }
        sock_close(fd);
        if (refused) break;
    }
    freeaddrinfo(res);
    return refused;
}

// The round trip of a TCP dial to host:port, in ms: the best of `tries` dials, each
// opened and closed with nothing sent (milestone 35, the "auto" graphics choice); -1
// when none answers within `wait_ms` in all.
inline int64_t dial_rtt_ms(const std::string& host, int32_t port, int64_t wait_ms, int tries) {
    if (!sock_init()) return -1;
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    std::string p = std::to_string(port);
    if (getaddrinfo(host.c_str(), p.c_str(), &hints, &res) != 0 || !res) return -1;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(wait_ms);
    int64_t best_us = -1;
    for (int i = 0; i < tries; ++i) {
        auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
        if (left <= 0) break;
        sock_t fd = ::socket(res->ai_family, res->ai_socktype, res->ai_protocol);
        if (fd == BAD_SOCK) break;
        sock_nonblock(fd);
        auto started = std::chrono::steady_clock::now();
        int rc = ::connect(fd, res->ai_addr, static_cast<int>(res->ai_addrlen));
        bool up = rc == 0;
        if (rc != 0 && sock_in_progress(sock_error())) {
            pollfd pfd{};
            pfd.fd = fd;
            pfd.events = POLLOUT;
            if (sock_poll(&pfd, 1, static_cast<int>(left)) == 1) {
                int err = 0;
                socklen_t len = sizeof err;
                getsockopt(fd, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&err), &len);
                up = err == 0;
            }
        }
        auto us = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - started).count();
        sock_close(fd);
        if (!up) break;
        if (best_us < 0 || us < best_us) best_us = us;
    }
    freeaddrinfo(res);
    return best_us < 0 ? -1 : (best_us + 999) / 1000;
}

// This machine's keyboard layout as a Windows layout id (KLID), so the remote session
// reads the scancodes Flint sends with the same layout. 0 lets FreeRDP pick.
#if defined(__APPLE__)
inline uint32_t klid_for_input_source(const std::string& id) {
    static const std::unordered_map<std::string, uint32_t> table = {
        {"com.apple.keylayout.US", 0x00000409},
        {"com.apple.keylayout.ABC", 0x00000409},
        {"com.apple.keylayout.USExtended", 0x00000409},
        {"com.apple.keylayout.USInternational-PC", 0x00020409},
        {"com.apple.keylayout.Dvorak", 0x00010409},
        {"com.apple.keylayout.Colemak", 0x00000409},
        {"com.apple.keylayout.British", 0x00000809},
        {"com.apple.keylayout.British-PC", 0x00000809},
        {"com.apple.keylayout.Irish", 0x00001809},
        {"com.apple.keylayout.Spanish", 0x0000040A},
        {"com.apple.keylayout.Spanish-ISO", 0x0000040A},
        {"com.apple.keylayout.LatinAmerican", 0x0000080A},
        {"com.apple.keylayout.Catalan", 0x0000040A},
        {"com.apple.keylayout.Portuguese", 0x00000816},
        {"com.apple.keylayout.Brazilian", 0x00000416},
        {"com.apple.keylayout.Brazilian-ABNT2", 0x00000416},
        {"com.apple.keylayout.Brazilian-Pro", 0x00000416},
        {"com.apple.keylayout.German", 0x00000407},
        {"com.apple.keylayout.Austrian", 0x00000407},
        {"com.apple.keylayout.SwissGerman", 0x00000807},
        {"com.apple.keylayout.SwissFrench", 0x0000100C},
        {"com.apple.keylayout.French", 0x0000040C},
        {"com.apple.keylayout.French-PC", 0x0000040C},
        {"com.apple.keylayout.Belgian", 0x0000080C},
        {"com.apple.keylayout.Canadian", 0x00001009},
        {"com.apple.keylayout.Canadian-CSA", 0x00011009},
        {"com.apple.keylayout.Italian", 0x00000410},
        {"com.apple.keylayout.Italian-Pro", 0x00000410},
        {"com.apple.keylayout.Dutch", 0x00000413},
        {"com.apple.keylayout.Danish", 0x00000406},
        {"com.apple.keylayout.Norwegian", 0x00000414},
        {"com.apple.keylayout.Swedish", 0x0000041D},
        {"com.apple.keylayout.Swedish-Pro", 0x0000041D},
        {"com.apple.keylayout.Finnish", 0x0000040B},
        {"com.apple.keylayout.Polish", 0x00000415},
        {"com.apple.keylayout.PolishPro", 0x00000415},
        {"com.apple.keylayout.Czech", 0x00000405},
        {"com.apple.keylayout.Czech-QWERTY", 0x00010405},
        {"com.apple.keylayout.Hungarian", 0x0000040E},
        {"com.apple.keylayout.Turkish", 0x0001041F},
        {"com.apple.keylayout.Turkish-QWERTY-PC", 0x0000041F},
        {"com.apple.keylayout.Russian", 0x00000419},
        {"com.apple.keylayout.RussianWin", 0x00000419},
        {"com.apple.keylayout.Ukrainian", 0x00000422},
        {"com.apple.keylayout.Greek", 0x00000408},
    };
    auto it = table.find(id);
    return it == table.end() ? 0 : it->second;
}

struct MacKeyboard {
    uint32_t klid = 0;
    bool iso = false;
};

inline MacKeyboard read_mac_keyboard() {
    MacKeyboard k;
    auto read = [&k] {
        TISInputSourceRef src = TISCopyCurrentKeyboardLayoutInputSource();
        if (src) {
            auto sid = static_cast<CFStringRef>(TISGetInputSourceProperty(src, kTISPropertyInputSourceID));
            char buf[256] = {0};
            if (sid && CFStringGetCString(sid, buf, sizeof buf, kCFStringEncodingUTF8)) k.klid = klid_for_input_source(buf);
            CFRelease(src);
        }
        k.iso = KBGetLayoutType(LMGetKbdType()) == kKeyboardISO;
    };
    // Text Input Sources are main-thread only.
    if (pthread_main_np()) {
        read();
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{ read(); });
    }
    return k;
}

inline MacKeyboard& mac_keyboard() {
    static MacKeyboard k;
    return k;
}
#endif

inline uint32_t local_keyboard_layout() {
#if defined(__APPLE__)
    mac_keyboard() = read_mac_keyboard();
    if (mac_keyboard().klid != 0) return mac_keyboard().klid;
#endif
    // Deprecated since FreeRDP 3.11 for clients with their own detection; Flint has
    // none on Linux, where it reads the X keyboard map or the locale.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
    return freerdp_keyboard_init(0);
#pragma GCC diagnostic pop
}

// Pixels of `gdi`'s surface that differ from what the frame channel handed out, outside
// the pending dirty region (it is about to go out anyway). Alpha is left out. Called
// with `t.mu` held, on the connection's own thread, so FreeRDP is not drawing.
inline uint64_t stale_pixels_locked(const Tab& t, rdpGdi* gdi) {
    if (t.shadow_w != static_cast<int32_t>(gdi->width) || t.shadow_h != static_cast<int32_t>(gdi->height)) return 0;
    uint64_t n = 0;
    const size_t row_bytes = static_cast<size_t>(t.shadow_w) * 4;
    for (int32_t y = 0; y < t.shadow_h; ++y) {
        const uint8_t* a = gdi->primary_buffer + static_cast<size_t>(y) * gdi->stride;
        const uint8_t* b = t.shadow.data() + static_cast<size_t>(y) * row_bytes;
        if (std::memcmp(a, b, row_bytes) == 0) continue;
        for (int32_t x = 0; x < t.shadow_w; ++x) {
            if (pending_at(t, x, y)) continue;
            const uint8_t* pa = a + static_cast<size_t>(x) * 4;
            const uint8_t* pb = b + static_cast<size_t>(x) * 4;
            if (pa[0] != pb[0] || pa[1] != pb[1] || pa[2] != pb[2]) n++;
        }
    }
    return n;
}

// After a quiet second that followed some updates: counts the stale pixels, then marks
// the whole desktop dirty once (milestone 35).
inline void quiet_reread(Tab& t, rdpGdi* gdi) {
    if (!gdi || !gdi->primary_buffer) return;
    {
        std::lock_guard<std::mutex> g(t.mu);
        if (!t.reread_due) return;
        if (std::chrono::steady_clock::now() - t.last_update < std::chrono::milliseconds(REREAD_QUIET_MS)) return;
        t.reread_due = false;
        t.st_stale_px.fetch_add(stale_pixels_locked(t, gdi), std::memory_order_relaxed);
        t.st_rereads.fetch_add(1, std::memory_order_relaxed);
        mark_locked(t, 0, 0, static_cast<int32_t>(gdi->width), static_cast<int32_t>(gdi->height));
    }
    t.cv.notify_all();
}

// The loop of one connection: FreeRDP's events until it ends or is stopped.
inline void run_loop(std::shared_ptr<Conn> c) {
    HANDLE handles[MAXIMUM_WAIT_OBJECTS] = {};
    rdpContext* ctx = c->inst->context;
    while (!c->stop.load()) {
        DWORD n = freerdp_get_event_handles(ctx, handles, MAXIMUM_WAIT_OBJECTS);
        if (n == 0) break;
        DWORD st = WaitForMultipleObjects(n, handles, FALSE, 100);
        if (st == WAIT_FAILED) break;
        if (!freerdp_check_event_handles(ctx)) break;
        if (freerdp_shall_disconnect_context(ctx)) break;
        quiet_reread(*c->tab, ctx->gdi);
    }
    c->last_error = freerdp_get_last_error(ctx);
    c->error_info = freerdp_error_info(c->inst);
    c->ended.store(true);
    Tab* t = c->tab;
    { std::lock_guard<std::mutex> g(t->mu); }
    t->cv.notify_all();
}

// Stops a connection and frees it. Not under the tab's lock.
inline void end_conn(std::shared_ptr<Conn> c) {
    if (!c) return;
    c->stop.store(true);
    if (c->loop.joinable()) c->loop.join();
    freerdp_disconnect(c->inst);
    freerdp_context_free(c->inst);
    freerdp_free(c->inst);
    c->inst = nullptr;
}

// Wipes the password from the connection's settings and from FreeRDP's own backup
// of them (milestone 36, D-085). `freerdp_connect` clones the settings, password and
// all, into a backup it keeps for the whole session (`originalSettings`, for a
// redirect or its own reconnect); persisting the now empty credentials replaces that
// copy, and FreeRDP zeroes a string it frees. Returns whether the backup was wiped.
// The NLA module's copy (the identity and NTLM's hashes) stays until the connection
// is freed, where FreeRDP zeroes it: no public call frees it sooner (D-085).
inline bool wipe_password(rdpContext* ctx) {
    rdpSettings* st = ctx->settings;
    const char* pw = freerdp_settings_get_string(st, FreeRDP_Password);
    if (pw) sodium_memzero(const_cast<char*>(pw), std::strlen(pw));
    freerdp_settings_set_string(st, FreeRDP_Password, nullptr);
    return freerdp_persist_credentials(ctx) == TRUE;
}

inline bool start_frame_server(std::shared_ptr<Tab> t);

// Tabs closed before their first open began: that open must not connect a desktop
// nobody shows.
inline std::map<std::string, bool>& tombstones() {
    static std::map<std::string, bool> r;
    return r;
}

// FreeRDP logs to stderr with the server's address in its lines ("ConnectLayer
// 10.0.0.5:3389 failed"): Principle 5 keeps a vault's hostnames out of logs, so its log is
// off unless a person asks for it with FLINT_RDP_DEBUG=1.
inline void quiet_freerdp_log() {
    static std::once_flag once;
    std::call_once(once, [] {
        const char* debug = std::getenv("FLINT_RDP_DEBUG");
        if (!debug || std::string(debug) != "1") WLog_SetLogLevel(WLog_GetRoot(), WLOG_OFF);
    });
}

inline std::shared_ptr<Tab> tab_for(const std::string& id) {
    std::lock_guard<std::mutex> g(registry_mu());
    auto it = registry().find(id);
    if (it != registry().end()) return it->second;
    auto t = std::make_shared<Tab>();
    t->id = id;
    if (tombstones().erase(id) > 0) t->closed.store(true);
    registry()[id] = t;
    return t;
}

// FreeRDP's own TCP dial, with one more socket option where FreeRDP sets none: on
// macOS (no TCP_USER_TIMEOUT) a connection whose data goes unacknowledged is dropped
// after 20 s instead of the system's several minutes of retries.
inline pTCPConnect& default_tcp_connect() { static pTCPConnect f = nullptr; return f; }

inline int connect_tcp(rdpContext* ctx, rdpSettings* st, const char* host, int port, DWORD timeout) {
    int fd = default_tcp_connect()(ctx, st, host, port, timeout);
#if defined(__APPLE__) && defined(TCP_RXT_CONNDROPTIME)
    if (fd >= 0) {
        int secs = 20;
        (void)setsockopt(fd, IPPROTO_TCP, TCP_RXT_CONNDROPTIME, &secs, sizeof secs);
    }
#endif
    return fd;
}

// FreeRDP's own PDU read, counting the bytes received for the statistics.
inline pTransportRWFkt& default_read_pdu() { static pTransportRWFkt f = nullptr; return f; }

// Whether the server's X.224 Connection Confirm (the first PDU) leaves only Standard
// RDP Security: no negotiation data, a response choosing it (PROTOCOL_RDP, 0), or a
// failure saying SSL_NOT_ALLOWED_BY_SERVER (2). [MS-RDPBCGR] 2.2.1.2.
inline bool legacy_only_answer(const uint8_t* b, size_t n) {
    if (n < 11 || b[0] != 0x03 || (b[5] & 0xf0) != 0xd0) return false;
    if (b[4] == 6) return true;
    if (n < 19) return false;
    const uint32_t v = static_cast<uint32_t>(b[15]) | (static_cast<uint32_t>(b[16]) << 8) |
                       (static_cast<uint32_t>(b[17]) << 16) | (static_cast<uint32_t>(b[18]) << 24);
    if (b[11] == 0x02) return v == 0;
    if (b[11] == 0x03) return v == 2;
    return false;
}

inline int read_pdu(rdpTransport* transport, wStream* s) {
    int rc = default_read_pdu()(transport, s);
    if (rc > 0) {
        rdpContext* ctx = transport_get_context(transport);
        Tab* t = ctx ? ctx_of(ctx)->tab : nullptr;
        if (t) t->st_bytes_in.fetch_add(static_cast<uint64_t>(rc), std::memory_order_relaxed);
        Conn* c = ctx ? ctx_of(ctx)->conn : nullptr;
        if (c && !c->x224_seen.exchange(true)) {
            c->legacy_only.store(legacy_only_answer(Stream_Buffer(s), static_cast<size_t>(rc)));
        }
    }
    return rc;
}

inline void install_tcp_hook(rdpContext* ctx) {
    const rdpTransportIo* io = freerdp_get_io_callbacks(ctx);
    if (!io || !io->TCPConnect) return;
    rdpTransportIo mine = *io;
    if (io->TCPConnect != connect_tcp) default_tcp_connect() = io->TCPConnect;
    if (!default_tcp_connect()) return;
    mine.TCPConnect = connect_tcp;
    if (io->ReadPdu && io->ReadPdu != read_pdu) default_read_pdu() = io->ReadPdu;
    if (default_read_pdu()) mine.ReadPdu = read_pdu;
    (void)freerdp_set_io_callbacks(ctx, &mine);
}

// Connects tab `id` (creating it, or replacing its connection), logs in and starts
// the connection's loop. `layout` (milestone 38) spans the desktop over several
// monitors ("x,y,w,h,p;...", the primary first at 0,0), `width` x `height` its box;
// empty for one monitor. Returns RDP_OK and the desktop's size and frame channel, or
// an RDP_ERR_* code; `detail` gets FreeRDP's error name, never a credential.
inline int open(const std::string& id, const std::string& host, int32_t port, const std::string& user,
                const std::string& domain, const std::string& password, int32_t width, int32_t height,
                const std::string& trusted, const std::string& graphics, const std::string& layout_s, int64_t timeout_ms, int32_t& out_w, int32_t& out_h, int32_t& out_port,
                std::string& out_token, std::string& detail) {
    quiet_freerdp_log();
    auto t = tab_for(id);
    if (t->closed.load()) return RDP_ERR_CLOSED;
    std::vector<Mon> layout = parse_layout(layout_s);
    if (layout.size() < 2) layout.clear();
    // A reconnect: the old connection goes first, so the server never sees two.
    std::shared_ptr<Conn> old;
    {
        std::lock_guard<std::mutex> g(t->mu);
        old = t->conn;
        t->conn = nullptr;
        t->want_w = 0;
        t->want_h = 0;
        t->trusted = trusted;
        for (auto& ch : t->trusted) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
        t->presented = Cert{};
        t->cert_refused = false;
        t->request_pending = false;
        t->want_gfx = graphics != "compatible";
        t->want_graphics.clear();
        t->reread_due = false;
    }
    t->st_gfx.store(false);
    t->st_codecs.store(0);
    end_conn(old);

    auto c = std::make_shared<Conn>();
    c->tab = t.get();
    freerdp* inst = freerdp_new();
    if (!inst) { detail = "out of memory"; return RDP_ERR_OTHER; }
    inst->ContextSize = sizeof(Context);
    inst->PreConnect = on_pre_connect;
    inst->PostConnect = on_post_connect;
    inst->PostDisconnect = on_post_disconnect;
    inst->LoadChannels = load_channels;
    inst->VerifyX509Certificate = on_verify_x509;
    if (!freerdp_context_new(inst)) {
        freerdp_free(inst);
        detail = "FreeRDP could not create a context";
        return RDP_ERR_OTHER;
    }
    ctx_of(inst->context)->tab = t.get();
    ctx_of(inst->context)->conn = c.get();
    c->inst = inst;
    rdpSettings* st = inst->context->settings;
    freerdp_settings_set_string(st, FreeRDP_ServerHostname, host.c_str());
    freerdp_settings_set_uint32(st, FreeRDP_ServerPort, static_cast<UINT32>(port));
    freerdp_settings_set_string(st, FreeRDP_Username, user.c_str());
    if (!domain.empty()) freerdp_settings_set_string(st, FreeRDP_Domain, domain.c_str());
    freerdp_settings_set_string(st, FreeRDP_Password, password.c_str());
    // Without it the server shows its own logon screen after NLA has already passed.
    freerdp_settings_set_bool(st, FreeRDP_AutoLogonEnabled, TRUE);
    // Only TLS or NLA (milestone 36, D-085). The negotiation is not authenticated, so a
    // machine in the middle could answer "standard RDP security", where no X.509
    // certificate is checked and the auto-logon password goes under keys it chose.
    freerdp_settings_set_bool(st, FreeRDP_RdpSecurity, FALSE);
    // Kerberos first stalls on a user written as an e-mail address (M28): NTLM only.
    freerdp_settings_set_string(st, FreeRDP_AuthenticationPackageList, "ntlm,!kerberos");
    freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, static_cast<UINT32>(width));
    freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, static_cast<UINT32>(height));
    if (!layout.empty()) {
        // As xfreerdp's /multimon: the box as the desktop, one entry per monitor, the
        // primary first at 0,0 (MS-RDPBCGR 2.2.1.3.6.1). Orientation stays landscape
        // with the size already turned, which Windows takes for a portrait (D-089).
        // The Monitor Layout PDU only with two or more (some servers freeze on one).
        int32_t bx, by, bw, bh;
        layout_box(layout, bx, by, bw, bh);
        freerdp_settings_set_bool(st, FreeRDP_UseMultimon, TRUE);
        freerdp_settings_set_bool(st, FreeRDP_ForceMultimon, TRUE);
        freerdp_settings_set_bool(st, FreeRDP_HasMonitorAttributes, TRUE);
        freerdp_settings_set_bool(st, FreeRDP_SupportMonitorLayoutPdu, TRUE);
        freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, static_cast<UINT32>(bw));
        freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, static_cast<UINT32>(bh));
        freerdp_settings_set_pointer_len(st, FreeRDP_MonitorDefArray, nullptr, layout.size());
        for (size_t i = 0; i < layout.size(); ++i) {
            rdpMonitor m{};
            m.x = layout[i].x; m.y = layout[i].y; m.width = layout[i].w; m.height = layout[i].h;
            m.is_primary = layout[i].primary ? TRUE : FALSE;
            m.orig_screen = static_cast<UINT32>(i);
            m.attributes.orientation = ORIENTATION_LANDSCAPE;
            m.attributes.desktopScaleFactor = 100;
            m.attributes.deviceScaleFactor = 100;
            freerdp_settings_set_pointer_array(st, FreeRDP_MonitorDefArray, i, &m);
        }
        freerdp_settings_set_uint32(st, FreeRDP_MonitorCount, static_cast<UINT32>(layout.size()));
    }
    freerdp_settings_set_uint32(st, FreeRDP_ColorDepth, 32);
    freerdp_settings_set_uint32(st, FreeRDP_KeyboardLayout, local_keyboard_layout());
    freerdp_settings_set_uint32(st, FreeRDP_TcpConnectTimeout, static_cast<UINT32>(timeout_ms));
    freerdp_settings_set_bool(st, FreeRDP_ExternalCertificateManagement, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_SoftwareGdi, TRUE);
    // NSCodec costs nothing with Windows (it does not use it) and is what FreeRDP's
    // own servers, the test server among them, need.
    freerdp_settings_set_bool(st, FreeRDP_NSCodec, TRUE);
    // Milestone 35: the link's type is auto-detected, as `/network:auto` does, so
    // Windows measures bandwidth and round trip and sets the pipeline's quality from
    // them; it also allows the desktop's composition, font smoothing and wallpaper.
    // Without it FreeRDP sends no type and Windows may treat the link as slow.
    // Before the graphics settings (milestone 38): applying a connection type turns
    // the pipeline on in some FreeRDP versions (Debian's 3.15: Compatible came out as
    // gfx on Linux), so the mode asked for must be set after it.
    freerdp_set_connection_type(st, CONNECTION_TYPE_AUTODETECT);
    freerdp_settings_set_bool(st, FreeRDP_NetworkAutoDetect, TRUE);
    // The graphics pipeline (milestone 34): progressive always (FreeRDP decodes it
    // itself), AVC/H.264 only where this build decodes it. The server chooses among
    // what is offered; without RDPGFX it keeps the bitmap updates.
    const bool gfx = graphics != "compatible";
    const bool avc = gfx && h264_available();
    freerdp_settings_set_bool(st, FreeRDP_SupportGraphicsPipeline, gfx ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxProgressive, gfx ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxProgressiveV2, gfx ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_RemoteFxCodec, gfx ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxH264, avc ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxAVC444, avc ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxAVC444v2, avc ? TRUE : FALSE);
    freerdp_settings_set_bool(st, FreeRDP_GfxThinClient, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_SupportDisplayControl, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_DynamicResolutionUpdate, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_AudioPlayback, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_DeviceRedirection, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_RedirectClipboard, TRUE);
    // A connection that goes quiet is noticed (Principle 8): TCP keepalive after 5 s
    // idle, every 2 s, 3 probes (~11 s); with data in flight, Linux gives up after 9 s
    // unacknowledged (TCP_USER_TIMEOUT) and macOS after 20 s (connect_tcp below).
    // These are FreeRDP's defaults, set here so they stay Flint's choice.
    freerdp_settings_set_bool(st, FreeRDP_TcpKeepAlive, TRUE);
    freerdp_settings_set_uint32(st, FreeRDP_TcpKeepAliveDelay, 5);
    freerdp_settings_set_uint32(st, FreeRDP_TcpKeepAliveInterval, 2);
    freerdp_settings_set_uint32(st, FreeRDP_TcpKeepAliveRetries, 3);
    freerdp_settings_set_uint32(st, FreeRDP_TcpAckTimeout, 9000);
    install_tcp_hook(inst->context);

    {
        std::lock_guard<std::mutex> g(t->connecting_mu);
        if (t->closed.load()) {
            freerdp_context_free(inst);
            freerdp_free(inst);
            return RDP_ERR_CLOSED;
        }
        t->connecting = inst;
    }
    // TcpConnectTimeout bounds the dial; a watchdog bounds the whole handshake (TLS,
    // NLA, licensing), which FreeRDP leaves to the server (Principle 8).
    std::atomic<bool> done{false};
    std::thread watchdog([&] {
        auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (!done.load() && std::chrono::steady_clock::now() < deadline) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        if (!done.load()) freerdp_abort_connect_context(inst->context);
    });
    auto started = std::chrono::steady_clock::now();
    BOOL ok = freerdp_connect(inst);
    done.store(true);
    watchdog.join();
    {
        std::lock_guard<std::mutex> g(t->connecting_mu);
        t->connecting = nullptr;
    }
    // `rdp` is null when the context failed before its core was made: nothing to back up.
    const bool wiped = inst->context->rdp ? wipe_password(inst->context) : false;
    t->creds_wiped.store(wiped);
    if (ok && t->closed.load()) {
        freerdp_disconnect(inst);
        ok = FALSE;
    }
    if (!ok) {
        UINT32 err = freerdp_get_last_error(inst->context);
        auto elapsed = std::chrono::steady_clock::now() - started;
        bool refused_cert;
        {
            std::lock_guard<std::mutex> g(t->mu);
            refused_cert = t->cert_refused;
        }
        int code;
        if (t->closed.load()) {
            code = RDP_ERR_CLOSED;
            detail = "cancelled";
        } else if (refused_cert) {
            code = RDP_ERR_CERT;
            detail = "the certificate is not the trusted one";
        } else if (c->legacy_only.load()) {
            code = RDP_ERR_LEGACY_SECURITY;
            detail = "Standard RDP Security";
        } else if (elapsed >= std::chrono::milliseconds(timeout_ms) - std::chrono::milliseconds(50)) {
            code = RDP_ERR_TIMEOUT;
            detail = "no answer within the timeout";
        } else {
            code = classify(err);
            detail = freerdp_get_last_error_name(err);
            if (code == RDP_ERR_NETWORK && port_refused(host, port, 2000)) code = RDP_ERR_PORT_CLOSED;
        }
        freerdp_context_free(inst);
        freerdp_free(inst);
        return code;
    }
    if (t->listen_fd == BAD_SOCK && !start_frame_server(t)) {
        end_conn(c);
        detail = "the frame channel did not start";
        return RDP_ERR_OTHER;
    }
    {
        std::lock_guard<std::mutex> g(t->mu);
        t->conn = c;
        t->width = static_cast<int32_t>(inst->context->gdi->width);
        t->height = static_cast<int32_t>(inst->context->gdi->height);
        t->layout = layout;
        t->views = views_for(layout);
        mark_all_locked(*t);
        out_w = t->width;
        out_h = t->height;
        out_port = t->port;
        out_token = t->token;
    }
    c->loop = std::thread(run_loop, c);
    t->cv.notify_all();
    return RDP_OK;
}

inline bool presented_cert(const std::string& id, std::string& subject, std::string& issuer, std::string& fp,
                           std::string& from, std::string& to) {
    auto t = find(id);
    if (!t) return false;
    std::lock_guard<std::mutex> g(t->mu);
    subject = t->presented.subject;
    issuer = t->presented.issuer;
    fp = t->presented.fingerprint;
    from = t->presented.valid_from;
    to = t->presented.valid_to;
    return true;
}

// A new size: through Display Control when the server has it, else kept for `wait`
// to report so the core reconnects.
// A desktop spanning monitors goes back to one (milestone 38).
inline int resize(const std::string& id, int32_t w, int32_t h) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(t->mu);
        c = t->conn;
        if (!c || c->ended.load()) return RDP_ERR_CLOSED;
        const bool spanned = !t->layout.empty();
        if (spanned) {
            t->layout.clear();
            t->views = views_for(t->layout);
            mark_all_locked(*t);
            t->cv.notify_all();
        }
        if (!spanned && t->width == w && t->height == h) {
            t->want_w = 0;
            t->want_h = 0;
            return RDP_OK;
        }
    }
    if (c->disp_ready.load() && c->disp) {
        DISPLAY_CONTROL_MONITOR_LAYOUT layout{};
        layout.Flags = DISPLAY_CONTROL_MONITOR_PRIMARY;
        layout.Left = 0;
        layout.Top = 0;
        layout.Width = static_cast<UINT32>(w);
        layout.Height = static_cast<UINT32>(h);
        layout.Orientation = ORIENTATION_LANDSCAPE;
        layout.DesktopScaleFactor = 100;
        layout.DeviceScaleFactor = 100;
        std::lock_guard<std::mutex> g(t->input_mu);
        return c->disp->SendMonitorLayout(c->disp, 1, &layout) == CHANNEL_RC_OK ? RDP_OK : RDP_ERR_OTHER;
    }
    {
        std::lock_guard<std::mutex> g(t->mu);
        t->want_w = w;
        t->want_h = h;
    }
    t->cv.notify_all();
    return RDP_OK;
}

// The desktop across the monitors of `layout_s` (milestone 38): the frame channel's
// views follow at once; the server is told through Display Control when it has it and
// takes that many monitors, else `wait` reports a resize carrying the layout and the
// core reconnects with it.
inline int set_layout(const std::string& id, const std::string& layout_s) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    std::vector<Mon> layout = parse_layout(layout_s);
    if (layout.empty() || !layout[0].primary || layout[0].x != 0 || layout[0].y != 0) return RDP_ERR_OTHER;
    int32_t bx, by, bw, bh;
    layout_box(layout, bx, by, bw, bh);
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(t->mu);
        c = t->conn;
        if (!c || c->ended.load()) return RDP_ERR_CLOSED;
        t->layout = layout.size() < 2 ? std::vector<Mon>() : layout;
        t->views = views_for(t->layout);
        mark_all_locked(*t);
    }
    t->cv.notify_all();
    if (c->disp_ready.load() && c->disp && layout.size() <= c->disp_max.load()) {
        std::vector<DISPLAY_CONTROL_MONITOR_LAYOUT> L(layout.size());
        for (size_t i = 0; i < layout.size(); ++i) {
            auto& l = L[i];
            l.Flags = layout[i].primary ? DISPLAY_CONTROL_MONITOR_PRIMARY : 0;
            l.Left = layout[i].x;
            l.Top = layout[i].y;
            l.Width = static_cast<UINT32>(layout[i].w);
            l.Height = static_cast<UINT32>(layout[i].h);
            l.PhysicalWidth = 0;
            l.PhysicalHeight = 0;
            l.Orientation = ORIENTATION_LANDSCAPE;
            l.DesktopScaleFactor = 100;
            l.DeviceScaleFactor = 100;
        }
        std::lock_guard<std::mutex> g(t->input_mu);
        return c->disp->SendMonitorLayout(c->disp, static_cast<UINT32>(L.size()), L.data()) == CHANNEL_RC_OK ? RDP_OK : RDP_ERR_OTHER;
    }
    {
        std::lock_guard<std::mutex> g(t->mu);
        t->want_w = bw;
        t->want_h = bh;
    }
    t->cv.notify_all();
    return RDP_OK;
}

// Why a connection that was up has ended.
inline int end_reason(const Conn& c, std::string& detail) {
    UINT32 info = c.error_info;
    if (info == ERRINFO_LOGOFF_BY_USER || info == ERRINFO_RPC_INITIATED_LOGOFF) {
        detail = "the remote session was signed out";
        return RDP_ERR_ENDED;
    }
    if (info != 0 && info != ERRINFO_SUCCESS) {
        detail = freerdp_get_error_info_string(info);
        return RDP_ERR_ENDED;
    }
    detail = c.last_error ? freerdp_get_last_error_name(c.last_error) : "the server closed the connection";
    return RDP_ERR_LOST;
}

// Waits up to `wait_ms`: EV_ENDED (with `code` and `detail`; code 0 when the tab was
// closed), EV_RESIZE (the size the tab asked for) or EV_RUNNING.
inline int wait(const std::string& id, int64_t wait_ms, int32_t& code, std::string& detail, int32_t& w, int32_t& h,
                std::string& layout_out) {
    code = 0;
    detail.clear();
    layout_out.clear();
    auto t = find(id);
    if (!t || t->closed.load()) return EV_ENDED;
    std::unique_lock<std::mutex> g(t->mu);
    auto pending = [&] {
        return t->closed.load() || !t->conn || t->conn->ended.load() || t->want_w != 0 || t->remote_pending || t->request_pending ||
               !t->want_graphics.empty();
    };
    t->cv.wait_for(g, std::chrono::milliseconds(wait_ms), pending);
    if (t->closed.load()) return EV_ENDED;
    if (!t->conn) {
        code = RDP_ERR_CLOSED;
        detail = "the session is closed";
        return EV_ENDED;
    }
    if (t->conn->ended.load()) {
        code = end_reason(*t->conn, detail);
        return EV_ENDED;
    }
    if (t->want_w != 0) {
        w = t->want_w;
        h = t->want_h;
        t->want_w = 0;
        t->want_h = 0;
        layout_out = layout_text(t->layout);
        return EV_RESIZE;
    }
    if (t->remote_pending) {
        t->remote_pending = false;
        detail = std::move(t->remote_text);
        t->remote_text.clear();
        return EV_CLIP_TEXT;
    }
    if (t->request_pending) {
        return EV_CLIP_REQUEST;
    }
    if (!t->want_graphics.empty()) {
        detail = std::move(t->want_graphics);
        t->want_graphics.clear();
        w = t->width;
        h = t->height;
        layout_out = layout_text(t->layout);
        return EV_GRAPHICS;
    }
    return EV_RUNNING;
}

// The page asks for the tab in another graphics mode: `wait` reports it and the core
// reconnects (milestone 35). Nothing happens on the wire here.
inline int set_graphics(const std::string& id, const std::string& mode) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    {
        std::lock_guard<std::mutex> g(t->mu);
        if (!t->conn || t->conn->ended.load()) return RDP_ERR_CLOSED;
        t->want_graphics = mode;
    }
    t->cv.notify_all();
    return RDP_OK;
}

// This machine's clipboard holds text (or not): told to the server as a format list,
// now if its clipboard channel is up, else when it is.
inline int clip_announce(const std::string& id, bool has_text) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(t->mu);
        t->local_text = has_text;
        c = t->conn;
    }
    if (!c || c->ended.load() || !c->clip_ready.load() || !c->clip) return RDP_OK;
    std::lock_guard<std::mutex> g(t->input_mu);
    return clip_send_format_list(c->clip, has_text) == CHANNEL_RC_OK ? RDP_OK : RDP_ERR_OTHER;
}

// Answers the server's pending request: the text, or a refusal when `ok` is false.
inline int clip_answer(const std::string& id, bool ok, const std::string& text) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(t->mu);
        if (!t->request_pending) return RDP_OK;
        t->request_pending = false;
        c = t->conn;
    }
    if (!c || c->ended.load() || !c->clip) return RDP_ERR_CLOSED;
    if (text.size() > CLIP_MAX_BYTES) ok = false;
    std::lock_guard<std::mutex> g(t->input_mu);
    return clip_send_data(c->clip, ok, ok ? text : std::string()) == CHANNEL_RC_OK ? RDP_OK : RDP_ERR_OTHER;
}

// ---- Statistics (milestone 34) ----------------------------------------------------

// A codec id's name, as the statistics show it.
inline const char* codec_name(int32_t id) {
    switch (id) {
        case RDPGFX_CODECID_UNCOMPRESSED: return "uncompressed";
        case RDPGFX_CODECID_CAVIDEO: return "remotefx";
        case RDPGFX_CODECID_CLEARCODEC: return "clearcodec";
        case RDPGFX_CODECID_CAPROGRESSIVE: return "progressive";
        case RDPGFX_CODECID_CAPROGRESSIVE_V2: return "progressive";
        case RDPGFX_CODECID_PLANAR: return "planar";
        case RDPGFX_CODECID_AVC420: return "avc420";
        case RDPGFX_CODECID_AVC444: return "avc444";
        case RDPGFX_CODECID_AVC444v2: return "avc444";
        case RDPGFX_CODECID_ALPHA: return "alpha";
        default: return "";
    }
}

// The tab's counters since it opened. `pipeline`: "gfx" or "bitmap" ("" before the
// first connection); `codec`: the codecs its connection's surface commands used, in
// codec-id order, comma-separated ("" on the bitmap path).
inline int stats(const std::string& id, int64_t& updates, int64_t& bytes_in, int64_t& commands, int64_t& decode_us,
                 int64_t& frames_read, std::string& pipeline, std::string& codec, bool& h264, int64_t& rereads,
                 int64_t& stale_px, int64_t& link_kbps, int64_t& link_rtt_ms, std::string& mode) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    updates = static_cast<int64_t>(t->st_updates.load());
    bytes_in = static_cast<int64_t>(t->st_bytes_in.load());
    commands = static_cast<int64_t>(t->st_commands.load());
    decode_us = static_cast<int64_t>(t->st_decode_us.load());
    frames_read = static_cast<int64_t>(t->st_frames_read.load());
    rereads = static_cast<int64_t>(t->st_rereads.load());
    stale_px = static_cast<int64_t>(t->st_stale_px.load());
    link_kbps = 0;
    link_rtt_ms = 0;
    bool connected;
    {
        std::lock_guard<std::mutex> g(t->mu);
        connected = t->conn != nullptr;
        mode = t->want_gfx ? "pipeline" : "compatible";
        // What the server measured of the link, once it has (auto-detect, milestone 35).
        if (connected && t->conn->inst && t->conn->inst->context && t->conn->inst->context->autodetect) {
            const rdpAutoDetect* ad = t->conn->inst->context->autodetect;
            link_kbps = static_cast<int64_t>(ad->netCharBandwidth);
            link_rtt_ms = static_cast<int64_t>(ad->netCharAverageRTT);
        }
    }
    pipeline = !connected ? "" : (t->st_gfx.load() ? "gfx" : "bitmap");
    codec.clear();
    if (t->st_gfx.load()) {
        uint32_t seen = t->st_codecs.load();
        for (int32_t id = 0; id < 32; id++) {
            if (!(seen & (1u << id))) continue;
            const char* n = codec_name(id);
            if (!*n || codec.find(n) != std::string::npos) continue;
            if (!codec.empty()) codec += ",";
            codec += n;
        }
    }
    h264 = h264_available();
    return RDP_OK;
}

// ---- Input -------------------------------------------------------------------------

// RDP scancodes (0x100: extended) by W3C UI Events `code`, as a PC keyboard sends them.
inline int32_t scancode_for(const std::string& code) {
    static const std::unordered_map<std::string, int32_t> table = {
        {"Escape", 0x01}, {"Digit1", 0x02}, {"Digit2", 0x03}, {"Digit3", 0x04}, {"Digit4", 0x05},
        {"Digit5", 0x06}, {"Digit6", 0x07}, {"Digit7", 0x08}, {"Digit8", 0x09}, {"Digit9", 0x0A},
        {"Digit0", 0x0B}, {"Minus", 0x0C}, {"Equal", 0x0D}, {"Backspace", 0x0E}, {"Tab", 0x0F},
        {"KeyQ", 0x10}, {"KeyW", 0x11}, {"KeyE", 0x12}, {"KeyR", 0x13}, {"KeyT", 0x14},
        {"KeyY", 0x15}, {"KeyU", 0x16}, {"KeyI", 0x17}, {"KeyO", 0x18}, {"KeyP", 0x19},
        {"BracketLeft", 0x1A}, {"BracketRight", 0x1B}, {"Enter", 0x1C}, {"ControlLeft", 0x1D},
        {"KeyA", 0x1E}, {"KeyS", 0x1F}, {"KeyD", 0x20}, {"KeyF", 0x21}, {"KeyG", 0x22},
        {"KeyH", 0x23}, {"KeyJ", 0x24}, {"KeyK", 0x25}, {"KeyL", 0x26}, {"Semicolon", 0x27},
        {"Quote", 0x28}, {"Backquote", 0x29}, {"ShiftLeft", 0x2A}, {"Backslash", 0x2B},
        {"KeyZ", 0x2C}, {"KeyX", 0x2D}, {"KeyC", 0x2E}, {"KeyV", 0x2F}, {"KeyB", 0x30},
        {"KeyN", 0x31}, {"KeyM", 0x32}, {"Comma", 0x33}, {"Period", 0x34}, {"Slash", 0x35},
        {"ShiftRight", 0x36}, {"NumpadMultiply", 0x37}, {"AltLeft", 0x38}, {"Space", 0x39},
        {"CapsLock", 0x3A}, {"F1", 0x3B}, {"F2", 0x3C}, {"F3", 0x3D}, {"F4", 0x3E}, {"F5", 0x3F},
        {"F6", 0x40}, {"F7", 0x41}, {"F8", 0x42}, {"F9", 0x43}, {"F10", 0x44}, {"NumLock", 0x45},
        {"ScrollLock", 0x46}, {"Numpad7", 0x47}, {"Numpad8", 0x48}, {"Numpad9", 0x49},
        {"NumpadSubtract", 0x4A}, {"Numpad4", 0x4B}, {"Numpad5", 0x4C}, {"Numpad6", 0x4D},
        {"NumpadAdd", 0x4E}, {"Numpad1", 0x4F}, {"Numpad2", 0x50}, {"Numpad3", 0x51},
        {"Numpad0", 0x52}, {"NumpadDecimal", 0x53}, {"IntlBackslash", 0x56}, {"F11", 0x57},
        {"F12", 0x58}, {"NumpadEqual", 0x59}, {"F13", 0x64}, {"F14", 0x65}, {"F15", 0x66},
        {"F16", 0x67}, {"F17", 0x68}, {"F18", 0x69}, {"F19", 0x6A}, {"F20", 0x6B}, {"F21", 0x6C},
        {"F22", 0x6D}, {"F23", 0x6E}, {"F24", 0x76}, {"IntlRo", 0x73}, {"IntlYen", 0x7D},
        {"NumpadComma", 0x7E},
        {"NumpadEnter", 0x11C}, {"ControlRight", 0x11D}, {"NumpadDivide", 0x135},
        {"PrintScreen", 0x137}, {"AltRight", 0x138}, {"Home", 0x147}, {"ArrowUp", 0x148},
        {"PageUp", 0x149}, {"ArrowLeft", 0x14B}, {"ArrowRight", 0x14D}, {"End", 0x14F},
        {"ArrowDown", 0x150}, {"PageDown", 0x151}, {"Insert", 0x152}, {"Delete", 0x153},
        {"MetaLeft", 0x15B}, {"MetaRight", 0x15C}, {"ContextMenu", 0x15D},
        {"AudioVolumeMute", 0x120}, {"AudioVolumeDown", 0x12E}, {"AudioVolumeUp", 0x130},
    };
    std::string k = code;
#if defined(__APPLE__)
    // On an ISO Mac keyboard the key left of 1 and the key right of left Shift come
    // swapped from the OS; a PC keyboard has them the other way round.
    if (mac_keyboard().iso) {
        if (k == "Backquote") k = "IntlBackslash";
        else if (k == "IntlBackslash") k = "Backquote";
    }
#endif
    auto it = table.find(k);
    return it == table.end() ? -1 : it->second;
}

inline std::shared_ptr<Conn> live_conn(Tab& t) {
    std::lock_guard<std::mutex> g(t.mu);
    if (!t.conn || t.conn->ended.load()) return nullptr;
    return t.conn;
}

inline int key(const std::string& id, const std::string& code, bool down) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    int32_t sc = scancode_for(code);
    if (sc < 0) return RDP_ERR_UNKNOWN_KEY;
    auto c = live_conn(*t);
    if (!c) return RDP_ERR_CLOSED;
    std::lock_guard<std::mutex> g(t->input_mu);
    return freerdp_input_send_keyboard_event_ex(c->inst->context->input, down, FALSE, static_cast<UINT32>(sc))
               ? RDP_OK : RDP_ERR_OTHER;
}

// `kind`: 0 move, 1 down, 2 up, 3 wheel, 4 horizontal wheel. `button`: 0 main, 1
// middle, 2 secondary. `delta`: a wheel's notches times 120, positive up or right.
inline int pointer(const std::string& id, int32_t kind, int32_t button, int32_t x, int32_t y, int32_t delta) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    auto c = live_conn(*t);
    if (!c) return RDP_ERR_CLOSED;
    UINT16 flags = 0;
    if (kind == 0) {
        flags = PTR_FLAGS_MOVE;
    } else if (kind == 1 || kind == 2) {
        flags = button == 0 ? PTR_FLAGS_BUTTON1 : (button == 2 ? PTR_FLAGS_BUTTON2 : PTR_FLAGS_BUTTON3);
        if (kind == 1) flags |= PTR_FLAGS_DOWN;
    } else {
        flags = kind == 3 ? PTR_FLAGS_WHEEL : PTR_FLAGS_HWHEEL;
        // A horizontal wheel's positive is to the left in RDP.
        int32_t v = kind == 4 ? -delta : delta;
        int32_t mag = std::min<int32_t>(std::abs(v), 0xFF);
        if (v < 0) {
            flags |= PTR_FLAGS_WHEEL_NEGATIVE;
            flags |= static_cast<UINT16>((0x100 - mag) & 0xFF);
        } else {
            flags |= static_cast<UINT16>(mag & 0xFF);
        }
    }
    int32_t mx, my;
    {
        std::lock_guard<std::mutex> g(t->mu);
        mx = std::clamp<int32_t>(x, 0, std::max<int32_t>(0, t->width - 1));
        my = std::clamp<int32_t>(y, 0, std::max<int32_t>(0, t->height - 1));
    }
    std::lock_guard<std::mutex> g(t->input_mu);
    return freerdp_input_send_mouse_event(c->inst->context->input, flags, static_cast<UINT16>(mx), static_cast<UINT16>(my))
               ? RDP_OK : RDP_ERR_OTHER;
}

// ---- Frames ------------------------------------------------------------------------

// Takes view `vi`'s pending dirty region: a 16-byte little-endian header followed by
// its RGBA rows. `out` is empty when nothing changed. Header: u32 seq, u16 x, y, w, h
// in the view's own pixels (from its crop's top-left), then the view's u16 width and
// height (the whole desktop's for a view without a crop). Called with `t.mu` held.
// RDP_ERR_OTHER for a view the tab does not have.
inline int take_frame_locked(Tab& t, size_t vi, std::string& out) {
    out.clear();
    if (t.closed.load()) return RDP_ERR_CLOSED;
    if (vi >= t.views.size()) return RDP_ERR_OTHER;
    View& v = t.views[vi];
    if (v.dw == 0 || !t.conn || !t.conn->inst || !t.conn->inst->context->gdi) return RDP_OK;
    rdpGdi* gdi = t.conn->inst->context->gdi;
    int32_t x = v.dx, y = v.dy, w = v.dw, h = v.dh;
    // A union drawn before a resize may reach past the new size.
    w = std::min<int32_t>(w, static_cast<int32_t>(gdi->width) - x);
    h = std::min<int32_t>(h, static_cast<int32_t>(gdi->height) - y);
    v.dw = 0;
    if (w <= 0 || h <= 0) return RDP_OK;
    int32_t cx, cy, cw, ch;
    view_crop(t, v, cx, cy, cw, ch);
    if (v.cw == 0) { cw = static_cast<int32_t>(gdi->width); ch = static_cast<int32_t>(gdi->height); }
    t.st_frames_read.fetch_add(1, std::memory_order_relaxed);
    out.resize(16 + static_cast<size_t>(w) * h * 4);
    auto* p = reinterpret_cast<uint8_t*>(out.data());
    auto put16 = [&](size_t at, uint32_t val) { p[at] = val & 0xff; p[at + 1] = (val >> 8) & 0xff; };
    auto put32 = [&](size_t at, uint32_t val) { put16(at, val & 0xffff); put16(at + 2, val >> 16); };
    put32(0, static_cast<uint32_t>(t.seq));
    put16(4, x - cx); put16(6, y - cy); put16(8, w); put16(10, h);
    put16(12, cw); put16(14, ch);
    const uint32_t stride = gdi->stride;
    const uint8_t* src = gdi->primary_buffer + static_cast<size_t>(y) * stride + static_cast<size_t>(x) * 4;
    uint8_t* dst = p + 16;
    // The shadow follows the surface's size; a new size starts it blank.
    if (t.shadow_w != static_cast<int32_t>(gdi->width) || t.shadow_h != static_cast<int32_t>(gdi->height)) {
        t.shadow_w = static_cast<int32_t>(gdi->width);
        t.shadow_h = static_cast<int32_t>(gdi->height);
        t.shadow.assign(static_cast<size_t>(t.shadow_w) * t.shadow_h * 4, 0);
    }
    uint8_t* shadow = t.shadow.data() + (static_cast<size_t>(y) * t.shadow_w + x) * 4;
    for (int32_t row = 0; row < h; ++row) {
        std::memcpy(dst, src, static_cast<size_t>(w) * 4);
        std::memcpy(shadow, src, static_cast<size_t>(w) * 4);
        shadow += static_cast<size_t>(t.shadow_w) * 4;
        // RGBA32 in FreeRDP leaves alpha at 0 on some codecs; the canvas needs 255.
        for (int32_t i = 0; i < w; ++i) dst[i * 4 + 3] = 0xff;
        dst += static_cast<size_t>(w) * 4;
        src += stride;
    }
    return RDP_OK;
}

// Waits up to `wait_ms` for a dirty region of view `vi`, then takes it. For tests; the
// page reads through the frame channel.
inline int next_frame_view(const std::string& id, int32_t vi, int64_t wait_ms, std::string& out) {
    auto t = find(id);
    if (!t) return RDP_ERR_CLOSED;
    std::unique_lock<std::mutex> g(t->mu);
    const size_t v = static_cast<size_t>(std::max(0, vi));
    t->cv.wait_for(g, std::chrono::milliseconds(wait_ms), [&] { return view_pending(*t, v) || t->closed.load(); });
    return take_frame_locked(*t, v, out);
}

inline int next_frame(const std::string& id, int64_t wait_ms, std::string& out) {
    return next_frame_view(id, 0, wait_ms, out);
}

inline bool send_all(sock_t fd, const char* p, size_t n) {
    while (n > 0) {
        int k = sock_send(fd, p, n);
        if (k <= 0) return false;
        p += k; n -= static_cast<size_t>(k);
    }
    return true;
}

// The frame channel's checks on one request (milestone 36, D-085), kept apart so the
// tests can call them. The token is read only from the request line
// (`GET /next?t=<token> HTTP/1.1`); `Host` must name this loopback port, so a page
// that rebinds its own name to 127.0.0.1 is refused; `Origin` is echoed back only
// when it is the app's own page (`app://localhost`) or another page on this machine
// (a `localhost` or 127.0.0.1 origin: the development server, WebView2's virtual
// hosts), so no other web page may read a response even holding the token.
inline std::string header_value(const std::string& head, const std::string& name) {
    size_t at = 0;
    while ((at = head.find("\r\n", at)) != std::string::npos) {
        at += 2;
        if (head.size() - at < name.size() + 1) break;
        bool same = true;
        for (size_t i = 0; i < name.size() && same; i++) {
            same = std::tolower(static_cast<unsigned char>(head[at + i])) == std::tolower(static_cast<unsigned char>(name[i]));
        }
        if (!same || head[at + name.size()] != ':') continue;
        size_t v = at + name.size() + 1;
        size_t end = head.find("\r\n", v);
        std::string val = head.substr(v, end == std::string::npos ? std::string::npos : end - v);
        while (!val.empty() && (val.front() == ' ' || val.front() == '\t')) val.erase(0, 1);
        while (!val.empty() && (val.back() == ' ' || val.back() == '\t')) val.pop_back();
        return val;
    }
    return "";
}

inline bool local_origin(const std::string& origin) {
    if (origin == "app://localhost") return true;
    for (const char* scheme : {"http://", "https://"}) {
        const std::string p = scheme;
        if (origin.rfind(p, 0) != 0) continue;
        std::string host = origin.substr(p.size());
        auto colon = host.find(':');
        if (colon != std::string::npos) host = host.substr(0, colon);
        if (host.find('/') != std::string::npos) return false;
        if (host == "localhost" || host == "127.0.0.1") return true;
        const std::string suffix = ".localhost";
        if (host.size() > suffix.size() && host.compare(host.size() - suffix.size(), suffix.size(), suffix) == 0) return true;
    }
    return false;
}

// 0: authorised; 1: wrong or missing token; 2: wrong Host.
inline int check_frame_request(const std::string& head, const std::string& token, int port) {
    const std::string host = header_value(head, "Host");
    if (host != "127.0.0.1:" + std::to_string(port)) return 2;
    const std::string start = "GET /next?t=";
    if (token.empty() || head.rfind(start, 0) != 0) return 1;
    const size_t line_end = head.find("\r\n");
    const std::string line = head.substr(0, line_end);
    const size_t at = start.size();
    const size_t stop = line.find_first_of(" &", at);
    if (stop == std::string::npos) return 1;
    const std::string tok = line.substr(at, stop - at);
    if (tok.size() != token.size() || sodium_memcmp(tok.data(), token.data(), tok.size()) != 0) return 1;
    return 0;
}

// The view a request asks for (milestone 38): `&v=<n>` after the token, 0 without it,
// -1 when it is not a small number.
inline int frame_view_of(const std::string& head) {
    const std::string line = head.substr(0, head.find("\r\n"));
    const size_t sp = line.find(' ', 4);
    const std::string target = line.substr(0, sp);
    const size_t at = target.find("&v=");
    if (at == std::string::npos) return 0;
    size_t i = at + 3;
    int v = 0, digits = 0;
    while (i < target.size() && target[i] >= '0' && target[i] <= '9' && digits < 3) {
        v = v * 10 + (target[i] - '0');
        i++; digits++;
    }
    if (digits == 0 || (i < target.size() && target[i] != '&')) return -1;
    return v;
}

// The CORS header for a request's Origin: empty for a page that is not this machine's.
inline std::string cors_for(const std::string& head) {
    const std::string origin = header_value(head, "Origin");
    if (!local_origin(origin)) return "";
    return "Access-Control-Allow-Origin: " + origin + "\r\nVary: Origin\r\n";
}

// At most this many frame-channel connections at once per tab: the page keeps one or
// two; a local process opening more is turned away rather than given a thread each.
inline constexpr int FRAME_CONNS_MAX = 8;

inline void serve_conn(std::shared_ptr<Tab> t, sock_t fd) {
    struct Count {
        Tab* t;
        ~Count() { t->serving.fetch_sub(1); }
    } count{t.get()};
    sock_recv_timeout(fd, 5000);
    sock_nodelay(fd);
    std::string req;
    char buf[2048];
    // Keep-alive: one request after another on the same connection.
    while (!t->closed.load()) {
        size_t end;
        while ((end = req.find("\r\n\r\n")) == std::string::npos) {
            int k = sock_recv(fd, buf, sizeof buf);
            if (k <= 0) { sock_close(fd); return; }
            req.append(buf, static_cast<size_t>(k));
            if (req.size() > 16384) { sock_close(fd); return; }
        }
        std::string head = req.substr(0, end);
        req.erase(0, end + 4);
        const std::string cors = cors_for(head);
        if (head.rfind("OPTIONS ", 0) == 0) {
            std::string r = "HTTP/1.1 204 No Content\r\n" + cors + "Access-Control-Allow-Methods: GET\r\nContent-Length: 0\r\n\r\n";
            if (!send_all(fd, r.data(), r.size())) break;
            continue;
        }
        if (check_frame_request(head, t->token, t->port) != 0) {
            std::string r = "HTTP/1.1 403 Forbidden\r\n" + cors + "Content-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(fd, r.data(), r.size());
            break;
        }
        const int vi = frame_view_of(head);
        std::string body;
        bool gone;
        int rc = RDP_OK;
        {
            std::unique_lock<std::mutex> g(t->mu);
            if (vi >= 0) {
                t->cv.wait_for(g, std::chrono::milliseconds(1000), [&] { return view_pending(*t, static_cast<size_t>(vi)) || t->closed.load() || static_cast<size_t>(vi) >= t->views.size(); });
            }
            gone = t->closed.load();
            if (!gone) rc = vi < 0 ? RDP_ERR_OTHER : take_frame_locked(*t, static_cast<size_t>(vi), body);
        }
        if (!gone && rc == RDP_ERR_OTHER) {
            // A view the tab no longer has (it went back to fewer monitors): that window
            // stops reading.
            std::string r = "HTTP/1.1 404 Not Found\r\n" + cors + "Content-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(fd, r.data(), r.size());
            break;
        }
        if (gone) {
            std::string r = "HTTP/1.1 410 Gone\r\n" + cors + "Content-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(fd, r.data(), r.size());
            break;
        }
        std::string r = "HTTP/1.1 200 OK\r\n" + cors + "Content-Type: application/octet-stream\r\nCache-Control: no-store\r\nContent-Length: " +
                        std::to_string(body.size()) + "\r\n\r\n";
        if (!send_all(fd, r.data(), r.size()) || !send_all(fd, body.data(), body.size())) break;
    }
    sock_close(fd);
}

inline void serve(std::shared_ptr<Tab> t) {
    while (!t->closed.load()) {
        sock_t fd = ::accept(t->listen_fd, nullptr, nullptr);
        if (fd == BAD_SOCK) break;
        if (t->serving.fetch_add(1) >= FRAME_CONNS_MAX) {
            t->serving.fetch_sub(1);
            sock_close(fd);
            continue;
        }
        std::thread(serve_conn, t, fd).detach();
    }
}

// Starts the tab's frame channel on 127.0.0.1, with a token of 32 random bytes from
// libsodium, hex.
inline bool start_frame_server(std::shared_ptr<Tab> t) {
    if (sodium_init() < 0 || !sock_init()) return false;
    unsigned char raw[32];
    randombytes_buf(raw, sizeof raw);
    char hex[65];
    sodium_bin2hex(hex, sizeof hex, raw, sizeof raw);
    sodium_memzero(raw, sizeof raw);
    sock_t fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd == BAD_SOCK) return false;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(fd, 4) != 0) {
        sock_close(fd);
        return false;
    }
    socklen_t len = sizeof addr;
    getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len);
    {
        std::lock_guard<std::mutex> g(t->mu);
        t->token = hex;
        t->listen_fd = fd;
        t->port = ntohs(addr.sin_port);
    }
    sodium_memzero(hex, sizeof hex);
    t->server = std::thread(serve, t);
    return true;
}

// Ends tab `id`: an open in progress is cancelled, the connection and the frame
// channel stop, and the tab is forgotten.
inline void close(const std::string& id) {
    std::shared_ptr<Tab> t;
    {
        std::lock_guard<std::mutex> g(registry_mu());
        auto it = registry().find(id);
        if (it == registry().end()) {
            tombstones()[id] = true;
            return;
        }
        t = it->second;
        registry().erase(it);
    }
    {
        std::lock_guard<std::mutex> g(t->connecting_mu);
        t->closed.store(true);
        if (t->connecting) freerdp_abort_connect_context(t->connecting->context);
    }
    std::shared_ptr<Conn> c;
    {
        // Under the frame lock: a frame-channel thread reads the framebuffer only while
        // holding it and checks `closed` first.
        std::lock_guard<std::mutex> g(t->mu);
        c = t->conn;
        t->conn = nullptr;
    }
    t->cv.notify_all();
    if (t->listen_fd != BAD_SOCK) {
        sock_shutdown(t->listen_fd);
        sock_close(t->listen_fd);
    }
    if (t->server.joinable()) t->server.join();
    end_conn(c);
    if (!t->token.empty()) sodium_memzero(t->token.data(), t->token.size());
}

// ---- For the tests (milestone 36) ---------------------------------------------------

// Whether tab `id`'s last open also wiped FreeRDP's backup of the password.
inline bool creds_wiped(const std::string& id) {
    auto t = find(id);
    return t && t->creds_wiped.load();
}

// A server that answers the X.224 connection request by choosing standard RDP
// security, as a machine in the middle would to downgrade the connection, then counts
// what the client sends next (an MCS connect, with the auto-logon password soon
// after) until it closes or 3 s pass. `downgrade_server_start` returns its port.
struct DowngradeServer {
    std::mutex mu;
    std::condition_variable cv;
    bool done = false;
    int64_t bytes_after = -1;  // bytes the client sent after the answer
    std::thread th;
};
inline DowngradeServer& downgrade_server() { static DowngradeServer d; return d; }

inline int32_t downgrade_server_start() {
    if (!sock_init()) return 0;
    auto& d = downgrade_server();
    if (d.th.joinable()) d.th.join();
    {
        std::lock_guard<std::mutex> g(d.mu);
        d.done = false;
        d.bytes_after = -1;
    }
    sock_t fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd == BAD_SOCK) return 0;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(fd, 1) != 0) {
        sock_close(fd);
        return 0;
    }
    socklen_t len = sizeof addr;
    getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len);
    d.th = std::thread([fd] {
        auto& d = downgrade_server();
        int64_t after = -1;
        sock_t c = ::accept(fd, nullptr, nullptr);
        sock_close(fd);
        if (c != BAD_SOCK) {
            sock_recv_timeout(c, 3000);
            // The TPKT header gives the request's length.
            std::string req;
            char buf[512];
            while (req.size() < 4 || req.size() < static_cast<size_t>((static_cast<uint8_t>(req[2]) << 8) | static_cast<uint8_t>(req[3]))) {
                int k = sock_recv(c, buf, sizeof buf);
                if (k <= 0) break;
                req.append(buf, static_cast<size_t>(k));
            }
            // TPKT, X.224 Connection Confirm, RDP_NEG_RSP choosing PROTOCOL_RDP (0).
            const unsigned char cc[19] = {0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00,
                                          0x02, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00};
            if (req.size() >= 4 && send_all(c, reinterpret_cast<const char*>(cc), sizeof cc)) {
                after = 0;
                for (;;) {
                    int k = sock_recv(c, buf, sizeof buf);
                    if (k <= 0) break;
                    after += k;
                }
            }
            sock_close(c);
        }
        std::lock_guard<std::mutex> g(d.mu);
        d.bytes_after = after;
        d.done = true;
        d.cv.notify_all();
    });
    return static_cast<int32_t>(ntohs(addr.sin_port));
}

// Waits for the downgrade server's client to go, then returns what it sent after the
// answer (-1: it never got that far).
inline int64_t downgrade_server_result() {
    auto& d = downgrade_server();
    {
        std::unique_lock<std::mutex> g(d.mu);
        d.cv.wait_for(g, std::chrono::seconds(10), [&] { return d.done; });
    }
    if (d.th.joinable()) d.th.join();
    return d.bytes_after;
}

// Ends every tab (the app is quitting).
inline void close_all() {
    std::vector<std::string> ids;
    {
        std::lock_guard<std::mutex> g(registry_mu());
        for (auto& [id, t] : registry()) ids.push_back(id);
    }
    for (auto& id : ids) close(id);
}

}  // namespace flint_rdp
