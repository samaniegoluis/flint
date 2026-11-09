// CFIRE-UPSTREAM: CF-081, CF-031
//
// Local socket shim for src/adapters/ipc/ipc.cf: a Unix domain socket the app listens
// on and the CLI connects to, the peer's uid and pid, and length-prefixed frames.
// cfire's ext:net has TCP only (AF_UNIX appears only as a socketpair fallback) and no
// peer credentials (CF-081).
//
// Frames are a 4-byte big-endian length followed by that many bytes. Every read and
// write waits with poll() under a deadline, so no call blocks forever (Principle 8).
#pragma once
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>
#include "flint_sock.hpp"  // windows-port: sockets on POSIX and Windows

#if defined(_WIN32)
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#else
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include <sys/ucred.h>
#endif

namespace flint_ipc {

// Shared by every copy of a listener: set by stop(), read by the accept loop.
struct StopFlag {
    std::atomic<bool> stop{false};
};

#if defined(_WIN32)
// Windows has no uids. A peer is "of our uid" when its process token's user SID is
// ours: own_uid() is 0 and a peer is 0 for the same user, 1 for anyone else.
inline bool process_sid(HANDLE proc, std::wstring& out) {
    HANDLE tok = nullptr;
    if (!::OpenProcessToken(proc, TOKEN_QUERY, &tok)) return false;
    DWORD len = 0;
    ::GetTokenInformation(tok, TokenUser, nullptr, 0, &len);
    std::string buf(len, '\0');
    bool ok = len > 0 && ::GetTokenInformation(tok, TokenUser, buf.data(), len, &len);
    ::CloseHandle(tok);
    if (!ok) return false;
    wchar_t* text = nullptr;
    if (!::ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buf.data())->User.Sid, &text)) return false;
    out = text;
    ::LocalFree(text);
    return true;
}

inline const std::wstring& own_sid() {
    static const std::wstring sid = [] {
        std::wstring s;
        process_sid(::GetCurrentProcess(), s);
        return s;
    }();
    return sid;
}

inline int64_t own_uid() { return 0; }

inline std::wstring wide(const std::string& s) {
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

// An AF_UNIX socket file is a reparse point tagged IO_REPARSE_TAG_AF_UNIX.
// 0 = no file, 1 = a socket file, 2 = some other file.
inline int socket_file_state(const std::string& path) {
    WIN32_FIND_DATAW fd;
    HANDLE h = ::FindFirstFileW(wide(path).c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return 0;
    ::FindClose(h);
    bool sock = (fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) && fd.dwReserved0 == IO_REPARSE_TAG_AF_UNIX;
    return sock ? 1 : 2;
}

// The DACL that stands for mode 0600: protected (nothing inherited), one ACE giving
// the current user full access. Windows AF_UNIX checks write access to the socket
// file on connect, so this keeps other users from reaching the socket at all.
inline bool restrict_to_owner(const std::string& path) {
    std::wstring sddl = L"D:P(A;;FA;;;" + own_sid() + L")";
    PSECURITY_DESCRIPTOR sd = nullptr;
    if (!::ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &sd, nullptr)) return false;
    BOOL ok = ::SetFileSecurityW(wide(path).c_str(), DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, sd);
    ::LocalFree(sd);
    return ok != FALSE;
}

inline bool owner_only(const std::string& path) {
    PACL dacl = nullptr;
    PSECURITY_DESCRIPTOR sd = nullptr;
    if (::GetNamedSecurityInfoW(wide(path).c_str(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &dacl,
                                nullptr, &sd) != ERROR_SUCCESS) {
        return false;
    }
    bool ok = false;
    SECURITY_DESCRIPTOR_CONTROL ctl = 0;
    DWORD rev = 0;
    if (dacl && ::GetSecurityDescriptorControl(sd, &ctl, &rev) && (ctl & SE_DACL_PROTECTED) && dacl->AceCount == 1) {
        void* ace = nullptr;
        if (::GetAce(dacl, 0, &ace) && static_cast<ACE_HEADER*>(ace)->AceType == ACCESS_ALLOWED_ACE_TYPE) {
            PSID sid = &static_cast<ACCESS_ALLOWED_ACE*>(ace)->SidStart;
            wchar_t* text = nullptr;
            if (::ConvertSidToStringSidW(sid, &text)) {
                ok = own_sid() == text;
                ::LocalFree(text);
            }
        }
    }
    ::LocalFree(sd);
    return ok;
}
#else
inline int64_t own_uid() { return static_cast<int64_t>(::getuid()); }
#endif

inline int64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

inline bool fill_addr(const std::string& path, sockaddr_un& addr, std::string& err) {
    std::memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    if (path.empty() || path.size() >= sizeof(addr.sun_path)) {
        err = "the socket path is " + std::to_string(path.size()) + " bytes; the limit is " +
              std::to_string(sizeof(addr.sun_path) - 1);
        return false;
    }
    std::memcpy(addr.sun_path, path.c_str(), path.size() + 1);
    return true;
}

inline void no_sigpipe(int fd) {
#if defined(__APPLE__)
    int one = 1;
    ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#else
    (void)fd;
#endif
}

// Connects to `path`. Returns the descriptor, -2 when nothing listens there (no file,
// or a file nobody accepts on), -1 on any other failure (err says why).
inline int connect_unix(const std::string& path, int timeout_ms, std::string& err) {
    sockaddr_un addr;
    if (!fill_addr(path, addr, err)) return -1;
#if defined(_WIN32)
    if (socket_file_state(path) == 0) return -2;
#endif
    int fd = flint_sock::open(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { err = flint_sock::error_text(flint_sock::last_error()); return -1; }
    no_sigpipe(fd);
    flint_sock::set_nonblocking(fd, true);
    int rc = ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    int e = rc == 0 ? 0 : flint_sock::last_error();
    if (rc != 0 && flint_sock::in_progress(e)) {
        int n = flint_sock::poll_one(fd, POLLOUT, timeout_ms);
        if (n <= 0) { flint_sock::close(fd); err = "timed out connecting to the socket"; return -1; }
        int soerr = 0;
        flint_sock::socklen len = sizeof(soerr);
        ::getsockopt(fd, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&soerr), &len);
        rc = soerr == 0 ? 0 : -1;
        e = soerr;
    }
    if (rc != 0) {
        flint_sock::close(fd);
        if (flint_sock::refused_or_missing(e)) return -2;
        err = flint_sock::error_text(e);
        return -1;
    }
    flint_sock::set_nonblocking(fd, false);
    return fd;
}

// Listens on `path`, mode 0600. A socket file left by a Flint that died is removed;
// a socket another process still accepts on is not (returns -2); any other kind of
// file at that path is never removed (returns -1).
inline int listen_unix(const std::string& path, std::string& err) {
    sockaddr_un addr;
    if (!fill_addr(path, addr, err)) return -1;
#if defined(_WIN32)
    int state = socket_file_state(path);
    if (state == 2) {
        err = "a file that is not a socket is in the way at " + path;
        return -1;
    }
    if (state == 1) {
        std::string ignored;
        int probe = connect_unix(path, 500, ignored);
        if (probe >= 0) { flint_sock::close(probe); err = "another Flint is serving " + path; return -2; }
        ::DeleteFileW(wide(path).c_str());
    }
#else
    struct stat st;
    if (::lstat(path.c_str(), &st) == 0) {
        if (!S_ISSOCK(st.st_mode)) {
            err = "a file that is not a socket is in the way at " + path;
            return -1;
        }
        std::string ignored;
        int probe = connect_unix(path, 500, ignored);
        if (probe >= 0) { ::close(probe); err = "another Flint is serving " + path; return -2; }
        ::unlink(path.c_str());
    }
#endif
    int fd = flint_sock::open(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { err = flint_sock::error_text(flint_sock::last_error()); return -1; }
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        err = std::string("bind: ") + flint_sock::error_text(flint_sock::last_error());
        flint_sock::close(fd);
        return -1;
    }
    // Owner only. The peer uid check on every connection is the gate; the mode keeps
    // other users from even reaching it.
#if defined(_WIN32)
    bool restricted = restrict_to_owner(path);
#else
    bool restricted = ::chmod(path.c_str(), 0600) == 0;
#endif
    if (!restricted || ::listen(fd, 16) != 0) {
        err = restricted ? flint_sock::error_text(flint_sock::last_error()) : "cannot restrict the socket to its owner";
        flint_sock::close(fd);
#if defined(_WIN32)
        ::DeleteFileW(wide(path).c_str());
#else
        ::unlink(path.c_str());
#endif
        return -1;
    }
    flint_sock::set_nonblocking(fd, true);
    return fd;
}

// Waits up to `timeout_ms` for a connection. Returns its descriptor, -2 on timeout,
// -1 on error.
inline int accept_conn(int lfd, int timeout_ms) {
    int n = flint_sock::poll_one(lfd, POLLIN, timeout_ms);
    if (n == 0) return -2;
    if (n < 0) return flint_sock::interrupted(flint_sock::last_error()) ? -2 : -1;
#if defined(_WIN32)
    SOCKET a = ::accept(static_cast<SOCKET>(lfd), nullptr, nullptr);
    int fd = a == INVALID_SOCKET ? -1 : static_cast<int>(a);
#else
    int fd = ::accept(lfd, nullptr, nullptr);
    if (fd >= 0) ::fcntl(fd, F_SETFD, FD_CLOEXEC);
#endif
    if (fd < 0) {
        int e = flint_sock::last_error();
        return (flint_sock::would_block(e) || flint_sock::interrupted(e)) ? -2 : -1;
    }
    no_sigpipe(fd);
    flint_sock::set_nonblocking(fd, false);
    return fd;
}

// The connected peer's uid and pid, from the kernel (not from anything it sent).
inline bool peer_creds(int fd, int64_t& uid, int64_t& pid) {
#if defined(_WIN32)
    ULONG p = 0;
    DWORD got = 0;
    if (::WSAIoctl(static_cast<SOCKET>(fd), SIO_AF_UNIX_GETPEERPID, nullptr, 0, &p, sizeof(p), &got, nullptr, nullptr) != 0) {
        return false;
    }
    HANDLE proc = ::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, p);
    if (!proc) return false;
    std::wstring sid;
    bool ok = process_sid(proc, sid);
    ::CloseHandle(proc);
    if (!ok) return false;
    uid = sid == own_sid() ? 0 : 1;
    pid = static_cast<int64_t>(p);
    return true;
#elif defined(__APPLE__)
    uid_t u = 0;
    gid_t g = 0;
    if (::getpeereid(fd, &u, &g) != 0) return false;
    pid_t p = 0;
    socklen_t len = sizeof(p);
    if (::getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &p, &len) != 0) p = 0;
    uid = static_cast<int64_t>(u);
    pid = static_cast<int64_t>(p);
    return true;
#else
    struct ucred cred;
    socklen_t len = sizeof(cred);
    if (::getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) return false;
    uid = static_cast<int64_t>(cred.uid);
    pid = static_cast<int64_t>(cred.pid);
    return true;
#endif
}

inline bool wait_io(int fd, short events, int64_t deadline) {
    for (;;) {
        int64_t left = deadline - now_ms();
        if (left <= 0) return false;
        int n = flint_sock::poll_one(fd, events, static_cast<int>(left));
        if (n > 0) return true;
        if (n == 0) return false;
        if (!flint_sock::interrupted(flint_sock::last_error())) return false;
    }
}

inline bool write_all(int fd, const char* data, size_t len, int64_t deadline) {
    size_t off = 0;
    while (off < len) {
        if (!wait_io(fd, POLLOUT, deadline)) return false;
        int n = flint_sock::send_some(fd, data + off, len - off);
        if (n < 0) {
            int e = flint_sock::last_error();
            if (flint_sock::interrupted(e) || flint_sock::would_block(e)) continue;
            return false;
        }
        off += static_cast<size_t>(n);
    }
    return true;
}

// 0 = all read, 1 = the peer closed before the first byte, -1 = error or a close in
// the middle, -2 = timed out.
inline int read_all(int fd, char* data, size_t len, int64_t deadline) {
    size_t off = 0;
    while (off < len) {
        if (!wait_io(fd, POLLIN, deadline)) return now_ms() >= deadline ? -2 : -1;
        int n = flint_sock::recv_some(fd, data + off, len - off);
        if (n == 0) return off == 0 ? 1 : -1;
        if (n < 0) {
            int e = flint_sock::last_error();
            if (flint_sock::interrupted(e) || flint_sock::would_block(e)) continue;
            return -1;
        }
        off += static_cast<size_t>(n);
    }
    return 0;
}

inline bool write_frame(int fd, const std::string& payload, int timeout_ms) {
    if (payload.size() > 0xFFFFFFFFull) return false;
    uint32_t n = static_cast<uint32_t>(payload.size());
    unsigned char head[4] = {
        static_cast<unsigned char>(n >> 24), static_cast<unsigned char>(n >> 16),
        static_cast<unsigned char>(n >> 8), static_cast<unsigned char>(n)};
    int64_t deadline = now_ms() + timeout_ms;
    if (!write_all(fd, reinterpret_cast<const char*>(head), 4, deadline)) return false;
    return write_all(fd, payload.data(), payload.size(), deadline);
}

// 0 = a frame, 1 = the peer closed, -1 = error, -2 = timed out, -3 = over `max_len`.
inline int read_frame(int fd, std::string& out, int timeout_ms, size_t max_len) {
    int64_t deadline = now_ms() + timeout_ms;
    unsigned char head[4];
    int rc = read_all(fd, reinterpret_cast<char*>(head), 4, deadline);
    if (rc != 0) return rc;
    size_t n = (static_cast<size_t>(head[0]) << 24) | (static_cast<size_t>(head[1]) << 16) |
               (static_cast<size_t>(head[2]) << 8) | static_cast<size_t>(head[3]);
    if (n > max_len) return -3;
    out.assign(n, '\0');
    if (n == 0) return 0;
    rc = read_all(fd, &out[0], n, deadline);
    return rc == 1 ? -1 : rc;
}

// Whether `fd` has something to read (or the peer hung up) within `timeout_ms`.
inline bool readable(int fd, int timeout_ms) {
    for (;;) {
        int n = flint_sock::poll_one(fd, POLLIN, timeout_ms);
        if (n > 0) return true;
        if (n == 0) return false;
        if (!flint_sock::interrupted(flint_sock::last_error())) return true;
    }
}

inline void close_fd(int fd) { flint_sock::close(fd); }

// Removes `path` only when it is a socket.
inline void unlink_socket(const std::string& path) {
#if defined(_WIN32)
    if (socket_file_state(path) == 1) ::DeleteFileW(wide(path).c_str());
#else
    struct stat st;
    if (::lstat(path.c_str(), &st) == 0 && S_ISSOCK(st.st_mode)) ::unlink(path.c_str());
#endif
}

// The permission bits of `path`, -1 when it does not exist. On Windows: 0600 when the
// file's DACL is the owner-only one listen_unix sets, else 0777 (some wider access).
inline int64_t file_mode(const std::string& path) {
#if defined(_WIN32)
    if (socket_file_state(path) == 0) return -1;
    return owner_only(path) ? 0600 : 0777;
#else
    struct stat st;
    if (::lstat(path.c_str(), &st) != 0) return -1;
    return static_cast<int64_t>(st.st_mode & 07777);
#endif
}

} // namespace flint_ipc
