// CFIRE-UPSTREAM: CF-099, CF-031
//
// Native shim for flint-vault-server's store (milestone 42): an exclusive lock folder
// (core:fs has only mkdir_all, CF-099). Since cfire 0.12, writes flushed to disk go
// through core:fs (`File.sync`) and the peer address through `TcpConn.remote_addr`.
// Kept apart from flint-native, which requires libssh: the server links libsodium
// alone.
#pragma once
#include <cerrno>
#include <cstring>
#include <string>
#include <sys/stat.h>

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

} // namespace flint_server
