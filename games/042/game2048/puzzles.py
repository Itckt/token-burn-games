"""Short, repeatable 2048 positions with a tile to reach and a slide budget."""

from collections import deque
from dataclasses import dataclass, replace
from random import Random

from .engine import DIRECTIONS, Board, Game, has_moves


@dataclass(frozen=True)
class Puzzle:
    key: str
    title: str
    target: int
    limit: int
    seed: int
    board: Board

    def outcome(self, game: Game) -> str | None:
        if game.largest >= self.target:
            return "solved"
        if game.moves >= self.limit:
            return "out of slides"
        if not has_moves(game.board):
            return "no legal slides"
        return None

    def shortest_solution(self, game: Game, rng: Random) -> tuple[str, ...] | None:
        """Search the remaining puzzle turns in order of path length."""
        outcome = self.outcome(game)
        if outcome is not None:
            return () if outcome == "solved" else None
        frontier = deque([(game, rng.getstate(), ())])
        branch_rng = Random(0)
        while frontier:
            parent, state, path = frontier.popleft()
            for direction in DIRECTIONS:
                child = replace(parent)
                branch_rng.setstate(state)
                if not child.move(direction, branch_rng):
                    continue
                route = (*path, direction)
                outcome = self.outcome(child)
                if outcome == "solved":
                    return route
                if outcome is None:
                    frontier.append((child, branch_rng.getstate(), route))
        return None


PUZZLES = {puzzle.key: puzzle for puzzle in (
    Puzzle("double-merge", "Double Merge", 32, 2, 41, (
        (8, 8, 16, 0),
        (0, 0, 0, 0),
        (0, 0, 0, 0),
        (0, 0, 0, 0),
    )),
    Puzzle("switchback", "Switchback", 64, 3, 73, (
        (2, 8, 16, 32),
        (4, 16, 32, 8),
        (16, 4, 0, 8),
        (8, 4, 16, 32),
    )),
    Puzzle("last-train", "Last Train at Kowloon Tong", 128, 5, 19, (
        (2, 8, 8, 0),
        (64, 4, 0, 2),
        (16, 16, 16, 0),
        (8, 32, 4, 4),
    )),
)}
