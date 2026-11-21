// The `flint` command's link on the PATH (milestone 48): lstat, readlink, symlink and
// unlink, which core:fs lacks, and on macOS the same through an administrator's
// password for a folder this process cannot write.
// CFIRE-UPSTREAM: CF-171
//
// Windows (milestone 50, CF-178): the user's own Path in HKCU\Environment, read as
// written (RRF_NOEXPAND) and written back as REG_EXPAND_SZ, then announced with
// WM_SETTINGCHANGE so a terminal opened afterwards sees it; and whether a file
// exists, with an entry's %VARIABLES% expanded only to look.
#pragma once
#include <string>
#include <vector>
#if !defined(_WIN32)
#include <cerrno>
#include <cstring>
#include <climits>
#include <cstdlib>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <spawn.h>
extern char** environ;
#else
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace flint_clilink {

struct Probe {
    bool exists = false;
    bool is_link = false;
    std::string target;
    bool target_exists = false;
    bool dir_writable = false;
};

inline std::string parent_of(const std::string& path) {
    auto slash = path.rfind('/');
    return slash == std::string::npos || slash == 0 ? "/" : path.substr(0, slash);
}

#if !defined(_WIN32)
// The nearest folder of `path` that exists: whether a link can be made there without
// an administrator depends on it (~/.local/bin may not exist yet).
inline std::string existing_ancestor(std::string dir) {
    struct stat st{};
    while (dir.size() > 1 && ::stat(dir.c_str(), &st) != 0) dir = parent_of(dir);
    return dir;
}

inline Probe probe(const std::string& path) {
    Probe p;
    struct stat st{};
    if (::lstat(path.c_str(), &st) == 0) {
        p.is_link = S_ISLNK(st.st_mode);
        p.exists = !p.is_link || ::stat(path.c_str(), &st) == 0;
        if (p.is_link) {
            char buf[PATH_MAX];
            ssize_t n = ::readlink(path.c_str(), buf, sizeof buf - 1);
            if (n > 0) {
                buf[n] = 0;
                p.target = buf;
            }
            p.target_exists = p.exists;
        }
    }
    p.dir_writable = ::access(existing_ancestor(parent_of(path)).c_str(), W_OK) == 0;
    return p;
}

inline bool exists(const std::string& path) {
    struct stat st{};
    return ::stat(path.c_str(), &st) == 0;
}

// Runs argv and waits; true on exit 0.
inline bool run(const std::vector<std::string>& args) {
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    pid_t pid = 0;
    if (::posix_spawnp(&pid, argv[0], nullptr, nullptr, argv.data(), environ) != 0) return false;
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

// 'x' → '\'' quoting for sh, then \ and " escaped for an AppleScript string.
inline std::string sh_quote(const std::string& s) {
    std::string out = "'";
    for (char c : s) out += (c == '\'') ? std::string("'\\''") : std::string(1, c);
    return out + "'";
}
inline std::string as_string(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '\\' || c == '"') out += '\\';
        out += c;
    }
    return out + "\"";
}

// macOS's own password dialog runs the command as an administrator; "" when it ran,
// else why not ("cancelled" when the person closed the dialog).
inline std::string run_as_admin(const std::string& command) {
#if defined(__APPLE__)
    std::string script = "do shell script " + as_string(command) + " with administrator privileges";
    return run({"/usr/bin/osascript", "-e", script}) ? "" : "cancelled";
#else
    (void)command;
    return "unsupported";
#endif
}

// "" on success, else the reason.
inline std::string make(const std::string& target, const std::string& path, bool admin) {
    std::string dir = parent_of(path);
    if (admin) {
        return run_as_admin("mkdir -p " + sh_quote(dir) + " && ln -sfn " + sh_quote(target) + " " + sh_quote(path));
    }
    if (!run({"/bin/mkdir", "-p", dir})) return "could not create " + dir;
    // A link next to it, renamed over the old one, so the command never disappears.
    std::string tmp = path + ".flint-new";
    ::unlink(tmp.c_str());
    if (::symlink(target.c_str(), tmp.c_str()) != 0) return std::string("could not link: ") + std::strerror(errno);
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        int e = errno;
        ::unlink(tmp.c_str());
        return std::string("could not link: ") + std::strerror(e);
    }
    return "";
}

inline std::string remove(const std::string& path, bool admin) {
    if (admin) return run_as_admin("rm -f " + sh_quote(path));
    if (::unlink(path.c_str()) != 0 && errno != ENOENT) return std::string("could not remove: ") + std::strerror(errno);
    return "";
}
#else
inline Probe probe(const std::string&) { return Probe{}; }
inline bool exists(const std::string&) { return false; }
inline std::string make(const std::string&, const std::string&, bool) { return "unsupported"; }
inline std::string remove(const std::string&, bool) { return "unsupported"; }
#endif

#if defined(_WIN32)
inline std::wstring widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

inline std::string narrow(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), s.data(), n, nullptr, nullptr);
    return s;
}

inline std::string last_error(const char* what, LSTATUS rc) {
    return std::string(what) + " (error " + std::to_string(static_cast<long>(rc)) + ")";
}

// The Path value under HKCU\<key>, as written. A missing key or value is "" (ok).
inline bool path_read(const std::string& key, std::string& value, std::string& err) {
    std::wstring k = widen(key);
    DWORD bytes = 0;
    LSTATUS rc = ::RegGetValueW(HKEY_CURRENT_USER, k.c_str(), L"Path",
                                RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND, nullptr, nullptr, &bytes);
    if (rc == ERROR_FILE_NOT_FOUND) { value.clear(); return true; }
    if (rc != ERROR_SUCCESS) { err = last_error("could not read the user's Path", rc); return false; }
    std::wstring buf(bytes / sizeof(wchar_t) + 1, L'\0');
    rc = ::RegGetValueW(HKEY_CURRENT_USER, k.c_str(), L"Path",
                        RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND, nullptr, buf.data(), &bytes);
    if (rc != ERROR_SUCCESS) { err = last_error("could not read the user's Path", rc); return false; }
    buf.resize(wcsnlen(buf.c_str(), buf.size()));
    value = narrow(buf);
    return true;
}

// Writes the Path value (removed when empty) and tells running programs, without
// waiting more than two seconds for any window that does not answer.
inline std::string path_write(const std::string& key, const std::string& value) {
    std::wstring k = widen(key);
    HKEY h = nullptr;
    LSTATUS rc = ::RegCreateKeyExW(HKEY_CURRENT_USER, k.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &h, nullptr);
    if (rc != ERROR_SUCCESS) return last_error("could not open the user's environment", rc);
    if (value.empty()) {
        rc = ::RegDeleteValueW(h, L"Path");
        if (rc == ERROR_FILE_NOT_FOUND) rc = ERROR_SUCCESS;
    } else {
        std::wstring w = widen(value);
        rc = ::RegSetValueExW(h, L"Path", 0, REG_EXPAND_SZ, reinterpret_cast<const BYTE*>(w.c_str()),
                              static_cast<DWORD>((w.size() + 1) * sizeof(wchar_t)));
    }
    ::RegCloseKey(h);
    if (rc != ERROR_SUCCESS) return last_error("could not write the user's Path", rc);
    DWORD_PTR result = 0;
    ::SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, reinterpret_cast<LPARAM>(L"Environment"),
                          SMTO_ABORTIFHUNG, 2000, &result);
    return "";
}

inline std::wstring expand(const std::string& entry) {
    std::wstring w = widen(entry);
    DWORD n = ::ExpandEnvironmentStringsW(w.c_str(), nullptr, 0);
    if (n == 0) return w;
    std::wstring out(n, L'\0');
    ::ExpandEnvironmentStringsW(w.c_str(), out.data(), n);
    out.resize(wcsnlen(out.c_str(), out.size()));
    return out;
}

inline bool file_exists_w(const std::wstring& path) {
    DWORD a = ::GetFileAttributesW(path.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

inline bool file_exists(const std::string& path) { return file_exists_w(expand(path)); }

// entry\flint.exe, and the Flint.exe of the folder it sits in.
inline void entry_probe(const std::string& entry, bool& has_cli, bool& has_app) {
    std::wstring e = expand(entry);
    while (e.size() > 3 && (e.back() == L'\\' || e.back() == L'/')) e.pop_back();
    has_cli = file_exists_w(e + L"\\flint.exe");
    has_app = file_exists_w(e + L"\\..\\Flint.exe");
}
#else
inline bool path_read(const std::string&, std::string& value, std::string& err) { value.clear(); err = "unsupported"; return false; }
inline std::string path_write(const std::string&, const std::string&) { return "unsupported"; }
inline bool file_exists(const std::string&) { return false; }
inline void entry_probe(const std::string&, bool& has_cli, bool& has_app) { has_cli = false; has_app = false; }
#endif

}  // namespace flint_clilink
