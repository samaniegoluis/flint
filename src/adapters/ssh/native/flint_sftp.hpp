// CFIRE-UPSTREAM: CF-005, CF-031
//
// libssh SFTP shim for src/adapters/ssh/sftp.cf. cfire has no SSH (CF-005) and no
// top-level cpp block for helpers (CF-031). Every call here runs under the
// connection's mutex, held by the caller, and blocks at most for the session's
// SSH_OPTIONS_TIMEOUT (set at dial, Principle 8): libssh's blocking channel reads
// wait SSH_TIMEOUT_DEFAULT, which is that option.
#pragma once
#include <libssh/libssh.h>
#include <libssh/sftp.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <cstdint>
#include <string>
#include <vector>

namespace flint_sftp {

// Error kinds shared with sftp.cf.
constexpr int OK = 0;
constexpr int NOT_FOUND = 1;
constexpr int PERMISSION = 2;
constexpr int EXISTS = 3;
constexpr int FAILURE = 4;   // the server refused it for another reason
constexpr int NETWORK = 5;   // the session or channel is gone, or timed out
constexpr int NOT_DIR = 6;

struct Entry {
    std::string name;
    std::string kind;  // file, dir, link, other
    int64_t size = 0;
    int64_t mtime = 0;
    int64_t mode = 0;
    int64_t uid = 0;
};

inline int map_error(sftp_session sftp) {
    if (!sftp) return NETWORK;
    switch (sftp_get_error(sftp)) {
        case SSH_FX_OK: return NETWORK;  // no SFTP status: the transport failed
        case SSH_FX_NO_SUCH_FILE:
        case SSH_FX_NO_SUCH_PATH: return NOT_FOUND;
        case SSH_FX_PERMISSION_DENIED:
        case SSH_FX_WRITE_PROTECT: return PERMISSION;
        case SSH_FX_FILE_ALREADY_EXISTS: return EXISTS;
        case SSH_FX_EOF: return FAILURE;
        case SSH_FX_NO_CONNECTION:
        case SSH_FX_CONNECTION_LOST: return NETWORK;
        default: return FAILURE;
    }
}

inline std::string kind_of(uint8_t type) {
    switch (type) {
        case SSH_FILEXFER_TYPE_REGULAR: return "file";
        case SSH_FILEXFER_TYPE_DIRECTORY: return "dir";
        case SSH_FILEXFER_TYPE_SYMLINK: return "link";
        default: return "other";
    }
}

inline void fill(Entry& e, sftp_attributes a) {
    if (a->name) e.name = a->name;
    e.kind = kind_of(a->type);
    e.size = static_cast<int64_t>(a->size);
    e.mtime = static_cast<int64_t>(a->mtime);
    e.mode = static_cast<int64_t>(a->permissions & 07777);
    e.uid = static_cast<int64_t>(a->uid);
}

inline sftp_session open(ssh_session s, std::string& err) {
    sftp_session sftp = sftp_new(s);
    if (!sftp) {
        err = ssh_get_error(s);
        return nullptr;
    }
    if (sftp_init(sftp) != SSH_OK) {
        err = ssh_get_error(s);
        if (err.empty()) err = "the server has no SFTP subsystem";
        sftp_free(sftp);
        return nullptr;
    }
    return sftp;
}

inline int stat_path(sftp_session sftp, const std::string& path, bool follow, Entry& out) {
    sftp_attributes a = follow ? sftp_stat(sftp, path.c_str()) : sftp_lstat(sftp, path.c_str());
    if (!a) return map_error(sftp);
    fill(out, a);
    sftp_attributes_free(a);
    return OK;
}

inline int list(sftp_session sftp, const std::string& path, std::vector<Entry>& out) {
    sftp_dir d = sftp_opendir(sftp, path.c_str());
    if (!d) {
        int rc = map_error(sftp);
        // OpenSSH answers opendir on a file with "no such file" (ENOTDIR).
        if (rc == FAILURE || rc == NOT_FOUND) {
            Entry e;
            if (stat_path(sftp, path, true, e) == OK && e.kind != "dir") return NOT_DIR;
        }
        return rc;
    }
    int rc = OK;
    while (true) {
        sftp_attributes a = sftp_readdir(sftp, d);
        if (!a) {
            if (!sftp_dir_eof(d)) rc = map_error(sftp);
            break;
        }
        std::string name = a->name ? a->name : "";
        if (name != "." && name != "..") {
            Entry e;
            fill(e, a);
            out.push_back(e);
        }
        sftp_attributes_free(a);
    }
    sftp_closedir(d);
    return rc;
}

// `write` true opens for writing: created, truncated, mode 0644, unless `exclusive`
// asks it to fail when the file exists.
inline int open_file(sftp_session sftp, const std::string& path, bool write, bool exclusive, sftp_file& out) {
    int flags = O_RDONLY;
    if (write) {
        flags = O_WRONLY | O_CREAT | O_TRUNC;
        if (exclusive) flags |= O_EXCL;
    }
    out = sftp_open(sftp, path.c_str(), flags, 0644);
    if (!out) {
        int rc = map_error(sftp);
        // SFTP v3 (OpenSSH) has no "already exists" status: O_EXCL on an existing
        // file fails with a plain failure.
        if (rc == FAILURE && exclusive) {
            Entry e;
            if (stat_path(sftp, path, false, e) == OK) return EXISTS;
        }
        return rc;
    }
    return OK;
}

// Up to `max` bytes; "" with OK at the end of the file.
inline int read_file(sftp_session sftp, sftp_file f, size_t max, std::string& out) {
    out.resize(max);
    ssize_t n = sftp_read(f, out.data(), max);
    if (n < 0) {
        out.clear();
        return map_error(sftp);
    }
    out.resize(static_cast<size_t>(n));
    return OK;
}

// libssh 0.11+ splits a write by the server's limits. 0.10 sends it as one request, and
// OpenSSH's sftp-server drops the channel over a 256 KB message, so there each request
// carries at most 32 KB, the size every SFTP server must accept.
#if LIBSSH_VERSION_INT >= SSH_VERSION_INT(0, 11, 0)
inline constexpr size_t kMaxWrite = SIZE_MAX;
#else
inline constexpr size_t kMaxWrite = 32768;
#endif

inline int write_file(sftp_session sftp, sftp_file f, const std::string& data) {
    size_t done = 0;
    while (done < data.size()) {
        size_t left = data.size() - done;
        ssize_t n = sftp_write(f, data.data() + done, left < kMaxWrite ? left : kMaxWrite);
        if (n <= 0) return map_error(sftp);
        done += static_cast<size_t>(n);
    }
    return OK;
}

inline int rename_path(sftp_session sftp, const std::string& from, const std::string& to) {
    return sftp_rename(sftp, from.c_str(), to.c_str()) == 0 ? OK : map_error(sftp);
}

inline int remove_file(sftp_session sftp, const std::string& path) {
    return sftp_unlink(sftp, path.c_str()) == 0 ? OK : map_error(sftp);
}

inline int remove_dir(sftp_session sftp, const std::string& path) {
    return sftp_rmdir(sftp, path.c_str()) == 0 ? OK : map_error(sftp);
}

inline int make_dir(sftp_session sftp, const std::string& path) {
    return sftp_mkdir(sftp, path.c_str(), 0755) == 0 ? OK : map_error(sftp);
}

// Sets `path`'s permission bits (milestone 25: the paste folder 0700, a pasted file
// 0600).
inline int change_mode(sftp_session sftp, const std::string& path, int64_t mode) {
    return sftp_chmod(sftp, path.c_str(), static_cast<mode_t>(mode & 07777)) == 0 ? OK : map_error(sftp);
}

inline int real_path(sftp_session sftp, const std::string& path, std::string& out) {
    char* p = sftp_canonicalize_path(sftp, path.c_str());
    if (!p) return map_error(sftp);
    out = p;
    ssh_string_free_char(p);
    return OK;
}

}  // namespace flint_sftp
