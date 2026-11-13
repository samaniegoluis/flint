// THROWAWAY SPIKE (milestone 38). Not product code.
//
// Does FreeRDP 3 send a real monitor layout to a Windows host, and what surface comes
// back? Connects once with the layout given (TS_UD_CS_MONITOR + _EX at connect), reports
// what the server answers (desktop size, the Monitor Layout PDU, RDPGFX's ResetGraphics,
// surfaces and their outputs), then changes the layout twice through Display Control
// (one monitor, then the layout again) to see whether a tab could go multi-monitor
// without reconnecting. Sends NO input: the host may be someone's real session.
//
//   sec with FLINT_RDP_TEST_HOST FLINT_RDP_TEST_USER FLINT_RDP_TEST_PASSWORD -- \
//     ./probe "<x,y,w,h,primary,orientation,scale;...>" [gfx|compatible] [connect|disp]
//
// connect: the layout goes at connect.  disp: connect with one monitor (the primary),
// then send the layout through Display Control.
#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/client/channels.h>
#include <freerdp/client/disp.h>
#include <freerdp/client/rdpgfx.h>
#include <freerdp/channels/channels.h>
#include <freerdp/channels/drdynvc.h>
#include <freerdp/channels/disp.h>
#include <freerdp/channels/rdpgfx.h>
#include <freerdp/crypto/certificate.h>
#include <freerdp/event.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/gdi/gfx.h>
#include <freerdp/settings.h>
#include <winpr/synch.h>
#include <winpr/wlog.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

struct Mon { int x, y, w, h, primary, orient, scale; };

static std::vector<Mon> g_layout;
static DispClientContext* g_disp = nullptr;
static bool g_disp_ready = false;
static RdpgfxClientContext* g_gfx = nullptr;
static pcRdpgfxResetGraphics g_reset = nullptr;
static pcRdpgfxCreateSurface g_create = nullptr;
static pcRdpgfxMapSurfaceToOutput g_map = nullptr;
static auto g_t0 = std::chrono::steady_clock::now();

static double now_s() { return std::chrono::duration<double>(std::chrono::steady_clock::now() - g_t0).count(); }
#define LOG(...) do { fprintf(stdout, "[%6.2f] ", now_s()); fprintf(stdout, __VA_ARGS__); fprintf(stdout, "\n"); fflush(stdout); } while (0)

static std::vector<Mon> parse(const std::string& s) {
    std::vector<Mon> v;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ';')) {
        Mon m{};
        if (sscanf(item.c_str(), "%d,%d,%d,%d,%d,%d,%d", &m.x, &m.y, &m.w, &m.h, &m.primary, &m.orient, &m.scale) >= 5) {
            if (m.scale == 0) m.scale = 100;
            v.push_back(m);
        }
    }
    return v;
}

static UINT on_reset(RdpgfxClientContext* c, const RDPGFX_RESET_GRAPHICS_PDU* p) {
    LOG("gfx ResetGraphics %ux%u monitors=%u", p->width, p->height, p->monitorCount);
    for (UINT32 i = 0; i < p->monitorCount; ++i) {
        const MONITOR_DEF& d = p->monitorDefArray[i];
        LOG("  gfx monitor %u: [%d,%d]-[%d,%d] flags=%u", i, d.left, d.top, d.right, d.bottom, d.flags);
    }
    return g_reset(c, p);
}
static UINT on_create(RdpgfxClientContext* c, const RDPGFX_CREATE_SURFACE_PDU* p) {
    LOG("gfx CreateSurface id=%u %ux%u", p->surfaceId, p->width, p->height);
    return g_create(c, p);
}
static UINT on_map(RdpgfxClientContext* c, const RDPGFX_MAP_SURFACE_TO_OUTPUT_PDU* p) {
    LOG("gfx MapSurfaceToOutput id=%u origin=(%u,%u)", p->surfaceId, p->outputOriginX, p->outputOriginY);
    return g_map(c, p);
}

static UINT on_disp_caps(DispClientContext*, UINT32 max_monitors, UINT32 a, UINT32 b) {
    LOG("disp caps: max monitors %u, max area factors %u x %u", max_monitors, a, b);
    g_disp_ready = true;
    return CHANNEL_RC_OK;
}

static void on_connected(void* ctx_, const ChannelConnectedEventArgs* e) {
    auto* ctx = static_cast<rdpContext*>(ctx_);
    if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
        g_disp = static_cast<DispClientContext*>(e->pInterface);
        g_disp->DisplayControlCaps = on_disp_caps;
    } else if (strcmp(e->name, RDPGFX_DVC_CHANNEL_NAME) == 0) {
        g_gfx = static_cast<RdpgfxClientContext*>(e->pInterface);
        gdi_graphics_pipeline_init(ctx->gdi, g_gfx);
        g_reset = g_gfx->ResetGraphics; g_gfx->ResetGraphics = on_reset;
        g_create = g_gfx->CreateSurface; g_gfx->CreateSurface = on_create;
        g_map = g_gfx->MapSurfaceToOutput; g_gfx->MapSurfaceToOutput = on_map;
        LOG("gfx channel connected");
    }
}

static BOOL pre_connect(freerdp* inst) {
    PubSub_SubscribeChannelConnected(inst->context->pubSub, on_connected);
    return TRUE;
}

static BOOL load_channels(freerdp* inst) {
    rdpSettings* st = inst->context->settings;
    freerdp_register_addin_provider(freerdp_channels_load_static_addin_entry, 0);
    const char* const disp[] = { DISP_CHANNEL_NAME };
    if (!freerdp_client_add_dynamic_channel(st, 1, disp)) return FALSE;
    if (freerdp_settings_get_bool(st, FreeRDP_SupportGraphicsPipeline)) {
        const char* const gfx[] = { RDPGFX_CHANNEL_NAME };
        if (!freerdp_client_add_dynamic_channel(st, 1, gfx)) return FALSE;
    }
    freerdp_settings_set_bool(st, FreeRDP_SupportDynamicChannels, TRUE);
    PVIRTUALCHANNELENTRY entry = freerdp_channels_load_static_addin_entry(
        DRDYNVC_SVC_CHANNEL_NAME, nullptr, nullptr, FREERDP_ADDIN_CHANNEL_STATIC | FREERDP_ADDIN_CHANNEL_ENTRYEX);
    if (!entry) return FALSE;
    return freerdp_channels_client_load_ex(inst->context->channels, st, reinterpret_cast<PVIRTUALCHANNELENTRYEX>(entry), st) == 0;
}

static BOOL desktop_resize(rdpContext* ctx) {
    rdpSettings* st = ctx->settings;
    UINT32 w = freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight);
    LOG("DesktopResize -> %ux%u", w, h);
    return gdi_resize(ctx->gdi, w, h);
}

static BOOL remote_monitors(rdpContext*, UINT32 count, const MONITOR_DEF* m) {
    LOG("server Monitor Layout PDU: %u monitors", count);
    for (UINT32 i = 0; i < count; ++i) LOG("  server monitor %u: [%d,%d]-[%d,%d] flags=%u", i, m[i].left, m[i].top, m[i].right, m[i].bottom, m[i].flags);
    return TRUE;
}

static BOOL post_connect(freerdp* inst) {
    if (!gdi_init(inst, PIXEL_FORMAT_RGBA32)) return FALSE;
    inst->context->update->DesktopResize = desktop_resize;
    inst->context->update->RemoteMonitors = remote_monitors;
    return TRUE;
}

static int verify_x509(freerdp*, const BYTE* data, size_t len, const char*, UINT16, DWORD) {
    std::string pem(reinterpret_cast<const char*>(data), len);
    rdpCertificate* c = freerdp_certificate_new_from_pem(pem.c_str());
    char* fp = c ? freerdp_certificate_get_fingerprint_by_hash(c, "sha256") : nullptr;
    const char* want = getenv("FLINT_RDP_TEST_FP");
    bool ok = fp && (!want || !*want || strcasecmp(fp, want) == 0);
    LOG("certificate sha256 %s -> %s", fp ? fp : "?", ok ? "accepted" : "REFUSED");
    free(fp);
    if (c) freerdp_certificate_free(c);
    return ok ? 2 : 0;
}

static void pump(freerdp* inst, double seconds) {
    auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(seconds);
    HANDLE hs[MAXIMUM_WAIT_OBJECTS];
    while (std::chrono::steady_clock::now() < end) {
        DWORD n = freerdp_get_event_handles(inst->context, hs, MAXIMUM_WAIT_OBJECTS);
        if (n == 0) break;
        WaitForMultipleObjects(n, hs, FALSE, 100);
        if (!freerdp_check_event_handles(inst->context)) { LOG("connection ended: %s", freerdp_get_last_error_name(freerdp_get_last_error(inst->context))); break; }
    }
}

static void report(freerdp* inst, const char* when) {
    rdpGdi* g = inst->context->gdi;
    rdpSettings* st = inst->context->settings;
    LOG("%s: gdi surface %dx%d, settings desktop %ux%u, monitors in settings %u", when, g ? g->width : -1, g ? g->height : -1,
        freerdp_settings_get_uint32(st, FreeRDP_DesktopWidth), freerdp_settings_get_uint32(st, FreeRDP_DesktopHeight),
        freerdp_settings_get_uint32(st, FreeRDP_MonitorCount));
}

static bool send_layout(const std::vector<Mon>& v) {
    if (!g_disp || !g_disp_ready) { LOG("disp not ready"); return false; }
    std::vector<DISPLAY_CONTROL_MONITOR_LAYOUT> L(v.size());
    for (size_t i = 0; i < v.size(); ++i) {
        auto& l = L[i];
        l.Flags = v[i].primary ? DISPLAY_CONTROL_MONITOR_PRIMARY : 0;
        l.Left = v[i].x; l.Top = v[i].y; l.Width = v[i].w & ~1u; l.Height = v[i].h;
        l.PhysicalWidth = 0; l.PhysicalHeight = 0; l.Orientation = v[i].orient;
        l.DesktopScaleFactor = v[i].scale; l.DeviceScaleFactor = v[i].scale >= 200 ? 180 : (v[i].scale >= 140 ? 140 : 100);
        LOG("  disp send %zu: %d,%d %ux%u primary=%d orient=%u scale=%u", i, l.Left, l.Top, l.Width, l.Height, v[i].primary, l.Orientation, l.DesktopScaleFactor);
    }
    UINT r = g_disp->SendMonitorLayout(g_disp, static_cast<UINT32>(L.size()), L.data());
    LOG("disp SendMonitorLayout(%zu) -> %u", L.size(), r);
    return r == CHANNEL_RC_OK;
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: probe <layout> [gfx|compatible] [connect|disp]\n"); return 2; }
    WLog_SetLogLevel(WLog_GetRoot(), WLOG_ERROR);
    g_layout = parse(argv[1]);
    std::string mode = argc > 2 ? argv[2] : "gfx";
    std::string how = argc > 3 ? argv[3] : "connect";
    const char* host = getenv("FLINT_RDP_TEST_HOST");
    const char* user = getenv("FLINT_RDP_TEST_USER");
    const char* pass = getenv("FLINT_RDP_TEST_PASSWORD");
    if (!host || !user || !pass || g_layout.empty()) { fprintf(stderr, "needs FLINT_RDP_TEST_* and a layout\n"); return 2; }

    freerdp* inst = freerdp_new();
    inst->PreConnect = pre_connect;
    inst->PostConnect = post_connect;
    inst->LoadChannels = load_channels;
    inst->VerifyX509Certificate = verify_x509;
    freerdp_context_new(inst);
    rdpSettings* st = inst->context->settings;
    freerdp_settings_set_string(st, FreeRDP_ServerHostname, host);
    freerdp_settings_set_uint32(st, FreeRDP_ServerPort, 3389);
    freerdp_settings_set_string(st, FreeRDP_Username, user);
    freerdp_settings_set_string(st, FreeRDP_Password, pass);
    freerdp_settings_set_bool(st, FreeRDP_AutoLogonEnabled, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_RdpSecurity, FALSE);
    freerdp_settings_set_string(st, FreeRDP_AuthenticationPackageList, "ntlm,!kerberos");
    freerdp_settings_set_bool(st, FreeRDP_ExternalCertificateManagement, TRUE);
    freerdp_settings_set_uint32(st, FreeRDP_ColorDepth, 32);
    freerdp_settings_set_bool(st, FreeRDP_SoftwareGdi, TRUE);
    freerdp_settings_set_uint32(st, FreeRDP_TcpConnectTimeout, 10000);
    const bool gfx = mode == "gfx";
    freerdp_settings_set_bool(st, FreeRDP_SupportGraphicsPipeline, gfx);
    freerdp_settings_set_bool(st, FreeRDP_GfxProgressive, gfx);
    freerdp_settings_set_bool(st, FreeRDP_GfxProgressiveV2, gfx);
    freerdp_settings_set_bool(st, FreeRDP_RemoteFxCodec, gfx);
    freerdp_settings_set_bool(st, FreeRDP_SupportDisplayControl, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_DynamicResolutionUpdate, TRUE);
    freerdp_settings_set_bool(st, FreeRDP_SupportMonitorLayoutPdu, TRUE);

    const Mon* prim = &g_layout[0];
    for (auto& m : g_layout) if (m.primary) prim = &m;
    if (how == "connect" && g_layout.size() > 1) {
        // As xfreerdp's /multimon: the bounding box as the desktop, one entry per monitor,
        // the primary at (0,0) (MS-RDPBCGR 2.2.1.3.6.1).
        int minx = 0, miny = 0, maxx = 0, maxy = 0;
        for (auto& m : g_layout) { minx = std::min(minx, m.x); miny = std::min(miny, m.y); maxx = std::max(maxx, m.x + m.w); maxy = std::max(maxy, m.y + m.h); }
        freerdp_settings_set_bool(st, FreeRDP_UseMultimon, TRUE);
        freerdp_settings_set_bool(st, FreeRDP_ForceMultimon, TRUE);
        freerdp_settings_set_bool(st, FreeRDP_HasMonitorAttributes, TRUE);
        freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, maxx - minx);
        freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, maxy - miny);
        freerdp_settings_set_pointer_len(st, FreeRDP_MonitorDefArray, nullptr, g_layout.size());
        for (size_t i = 0; i < g_layout.size(); ++i) {
            rdpMonitor m{};
            m.x = g_layout[i].x; m.y = g_layout[i].y; m.width = g_layout[i].w; m.height = g_layout[i].h;
            m.is_primary = g_layout[i].primary; m.orig_screen = static_cast<UINT32>(i);
            m.attributes.orientation = g_layout[i].orient;
            m.attributes.desktopScaleFactor = g_layout[i].scale;
            m.attributes.deviceScaleFactor = g_layout[i].scale >= 200 ? 180 : 100;
            freerdp_settings_set_pointer_array(st, FreeRDP_MonitorDefArray, i, &m);
        }
        freerdp_settings_set_uint32(st, FreeRDP_MonitorCount, static_cast<UINT32>(g_layout.size()));
        LOG("connect with %zu monitors, desktop %dx%d", g_layout.size(), maxx - minx, maxy - miny);
    } else {
        freerdp_settings_set_uint32(st, FreeRDP_DesktopWidth, prim->w & ~1);
        freerdp_settings_set_uint32(st, FreeRDP_DesktopHeight, prim->h);
        LOG("connect with one monitor %dx%d", prim->w & ~1, prim->h);
    }
    freerdp_set_connection_type(st, CONNECTION_TYPE_AUTODETECT);
    freerdp_settings_set_bool(st, FreeRDP_NetworkAutoDetect, TRUE);

    if (!freerdp_connect(inst)) {
        LOG("connect failed: %s", freerdp_get_last_error_name(freerdp_get_last_error(inst->context)));
        return 1;
    }
    LOG("connected (%s)", mode.c_str());
    pump(inst, 4.0);
    report(inst, "after connect");
    if (how == "disp") {
        send_layout(g_layout);
        pump(inst, 5.0);
        report(inst, "after the layout through Display Control");
    } else {
        std::vector<Mon> one{ Mon{0, 0, prim->w, prim->h, 1, prim->orient, prim->scale} };
        send_layout(one);
        pump(inst, 4.0);
        report(inst, "after one monitor through Display Control");
        send_layout(g_layout);
        pump(inst, 5.0);
        report(inst, "after the layout again through Display Control");
    }
    freerdp_disconnect(inst);
    freerdp_context_free(inst);
    freerdp_free(inst);
    return 0;
}
