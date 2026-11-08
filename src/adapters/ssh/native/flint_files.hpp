// CFIRE-UPSTREAM: CF-026, CF-031
//
// The Files view's registry (milestone 17, D-053): the SSH session a GUI tab runs,
// found by session id, so SFTP requests from other threads can ride it.
//
// * A tab's worker publishes its last hop once the shell is open, and detaches it
//   before hanging up. Detach waits until no request still uses the session, so the
//   session is never freed under a request (each request is bounded by the dial
//   timeout, Principle 8, and so is the wait).
// * Browsing shares one SFTP channel per session, one request at a time; every
//   transfer opens its own channel on the same session and closes it when done.
// * A transfer's cancel flag lives here, found by transfer id.
//
// cfire has no mutex or condition variable usable across threads (CF-026), and no
// top-level cpp block in a .cf file (CF-031), hence this header.
#pragma once
#include <libssh/libssh.h>
#include <libssh/sftp.h>
#include <chrono>
#include <cstdio>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>

namespace flint_files {

struct Shared {
    ssh_session session = nullptr;
    std::shared_ptr<std::mutex> lock;  // the hop's own mutex (SshConn.lock)
    long long timeout_secs = 0;
    int users = 0;                      // requests and transfers using the session
    bool closed = false;                // detaching: no new user
    bool browsing = false;              // the browse channel is lent out
    sftp_session browse = nullptr;      // the shared browse channel, or none
    std::set<std::string> transfers;    // ids of transfers running on it
};

struct Registry {
    std::mutex mtx;
    std::condition_variable cv;
    std::unordered_map<std::string, std::shared_ptr<Shared>> sessions;
    std::set<std::string> cancelled;    // transfer ids asked to stop
};

inline Registry& registry() {
    static Registry r;
    return r;
}

inline void publish(const std::string& id, ssh_session s, std::shared_ptr<std::mutex> lock, long long timeout_secs) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    auto sh = std::make_shared<Shared>();
    sh->session = s;
    sh->lock = std::move(lock);
    sh->timeout_secs = timeout_secs;
    r.sessions[id] = sh;
    r.cv.notify_all();
}

// 0: lent (the session and, when browsing, the browse channel are filled in);
// 1: no such session (never published, or detached); 2: busy past the wait.
inline int borrow(const std::string& id, bool browse, const std::string& transfer,
                  ssh_session& s, std::shared_ptr<std::mutex>& lock, long long& timeout_secs,
                  sftp_session& channel) {
    auto& r = registry();
    std::unique_lock<std::mutex> g(r.mtx);
    auto it = r.sessions.find(id);
    if (it == r.sessions.end() || it->second->closed) return 1;
    auto sh = it->second;
    if (browse) {
        // One browse request at a time; each is bounded, so the wait is too.
        auto limit = std::chrono::seconds(sh->timeout_secs > 0 ? sh->timeout_secs * 2 + 5 : 30);
        if (!r.cv.wait_for(g, limit, [&] { return sh->closed || !sh->browsing; })) return 2;
        if (sh->closed) return 1;
        sh->browsing = true;
        channel = sh->browse;
    } else {
        channel = nullptr;
        sh->transfers.insert(transfer);
    }
    sh->users += 1;
    s = sh->session;
    lock = sh->lock;
    timeout_secs = sh->timeout_secs;
    return 0;
}

// Gives a borrowed session back. A browse borrow hands back its channel (opened
// on the way, or none if it broke); a transfer has closed its own.
inline void give_back(const std::string& id, bool browse, const std::string& transfer, sftp_session channel) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    r.cancelled.erase(transfer);
    auto it = r.sessions.find(id);
    if (it != r.sessions.end()) {
        auto sh = it->second;
        if (browse) {
            sh->browse = channel;
            sh->browsing = false;
        } else {
            sh->transfers.erase(transfer);
        }
        sh->users -= 1;
    }
    r.cv.notify_all();
}

inline void cancel(const std::string& transfer) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    r.cancelled.insert(transfer);
}

inline bool is_cancelled(const std::string& transfer) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    return r.cancelled.count(transfer) > 0;
}

// Stops new requests, cancels the session's transfers, waits for every user to
// give the session back (bounded), then frees the browse channel. True when the
// session is no longer used; false when a request outlived the wait.
inline bool detach(const std::string& id) {
    auto& r = registry();
    std::unique_lock<std::mutex> g(r.mtx);
    auto it = r.sessions.find(id);
    if (it == r.sessions.end()) return true;
    auto sh = it->second;
    sh->closed = true;
    for (auto& t : sh->transfers) r.cancelled.insert(t);
    r.cv.notify_all();
    auto limit = std::chrono::seconds(sh->timeout_secs > 0 ? sh->timeout_secs * 2 + 5 : 30);
    bool idle = r.cv.wait_for(g, limit, [&] { return sh->users == 0; });
    if (idle && sh->browse) {
        std::lock_guard<std::mutex> hop(*sh->lock);
        sftp_free(sh->browse);
        sh->browse = nullptr;
    }
    r.sessions.erase(id);
    return idle;
}

inline bool has(const std::string& id) {
    auto& r = registry();
    std::lock_guard<std::mutex> g(r.mtx);
    auto it = r.sessions.find(id);
    return it != r.sessions.end() && !it->second->closed;
}

}  // namespace flint_files
