"""Small terminal adapter. The simulation does not depend on a real console."""

import os
import sys
import time
from contextlib import contextmanager
from textwrap import wrap

from desk import page_lines
from factory import Factory


ESC = "\x1b"


def _windows_console():
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    get_mode = kernel.GetConsoleMode
    get_mode.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    set_mode = kernel.SetConsoleMode
    set_mode.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    handle = msvcrt.get_osfhandle(sys.stdout.fileno())
    mode = wintypes.DWORD()
    if not get_mode(handle, ctypes.byref(mode)) or not set_mode(handle, mode.value | 0x0004):
        return None

    def read_key(timeout):
        deadline = time.monotonic() + timeout
        while not msvcrt.kbhit():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            time.sleep(min(remaining, 0.04))
        key = msvcrt.getwch()
        if key in ("\x00", "\xe0"):
            msvcrt.getwch()
            return ""
        return key

    return read_key, lambda: set_mode(handle, mode.value)


def _posix_key_reader(read_byte):
    pending = None

    def read_key(timeout):
        nonlocal pending
        if pending is None:
            char = read_byte(timeout)
        else:
            char, pending = pending, None
        if char is None:
            return None
        if not char:
            return "q"
        if char == b"\x1b":
            prefix = read_byte(0.025)
            if prefix in (b"[", b"O"):
                tail = read_byte(0.025)
                if tail:
                    # A cursor/function key's final letter may also be a game command.
                    if prefix == b"[" and tail == b"[":
                        tail = read_byte(0.025)  # Linux console F1-F5
                    while tail and not 0x40 <= tail[0] <= 0x7E:
                        tail = read_byte(0.025)
                    return ""
            # Escape followed quickly by a normal command is two separate keystrokes.
            pending = prefix
        return char.decode("ascii", errors="ignore")

    return read_key


def _posix_console():
    import select
    import termios
    import tty

    fd = sys.stdin.fileno()
    try:
        mode = termios.tcgetattr(fd)
        tty.setcbreak(fd)
    except (OSError, termios.error):
        return None

    def read_byte(timeout):
        if select.select([fd], [], [], timeout)[0]:
            return os.read(fd, 1)
        return None

    return _posix_key_reader(read_byte), lambda: termios.tcsetattr(fd, termios.TCSADRAIN, mode)


@contextmanager
def console_keys():
    adapter = _windows_console() if os.name == "nt" else _posix_console()
    if adapter is None:
        yield None
        return
    read_key, restore = adapter
    try:
        sys.stdout.write(ESC + "[?1049h" + ESC + "[?25l")
        sys.stdout.flush()
        yield read_key
    finally:
        try:
            sys.stdout.write(ESC + "[?25h" + ESC + "[?1049l")
            sys.stdout.flush()
        finally:
            restore()


def screen_rows(f: Factory, page: str, note: str, width: int, height: int) -> list[str]:
    width = max(1, min(width, 86))
    height = max(1, height)
    lines = page_lines(f, page, width, compact=height < 21)
    last_rule = len(lines) - 1 - lines[::-1].index("-" * width)
    body, controls = lines[:last_rule], lines[last_rule:]
    notice = wrap("> " + note, width=width)[:max(1, height // 3)] if note else []
    if len(lines) + len(notice) + 1 <= height:
        rows = [*lines, "", *notice]
    else:
        body = [line for line in body if line and line != "-" * width]
        controls = controls[1:]
        room = max(0, height - len(controls) - len(notice))
        rows = [*body[:room], *controls, *notice]
    return [line[:width] for line in rows[:height]]


def paint(rows: list[str], color: bool) -> str:
    styled = []
    for index, line in enumerate(rows):
        tone = ""
        if index == 0:
            tone = "1;33"
        elif line.startswith("Till ") or "* LIMIT" in line:
            tone = "1;36"
        elif line.startswith("> "):
            tone = "33"
        elif line.startswith("---"):
            tone = "2"
        if color and tone:
            line = f"{ESC}[{tone}m{line}{ESC}[0m"
        styled.append(line + ESC + "[K")
    return ESC + "[H" + "\r\n".join(styled) + ESC + "[J"
