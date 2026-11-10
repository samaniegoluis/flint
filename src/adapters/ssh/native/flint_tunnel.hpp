// CFIRE-UPSTREAM: CF-005, CF-026, CF-031, CF-112
//
// Local port forwards (milestone 22, D-062): the registry of hosts whose SSH session
// carries tunnels, and the one thread per host session that moves their bytes.
//
// * A use case logs in with an ordinary link, then hands its hops over (adopt_*): from
//   then on the registry owns the session and hangs it up (release).
// * Each tunnel is a listener on 127.0.0.1 (bound by `listen`, in the caller's thread,
//   so a port in use is an answer, not an event). Every connection it accepts opens
//   its own direct-tcpip channel to the destination; closing either side closes both.
// * One worker per host polls the wake pipe, every listener, every connection and the
//   session's socket, so nothing else ever reads the session (no second reader to
//   steal its packets, unlike two jump-host pumps on one hop). It sends a keepalive
//   every `keepalive_secs`; a session that cannot be written, or that hangs up, is
//   *lost*: every listener and connection closes and the host stays in the registry,
//   marked lost, until released. Nothing redials on its own (spec v6, settled at plan).
// * Every libssh call takes the last hop's mutex (SshConn.lock), as everywhere else.
//   Opening a channel blocks the worker for that one round trip, bounded by the
//   session's timeout (SSH_OPTIONS_TIMEOUT, Principle 8).
//
// cfire has no thread or mutex usable from a struct (CF-026), no top-level cpp block
// (CF-031), no sockets with accept/poll (CF-112) and no SSH (CF-005), hence this header.
#pragma once
#include "flint_ssh.hpp"
#include <arpa/inet.h>
#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <string>
#include <thread>
#include <vector>

namespace flint_tunnel {

// listen() results, shared with tunnels.cf.
constexpr int OK = 0;
constexpr int PORT_IN_USE = 1;
constexpr int FAILED = 2;
constexpr int NO_SESSION = 3;
constexpr int DENIED = 4;   // a port below 1024 without the right to bind it

struct Conn {
    int fd = -1;
    ssh_channel ch = nullptr;
    std::string out;    // read from the channel, not yet written to the local socket
};

struct Listener {
    std::string id;
    int fd = -1;
    int port = 0;
    std::string dest_host;
    int dest_port = 0;
    std::vector<Conn> conns;            // the worker's own
    std::atomic<int> live{0};
    std::atomic<long long> opened{0};
    std::atomic<long long> failed{0};
    std::atomic<bool> stop{false};
    std::atomic<bool> closed{false};
    std::string last_error;             // under Host::mtx
};

struct Hop {
    ssh_session session = nullptr;
    int sock = -1;
    std::shared_ptr<std::mutex> lock;
};

struct Host {
    std::string key;
    std::vector<Hop> hops;
    std::shared_ptr<flint_ssh::Tunnels> jumps;
    long long timeout_secs = 10;
    int keepalive_secs = 30;
    std::mutex mtx;                     // listeners, lost_why
    std::vector<std::shared_ptr<Listener>> listeners;
    std::atomic<bool> stop{false};
    std::atomic<bool> lost{false};
    std::string lost_why;
    int wake[2] = {-1, -1};
    std::thread worker;
};

struct Registry {
    std::mutex mtx;
    std::map<std::string, std::shared_ptr<Host>> hosts;
    std::map<std::string, std::shared_ptr<Host>> adopting;
};

inline Registry& registry() {
    static Registry r;
    return r;
}

inline std::shared_ptr<Host> find(const std::string& key) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    auto it = r.hosts.find(key);
    return it == r.hosts.end() ? nullptr : it->second;
}

inline void set_nonblocking(int fd) {
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

inline void wake(Host* h) {
    if (h->wake[1] >= 0) {
        char c = 1;
        (void)!::write(h->wake[1], &c, 1);
    }
}

// ---- The worker -----------------------------------------------------------------

inline void close_conn(Host* h, Conn& c) {
    if (c.ch) {
        std::lock_guard<std::mutex> g(*h->hops.back().lock);
        ssh_channel_close(c.ch);
        ssh_channel_free(c.ch);
        c.ch = nullptr;
    }
    if (c.fd >= 0) {
        ::close(c.fd);
        c.fd = -1;
    }
}

inline void close_listener(Host* h, Listener& l) {
    for (auto& c : l.conns) close_conn(h, c);
    l.conns.clear();
    l.live.store(0);
    if (l.fd >= 0) {
        ::close(l.fd);
        l.fd = -1;
    }
    l.closed.store(true);
}

// Writes what it can of `c.out` without blocking. False when the socket is gone.
inline bool flush_out(Conn& c) {
    while (!c.out.empty()) {
        ssize_t w = ::write(c.fd, c.out.data(), c.out.size());
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return true;
        if (w <= 0) return false;
        c.out.erase(0, static_cast<size_t>(w));
    }
    return true;
}

// One accepted connection: its own direct-tcpip channel to the destination.
inline void accept_one(Host* h, Listener& l, int fd) {
    set_nonblocking(fd);
    int one = 1;
    ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    ssh_session s = h->hops.back().session;
    ssh_channel ch = nullptr;
    std::string err;
    {
        std::lock_guard<std::mutex> g(*h->hops.back().lock);
        ch = ssh_channel_new(s);
        if (!ch) {
            err = "out of memory";
        } else if (ssh_channel_open_forward(ch, l.dest_host.c_str(), l.dest_port, "127.0.0.1", l.port) != SSH_OK) {
            err = ssh_get_error(s);
            ssh_channel_free(ch);
            ch = nullptr;
        }
    }
    if (!ch) {
        ::close(fd);
        l.failed.fetch_add(1);
        std::lock_guard<std::mutex> g(h->mtx);
        l.last_error = err;
        return;
    }
    Conn c;
    c.fd = fd;
    c.ch = ch;
    l.conns.push_back(std::move(c));
    l.opened.fetch_add(1);
}

// Moves what is waiting on one connection both ways. False once it is over.
inline bool serve_conn(Host* h, Conn& c, short revents, char* buf, size_t cap) {
    auto& lock = *h->hops.back().lock;
    if ((revents & POLLOUT) && !flush_out(c)) return false;
    if (c.out.empty() && (revents & (POLLIN | POLLHUP | POLLERR))) {
        ssize_t n = ::read(c.fd, buf, cap);
        if (n == 0) return false;
        if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) return false;
        if (n > 0) {
            std::lock_guard<std::mutex> g(lock);
            size_t off = 0;
            while (off < static_cast<size_t>(n)) {
                int w = ssh_channel_write(c.ch, buf + off, static_cast<uint32_t>(static_cast<size_t>(n) - off));
                if (w <= 0) return false;
                off += static_cast<size_t>(w);
            }
        }
    }
    // Drain the channel while the local socket keeps up; a slow reader leaves the
    // rest in libssh's buffer, and the SSH window holds the server back.
    for (int round = 0; round < 16 && c.out.empty(); round++) {
        int n = 0;
        bool over = false;
        {
            std::lock_guard<std::mutex> g(lock);
            n = ssh_channel_read_nonblocking(c.ch, buf, static_cast<uint32_t>(cap), 0);
            over = n == 0 && (ssh_channel_is_eof(c.ch) || ssh_channel_is_closed(c.ch));
        }
        if (n < 0 || over) return false;
        if (n == 0) break;
        c.out.assign(buf, static_cast<size_t>(n));
        if (!flush_out(c)) return false;
    }
    return true;
}

inline void mark_lost(Host* h, const std::string& why) {
    {
        std::lock_guard<std::mutex> g(h->mtx);
        h->lost_why = why;
    }
    h->lost.store(true);
}

inline void run(Host* h) {
    char buf[32768];
    ssh_session s = h->hops.back().session;
    auto& lock = *h->hops.back().lock;
    int sfd = -1;
    {
        std::lock_guard<std::mutex> g(lock);
        sfd = ssh_get_fd(s);
    }
    using clock = std::chrono::steady_clock;
    auto last_keepalive = clock::now();
    while (!h->stop.load() && !h->lost.load()) {
        std::vector<std::shared_ptr<Listener>> ls;
        {
            std::lock_guard<std::mutex> g(h->mtx);
            ls = h->listeners;
        }
        for (auto& l : ls) {
            if (l->stop.load() && !l->closed.load()) close_listener(h, *l);
        }
        // The poll set: wake pipe, listeners, connections, then the session's socket
        // while some connection can take what it brings.
        std::vector<pollfd> p;
        p.push_back({h->wake[0], POLLIN, 0});
        bool want_session = false;
        for (auto& l : ls) {
            if (l->closed.load()) continue;
            p.push_back({l->fd, POLLIN, 0});
            for (auto& c : l->conns) {
                p.push_back({c.fd, static_cast<short>(c.out.empty() ? POLLIN : POLLOUT), 0});
                if (c.out.empty()) want_session = true;
            }
        }
        size_t session_at = p.size();
        if (want_session && sfd >= 0) p.push_back({sfd, POLLIN, 0});
        int pr = ::poll(p.data(), static_cast<nfds_t>(p.size()), 100);
        if (pr < 0 && errno != EINTR) {
            mark_lost(h, std::strerror(errno));
            break;
        }
        if (p[0].revents & POLLIN) {
            char drain[64];
            while (::read(h->wake[0], drain, sizeof drain) > 0) {}
        }
        size_t at = 1;
        for (auto& l : ls) {
            if (l->closed.load()) continue;
            short lrev = p[at++].revents;
            std::vector<short> crev;
            for (size_t i = 0; i < l->conns.size(); i++) crev.push_back(p[at++].revents);
            std::vector<Conn> keep;
            for (size_t i = 0; i < l->conns.size(); i++) {
                if (serve_conn(h, l->conns[i], crev[i], buf, sizeof buf)) {
                    keep.push_back(std::move(l->conns[i]));
                } else {
                    close_conn(h, l->conns[i]);
                }
            }
            l->conns = std::move(keep);
            if (lrev & POLLIN) {
                for (;;) {
                    int fd = ::accept(l->fd, nullptr, nullptr);
                    if (fd < 0) break;
                    accept_one(h, *l, fd);
                }
            }
            l->live.store(static_cast<int>(l->conns.size()));
        }
        if (session_at < p.size() && (p[session_at].revents & (POLLHUP | POLLERR | POLLNVAL))) {
            mark_lost(h, "the connection was closed");
            break;
        }
        bool connected = true;
        {
            std::lock_guard<std::mutex> g(lock);
            connected = ssh_is_connected(s) != 0;
        }
        if (!connected) {
            std::lock_guard<std::mutex> g(lock);
            std::string why = ssh_get_error(s);
            if (why.empty()) why = "the connection was closed";
            mark_lost(h, why);
            break;
        }
        auto now = clock::now();
        if (now - last_keepalive >= std::chrono::seconds(h->keepalive_secs)) {
            int rc = 0;
            std::string why;
            {
                std::lock_guard<std::mutex> g(lock);
                rc = flint_ssh::send_keepalive(s);
                if (rc != 0) why = ssh_get_error(s);
            }
            if (rc != 0) {
                mark_lost(h, why.empty() ? "the keepalive could not be sent" : why);
                break;
            }
            last_keepalive = now;
        }
    }
    std::vector<std::shared_ptr<Listener>> ls;
    {
        std::lock_guard<std::mutex> g(h->mtx);
        ls = h->listeners;
    }
    for (auto& l : ls) close_listener(h, *l);
}

// ---- Adopting a logged-in link ---------------------------------------------------

inline void adopt_begin(const std::string& key) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    auto h = std::make_shared<Host>();
    h->key = key;
    r.adopting[key] = h;
}

inline void adopt_hop(const std::string& key, ssh_session s, int sock, std::shared_ptr<std::mutex> lock) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    auto it = r.adopting.find(key);
    if (it == r.adopting.end()) return;
    it->second->hops.push_back(Hop{s, sock, std::move(lock)});
}

inline void release(const std::string& key);

// Starts the host's worker. False (and the hops hung up) when it cannot.
inline bool adopt_finish(const std::string& key, std::shared_ptr<flint_ssh::Tunnels> jumps, long long timeout_secs, int keepalive_secs, std::string& err) {
    std::shared_ptr<Host> h;
    std::shared_ptr<Host> old;
    {
        auto& r = registry();
        std::lock_guard<std::mutex> g(r.mtx);
        auto it = r.adopting.find(key);
        if (it == r.adopting.end()) { err = "nothing to adopt"; return false; }
        h = it->second;
        r.adopting.erase(it);
        auto o = r.hosts.find(key);
        if (o != r.hosts.end()) old = o->second;
    }
    if (old) release(key);
    h->jumps = std::move(jumps);
    h->timeout_secs = timeout_secs;
    h->keepalive_secs = keepalive_secs > 0 ? keepalive_secs : 30;
    if (h->hops.empty() || ::pipe(h->wake) != 0) {
        err = h->hops.empty() ? "no session to adopt" : std::strerror(errno);
        return false;
    }
    set_nonblocking(h->wake[0]);
    set_nonblocking(h->wake[1]);
    {
        auto& r = registry();
        std::lock_guard<std::mutex> g(r.mtx);
        r.hosts[key] = h;
    }
    h->worker = std::thread(run, h.get());
    return true;
}

// ---- Listening -------------------------------------------------------------------

// Whether something answers on 127.0.0.1:port (to tell a real listener from sockets
// left in TIME_WAIT on macOS, where SO_REUSEADDR would also let two listeners share
// the port with one bound to the wildcard address).
inline bool port_answers(int port) {
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(port));
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    set_nonblocking(fd);
    int rc = ::connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof a);
    bool up = rc == 0;
    if (rc != 0 && errno == EINPROGRESS) {
        pollfd p{fd, POLLOUT, 0};
        if (::poll(&p, 1, 500) > 0) {
            int so = 0;
            socklen_t len = sizeof so;
            ::getsockopt(fd, SOL_SOCKET, SO_ERROR, &so, &len);
            up = so == 0;
        }
    }
    ::close(fd);
    return up;
}

// A listening socket on 127.0.0.1:port (0: any free port, for tests), non-blocking.
inline int bind_loopback(int port, int& fd, int& bound, std::string& err) {
    for (int attempt = 0; attempt < 2; attempt++) {
        fd = ::socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) { err = std::strerror(errno); return FAILED; }
        int one = 1;
#ifdef __APPLE__
        bool reuse = attempt == 1;
#else
        bool reuse = true;
#endif
        if (reuse) ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_port = htons(static_cast<uint16_t>(port));
        a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (::bind(fd, reinterpret_cast<sockaddr*>(&a), sizeof a) == 0 && ::listen(fd, 64) == 0) {
            sockaddr_in got{};
            socklen_t len = sizeof got;
            ::getsockname(fd, reinterpret_cast<sockaddr*>(&got), &len);
            bound = ntohs(got.sin_port);
            set_nonblocking(fd);
            return OK;
        }
        int why = errno;
        ::close(fd);
        fd = -1;
        if (why == EACCES || why == EPERM) { err = std::strerror(why); return DENIED; }
        if (why != EADDRINUSE) { err = std::strerror(why); return FAILED; }
        if (reuse || port == 0 || port_answers(port)) { err = std::strerror(why); return PORT_IN_USE; }
    }
    err = "address in use";
    return PORT_IN_USE;
}

// Starts tunnel `id` on host `key`: 127.0.0.1:port forwarded to dest:dest_port.
// `bound` is the port it listens on.
inline int listen(const std::string& key, const std::string& id, int port, const std::string& dest, int dest_port, int& bound, std::string& err) {
    auto h = find(key);
    if (!h || h->lost.load()) { err = "no session"; return NO_SESSION; }
    {
        std::lock_guard<std::mutex> g(h->mtx);
        for (auto& l : h->listeners) {
            if (l->id == id && !l->closed.load()) { bound = l->port; return OK; }
        }
    }
    int fd = -1;
    int rc = bind_loopback(port, fd, bound, err);
    if (rc != OK) return rc;
    auto l = std::make_shared<Listener>();
    l->id = id;
    l->fd = fd;
    l->port = bound;
    l->dest_host = dest;
    l->dest_port = dest_port;
    {
        std::lock_guard<std::mutex> g(h->mtx);
        std::vector<std::shared_ptr<Listener>> keep;
        for (auto& o : h->listeners) {
            if (!o->closed.load()) keep.push_back(o);
        }
        keep.push_back(l);
        h->listeners = std::move(keep);
    }
    wake(h.get());
    return OK;
}

// Stops tunnel `id` on host `key`, its listener and every connection, and waits
// (bounded) until its port is free. False when it was not running.
inline bool unlisten(const std::string& key, const std::string& id) {
    auto h = find(key);
    if (!h) return false;
    std::shared_ptr<Listener> l;
    {
        std::lock_guard<std::mutex> g(h->mtx);
        std::vector<std::shared_ptr<Listener>> keep;
        for (auto& o : h->listeners) {
            if (o->id == id) l = o; else keep.push_back(o);
        }
        h->listeners = std::move(keep);
    }
    if (!l) return false;
    l->stop.store(true);
    wake(h.get());
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(h->timeout_secs * 2 + 5);
    while (!l->closed.load() && std::chrono::steady_clock::now() < deadline) {
        if (!h->worker.joinable() || h->lost.load()) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    if (!l->closed.load() && h->lost.load()) {
        // The worker ended before seeing it; it closed every listener on its way out
        // except one it never had.
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
    }
    return true;
}

// Stops the host's worker and hangs its session up, innermost hop first (as
// SshLink::link_hangup does).
inline void release(const std::string& key) {
    std::shared_ptr<Host> h;
    {
        auto& r = registry();
        std::lock_guard<std::mutex> g(r.mtx);
        auto it = r.hosts.find(key);
        if (it == r.hosts.end()) return;
        h = it->second;
        r.hosts.erase(it);
    }
    h->stop.store(true);
    wake(h.get());
    if (h->worker.joinable()) h->worker.join();
    for (size_t i = h->hops.size(); i > 0; i--) {
        size_t idx = i - 1;
        if (h->jumps && idx < h->jumps->list.size()) flint_ssh::close_tunnel(h->jumps->list[idx]);
        auto& hop = h->hops[idx];
        std::lock_guard<std::mutex> g(*hop.lock);
        if (hop.session) {
            ssh_disconnect(hop.session);
            ssh_free(hop.session);
            hop.session = nullptr;
        }
        if (hop.sock >= 0) {
            ::close(hop.sock);
            hop.sock = -1;
        }
    }
    if (h->jumps) h->jumps->list.clear();
    if (h->wake[0] >= 0) ::close(h->wake[0]);
    if (h->wake[1] >= 0) ::close(h->wake[1]);
}

inline void release_all() {
    std::vector<std::string> keys;
    {
        auto& r = registry();
        std::lock_guard<std::mutex> g(r.mtx);
        for (auto& [k, _] : r.hosts) keys.push_back(k);
    }
    for (auto& k : keys) release(k);
}

// ---- State -----------------------------------------------------------------------

// 0: no session for `key`; 1: up; 2: lost.
inline int host_state(const std::string& key) {
    auto h = find(key);
    if (!h) return 0;
    return h->lost.load() ? 2 : 1;
}

// One line per tunnel of every host: key \t id \t up(1)|lost(0) \t port \t live \t
// opened \t failed \t error. Tabs and newlines in an error become spaces.
inline std::string states() {
    std::vector<std::shared_ptr<Host>> hs;
    {
        auto& r = registry();
        std::lock_guard<std::mutex> g(r.mtx);
        for (auto& [_, h] : r.hosts) hs.push_back(h);
    }
    std::string out;
    auto clean = [](std::string s) {
        for (auto& ch : s) if (ch == '\t' || ch == '\n' || ch == '\r') ch = ' ';
        return s;
    };
    for (auto& h : hs) {
        std::lock_guard<std::mutex> g(h->mtx);
        bool lost = h->lost.load();
        for (auto& l : h->listeners) {
            std::string err = lost ? h->lost_why : l->last_error;
            out += h->key + "\t" + l->id + "\t" + (lost ? "0" : "1") + "\t" + std::to_string(l->port) + "\t" +
                   std::to_string(lost ? 0 : l->live.load()) + "\t" + std::to_string(l->opened.load()) + "\t" +
                   std::to_string(l->failed.load()) + "\t" + clean(err) + "\n";
        }
    }
    return out;
}

}  // namespace flint_tunnel
