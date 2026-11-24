"""Run Steamfold Noodle Works with Python 3.10 or newer."""

import argparse
import os
import shutil
import signal
import sqlite3
import sys
import time
from dataclasses import replace
from pathlib import Path

from desk import Reply, operate, page_lines, totals, welcome
from factory import RANKS
from ledger import Ledger, SaveError, Visit, open_ledger, slot_name
from terminal import console_keys, paint, screen_rows


SAVE_PATH = Path(__file__).resolve().with_name("steamfold.sqlite3")
AUTOSAVE_SECONDS = 15


def wall_ms() -> int:
    return time.time_ns() // 1_000_000


def perform(ledger: Ledger, page: str, text: str):
    with ledger.visit(wall_ms()) as visit:
        reply = operate(visit.factory, page, text)
    return visit.factory, replace(reply, settlement=visit.earnings.notices())


def line_console(ledger: Ledger, initial: Visit) -> None:
    state = initial.factory
    page = "floor"
    print("\n".join(page_lines(state, page)))
    print("> " + welcome(initial))
    print("Enter a key or a command, then press Enter. Type help for the guide.", flush=True)
    interactive = sys.stdin.isatty()
    while True:
        if interactive:
            print("works> ", end="", flush=True)
        line = sys.stdin.readline()
        if not line:
            return
        state, reply = perform(ledger, page, line)
        if reply.finished:
            if reply.settlement:
                print("> " + reply.settlement)
            return
        if reply.page != page or not reply.note:
            print("\n".join(page_lines(state, reply.page)))
        if reply.message:
            print("> " + reply.message)
            if reply.page == "floor":
                print(totals(state))
        page = reply.page
        sys.stdout.flush()


def live_console(ledger: Ledger, initial: Visit, read_key) -> str:
    state = initial.factory
    reply = Reply(note=welcome(initial))
    next_save = time.monotonic() + AUTOSAVE_SECONDS
    color = "NO_COLOR" not in os.environ
    last_rank = state.rank_index
    milestone = ""
    while True:
        now = wall_ms()
        due = time.monotonic() >= next_save
        if not due:
            earnings = state.advance(now)
            # Commit one-time receipts before displaying them. The next key reloads the ledger.
            due = earnings.has_event
        if due:
            visit = ledger.checkpoint(now)
            state, earnings = visit.factory, visit.earnings
            next_save = time.monotonic() + AUTOSAVE_SECONDS
        if earnings.has_event:
            reply = Reply(reply.page, earnings.notices())
            milestone = ""
        if state.rank_index > last_rank:
            title = RANKS[state.rank_index][1]
            milestone = f"Milestone reached! {title} at {state.shipped:,} packs."
        last_rank = state.rank_index
        size = shutil.get_terminal_size(fallback=(80, 24))
        note = " ".join(filter(None, (reply.message, milestone)))
        rows = screen_rows(state, reply.page, note, size.columns - 1, size.lines)
        sys.stdout.write(paint(rows, color))
        sys.stdout.flush()
        key = read_key(0.5)
        if key in (None, "", "\r", "\n"):
            continue
        if key in ("\x03", "\x04", "\x1a"):
            key = "q"
        elif key == "\x1b":
            key = "back"
        state, reply = perform(ledger, reply.page, key)
        milestone = ""
        if reply.finished:
            return reply.settlement
        next_save = time.monotonic() + AUTOSAVE_SECONDS


def _interrupt(signum, frame):
    raise KeyboardInterrupt


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Steamfold Noodle Works, an instant-noodle factory tycoon.")
    parser.add_argument("--plain", action="store_true", help="use line commands and a scrolling transcript")
    parser.add_argument("--slot", default="main", metavar="NAME", help="open a named factory (default: main)")
    args = parser.parse_args(argv)
    try:
        slot = slot_name(args.slot)
    except ValueError as error:
        parser.error(str(error))
    live = (not args.plain and sys.stdin.isatty() and sys.stdout.isatty()
            and os.environ.get("TERM") != "dumb")
    try:
        with open_ledger(SAVE_PATH, slot) as ledger:
            initial = ledger.checkpoint(wall_ms())
            exit_note = ""
            try:
                if live:
                    with console_keys() as read_key:
                        if read_key is not None:
                            exit_note = live_console(ledger, initial, read_key)
                    if read_key is None:
                        line_console(ledger, initial)
                else:
                    line_console(ledger, initial)
            except KeyboardInterrupt:
                pass
            final_visit = ledger.checkpoint(wall_ms())
            notices = " ".join(filter(None, (exit_note, final_visit.earnings.notices())))
            if notices:
                print("> " + notices)
            summary = totals(final_visit.factory)
            print(f"Shift saved in '{slot}'. {summary}.")
    except (sqlite3.Error, SaveError) as error:
        print(f"Save ledger error in {SAVE_PATH.name} for '{slot}'. {error}", file=sys.stderr)
        return 1
    except BrokenPipeError:
        return 0
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _interrupt)
    raise SystemExit(main())
