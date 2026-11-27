// CFIRE-UPSTREAM: CF-099, CF-031, CF-168, CF-208
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
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
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

// Whether a folder can be flushed by opening it with core:fs (`fs.open` + `sync()`).
// Windows' CRT opens no folder ("Permission denied"), and core:fs has no other way
// (CF-168). The server ships for Linux; on the Windows test VM a rename into a folder is
// left to NTFS's journal.
inline bool folders_sync() {
#if defined(_WIN32)
    return false;
#else
    return true;
#endif
}

// Whether `host:port` can be bound now (milestone 78). cfire's listen falls back to an
// in-process "virtual" port when bind fails, and on Windows opens its socket with
// SO_REUSEADDR, which there shares a port in use (CF-208): so the server binds the address
// once itself, as a plain server would (SO_REUSEADDR on POSIX, so a port in TIME_WAIT is
// free; SO_EXCLUSIVEADDRUSE on Windows), and closes it before cfire binds it. The wildcard
// is checked as cfire binds it: IPv6 dual-stack, else IPv4. False with `err` set when the
// port is taken or the address is not one.
inline bool port_free(const std::string& host, int port, std::string& err) {
#if defined(_WIN32)
    using sock_t = SOCKET;
    const sock_t bad = INVALID_SOCKET;
    WSADATA wsa;
    ::WSAStartup(MAKEWORD(2, 2), &wsa);
    auto close_sock = [](sock_t s) { ::closesocket(s); };
#else
    using sock_t = int;
    const sock_t bad = -1;
    auto close_sock = [](sock_t s) { ::close(s); };
#endif
    auto try_bind = [&](int family, const sockaddr* addr, socklen_t len, bool dual) -> int {
        sock_t s = ::socket(family, SOCK_STREAM, 0);
        if (s == bad) return -1;  // no such family here
        int one = 1, zero = 0;
#if defined(_WIN32)
        ::setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&one), sizeof(one));
#else
        ::setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
#endif
        if (dual) ::setsockopt(s, IPPROTO_IPV6, IPV6_V6ONLY, reinterpret_cast<const char*>(&zero), sizeof(zero));
        int rc = ::bind(s, addr, len) == 0 && ::listen(s, 1) == 0 ? 1 : 0;
        close_sock(s);
        return rc;
    };
    const bool wildcard = host.empty() || host == "0.0.0.0" || host == "*" || host == "::";
    const bool v6 = !wildcard && host.find(':') != std::string::npos;
    if (wildcard || v6) {
        sockaddr_in6 a6{};
        a6.sin6_family = AF_INET6;
        a6.sin6_port = htons(static_cast<unsigned short>(port));
        a6.sin6_addr = in6addr_any;
        if (v6 && ::inet_pton(AF_INET6, host.c_str(), &a6.sin6_addr) != 1) {
            err = "not an address";
            return false;
        }
        int rc = try_bind(AF_INET6, reinterpret_cast<sockaddr*>(&a6), sizeof(a6), wildcard);
        if (rc == 1) return true;
        if (rc == 0 || v6) {
            err = "the port is in use";
            return false;
        }
    }
    sockaddr_in a4{};
    a4.sin_family = AF_INET;
    a4.sin_port = htons(static_cast<unsigned short>(port));
    if (wildcard) {
        a4.sin_addr.s_addr = htonl(INADDR_ANY);
    } else if (host == "localhost") {
        a4.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    } else if (::inet_pton(AF_INET, host.c_str(), &a4.sin_addr) != 1) {
        err = "not an address";
        return false;
    }
    if (try_bind(AF_INET, reinterpret_cast<sockaddr*>(&a4), sizeof(a4), false) == 1) return true;
    err = "the port is in use";
    return false;
}

} // namespace flint_server
