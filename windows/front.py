# Brings the Flint window that a gui-e2e run starts to the front, on Windows.
#
#   python3 -I windows/front.py <path of the .exe> [seconds]
#
# The runs start from a scheduled task in the desktop session (windows/desktop.sh), and
# Windows lets no background process take the foreground: the app's window opened
# behind, document.hasFocus() was false, and the page got no focus events. This waits
# for a visible top-level window of that .exe, makes it the foreground window (an Alt
# key press first: Windows allows SetForegroundWindow after input), then clicks Flint's
# own title bar, as a person would: activation alone leaves the page without the
# keyboard focus until a click (W-16, open in cfire). Test-only.
import ctypes, os, sys, time
from ctypes import wintypes

exe = os.path.normcase(os.path.abspath(sys.argv[1]))
deadline = time.time() + (float(sys.argv[2]) if len(sys.argv) > 2 else 60)
user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

def image(pid):
    h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    buf = ctypes.create_unicode_buffer(1024)
    n = wintypes.DWORD(1024)
    ok = kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n))
    kernel32.CloseHandle(h)
    return os.path.normcase(buf.value) if ok else ""

def find():
    found = []
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) and not user32.GetWindow(hwnd, 4):  # GW_OWNER
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if image(pid.value) == exe:
                found.append(hwnd)
                return False
        return True
    user32.EnumWindows(EnumProc(cb), 0)
    return found[0] if found else None

while time.time() < deadline:
    hwnd = find()
    if hwnd:
        time.sleep(0.3)
        user32.keybd_event(0x12, 0, 0, 0)       # VK_MENU down
        user32.SetForegroundWindow(hwnd)
        user32.keybd_event(0x12, 0, 2, 0)       # KEYEVENTF_KEYUP
        front = user32.GetForegroundWindow() == hwnd
        # A click in the page's title bar (the top 38 px of the client area, Flint's own,
        # with nothing to press at its middle), in screen coordinates.
        time.sleep(1.5)
        rc = wintypes.RECT()
        user32.GetClientRect(hwnd, ctypes.byref(rc))
        pt = wintypes.POINT(rc.right // 2, 19)
        user32.ClientToScreen(hwnd, ctypes.byref(pt))
        user32.SetCursorPos(pt.x, pt.y)
        user32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
        user32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP
        print("front: %s, title bar clicked at %d,%d" % ("in front" if front else "not in front", pt.x, pt.y))
        sys.exit(0)
    time.sleep(0.2)
print("front: no window of %s" % exe)
sys.exit(1)
