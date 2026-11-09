// CFIRE-UPSTREAM: CF-024, CF-031, CF-042
//
// Process shim for src/adapters/process/process.cf: what cfire's core:os and
// core:cli do not cover the way Flint needs it (CF-024, CF-042):
// - stderr writes that flush stdout first, so the two streams keep their order;
// - prompts on /dev/tty, so a password is asked for even when stdin is piped
//   (cli.prompt_password reads stdin);
// - raw mode restored at exit and on SIGINT/SIGTERM/SIGHUP (os.make_raw restores
//   only at scope exit, and os.on_signal runs a std::function inside the handler);
// - the window size, 0x0 when unknown (os.term_size reports 80 columns);
// - the executable's folder and the OS name (CF-031);
// - a per-thread capture of stdout and stderr, with no terminal and an empty stdin,
//   for a CLI command the app runs for a client on its socket (D-038): the output
//   goes back over the socket, and nothing reaches the app's own streams or tty.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>
#include <atomic>
#include <cerrno>
#include <csignal>
#if defined(_WIN32)
#include <windows.h>
#else
#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#include <climits>
#else
#include <climits>
#endif

namespace flint_proc {

struct Capture {
    std::string out;
    std::string err;
    std::string cwd;
};

inline Capture*& capture_slot() {
    static thread_local Capture* slot = nullptr;
    return slot;
}

inline void capture_begin(const std::string& cwd) {
    delete capture_slot();
    capture_slot() = new Capture{"", "", cwd};
}

inline void capture_end(std::string& out, std::string& err) {
    Capture* c = capture_slot();
    if (c) {
        out = std::move(c->out);
        err = std::move(c->err);
        delete c;
    }
    capture_slot() = nullptr;
}

inline bool capturing() { return capture_slot() != nullptr; }

inline void write_out(const std::string& s) {
    if (Capture* c = capture_slot()) { c->out += s; return; }
    std::fwrite(s.data(), 1, s.size(), stdout);
}

inline void write_err(const std::string& s) {
    if (Capture* c = capture_slot()) { c->err += s; return; }
    std::fflush(stdout);
    std::fwrite(s.data(), 1, s.size(), stderr);
    std::fflush(stderr);
}

#if defined(_WIN32)
// Windows (windows-port). The console stands in for /dev/tty: CONIN$ and CONOUT$
// reach it even when stdin and stdout are redirected. Raw mode is console modes
// (no line input, no echo, no Ctrl+C processing, VT input), restored at exit and on
// Ctrl+C/close. Windows has no SIGWINCH: read_input compares the window size on each
// call and raises the same flag.

inline std::wstring wide(const std::string& s) {
    int n = ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

inline std::string utf8(const wchar_t* w, size_t n) {
    int len = ::WideCharToMultiByte(CP_UTF8, 0, w, static_cast<int>(n), nullptr, 0, nullptr, nullptr);
    std::string s(static_cast<size_t>(len), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, w, static_cast<int>(n), s.data(), len, nullptr, nullptr);
    return s;
}

inline HANDLE open_console(const wchar_t* name) {
    return ::CreateFileW(name, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
}

// A console with no window is nobody's terminal: a process started with
// CREATE_NO_WINDOW (WSL interop from a pipe, a service, a scheduled task) still opens
// CONIN$, and a prompt there would wait forever. Windows Terminal and ssh sessions
// (ConPTY) and a classic conhost all give the console a window handle.
inline bool console_has_window() { return ::GetConsoleWindow() != nullptr; }

inline bool has_tty() {
    if (capturing() || !console_has_window()) return false;
    HANDLE h = open_console(L"CONIN$");
    if (h == INVALID_HANDLE_VALUE) return false;
    ::CloseHandle(h);
    return true;
}

inline std::string read_stdin_all() {
    if (capturing()) return "";
    std::string data((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    return data;
}

inline int read_console_line(const std::string& prompt, bool echo, std::string& out) {
    if (capturing() || !console_has_window()) return -1;
    HANDLE in = open_console(L"CONIN$");
    if (in == INVALID_HANDLE_VALUE) return -1;
    HANDLE con = open_console(L"CONOUT$");
    if (con != INVALID_HANDLE_VALUE) {
        std::wstring wp = wide(prompt);
        DWORD w = 0;
        ::WriteConsoleW(con, wp.data(), static_cast<DWORD>(wp.size()), &w, nullptr);
    }
    DWORD old = 0;
    bool restore = ::GetConsoleMode(in, &old) != FALSE;
    if (restore) {
        DWORD mode = old | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT;
        mode = echo ? (mode | ENABLE_ECHO_INPUT) : (mode & ~static_cast<DWORD>(ENABLE_ECHO_INPUT));
        ::SetConsoleMode(in, mode);
    }
    std::wstring line;
    wchar_t buf[256];
    DWORD got = 0;
    while (::ReadConsoleW(in, buf, 256, &got, nullptr) && got > 0) {
        line.append(buf, got);
        if (line.find(L'\n') != std::wstring::npos) break;
    }
    if (restore) ::SetConsoleMode(in, old);
    if (!echo && con != INVALID_HANDLE_VALUE) {
        DWORD w = 0;
        ::WriteConsoleW(con, L"\r\n", 2, &w, nullptr);  // what ECHONL does on POSIX
    }
    while (!line.empty() && (line.back() == L'\n' || line.back() == L'\r')) line.pop_back();
    out = utf8(line.data(), line.size());
    std::fill(line.begin(), line.end(), L'\0');
    if (con != INVALID_HANDLE_VALUE) ::CloseHandle(con);
    ::CloseHandle(in);
    return 0;
}

inline int read_secret_tty(const std::string& prompt, std::string& out) { return read_console_line(prompt, false, out); }
inline int read_line_tty(const std::string& prompt, std::string& out) { return read_console_line(prompt, true, out); }

inline std::atomic<bool>& winch_flag() {
    static std::atomic<bool> flag{false};
    return flag;
}

struct RawState {
    DWORD in_mode = 0;
    DWORD out_mode = 0;
    UINT in_cp = 0;
    UINT out_cp = 0;
    bool active = false;
    int cols = 0;
    int rows = 0;
};

inline RawState& raw_state() {
    static RawState st;
    return st;
}

inline void raw_restore() {
    RawState& st = raw_state();
    if (st.active) {
        ::SetConsoleMode(::GetStdHandle(STD_INPUT_HANDLE), st.in_mode);
        ::SetConsoleMode(::GetStdHandle(STD_OUTPUT_HANDLE), st.out_mode);
        ::SetConsoleCP(st.in_cp);
        ::SetConsoleOutputCP(st.out_cp);
        st.active = false;
    }
}

inline BOOL WINAPI flint_on_ctrl(DWORD) {
    raw_restore();
    return FALSE;  // let the default handler end the process
}

inline void window_size(int& cols, int& rows) {
    cols = 0;
    rows = 0;
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (::GetConsoleScreenBufferInfo(::GetStdHandle(STD_OUTPUT_HANDLE), &info) ||
        ::GetConsoleScreenBufferInfo(::GetStdHandle(STD_ERROR_HANDLE), &info)) {
        cols = info.srWindow.Right - info.srWindow.Left + 1;
        rows = info.srWindow.Bottom - info.srWindow.Top + 1;
    }
}

inline int raw_enter() {
    HANDLE in = ::GetStdHandle(STD_INPUT_HANDLE);
    HANDLE out = ::GetStdHandle(STD_OUTPUT_HANDLE);
    RawState& st = raw_state();
    if (st.active) return 0;
    DWORD in_mode = 0, out_mode = 0;
    if (!::GetConsoleMode(in, &in_mode)) return 0;  // not a console: nothing to change
    ::GetConsoleMode(out, &out_mode);
    st.in_mode = in_mode;
    st.out_mode = out_mode;
    st.in_cp = ::GetConsoleCP();
    st.out_cp = ::GetConsoleOutputCP();
    DWORD raw_in = (in_mode & ~static_cast<DWORD>(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT |
                                                  ENABLE_QUICK_EDIT_MODE)) |
                   ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_EXTENDED_FLAGS | ENABLE_WINDOW_INPUT;
    if (!::SetConsoleMode(in, raw_in)) return -1;
    ::SetConsoleMode(out, out_mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING | DISABLE_NEWLINE_AUTO_RETURN);
    ::SetConsoleCP(CP_UTF8);
    ::SetConsoleOutputCP(CP_UTF8);
    window_size(st.cols, st.rows);
    st.active = true;
    static bool hooked = false;
    if (!hooked) {
        hooked = true;
        std::atexit(raw_restore);
        ::SetConsoleCtrlHandler(flint_on_ctrl, TRUE);
    }
    return 0;
}

inline bool take_winch() { return winch_flag().exchange(false); }

inline void check_resize() {
    RawState& st = raw_state();
    int c = 0, r = 0;
    window_size(c, r);
    if (c != st.cols || r != st.rows) {
        st.cols = c;
        st.rows = r;
        winch_flag().store(true);
    }
}

// Waits up to `timeout_ms` for stdin. Console: drops events that carry no text
// (key-ups, focus, mouse, resizes) so the read never blocks on them; a pipe: checks
// how much is buffered. Returns the bytes read ("" on timeout), or false at end of input.
inline bool read_input(int timeout_ms, std::string& out) {
    out.clear();
    check_resize();
    HANDLE in = ::GetStdHandle(STD_INPUT_HANDLE);
    DWORD mode = 0;
    if (::GetConsoleMode(in, &mode)) {
        DWORD wr = ::WaitForSingleObject(in, static_cast<DWORD>(timeout_ms < 0 ? INFINITE : timeout_ms));
        check_resize();
        if (wr != WAIT_OBJECT_0) return true;
        INPUT_RECORD rec[64];
        DWORD n = 0;
        if (!::PeekConsoleInputW(in, rec, 64, &n)) return false;
        bool text = false;
        for (DWORD i = 0; i < n; ++i) {
            if (rec[i].EventType == KEY_EVENT && rec[i].Event.KeyEvent.bKeyDown && rec[i].Event.KeyEvent.uChar.UnicodeChar) {
                text = true;
                break;
            }
        }
        if (!text) {
            ::ReadConsoleInputW(in, rec, n, &n);  // discard what cannot become bytes
            return true;
        }
        char buf[4096];
        DWORD got = 0;
        if (!::ReadFile(in, buf, sizeof buf, &got, nullptr)) return false;
        out.assign(buf, got);
        return true;
    }
    DWORD type = ::GetFileType(in);
    if (type == FILE_TYPE_PIPE) {
        DWORD avail = 0;
        auto start = ::GetTickCount64();
        for (;;) {
            if (!::PeekNamedPipe(in, nullptr, 0, nullptr, &avail, nullptr)) return false;  // writer closed
            if (avail > 0) break;
            if (static_cast<int64_t>(::GetTickCount64() - start) >= timeout_ms) return true;
            ::Sleep(5);
        }
    }
    char buf[4096];
    DWORD got = 0;
    if (!::ReadFile(in, buf, sizeof buf, &got, nullptr) || got == 0) return false;
    out.assign(buf, got);
    return true;
}

inline void write_fd(int fd, const std::string& s) {
    std::fflush(stdout);
    HANDLE h = ::GetStdHandle(fd == 2 ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);
    const char* d = s.data();
    size_t len = s.size();
    while (len > 0) {
        DWORD w = 0;
        if (!::WriteFile(h, d, static_cast<DWORD>(len), &w, nullptr) || w == 0) return;
        d += w;
        len -= w;
    }
}

// The folder holding the running executable, with `/` separators; "" on failure.
inline std::string executable_dir() {
    wchar_t buf[32768];
    DWORD n = ::GetModuleFileNameW(nullptr, buf, sizeof(buf) / sizeof(buf[0]));
    if (n == 0) return "";
    std::string path = utf8(buf, n);
    for (char& c : path) if (c == '\\') c = '/';
    auto slash = path.rfind('/');
    return slash == std::string::npos ? "" : path.substr(0, slash);
}

inline const char* os_name() { return "windows"; }

// Starts `path` with no console, no inherited handles and its own process group, so it
// outlives this process and Ctrl+C here does not reach it: what `setsid prog
// </dev/null >/dev/null 2>&1 &` does on POSIX. Leaves the caller's job object when the
// job allows it (a job that kills its processes on close would take the app down with
// the CLI). A bare name is looked up like a command (`.exe` added, then the PATH).
// True when the process was created.
inline bool spawn_detached(const std::string& path) {
    std::wstring cmd = L"\"" + wide(path) + L"\"";
    STARTUPINFOW si{};
    si.cb = sizeof si;
    PROCESS_INFORMATION pi{};
    DWORD flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT;
    BOOL ok = ::CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, flags | CREATE_BREAKAWAY_FROM_JOB,
                               nullptr, nullptr, &si, &pi);
    if (!ok && ::GetLastError() == ERROR_ACCESS_DENIED) {
        ok = ::CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, flags, nullptr, nullptr, &si, &pi);
    }
    if (!ok) return false;
    ::CloseHandle(pi.hThread);
    ::CloseHandle(pi.hProcess);
    return true;
}

#else
inline bool has_tty() {
    if (capturing()) return false;
    int fd = open("/dev/tty", O_RDWR | O_NOCTTY);
    if (fd < 0) return false;
    ::close(fd);
    return true;
}

inline std::string read_stdin_all() {
    if (capturing()) return "";
    std::string data((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    return data;
}

// Prompts on /dev/tty and reads one line with echo off. Returns -1 when there is no
// terminal, 0 on success.
inline int read_secret_tty(const std::string& prompt, std::string& out) {
    if (capturing()) return -1;
    int fd = open("/dev/tty", O_RDWR | O_NOCTTY);
    if (fd < 0) return -1;
    (void)!write(fd, prompt.data(), prompt.size());
    termios old{};
    bool restore = tcgetattr(fd, &old) == 0;
    if (restore) {
        termios quiet = old;
        quiet.c_lflag &= ~static_cast<tcflag_t>(ECHO);
        quiet.c_lflag |= ECHONL;
        tcsetattr(fd, TCSAFLUSH, &quiet);
    }
    out.clear();
    char c;
    while (read(fd, &c, 1) == 1 && c != '\n') {
        if (c != '\r') out.push_back(c);
    }
    if (restore) tcsetattr(fd, TCSAFLUSH, &old);
    ::close(fd);
    return 0;
}

// Prompts on /dev/tty and reads one line with echo on. Returns -1 when there is
// no terminal.
inline int read_line_tty(const std::string& prompt, std::string& out) {
    if (capturing()) return -1;
    int fd = open("/dev/tty", O_RDWR | O_NOCTTY);
    if (fd < 0) return -1;
    (void)!write(fd, prompt.data(), prompt.size());
    out.clear();
    char c;
    while (read(fd, &c, 1) == 1 && c != '\n') {
        if (c != '\r') out.push_back(c);
    }
    ::close(fd);
    return 0;
}

// ---- Interactive session terminal ---------------------------------------------
//
// Raw mode on stdin, a SIGWINCH flag, the window size, and unbuffered byte I/O.
// The saved termios is restored on leave, at exit, and on SIGINT/SIGTERM/SIGHUP,
// so a crash or a kill never leaves the user's terminal raw.

inline std::atomic<bool>& winch_flag() {
    static std::atomic<bool> flag{false};
    return flag;
}

struct RawState {
    termios saved{};
    bool active = false;
};

inline RawState& raw_state() {
    static RawState st;
    return st;
}

inline void raw_restore() {
    RawState& st = raw_state();
    if (st.active) {
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &st.saved);
        st.active = false;
    }
}

extern "C" inline void flint_on_winch(int) { winch_flag().store(true); }

extern "C" inline void flint_on_fatal(int sig) {
    RawState& st = raw_state();
    if (st.active) tcsetattr(STDIN_FILENO, TCSAFLUSH, &st.saved);
    std::signal(sig, SIG_DFL);
    std::raise(sig);
}

inline void install_winch() {
    struct sigaction sa{};
    sa.sa_handler = flint_on_winch;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESTART;
    sigaction(SIGWINCH, &sa, nullptr);
}

// 0 on success (or when stdin is not a terminal: nothing to change), -1 on error.
inline int raw_enter() {
    install_winch();
    if (!isatty(STDIN_FILENO)) return 0;
    RawState& st = raw_state();
    if (st.active) return 0;
    if (tcgetattr(STDIN_FILENO, &st.saved) != 0) return -1;
    termios raw = st.saved;
    cfmakeraw(&raw);
    if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw) != 0) return -1;
    st.active = true;
    static bool hooked = false;
    if (!hooked) {
        hooked = true;
        std::atexit(raw_restore);
        std::signal(SIGTERM, flint_on_fatal);
        std::signal(SIGHUP, flint_on_fatal);
        std::signal(SIGINT, flint_on_fatal);
    }
    return 0;
}

// The window size of the controlling terminal (stdout, then stdin), or 0x0.
inline void window_size(int& cols, int& rows) {
    winsize ws{};
    cols = 0;
    rows = 0;
    if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 || ioctl(STDIN_FILENO, TIOCGWINSZ, &ws) == 0) {
        cols = ws.ws_col;
        rows = ws.ws_row;
    }
}

inline bool take_winch() { return winch_flag().exchange(false); }

// Waits up to `timeout_ms` for stdin. Returns the bytes read ("" on timeout), or
// false at end of input.
inline bool read_input(int timeout_ms, std::string& out) {
    out.clear();
    pollfd p{STDIN_FILENO, POLLIN, 0};
    int pr = ::poll(&p, 1, timeout_ms);
    if (pr < 0) return errno == EINTR;
    if (pr == 0) return true;
    char buf[4096];
    ssize_t n = ::read(STDIN_FILENO, buf, sizeof buf);
    if (n < 0) return errno == EINTR || errno == EAGAIN;
    if (n == 0) return false;
    out.assign(buf, static_cast<size_t>(n));
    return true;
}

inline void write_fd(int fd, const std::string& s) {
    std::fflush(stdout);
    const char* d = s.data();
    size_t len = s.size();
    while (len > 0) {
        ssize_t w = ::write(fd, d, len);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) return;
        d += w;
        len -= static_cast<size_t>(w);
    }
}

// The folder holding the running executable, with symlinks resolved; "" on failure.
inline std::string executable_dir() {
    char buf[PATH_MAX];
    std::string path;
#if defined(__APPLE__)
    uint32_t size = sizeof buf;
    if (_NSGetExecutablePath(buf, &size) != 0) return "";
    path = buf;
#else
    ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
    if (n <= 0) return "";
    buf[n] = 0;
    path = buf;
#endif
    char real[PATH_MAX];
    if (realpath(path.c_str(), real)) path = real;
    auto slash = path.rfind('/');
    return slash == std::string::npos ? "" : path.substr(0, slash);
}

inline const char* os_name() {
#if defined(__APPLE__)
    return "mac";
#else
    return "linux";
#endif
}

#endif

}  // namespace flint_proc
