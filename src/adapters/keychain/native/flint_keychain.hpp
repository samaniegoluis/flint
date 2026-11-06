// CFIRE-UPSTREAM: CF-008, CF-031
//
// OS keychain shim for src/adapters/keychain/keychain.cf. cfire has no keychain
// module (CF-008) and cannot select a per-platform source file or link a framework
// (CF-031), so both platforms live in this one header behind #if.
//
// Each entry is a generic password: service "Flint", account = the vault's id.
// Return codes: 0 ok, 1 not found, 2 keychain unavailable, 3 other failure.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#if defined(__APPLE__)
#include <Security/Security.h>

namespace flint_kc {

inline CFStringRef cf_str(const std::string& s) {
    return CFStringCreateWithBytes(nullptr, reinterpret_cast<const UInt8*>(s.data()),
        static_cast<CFIndex>(s.size()), kCFStringEncodingUTF8, false);
}

inline CFMutableDictionaryRef base_query(const std::string& service, const std::string& account) {
    CFMutableDictionaryRef q = CFDictionaryCreateMutable(nullptr, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFStringRef svc = cf_str(service);
    CFStringRef acc = cf_str(account);
    CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(q, kSecAttrService, svc);
    CFDictionarySetValue(q, kSecAttrAccount, acc);
    CFRelease(svc);
    CFRelease(acc);
    return q;
}

inline int map_status(OSStatus st) {
    if (st == errSecSuccess) return 0;
    if (st == errSecItemNotFound) return 1;
    if (st == errSecNotAvailable || st == errSecNoSuchKeychain || st == errSecInteractionNotAllowed) return 2;
    return 3;
}

inline int save(const std::string& service, const std::string& account, const std::vector<std::byte>& secret) {
    CFMutableDictionaryRef q = base_query(service, account);
    CFDataRef data = CFDataCreate(nullptr, reinterpret_cast<const UInt8*>(secret.data()), static_cast<CFIndex>(secret.size()));
    CFMutableDictionaryRef attrs = CFDictionaryCreateMutable(nullptr, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(attrs, kSecValueData, data);
    OSStatus st = SecItemUpdate(q, attrs);
    if (st == errSecItemNotFound) {
        CFDictionarySetValue(q, kSecValueData, data);
        CFStringRef label = cf_str("Flint vault key");
        CFDictionarySetValue(q, kSecAttrLabel, label);
        CFRelease(label);
        // Honoured by the data-protection keychain; the file-based login keychain an
        // unsigned CLI writes to ignores it. Kept so a signed build gets it for free.
        CFDictionarySetValue(q, kSecAttrAccessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
        st = SecItemAdd(q, nullptr);
    }
    CFRelease(attrs);
    CFRelease(data);
    CFRelease(q);
    return map_status(st);
}

inline int load(const std::string& service, const std::string& account, std::vector<std::byte>& out) {
    CFMutableDictionaryRef q = base_query(service, account);
    CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
    CFTypeRef result = nullptr;
    OSStatus st = SecItemCopyMatching(q, &result);
    CFRelease(q);
    if (st == errSecSuccess && result) {
        CFDataRef data = static_cast<CFDataRef>(result);
        const auto* p = reinterpret_cast<const std::byte*>(CFDataGetBytePtr(data));
        out.assign(p, p + CFDataGetLength(data));
        CFRelease(result);
    }
    return map_status(st);
}

inline int forget(const std::string& service, const std::string& account) {
    CFMutableDictionaryRef q = base_query(service, account);
    OSStatus st = SecItemDelete(q);
    CFRelease(q);
    return map_status(st);
}

}  // namespace flint_kc

#else  // Linux: Secret Service through libsecret

#include <libsecret/secret.h>

namespace flint_kc {

inline const SecretSchema* schema() {
    static const SecretSchema s = {
        "dev.flint.VaultKey", SECRET_SCHEMA_NONE,
        {
            {"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
            {"account", SECRET_SCHEMA_ATTRIBUTE_STRING},
            {nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING},
        },
    };
    return &s;
}

inline int map_error(GError* err) {
    if (!err) return 0;
    // No Secret Service on the session bus (headless box, no keyring daemon).
    int code = (err->domain == G_DBUS_ERROR || err->domain == G_IO_ERROR) ? 2 : 3;
    g_error_free(err);
    return code;
}

inline int save(const std::string& service, const std::string& account, const std::vector<std::byte>& secret) {
    // libsecret stores text; the key goes in as lowercase hex.
    static const char* digits = "0123456789abcdef";
    std::string hex;
    hex.reserve(secret.size() * 2);
    for (auto b : secret) {
        auto v = std::to_integer<unsigned>(b);
        hex.push_back(digits[v >> 4]);
        hex.push_back(digits[v & 15]);
    }
    GError* err = nullptr;
    secret_password_store_sync(schema(), SECRET_COLLECTION_DEFAULT, "Flint vault key",
        hex.c_str(), nullptr, &err, "service", service.c_str(), "account", account.c_str(), nullptr);
    std::fill(hex.begin(), hex.end(), '\0');
    return map_error(err);
}

inline int load(const std::string& service, const std::string& account, std::vector<std::byte>& out) {
    GError* err = nullptr;
    gchar* hex = secret_password_lookup_sync(schema(), nullptr, &err,
        "service", service.c_str(), "account", account.c_str(), nullptr);
    if (err) return map_error(err);
    if (!hex) return 1;
    std::string h(hex);
    secret_password_free(hex);
    auto val = [](char c) -> int { return c <= '9' ? c - '0' : c - 'a' + 10; };
    out.clear();
    for (size_t i = 0; i + 1 < h.size(); i += 2) {
        out.push_back(static_cast<std::byte>((val(h[i]) << 4) | val(h[i + 1])));
    }
    std::fill(h.begin(), h.end(), '\0');
    return 0;
}

inline int forget(const std::string& service, const std::string& account) {
    GError* err = nullptr;
    gboolean removed = secret_password_clear_sync(schema(), nullptr, &err,
        "service", service.c_str(), "account", account.c_str(), nullptr);
    if (err) return map_error(err);
    return removed ? 0 : 1;
}

}  // namespace flint_kc

#endif
