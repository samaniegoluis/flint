// CFIRE-UPSTREAM: CF-099, CF-139, CF-031
//
// Native shim for flint-vault-server's adapters (milestone 42): an exclusive lock
// folder (core:fs has only mkdir_all, CF-099) and an accepted connection's peer
// address (CF-139). Writes flushed to disk go through core:fs (`File.sync`) since
// cfire 0.12. Kept apart from flint-native, which
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

// Creates `path` as a folder (0700); EXISTS when it is already there (the lock held).
inline int make_dir_exclusive(const std::string& path, std::string& err) {
    if (::mkdir(path.c_str(), 0700) == 0) return OK;
    if (errno == EEXIST) return EXISTS;
    err = std::strerror(errno);
    return FAILURE;
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
