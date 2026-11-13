// CFIRE-UPSTREAM: CF-099, CF-031
//
// Local file shim for src/adapters/process/local_fs.cf (milestone 16). core:fs has
// no stat (kind, size, mtime, mode), no lstat, no exclusive create and no errno to
// tell "not found" from "permission denied" (CF-099); cfire has no top-level cpp
// block for helpers (CF-031).
#pragma once
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <vector>
#if defined(_WIN32)
#include <io.h>
#include <windows.h>
#else
#include <dirent.h>
#include <unistd.h>
#endif

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

#if defined(_WIN32)
// Windows (windows-port). Paths arrive as UTF-8 and go to the wide APIs, so names
// outside the ANSI code page work; files open in binary mode (no "\n" -> "\r\n").
// Modes are synthesised: 0755 for folders, 0644 for files, 0444 when read-only.

inline std::wstring wide(const std::string& s) {
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

inline std::string utf8(const wchar_t* w) {
    int n = ::WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
    if (n > 1) ::WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    return s;
}

inline int map_win(DWORD e) {
    switch (e) {
        case ERROR_FILE_NOT_FOUND:
        case ERROR_PATH_NOT_FOUND:
        case ERROR_INVALID_NAME: return NOT_FOUND;
        case ERROR_ACCESS_DENIED:
        case ERROR_SHARING_VIOLATION:
        case ERROR_WRITE_PROTECT: return PERMISSION;
        case ERROR_FILE_EXISTS:
        case ERROR_ALREADY_EXISTS: return EXISTS;
        case ERROR_DIRECTORY: return NOT_DIR;
        case ERROR_DIR_NOT_EMPTY: return FAILURE;
        default: return FAILURE;
    }
}

inline std::string win_text(DWORD e) {
    wchar_t* buf = nullptr;
    ::FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                     nullptr, e, 0, reinterpret_cast<wchar_t*>(&buf), 0, nullptr);
    std::string out = buf ? utf8(buf) : "error " + std::to_string(e);
    if (buf) ::LocalFree(buf);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == '.')) out.pop_back();
    return out;
}

inline int fail_win(std::string& err) {
    DWORD e = ::GetLastError();
    err = win_text(e);
    return map_win(e);
}

inline int64_t unix_time(FILETIME ft) {
    int64_t t = (static_cast<int64_t>(ft.dwHighDateTime) << 32) | ft.dwLowDateTime;
    return t / 10000000 - 11644473600LL;
}

inline void fill_attrs(Entry& e, DWORD attrs, DWORD size_hi, DWORD size_lo, FILETIME mtime, bool follow) {
    if ((attrs & FILE_ATTRIBUTE_REPARSE_POINT) && !follow) e.kind = "link";
    else if (attrs & FILE_ATTRIBUTE_DIRECTORY) e.kind = "dir";
    else e.kind = "file";
    e.size = e.kind == "file" ? ((static_cast<int64_t>(size_hi) << 32) | size_lo) : 0;
    e.mtime = unix_time(mtime);
    e.mode = (attrs & FILE_ATTRIBUTE_DIRECTORY) ? 0755 : ((attrs & FILE_ATTRIBUTE_READONLY) ? 0444 : 0644);
}

inline int stat_path(const std::string& path, bool follow, Entry& out, std::string& err) {
    WIN32_FILE_ATTRIBUTE_DATA d;
    if (!::GetFileAttributesExW(wide(path).c_str(), GetFileExInfoStandard, &d)) return fail_win(err);
    if (follow && (d.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        // Follow the link: open the target and ask it.
        HANDLE h = ::CreateFileW(wide(path).c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                 OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
        if (h == INVALID_HANDLE_VALUE) return fail_win(err);
        BY_HANDLE_FILE_INFORMATION bi;
        bool ok = ::GetFileInformationByHandle(h, &bi) != FALSE;
        ::CloseHandle(h);
        if (!ok) return fail_win(err);
        fill_attrs(out, bi.dwFileAttributes & ~FILE_ATTRIBUTE_REPARSE_POINT, bi.nFileSizeHigh, bi.nFileSizeLow,
                   bi.ftLastWriteTime, true);
        return OK;
    }
    fill_attrs(out, d.dwFileAttributes, d.nFileSizeHigh, d.nFileSizeLow, d.ftLastWriteTime, follow);
    return OK;
}

inline int list(const std::string& path, std::vector<Entry>& out, std::string& err) {
    WIN32_FIND_DATAW fd;
    HANDLE h = ::FindFirstFileW(wide(path + "/*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) {
        DWORD e = ::GetLastError();
        if (e == ERROR_FILE_NOT_FOUND) return OK;  // an empty drive root
        err = win_text(e);
        return map_win(e);
    }
    do {
        std::string name = utf8(fd.cFileName);
        if (name == "." || name == "..") continue;
        Entry e;
        e.name = name;
        fill_attrs(e, fd.dwFileAttributes, fd.nFileSizeHigh, fd.nFileSizeLow, fd.ftLastWriteTime, false);
        out.push_back(e);
    } while (::FindNextFileW(h, &fd));
    ::FindClose(h);
    return OK;
}

inline int open_file(const std::string& path, bool write, bool exclusive, int& rc, std::string& err) {
    DWORD attrs = ::GetFileAttributesW(wide(path).c_str());
    if (!write && attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
        rc = IS_DIR;
        err = "is a folder";
        return -1;
    }
    int flags = _O_RDONLY | _O_BINARY | _O_NOINHERIT;
    if (write) {
        flags = _O_WRONLY | _O_CREAT | _O_TRUNC | _O_BINARY | _O_NOINHERIT;
        if (exclusive) flags |= _O_EXCL;
    }
    int fd = ::_wopen(wide(path).c_str(), flags, _S_IREAD | _S_IWRITE);
    if (fd < 0) {
        err = std::strerror(errno);
        rc = map_errno(errno);
        return -1;
    }
    rc = OK;
    return fd;
}

inline int read_file(int fd, size_t max, std::string& out, std::string& err) {
    out.resize(max);
    int n = ::_read(fd, out.data(), static_cast<unsigned>(max));
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
        int n = ::_write(fd, data.data() + done, static_cast<unsigned>(data.size() - done));
        if (n <= 0) {
            err = std::strerror(errno);
            return map_errno(errno);
        }
        done += static_cast<size_t>(n);
    }
    return OK;
}

inline int close_file(int fd, bool sync, std::string& err) {
    int rc = OK;
    if (sync && ::_commit(fd) != 0) {
        err = std::strerror(errno);
        rc = map_errno(errno);
    }
    if (::_close(fd) != 0 && rc == OK) {
        err = std::strerror(errno);
        rc = map_errno(errno);
    }
    return rc;
}

// Replaces `to` when it exists, as POSIX rename does (CRT rename refuses). Write-through:
// the move is on disk when it returns, which stands in for sync_dir on POSIX.
inline int rename_path(const std::string& from, const std::string& to, std::string& err) {
    if (!::MoveFileExW(wide(from).c_str(), wide(to).c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return fail_win(err);
    return OK;
}

// Milestone 40: POSIX permission bits do not exist here; the file inherits the ACL of
// the user's profile folder, which only that user (and administrators) can read.
inline int chmod_path(const std::string&, mode_t, std::string&) { return OK; }

// Milestone 40: a folder cannot be flushed on Windows; rename_path writes through instead.
inline int sync_dir(const std::string&, std::string&) { return OK; }

// The path with every link and junction resolved (milestone 41, CF-136), or the path as
// given when it does not exist or cannot be resolved. `\\?\` is dropped, and
// `\\?\UNC\server\share` becomes `\\server\share`.
inline std::string real_path(const std::string& path) {
    HANDLE h = ::CreateFileW(wide(path).c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                             OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (h == INVALID_HANDLE_VALUE) return path;
    std::wstring buf(MAX_PATH, L'\0');
    DWORD n = ::GetFinalPathNameByHandleW(h, buf.data(), static_cast<DWORD>(buf.size()), FILE_NAME_NORMALIZED);
    if (n >= buf.size()) {
        buf.assign(n + 1, L'\0');
        n = ::GetFinalPathNameByHandleW(h, buf.data(), static_cast<DWORD>(buf.size()), FILE_NAME_NORMALIZED);
    }
    ::CloseHandle(h);
    if (n == 0 || n >= buf.size()) return path;
    buf.resize(n);
    if (buf.rfind(L"\\\\?\\UNC\\", 0) == 0) buf = L"\\\\" + buf.substr(8);
    else if (buf.rfind(L"\\\\?\\", 0) == 0) buf = buf.substr(4);
    return utf8(buf.c_str());
}

inline int remove_path(const std::string& path, std::string& err) {
    DWORD attrs = ::GetFileAttributesW(wide(path).c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) return fail_win(err);
    BOOL ok = (attrs & FILE_ATTRIBUTE_DIRECTORY) ? ::RemoveDirectoryW(wide(path).c_str()) : ::DeleteFileW(wide(path).c_str());
    if (!ok) return fail_win(err);
    return OK;
}

inline int make_dir(const std::string& path, std::string& err) {
    if (!::CreateDirectoryW(wide(path).c_str(), nullptr)) return fail_win(err);
    return OK;
}

// Every missing folder of `path`. `mode` has no Windows meaning: the folders inherit
// the parent's ACL (Flint's drops live under the user's profile, private already).
inline int make_dirs(const std::string& path, int mode, std::string& err) {
    (void)mode;
    std::size_t i = 0;
    while (i <= path.size()) {
        std::size_t j = path.find_first_of("/\\", i);
        if (j == std::string::npos) j = path.size();
        std::string acc = path.substr(0, j);
        bool drive = acc.size() == 2 && acc[1] == ':';
        if (!acc.empty() && !drive && !::CreateDirectoryW(wide(acc).c_str(), nullptr)) {
            DWORD e = ::GetLastError();
            if (e != ERROR_ALREADY_EXISTS && e != ERROR_ACCESS_DENIED) {
                err = win_text(e);
                return map_win(e);
            }
            DWORD a = ::GetFileAttributesW(wide(acc).c_str());
            if (a == INVALID_FILE_ATTRIBUTES || !(a & FILE_ATTRIBUTE_DIRECTORY)) {
                err = win_text(e);
                return map_win(e);
            }
        }
        i = j + 1;
    }
    return OK;
}

inline int append_file(const std::string& path, const std::string& data, std::string& err) {
    int fd = ::_wopen(wide(path).c_str(), _O_WRONLY | _O_CREAT | _O_APPEND | _O_BINARY | _O_NOINHERIT, _S_IREAD | _S_IWRITE);
    if (fd < 0) {
        err = std::strerror(errno);
        return map_errno(errno);
    }
    std::string ignored;
    int rc = write_file(fd, data, err);
    ::_close(fd);
    return rc;
}

#else
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

// The path with every symbolic link resolved (realpath(3), milestone 41, CF-136), or
// the path as given when it does not exist or cannot be resolved.
inline std::string real_path(const std::string& path) {
    char real[PATH_MAX];
    if (::realpath(path.c_str(), real)) return std::string(real);
    return path;
}

#endif

}  // namespace flint_fs
