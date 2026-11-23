// CFIRE-UPSTREAM: CF-175
//
// The self-update's processes (milestone 53, src/adapters/process/update.cf): what
// core:os does not do (CF-175):
// - start a program detached from this one, in a session of its own, its output to a
//   log file or nowhere, and get its pid (os.command waits for it);
// - whether a pid is alive, reaping it when it is our child;
// - which processes run an executable from inside a folder (macOS: libproc; Linux:
//   /proc/<pid>/exe), so update-apply waits for every `flint` from the folder;
// - stopping one, SIGTERM then SIGKILL;
// - a file's mode set executable (the CLI copied out of the package);
// - this process's current directory changed (CF-187: core:os has no chdir).
// Windows (milestone 50, D-118 (5)): the same functions on Win32: CreateProcessW with
// only the log handle inherited, OpenProcess/WaitForSingleObject, a Toolhelp snapshot
// with QueryFullProcessImageNameW, TerminateProcess, MoveFileExW (a folder is only ever
// renamed, never written over) and a tree removal that clears read-only first.
#pragma once
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>
#if !defined(_WIN32)
#include <cerrno>
#include <climits>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <ftw.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <libproc.h>
#else
#include <dirent.h>
#endif
extern char** environ;
#else
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <cwchar>
#endif

namespace flint_update {

// fs.rename, fs.remove and fs.realpath take the coercion of C's rename/remove/realpath
// in a package that includes <stdio.h> (CF-158), and a header with <filesystem> hangs
// `cfire check` (CF-176): the three here, on POSIX calls.
#if !defined(_WIN32)
inline bool upd_rename_path(const std::string& from, const std::string& to, std::string& err) {
    if (::rename(from.c_str(), to.c_str()) == 0) return true;
    err = std::strerror(errno);
    return false;
}

inline int upd_remove_one(const char* path, const struct stat*, int, struct FTW*) {
    return ::remove(path);
}

inline bool upd_remove_tree(const std::string& path, std::string& err) {
    struct stat st;
    if (::lstat(path.c_str(), &st) != 0) return true;
    // nftw on a file (not a folder) fails with ENOTDIR on macOS.
    if (!S_ISDIR(st.st_mode)) {
        if (::remove(path.c_str()) == 0) return true;
        err = std::strerror(errno);
        return false;
    }
    if (::nftw(path.c_str(), upd_remove_one, 32, FTW_DEPTH | FTW_PHYS) == 0) return true;
    err = std::strerror(errno);
    return false;
}

inline std::string upd_real_path(const std::string& path) {
    char buf[PATH_MAX];
    if (::realpath(path.c_str(), buf) == nullptr) return path;
    return std::string(buf);
}
#else
inline std::wstring upd_widen(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    for (auto& c : w) if (c == L'/') c = L'\\';
    return w;
}

inline std::string upd_narrow(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), s.data(), n, nullptr, nullptr);
    return s;
}

inline std::string upd_win_error(DWORD e) {
    wchar_t* msg = nullptr;
    DWORD n = ::FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                               nullptr, e, 0, reinterpret_cast<LPWSTR>(&msg), 0, nullptr);
    std::string out = n && msg ? upd_narrow(std::wstring(msg, n)) : std::string("error");
    if (msg) ::LocalFree(msg);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' ' || out.back() == '.')) out.pop_back();
    return out + " (error " + std::to_string(e) + ")";
}

// A folder (or file) renamed on its volume. ERROR_SHARING_VIOLATION or
// ERROR_ACCESS_DENIED mean something holds a file inside it open; the caller retries
// for a while (application/update_apply.cf) and otherwise puts things back.
inline bool upd_rename_path(const std::string& from, const std::string& to, std::string& err) {
    if (::MoveFileExW(upd_widen(from).c_str(), upd_widen(to).c_str(), 0)) return true;
    err = upd_win_error(::GetLastError());
    return false;
}

inline bool upd_remove_tree_w(const std::wstring& path, std::string& err) {
    DWORD a = ::GetFileAttributesW(path.c_str());
    if (a == INVALID_FILE_ATTRIBUTES) return true;
    if (a & FILE_ATTRIBUTE_READONLY) ::SetFileAttributesW(path.c_str(), a & ~FILE_ATTRIBUTE_READONLY);
    // A link or junction is removed itself, never followed.
    if ((a & FILE_ATTRIBUTE_DIRECTORY) && !(a & FILE_ATTRIBUTE_REPARSE_POINT)) {
        WIN32_FIND_DATAW fd;
        HANDLE h = ::FindFirstFileW((path + L"\\*").c_str(), &fd);
        if (h != INVALID_HANDLE_VALUE) {
            do {
                if (std::wcscmp(fd.cFileName, L".") == 0 || std::wcscmp(fd.cFileName, L"..") == 0) continue;
                if (!upd_remove_tree_w(path + L"\\" + fd.cFileName, err)) { ::FindClose(h); return false; }
            } while (::FindNextFileW(h, &fd));
            ::FindClose(h);
        }
        if (::RemoveDirectoryW(path.c_str())) return true;
    } else if (a & FILE_ATTRIBUTE_DIRECTORY) {
        if (::RemoveDirectoryW(path.c_str())) return true;
    } else if (::DeleteFileW(path.c_str())) {
        return true;
    }
    err = upd_win_error(::GetLastError());
    return false;
}

inline bool upd_remove_tree(const std::string& path, std::string& err) {
    return upd_remove_tree_w(upd_widen(path), err);
}

// The full path, backslashes, as processes report theirs (compared without case).
inline std::string upd_real_path(const std::string& path) {
    std::wstring w = upd_widen(path);
    wchar_t buf[MAX_PATH * 4];
    DWORD n = ::GetFullPathNameW(w.c_str(), static_cast<DWORD>(sizeof buf / sizeof buf[0]), buf, nullptr);
    if (n == 0 || n >= sizeof buf / sizeof buf[0]) return path;
    return upd_narrow(std::wstring(buf, n));
}
#endif

#if !defined(_WIN32)

// Starts `exe` with `args` in a new session, stdin from /dev/null, stdout and stderr to
// `log` (appended) or /dev/null. Returns its pid, or -errno.
inline std::int64_t upd_spawn_detached(const std::string& exe, const std::vector<std::string>& args,
                                   const std::string& log) {
    posix_spawn_file_actions_t fa;
    posix_spawnattr_t at;
    posix_spawn_file_actions_init(&fa);
    posix_spawnattr_init(&at);
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    const char* out = log.empty() ? "/dev/null" : log.c_str();
    posix_spawn_file_actions_addopen(&fa, 1, out, O_WRONLY | O_CREAT | O_APPEND, 0600);
    posix_spawn_file_actions_adddup2(&fa, 1, 2);
    short flags = POSIX_SPAWN_SETSID;
    posix_spawnattr_setflags(&at, flags);
    std::vector<char*> argv;
    argv.push_back(const_cast<char*>(exe.c_str()));
    for (const auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    pid_t pid = 0;
    int rc = posix_spawn(&pid, exe.c_str(), &fa, &at, argv.data(), environ);
    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&at);
    if (rc != 0) return -static_cast<std::int64_t>(rc);
    return static_cast<std::int64_t>(pid);
}

inline bool upd_alive(std::int64_t pid) {
    if (pid <= 0) return false;
    int status = 0;
    // Our own child that exited is reaped here, so it reads as gone, not as a zombie.
    pid_t r = waitpid(static_cast<pid_t>(pid), &status, WNOHANG);
    if (r == static_cast<pid_t>(pid)) return false;
    if (::kill(static_cast<pid_t>(pid), 0) == 0) return true;
    return errno == EPERM;
}

inline void upd_stop(std::int64_t pid) {
    if (pid <= 0) return;
    ::kill(static_cast<pid_t>(pid), SIGTERM);
    for (int i = 0; i < 50 && upd_alive(pid); ++i) usleep(100000);
    if (upd_alive(pid)) ::kill(static_cast<pid_t>(pid), SIGKILL);
    int status = 0;
    waitpid(static_cast<pid_t>(pid), &status, WNOHANG);
}

inline bool upd_inside(const std::string& path, const std::string& dir) {
    return path.size() > dir.size() && path.compare(0, dir.size(), dir) == 0 && path[dir.size()] == '/';
}

// Every process but this one whose executable lies inside `dir` (a real path).
inline std::vector<std::int64_t> upd_running_under(const std::string& dir) {
    std::vector<std::int64_t> out;
    pid_t self = getpid();
#if defined(__APPLE__)
    int n = proc_listallpids(nullptr, 0);
    if (n <= 0) return out;
    std::vector<pid_t> pids(static_cast<size_t>(n) + 64);
    n = proc_listallpids(pids.data(), static_cast<int>(pids.size() * sizeof(pid_t)));
    char buf[PROC_PIDPATHINFO_MAXSIZE];
    for (int i = 0; i < n; ++i) {
        if (pids[i] <= 0 || pids[i] == self) continue;
        if (proc_pidpath(pids[i], buf, sizeof buf) <= 0) continue;
        if (upd_inside(buf, dir)) out.push_back(pids[i]);
    }
#else
    DIR* d = opendir("/proc");
    if (!d) return out;
    while (dirent* e = readdir(d)) {
        char* end = nullptr;
        long pid = std::strtol(e->d_name, &end, 10);
        if (!end || *end != 0 || pid <= 0 || pid == self) continue;
        std::string link = std::string("/proc/") + e->d_name + "/exe";
        char buf[PATH_MAX];
        ssize_t len = readlink(link.c_str(), buf, sizeof buf - 1);
        if (len <= 0) continue;
        buf[len] = 0;
        if (upd_inside(buf, dir)) out.push_back(pid);
    }
    closedir(d);
#endif
    return out;
}

inline bool upd_make_executable(const std::string& path) {
    return ::chmod(path.c_str(), 0755) == 0;
}

// Makes `dir` this process's current directory (CF-187: core:os has cwd(), no chdir).
inline bool upd_set_cwd(const std::string& dir) {
    return ::chdir(dir.c_str()) == 0;
}

#else

// One argument quoted as the C runtime's command-line parser reads it back.
inline void upd_quote_arg(std::wstring& cmd, const std::wstring& a) {
    if (!a.empty() && a.find_first_of(L" \t\n\v\"") == std::wstring::npos) { cmd += a; return; }
    cmd += L'"';
    for (size_t i = 0; i < a.size(); ++i) {
        size_t bs = 0;
        while (i < a.size() && a[i] == L'\\') { ++bs; ++i; }
        if (i == a.size()) { cmd.append(bs * 2, L'\\'); break; }
        if (a[i] == L'"') { cmd.append(bs * 2 + 1, L'\\'); cmd += L'"'; }
        else { cmd.append(bs, L'\\'); cmd += a[i]; }
    }
    cmd += L'"';
}

// Starts `exe` with `args` detached (no console, its own process group), in `exe`'s own
// folder, stdout and stderr appended to `log` (or nowhere), inheriting that one handle
// and nothing else.
// Returns its pid, or -GetLastError().
inline std::int64_t upd_spawn_detached(const std::string& exe, const std::vector<std::string>& args,
                                       const std::string& log) {
    std::wstring wexe = upd_widen(exe);
    std::wstring cmd;
    upd_quote_arg(cmd, wexe);
    for (const auto& a : args) { cmd += L' '; upd_quote_arg(cmd, upd_widen(a)); }
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE out = ::CreateFileW(log.empty() ? L"NUL" : upd_widen(log).c_str(), FILE_APPEND_DATA,
                               FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, &sa, OPEN_ALWAYS,
                               FILE_ATTRIBUTE_NORMAL, nullptr);
    HANDLE in = ::CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr);
    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof si;
    SIZE_T size = 0;
    ::InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
    std::vector<unsigned char> attrs(size);
    auto* list = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attrs.data());
    HANDLE inherit[2] = {in, out};
    bool have_list = ::InitializeProcThreadAttributeList(list, 1, 0, &size) &&
        in != INVALID_HANDLE_VALUE && out != INVALID_HANDLE_VALUE &&
        ::UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit, sizeof inherit, nullptr, nullptr);
    if (have_list) {
        si.lpAttributeList = list;
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = in;
        si.StartupInfo.hStdOutput = out;
        si.StartupInfo.hStdError = out;
    }
    PROCESS_INFORMATION pi{};
    DWORD flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT |
                  (have_list ? EXTENDED_STARTUPINFO_PRESENT : 0);
    // It starts in its own folder, never in this process's current directory: that may be
    // the installed folder update-apply must rename (a Start menu shortcut starts Flint
    // there), and a folder that is a process's current directory cannot be renamed.
    std::wstring wdir = wexe;
    size_t cut = wdir.find_last_of(L"/\\");
    wdir = cut == std::wstring::npos ? std::wstring() : wdir.substr(0, cut);
    BOOL ok = ::CreateProcessW(wexe.c_str(), cmd.data(), nullptr, nullptr, have_list ? TRUE : FALSE, flags,
                               nullptr, wdir.empty() ? nullptr : wdir.c_str(), &si.StartupInfo, &pi);
    DWORD e = ok ? 0 : ::GetLastError();
    if (have_list) ::DeleteProcThreadAttributeList(list);
    if (in != INVALID_HANDLE_VALUE) ::CloseHandle(in);
    if (out != INVALID_HANDLE_VALUE) ::CloseHandle(out);
    if (!ok) return -static_cast<std::int64_t>(e ? e : 1);
    ::CloseHandle(pi.hThread);
    ::CloseHandle(pi.hProcess);
    return static_cast<std::int64_t>(pi.dwProcessId);
}

inline bool upd_alive(std::int64_t pid) {
    if (pid <= 0) return false;
    HANDLE h = ::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (!h) return ::GetLastError() == ERROR_ACCESS_DENIED;
    bool alive = ::WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
    ::CloseHandle(h);
    return alive;
}

// Windows has no SIGTERM for a windowed program: it is ended, then waited for up to
// five seconds so its files are released.
inline void upd_stop(std::int64_t pid) {
    if (pid <= 0) return;
    HANDLE h = ::OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, static_cast<DWORD>(pid));
    if (!h) return;
    ::TerminateProcess(h, 1);
    ::WaitForSingleObject(h, 5000);
    ::CloseHandle(h);
}

inline std::wstring upd_fold(std::wstring p) {
    for (auto& c : p) { if (c == L'/') c = L'\\'; c = static_cast<wchar_t>(::towlower(c)); }
    return p;
}

// Every process but this one whose executable lies inside `dir` (compared without case).
inline std::vector<std::int64_t> upd_running_under(const std::string& dir) {
    std::vector<std::int64_t> out;
    std::wstring d = upd_fold(upd_widen(dir));
    while (d.size() > 3 && d.back() == L'\\') d.pop_back();
    DWORD self = ::GetCurrentProcessId();
    HANDLE snap = ::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return out;
    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof pe;
    for (BOOL more = ::Process32FirstW(snap, &pe); more; more = ::Process32NextW(snap, &pe)) {
        if (pe.th32ProcessID == 0 || pe.th32ProcessID == self) continue;
        HANDLE h = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
        if (!h) continue;
        wchar_t buf[MAX_PATH * 4];
        DWORD n = static_cast<DWORD>(sizeof buf / sizeof buf[0]);
        if (::QueryFullProcessImageNameW(h, 0, buf, &n)) {
            std::wstring p = upd_fold(std::wstring(buf, n));
            if (p.size() > d.size() && p.compare(0, d.size(), d) == 0 && p[d.size()] == L'\\') {
                out.push_back(static_cast<std::int64_t>(pe.th32ProcessID));
            }
        }
        ::CloseHandle(h);
    }
    ::CloseHandle(snap);
    return out;
}

inline bool upd_make_executable(const std::string&) { return true; }

// Makes `dir` this process's current directory (CF-187), which releases the handle
// Windows keeps on the one before: a folder that is some process's current directory
// cannot be renamed (error 32).
inline bool upd_set_cwd(const std::string& dir) {
    return ::SetCurrentDirectoryW(upd_widen(dir).c_str()) != 0;
}

#endif

}  // namespace flint_update
