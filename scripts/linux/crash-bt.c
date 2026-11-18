// CFIRE-UPSTREAM: CF-167
//
// Every thread's backtrace from a test suite that dies by a signal (Linux, scripts/test.sh).
// cfire's test runtime handles SIGSEGV, SIGBUS, SIGABRT, SIGILL, SIGFPE and SIGTRAP itself
// and ends with _Exit(1) (cfire_test_runtime.hpp, install_crash_handlers): no core file,
// no backtrace, and no way to turn it off. Preloaded into `cfire test`, this wraps any
// handler a program installs for those signals: on the signal it lets a child attach gdb
// to the crashing process and write `thread apply all bt` to
// $FLINT_CRASH_BT_DIR/bt-<pid>.txt, then runs the program's own handler as before.
// Without FLINT_CRASH_BT_DIR it changes nothing.
//
//   cc -shared -fPIC -O2 -o crash-bt.so scripts/linux/crash-bt.c -ldl
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>

typedef int (*sigaction_fn)(int, const struct sigaction *, struct sigaction *);

static char out_dir[512];
static struct sigaction program_handler[NSIG];

__attribute__((constructor)) static void init(void) {
    const char *d = getenv("FLINT_CRASH_BT_DIR");
    if (d && strlen(d) < sizeof(out_dir)) strcpy(out_dir, d);
}

static int is_fatal(int sig) {
    return sig == SIGSEGV || sig == SIGBUS || sig == SIGABRT || sig == SIGILL || sig == SIGFPE || sig == SIGTRAP;
}

static void on_crash(int sig, siginfo_t *info, void *uc) {
    static volatile sig_atomic_t done = 0;
    if (!done) {
        done = 1;
        // A child may trace its parent only when the parent says so (Yama).
        prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);
        pid_t me = getpid();
        pid_t c = fork();
        if (c == 0) {
            char pid[24], path[600];
            snprintf(pid, sizeof pid, "%d", (int)me);
            snprintf(path, sizeof path, "%s/bt-%d.txt", out_dir, (int)me);
            int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
            if (fd >= 0) { dup2(fd, 1); dup2(fd, 2); }
            dprintf(1, "signal %d (%s) in pid %s, fault address %p\n", sig, strsignal(sig), pid, info ? info->si_addr : 0);
            execlp("timeout", "timeout", "60", "gdb", "-p", pid, "-batch", "-nx",
                   "-ex", "info threads", "-ex", "thread apply all bt", (char *)0);
            _exit(127);
        }
        if (c > 0) { int st; waitpid(c, &st, 0); }
    }
    struct sigaction *h = &program_handler[sig];
    if (h->sa_flags & SA_SIGINFO) {
        h->sa_sigaction(sig, info, uc);
    } else if (h->sa_handler != SIG_DFL && h->sa_handler != SIG_IGN) {
        h->sa_handler(sig);
    }
    signal(sig, SIG_DFL);
    raise(sig);
}

int sigaction(int sig, const struct sigaction *act, struct sigaction *old) {
    static sigaction_fn real;
    if (!real) real = (sigaction_fn)dlsym(RTLD_NEXT, "sigaction");
    if (out_dir[0] && act && sig > 0 && sig < NSIG && is_fatal(sig) &&
        ((act->sa_flags & SA_SIGINFO) || (act->sa_handler != SIG_DFL && act->sa_handler != SIG_IGN))) {
        program_handler[sig] = *act;
        struct sigaction mine = *act;
        mine.sa_flags |= SA_SIGINFO;
        mine.sa_sigaction = on_crash;
        return real(sig, &mine, old);
    }
    return real(sig, act, old);
}
