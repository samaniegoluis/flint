// CFIRE-UPSTREAM: CF-005, CF-026, CF-031, CF-043
//
// libssh shim for src/adapters/ssh/link.cf: password and keyboard-interactive auth,
// agent auth, exec/shell channel reads with stderr and exit state, and the TCP
// tunnel that carries a jump host's next hop. cfire has no SSH (CF-005), no mutex
// or thread type usable from a struct (CF-026), and no top-level cpp block for the
// helpers and the forwarder thread below (CF-031).
#pragma once
#include <libssh/libssh.h>
// ssh_send_keepalive is declared with the server API but serves a client too.
#include <libssh/server.h>
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <chrono>
#include "flint_sock.hpp"  // sockets on POSIX and Windows (windows-port)

namespace flint_ssh {

// Result codes shared with link.cf.
constexpr int OK = 0;
constexpr int DENIED = 1;   // the server rejected this method
constexpr int FAILED = 2;   // transport error: the session is unusable
constexpr int NO_AGENT = 3; // SSH_AUTH_SOCK is not set

// Methods the server allows. The first call sends a "none" request, which
// libssh needs before ssh_userauth_list answers. Returns -1 on a transport error
// and -2 when "none" itself succeeded.
inline int auth_methods(ssh_session s) {
    int rc = ssh_userauth_none(s, nullptr);
    if (rc == SSH_AUTH_SUCCESS) return -2;
    if (rc == SSH_AUTH_ERROR) return -1;
    return ssh_userauth_list(s, nullptr);
}

inline int map_auth(int rc) {
    if (rc == SSH_AUTH_SUCCESS) return OK;
    if (rc == SSH_AUTH_ERROR) return FAILED;
    return DENIED;
}

// Password auth, falling back to keyboard-interactive (answering every prompt
// that does not echo with the password), as OpenSSH servers with PAM expect.
inline int auth_password(ssh_session s, const std::string& password) {
    int methods = auth_methods(s);
    if (methods == -2) return OK;
    if (methods < 0) return FAILED;
    if (methods & SSH_AUTH_METHOD_PASSWORD) {
        int rc = ssh_userauth_password(s, nullptr, password.c_str());
        if (rc == SSH_AUTH_SUCCESS || rc == SSH_AUTH_ERROR) return map_auth(rc);
    }
    if (methods & SSH_AUTH_METHOD_INTERACTIVE) {
        int rc = ssh_userauth_kbdint(s, nullptr, nullptr);
        for (int round = 0; rc == SSH_AUTH_INFO && round < 8; round++) {
            int n = ssh_userauth_kbdint_getnprompts(s);
            for (int i = 0; i < n; i++) {
                char echo = 0;
                ssh_userauth_kbdint_getprompt(s, static_cast<unsigned>(i), &echo);
                // An echoed prompt is not asking for a secret; leave it empty.
                ssh_userauth_kbdint_setanswer(s, static_cast<unsigned>(i), echo ? "" : password.c_str());
            }
            rc = ssh_userauth_kbdint(s, nullptr, nullptr);
        }
        return map_auth(rc);
    }
    return DENIED;
}

inline int auth_key(ssh_session s, const std::string& private_key, const std::string& passphrase, bool& unreadable) {
    unreadable = false;
    int methods = auth_methods(s);
    if (methods == -2) return OK;
    if (methods < 0) return FAILED;
    ssh_key key = nullptr;
    const char* pass = passphrase.empty() ? nullptr : passphrase.c_str();
    if (ssh_pki_import_privkey_base64(private_key.c_str(), pass, nullptr, nullptr, &key) != SSH_OK) {
        unreadable = true;
        return DENIED;
    }
    int rc = ssh_userauth_publickey(s, nullptr, key);
    ssh_key_free(key);
    return map_auth(rc);
}

inline int auth_agent(ssh_session s) {
    const char* sock = std::getenv("SSH_AUTH_SOCK");
    if (!sock || !*sock) return NO_AGENT;
    int methods = auth_methods(s);
    if (methods == -2) return OK;
    if (methods < 0) return FAILED;
    return map_auth(ssh_userauth_agent(s, nullptr));
}

// One read from a channel: stdout waits up to `timeout_ms`, stderr is drained
// without waiting. `done` is set once the remote side sent EOF and both streams
// are empty; the exit state is read then. Returns false on a transport error.
inline bool read_chunk(ssh_channel ch, int timeout_ms, std::string& out, std::string& err,
                       bool& done, std::int64_t& code, std::string& sig) {
    char buf[16384];
    int n = ssh_channel_read_timeout(ch, buf, sizeof buf, 0, timeout_ms);
    if (n == SSH_ERROR) return false;
    if (n > 0) out.assign(buf, static_cast<size_t>(n));
    int e = ssh_channel_read_nonblocking(ch, buf, sizeof buf, 1);
    if (e == SSH_ERROR) return false;
    if (e > 0) err.assign(buf, static_cast<size_t>(e));
    if (n <= 0 && e <= 0 && (ssh_channel_is_eof(ch) || ssh_channel_is_closed(ch))) {
        done = true;
#if LIBSSH_VERSION_INT >= SSH_VERSION_INT(0, 11, 0)
        uint32_t status = 0;
        char* signal = nullptr;
        int core = 0;
        int rc = ssh_channel_get_exit_state(ch, &status, &signal, &core);
        if (signal) {
            code = -1;
            sig = signal;
            ssh_string_free_char(signal);
        } else if (rc == SSH_OK) {
            code = static_cast<std::int64_t>(status);
        } else {
            code = -1;
        }
#else
        // libssh 0.10 (Ubuntu 24.04, Zorin OS 18) has no ssh_channel_get_exit_state:
        // the status only, -1 when the command ended without one (a signal, whose
        // name 0.10 does not report here).
        code = static_cast<std::int64_t>(ssh_channel_get_exit_status(ch));
#endif
    }
    return true;
}

// ---- Dialling ------------------------------------------------------------------
//
// libssh connects only to the first address a name resolves to, so a host whose
// first address is IPv6 (`localhost` -> ::1 on Debian) fails with "Connection
// refused" when the server listens on IPv4 only. dial_tcp tries every address in
// resolver order, as OpenSSH does, within one overall deadline (Principle 8), and
// returns a connected blocking socket for SSH_OPTIONS_FD, or -1 with `err` set.

// Tries `candidates` (numeric addresses) in order until one connects before the
// deadline. Returns the connected blocking socket, or -1 with `err` set.
inline int dial_candidates(const std::vector<std::string>& candidates, int port, long timeout_secs, std::string& err) {
    using clock = std::chrono::steady_clock;
    const auto deadline = clock::now() + std::chrono::seconds(timeout_secs);
    std::string service = std::to_string(port);
    err = "no address to connect to";
    for (const auto& addr : candidates) {
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_flags = AI_NUMERICHOST | AI_NUMERICSERV;
        addrinfo* ai = nullptr;
        if (::getaddrinfo(addr.c_str(), service.c_str(), &hints, &ai) != 0 || !ai) {
            err = "bad address " + addr;
            continue;
        }
        int fd = flint_sock::open(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) {
            err = flint_sock::error_text(flint_sock::last_error());
            ::freeaddrinfo(ai);
            continue;
        }
        flint_sock::set_nonblocking(fd, true);
        int rc = ::connect(fd, ai->ai_addr, static_cast<flint_sock::socklen>(ai->ai_addrlen));
        int why = rc == 0 ? 0 : flint_sock::last_error();
        ::freeaddrinfo(ai);
        if (rc != 0 && flint_sock::in_progress(why)) {
            auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - clock::now()).count();
            int pr = left > 0 ? flint_sock::poll_one(fd, POLLOUT, static_cast<int>(left)) : 0;
            if (pr > 0) {
                int so = 0;
                flint_sock::socklen len = sizeof so;
                ::getsockopt(fd, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&so), &len);
                rc = so == 0 ? 0 : -1;
                why = so;
            } else {
                rc = -1;
                why = pr == 0 ? flint_sock::kTimedOut : flint_sock::last_error();
            }
        }
        if (rc == 0) {
            flint_sock::set_nonblocking(fd, false);
            return fd;
        }
        err = addr + ": " + flint_sock::error_text(why);
        flint_sock::close(fd);
        if (clock::now() >= deadline) {
            err = "timed out";
            break;
        }
    }
    return -1;
}

// Resolves `host` and dials its addresses in resolver order.
inline int dial_tcp(const std::string& host, int port, long timeout_secs, std::string& err) {
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* list = nullptr;
    flint_sock::init();
    int gai = ::getaddrinfo(host.c_str(), nullptr, &hints, &list);
    if (gai != 0) {
        err = std::string("cannot resolve ") + host + ": " + gai_strerror(gai);
        return -1;
    }
    std::vector<std::string> candidates;
    for (addrinfo* ai = list; ai; ai = ai->ai_next) {
        char buf[NI_MAXHOST];
        if (::getnameinfo(ai->ai_addr, static_cast<flint_sock::socklen>(ai->ai_addrlen), buf, sizeof buf, nullptr, 0, NI_NUMERICHOST) == 0) {
            candidates.emplace_back(buf);
        }
    }
    ::freeaddrinfo(list);
    return dial_candidates(candidates, port, timeout_secs, err);
}

// ---- Keepalive -----------------------------------------------------------------

inline int send_keepalive(ssh_session s) {
    return ssh_send_keepalive(s) == SSH_OK ? 0 : -1;
}

// ---- Jump-host tunnel ---------------------------------------------------------
//
// A direct-tcpip channel on the outer session, bridged to one end of a socketpair
// by a thread. The other end becomes the next session's socket (SSH_OPTIONS_FD),
// so that session runs its own handshake end to end through the jump host.

struct Tunnel {
    ssh_session outer = nullptr;
    ssh_channel channel = nullptr;
    std::shared_ptr<std::mutex> outer_lock;
    int local_fd = -1;
    // The next session's socket. libssh does not close a socket given through
    // SSH_OPTIONS_FD, so the tunnel does, after that session is freed.
    int inner_fd = -1;
    std::atomic<bool> stop{false};
    std::thread worker;
};

inline bool write_all(int fd, const char* data, size_t len) {
    while (len > 0) {
        int w = flint_sock::send_some(fd, data, len);
        if (w < 0 && flint_sock::interrupted(flint_sock::last_error())) continue;
        if (w <= 0) return false;
        data += w;
        len -= static_cast<size_t>(w);
    }
    return true;
}

// Moves bytes both ways until either end closes. It wakes when the next session
// writes (`local_fd`) or when the outer session's socket has data, and then drains
// everything the channel holds: waiting out the poll between two reads made a
// download through a jump host crawl at one small read per 5 ms (milestone 18).
inline void pump(Tunnel* t) {
    char buf[32768];
    int outer_fd = -1;
    {
        std::lock_guard<std::mutex> g(*t->outer_lock);
        outer_fd = ssh_get_fd(t->outer);
    }
    while (!t->stop.load()) {
        short revents = 0;
        int pr = flint_sock::poll_two(t->local_fd, outer_fd, POLLIN, 5, &revents);
        if (pr < 0 && !flint_sock::interrupted(flint_sock::last_error())) break;
        if (pr > 0 && (revents & (POLLIN | POLLHUP | POLLERR))) {
            int n = flint_sock::recv_some(t->local_fd, buf, sizeof buf);
            if (n <= 0) break;
            std::lock_guard<std::mutex> g(*t->outer_lock);
            size_t off = 0;
            bool ok = true;
            while (off < static_cast<size_t>(n)) {
                int w = ssh_channel_write(t->channel, buf + off, static_cast<uint32_t>(static_cast<size_t>(n) - off));
                if (w <= 0) { ok = false; break; }
                off += static_cast<size_t>(w);
            }
            if (!ok) break;
        }
        bool done = false;
        for (;;) {
            int n = 0;
            bool eof = false;
            {
                std::lock_guard<std::mutex> g(*t->outer_lock);
                n = ssh_channel_read_nonblocking(t->channel, buf, sizeof buf, 0);
                eof = n == 0 && (ssh_channel_is_eof(t->channel) || ssh_channel_is_closed(t->channel));
            }
            if (n < 0 || eof) { done = true; break; }
            if (n == 0) break;
            if (!write_all(t->local_fd, buf, static_cast<size_t>(n))) { done = true; break; }
        }
        if (done) break;
    }
    flint_sock::shutdown_both(t->local_fd);
}

// Opens the tunnel to host:port through `outer`. On success `inner_fd` is the
// socket for the next session; close_tunnel closes it.
inline std::shared_ptr<Tunnel> open_tunnel(ssh_session outer, std::shared_ptr<std::mutex> lock,
                                           const std::string& host, int port, int& inner_fd, std::string& err) {
    auto t = std::make_shared<Tunnel>();
    t->outer = outer;
    t->outer_lock = lock;
    {
        std::lock_guard<std::mutex> g(*lock);
        t->channel = ssh_channel_new(outer);
        if (!t->channel) { err = "out of memory"; return nullptr; }
        if (ssh_channel_open_forward(t->channel, host.c_str(), port, "127.0.0.1", 0) != SSH_OK) {
            err = ssh_get_error(outer);
            ssh_channel_free(t->channel);
            t->channel = nullptr;
            return nullptr;
        }
    }
    int fds[2];
    if (flint_sock::pair(fds) != 0) {
        err = flint_sock::error_text(flint_sock::last_error());
        std::lock_guard<std::mutex> g(*lock);
        ssh_channel_close(t->channel);
        ssh_channel_free(t->channel);
        t->channel = nullptr;
        return nullptr;
    }
    t->local_fd = fds[0];
    t->inner_fd = fds[1];
    inner_fd = fds[1];
    t->worker = std::thread(pump, t.get());
    return t;
}

inline void close_tunnel(const std::shared_ptr<Tunnel>& t) {
    if (!t) return;
    t->stop.store(true);
    if (t->worker.joinable()) t->worker.join();
    if (t->local_fd >= 0) { flint_sock::close(t->local_fd); t->local_fd = -1; }
    if (t->inner_fd >= 0) { flint_sock::close(t->inner_fd); t->inner_fd = -1; }
    std::lock_guard<std::mutex> g(*t->outer_lock);
    if (t->channel) {
        ssh_channel_close(t->channel);
        ssh_channel_free(t->channel);
        t->channel = nullptr;
    }
}

// The tunnels of one link, innermost last.
struct Tunnels {
    std::vector<std::shared_ptr<Tunnel>> list;
};

}  // namespace flint_ssh
