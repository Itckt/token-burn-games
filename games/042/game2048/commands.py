"""Terminal commands that inspect recordings, puzzles and AI trials."""

import argparse
from pathlib import Path

from .ai import DEFAULT_DEPTH, DEPTHS
from .benchmark import print_benchmark
from .display import render, render_solution
from .puzzles import PUZZLES
from .replay import load_replay
from .review import render_review
from .session import Session


def add_depth_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--depth", type=int, choices=DEPTHS, default=DEFAULT_DEPTH,
                        help="AI search depth in player turns (defaults to %(default)s)")


def _replay_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m game2048 replay",
                                     description="Watch the slides in a recorded game.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--turn", type=int, metavar="N", help="show one turn (0 is the opening)")
    args = parser.parse_args(argv)
    try:
        frames = load_replay(args.file, turn=args.turn)
    except (OSError, ValueError) as exc:
        parser.error(f"{args.file}: {exc}")
    for frame in frames:
        label = f"{frame.direction} | +{frame.points} points" if frame.direction else "opening"
        print(f"Replay turn {frame.turn} | {label}")
        print(render(frame.game))
    return 0


def _review_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m game2048 review",
                                     description="Find replay decisions worth practicing.")
    parser.add_argument("file", type=Path)
    add_depth_option(parser)
    parser.add_argument("--top", type=int, default=5, metavar="N",
                        help="show up to N choices with the largest value gaps (default 5)")
    args = parser.parse_args(argv)
    if args.top < 0:
        parser.error("--top must be zero or greater")
    try:
        frames = load_replay(args.file)
    except (OSError, ValueError) as exc:
        parser.error(f"{args.file}: {exc}")
    print(render_review(frames, args.depth, args.top))
    return 0


def _solve_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m game2048 solve",
                                     description="Find a shortest solution from a puzzle opening.")
    parser.add_argument("puzzle", choices=PUZZLES)
    args = parser.parse_args(argv)
    print(render_solution(Session.new(puzzle=PUZZLES[args.puzzle])))
    return 0


def _benchmark_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m game2048 benchmark",
                                     description="Compare expectimax depths on the same seeds.")
    parser.add_argument("--seed", type=int, default=0, help="first seed (default 0)")
    parser.add_argument("--games", type=int, default=3, help="number of consecutive seeds (default 3)")
    parser.add_argument("--depths", type=int, choices=DEPTHS, nargs="+", default=[1, 2],
                        help="search depths to compare (default 1 2)")
    parser.add_argument("--moves", type=int, default=64, help="slide cap per game (default 64)")
    args = parser.parse_args(argv)
    if args.games < 1:
        parser.error("--games must be at least 1")
    if args.moves < 0:
        parser.error("--moves must be zero or greater")
    if len(set(args.depths)) != len(args.depths):
        parser.error("--depths must be distinct")
    print_benchmark(args.seed, args.games, args.depths, args.moves)
    return 0


COMMANDS = {"replay": _replay_main, "review": _review_main, "solve": _solve_main,
            "benchmark": _benchmark_main}
