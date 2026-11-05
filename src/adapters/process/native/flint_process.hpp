// CFIRE-UPSTREAM: CF-024, CF-031
//
// Process shim for src/adapters/process/process.cf: argv outside `main`, stderr,
// exit codes and reading a password from the terminal with echo off. cfire exposes
// none of these (CF-024) and has no top-level cpp block (CF-031).
#pragma once
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>
#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
extern "C" {
int* _NSGetArgc(void);
char*** _NSGetArgv(void);
}
#endif

namespace flint_proc {

// Arguments after the program name.
inline std::vector<std::string> args() {
    std::vector<std::string> out;
#if defined(__APPLE__)
    int argc = *_NSGetArgc();
    char** argv = *_NSGetArgv();
    for (int i = 1; i < argc; i++) out.emplace_back(argv[i]);
#else
    std::ifstream f("/proc/self/cmdline", std::ios::binary);
    std::string all((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    size_t start = 0;
    bool first = true;
    for (size_t i = 0; i < all.size(); i++) {
        if (all[i] == '\0') {
            if (!first) out.emplace_back(all.substr(start, i - start));
            first = false;
            start = i + 1;
        }
    }
#endif
    return out;
}

inline void write_err(const std::string& s) {
    std::fflush(stdout);
    std::fwrite(s.data(), 1, s.size(), stderr);
    std::fflush(stderr);
}

inline void write_out(const std::string& s) {
    std::fwrite(s.data(), 1, s.size(), stdout);
}

[[noreturn]] inline void exit_with(int code) {
    std::fflush(stdout);
    std::fflush(stderr);
    std::exit(code);
}

inline bool stdin_is_tty() { return isatty(STDIN_FILENO) == 1; }

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

}  // namespace flint_proc
