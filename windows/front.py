# Brings the Flint window that a gui-e2e run starts to the front, on Windows.
#
#   python3 -I windows/front.py <path of the .exe> [seconds]
#
# The runs start from a scheduled task in the desktop session (windows/desktop.sh), and
# Windows lets no background process take the foreground: the app's window opened
# behind, document.hasFocus() was false, and the page got no focus events. This waits
# for a visible top-level window of that .exe, then makes it the foreground window
# (an Alt key press first: Windows allows SetForegroundWindow after input). Test-only.
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
        print("front: %s" % ("in front" if user32.GetForegroundWindow() == hwnd else "not in front"))
        sys.exit(0)
    time.sleep(0.2)
print("front: no window of %s" % exe)
sys.exit(1)
