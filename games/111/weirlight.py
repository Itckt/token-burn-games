"""Launch Weirlight with python weirlight.py. Pass --step for untimed play."""

import argparse
from collections.abc import Callable, Iterator
from contextlib import contextmanager
import os
from pathlib import Path
import sys
import time
from typing import TextIO

from checkpoint import load_watch, save_watch
from spillway import FINAL_WAVE, SIGNAL_KEYS, Game, Phase, RuleError
from watchboard import (
    deck_view, drill_view, forecast_view, frame, guide, pad_view, report_view, sluice_view,
)


BEAT_SECONDS = 0.48
WATCH_FILE = Path(__file__).with_name("weirlight-watch.json")


def beat_number(word: str, command: str) -> int:
    if not (word.isascii() and word.isdecimal() and len(word) <= 3 and int(word) > 0):
        raise RuleError(f"Use '{command} N' with a count from 1 to 999.")
    return int(word)


def order(game: Game, line: str, color: bool = False) -> str:
    """Apply one line-mode order. An inspection or guide replaces the next frame."""
    words = line.lower().split()
    match words:
        case [] | ["."] | ["step"] if game.phase is Phase.WAVE:
            game.tick()
        case []:
            pass
        case ["help" | "?"]:
            return guide(game, color)
        case ["look", pad, *kind] if len(kind) <= 1:
            return pad_view(game, pad.upper(), kind[0] if kind else None, color)
        case ["forecast"] | ["forecast", "rush"]:
            return forecast_view(game, rush=len(words) == 2, color=color)
        case ["drill"]:
            return drill_view(game, color=color)
        case ["drill", beat]:
            return drill_view(game, beat_number(beat, "drill"), color)
        case ["sluice"]:
            return sluice_view(game, color)
        case ["sluice", "off"]:
            game.set_sluice(None)
        case ["sluice", "1" | "2" | "3" as reach]:
            game.set_sluice(int(reach))
        case ["v" | "vent"]:
            game.vent()
        case ["save"]:
            save_watch(game, WATCH_FILE)
            game.notice = "Watch saved. Come back with 'python weirlight.py --resume'."
        case ["report"]:
            return report_view(game, color)
        case ["deck"]:
            return deck_view(game, color)
        case ["deck", first, second]:
            game.set_deck(first, second)
        case ["build" | "b", pad, kind]:
            game.build(pad.upper(), kind)
        case ["up" | "upgrade" | "u", pad]:
            game.upgrade(pad.upper())
        case ["aim", pad, mode]:
            game.set_aim(pad.upper(), mode)
        case ["sell", pad]:
            game.sell(pad.upper())
        case ["mend"]:
            game.mend()
        case ["go"] | ["rush"]:
            game.start_wave(rush=words[0] == "rush")
        case ["overtime"]:
            game.continue_watch()
        case ["1" | "2" | "3" as reach]:
            game.pulse(int(reach))
        case [key] if key in SIGNAL_KEYS:
            game.play_signal(key)
        case ["run"] if game.phase is Phase.WAVE:
            while game.phase is Phase.WAVE:
                game.tick()
        case ["step", count] if game.phase is Phase.WAVE:
            for _ in range(beat_number(count, "step")):
                game.tick()
                if game.phase is not Phase.WAVE:
                    break
        case _:
            raise RuleError("Unknown order here. Type 'help' to see the controls.")
    return ""


@contextmanager
def screen(output: TextIO, enabled: bool) -> Iterator[bool]:
    """Enable in-place frames on a capable TTY and restore its original mode."""
    restore_mode = None
    if enabled and os.name == "nt":
        import ctypes
        from ctypes import wintypes
        import msvcrt

        kernel = ctypes.windll.kernel32
        handle = wintypes.HANDLE(msvcrt.get_osfhandle(output.fileno()))
        mode = wintypes.DWORD()
        if kernel.GetConsoleMode(handle, ctypes.byref(mode)) and kernel.SetConsoleMode(handle, mode.value | 4):
            restore_mode = lambda: kernel.SetConsoleMode(handle, mode.value)
        else:
            enabled = False
    try:
        if enabled:
            output.write("\x1b[?1049h\x1b[H")
            output.flush()
        yield enabled
    finally:
        try:
            if enabled:
                output.write("\x1b[0m\x1b[?25h\x1b[?1049l")
                output.flush()
        finally:
            if restore_mode:
                restore_mode()


def draw(output: TextIO, page: str, live_screen: bool, *, cursor: bool = True) -> None:
    if live_screen:
        visibility = "\x1b[?25h" if cursor else "\x1b[?25l"
        # Erase line tails as the new frame is drawn, including an old prompt.
        output.write(visibility + "\x1b[H" + "\x1b[K\n".join(page.splitlines()) + "\x1b[K\n\x1b[J")
    else:
        output.write(page + "\n\n")
    output.flush()


KeyReader = Callable[[float], str | None]


def skip_escape_sequences(read_byte: KeyReader, now: Callable[[], float] = time.monotonic) -> KeyReader:
    """Consume terminal key sequences and bracketed paste across beat deadlines."""
    sequence = ""
    expires = 0.0
    paste_end = "\x1b[201~"
    paste_tail = ""
    pasting = False

    def read(timeout: float) -> str | None:
        nonlocal sequence, expires, pasting, paste_tail
        key = read_byte(timeout)
        if key is None:
            return None
        if key in ("\x03", "\x04", "\x1a"):
            sequence = paste_tail = ""
            pasting = False
            return key
        if pasting:
            paste_tail = (paste_tail + key)[-len(paste_end):]
            if paste_tail == paste_end:
                pasting = False
                paste_tail = ""
            return None
        at = now()
        if at >= expires:
            sequence = ""
        if key == "\x1b":
            sequence = key
        elif not sequence:
            return key
        elif sequence == "\x1b":
            # Alt+letter is a single key too. Only CSI and SS3 take more bytes.
            sequence = sequence + key if key in ("[", "O") else ""
        elif " " <= key < "@":
            # The only parameter we need to recognize is the paste opener.
            if len(sequence) < 6:
                sequence += key
        else:
            pasting = sequence == "\x1b[200" and key == "~"
            sequence = ""
        # A truncated sequence must eventually release the next ordinary key.
        expires = at + 0.1
        return None

    return read


@contextmanager
def live_keys(stream: TextIO, output: TextIO | None = None) -> Iterator[KeyReader]:
    if os.name == "nt":
        import msvcrt

        def read_windows(timeout: float) -> str | None:
            end = time.monotonic() + timeout
            while True:
                if msvcrt.kbhit():
                    key = msvcrt.getwch()
                    if key in ("\x00", "\xe0"):
                        msvcrt.getwch()  # Consume both parts of a console function key.
                        return None
                    return key
                left = end - time.monotonic()
                if left <= 0:
                    return None
                time.sleep(min(0.02, left))

        yield read_windows
    else:
        import select
        import termios
        import tty

        fd = stream.fileno()
        before = termios.tcgetattr(fd)

        def read_posix(timeout: float) -> str | None:
            if select.select([fd], [], [], timeout)[0]:
                key = os.read(fd, 1)
                return key.decode("latin-1") if key else "\x04"
            return None

        try:
            tty.setcbreak(fd, termios.TCSANOW)
            if output is not None:
                output.write("\x1b[?2004h")
                output.flush()
            yield skip_escape_sequences(read_posix)
        finally:
            try:
                if output is not None:
                    output.write("\x1b[?2004l")
                    output.flush()
            finally:
                termios.tcsetattr(fd, termios.TCSANOW, before)


def live_wave(game: Game, read_key: KeyReader,
              paint: Callable[[bool, bool], None], now: Callable[[], float] = time.monotonic) -> bool:
    """Run one timed wave. Return True when the player clocks off."""
    paused = fast = False
    beat_started = now()
    due = beat_started + BEAT_SECONDS
    paint(paused, fast)
    while game.phase is Phase.WAVE:
        key = read_key(0.25 if paused else max(0.0, due - now()))
        dirty = key is not None
        if key is not None:
            key = key.lower()
            if key in ("q", "\x04", "\x1a"):
                return True
            if key == "\x03":
                raise KeyboardInterrupt
            if key in (" ", "p"):
                paused = not paused
                beat_started = now()
                due = beat_started + BEAT_SECONDS / (3 if fast else 1)
            elif key == "f":
                fast = not fast
                # Speed changes can never extend a running beat past its 1x deadline.
                due = min(beat_started + BEAT_SECONDS, now() + BEAT_SECONDS / (3 if fast else 1))
            elif key == "." and paused:
                game.tick()
            elif key in ("1", "2", "3", "v", *SIGNAL_KEYS):
                try:
                    order(game, key)
                except RuleError as err:
                    game.notice = str(err)
            else:
                dirty = False
        if not paused and game.phase is Phase.WAVE and now() >= due:
            game.tick()
            beat_started = now()
            due = beat_started + BEAT_SECONDS / (3 if fast else 1)
            dirty = True
        if dirty and game.phase is Phase.WAVE:
            paint(paused, fast)
    return False


def record(game: Game) -> str:
    if game.phase is Phase.LOST:
        outcome = f"Gate breached on wave {game.wave}."
    elif game.cleared >= FINAL_WAVE:
        outcome = "Watch complete. The lamp held through dawn."
    else:
        outcome = "Clocked off."
    return (f"{outcome}  Waves held {game.cleared}  |  "
            f"Dispersed {game.kills}  |  Crownwakes stopped {game.crowns}")


def play(game: Game, source: TextIO, output: TextIO, *, step: bool = False) -> None:
    interactive = source.isatty() and output.isatty()
    enabled = interactive and not step and os.environ.get("TERM") != "dumb"
    final_board = False
    try:
        with screen(output, enabled) as live_screen:
            color = live_screen and "NO_COLOR" not in os.environ
            page = ""
            while True:
                if live_screen and game.phase is Phase.WAVE:
                    def paint(paused: bool, fast: bool) -> None:
                        draw(output, frame(game, live=True, paused=paused, fast=fast, color=color),
                             live_screen, cursor=False)

                    with live_keys(source, output) as read_key:
                        if live_wave(game, read_key, paint):
                            break
                    continue
                if game.phase is Phase.LOST:
                    final_board = True
                    break
                draw(output, page or frame(game, color=color), live_screen)
                if interactive:
                    prompt = {Phase.BUILD: "workshop", Phase.WAVE: "beat", Phase.WON: "logbook"}
                    output.write(prompt[game.phase] + "> ")
                    output.flush()
                line = source.readline()
                if not line or line.strip().lower() in ("q", "quit"):
                    break
                try:
                    page = order(game, line, color)
                except RuleError as err:
                    game.notice = str(err)
                    page = ""
    except KeyboardInterrupt:
        pass
    if final_board:
        draw(output, frame(game), False)
        draw(output, report_view(game), False)
    output.write(record(game) + "\n")
    output.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description="Weirlight - defend the spillway in your terminal.")
    parser.add_argument("--step", action="store_true",
                        help="play one beat at a time using line commands (automatic for pipes)")
    parser.add_argument("--resume", action="store_true",
                        help="open the last workshop checkpoint from this game's folder")
    args = parser.parse_args()
    try:
        game = load_watch(WATCH_FILE) if args.resume else Game()
        play(game, sys.stdin, sys.stdout, step=args.step)
    except RuleError as err:
        parser.exit(1, f"Weirlight: {err}\n")
    except BrokenPipeError:
        # A pager or another command closed its end of the output pipe.
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass


if __name__ == "__main__":
    main()
