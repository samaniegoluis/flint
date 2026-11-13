// CFIRE-UPSTREAM: CF-139, CF-143, CF-031
//
// Native shim for flint-vault-server's adapters (milestone 42): a write flushed to
// disk before it is renamed into place (core:fs has no fsync and `File.flush` does
// nothing, CF-143), a folder flushed after a rename, an exclusive lock folder, and an
// accepted connection's peer address (CF-139). Kept apart from flint-native, which
// requires libssh: the server links libsodium alone.
#pragma once
#include <arpa/inet.h>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <netinet/in.h>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

namespace flint_server {

constexpr int OK = 0;
constexpr int EXISTS = 3;
constexpr int FAILURE = 4;

// Writes `data` to `path` (created 0600, truncated), flushed to disk before close.
inline int write_synced(const std::string& path, const std::string& data, std::string& err) {
    int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
        err = std::strerror(errno);
        return FAILURE;
    }
    size_t done = 0;
    while (done < data.size()) {
        ssize_t n = ::write(fd, data.data() + done, data.size() - done);
        if (n < 0) {
            if (errno == EINTR) continue;
            err = std::strerror(errno);
            ::close(fd);
            return FAILURE;
        }
        done += static_cast<size_t>(n);
    }
    if (::fsync(fd) != 0) {
        err = std::strerror(errno);
        ::close(fd);
        return FAILURE;
    }
    if (::close(fd) != 0) {
        err = std::strerror(errno);
        return FAILURE;
    }
    return OK;
}

// Flushes a folder, so a rename into it is on disk.
inline int sync_dir(const std::string& path, std::string& err) {
    int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        err = std::strerror(errno);
        return FAILURE;
    }
    int rc = ::fsync(fd) == 0 ? OK : FAILURE;
    if (rc != OK) err = std::strerror(errno);
    ::close(fd);
    return rc;
}

// Creates `path` as a folder (0700); EXISTS when it is already there (the lock held).
inline int make_dir_exclusive(const std::string& path, std::string& err) {
    if (::mkdir(path.c_str(), 0700) == 0) return OK;
    if (errno == EEXIST) return EXISTS;
    err = std::strerror(errno);
    return FAILURE;
}

// A path's modification time in Unix milliseconds, or -1.
inline int64_t mtime_ms(const std::string& path) {
    struct stat st;
    if (::stat(path.c_str(), &st) != 0) return -1;
#if defined(__APPLE__)
    return static_cast<int64_t>(st.st_mtimespec.tv_sec) * 1000 + st.st_mtimespec.tv_nsec / 1000000;
#else
    return static_cast<int64_t>(st.st_mtim.tv_sec) * 1000 + st.st_mtim.tv_nsec / 1000000;
#endif
}

// The address of the other end of a connected socket ("203.0.113.5", "::1"), or "".
inline std::string peer_address(int fd) {
    sockaddr_storage ss{};
    socklen_t len = sizeof(ss);
    if (fd < 0 || ::getpeername(fd, reinterpret_cast<sockaddr*>(&ss), &len) != 0) return "";
    char buf[INET6_ADDRSTRLEN] = {0};
    if (ss.ss_family == AF_INET) {
        auto* a = reinterpret_cast<sockaddr_in*>(&ss);
        if (!::inet_ntop(AF_INET, &a->sin_addr, buf, sizeof(buf))) return "";
    } else if (ss.ss_family == AF_INET6) {
        auto* a = reinterpret_cast<sockaddr_in6*>(&ss);
        if (!::inet_ntop(AF_INET6, &a->sin6_addr, buf, sizeof(buf))) return "";
    } else {
        return "local";
    }
    return std::string(buf);
}

} // namespace flint_server
