// CFIRE-UPSTREAM: CF-092, CF-031
//
// Who is on the other end of the socket (src/adapters/ipc/peer.cf): for a pid, its
// parent pid, its start time, the executable the kernel ran and its argv[0]. cfire's
// core:os knows only its own process (CF-092).
//
// macOS: proc_pidinfo(PROC_PIDTBSDINFO) and proc_pidpath; argv[0] from
// sysctl(KERN_PROCARGS2). Linux: /proc/<pid>/stat, /proc/<pid>/exe, /proc/<pid>/cmdline.
// The start time pins a pid: a pid reused by another process has another start time.
#pragma once
#include <cstdint>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <tlhelp32.h>
#else
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#endif

namespace flint_peer {

struct Info {
    int64_t ppid = 0;
    int64_t started = 0;   // macOS: microseconds since the epoch; Linux: clock ticks since boot
    std::string exe;
    std::string argv0;
};

#if defined(__APPLE__)

inline std::string argv0_of(int64_t pid) {
    int mib[3] = {CTL_KERN, KERN_PROCARGS2, static_cast<int>(pid)};
    size_t size = 0;
    if (::sysctl(mib, 3, nullptr, &size, nullptr, 0) != 0 || size < sizeof(int)) return "";
    std::vector<char> buf(size);
    if (::sysctl(mib, 3, buf.data(), &size, nullptr, 0) != 0 || size < sizeof(int)) return "";
    // argc, then the exec path, NUL padding, then argv[0].
    size_t i = sizeof(int);
    while (i < size && buf[i] != '\0') i++;
    while (i < size && buf[i] == '\0') i++;
    size_t start = i;
    while (i < size && buf[i] != '\0') i++;
    return start < size ? std::string(buf.data() + start, i - start) : "";
}

// Fills `out` for `pid`; false when the process is gone or not ours to read.
inline bool info(int64_t pid, Info& out) {
    if (pid <= 0) return false;
    struct proc_bsdinfo bi;
    int n = ::proc_pidinfo(static_cast<int>(pid), PROC_PIDTBSDINFO, 0, &bi, sizeof(bi));
    if (n != static_cast<int>(sizeof(bi))) return false;
    out.ppid = static_cast<int64_t>(bi.pbi_ppid);
    out.started = static_cast<int64_t>(bi.pbi_start_tvsec) * 1000000 + static_cast<int64_t>(bi.pbi_start_tvusec);
    char path[PROC_PIDPATHINFO_MAXSIZE];
    int len = ::proc_pidpath(static_cast<int>(pid), path, sizeof(path));
    out.exe = len > 0 ? std::string(path, static_cast<size_t>(len)) : "";
    out.argv0 = argv0_of(pid);
    return true;
}

#elif defined(_WIN32)

// Windows (windows-port): the parent pid from a Toolhelp snapshot, the creation time
// (100 ns since 1601) from GetProcessTimes, the image path from
// QueryFullProcessImageNameW. argv[0] would mean reading another process's PEB; the
// image path stands in for it, which is what a caller check compares anyway.
inline std::string utf8(const wchar_t* w, int n) {
    int len = ::WideCharToMultiByte(CP_UTF8, 0, w, n, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(len), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, w, n, s.data(), len, nullptr, nullptr);
    return s;
}

inline bool info(int64_t pid, Info& out) {
    if (pid <= 0) return false;
    HANDLE proc = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
    if (!proc) return false;
    FILETIME created{}, exited{}, kernel{}, user{};
    bool ok = ::GetProcessTimes(proc, &created, &exited, &kernel, &user) != FALSE;
    if (ok) out.started = (static_cast<int64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    wchar_t path[32768];
    DWORD len = sizeof(path) / sizeof(path[0]);
    out.exe = ::QueryFullProcessImageNameW(proc, 0, path, &len) ? utf8(path, static_cast<int>(len)) : "";
    ::CloseHandle(proc);
    if (!ok) return false;
    out.argv0 = out.exe;
    out.ppid = 0;
    HANDLE snap = ::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W pe{};
        pe.dwSize = sizeof(pe);
        for (BOOL more = ::Process32FirstW(snap, &pe); more; more = ::Process32NextW(snap, &pe)) {
            if (static_cast<int64_t>(pe.th32ProcessID) == pid) {
                out.ppid = static_cast<int64_t>(pe.th32ParentProcessID);
                break;
            }
        }
        ::CloseHandle(snap);
    }
    return true;
}

#else

inline bool info(int64_t pid, Info& out) {
    if (pid <= 0) return false;
    std::string base = "/proc/" + std::to_string(pid);
    std::ifstream stat(base + "/stat");
    std::string line;
    if (!stat || !std::getline(stat, line)) return false;
    // "pid (comm) state ppid ...": comm may hold spaces and parentheses, so read
    // after the last ')'.
    size_t close = line.rfind(')');
    if (close == std::string::npos) return false;
    std::istringstream rest(line.substr(close + 1));
    std::vector<std::string> f;
    std::string tok;
    while (rest >> tok) f.push_back(tok);
    // f[0] is field 3 (state); ppid is field 4, starttime field 22.
    if (f.size() < 20) return false;
    out.ppid = std::stoll(f[1]);
    out.started = std::stoll(f[19]);
    char path[4096];
    ssize_t len = ::readlink((base + "/exe").c_str(), path, sizeof(path) - 1);
    out.exe = len > 0 ? std::string(path, static_cast<size_t>(len)) : "";
    std::ifstream cmd(base + "/cmdline", std::ios::binary);
    std::string a0;
    if (cmd) std::getline(cmd, a0, '\0');
    out.argv0 = a0;
    return true;
}

#endif

}  // namespace flint_peer
