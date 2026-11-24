"""Command-line entry point for Pinchline Six."""

import argparse
import errno
import os
import stat
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager, suppress
from pathlib import Path
from random import SystemRandom
from typing import TextIO

from .arena import COURTS
from .battle import BEAT_LIMIT, MODES, STAMP_TARGET, Battle, Outcome
from .render import card_view, frame, match_report, roster_view
from .replay import RecordedBeat, read_replay, write_replay
from .roster import COPPER, COPPER_DRAFT, INDIGO, INDIGO_DRAFT
from .series import Lineup, Matchup
from .tactics import DEFAULT_ORDER, ORDERS


@contextmanager
def _live_terminal(stream: TextIO, requested: bool) -> Iterator[bool]:
    if not requested or not stream.isatty() or os.environ.get("TERM") == "dumb":
        yield False
        return
    if os.name != "nt":
        yield True
        return

    # Use in-place frames on a Windows console that accepts VT sequences.
    # Restore the caller's console mode even when a viewer presses Ctrl+C.
    import ctypes
    import msvcrt

    kernel = ctypes.windll.kernel32
    try:
        handle = ctypes.c_void_p(msvcrt.get_osfhandle(stream.fileno()))
    except (OSError, ValueError):
        # Some terminal-like streams have no underlying Windows console handle.
        yield False
        return
    mode = ctypes.c_ulong()
    if not kernel.GetConsoleMode(handle, ctypes.byref(mode)):
        yield False
        return
    enable_vt = 0x0004
    changed = not (mode.value & enable_vt)
    if changed and not kernel.SetConsoleMode(handle, mode.value | enable_vt):
        yield False
        return
    try:
        yield True
    finally:
        if changed:
            kernel.SetConsoleMode(handle, mode.value)


def _write_frame(board: str, stream: TextIO, live: bool, delay: float, last: bool) -> None:
    prefix = "\x1b[2J\x1b[H" if live else ""
    stream.write(prefix + board + "\n")
    stream.flush()
    if not last:
        if live:
            time.sleep(delay)
        else:
            stream.write("\n")


def _show(battle: Battle, stream: TextIO, view: str, delay: float,
          recording: list[RecordedBeat] | None = None) -> Outcome:
    with _live_terminal(stream, view == "auto") as live:
        show_all = live or view == "frames"
        if not show_all and recording is None:
            battle.run()
        while True:
            board = frame(battle)
            if recording is not None:
                recording.append(RecordedBeat(board, match_report(battle)))
            if show_all or battle.result is not None:
                _write_frame(board, stream, live, delay, battle.result is not None)
            if battle.result is not None:
                return battle.result
            battle.step()


def _series(matchup: Matchup, seed: int, count: int, view: str, report: bool, stream: TextIO) -> int:
    wins = {COPPER: 0, INDIGO: 0}
    draws = 0
    for leg in matchup.pairs(seed, count):
        battle = leg.battle
        if leg.pair == 1 and leg.number == 1:
            print(f"PAIRED SERIES   /   {battle.court.name}   /   {battle.mode}", file=stream)
            for team in (COPPER, INDIGO):
                names = " ".join(f.hero.name for f in battle.crew(team))
                deck = battle.decks.get(team)
                cards = "   |   " + " > ".join(deck.remaining) if deck else ""
                order = battle.orders[team]
                tactics = f"   |   targets {order}" if order != DEFAULT_ORDER else ""
                print(f"{team} draft   {names}{cards}{tactics}", file=stream)
        print(f"\nPair {leg.pair}  Leg {leg.number}   seed {battle.seed}   "
              f"Copper fields {leg.draft_on(COPPER)} / Indigo fields {leg.draft_on(INDIGO)}", file=stream)
        try:
            if view == "auto":
                result = battle.run()
            else:
                result = _show(battle, stream, view, 0)
        except KeyboardInterrupt:
            print(f"\nSeries stopped in pair {leg.pair}, leg {leg.number} after beat {battle.beat}.",
                  file=stream)
            return 130
        if result.winner is None:
            draws += 1
            verdict = "Draw"
        else:
            winner = leg.draft_on(result.winner)
            wins[winner] += 1
            verdict = f"{winner} draft wins"
        print(f"  Beat {battle.beat:02}   {verdict} ({result.reason}).", file=stream)
        if report:
            print("\n" + match_report(battle), file=stream)
    print(f"\nSERIES   Copper draft wins {wins[COPPER]}   Indigo draft wins {wins[INDIGO]}   Draws {draws}",
          file=stream)
    if wins[COPPER] == wins[INDIGO]:
        print("Series tied.", file=stream)
    else:
        leader = max(wins, key=wins.__getitem__)
        print(f"{leader} draft wins the series.", file=stream)
    return 0


def _playback_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--view", choices=("auto", "frames", "final"), default="auto",
                        help="auto animates a terminal or prints the piped result. "
                             "frames prints every beat and final prints the result board")
    parser.add_argument("--delay", type=float, default=0.4,
                        help="seconds between live beats, 0 to 10 (defaults to 0.4)")
    parser.add_argument("--report", action="store_true", help="print the hero contribution table")


def _parse(parser: argparse.ArgumentParser, argv: Sequence[str]) -> argparse.Namespace:
    args = parser.parse_args(argv)
    if not 0 <= args.delay <= 10:
        parser.error("--delay must be between 0 and 10 seconds")
    return args


def _replay(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m pinchline replay",
                                     description="Watch a saved match or inspect a single beat.")
    parser.add_argument("file", type=Path, help="JSON match recorded with --record")
    parser.add_argument("--beat", type=int, metavar="N", help="show just beat N (the deal is beat 0)")
    _playback_options(parser)
    args = _parse(parser, argv)
    try:
        tape = read_replay(args.file)
    except (OSError, ValueError) as error:
        parser.error(f"cannot read replay '{args.file}': {error}")
    last = len(tape) - 1
    if args.beat is not None and not 0 <= args.beat <= last:
        parser.error(f"--beat must be between 0 and {last} for this replay")
    beat = 0
    try:
        with _live_terminal(sys.stdout, args.view == "auto" and args.beat is None) as live:
            end = last if args.beat is None else args.beat
            first = 0 if args.beat is None and (live or args.view == "frames") else end
            for beat in range(first, end + 1):
                _write_frame(tape[beat].board, sys.stdout, live, args.delay, beat == end)
        if args.report:
            print("\n" + tape[end].report)
    except KeyboardInterrupt:
        print(f"\nReplay stopped at beat {beat}.")
        return 130
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if argv and argv[0] == "replay":
        return _replay(argv[1:])
    parser = argparse.ArgumentParser(
        prog="python -m pinchline",
        description="Watch two trios battle on a folding court in Kowloon Tong.",
        epilog="Watch a recording with python -m pinchline replay FILE [--beat N] [--report].",
    )
    parser.add_argument("--seed", type=int, help="replay a deal and its tie-breaks (defaults to a fresh seed)")
    catalogs = parser.add_mutually_exclusive_group()
    catalogs.add_argument("--roster", action="store_true", help="show all six hero cards and exit")
    catalogs.add_argument("--cards", action="store_true", help="show the sideline cards and ink costs")
    parser.add_argument("--court", choices=COURTS, default="loop",
                        help="play on Tong Loop Court, Galley Steps, or Tramline Press")
    parser.add_argument("--mode", choices=MODES, default="knockout",
                        help=f"play knockout, earn {STAMP_TARGET} stamps, carry a proof, or push the rail roller")
    parser.add_argument(
        "--copper", nargs=3, metavar="HERO", default=COPPER_DRAFT, help="draft Copper's A, B, C"
    )
    parser.add_argument(
        "--indigo", nargs=3, metavar="HERO", default=INDIGO_DRAFT, help="draft Indigo's x, y, z"
    )
    for team in ("copper", "indigo"):
        parser.add_argument(f"--{team}-deck", nargs="+", metavar="CARD", default=(),
                            help=f"give {team.title()} up to three sideline cards in play order")
        parser.add_argument(f"--{team}-order", choices=ORDERS, type=str.lower, default=DEFAULT_ORDER,
                            help=f"choose which foe {team.title()} targets (defaults to {DEFAULT_ORDER})")
    fixtures = parser.add_mutually_exclusive_group()
    fixtures.add_argument("--pairs", type=int, metavar="N",
                          help="play N pairs with sides reversed. The default view tallies draft wins")
    fixtures.add_argument("--record", type=Path, metavar="FILE",
                          help="save every board and report from a single match to a JSON replay")
    parser.add_argument(
        "--limit", type=int, default=BEAT_LIMIT,
        help=f"ring the final bell after this many beats (defaults to {BEAT_LIMIT})",
    )
    _playback_options(parser)
    args = _parse(parser, argv)
    if args.roster:
        print(roster_view())
        return 0
    if args.cards:
        print(card_view())
        return 0
    seed = SystemRandom().getrandbits(32) if args.seed is None else args.seed
    matchup = Matchup(Lineup(tuple(args.copper), tuple(args.copper_deck), args.copper_order),
                      Lineup(tuple(args.indigo), tuple(args.indigo_deck), args.indigo_order),
                      limit=args.limit, court=args.court, mode=args.mode)
    try:
        if args.pairs is not None:
            return _series(matchup, seed, args.pairs, args.view, args.report, sys.stdout)
        battle = matchup.deal(seed)
    except ValueError as error:
        parser.error(str(error))
    recording = [] if args.record is not None else None
    try:
        _show(battle, sys.stdout, args.view, args.delay, recording)
        if recording is not None:
            try:
                write_replay(args.record, recording)
            except OSError as error:
                parser.error(f"cannot write replay '{args.record}': {error}")
    except KeyboardInterrupt:
        print(f"\nMatch stopped after beat {battle.beat}.")
        return 130
    if args.report:
        print("\n" + match_report(battle))
    return 0


def _entrypoint() -> int:
    try:
        status = main()
        sys.stdout.flush()
        return status
    except OSError as error:
        # The Windows CRT can report EINVAL when a pipe reader closes early.
        if not isinstance(error, BrokenPipeError):
            if (os.name != "nt" or error.errno != errno.EINVAL
                    or not stat.S_ISFIFO(os.fstat(sys.stdout.fileno()).st_mode)):
                raise
        with suppress(OSError):
            sys.stdout.close()
        return 0


if __name__ == "__main__":
    raise SystemExit(_entrypoint())
