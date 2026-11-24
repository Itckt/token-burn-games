"""Line-oriented interface for human play and unattended AI games."""

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from random import Random

from .ai import DEFAULT_DEPTH, choose_move
from .checkpoint import load_session, save_session
from .commands import COMMANDS, add_depth_option
from .display import challenge_ending, render, render_coach, render_preview, render_solution
from .engine import Board, DIRECTIONS, TARGET, Game, has_moves
from .puzzles import PUZZLES
from .replay import fork_replay, save_replay
from .session import DAILY_MOVES, Session, hong_kong_today, parse_day

KEYS = {"w": "up", "a": "left", "s": "down", "d": "right"}
CONTROLS = ("Type a command and press Enter.\n"
            "W up | A left | S down | D right     H hint | C coach | P AI move\n"
            "preview DIR | solve (puzzles) | U undo | R redo | save PATH | ? help | Q quit")
TROPHY = "2048 reached! You earned the Kowloon Tong night-league trophy."


@dataclass(frozen=True)
class SaveRequest:
    path: Path


@dataclass(frozen=True)
class PreviewRequest:
    direction: str


def read_move(board: Board, depth: int) -> str | SaveRequest | PreviewRequest | None:
    """Handle read-only prompts inline; return a slide or session action."""
    while True:
        try:
            raw = input("Move> ").strip()
        except EOFError:
            return None
        words = raw.split(maxsplit=1)
        if words and words[0].lower() == "save":
            if len(words) == 2:
                return SaveRequest(Path(words[1]))
            print("Usage: save PATH (spaces are fine; no quotes needed).")
            continue
        command = raw.lower()
        if words and words[0].lower() == "preview":
            argument = words[1].lower() if len(words) == 2 else ""
            direction = KEYS.get(argument, argument)
            if direction in DIRECTIONS:
                return PreviewRequest(direction)
            print("Use preview up, left, right or down. W/A/S/D also work.")
            continue
        if command == "solve":
            return "solve"
        if command in ("q", "quit"):
            return None
        if command in ("?", "help"):
            print(CONTROLS)
            continue
        if command in ("c", "coach"):
            print(render_coach(board, depth))
            continue
        if command in ("u", "undo"):
            return "undo"
        if command in ("r", "redo"):
            return "redo"
        if command in ("h", "hint", "p", "ai"):
            direction = choose_move(board, depth)
            if direction is None:
                print("No legal slides remain.")
                continue
            if command in ("h", "hint"):
                print(f"Try sliding {direction}.")
                continue
            print(f"AI slides {direction}.")
            return direction
        direction = KEYS.get(command, command)
        if direction in DIRECTIONS:
            return direction
        print(f"Unknown command. {CONTROLS}")


def _check_paths(record_path: Path | None, *checkpoints: Path | None,
                 replay_source: Path | None = None) -> None:
    if record_path is None and replay_source is None:
        return
    try:
        paths = {path.resolve() for path in checkpoints if path is not None}
        recording = record_path.resolve() if record_path is not None else None
        source = replay_source.resolve() if replay_source is not None else None
    except RuntimeError as exc:  # Path.resolve raises this on a symlink loop in Python 3.10/3.11.
        raise ValueError(str(exc)) from exc
    if recording in paths:
        raise ValueError("--record and checkpoint files need different paths")
    if source is not None and (source == recording or source in paths):
        raise ValueError("--fork and output files need different paths")


def _write_file(session: Session, path: Path, writer: Callable[[Path, Session], None] = save_session,
                label: str = "Checkpoint", *, record_path: Path | None = None,
                replay_source: Path | None = None) -> bool:
    try:
        _check_paths(record_path, path, replay_source=replay_source)
        writer(path, session)
    except (OSError, ValueError) as exc:
        print(f"Could not save {path}: {exc}", file=sys.stderr)
        return False
    print(f"{label} saved: {path}")
    return True


def _undo_after_loss() -> bool:
    try:
        answer = input("No legal slides. Type U to undo the last slide, or Enter to finish: ")
    except EOFError:
        return False
    return answer.strip().lower() in ("u", "undo")


def play_session(session: Session, *, ai: bool = False, depth: int = DEFAULT_DEPTH,
                 move_limit: int | None = None, quiet: bool = False,
                 record_path: Path | None = None, replay_source: Path | None = None) -> None:
    game = session.game
    trophy_seen = game.largest >= TARGET
    if session.day is not None:
        print(f"Daily sprint {session.day} | {DAILY_MOVES} slides | Hong Kong")
    if session.puzzle:
        puzzle = session.puzzle
        print(f"{puzzle.title} | Reach {puzzle.target} in {puzzle.limit} slides")
    if not ai:
        print(CONTROLS)
    if not quiet:
        print(render(game))

    while True:
        ending = challenge_ending(session)
        if ending:
            break
        at_limit = move_limit is not None and game.moves >= move_limit
        if not has_moves(game.board):
            if ai or at_limit or not session.can_undo or not _undo_after_loss():
                ending = "Game over. No legal slides remain."
                break
            action = "undo"
        elif at_limit:
            ending = "Move limit reached."
            break
        elif ai:
            action = choose_move(game.board, depth)
            if not quiet:
                print(f"AI slides {action}.")
        else:
            action = read_move(game.board, depth)
        if action is None:
            ending = "Session ended."
            break
        if isinstance(action, SaveRequest):
            _write_file(session, action.path, record_path=record_path, replay_source=replay_source)
            continue
        if isinstance(action, PreviewRequest):
            print(render_preview(session, action.direction, move_limit))
            continue
        if action == "solve":
            print(render_solution(session, move_limit))
            continue
        if action in ("undo", "redo"):
            changed = session.undo() if action == "undo" else session.redo()
            if not changed:
                print(f"Nothing to {action}.")
                continue
        elif not session.move(action):
            print("That slide is blocked. Try another direction.")
            continue
        if not quiet:
            print(render(game))
            if not trophy_seen and game.largest >= TARGET:
                print(TROPHY)
                trophy_seen = True

    if quiet:
        print(render(game))
        if game.largest >= TARGET:
            print(TROPHY)
    print(ending)


def play(game: Game, rng: Random, *, ai: bool = False, depth: int = DEFAULT_DEPTH,
         move_limit: int | None = None, quiet: bool = False) -> None:
    """Play from a caller-supplied board and generator, updating both in place."""
    play_session(Session(game, rng), ai=ai, depth=depth, move_limit=move_limit, quiet=quiet)


def _play_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m game2048",
        description="Play 2048 in your terminal or watch an expectimax player.",
        epilog="Use 'replay FILE' to watch a recording, 'review FILE' to study your choices, "
               "'solve PUZZLE' for a shortest route, or 'benchmark' to compare AI depths. "
               "Each command accepts --help.",
    )
    parser.add_argument("--ai", action="store_true", help="let the AI play every turn")
    opening = parser.add_mutually_exclusive_group()
    opening.add_argument("--seed", type=int, help="seed the random tile generator")
    opening.add_argument("--daily", nargs="?", type=parse_day, const=hong_kong_today(),
                         metavar="YYYY-MM-DD", help=f"{DAILY_MOVES}-slide daily sprint (Hong Kong date)")
    opening.add_argument("--load", type=Path, metavar="FILE", help="resume a JSON checkpoint")
    opening.add_argument("--fork", type=Path, metavar="REPLAY", help="play from a verified replay")
    opening.add_argument("--puzzle", choices=PUZZLES, help="play a fixed tile-and-slide puzzle")
    parser.add_argument("--list-puzzles", action="store_true", help="show the puzzle catalog and exit")
    parser.add_argument("--save", type=Path, metavar="FILE", help="write a checkpoint on normal exit")
    parser.add_argument("--record", type=Path, metavar="FILE", help="write a replay on normal exit")
    parser.add_argument("--turn", type=int, metavar="N", help="start --fork at replay turn N (default 0)")
    add_depth_option(parser)
    parser.add_argument("--moves", type=int, metavar="N",
                        help="stop at N total successful moves (including moves before a save)")
    parser.add_argument("--quiet", action="store_true",
                        help="show only the final board and result in AI mode")
    args = parser.parse_args(argv)
    if args.list_puzzles:
        print("Puzzle        Target  Slides  Title")
        for puzzle in PUZZLES.values():
            print(f"{puzzle.key:<12}  {puzzle.target:>6}  {puzzle.limit:>6}  {puzzle.title}")
        return 0
    if args.moves is not None and args.moves < 0:
        parser.error("--moves must be zero or greater")
    if args.quiet and not args.ai:
        parser.error("--quiet requires --ai")
    if args.turn is not None and args.fork is None:
        parser.error("--turn requires --fork")
    try:
        _check_paths(args.record, args.load, args.save, replay_source=args.fork)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    if args.fork is not None:
        try:
            session = fork_replay(args.fork, turn=args.turn or 0, record=bool(args.record))
        except (OSError, ValueError) as exc:
            parser.error(f"--fork {args.fork}: {exc}")
    elif args.load:
        try:
            session = load_session(args.load, record=bool(args.record))
        except (OSError, ValueError) as exc:
            parser.error(f"--load {args.load}: {exc}")
    else:
        session = Session.new(args.seed, day=args.daily, puzzle=PUZZLES.get(args.puzzle),
                              record=bool(args.record))
    print("2048  |  Kowloon Tong study break")
    play_session(session, ai=args.ai, depth=args.depth, move_limit=args.moves, quiet=args.quiet,
                 record_path=args.record, replay_source=args.fork)
    saved = not args.save or _write_file(session, args.save, record_path=args.record,
                                          replay_source=args.fork)
    if args.record and not _write_file(session, args.record, save_replay, "Replay",
                                       replay_source=args.fork):
        return 1
    return 0 if saved else 1


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    try:
        if args and args[0] in COMMANDS:
            return COMMANDS[args[0]](args[1:])
        return _play_main(args)
    except KeyboardInterrupt:
        print("\nSession interrupted.")
        return 130
