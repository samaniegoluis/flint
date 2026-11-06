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
// - the executable's folder and the OS name (CF-031).
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
#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#include <climits>
#else
#include <climits>
#endif

namespace flint_proc {

inline void write_err(const std::string& s) {
    std::fflush(stdout);
    std::fwrite(s.data(), 1, s.size(), stderr);
    std::fflush(stderr);
}

inline bool has_tty() {
    int fd = open("/dev/tty", O_RDWR | O_NOCTTY);
    if (fd < 0) return false;
    ::close(fd);
    return true;
}

inline std::string read_stdin_all() {
    std::string data((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    return data;
}

// Prompts on /dev/tty and reads one line with echo off. Returns -1 when there is no
// terminal, 0 on success.
inline int read_secret_tty(const std::string& prompt, std::string& out) {
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

}  // namespace flint_proc
