"""Compare recorded decisions with expectimax on the position before each slide."""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from operator import attrgetter

from .ai import Score, rank_moves
from .display import format_value
from .replay import ReplayFrame


@dataclass(frozen=True)
class Decision:
    turn: int
    played: str
    best: str
    gap: Score


def review_decisions(frames: Sequence[ReplayFrame], depth: int) -> list[Decision]:
    decisions = []
    for before, after in pairwise(frames):
        options = rank_moves(before.game.board, depth)
        played = next(option for option in options if option.direction == after.direction)
        best = options[0]
        decisions.append(Decision(after.turn, played.direction, best.direction,
                                  best.expected_value - played.expected_value))
    return decisions


def render_review(frames: Sequence[ReplayFrame], depth: int, top: int) -> str:
    decisions = review_decisions(frames, depth)
    misses = [decision for decision in decisions if decision.gap > 0]
    matched = len(decisions) - len(misses)
    gained = frames[-1].game.score - frames[0].game.score
    lines = [f"Replay review | depth {depth} | {gained:+d} points in this recording",
             f"Slides matching the best value   {matched}/{len(decisions)}"]
    if not decisions:
        lines.append("The recording contains only its opening.")
    elif top and misses:
        lines.extend(("", "Replay turn  Played  Best    Search value gap  Fork turn"))
        for choice in sorted(misses, key=attrgetter("gap"), reverse=True)[:top]:
            gap = "<0.01" if choice.gap < 0.005 else format_value(choice.gap)
            lines.append(f"{choice.turn:>11}  {choice.played:<6}  {choice.best:<5}"
                         f"  {gap:>15}  {choice.turn - 1:>9}")
    return "\n".join(lines)
