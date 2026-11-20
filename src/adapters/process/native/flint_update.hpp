// CFIRE-UPSTREAM: CF-175
//
// The self-update's processes (milestone 53, src/adapters/process/update.cf): what
// core:os does not do (CF-175):
// - start a program detached from this one, in a session of its own, its output to a
//   log file or nowhere, and get its pid (os.command waits for it);
// - whether a pid is alive, reaping it when it is our child;
// - which processes run an executable from inside a folder (macOS: libproc; Linux:
//   /proc/<pid>/exe), so update-apply waits for every `flint` from the folder;
// - stopping one, SIGTERM then SIGKILL;
// - a file's mode set executable (the CLI copied out of the package).
// Windows comes with milestone 50 (D-118): the functions there report "unsupported".
#pragma once
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>
#if !defined(_WIN32)
#include <cerrno>
#include <climits>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <ftw.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <libproc.h>
#else
#include <dirent.h>
#endif
extern char** environ;
#endif

namespace flint_update {

// fs.rename, fs.remove and fs.realpath take the coercion of C's rename/remove/realpath
// in a package that includes <stdio.h> (CF-158), and a header with <filesystem> hangs
// `cfire check` (CF-176): the three here, on POSIX calls.
#if !defined(_WIN32)
inline bool rename_path(const std::string& from, const std::string& to, std::string& err) {
    if (::rename(from.c_str(), to.c_str()) == 0) return true;
    err = std::strerror(errno);
    return false;
}

inline int remove_one(const char* path, const struct stat*, int, struct FTW*) {
    return ::remove(path);
}

inline bool remove_tree(const std::string& path, std::string& err) {
    struct stat st;
    if (::lstat(path.c_str(), &st) != 0) return true;
    if (::nftw(path.c_str(), remove_one, 32, FTW_DEPTH | FTW_PHYS) == 0) return true;
    err = std::strerror(errno);
    return false;
}

inline std::string real_path(const std::string& path) {
    char buf[PATH_MAX];
    if (::realpath(path.c_str(), buf) == nullptr) return path;
    return std::string(buf);
}
#else
inline bool rename_path(const std::string&, const std::string&, std::string& err) { err = "unsupported"; return false; }
inline bool remove_tree(const std::string&, std::string& err) { err = "unsupported"; return false; }
inline std::string real_path(const std::string& path) { return path; }
#endif

#if !defined(_WIN32)

// Starts `exe` with `args` in a new session, stdin from /dev/null, stdout and stderr to
// `log` (appended) or /dev/null. Returns its pid, or -errno.
inline std::int64_t spawn_detached(const std::string& exe, const std::vector<std::string>& args,
                                   const std::string& log) {
    posix_spawn_file_actions_t fa;
    posix_spawnattr_t at;
    posix_spawn_file_actions_init(&fa);
    posix_spawnattr_init(&at);
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    const char* out = log.empty() ? "/dev/null" : log.c_str();
    posix_spawn_file_actions_addopen(&fa, 1, out, O_WRONLY | O_CREAT | O_APPEND, 0600);
    posix_spawn_file_actions_adddup2(&fa, 1, 2);
    short flags = POSIX_SPAWN_SETSID;
    posix_spawnattr_setflags(&at, flags);
    std::vector<char*> argv;
    argv.push_back(const_cast<char*>(exe.c_str()));
    for (const auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    pid_t pid = 0;
    int rc = posix_spawn(&pid, exe.c_str(), &fa, &at, argv.data(), environ);
    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&at);
    if (rc != 0) return -static_cast<std::int64_t>(rc);
    return static_cast<std::int64_t>(pid);
}

inline bool alive(std::int64_t pid) {
    if (pid <= 0) return false;
    int status = 0;
    // Our own child that exited is reaped here, so it reads as gone, not as a zombie.
    pid_t r = waitpid(static_cast<pid_t>(pid), &status, WNOHANG);
    if (r == static_cast<pid_t>(pid)) return false;
    if (::kill(static_cast<pid_t>(pid), 0) == 0) return true;
    return errno == EPERM;
}

inline void stop(std::int64_t pid) {
    if (pid <= 0) return;
    ::kill(static_cast<pid_t>(pid), SIGTERM);
    for (int i = 0; i < 50 && alive(pid); ++i) usleep(100000);
    if (alive(pid)) ::kill(static_cast<pid_t>(pid), SIGKILL);
    int status = 0;
    waitpid(static_cast<pid_t>(pid), &status, WNOHANG);
}

inline bool inside(const std::string& path, const std::string& dir) {
    return path.size() > dir.size() && path.compare(0, dir.size(), dir) == 0 && path[dir.size()] == '/';
}

// Every process but this one whose executable lies inside `dir` (a real path).
inline std::vector<std::int64_t> running_under(const std::string& dir) {
    std::vector<std::int64_t> out;
    pid_t self = getpid();
#if defined(__APPLE__)
    int n = proc_listallpids(nullptr, 0);
    if (n <= 0) return out;
    std::vector<pid_t> pids(static_cast<size_t>(n) + 64);
    n = proc_listallpids(pids.data(), static_cast<int>(pids.size() * sizeof(pid_t)));
    char buf[PROC_PIDPATHINFO_MAXSIZE];
    for (int i = 0; i < n; ++i) {
        if (pids[i] <= 0 || pids[i] == self) continue;
        if (proc_pidpath(pids[i], buf, sizeof buf) <= 0) continue;
        if (inside(buf, dir)) out.push_back(pids[i]);
    }
#else
    DIR* d = opendir("/proc");
    if (!d) return out;
    while (dirent* e = readdir(d)) {
        char* end = nullptr;
        long pid = std::strtol(e->d_name, &end, 10);
        if (!end || *end != 0 || pid <= 0 || pid == self) continue;
        std::string link = std::string("/proc/") + e->d_name + "/exe";
        char buf[PATH_MAX];
        ssize_t len = readlink(link.c_str(), buf, sizeof buf - 1);
        if (len <= 0) continue;
        buf[len] = 0;
        if (inside(buf, dir)) out.push_back(pid);
    }
    closedir(d);
#endif
    return out;
}

inline bool make_executable(const std::string& path) {
    return ::chmod(path.c_str(), 0755) == 0;
}

#else

inline std::int64_t spawn_detached(const std::string&, const std::vector<std::string>&, const std::string&) { return -1; }
inline bool alive(std::int64_t) { return false; }
inline void stop(std::int64_t) {}
inline std::vector<std::int64_t> running_under(const std::string&) { return {}; }
inline bool make_executable(const std::string&) { return true; }

#endif

}  // namespace flint_update
