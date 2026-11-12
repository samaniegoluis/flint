// CFIRE-UPSTREAM: CF-119
// A tiny RDP server for Flint's tests (milestone 31), over libfreerdp-server 3.
// FreeRDP's sample server has no clipboard channel, so the clipboard both ways, the
// keys a tab sends and a dropped connection are tested against this one instead.
// It is test code: never shipped, never linked into Flint.
//
//   flint-rdp-testserver --port=N --control=M --cert=FILE --key=FILE
//
// Any user, TLS without NLA, a desktop at the size the client asks, each 64x64 tile in
// a colour that says where it is (tile_colour), so a test can tell which part of the
// desktop a window shows (milestone 38).
// The control port (127.0.0.1:M) takes one command per connection and answers one line;
// text travels hex-encoded (UTF-8), so any character survives. The same commands are
// served over HTTP for a page (GET /copy/<hex>, GET /keys; gui-e2e):
//
//   copy <hex>   the server's clipboard now holds the text (a format list is sent)
//   paste        the server asks the client for its text (a format data request)
//   pasted       the text the client sent last, "-" for none, "fail" for a refusal
//   formats      the format ids the client announced last, comma-separated
//   keys         the keys received, "d:0x1d u:0x1d …" (0x100: extended)
//   clear        forgets pasted text, formats, keys and the pointer
//   drop         closes every client's connection without a goodbye
//   peers        how many clients are connected
//   pointer      where the last mouse event landed, "x,y" ("-" for none)

#include <winpr/crt.h>
#include <winpr/ssl.h>
#include <winpr/string.h>
#include <winpr/synch.h>
#include <winpr/winsock.h>
#include <winpr/wtsapi.h>
#include <winpr/wlog.h>
#include <freerdp/freerdp.h>
#include <freerdp/listener.h>
#include <freerdp/peer.h>
#include <freerdp/channels/channels.h>
#include <freerdp/channels/wtsvc.h>
#include <freerdp/channels/cliprdr.h>
#include <freerdp/server/cliprdr.h>
#include <freerdp/crypto/certificate.h>
#include <freerdp/crypto/privatekey.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr UINT32 CF_UNICODE = 13;

struct Peer;

std::mutex g_mu;
std::set<Peer*> g_peers;
std::string g_clip;          // the server's clipboard, UTF-8
std::string g_pasted = "-";  // the client's last answer
std::string g_formats;       // the client's last format list
std::vector<std::string> g_keys;
std::string g_pointer = "-";
const char* g_cert = nullptr;
const char* g_key = nullptr;

struct PeerContext {
    rdpContext base;  // first: FreeRDP allocates ContextSize bytes
    HANDLE vcm;
    CliprdrServerContext* cliprdr;
    Peer* peer;
};

struct Peer {
    freerdp_peer* client = nullptr;
    std::atomic<bool> drop{false};
};

PeerContext* pctx(rdpContext* c) { return reinterpret_cast<PeerContext*>(c); }

std::string hex(const std::string& s) {
    static const char* d = "0123456789abcdef";
    std::string out;
    for (unsigned char c : s) { out += d[c >> 4]; out += d[c & 15]; }
    return out;
}

std::string unhex(const std::string& s) {
    std::string out;
    for (size_t i = 0; i + 1 < s.size(); i += 2) out += static_cast<char>(std::stoi(s.substr(i, 2), nullptr, 16));
    return out;
}

// ---- Clipboard ---------------------------------------------------------------------

UINT announce(CliprdrServerContext* c, bool has_text) {
    CLIPRDR_FORMAT f{};
    f.formatId = CF_UNICODE;
    CLIPRDR_FORMAT_LIST list{};
    list.common.msgType = CB_FORMAT_LIST;
    list.numFormats = has_text ? 1 : 0;
    list.formats = has_text ? &f : nullptr;
    return c->ServerFormatList(c, &list);
}

UINT on_client_caps(CliprdrServerContext*, const CLIPRDR_CAPABILITIES*) { return CHANNEL_RC_OK; }

UINT on_client_format_list(CliprdrServerContext* c, const CLIPRDR_FORMAT_LIST* list) {
    std::string ids;
    for (UINT32 i = 0; i < list->numFormats; i++) {
        if (!ids.empty()) ids += ",";
        ids += std::to_string(list->formats[i].formatId);
    }
    { std::lock_guard<std::mutex> g(g_mu); g_formats = ids; }
    CLIPRDR_FORMAT_LIST_RESPONSE r{};
    r.common.msgType = CB_FORMAT_LIST_RESPONSE;
    r.common.msgFlags = CB_RESPONSE_OK;
    return c->ServerFormatListResponse(c, &r);
}

UINT on_client_format_list_response(CliprdrServerContext*, const CLIPRDR_FORMAT_LIST_RESPONSE*) { return CHANNEL_RC_OK; }

// The client pastes the server's text: UTF-16LE with its terminator.
UINT on_client_data_request(CliprdrServerContext* c, const CLIPRDR_FORMAT_DATA_REQUEST* req) {
    CLIPRDR_FORMAT_DATA_RESPONSE r{};
    r.common.msgType = CB_FORMAT_DATA_RESPONSE;
    std::string text;
    { std::lock_guard<std::mutex> g(g_mu); text = g_clip; }
    if (req->requestedFormatId != CF_UNICODE) {
        r.common.msgFlags = CB_RESPONSE_FAIL;
        return c->ServerFormatDataResponse(c, &r);
    }
    size_t n = 0;
    WCHAR* w = ConvertUtf8NToWCharAlloc(text.data(), text.size(), &n);
    std::vector<BYTE> data((n + 1) * sizeof(WCHAR), 0);
    if (w && n) std::memcpy(data.data(), w, n * sizeof(WCHAR));
    free(w);
    r.common.msgFlags = CB_RESPONSE_OK;
    r.common.dataLen = static_cast<UINT32>(data.size());
    r.requestedFormatData = data.data();
    return c->ServerFormatDataResponse(c, &r);
}

UINT on_client_data_response(CliprdrServerContext*, const CLIPRDR_FORMAT_DATA_RESPONSE* r) {
    std::string text = "fail";
    if (r->common.msgFlags & CB_RESPONSE_OK) {
        size_t wlen = r->common.dataLen / sizeof(WCHAR);
        const WCHAR* w = reinterpret_cast<const WCHAR*>(r->requestedFormatData);
        while (wlen > 0 && w[wlen - 1] == 0) wlen--;
        size_t n = 0;
        char* s = wlen ? ConvertWCharNToUtf8Alloc(w, wlen, &n) : nullptr;
        text = s ? std::string(s, n) : "";
        free(s);
    }
    std::lock_guard<std::mutex> g(g_mu);
    g_pasted = text;
    return CHANNEL_RC_OK;
}

// ---- Drawing and input -------------------------------------------------------------

// The colour of the 64x64 tile at column `tx`, row `ty`, as the client's RGBA bytes:
// red from the column, green from the row, blue fixed. gui-e2e's multimon run reads it
// back (scripts/gui-e2e.js, tileColour).
inline void tile_colour(UINT32 tx, UINT32 ty, BYTE& r, BYTE& g, BYTE& b) {
    r = static_cast<BYTE>(0x30 + (tx * 37) % 192);
    g = static_cast<BYTE>(0x30 + (ty * 53) % 192);
    b = 0x2e;
}

// The whole desktop as uncompressed 64x64 bitmaps, each tile in its own colour.
BOOL draw(freerdp_peer* client) {
    rdpSettings* st = client->context->settings;
    UINT32 w = freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight);
    std::vector<BYTE> tile(64 * 64 * 4);
    for (UINT32 y = 0; y < h; y += 64) {
        for (UINT32 x = 0; x < w; x += 64) {
            BYTE r, g, bl;
            tile_colour(x / 64, y / 64, r, g, bl);
            // The bitmap's bytes are BGRA.
            for (size_t i = 0; i < tile.size(); i += 4) { tile[i] = bl; tile[i + 1] = g; tile[i + 2] = r; tile[i + 3] = 0xff; }
            BITMAP_DATA b{};
            b.destLeft = x;
            b.destTop = y;
            b.width = std::min<UINT32>(64, w - x);
            b.height = std::min<UINT32>(64, h - y);
            b.destRight = x + b.width - 1;
            b.destBottom = y + b.height - 1;
            b.bitsPerPixel = 32;
            b.bitmapLength = b.width * b.height * 4;
            b.bitmapDataStream = tile.data();
            b.compressed = FALSE;
            BITMAP_UPDATE u{};
            u.number = 1;
            u.rectangles = &b;
            u.skipCompression = TRUE;
            if (!client->context->update->BitmapUpdate(client->context, &u)) return FALSE;
        }
    }
    return TRUE;
}

BOOL on_keyboard(rdpInput* input, UINT16 flags, UINT8 code) {
    (void)input;
    char buf[32];
    unsigned sc = code | ((flags & KBD_FLAGS_EXTENDED) ? 0x100u : 0u);
    std::snprintf(buf, sizeof buf, "%s:0x%x", (flags & KBD_FLAGS_RELEASE) ? "u" : "d", sc);
    std::lock_guard<std::mutex> g(g_mu);
    if (g_keys.size() < 4096) g_keys.emplace_back(buf);
    return TRUE;
}

BOOL on_unicode(rdpInput*, UINT16, UINT16) { return TRUE; }
BOOL on_mouse(rdpInput*, UINT16, UINT16 x, UINT16 y) {
    std::lock_guard<std::mutex> g(g_mu);
    g_pointer = std::to_string(x) + "," + std::to_string(y);
    return TRUE;
}
BOOL on_ext_mouse(rdpInput*, UINT16, UINT16, UINT16) { return TRUE; }
BOOL on_sync(rdpInput*, UINT32) { return TRUE; }
BOOL on_refresh(rdpContext* ctx, BYTE, const RECTANGLE_16*) { return draw(ctx->peer); }
BOOL on_suppress(rdpContext*, BYTE, const RECTANGLE_16*) { return TRUE; }

BOOL on_post_connect(freerdp_peer* client) {
    PeerContext* c = pctx(client->context);
    if (WTSVirtualChannelManagerIsChannelJoined(c->vcm, CLIPRDR_SVC_CHANNEL_NAME)) {
        c->cliprdr = cliprdr_server_context_new(c->vcm);
        if (!c->cliprdr) return FALSE;
        c->cliprdr->rdpcontext = client->context;
        c->cliprdr->useLongFormatNames = TRUE;
        c->cliprdr->autoInitializationSequence = TRUE;
        c->cliprdr->ClientCapabilities = on_client_caps;
        c->cliprdr->ClientFormatList = on_client_format_list;
        c->cliprdr->ClientFormatListResponse = on_client_format_list_response;
        c->cliprdr->ClientFormatDataRequest = on_client_data_request;
        c->cliprdr->ClientFormatDataResponse = on_client_data_response;
        if (c->cliprdr->Start(c->cliprdr) != CHANNEL_RC_OK) return FALSE;
    }
    return TRUE;
}

BOOL on_activate(freerdp_peer* client) { return draw(client); }

BOOL context_new(freerdp_peer* client, rdpContext* ctx) {
    PeerContext* c = pctx(ctx);
    c->cliprdr = nullptr;
    c->vcm = WTSOpenServerA(reinterpret_cast<LPSTR>(client->context));
    return c->vcm && c->vcm != INVALID_HANDLE_VALUE;
}

void context_free(freerdp_peer*, rdpContext* ctx) {
    PeerContext* c = pctx(ctx);
    if (c->cliprdr) {
        c->cliprdr->Stop(c->cliprdr);
        cliprdr_server_context_free(c->cliprdr);
    }
    if (c->vcm) WTSCloseServer(c->vcm);
}

void peer_loop(freerdp_peer* client) {
    Peer self;
    self.client = client;
    client->ContextSize = sizeof(PeerContext);
    client->ContextNew = context_new;
    client->ContextFree = context_free;
    if (!freerdp_peer_context_new(client)) { freerdp_peer_free(client); return; }
    pctx(client->context)->peer = &self;
    rdpSettings* st = client->context->settings;
    rdpPrivateKey* key = freerdp_key_new_from_file(g_key);
    rdpCertificate* cert = freerdp_certificate_new_from_file(g_cert);
    bool ok = key && cert
        && freerdp_settings_set_pointer_len(st, FreeRDP_RdpServerRsaKey, key, 1)
        && freerdp_settings_set_pointer_len(st, FreeRDP_RdpServerCertificate, cert, 1)
        && freerdp_settings_set_bool(st, FreeRDP_RdpSecurity, TRUE)
        && freerdp_settings_set_bool(st, FreeRDP_TlsSecurity, TRUE)
        && freerdp_settings_set_bool(st, FreeRDP_NlaSecurity, FALSE)
        && freerdp_settings_set_bool(st, FreeRDP_ExtSecurity, FALSE)
        && freerdp_settings_set_uint32(st, FreeRDP_EncryptionLevel, ENCRYPTION_LEVEL_CLIENT_COMPATIBLE)
        && freerdp_settings_set_uint32(st, FreeRDP_ColorDepth, 32)
        && freerdp_settings_set_bool(st, FreeRDP_RefreshRect, TRUE)
        && freerdp_settings_set_bool(st, FreeRDP_SuppressOutput, TRUE)
        && freerdp_settings_set_uint32(st, FreeRDP_MultifragMaxRequestSize, 0xFFFFFF);
    if (ok) {
        client->PostConnect = on_post_connect;
        client->Activate = on_activate;
        rdpInput* in = client->context->input;
        in->KeyboardEvent = on_keyboard;
        in->UnicodeKeyboardEvent = on_unicode;
        in->MouseEvent = on_mouse;
        in->ExtendedMouseEvent = on_ext_mouse;
        in->SynchronizeEvent = on_sync;
        client->context->update->RefreshRect = on_refresh;
        client->context->update->SuppressOutput = on_suppress;
        ok = client->Initialize(client);
    }
    if (ok) {
        { std::lock_guard<std::mutex> g(g_mu); g_peers.insert(&self); }
        HANDLE handles[MAXIMUM_WAIT_OBJECTS] = {};
        while (!self.drop.load()) {
            DWORD n = client->GetEventHandles(client, handles, MAXIMUM_WAIT_OBJECTS - 1);
            if (n == 0) break;
            handles[n++] = WTSVirtualChannelManagerGetEventHandle(pctx(client->context)->vcm);
            if (WaitForMultipleObjects(n, handles, FALSE, 100) == WAIT_FAILED) break;
            if (client->CheckFileDescriptor(client) != TRUE) break;
            if (WTSVirtualChannelManagerCheckFileDescriptor(pctx(client->context)->vcm) != TRUE) break;
        }
        { std::lock_guard<std::mutex> g(g_mu); g_peers.erase(&self); }
        if (self.drop.load()) {
            // No Deactivate or Disconnect PDU: the client sees the socket close, as on
            // a network that went away.
            ::shutdown(client->sockfd, SHUT_RDWR);
        } else {
            client->Disconnect(client);
        }
    }
    freerdp_peer_context_free(client);
    freerdp_peer_free(client);
}

BOOL on_accepted(freerdp_listener*, freerdp_peer* client) {
    std::thread(peer_loop, client).detach();
    return TRUE;
}

// ---- Control -----------------------------------------------------------------------

std::string run(const std::string& line) {
    std::string cmd = line.substr(0, line.find(' '));
    std::string arg = line.size() > cmd.size() ? line.substr(cmd.size() + 1) : "";
    std::lock_guard<std::mutex> g(g_mu);
    if (cmd == "copy") {
        g_clip = unhex(arg);
        for (Peer* p : g_peers) {
            auto* c = pctx(p->client->context)->cliprdr;
            if (c) (void)announce(c, true);
        }
        return "ok";
    }
    if (cmd == "paste") {
        g_pasted = "-";
        for (Peer* p : g_peers) {
            auto* c = pctx(p->client->context)->cliprdr;
            if (!c) continue;
            CLIPRDR_FORMAT_DATA_REQUEST r{};
            r.common.msgType = CB_FORMAT_DATA_REQUEST;
            r.requestedFormatId = CF_UNICODE;
            (void)c->ServerFormatDataRequest(c, &r);
        }
        return "ok";
    }
    if (cmd == "pasted") return g_pasted == "-" || g_pasted == "fail" ? g_pasted : hex(g_pasted);
    if (cmd == "formats") return g_formats.empty() ? "-" : g_formats;
    if (cmd == "keys") {
        std::string out;
        for (auto& k : g_keys) { if (!out.empty()) out += " "; out += k; }
        return out.empty() ? "-" : out;
    }
    if (cmd == "clear") { g_pasted = "-"; g_formats.clear(); g_keys.clear(); g_pointer = "-"; return "ok"; }
    if (cmd == "drop") { for (Peer* p : g_peers) p->drop.store(true); return "ok"; }
    if (cmd == "peers") return std::to_string(g_peers.size());
    if (cmd == "pointer") return g_pointer;
    return "unknown";
}

void control(int port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || ::listen(fd, 8) != 0) {
        std::fprintf(stderr, "control port %d: %s\n", port, std::strerror(errno));
        std::exit(2);
    }
    for (;;) {
        int c = ::accept(fd, nullptr, nullptr);
        if (c < 0) continue;
        std::string line;
        char ch;
        while (::recv(c, &ch, 1, 0) == 1 && ch != '\n') if (ch != '\r') line += ch;
        std::string out;
        if (line.rfind("GET /", 0) == 0) {
            // The page in gui-e2e asks over HTTP: GET /<cmd>[/<arg>]. The headers are
            // read and dropped.
            std::string path = line.substr(5, line.find(' ', 5) - 5);
            size_t slash = path.find('/');
            std::string cmd = slash == std::string::npos ? path : path.substr(0, slash) + " " + path.substr(slash + 1);
            std::string hdr;
            while (::recv(c, &ch, 1, 0) == 1) {
                hdr += ch;
                if (hdr.size() >= 4 && hdr.compare(hdr.size() - 4, 4, "\r\n\r\n") == 0) break;
            }
            std::string body = run(cmd);
            out = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: "
                + std::to_string(body.size()) + "\r\nConnection: close\r\n\r\n" + body;
        } else {
            out = run(line) + "\n";
        }
        (void)::send(c, out.data(), out.size(), 0);
        ::close(c);
    }
}

}  // namespace

int main(int argc, char** argv) {
    int port = 0, ctl = 0;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a.rfind("--port=", 0) == 0) port = std::atoi(a.c_str() + 7);
        else if (a.rfind("--control=", 0) == 0) ctl = std::atoi(a.c_str() + 10);
        else if (a.rfind("--cert=", 0) == 0) g_cert = argv[i] + 7;
        else if (a.rfind("--key=", 0) == 0) g_key = argv[i] + 6;
    }
    if (!port || !ctl || !g_cert || !g_key) {
        std::fprintf(stderr, "usage: %s --port=N --control=M --cert=FILE --key=FILE\n", argv[0]);
        return 2;
    }
    if (!std::getenv("FLINT_TESTSERVER_DEBUG")) WLog_SetLogLevel(WLog_GetRoot(), WLOG_OFF);
    if (!WTSRegisterWtsApiFunctionTable(FreeRDP_InitWtsApi())) return 1;
    winpr_InitializeSSL(WINPR_SSL_INIT_DEFAULT);
    std::thread(control, ctl).detach();
    freerdp_listener* l = freerdp_listener_new();
    l->PeerAccepted = on_accepted;
    if (!l->Open(l, "127.0.0.1", static_cast<UINT16>(port))) {
        std::fprintf(stderr, "port %d: could not listen\n", port);
        return 2;
    }
    std::printf("listening %d control %d\n", port, ctl);
    std::fflush(stdout);
    HANDLE handles[32];
    for (;;) {
        DWORD n = l->GetEventHandles(l, handles, 32);
        if (n == 0 || WaitForMultipleObjects(n, handles, FALSE, INFINITE) == WAIT_FAILED) break;
        if (l->CheckFileDescriptor(l) != TRUE) break;
    }
    l->Close(l);
    freerdp_listener_free(l);
    return 0;
}
