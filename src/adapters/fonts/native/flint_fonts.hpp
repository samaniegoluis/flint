// CFIRE-UPSTREAM: CF-031, CF-045
//
// Lists the monospaced font families installed on this machine, for Settings →
// Terminal. cfire has no font or OS-integration module (CF-045) and cannot link
// CoreText or pick a per-platform source file (CF-031).
//
// macOS: CoreText, families whose fonts carry the monospace trait.
// Linux: fontconfig's `fc-list :spacing=mono family` (absent fontconfig → none).
#pragma once
#include <string>
#include <vector>
#if defined(__APPLE__)
#include <CoreText/CoreText.h>
#else
#include <cstdio>
#endif

namespace flint_fonts {

#if defined(__APPLE__)
inline std::string cf_to_string(CFStringRef s) {
    if (!s) return {};
    char buf[512];
    if (CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8)) return buf;
    return {};
}

inline std::vector<std::string> mono_families() {
    std::vector<std::string> out;
    CTFontCollectionRef coll = CTFontCollectionCreateFromAvailableFonts(nullptr);
    if (!coll) return out;
    CFArrayRef descs = CTFontCollectionCreateMatchingFontDescriptors(coll);
    if (descs) {
        CFIndex n = CFArrayGetCount(descs);
        for (CFIndex i = 0; i < n; ++i) {
            auto d = static_cast<CTFontDescriptorRef>(CFArrayGetValueAtIndex(descs, i));
            CFDictionaryRef traits = static_cast<CFDictionaryRef>(CTFontDescriptorCopyAttribute(d, kCTFontTraitsAttribute));
            bool mono = false;
            if (traits) {
                auto sym = static_cast<CFNumberRef>(CFDictionaryGetValue(traits, kCTFontSymbolicTrait));
                uint32_t v = 0;
                if (sym && CFNumberGetValue(sym, kCFNumberSInt32Type, &v)) {
                    mono = (v & kCTFontTraitMonoSpace) != 0;
                }
                CFRelease(traits);
            }
            if (!mono) continue;
            auto fam = static_cast<CFStringRef>(CTFontDescriptorCopyAttribute(d, kCTFontFamilyNameAttribute));
            if (fam) {
                std::string name = cf_to_string(fam);
                CFRelease(fam);
                // Hidden system families start with '.'.
                if (!name.empty() && name[0] != '.') out.push_back(name);
            }
        }
        CFRelease(descs);
    }
    CFRelease(coll);
    return out;
}
#else
inline std::vector<std::string> mono_families() {
    std::vector<std::string> out;
    FILE* p = popen("fc-list :spacing=mono family 2>/dev/null", "r");
    if (!p) return out;
    char line[1024];
    while (fgets(line, sizeof line, p)) {
        std::string s(line);
        while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
        // "Family,Localized Family": keep the first name.
        auto comma = s.find(',');
        if (comma != std::string::npos) s = s.substr(0, comma);
        if (!s.empty()) out.push_back(s);
    }
    pclose(p);
    return out;
}
#endif

} // namespace flint_fonts
