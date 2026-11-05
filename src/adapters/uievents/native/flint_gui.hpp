// CFIRE-UPSTREAM: CF-002, CF-026, CF-031
//
// Native helpers for the GUI's webui adapters (src/adapters/uievents):
//
// * Session mailboxes. A GUI session runs on a worker thread while its keystrokes,
//   resizes and prompt answers arrive on the UI thread. cfire has no mutex or
//   condition variable usable across threads, and a Channel has no receive with a
//   timeout (CF-026), so each session gets a mailbox here, found by session id.
// * Trimming webui's history. `App.emit()` and every RPC reply keep their payload in
//   memory forever (CF-002). A terminal emits for hours, so the history is cleared
//   from time to time. `App` keeps its state private and has no API for this, so the
//   pointer is reached through the standard explicit-instantiation access rule.
// * No top-level cpp block in a .cf file (CF-031), hence this header.
#pragma once
#include "core/webui.hpp"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace flint_gui {

// ---- Session mailboxes ------------------------------------------------------------

struct Mailbox {
    std::mutex mtx;
    std::condition_variable cv;
    std::string input;      // keystrokes not yet sent
    int cols = 0;
    int rows = 0;
    bool resized = false;
    bool closed = false;    // the tab was closed: input ends, prompts cancel
    bool has_answer = false;
    bool answer_ok = false; // false: the person cancelled the prompt
    std::string answer;     // a typed secret; wiped once taken
    std::string prompt_id;  // the prompt waiting for an answer, "" when none
};

struct Registry {
    std::mutex mtx;
    std::unordered_map<std::string, std::shared_ptr<Mailbox>> boxes;
};

inline Registry& registry() {
    static Registry r;
    return r;
}

inline std::shared_ptr<Mailbox> find(const std::string& id) {
    auto& r = registry();
    std::lock_guard<std::mutex> lock(r.mtx);
    auto it = r.boxes.find(id);
    return it == r.boxes.end() ? nullptr : it->second;
}

inline void wipe(std::string& s) {
    volatile char* p = s.data();
    for (std::size_t i = 0; i < s.size(); ++i) p[i] = 0;
    s.clear();
}

// Returns false when a mailbox with that id already exists.
inline bool open_box(const std::string& id, int cols, int rows) {
    auto& r = registry();
    std::lock_guard<std::mutex> lock(r.mtx);
    if (r.boxes.count(id)) return false;
    auto box = std::make_shared<Mailbox>();
    box->cols = cols;
    box->rows = rows;
    r.boxes[id] = box;
    return true;
}

// Marks the session closed and wakes its worker. The mailbox stays until the
// worker drops it, so a late keystroke finds a closed box rather than none.
inline bool close_box(const std::string& id) {
    auto box = find(id);
    if (!box) return false;
    {
        std::lock_guard<std::mutex> lock(box->mtx);
        box->closed = true;
        wipe(box->answer);
    }
    box->cv.notify_all();
    return true;
}

inline void drop_box(const std::string& id) {
    close_box(id);
    auto& r = registry();
    std::lock_guard<std::mutex> lock(r.mtx);
    r.boxes.erase(id);
}

inline int open_count() {
    auto& r = registry();
    std::lock_guard<std::mutex> lock(r.mtx);
    return static_cast<int>(r.boxes.size());
}

// 0 ok, 1 no such session, 2 closed.
inline int push_input(const std::string& id, const std::string& data) {
    auto box = find(id);
    if (!box) return 1;
    {
        std::lock_guard<std::mutex> lock(box->mtx);
        if (box->closed) return 2;
        box->input += data;
    }
    box->cv.notify_all();
    return 0;
}

inline int set_size(const std::string& id, int cols, int rows) {
    auto box = find(id);
    if (!box) return 1;
    {
        std::lock_guard<std::mutex> lock(box->mtx);
        if (box->closed) return 2;
        if (box->cols != cols || box->rows != rows) {
            box->cols = cols;
            box->rows = rows;
            box->resized = true;
        }
    }
    box->cv.notify_all();
    return 0;
}

inline void get_size(const std::string& id, int& cols, int& rows) {
    cols = 0;
    rows = 0;
    auto box = find(id);
    if (!box) return;
    std::lock_guard<std::mutex> lock(box->mtx);
    cols = box->cols;
    rows = box->rows;
}

inline bool take_resize(const std::string& id) {
    auto box = find(id);
    if (!box) return false;
    std::lock_guard<std::mutex> lock(box->mtx);
    bool r = box->resized;
    box->resized = false;
    return r;
}

// Waits up to timeout_ms for keystrokes. 0 ok (out may be empty), 2 closed.
inline int take_input(const std::string& id, int timeout_ms, std::string& out) {
    out.clear();
    auto box = find(id);
    if (!box) return 2;
    std::unique_lock<std::mutex> lock(box->mtx);
    box->cv.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                     [&] { return box->closed || !box->input.empty() || box->resized; });
    if (box->closed) return 2;
    out.swap(box->input);
    return 0;
}

// Arms a prompt so that only an answer for `prompt_id` is accepted.
inline int arm_prompt(const std::string& id, const std::string& prompt_id) {
    auto box = find(id);
    if (!box) return 1;
    std::lock_guard<std::mutex> lock(box->mtx);
    if (box->closed) return 2;
    box->prompt_id = prompt_id;
    box->has_answer = false;
    box->answer_ok = false;
    wipe(box->answer);
    return 0;
}

// 0 ok, 1 no such session, 2 closed, 3 no such prompt.
inline int answer_prompt(const std::string& id, const std::string& prompt_id, bool ok, const std::string& value) {
    auto box = find(id);
    if (!box) return 1;
    {
        std::lock_guard<std::mutex> lock(box->mtx);
        if (box->closed) return 2;
        if (box->prompt_id.empty() || box->prompt_id != prompt_id) return 3;
        box->has_answer = true;
        box->answer_ok = ok;
        box->answer = value;
    }
    box->cv.notify_all();
    return 0;
}

// Waits for the armed prompt's answer. 0 answered, 1 cancelled, 2 closed, 4 timed
// out. The secret moves into `out` and is wiped from the mailbox.
inline int await_answer(const std::string& id, int timeout_ms, std::string& out) {
    out.clear();
    auto box = find(id);
    if (!box) return 2;
    std::unique_lock<std::mutex> lock(box->mtx);
    bool woke = box->cv.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                                 [&] { return box->closed || box->has_answer; });
    box->prompt_id.clear();
    if (box->closed) return 2;
    if (!woke) return 4;
    box->has_answer = false;
    if (!box->answer_ok) {
        wipe(box->answer);
        return 1;
    }
    out = box->answer;
    wipe(box->answer);
    return 0;
}

// ---- Ids and webui history (CF-002) -------------------------------------------------

// A process-wide counter for prompt ids.
inline long long next_seq() {
    static std::atomic<long long> n{0};
    return ++n;
}

// True once every `every` calls: when to trim webui's history.
inline bool note_emit(int every) {
    static std::atomic<long long> n{0};
    return (++n % every) == 0;
}

using AppStatePtr = std::shared_ptr<cfire::webui::detail::AppState> cfire::webui::App::*;

struct AppStateAccess {
    friend AppStatePtr app_state_member(AppStateAccess);
};

template <AppStatePtr Member>
struct AppStateRobber {
    friend AppStatePtr app_state_member(AppStateAccess) { return Member; }
};

template struct AppStateRobber<&cfire::webui::App::state_>;

inline void trim_history(cfire::webui::App& app) {
    auto& st = app.*app_state_member(AppStateAccess{});
    if (!st) return;
    std::lock_guard<std::recursive_mutex> lock(st->mtx);
    st->emitted_history.clear();
    st->eval_history.clear();
}

} // namespace flint_gui
