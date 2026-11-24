"""Single-key console input and screen restoration on Windows and POSIX."""

import os
import select
import sys
import time


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


class Terminal:
    def __init__(self) -> None:
        self._escape = ""
        self._parameters = ""
        self._ansi = False
        self._input_mode = None
        self._output_mode = None

    def __enter__(self) -> "Terminal":
        self._fd = sys.stdin.fileno()
        if os.name == "nt":
            import ctypes
            import msvcrt

            handle = ctypes.c_void_p(msvcrt.get_osfhandle(sys.stdout.fileno()))
            api = ctypes.windll.kernel32
            mode = ctypes.c_uint32()
            if api.GetConsoleMode(handle, ctypes.byref(mode)):
                if api.SetConsoleMode(handle, mode.value | 0x0004):  # VT processing
                    self._output_mode = (api, handle, mode.value)
                    self._ansi = True
        else:
            import termios
            import tty

            self._input_mode = termios.tcgetattr(self._fd)
            tty.setcbreak(self._fd, termios.TCSANOW)
            self._ansi = os.environ.get("TERM") != "dumb"

        if self._ansi:
            try:
                sys.stdout.write("\x1b[?1049h\x1b[?25l")
                sys.stdout.flush()
            except BaseException:
                self.__exit__(None, None, None)
                raise
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if self._ansi:
                sys.stdout.write("\x1b[?25h\x1b[?1049l")
                sys.stdout.flush()
        finally:
            if self._input_mode is not None:
                import termios
                termios.tcsetattr(self._fd, termios.TCSANOW, self._input_mode)
            if self._output_mode is not None:
                api, handle, mode = self._output_mode
                api.SetConsoleMode(handle, mode)

    def draw(self, screen: str) -> None:
        if self._ansi:
            # Erase each old line's tail when hands or event messages get shorter.
            sys.stdout.write("\x1b[H" + screen.replace("\n", "\x1b[K\n") + "\x1b[K\x1b[J")
        else:
            sys.stdout.write(screen + "\n\n")
        sys.stdout.flush()

    def read_key(self, timeout: float | None) -> str | None:
        try:
            if os.name == "nt":
                return self._windows_key(timeout)
            if not select.select([self._fd], [], [], timeout)[0]:
                return None
            raw = os.read(self._fd, 1)
            if not raw:
                return "q"
            return self._decode_posix(raw)
        except KeyboardInterrupt:
            # A console may raise a signal instead of returning the Ctrl-C key.
            return "\x03"

    @staticmethod
    def _windows_key(timeout: float | None) -> str | None:
        import msvcrt

        if timeout is not None:
            deadline = time.monotonic() + timeout
            while not msvcrt.kbhit():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                time.sleep(min(remaining, 0.02))
        key = msvcrt.getwch()
        if key in ("\x00", "\xe0"):
            return {"K": "left", "M": "right", "G": "home", "O": "end"}.get(msvcrt.getwch())
        return key.lower()

    def _decode_posix(self, raw: bytes) -> str | None:
        # Consume a whole terminal escape sequence. In particular, the C in a
        # right-arrow sequence must never accidentally dispatch a card to Canal.
        key = raw.decode("ascii", errors="ignore")
        if key == "\x1b":
            self._escape = "escape"
            return None
        if self._escape == "escape":
            if key in ("[", "O"):
                self._escape = "sequence"
                self._parameters = ""
                return None
            self._escape = ""
        if self._escape == "sequence":
            # Linux consoles send F1-F5 as ESC [ [ A through ESC [ [ E.
            if key == "[":
                self._escape = "function"
                return None
            if key and "@" <= key <= "~":
                self._escape = ""
                if key == "~":
                    number = self._parameters.partition(";")[0]
                    return {"1": "home", "4": "end", "7": "home", "8": "end"}.get(number)
                return {"D": "left", "C": "right", "H": "home", "F": "end"}.get(key)
            # Two bytes distinguish a Home/End number and optional modifier
            # (e.g. "1;") from a function key such as "14".
            if len(self._parameters) < 2:
                self._parameters += key
            return None
        if self._escape == "function":
            self._escape = ""
            return None
        return key.lower() or None
