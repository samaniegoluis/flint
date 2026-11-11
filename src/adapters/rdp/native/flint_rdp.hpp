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
// Frames: each connection draws into FreeRDP's software GDI as RGBA. Every EndPaint
// adds its dirty rectangle to the tab's pending union; a reader takes the union (the
// pixels inside it) and clears it, so a slow reader skips frames instead of queueing
// them (D-071). The local channel is a minimal HTTP/1.1 server on 127.0.0.1 serving
// `GET /next?t=<token>` as a long poll, the token 32 random bytes from libsodium.
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
#include <freerdp/channels/cliprdr.h>
#include <freerdp/channels/channels.h>
#include <freerdp/channels/drdynvc.h>
#include <freerdp/channels/disp.h>
#include <freerdp/crypto/certificate.h>
#include <freerdp/event.h>
#include <freerdp/gdi/gdi.h>
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

// Events of `wait`.
inline constexpr int EV_RUNNING = 0;
inline constexpr int EV_ENDED = 1;
inline constexpr int EV_RESIZE = 2;
inline constexpr int EV_CLIP_TEXT = 3;     // the remote copied text (in `detail`)
inline constexpr int EV_CLIP_REQUEST = 4;  // the remote pastes: it wants this machine's text

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
    // The clipboard channel, once the server said it is ready (Monitor Ready).
    CliprdrClientContext* clip = nullptr;
    std::atomic<bool> clip_ready{false};
    // Why the loop ended, read after `ended`.
    UINT32 last_error = 0;
    UINT32 error_info = 0;
};

struct Context {
    rdpContext base;   // must be first: FreeRDP allocates ContextSize bytes
    Tab* tab;
    Conn* conn;
};

struct Cert {
    std::string subject, issuer, fingerprint, valid_from, valid_to;
};

struct Tab {
    std::string id;
    std::mutex mu;               // frames, size, the current connection, events
    std::condition_variable cv;
    std::shared_ptr<Conn> conn;  // current connection, null between connections
    std::atomic<bool> closed{false};
    // While freerdp_connect runs, so close() can cancel it.
    std::mutex connecting_mu;
    freerdp* connecting = nullptr;
    // Pending dirty union, in framebuffer pixels; empty when dw == 0.
    int32_t dx = 0, dy = 0, dw = 0, dh = 0;
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
    // Frame channel.
    sock_t listen_fd = BAD_SOCK;
    int port = 0;
    std::string token;
    std::thread server;
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
    int32_t x = std::max<int32_t>(0, hwnd->invalid->x);
    int32_t y = std::max<int32_t>(0, hwnd->invalid->y);
    int32_t w = std::min<int32_t>(hwnd->invalid->w, static_cast<int32_t>(gdi->width) - x);
    int32_t h = std::min<int32_t>(hwnd->invalid->h, static_cast<int32_t>(gdi->height) - y);
    if (w <= 0 || h <= 0) return TRUE;
    Tab* t = ctx_of(ctx)->tab;
    {
        std::lock_guard<std::mutex> g(t->mu);
        if (t->dw == 0) {
            t->dx = x; t->dy = y; t->dw = w; t->dh = h;
        } else {
            int32_t x2 = std::max(t->dx + t->dw, x + w);
            int32_t y2 = std::max(t->dy + t->dh, y + h);
            t->dx = std::min(t->dx, x);
            t->dy = std::min(t->dy, y);
            t->dw = x2 - t->dx;
            t->dh = y2 - t->dy;
        }
        t->seq += 1;
    }
    t->cv.notify_all();
    return TRUE;
}

inline BOOL on_desktop_resize(rdpContext* ctx) {
    rdpSettings* st = ctx->settings;
    Tab* t = ctx_of(ctx)->tab;
    UINT32 w = freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight);
    std::lock_guard<std::mutex> g(t->mu);
    if (!gdi_resize(ctx->gdi, w, h)) return FALSE;
    t->width = static_cast<int32_t>(w);
    t->height = static_cast<int32_t>(h);
    t->dx = 0; t->dy = 0; t->dw = t->width; t->dh = t->height;
    t->seq += 1;
    t->cv.notify_all();
    return TRUE;
}

// ---- Display Control -------------------------------------------------------------

inline UINT on_disp_caps(DispClientContext* disp, UINT32 max_monitors, UINT32 a, UINT32 b) {
    (void)max_monitors; (void)a; (void)b;
    auto* c = static_cast<Conn*>(disp->custom);
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
    }
}

// ---- Connecting ----------------------------------------------------------------

inline BOOL on_pre_connect(freerdp* inst) {
    rdpContext* ctx = inst->context;
    PubSub_SubscribeChannelConnected(ctx->pubSub, on_channel_connected);
    PubSub_SubscribeChannelDisconnected(ctx->pubSub, on_channel_disconnected);
    return TRUE;
}

// Only the channels Flint uses: the dynamic channel carrier, Display Control and the
// clipboard (FreeRDP's own loader also asks for device redirection, which Flint leaves
// out).
inline BOOL load_channels(freerdp* inst) {
    rdpContext* ctx = inst->context;
    rdpSettings* st = ctx->settings;
    // drdynvc finds its plugins (disp) through the registered provider, which FreeRDP's
    // own clients register when they start.
    static std::once_flag registered;
    std::call_once(registered, [] { freerdp_register_addin_provider(freerdp_channels_load_static_addin_entry, 0); });
    const char* const disp[] = { DISP_CHANNEL_NAME };
    if (!freerdp_client_add_dynamic_channel(st, 1, disp)) return FALSE;
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

inline void wipe_password(rdpSettings* st) {
    const char* pw = freerdp_settings_get_string(st, FreeRDP_Password);
    if (pw) sodium_memzero(const_cast<char*>(pw), std::strlen(pw));
    freerdp_settings_set_string(st, FreeRDP_Password, nullptr);
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

inline void install_tcp_hook(rdpContext* ctx) {
    const rdpTransportIo* io = freerdp_get_io_callbacks(ctx);
    if (!io || !io->TCPConnect) return;
    rdpTransportIo mine = *io;
    if (io->TCPConnect != connect_tcp) default_tcp_connect() = io->TCPConnect;
    if (!default_tcp_connect()) return;
    mine.TCPConnect = connect_tcp;
    (void)freerdp_set_io_callbacks(ctx, &mine);
}

// Connects tab `id` (creating it, or replacing its connection), logs in and starts
// the connection's loop. Returns RDP_OK and the desktop's size and frame channel, or
// an RDP_ERR_* code; `detail` gets FreeRDP's error name, never a credential.
inline int open(const std::string& id, const std::string& host, int32_t port, const std::string& user,
                const std::string& domain, const std::string& password, int32_t width, int32_t height,
                const std::string& trusted, int64_t timeout_ms, int32_t& out_w, int32_t& out_h, int32_t& out_port,
                std::string& out_token, std::string& detail) {
    quiet_freerdp_log();
    auto t = tab_for(id);
    if (t->closed.load()) return RDP_ERR_CLOSED;
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
    }
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
    // Kerberos first stalls on a user written as an e-mail address (M28): NTLM only.
    freerdp_settings_set_string(st, FreeRDP_AuthenticationPackageList, "ntlm,!kerberos");
    freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, static_cast<UINT32>(width));
    freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, static_cast<UINT32>(height));
    freerdp_settings_set_uint32(st, FreeRDP_ColorDepth, 32);
    freerdp_settings_set_uint32(st, FreeRDP_KeyboardLayout, local_keyboard_layout());
    freerdp_settings_set_uint32(st, FreeRDP_TcpConnectTimeout, static_cast<UINT32>(timeout_ms));
    freerdp_settings_set_bool(st, FreeRDP_ExternalCertificateManagement, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_SoftwareGdi, TRUE);
    // NSCodec costs nothing with Windows (it does not use it) and is what FreeRDP's
    // own servers, the test server among them, need.
    freerdp_settings_set_bool(st, FreeRDP_NSCodec, TRUE);
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
    wipe_password(st);
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
        t->dx = 0; t->dy = 0; t->dw = t->width; t->dh = t->height;
        t->seq += 1;
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
inline int resize(const std::string& id, int32_t w, int32_t h) {
    auto t = find(id);
    if (!t || t->closed.load()) return RDP_ERR_CLOSED;
    std::shared_ptr<Conn> c;
    {
        std::lock_guard<std::mutex> g(t->mu);
        c = t->conn;
        if (!c || c->ended.load()) return RDP_ERR_CLOSED;
        if (t->width == w && t->height == h) {
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
inline int wait(const std::string& id, int64_t wait_ms, int32_t& code, std::string& detail, int32_t& w, int32_t& h) {
    code = 0;
    detail.clear();
    auto t = find(id);
    if (!t || t->closed.load()) return EV_ENDED;
    std::unique_lock<std::mutex> g(t->mu);
    auto pending = [&] {
        return t->closed.load() || !t->conn || t->conn->ended.load() || t->want_w != 0 || t->remote_pending || t->request_pending;
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
    return EV_RUNNING;
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

// Takes the pending dirty region: a 16-byte little-endian header followed by its RGBA
// rows. `out` is empty when nothing changed. Header: u32 seq, u16 x, y, w, h, then the
// whole desktop's u16 width and height. Called with `t.mu` held.
inline int take_frame_locked(Tab& t, std::string& out) {
    out.clear();
    if (t.closed.load()) return RDP_ERR_CLOSED;
    if (t.dw == 0 || !t.conn || !t.conn->inst || !t.conn->inst->context->gdi) return RDP_OK;
    rdpGdi* gdi = t.conn->inst->context->gdi;
    int32_t x = t.dx, y = t.dy, w = t.dw, h = t.dh;
    // A union drawn before a resize may reach past the new size.
    w = std::min<int32_t>(w, static_cast<int32_t>(gdi->width) - x);
    h = std::min<int32_t>(h, static_cast<int32_t>(gdi->height) - y);
    t.dw = 0;
    if (w <= 0 || h <= 0) return RDP_OK;
    out.resize(16 + static_cast<size_t>(w) * h * 4);
    auto* p = reinterpret_cast<uint8_t*>(out.data());
    auto put16 = [&](size_t at, uint32_t v) { p[at] = v & 0xff; p[at + 1] = (v >> 8) & 0xff; };
    auto put32 = [&](size_t at, uint32_t v) { put16(at, v & 0xffff); put16(at + 2, v >> 16); };
    put32(0, static_cast<uint32_t>(t.seq));
    put16(4, x); put16(6, y); put16(8, w); put16(10, h);
    put16(12, gdi->width); put16(14, gdi->height);
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

// Waits up to `wait_ms` for a dirty region, then takes it. For tests; the page reads
// through the frame channel.
inline int next_frame(const std::string& id, int64_t wait_ms, std::string& out) {
    auto t = find(id);
    if (!t) return RDP_ERR_CLOSED;
    std::unique_lock<std::mutex> g(t->mu);
    t->cv.wait_for(g, std::chrono::milliseconds(wait_ms), [&] { return t->dw != 0 || t->closed.load(); });
    return take_frame_locked(*t, out);
}

inline bool send_all(sock_t fd, const char* p, size_t n) {
    while (n > 0) {
        int k = sock_send(fd, p, n);
        if (k <= 0) return false;
        p += k; n -= static_cast<size_t>(k);
    }
    return true;
}

inline void serve_conn(std::shared_ptr<Tab> t, sock_t fd) {
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
        const std::string cors = "Access-Control-Allow-Origin: *\r\n";
        if (head.rfind("OPTIONS ", 0) == 0) {
            std::string r = "HTTP/1.1 204 No Content\r\n" + cors + "Access-Control-Allow-Methods: GET\r\nContent-Length: 0\r\n\r\n";
            if (!send_all(fd, r.data(), r.size())) break;
            continue;
        }
        bool authorised = false;
        auto tpos = head.find("t=");
        if (tpos != std::string::npos) {
            std::string tok = head.substr(tpos + 2, t->token.size());
            authorised = !t->token.empty() && tok.size() == t->token.size() &&
                         sodium_memcmp(tok.data(), t->token.data(), tok.size()) == 0;
        }
        if (!authorised) {
            std::string r = "HTTP/1.1 403 Forbidden\r\n" + cors + "Content-Length: 0\r\nConnection: close\r\n\r\n";
            send_all(fd, r.data(), r.size());
            break;
        }
        std::string body;
        bool gone;
        {
            std::unique_lock<std::mutex> g(t->mu);
            t->cv.wait_for(g, std::chrono::milliseconds(1000), [&] { return t->dw != 0 || t->closed.load(); });
            gone = t->closed.load();
            if (!gone) take_frame_locked(*t, body);
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
