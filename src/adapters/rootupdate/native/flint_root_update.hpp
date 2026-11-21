// CFIRE-UPSTREAM: CF-180
//
// flint-update-root's files (milestone 54, D-124, Principle 17), on what core:fs and
// core:os do not have (CF-180): a user's home by uid, a file opened without following a
// link in any part of its path below that home, its owner and kind checked on the open
// file (fstat), and a folder only root can write.
//
// The caller (pkexec's PKEXEC_UID) can change anything in their own home at any moment,
// so nothing here trusts a path twice: each folder of `.cache/flint/update` is opened
// with O_NOFOLLOW below the previous one's descriptor and must belong to the caller, the
// file is opened the same way (O_NONBLOCK: a FIFO never blocks root), checked through its
// descriptor (a regular file the caller owns, one link, not larger than allowed), and
// its bytes are copied from that descriptor into root's own folder. What is verified
// afterwards is that copy.
//
// Windows has no flint-update-root: every function says so.
#pragma once
#include <cstdint>
#include <string>
#if !defined(_WIN32)
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <ftw.h>
#include <pwd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace flint_root {

// The outcome of a copy: 0 copied, 1 nothing there, 2 refused (a link, not a regular
// file, someone else's, too large), 3 an I/O error.
constexpr int COPY_OK = 0;
constexpr int COPY_MISSING = 1;
constexpr int COPY_REFUSED = 2;
constexpr int COPY_IO = 3;

#if !defined(_WIN32)

// The home folder of `uid`, from the system's user database (never $HOME).
inline bool home_of(std::int64_t uid, std::string& home, std::string& err) {
    struct passwd pw;
    struct passwd* found = nullptr;
    char buf[16384];
    if (::getpwuid_r(static_cast<uid_t>(uid), &pw, buf, sizeof buf, &found) != 0 || found == nullptr) {
        err = "no user " + std::to_string(uid);
        return false;
    }
    home = found->pw_dir != nullptr ? found->pw_dir : "";
    if (home.empty() || home[0] != '/') {
        err = "user " + std::to_string(uid) + " has no home folder";
        return false;
    }
    return true;
}

// `.cache/flint/update` below `home`, each part opened without following a link and
// owned by `uid`. The home itself is the administrator's (it may be a link, as on
// Fedora Atomic's /home → /var/home). -1 and `code`/`err` set when it cannot be.
inline int open_stage_dir(std::int64_t uid, const std::string& home, int& code, std::string& err) {
    int dir = ::open(home.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir < 0) {
        code = errno == ENOENT ? COPY_MISSING : COPY_IO;
        err = "cannot open the home folder: " + std::string(std::strerror(errno));
        return -1;
    }
    const char* parts[] = {".cache", "flint", "update"};
    for (const char* part : parts) {
        int next = ::openat(dir, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        int saved = errno;
        ::close(dir);
        if (next < 0) {
            if (saved == ENOENT) {
                code = COPY_MISSING;
                err = "nothing is staged";
            } else {
                // ELOOP or ENOTDIR: a link or a file where a folder should be.
                code = COPY_REFUSED;
                err = std::string("~/.cache/flint/update is not a plain folder (") + part + ")";
            }
            return -1;
        }
        struct stat st;
        if (::fstat(next, &st) != 0 || static_cast<std::int64_t>(st.st_uid) != uid) {
            ::close(next);
            code = COPY_REFUSED;
            err = std::string("~/.cache/flint/update is not the caller's own (") + part + ")";
            return -1;
        }
        dir = next;
    }
    return dir;
}

// Copies `<home>/.cache/flint/update/<name>` (`home` from home_of; a test's own
// folder) to `dest` (in root's folder, created anew,
// 0644), checked as above.
inline int copy_staged(std::int64_t uid, const std::string& home, const std::string& name, std::int64_t max_bytes, const std::string& dest, std::string& err) {
    if (name.empty() || name.find('/') != std::string::npos || name[0] == '.') {
        err = "not a staged file's name";
        return COPY_REFUSED;
    }
    int code = COPY_IO;
    int dir = open_stage_dir(uid, home, code, err);
    if (dir < 0) return code;
    int fd = ::openat(dir, name.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    int saved = errno;
    ::close(dir);
    if (fd < 0) {
        if (saved == ENOENT) {
            err = "nothing is staged (" + name + ")";
            return COPY_MISSING;
        }
        err = name + " is a link or cannot be opened: " + std::string(std::strerror(saved));
        return saved == ELOOP ? COPY_REFUSED : COPY_IO;
    }
    struct stat st;
    if (::fstat(fd, &st) != 0) {
        err = std::strerror(errno);
        ::close(fd);
        return COPY_IO;
    }
    if (!S_ISREG(st.st_mode) || static_cast<std::int64_t>(st.st_uid) != uid || st.st_nlink != 1) {
        ::close(fd);
        err = name + " is not a plain file of the caller's own";
        return COPY_REFUSED;
    }
    if (static_cast<std::int64_t>(st.st_size) > max_bytes) {
        ::close(fd);
        err = name + " is larger than the release says";
        return COPY_REFUSED;
    }
    int out = ::open(dest.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0644);
    if (out < 0) {
        err = "cannot write " + dest + ": " + std::string(std::strerror(errno));
        ::close(fd);
        return COPY_IO;
    }
    // Back to blocking reads now that it is known to be a regular file.
    ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) & ~O_NONBLOCK);
    char buf[65536];
    std::int64_t total = 0;
    int rc = COPY_OK;
    for (;;) {
        ssize_t n = ::read(fd, buf, sizeof buf);
        if (n == 0) break;
        if (n < 0) {
            if (errno == EINTR) continue;
            err = std::strerror(errno);
            rc = COPY_IO;
            break;
        }
        total += n;
        // Grown while being read: refused, whatever it holds.
        if (total > max_bytes) {
            err = name + " is larger than the release says";
            rc = COPY_REFUSED;
            break;
        }
        ssize_t off = 0;
        while (off < n) {
            ssize_t w = ::write(out, buf + off, static_cast<size_t>(n - off));
            if (w < 0) {
                if (errno == EINTR) continue;
                err = std::strerror(errno);
                rc = COPY_IO;
                break;
            }
            off += w;
        }
        if (rc != COPY_OK) break;
    }
    ::close(fd);
    if (::fsync(out) != 0 && rc == COPY_OK) {
        err = std::strerror(errno);
        rc = COPY_IO;
    }
    ::close(out);
    if (rc != COPY_OK) ::unlink(dest.c_str());
    return rc;
}

// A new folder under /var/tmp only root can write (0755: apt's sandbox user may read
// the package; nobody but root may change it).
inline bool make_root_dir(const std::string& base, std::string& path, std::string& err) {
    std::string tmpl = base + "/flint-update-XXXXXX";
    std::string buf = tmpl;
    if (::mkdtemp(&buf[0]) == nullptr) {
        err = std::strerror(errno);
        return false;
    }
    if (::chmod(buf.c_str(), 0755) != 0) {
        err = std::strerror(errno);
        ::rmdir(buf.c_str());
        return false;
    }
    path = buf;
    return true;
}

inline int remove_one(const char* p, const struct stat*, int, struct FTW*) {
    return ::remove(p);
}

inline void remove_tree(const std::string& path) {
    if (!path.empty()) ::nftw(path.c_str(), remove_one, 16, FTW_DEPTH | FTW_PHYS);
}

inline std::int64_t file_size(const std::string& path, std::string& err) {
    struct stat st;
    if (::lstat(path.c_str(), &st) != 0 || !S_ISREG(st.st_mode)) {
        err = "cannot read " + path;
        return -1;
    }
    return static_cast<std::int64_t>(st.st_size);
}

// The uid pkexec ran the helper for (PKEXEC_UID), -1 when there is none; and whether
// this process is root.
inline std::int64_t pkexec_uid() {
    const char* v = std::getenv("PKEXEC_UID");
    if (v == nullptr || *v == 0) return -1;
    char* end = nullptr;
    long long n = std::strtoll(v, &end, 10);
    if (end == nullptr || *end != 0 || n < 0) return -1;
    return static_cast<std::int64_t>(n);
}

inline bool is_root() {
    return ::geteuid() == 0;
}

inline std::int64_t current_uid() {
    return static_cast<std::int64_t>(::getuid());
}

#else

inline bool home_of(std::int64_t, std::string&, std::string& err) {
    err = "flint-update-root runs on Linux only";
    return false;
}
inline int copy_staged(std::int64_t, const std::string&, const std::string&, std::int64_t, const std::string&, std::string& err) {
    err = "flint-update-root runs on Linux only";
    return COPY_IO;
}
inline bool make_root_dir(const std::string&, std::string&, std::string& err) {
    err = "flint-update-root runs on Linux only";
    return false;
}
inline void remove_tree(const std::string&) {}
inline std::int64_t file_size(const std::string&, std::string& err) {
    err = "flint-update-root runs on Linux only";
    return -1;
}
inline std::int64_t pkexec_uid() { return -1; }
inline bool is_root() { return false; }
inline std::int64_t current_uid() { return -1; }

#endif

}  // namespace flint_root
