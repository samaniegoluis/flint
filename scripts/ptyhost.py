"""A command on a pseudo-terminal, the same on every system, for the e2e scripts.

    from ptyhost import spawn
    p = spawn(["build/flint", "connect", "local"], rows=24, cols=80)
    p.write(b"echo hi\n"); data = p.read(0.5); p.resize(40, 100); code = p.wait()

`read` gives b"" when nothing came and None once the terminal is closed; `poll` gives
the exit code once the command ended (on Windows the terminal stays open until `wait`,
so a loop that waits for the end asks `poll`).

macOS and Linux: pty.fork. Windows: a ConPTY (CreatePseudoConsole, Windows 10 1809+)
through ctypes, with a thread that drains its output: the native python of MSYS2 has
no pty, fcntl or termios, and Flint's terminal there is the console.
"""
import os
import sys
import time

if sys.platform != "win32":
    import fcntl
    import pty
    import select
    import struct
    import termios

    class _Posix:
        def __init__(self, argv, rows, cols):
            self.pid, self.fd = pty.fork()
            if self.pid == 0:
                os.execv(argv[0], argv)
            self.resize(rows, cols)

        def read(self, timeout):
            """Bytes that arrive within `timeout` seconds; b"" when none; None once closed."""
            r, _, _ = select.select([self.fd], [], [], timeout)
            if not r:
                return b""
            try:
                d = os.read(self.fd, 4096)
            except OSError:
                return None
            return d or None

        def write(self, data):
            os.write(self.fd, data)

        def resize(self, rows, cols):
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

        code = None

        def poll(self):
            if self.code is None:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    self.code = os.waitstatus_to_exitcode(status)
            return self.code

        def wait(self):
            if self.code is None:
                _, status = os.waitpid(self.pid, 0)
                self.code = os.waitstatus_to_exitcode(status)
            return self.code

    def spawn(argv, rows=24, cols=80):
        return _Posix(argv, rows, cols)

else:
    import ctypes
    import queue
    import subprocess
    import threading
    from ctypes import wintypes as w

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class COORD(ctypes.Structure):
        _fields_ = [("X", w.SHORT), ("Y", w.SHORT)]

    class STARTUPINFOW(ctypes.Structure):
        _fields_ = [("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
                    ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
                    ("dwXSize", w.DWORD), ("dwYSize", w.DWORD), ("dwXCountChars", w.DWORD),
                    ("dwYCountChars", w.DWORD), ("dwFillAttribute", w.DWORD),
                    ("dwFlags", w.DWORD), ("wShowWindow", w.WORD), ("cbReserved2", w.WORD),
                    ("lpReserved2", ctypes.c_void_p), ("hStdInput", w.HANDLE),
                    ("hStdOutput", w.HANDLE), ("hStdError", w.HANDLE)]

    class STARTUPINFOEXW(ctypes.Structure):
        _fields_ = [("StartupInfo", STARTUPINFOW), ("lpAttributeList", ctypes.c_void_p)]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [("hProcess", w.HANDLE), ("hThread", w.HANDLE),
                    ("dwProcessId", w.DWORD), ("dwThreadId", w.DWORD)]

    k32.CreatePipe.argtypes = [ctypes.POINTER(w.HANDLE), ctypes.POINTER(w.HANDLE), ctypes.c_void_p, w.DWORD]
    k32.CreatePseudoConsole.argtypes = [COORD, w.HANDLE, w.HANDLE, w.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    k32.CreatePseudoConsole.restype = ctypes.c_long
    k32.ResizePseudoConsole.argtypes = [ctypes.c_void_p, COORD]
    k32.ResizePseudoConsole.restype = ctypes.c_long
    k32.ClosePseudoConsole.argtypes = [ctypes.c_void_p]
    k32.InitializeProcThreadAttributeList.argtypes = [ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)]
    k32.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, w.DWORD, ctypes.c_size_t, ctypes.c_void_p,
                                              ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
    k32.DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]
    k32.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD,
                                   ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(STARTUPINFOEXW),
                                   ctypes.POINTER(PROCESS_INFORMATION)]
    k32.ReadFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p]
    k32.WriteFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p]
    k32.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k32.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
    k32.CloseHandle.argtypes = [w.HANDLE]

    EXTENDED_STARTUPINFO_PRESENT = 0x00080000
    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016

    def _check(ok, what):
        if not ok:
            raise OSError(ctypes.get_last_error(), what)

    class _ConPty:
        def __init__(self, argv, rows, cols):
            in_r, in_w, out_r, out_w = w.HANDLE(), w.HANDLE(), w.HANDLE(), w.HANDLE()
            _check(k32.CreatePipe(ctypes.byref(in_r), ctypes.byref(in_w), None, 0), "CreatePipe")
            _check(k32.CreatePipe(ctypes.byref(out_r), ctypes.byref(out_w), None, 0), "CreatePipe")
            self.hpc = ctypes.c_void_p()
            hr = k32.CreatePseudoConsole(COORD(cols, rows), in_r, out_w, 0, ctypes.byref(self.hpc))
            if hr != 0:
                raise OSError(hr, "CreatePseudoConsole")
            size = ctypes.c_size_t()
            k32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
            attrs = ctypes.create_string_buffer(size.value)
            _check(k32.InitializeProcThreadAttributeList(attrs, 1, 0, ctypes.byref(size)), "InitializeProcThreadAttributeList")
            _check(k32.UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, self.hpc,
                                                 ctypes.sizeof(ctypes.c_void_p), None, None), "UpdateProcThreadAttribute")
            si = STARTUPINFOEXW()
            si.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEXW)
            # Null standard handles, or the child inherits this process's redirected
            # ones and writes past the pseudo console; with none it takes the console's.
            si.StartupInfo.dwFlags = 0x00000100  # STARTF_USESTDHANDLES
            si.lpAttributeList = ctypes.cast(attrs, ctypes.c_void_p)
            pi = PROCESS_INFORMATION()
            cmd = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
            _check(k32.CreateProcessW(None, cmd, None, None, False, EXTENDED_STARTUPINFO_PRESENT,
                                      None, None, ctypes.byref(si), ctypes.byref(pi)), "CreateProcessW")
            k32.DeleteProcThreadAttributeList(attrs)
            # The pseudo console holds its own ends now.
            k32.CloseHandle(in_r)
            k32.CloseHandle(out_w)
            k32.CloseHandle(pi.hThread)
            self.proc, self.inp, self.out = pi.hProcess, in_w, out_r
            self.chunks = queue.Queue()
            # ClosePseudoConsole waits until its output is read: a thread drains it.
            threading.Thread(target=self._drain, daemon=True).start()

        def _drain(self):
            buf = ctypes.create_string_buffer(4096)
            n = w.DWORD()
            while k32.ReadFile(self.out, buf, 4096, ctypes.byref(n), None) and n.value:
                self.chunks.put(buf.raw[:n.value])
            self.chunks.put(None)

        def read(self, timeout):
            """Bytes that arrive within `timeout` seconds; b"" when none; None once closed."""
            try:
                first = self.chunks.get(timeout=timeout)
            except queue.Empty:
                return b""
            if first is None:
                self.chunks.put(None)
                return None
            data = first
            while True:
                try:
                    more = self.chunks.get_nowait()
                except queue.Empty:
                    return data
                if more is None:
                    self.chunks.put(None)
                    return data
                data += more

        def write(self, data):
            # A console takes Enter as \r: a typed line ends in \r, as a terminal sends it.
            data = data.replace(b"\n", b"\r")
            n = w.DWORD()
            _check(k32.WriteFile(self.inp, data, len(data), ctypes.byref(n), None), "WriteFile")

        def resize(self, rows, cols):
            k32.ResizePseudoConsole(self.hpc, COORD(cols, rows))

        def poll(self):
            if k32.WaitForSingleObject(self.proc, 0) != 0:
                return None
            code = w.DWORD()
            k32.GetExitCodeProcess(self.proc, ctypes.byref(code))
            return code.value

        def wait(self):
            k32.WaitForSingleObject(self.proc, 0xFFFFFFFF)
            code = w.DWORD()
            k32.GetExitCodeProcess(self.proc, ctypes.byref(code))
            k32.ClosePseudoConsole(self.hpc)
            k32.CloseHandle(self.proc)
            k32.CloseHandle(self.inp)
            return code.value

    def spawn(argv, rows=24, cols=80):
        return _ConPty(argv, rows, cols)
