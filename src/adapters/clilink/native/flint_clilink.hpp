// The `flint` command's link on the PATH (milestone 48): lstat, readlink, symlink and
// unlink, which core:fs lacks, and on macOS the same through an administrator's
// password for a folder this process cannot write.
// CFIRE-UPSTREAM: CF-171
#pragma once
#include <string>
#include <vector>
#if !defined(_WIN32)
#include <cerrno>
#include <cstring>
#include <climits>
#include <cstdlib>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <spawn.h>
extern char** environ;
#endif

namespace flint_clilink {

struct Probe {
    bool exists = false;
    bool is_link = false;
    std::string target;
    bool target_exists = false;
    bool dir_writable = false;
};

inline std::string parent_of(const std::string& path) {
    auto slash = path.rfind('/');
    return slash == std::string::npos || slash == 0 ? "/" : path.substr(0, slash);
}

#if !defined(_WIN32)
// The nearest folder of `path` that exists: whether a link can be made there without
// an administrator depends on it (~/.local/bin may not exist yet).
inline std::string existing_ancestor(std::string dir) {
    struct stat st{};
    while (dir.size() > 1 && ::stat(dir.c_str(), &st) != 0) dir = parent_of(dir);
    return dir;
}

inline Probe probe(const std::string& path) {
    Probe p;
    struct stat st{};
    if (::lstat(path.c_str(), &st) == 0) {
        p.is_link = S_ISLNK(st.st_mode);
        p.exists = !p.is_link || ::stat(path.c_str(), &st) == 0;
        if (p.is_link) {
            char buf[PATH_MAX];
            ssize_t n = ::readlink(path.c_str(), buf, sizeof buf - 1);
            if (n > 0) {
                buf[n] = 0;
                p.target = buf;
            }
            p.target_exists = p.exists;
        }
    }
    p.dir_writable = ::access(existing_ancestor(parent_of(path)).c_str(), W_OK) == 0;
    return p;
}

inline bool exists(const std::string& path) {
    struct stat st{};
    return ::stat(path.c_str(), &st) == 0;
}

// Runs argv and waits; true on exit 0.
inline bool run(const std::vector<std::string>& args) {
    std::vector<char*> argv;
    for (auto& a : args) argv.push_back(const_cast<char*>(a.c_str()));
    argv.push_back(nullptr);
    pid_t pid = 0;
    if (::posix_spawnp(&pid, argv[0], nullptr, nullptr, argv.data(), environ) != 0) return false;
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

// 'x' → '\'' quoting for sh, then \ and " escaped for an AppleScript string.
inline std::string sh_quote(const std::string& s) {
    std::string out = "'";
    for (char c : s) out += (c == '\'') ? std::string("'\\''") : std::string(1, c);
    return out + "'";
}
inline std::string as_string(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '\\' || c == '"') out += '\\';
        out += c;
    }
    return out + "\"";
}

// macOS's own password dialog runs the command as an administrator; "" when it ran,
// else why not ("cancelled" when the person closed the dialog).
inline std::string run_as_admin(const std::string& command) {
#if defined(__APPLE__)
    std::string script = "do shell script " + as_string(command) + " with administrator privileges";
    return run({"/usr/bin/osascript", "-e", script}) ? "" : "cancelled";
#else
    (void)command;
    return "unsupported";
#endif
}

// "" on success, else the reason.
inline std::string make(const std::string& target, const std::string& path, bool admin) {
    std::string dir = parent_of(path);
    if (admin) {
        return run_as_admin("mkdir -p " + sh_quote(dir) + " && ln -sfn " + sh_quote(target) + " " + sh_quote(path));
    }
    if (!run({"/bin/mkdir", "-p", dir})) return "could not create " + dir;
    // A link next to it, renamed over the old one, so the command never disappears.
    std::string tmp = path + ".flint-new";
    ::unlink(tmp.c_str());
    if (::symlink(target.c_str(), tmp.c_str()) != 0) return std::string("could not link: ") + std::strerror(errno);
    if (::rename(tmp.c_str(), path.c_str()) != 0) {
        int e = errno;
        ::unlink(tmp.c_str());
        return std::string("could not link: ") + std::strerror(e);
    }
    return "";
}

inline std::string remove(const std::string& path, bool admin) {
    if (admin) return run_as_admin("rm -f " + sh_quote(path));
    if (::unlink(path.c_str()) != 0 && errno != ENOENT) return std::string("could not remove: ") + std::strerror(errno);
    return "";
}
#else
inline Probe probe(const std::string&) { return Probe{}; }
inline bool exists(const std::string&) { return false; }
inline std::string make(const std::string&, const std::string&, bool) { return "unsupported"; }
inline std::string remove(const std::string&, bool) { return "unsupported"; }
#endif

}  // namespace flint_clilink
