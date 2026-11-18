// CFIRE-UPSTREAM: CF-093, CF-031
//
// A presence check before the owner's Allow takes effect (milestone 12): the OS asks
// the person at the machine to prove they are there. cfire has no API for it (CF-093).
//
// macOS: LocalAuthentication's LAContext with LAPolicyDeviceOwnerAuthentication: Touch
// ID where the Mac has it, the Mac's login password otherwise. It needs no signed
// build (unlike a Keychain item gated by Touch ID). The call blocks its thread until
// the person answers, so it runs on a worker, never on the main thread.
//
// Linux: polkit's CheckAuthorization on the system bus for the action
// dev.flint.approve (packaging/linux/dev.flint.policy, auth_self), with user
// interaction allowed, so the desktop's polkit agent asks for the login password or a
// fingerprint. Where that action is not installed or polkit is missing, the app
// falls back to the vault's master password (src/adapters/uievents/presence.cf).
//
// Windows (windows-port branch): no OS check yet, so the window asks for the master
// password. Windows Hello (WinRT UserConsentVerifier, through
// IUserConsentVerifierInterop for a desktop window) is the candidate.
#pragma once
#include <string>

#if defined(__APPLE__)
#if defined(__OBJC__)
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#endif
#elif defined(_WIN32)
#else
#include <gio/gio.h>
#include <unistd.h>
#endif

namespace flint_presence {

// The longest the OS dialog may stay open (Principle 8).
inline constexpr int WAIT_MS = 120000;

#if defined(__APPLE__) && defined(__OBJC__)

// "touchid", "device" (the Mac's password) or "" when neither can be used.
inline std::string method() {
    @autoreleasepool {
        LAContext* ctx = [[LAContext alloc] init];
        NSError* err = nil;
        if ([ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&err]) return "touchid";
        err = nil;
        if ([ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&err]) return "device";
        return "";
    }
}

// 1 confirmed, 0 refused or cancelled, -1 could not ask (err says why).
inline int confirm(const std::string& reason, std::string& err) {
    @autoreleasepool {
        LAContext* ctx = [[LAContext alloc] init];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block int result = 0;
        __block std::string why;
        NSString* text = [NSString stringWithUTF8String:reason.c_str()];
        [ctx evaluatePolicy:LAPolicyDeviceOwnerAuthentication
            localizedReason:text
                      reply:^(BOOL ok, NSError* e) {
                        if (ok) {
                            result = 1;
                        } else if (e != nil && (e.code == LAErrorUserCancel || e.code == LAErrorAuthenticationFailed ||
                                                e.code == LAErrorSystemCancel || e.code == LAErrorAppCancel ||
                                                e.code == LAErrorUserFallback)) {
                            result = 0;
                        } else {
                            result = -1;
                            why = e != nil ? std::string([[e localizedDescription] UTF8String]) : "unknown error";
                        }
                        dispatch_semaphore_signal(done);
                      }];
        long timed_out = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, (int64_t)WAIT_MS * NSEC_PER_MSEC));
        if (timed_out != 0) {
            [ctx invalidate];
            return 0;
        }
        err = why;
        return result;
    }
}

#elif defined(__APPLE__)

// Compiled as C++ without Objective-C (the CLI's tests): no presence check here.
inline std::string method() { return ""; }
inline int confirm(const std::string&, std::string& err) {
    err = "no presence check in this build";
    return -1;
}

#elif defined(_WIN32)

inline std::string method() { return ""; }
inline int confirm(const std::string&, std::string& err) {
    err = "no presence check on Windows yet";
    return -1;
}

#else

inline const char* ACTION = "dev.flint.approve";

inline GDBusConnection* system_bus() {
    GError* e = nullptr;
    GDBusConnection* bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, &e);
    if (e != nullptr) g_error_free(e);
    return bus;
}

// "polkit" when polkit runs and knows Flint's action, "" otherwise.
inline std::string method() {
    GDBusConnection* bus = system_bus();
    if (bus == nullptr) return "";
    GError* e = nullptr;
    GVariant* r = g_dbus_connection_call_sync(
        bus, "org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority", "org.freedesktop.PolicyKit1.Authority",
        "EnumerateActions", g_variant_new("(s)", ""), G_VARIANT_TYPE("(a(ssssssuuua{ss}))"), G_DBUS_CALL_FLAGS_NONE, 5000,
        nullptr, &e);
    g_object_unref(bus);
    if (r == nullptr) {
        if (e != nullptr) g_error_free(e);
        return "";
    }
    bool found = false;
    GVariantIter* it = nullptr;
    g_variant_get(r, "(a(ssssssuuua{ss}))", &it);
    const gchar* id = nullptr;
    GVariant* child = nullptr;
    while ((child = g_variant_iter_next_value(it)) != nullptr) {
        g_variant_get_child(child, 0, "&s", &id);
        if (id != nullptr && std::string(id) == ACTION) found = true;
        g_variant_unref(child);
    }
    g_variant_iter_free(it);
    g_variant_unref(r);
    return found ? "polkit" : "";
}

inline int confirm(const std::string& reason, std::string& err) {
    (void)reason;  // polkit shows the action's own message from the .policy file
    GDBusConnection* bus = system_bus();
    if (bus == nullptr) {
        err = "no system bus";
        return -1;
    }
    GVariantBuilder subject;
    g_variant_builder_init(&subject, G_VARIANT_TYPE("a{sv}"));
    g_variant_builder_add(&subject, "{sv}", "pid", g_variant_new_uint32(static_cast<guint32>(::getpid())));
    g_variant_builder_add(&subject, "{sv}", "start-time", g_variant_new_uint64(0));
    GVariantBuilder details;
    g_variant_builder_init(&details, G_VARIANT_TYPE("a{ss}"));
    GError* e = nullptr;
    GVariant* r = g_dbus_connection_call_sync(
        bus, "org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority", "org.freedesktop.PolicyKit1.Authority",
        "CheckAuthorization",
        g_variant_new("((sa{sv})sa{ss}us)", "unix-process", &subject, ACTION, &details, 1u /* AllowUserInteraction */, ""),
        G_VARIANT_TYPE("((bba{ss}))"), G_DBUS_CALL_FLAGS_NONE, WAIT_MS, nullptr, &e);
    g_object_unref(bus);
    if (r == nullptr) {
        err = e != nullptr ? e->message : "polkit did not answer";
        if (e != nullptr) g_error_free(e);
        return -1;
    }
    gboolean authorized = FALSE, challenge = FALSE;
    GVariant* inner = g_variant_get_child_value(r, 0);
    g_variant_get_child(inner, 0, "b", &authorized);
    g_variant_get_child(inner, 1, "b", &challenge);
    g_variant_unref(inner);
    g_variant_unref(r);
    return authorized ? 1 : 0;
}

#endif

}  // namespace flint_presence
