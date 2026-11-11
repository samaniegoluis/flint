// CFIRE-UPSTREAM: CF-119
// An RDP client session over libfreerdp 3 (FreeRDP's core library only: no SDL, no X11
// client). cfire has no RDP and cannot implement FreeRDP's C callbacks, so the session,
// its event loop thread and the frame queue live here; rdp.cf wraps them.
//
// A session draws into FreeRDP's software GDI as RGBA. Each EndPaint adds its dirty
// rectangle to a pending union; a reader takes that union (the pixels inside it) and
// clears it, so a slow reader skips intermediate frames and never queues them.
//
// Milestone 28 (spike) also measures two ways of getting frames to the page; the local
// channel (`frame_server_*`) is a minimal HTTP/1.1 server on 127.0.0.1, serving
// `GET /next?t=<token>&after=<seq>` as a long poll, with the token from libsodium.
#pragma once

// winpr declares a global `typedef BYTE byte`, and cfire's prelude a global
// `using cfire::byte`: renamed while FreeRDP's headers are read (CF-119).
#define byte flint_winpr_byte
#include <freerdp/freerdp.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/input.h>
#include <freerdp/settings.h>
#include <freerdp/error.h>
#include <winpr/synch.h>
#undef byte
#include <sodium.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace flint_rdp {

// Result codes shared with rdp.cf.
inline constexpr int RDP_OK = 0;
inline constexpr int RDP_ERR_AUTH = 1;
inline constexpr int RDP_ERR_NETWORK = 2;
inline constexpr int RDP_ERR_TIMEOUT = 3;
inline constexpr int RDP_ERR_REFUSED = 4;
inline constexpr int RDP_ERR_TLS = 5;
inline constexpr int RDP_ERR_OTHER = 6;
inline constexpr int RDP_ERR_CLOSED = 7;

struct Session;

struct Context {
    rdpContext base;   // must be first: FreeRDP allocates ContextSize bytes
    Session* owner;
};

struct Session {
    freerdp* inst = nullptr;
    std::thread loop;
    std::atomic<bool> stop{false};
    std::atomic<bool> ended{false};
    std::mutex mu;
    std::condition_variable cv;
    // Pending dirty union, in framebuffer pixels; empty when w == 0.
    int32_t dx = 0, dy = 0, dw = 0, dh = 0;
    uint64_t seq = 0;          // bumped on every EndPaint that drew something
    uint64_t frames = 0;       // EndPaint calls that drew something
    int32_t width = 0, height = 0;
    std::string fingerprint;   // the server certificate's, as FreeRDP gives it
    std::mutex input_mu;       // FreeRDP's input is sent from the page's thread
    // Frame server (local channel).
    int listen_fd = -1;
    int port = 0;
    std::string token;
    std::thread server;
};

inline std::mutex& registry_mu() { static std::mutex m; return m; }
inline std::map<int64_t, std::shared_ptr<Session>>& registry() {
    static std::map<int64_t, std::shared_ptr<Session>> r;
    return r;
}
inline int64_t& next_id() { static int64_t n = 0; return n; }

inline std::shared_ptr<Session> find(int64_t id) {
    std::lock_guard<std::mutex> g(registry_mu());
    auto it = registry().find(id);
    return it == registry().end() ? nullptr : it->second;
}

inline Session* owner_of(rdpContext* ctx) { return reinterpret_cast<Context*>(ctx)->owner; }

inline BOOL on_begin_paint(rdpContext* ctx) {
    rdpGdi* gdi = ctx->gdi;
    if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return FALSE;
    HGDI_WND hwnd = gdi->primary->hdc->hwnd;
    if (!hwnd->invalid) return FALSE;
    hwnd->invalid->null = TRUE;
    hwnd->ninvalid = 0;
    return TRUE;
}

inline BOOL on_end_paint(rdpContext* ctx) {
    rdpGdi* gdi = ctx->gdi;
    if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return FALSE;
    HGDI_WND hwnd = gdi->primary->hdc->hwnd;
    if (!hwnd->invalid || hwnd->invalid->null) return TRUE;
    int32_t x = hwnd->invalid->x, y = hwnd->invalid->y;
    int32_t w = hwnd->invalid->w, h = hwnd->invalid->h;
    Session* s = owner_of(ctx);
    // Clamp to the framebuffer.
    x = std::max<int32_t>(0, x);
    y = std::max<int32_t>(0, y);
    w = std::min<int32_t>(w, static_cast<int32_t>(gdi->width) - x);
    h = std::min<int32_t>(h, static_cast<int32_t>(gdi->height) - y);
    if (w <= 0 || h <= 0) return TRUE;
    {
        std::lock_guard<std::mutex> g(s->mu);
        if (s->dw == 0) {
            s->dx = x; s->dy = y; s->dw = w; s->dh = h;
        } else {
            int32_t x2 = std::max(s->dx + s->dw, x + w);
            int32_t y2 = std::max(s->dy + s->dh, y + h);
            s->dx = std::min(s->dx, x);
            s->dy = std::min(s->dy, y);
            s->dw = x2 - s->dx;
            s->dh = y2 - s->dy;
        }
        s->seq += 1;
        s->frames += 1;
    }
    s->cv.notify_all();
    return TRUE;
}

inline BOOL on_desktop_resize(rdpContext* ctx) {
    rdpSettings* st = ctx->settings;
    Session* s = owner_of(ctx);
    UINT32 w = freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight);
    std::lock_guard<std::mutex> g(s->mu);
    if (!gdi_resize(ctx->gdi, w, h)) return FALSE;
    s->width = static_cast<int32_t>(w);
    s->height = static_cast<int32_t>(h);
    s->dx = 0; s->dy = 0; s->dw = s->width; s->dh = s->height;
    s->seq += 1;
    s->cv.notify_all();
    return TRUE;
}

inline BOOL on_pre_connect(freerdp* inst) {
    (void)inst;
    return TRUE;
}

inline BOOL on_post_connect(freerdp* inst) {
    if (!gdi_init(inst, PIXEL_FORMAT_RGBA32)) return FALSE;
    rdpContext* ctx = inst->context;
    ctx->update->BeginPaint = on_begin_paint;
    ctx->update->EndPaint = on_end_paint;
    ctx->update->DesktopResize = on_desktop_resize;
    Session* s = owner_of(ctx);
    std::lock_guard<std::mutex> g(s->mu);
    s->width = static_cast<int32_t>(ctx->gdi->width);
    s->height = static_cast<int32_t>(ctx->gdi->height);
    return TRUE;
}

inline void on_post_disconnect(freerdp* inst) {
    if (inst && inst->context && inst->context->gdi) gdi_free(inst);
}

// Milestone 28 accepts every certificate and keeps its fingerprint; trust on first
// use, kept in the vault, is milestone 29's.
inline DWORD on_verify_certificate(freerdp* inst, const char* host, UINT16 port, const char* common_name,
                                   const char* subject, const char* issuer, const char* fingerprint, DWORD flags) {
    (void)host; (void)port; (void)common_name; (void)subject; (void)issuer; (void)flags;
    Session* s = owner_of(inst->context);
    std::lock_guard<std::mutex> g(s->mu);
    s->fingerprint = fingerprint ? fingerprint : "";
    return 2;  // accept for this session only
}

inline DWORD on_verify_changed_certificate(freerdp* inst, const char* host, UINT16 port, const char* common_name,
                                           const char* subject, const char* issuer, const char* fingerprint,
                                           const char* old_subject, const char* old_issuer, const char* old_fingerprint,
                                           DWORD flags) {
    (void)old_subject; (void)old_issuer; (void)old_fingerprint;
    return on_verify_certificate(inst, host, port, common_name, subject, issuer, fingerprint, flags);
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
            return RDP_ERR_REFUSED;
        default:
            return RDP_ERR_OTHER;
    }
}

inline void run_loop(std::shared_ptr<Session> s) {
    HANDLE handles[MAXIMUM_WAIT_OBJECTS] = {};
    rdpContext* ctx = s->inst->context;
    while (!s->stop.load()) {
        DWORD n = freerdp_get_event_handles(ctx, handles, MAXIMUM_WAIT_OBJECTS);
        if (n == 0) break;
        DWORD st = WaitForMultipleObjects(n, handles, FALSE, 100);
        if (st == WAIT_FAILED) break;
        if (!freerdp_check_event_handles(ctx)) break;
        if (freerdp_shall_disconnect_context(ctx)) break;
    }
    s->ended.store(true);
    s->cv.notify_all();
}

// Connects and starts the session's event loop. Returns the session id (> 0), or a
// negative RDP_ERR_* code; `detail` gets FreeRDP's error name, never a credential.
inline int64_t open(const std::string& host, int32_t port, const std::string& user, const std::string& domain,
                    const std::string& password, int32_t width, int32_t height, int64_t timeout_ms,
                    std::string& detail) {
    auto s = std::make_shared<Session>();
    freerdp* inst = freerdp_new();
    if (!inst) { detail = "out of memory"; return -RDP_ERR_OTHER; }
    inst->ContextSize = sizeof(Context);
    inst->PreConnect = on_pre_connect;
    inst->PostConnect = on_post_connect;
    inst->PostDisconnect = on_post_disconnect;
    inst->VerifyCertificateEx = on_verify_certificate;
    inst->VerifyChangedCertificateEx = on_verify_changed_certificate;
    if (!freerdp_context_new(inst)) {
        freerdp_free(inst);
        detail = "FreeRDP could not create a context";
        return -RDP_ERR_OTHER;
    }
    reinterpret_cast<Context*>(inst->context)->owner = s.get();
    s->inst = inst;
    rdpSettings* st = inst->context->settings;
    freerdp_settings_set_string(st, FreeRDP_ServerHostname, host.c_str());
    freerdp_settings_set_uint32(st, FreeRDP_ServerPort, static_cast<UINT32>(port));
    freerdp_settings_set_string(st, FreeRDP_Username, user.c_str());
    if (!domain.empty()) freerdp_settings_set_string(st, FreeRDP_Domain, domain.c_str());
    freerdp_settings_set_string(st, FreeRDP_Password, password.c_str());
    // Without it the server shows its own logon screen after NLA has already passed.
    freerdp_settings_set_bool(st, FreeRDP_AutoLogonEnabled, TRUE);
    freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, static_cast<UINT32>(width));
    freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, static_cast<UINT32>(height));
    freerdp_settings_set_uint32(st, FreeRDP_ColorDepth, 32);
    freerdp_settings_set_uint32(st, FreeRDP_TcpConnectTimeout, static_cast<UINT32>(timeout_ms));
    freerdp_settings_set_bool(st, FreeRDP_SoftwareGdi, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_SupportDisplayControl, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_AudioPlayback, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_DeviceRedirection, FALSE);
    freerdp_settings_set_bool(st, FreeRDP_RedirectClipboard, FALSE);

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
    if (!ok) {
        UINT32 err = freerdp_get_last_error(inst->context);
        auto elapsed = std::chrono::steady_clock::now() - started;
        bool timed_out = elapsed >= std::chrono::milliseconds(timeout_ms) - std::chrono::milliseconds(50);
        int code = timed_out ? RDP_ERR_TIMEOUT : classify(err);
        detail = timed_out ? "no answer within the timeout" : freerdp_get_last_error_name(err);
        freerdp_context_free(inst);
        freerdp_free(inst);
        return -code;
    }
    int64_t id;
    {
        std::lock_guard<std::mutex> g(registry_mu());
        id = ++next_id();
        registry()[id] = s;
    }
    s->loop = std::thread(run_loop, s);
    return id;
}

inline bool size(int64_t id, int32_t& w, int32_t& h, std::string& fingerprint) {
    auto s = find(id);
    if (!s) return false;
    std::lock_guard<std::mutex> g(s->mu);
    w = s->width; h = s->height; fingerprint = s->fingerprint;
    return true;
}

inline uint64_t frames(int64_t id) {
    auto s = find(id);
    if (!s) return 0;
    std::lock_guard<std::mutex> g(s->mu);
    return s->frames;
}

// Takes the pending dirty region: a 16-byte little-endian header followed by its RGBA
// rows. `out` is empty when nothing changed. Header: u32 seq, u16 x, u16 y, u16 w,
// u16 h, u32 reserved. Called with `s.mu` held.
inline int take_frame_locked(Session& s, std::string& out) {
    out.clear();
    if (s.stop.load() || !s.inst) return RDP_ERR_CLOSED;
    if (s.dw == 0) return RDP_OK;
    rdpGdi* gdi = s.inst->context->gdi;
    int32_t x = s.dx, y = s.dy, w = s.dw, h = s.dh;
    s.dw = 0;
    out.resize(16 + static_cast<size_t>(w) * h * 4);
    auto* p = reinterpret_cast<uint8_t*>(out.data());
    auto put16 = [&](size_t at, uint32_t v) { p[at] = v & 0xff; p[at + 1] = (v >> 8) & 0xff; };
    auto put32 = [&](size_t at, uint32_t v) { put16(at, v & 0xffff); put16(at + 2, v >> 16); };
    put32(0, static_cast<uint32_t>(s.seq));
    put16(4, x); put16(6, y); put16(8, w); put16(10, h);
    put32(12, 0);
    const uint32_t stride = gdi->stride;
    const uint8_t* src = gdi->primary_buffer + static_cast<size_t>(y) * stride + static_cast<size_t>(x) * 4;
    uint8_t* dst = p + 16;
    for (int32_t row = 0; row < h; ++row) {
        std::memcpy(dst, src, static_cast<size_t>(w) * 4);
        // RGBA32 in FreeRDP leaves alpha at 0 on some codecs; the canvas needs 255.
        for (int32_t i = 0; i < w; ++i) dst[i * 4 + 3] = 0xff;
        dst += static_cast<size_t>(w) * 4;
        src += stride;
    }
    return RDP_OK;
}

// Waits up to `wait_ms` for a dirty region, then takes it (see take_frame_locked).
// RDP_ERR_CLOSED once the session ended.
inline int next_frame(int64_t id, int64_t wait_ms, std::string& out) {
    auto s = find(id);
    if (!s) return RDP_ERR_CLOSED;
    std::unique_lock<std::mutex> g(s->mu);
    s->cv.wait_for(g, std::chrono::milliseconds(wait_ms), [&] { return s->dw != 0 || s->ended.load(); });
    if (s->dw == 0 && s->ended.load()) return RDP_ERR_CLOSED;
    return take_frame_locked(*s, out);
}

// Mouse: `flags` are FreeRDP's PTR_FLAGS_* as the page computes them.
inline int mouse(int64_t id, int32_t flags, int32_t x, int32_t y) {
    auto s = find(id);
    if (!s || s->ended.load()) return RDP_ERR_CLOSED;
    std::lock_guard<std::mutex> g(s->input_mu);
    return freerdp_input_send_mouse_event(s->inst->context->input, static_cast<UINT16>(flags),
                                          static_cast<UINT16>(std::max(0, x)), static_cast<UINT16>(std::max(0, y)))
               ? RDP_OK : RDP_ERR_OTHER;
}

// A key by its RDP scancode (with KBDEXT for extended keys).
inline int key(int64_t id, int32_t scancode, bool down) {
    auto s = find(id);
    if (!s || s->ended.load()) return RDP_ERR_CLOSED;
    std::lock_guard<std::mutex> g(s->input_mu);
    return freerdp_input_send_keyboard_event_ex(s->inst->context->input, down, FALSE, static_cast<UINT32>(scancode))
               ? RDP_OK : RDP_ERR_OTHER;
}

// A typed character, layout independent.
inline int unicode(int64_t id, int32_t code_unit, bool down) {
    auto s = find(id);
    if (!s || s->ended.load()) return RDP_ERR_CLOSED;
    std::lock_guard<std::mutex> g(s->input_mu);
    return freerdp_input_send_unicode_keyboard_event(s->inst->context->input, down ? 0 : KBD_FLAGS_RELEASE,
                                                     static_cast<UINT16>(code_unit))
               ? RDP_OK : RDP_ERR_OTHER;
}

// ---- The local frame channel (spike option B) -------------------------------------

inline bool send_all(int fd, const char* p, size_t n) {
    while (n > 0) {
        ssize_t k = ::send(fd, p, n, 0);
        if (k <= 0) return false;
        p += k; n -= static_cast<size_t>(k);
    }
    return true;
}

inline void serve_conn(std::shared_ptr<Session> s, int fd) {
    timeval tv{5, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    std::string req;
    char buf[2048];
    // Keep-alive: one request after another on the same connection.
    while (!s->stop.load()) {
        size_t end;
        while ((end = req.find("\r\n\r\n")) == std::string::npos) {
            ssize_t k = ::recv(fd, buf, sizeof buf, 0);
            if (k <= 0) { ::close(fd); return; }
            req.append(buf, static_cast<size_t>(k));
            if (req.size() > 16384) { ::close(fd); return; }
        }
        std::string head = req.substr(0, end);
        req.erase(0, end + 4);
        const std::string cors = "Access-Control-Allow-Origin: *\r\n";
        if (head.rfind("OPTIONS ", 0) == 0) {
            std::string r = "HTTP/1.1 204 No Content\r\n" + cors + "Access-Control-Allow-Methods: GET\r\nContent-Length: 0\r\n\r\n";
            if (!send_all(fd, r.data(), r.size())) break;
            continue;
        }
        bool authorised = false;
        auto tpos = head.find("t=");
        if (tpos != std::string::npos) {
            std::string t = head.substr(tpos + 2, s->token.size());
            authorised = !s->token.empty() && t.size() == s->token.size() &&
                         sodium_memcmp(t.data(), s->token.data(), t.size()) == 0;
        }
        if (!authorised) {
            std::string r = "HTTP/1.1 403 Forbidden\r\n" + cors + "Content-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(fd, r.data(), r.size());
            break;
        }
        std::string body;
        {
            std::unique_lock<std::mutex> g(s->mu);
            s->cv.wait_for(g, std::chrono::milliseconds(1000), [&] { return s->dw != 0 || s->ended.load() || s->stop.load(); });
            if (s->stop.load()) break;
            take_frame_locked(*s, body);
        }
        std::string r = "HTTP/1.1 200 OK\r\n" + cors + "Content-Type: application/octet-stream\r\nCache-Control: no-store\r\nContent-Length: " +
                        std::to_string(body.size()) + "\r\n\r\n";
        if (!send_all(fd, r.data(), r.size()) || !send_all(fd, body.data(), body.size())) break;
    }
    ::close(fd);
}

inline void serve(std::shared_ptr<Session> s) {
    while (!s->stop.load()) {
        int fd = ::accept(s->listen_fd, nullptr, nullptr);
        if (fd < 0) break;
        std::thread(serve_conn, s, fd).detach();
    }
}

// Starts the session's frame channel on 127.0.0.1; `port` and `token` say how to reach
// it. The token is 32 random bytes from libsodium, hex.
inline int frame_server_start(int64_t id, int32_t& port, std::string& token) {
    auto s = find(id);
    if (!s) return RDP_ERR_CLOSED;
    if (sodium_init() < 0) return RDP_ERR_OTHER;
    unsigned char raw[32];
    randombytes_buf(raw, sizeof raw);
    char hex[65];
    sodium_bin2hex(hex, sizeof hex, raw, sizeof raw);
    s->token = hex;
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return RDP_ERR_OTHER;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(fd, 4) != 0) {
        ::close(fd);
        return RDP_ERR_OTHER;
    }
    socklen_t len = sizeof addr;
    getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len);
    s->listen_fd = fd;
    s->port = ntohs(addr.sin_port);
    s->server = std::thread(serve, s);
    port = s->port;
    token = s->token;
    return RDP_OK;
}

inline void close(int64_t id) {
    std::shared_ptr<Session> s;
    {
        std::lock_guard<std::mutex> g(registry_mu());
        auto it = registry().find(id);
        if (it == registry().end()) return;
        s = it->second;
        registry().erase(it);
    }
    {
        // Under the frame lock: a frame-channel thread reads the framebuffer only while
        // holding it and checks `stop` first.
        std::lock_guard<std::mutex> g(s->mu);
        s->stop.store(true);
    }
    s->cv.notify_all();
    if (s->listen_fd >= 0) {
        ::shutdown(s->listen_fd, SHUT_RDWR);
        ::close(s->listen_fd);
    }
    if (s->loop.joinable()) s->loop.join();
    if (s->server.joinable()) s->server.join();
    std::lock_guard<std::mutex> g(s->mu);
    freerdp_disconnect(s->inst);
    freerdp_context_free(s->inst);
    freerdp_free(s->inst);
    s->inst = nullptr;
    if (!s->token.empty()) sodium_memzero(s->token.data(), s->token.size());
}

}  // namespace flint_rdp
