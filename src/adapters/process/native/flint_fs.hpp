// CFIRE-UPSTREAM: CF-099, CF-031
//
// Local file shim for src/adapters/process/local_fs.cf (milestone 16). core:fs has
// no stat (kind, size, mtime, mode), no lstat, no exclusive create and no errno to
// tell "not found" from "permission denied" (CF-099); cfire has no top-level cpp
// block for helpers (CF-031).
#pragma once
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace flint_fs {

// Error kinds, the same numbers as flint_sftp's.
constexpr int OK = 0;
constexpr int NOT_FOUND = 1;
constexpr int PERMISSION = 2;
constexpr int EXISTS = 3;
constexpr int FAILURE = 4;
constexpr int NOT_DIR = 6;
constexpr int IS_DIR = 7;

struct Entry {
    std::string name;
    std::string kind;
    int64_t size = 0;
    int64_t mtime = 0;
    int64_t mode = 0;
};

inline int map_errno(int e) {
    switch (e) {
        case ENOENT: return NOT_FOUND;
        case EACCES:
        case EPERM:
        case EROFS: return PERMISSION;
        case EEXIST: return EXISTS;
        case ENOTDIR: return NOT_DIR;
        case EISDIR: return IS_DIR;
        default: return FAILURE;
    }
}

inline void fill(Entry& e, const struct stat& st) {
    if (S_ISREG(st.st_mode)) e.kind = "file";
    else if (S_ISDIR(st.st_mode)) e.kind = "dir";
    else if (S_ISLNK(st.st_mode)) e.kind = "link";
    else e.kind = "other";
    e.size = static_cast<int64_t>(st.st_size);
    e.mtime = static_cast<int64_t>(st.st_mtime);
    e.mode = static_cast<int64_t>(st.st_mode & 07777);
}

inline int stat_path(const std::string& path, bool follow, Entry& out, std::string& err) {
    struct stat st;
    int rc = follow ? ::stat(path.c_str(), &st) : ::lstat(path.c_str(), &st);
    if (rc != 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    fill(out, st);
    return OK;
}

inline int list(const std::string& path, std::vector<Entry>& out, std::string& err) {
    DIR* d = ::opendir(path.c_str());
    if (!d) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    while (struct dirent* de = ::readdir(d)) {
        std::string name = de->d_name;
        if (name == "." || name == "..") continue;
        Entry e;
        e.name = name;
        std::string ignored;
        if (stat_path(path + "/" + name, false, e, ignored) == OK) out.push_back(e);
    }
    ::closedir(d);
    return OK;
}

// Opens for reading, or for writing (created 0644, truncated; `exclusive` refuses an
// existing file). Returns the descriptor, or -1 with `rc` set.
inline int open_file(const std::string& path, bool write, bool exclusive, int& rc, std::string& err) {
    int flags = O_RDONLY | O_CLOEXEC;
    if (write) {
        flags = O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC;
        if (exclusive) flags |= O_EXCL;
    }
    int fd = ::open(path.c_str(), flags, 0644);
    if (fd < 0) {
        err = std::strerror(errno);
        rc = map_errno(errno);
        return -1;
    }
    if (!write) {
        struct stat st;
        if (::fstat(fd, &st) == 0 && S_ISDIR(st.st_mode)) {
            ::close(fd);
            rc = IS_DIR;
            err = "is a folder";
            return -1;
        }
    }
    rc = OK;
    return fd;
}

inline int read_file(int fd, size_t max, std::string& out, std::string& err) {
    out.resize(max);
    ssize_t n;
    do {
        n = ::read(fd, out.data(), max);
    } while (n < 0 && errno == EINTR);
    if (n < 0) {
        err = std::strerror(errno);
        out.clear();
        return map_errno(errno);
    }
    out.resize(static_cast<size_t>(n));
    return OK;
}

inline int write_file(int fd, const std::string& data, std::string& err) {
    size_t done = 0;
    while (done < data.size()) {
        ssize_t n = ::write(fd, data.data() + done, data.size() - done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            err = std::strerror(errno);
            return map_errno(errno);
        }
        done += static_cast<size_t>(n);
    }
    return OK;
}

// Closes `fd`; with `sync`, flushes it to disk first (a finished download).
inline int close_file(int fd, bool sync, std::string& err) {
    int rc = OK;
    if (sync && ::fsync(fd) != 0) {
        err = std::strerror(errno);
        rc = map_errno(errno);
    }
    if (::close(fd) != 0 && rc == OK) {
        err = std::strerror(errno);
        rc = map_errno(errno);
    }
    return rc;
}

inline int rename_path(const std::string& from, const std::string& to, std::string& err) {
    if (::rename(from.c_str(), to.c_str()) != 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    return OK;
}

// Milestone 40: a re-keyed vault copy gets the vault's own permission bits.
inline int chmod_path(const std::string& path, mode_t mode, std::string& err) {
    if (::chmod(path.c_str(), mode) != 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    return OK;
}

// Flushes a folder, so a rename into it is on disk (milestone 40).
inline int sync_dir(const std::string& path, std::string& err) {
    int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    int rc = ::fsync(fd) == 0 ? OK : map_errno(errno);
    if (rc != OK) err = std::strerror(errno);
    ::close(fd);
    return rc;
}

// A file, or an empty folder.
inline int remove_path(const std::string& path, std::string& err) {
    struct stat st;
    int rc = (::lstat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) ? ::rmdir(path.c_str()) : ::unlink(path.c_str());
    if (rc != 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    return OK;
}

inline int make_dir(const std::string& path, std::string& err) {
    if (::mkdir(path.c_str(), 0755) != 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    return OK;
}

// Creates every missing folder of `path` with `mode` (0700 for Flint's own drops).
inline int make_dirs(const std::string& path, mode_t mode, std::string& err) {
    std::string acc;
    std::size_t i = 0;
    while (i <= path.size()) {
        std::size_t j = path.find('/', i);
        if (j == std::string::npos) j = path.size();
        acc = path.substr(0, j);
        if (!acc.empty() && ::mkdir(acc.c_str(), mode) != 0 && errno != EEXIST) {
            err = std::strerror(errno);
            return map_errno(errno);
        }
        i = j + 1;
    }
    return OK;
}

// Appends `data` to `path`, created 0600 when missing (a dropped file being staged).
inline int append_file(const std::string& path, const std::string& data, std::string& err) {
    int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    std::size_t off = 0;
    while (off < data.size()) {
        ssize_t n = ::write(fd, data.data() + off, data.size() - off);
        if (n < 0) {
            if (errno == EINTR) continue;
            err = std::strerror(errno);
            int rc = map_errno(errno);
            ::close(fd);
            return rc;
        }
        off += static_cast<std::size_t>(n);
    }
    ::close(fd);
    return OK;
}

}  // namespace flint_fs
