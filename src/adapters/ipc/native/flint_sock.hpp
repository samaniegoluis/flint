// CFIRE-UPSTREAM: CF-081, CF-031
//
// Socket primitives shared by the IPC and SSH shims, the same on POSIX and Windows
// (windows-port branch). Windows sockets are not file descriptors: they close with
// closesocket, poll with WSAPoll, report errors through WSAGetLastError and have no
// socketpair. Descriptors stay `int` as in the rest of the shims; a SOCKET value fits
// (Windows hands out small handle values, and the shims already treat -1 as "none").
#pragma once
#include <cerrno>
#include <cstring>
#include <string>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#include <afunix.h>
#else
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace flint_sock {

#if defined(_WIN32)
using socklen = int;

// WSAStartup once per process. libssh does its own; the IPC socket may come first.
inline bool init() {
    static const bool ok = [] {
        WSADATA d;
        return ::WSAStartup(MAKEWORD(2, 2), &d) == 0;
    }();
    return ok;
}

inline int last_error() { return ::WSAGetLastError(); }
inline bool in_progress(int e) { return e == WSAEWOULDBLOCK || e == WSAEINPROGRESS; }
inline bool would_block(int e) { return e == WSAEWOULDBLOCK; }
inline bool interrupted(int e) { return e == WSAEINTR; }
inline bool refused_or_missing(int e) {
    return e == WSAECONNREFUSED || e == WSAENOTSOCK || e == WSAEADDRNOTAVAIL ||
           e == static_cast<int>(ERROR_FILE_NOT_FOUND) || e == WSAENETUNREACH;
}
inline constexpr int kTimedOut = WSAETIMEDOUT;

inline std::string error_text(int e) {
    wchar_t* buf = nullptr;
    DWORD n = ::FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                               nullptr, static_cast<DWORD>(e), 0, reinterpret_cast<wchar_t*>(&buf), 0, nullptr);
    std::string out;
    if (n && buf) {
        int len = ::WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(n), nullptr, 0, nullptr, nullptr);
        out.resize(static_cast<size_t>(len));
        ::WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(n), out.data(), len, nullptr, nullptr);
        while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' ' || out.back() == '.')) out.pop_back();
    }
    if (buf) ::LocalFree(buf);
    return out.empty() ? "socket error " + std::to_string(e) : out;
}

inline int open(int family, int type, int proto) {
    init();
    SOCKET s = ::WSASocketW(family, type, proto, nullptr, 0, WSA_FLAG_NO_HANDLE_INHERIT);
    return s == INVALID_SOCKET ? -1 : static_cast<int>(s);
}
inline void close(int fd) {
    if (fd >= 0) ::closesocket(static_cast<SOCKET>(fd));
}
inline void set_nonblocking(int fd, bool on) {
    u_long v = on ? 1 : 0;
    ::ioctlsocket(static_cast<SOCKET>(fd), FIONBIO, &v);
}
inline int poll_one(int fd, short events, int timeout_ms, short* revents = nullptr) {
    WSAPOLLFD p{static_cast<SOCKET>(fd), events, 0};
    int n = ::WSAPoll(&p, 1, timeout_ms);
    if (revents) *revents = p.revents;
    return n;
}
inline void shutdown_both(int fd) { ::shutdown(static_cast<SOCKET>(fd), SD_BOTH); }
inline int send_some(int fd, const char* d, size_t n) { return ::send(static_cast<SOCKET>(fd), d, static_cast<int>(n), 0); }
inline int recv_some(int fd, char* d, size_t n) { return ::recv(static_cast<SOCKET>(fd), d, static_cast<int>(n), 0); }

// A connected pair over loopback TCP: Windows has no socketpair. The listener binds
// 127.0.0.1 on an ephemeral port and is closed as soon as the pair is made.
inline int pair(int fds[2]) {
    int l = open(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (l < 0) return -1;
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int alen = sizeof a;
    int c = -1, s = -1;
    if (::bind(static_cast<SOCKET>(l), reinterpret_cast<sockaddr*>(&a), alen) == 0 &&
        ::getsockname(static_cast<SOCKET>(l), reinterpret_cast<sockaddr*>(&a), &alen) == 0 &&
        ::listen(static_cast<SOCKET>(l), 1) == 0 && (c = open(AF_INET, SOCK_STREAM, IPPROTO_TCP)) >= 0 &&
        ::connect(static_cast<SOCKET>(c), reinterpret_cast<sockaddr*>(&a), alen) == 0) {
        SOCKET acc = ::accept(static_cast<SOCKET>(l), nullptr, nullptr);
        if (acc != INVALID_SOCKET) s = static_cast<int>(acc);
    }
    close(l);
    if (s < 0) {
        close(c);
        return -1;
    }
    fds[0] = s;
    fds[1] = c;
    return 0;
}
#else
using socklen = socklen_t;

inline bool init() { return true; }
inline int last_error() { return errno; }
inline bool in_progress(int e) { return e == EINPROGRESS; }
inline bool would_block(int e) { return e == EAGAIN || e == EWOULDBLOCK; }
inline bool interrupted(int e) { return e == EINTR; }
inline bool refused_or_missing(int e) { return e == ENOENT || e == ECONNREFUSED || e == ENOTSOCK; }
inline constexpr int kTimedOut = ETIMEDOUT;
inline std::string error_text(int e) { return std::strerror(e); }

inline int open(int family, int type, int proto) {
    int fd = ::socket(family, type, proto);
    if (fd >= 0) ::fcntl(fd, F_SETFD, FD_CLOEXEC);
    return fd;
}
inline void close(int fd) {
    if (fd >= 0) ::close(fd);
}
inline void set_nonblocking(int fd, bool on) {
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, on ? (flags | O_NONBLOCK) : (flags & ~O_NONBLOCK));
}
inline int poll_one(int fd, short events, int timeout_ms, short* revents = nullptr) {
    pollfd p{fd, events, 0};
    int n = ::poll(&p, 1, timeout_ms);
    if (revents) *revents = p.revents;
    return n;
}
inline void shutdown_both(int fd) { ::shutdown(fd, SHUT_RDWR); }
inline int send_some(int fd, const char* d, size_t n) {
#if defined(__APPLE__)
    return static_cast<int>(::send(fd, d, n, 0));
#else
    return static_cast<int>(::send(fd, d, n, MSG_NOSIGNAL));
#endif
}
inline int recv_some(int fd, char* d, size_t n) { return static_cast<int>(::recv(fd, d, n, 0)); }
inline int pair(int fds[2]) { return ::socketpair(AF_UNIX, SOCK_STREAM, 0, fds); }
#endif

}  // namespace flint_sock
