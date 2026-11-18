// CFIRE-UPSTREAM: CF-099, CF-031
//
// Native shim for flint-vault-server's store (milestone 42): an exclusive lock folder
// (core:fs has only mkdir_all, CF-099). Since cfire 0.12, writes flushed to disk go
// through core:fs (`File.sync`) and the peer address through `TcpConn.remote_addr`.
// Kept apart from flint-native, which requires libssh: the server links libsodium
// alone. The server ships for Linux; the Windows branch lets the Windows test VM run
// server-e2e and sync-e2e against a server of its own (cfire migration, step 6).
#pragma once
#include <cerrno>
#include <cstring>
#include <string>
#if defined(_WIN32)
#include <windows.h>
#else
#include <sys/stat.h>
#endif

namespace flint_server {

constexpr int OK = 0;
constexpr int EXISTS = 3;
constexpr int FAILURE = 4;

// Creates `path` as a folder (0700); EXISTS when it is already there (the lock held).
inline int make_dir_exclusive(const std::string& path, std::string& err) {
#if defined(_WIN32)
    // No mode: the folder takes the data folder's ACL. UTF-8 to the wide API.
    int n = ::MultiByteToWideChar(CP_UTF8, 0, path.data(), static_cast<int>(path.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, path.data(), static_cast<int>(path.size()), w.data(), n);
    if (::CreateDirectoryW(w.c_str(), nullptr)) return OK;
    DWORD e = ::GetLastError();
    if (e == ERROR_ALREADY_EXISTS) return EXISTS;
    err = "CreateDirectoryW failed (" + std::to_string(e) + ")";
    return FAILURE;
#else
    if (::mkdir(path.c_str(), 0700) == 0) return OK;
    if (errno == EEXIST) return EXISTS;
    err = std::strerror(errno);
    return FAILURE;
#endif
}

} // namespace flint_server
