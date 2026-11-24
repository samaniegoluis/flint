// CFIRE-UPSTREAM: CF-191
//
// The OS's preferred language as a tag (milestone 66, D-140): the first of macOS's
// preferred languages ("es-MX"), Windows' user interface language ("es-ES"). cfire has
// no locale query (CF-191). Linux is read from the environment in language.cf.
#pragma once
#include <string>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

namespace flint_language {

inline std::string preferred() {
#if defined(__APPLE__)
    std::string out;
    CFArrayRef langs = CFLocaleCopyPreferredLanguages();
    if (langs == nullptr) {
        return out;
    }
    if (CFArrayGetCount(langs) > 0) {
        CFStringRef first = (CFStringRef)CFArrayGetValueAtIndex(langs, 0);
        char buf[64] = {0};
        if (first != nullptr && CFStringGetCString(first, buf, sizeof(buf), kCFStringEncodingUTF8)) {
            out = buf;
        }
    }
    CFRelease(langs);
    return out;
#elif defined(_WIN32)
    wchar_t name[LOCALE_NAME_MAX_LENGTH] = {0};
    LCID lcid = MAKELCID(GetUserDefaultUILanguage(), SORT_DEFAULT);
    int n = LCIDToLocaleName(lcid, name, LOCALE_NAME_MAX_LENGTH, 0);
    std::string out;
    for (int i = 0; i + 1 < n && name[i] != 0; i++) {
        out += (name[i] < 128) ? (char)name[i] : '?';
    }
    return out;
#else
    return "";
#endif
}

}  // namespace flint_language
