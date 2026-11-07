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
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <sys/ucred.h>
#endif

namespace flint_ipc {

// Shared by every copy of a listener: set by stop(), read by the accept loop.
struct StopFlag {
    std::atomic<bool> stop{false};
};

inline int64_t own_uid() { return static_cast<int64_t>(::getuid()); }

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

inline void set_cloexec(int fd) { ::fcntl(fd, F_SETFD, FD_CLOEXEC); }

// Connects to `path`. Returns the descriptor, -2 when nothing listens there (no file,
// or a file nobody accepts on), -1 on any other failure (err says why).
inline int connect_unix(const std::string& path, int timeout_ms, std::string& err) {
    sockaddr_un addr;
    if (!fill_addr(path, addr, err)) return -1;
    int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { err = std::strerror(errno); return -1; }
    set_cloexec(fd);
    no_sigpipe(fd);
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    int rc = ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    if (rc != 0 && errno == EINPROGRESS) {
        pollfd p{fd, POLLOUT, 0};
        int n = ::poll(&p, 1, timeout_ms);
        if (n <= 0) { ::close(fd); err = "timed out connecting to the socket"; return -1; }
        int soerr = 0;
        socklen_t len = sizeof(soerr);
        ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &len);
        if (soerr != 0) { errno = soerr; rc = -1; } else { rc = 0; }
    }
    if (rc != 0) {
        int e = errno;
        ::close(fd);
        if (e == ENOENT || e == ECONNREFUSED || e == ENOTSOCK) return -2;
        err = std::strerror(e);
        return -1;
    }
    ::fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
    return fd;
}

// Listens on `path`, mode 0600. A socket file left by a Flint that died is removed;
// a socket another process still accepts on is not (returns -2); any other kind of
// file at that path is never removed (returns -1).
inline int listen_unix(const std::string& path, std::string& err) {
    sockaddr_un addr;
    if (!fill_addr(path, addr, err)) return -1;
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
    int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { err = std::strerror(errno); return -1; }
    set_cloexec(fd);
    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        err = std::string("bind: ") + std::strerror(errno);
        ::close(fd);
        return -1;
    }
    // Owner only. The peer uid check on every connection is the gate; the mode keeps
    // other users from even reaching it.
    if (::chmod(path.c_str(), 0600) != 0 || ::listen(fd, 16) != 0) {
        err = std::strerror(errno);
        ::close(fd);
        ::unlink(path.c_str());
        return -1;
    }
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    return fd;
}

// Waits up to `timeout_ms` for a connection. Returns its descriptor, -2 on timeout,
// -1 on error.
inline int accept_conn(int lfd, int timeout_ms) {
    pollfd p{lfd, POLLIN, 0};
    int n = ::poll(&p, 1, timeout_ms);
    if (n == 0) return -2;
    if (n < 0) return errno == EINTR ? -2 : -1;
    int fd = ::accept(lfd, nullptr, nullptr);
    if (fd < 0) return (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) ? -2 : -1;
    set_cloexec(fd);
    no_sigpipe(fd);
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
    return fd;
}

// The connected peer's uid and pid, from the kernel (not from anything it sent).
inline bool peer_creds(int fd, int64_t& uid, int64_t& pid) {
#if defined(__APPLE__)
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
        pollfd p{fd, events, 0};
        int n = ::poll(&p, 1, static_cast<int>(left));
        if (n > 0) return true;
        if (n == 0) return false;
        if (errno != EINTR) return false;
    }
}

inline bool write_all(int fd, const char* data, size_t len, int64_t deadline) {
    size_t off = 0;
    while (off < len) {
        if (!wait_io(fd, POLLOUT, deadline)) return false;
#if defined(__APPLE__)
        ssize_t n = ::send(fd, data + off, len - off, 0);
#else
        ssize_t n = ::send(fd, data + off, len - off, MSG_NOSIGNAL);
#endif
        if (n < 0) {
            if (errno == EINTR || errno == EAGAIN) continue;
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
        ssize_t n = ::recv(fd, data + off, len - off, 0);
        if (n == 0) return off == 0 ? 1 : -1;
        if (n < 0) {
            if (errno == EINTR || errno == EAGAIN) continue;
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
    pollfd p{fd, POLLIN, 0};
    for (;;) {
        int n = ::poll(&p, 1, timeout_ms);
        if (n > 0) return true;
        if (n == 0) return false;
        if (errno != EINTR) return true;
    }
}

inline void close_fd(int fd) {
    if (fd >= 0) ::close(fd);
}

// Removes `path` only when it is a socket.
inline void unlink_socket(const std::string& path) {
    struct stat st;
    if (::lstat(path.c_str(), &st) == 0 && S_ISSOCK(st.st_mode)) ::unlink(path.c_str());
}

inline int64_t file_mode(const std::string& path) {
    struct stat st;
    if (::lstat(path.c_str(), &st) != 0) return -1;
    return static_cast<int64_t>(st.st_mode & 07777);
}

} // namespace flint_ipc
