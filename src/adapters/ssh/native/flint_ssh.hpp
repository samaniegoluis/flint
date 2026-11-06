// CFIRE-UPSTREAM: CF-005, CF-026, CF-031, CF-043
//
// libssh shim for src/adapters/ssh/link.cf: password and keyboard-interactive auth,
// agent auth, exec/shell channel reads with stderr and exit state, and the TCP
// tunnel that carries a jump host's next hop. cfire has no SSH (CF-005), no mutex
// or thread type usable from a struct (CF-026), and no top-level cpp block for the
// helpers and the forwarder thread below (CF-031).
#pragma once
#include <libssh/libssh.h>
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
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

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
        ssize_t w = ::write(fd, data, len);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return false;
        data += w;
        len -= static_cast<size_t>(w);
    }
    return true;
}

inline void pump(Tunnel* t) {
    char buf[32768];
    while (!t->stop.load()) {
        pollfd p{t->local_fd, POLLIN, 0};
        int pr = ::poll(&p, 1, 5);
        if (pr < 0 && errno != EINTR) break;
        if (pr > 0 && (p.revents & (POLLIN | POLLHUP | POLLERR))) {
            ssize_t n = ::read(t->local_fd, buf, sizeof buf);
            if (n <= 0) break;
            std::lock_guard<std::mutex> g(*t->outer_lock);
            size_t off = 0;
            bool ok = true;
            while (off < static_cast<size_t>(n)) {
                int w = ssh_channel_write(t->channel, buf + off, static_cast<uint32_t>(n - static_cast<ssize_t>(off)));
                if (w <= 0) { ok = false; break; }
                off += static_cast<size_t>(w);
            }
            if (!ok) break;
        }
        int n = 0;
        bool eof = false;
        {
            std::lock_guard<std::mutex> g(*t->outer_lock);
            n = ssh_channel_read_nonblocking(t->channel, buf, sizeof buf, 0);
            eof = n == 0 && (ssh_channel_is_eof(t->channel) || ssh_channel_is_closed(t->channel));
        }
        if (n < 0 || eof) break;
        if (n > 0 && !write_all(t->local_fd, buf, static_cast<size_t>(n))) break;
    }
    ::shutdown(t->local_fd, SHUT_RDWR);
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
    if (::socketpair(AF_UNIX, SOCK_STREAM, 0, fds) != 0) {
        err = std::strerror(errno);
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
    if (t->local_fd >= 0) { ::close(t->local_fd); t->local_fd = -1; }
    if (t->inner_fd >= 0) { ::close(t->inner_fd); t->inner_fd = -1; }
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
