"""Live turns, reversible history and challenge rules."""

from collections import deque
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from random import Random

from .engine import Board, Game
from .puzzles import Puzzle

HISTORY_LIMIT = 64
DAILY_MOVES = 64
HONG_KONG = timezone(timedelta(hours=8))


def hong_kong_today() -> date:
    return datetime.now(HONG_KONG).date()


def parse_day(text: str) -> date:
    day = date.fromisoformat(text)
    if day.isoformat() != text:
        raise ValueError("Use a date in YYYY-MM-DD format")
    return day


@dataclass(frozen=True)
class Position:
    board: Board
    score: int
    moves: int
    random_state: tuple

    @classmethod
    def capture(cls, game: Game, rng: Random) -> "Position":
        return cls(game.board, game.score, game.moves, rng.getstate())

    def restore(self, game: Game, rng: Random) -> None:
        rng.setstate(self.random_state)
        game.board, game.score, game.moves = self.board, self.score, self.moves


class Session:
    def __init__(self, game: Game, rng: Random, *, day: date | None = None,
                 puzzle: Puzzle | None = None, record: bool = False):
        if day is not None and puzzle is not None:
            raise ValueError("Choose one challenge per session")
        self.game = game
        self.rng = rng
        self.day = day
        self.puzzle = puzzle
        self.recording_start = Position.capture(game, rng) if record else None
        self._directions: list[str] = []
        self._past: deque[Position] = deque(maxlen=HISTORY_LIMIT)
        self._future: deque[Position] = deque(maxlen=HISTORY_LIMIT)

    @classmethod
    def new(cls, seed: int | None = None, *, day: date | None = None,
            puzzle: Puzzle | None = None, record: bool = False) -> "Session":
        if puzzle is not None:
            if day is not None or seed is not None:
                raise ValueError("A puzzle has its own opening and seed")
            return cls(Game(puzzle.board), Random(puzzle.seed), puzzle=puzzle, record=record)
        if day is not None:
            if seed is not None:
                raise ValueError("Choose a seed or a daily challenge, not both")
            seed = int(day.isoformat().replace("-", ""))
        rng = Random(seed)
        return cls(Game.new(rng), rng, day=day, record=record)

    @property
    def daily_finished(self) -> bool:
        return self.challenge_outcome(self.game) == "sprint complete"

    def challenge_outcome(self, game: Game) -> str | None:
        if self.day is not None and game.moves >= DAILY_MOVES:
            return "sprint complete"
        return self.puzzle.outcome(game) if self.puzzle else None

    @property
    def can_undo(self) -> bool:
        return bool(self._past)

    @property
    def recorded_directions(self) -> list[str]:
        if self.recording_start is None:
            raise ValueError("Recording was not enabled for this session")
        return self._directions[:self.game.moves - self.recording_start.moves]

    def fork(self, *, record: bool = False) -> "Session":
        """Start an independent history at this turn with the same future draws."""
        rng = Random(0)
        rng.setstate(self.rng.getstate())
        return Session(replace(self.game), rng, day=self.day, puzzle=self.puzzle, record=record)

    def move(self, direction: str) -> bool:
        if self.challenge_outcome(self.game) is not None:
            return False
        before = Position.capture(self.game, self.rng)
        if not self.game.move(direction, self.rng):
            return False
        if self.recording_start is not None:
            # Undo/redo moves the cursor implicitly. A successful new turn branches here.
            offset = before.moves - self.recording_start.moves
            self._directions[offset:] = [direction]
        self._past.append(before)
        self._future.clear()
        return True

    def _rewind(self, source: deque[Position], destination: deque[Position]) -> bool:
        if not source:
            return False
        destination.append(Position.capture(self.game, self.rng))
        source.pop().restore(self.game, self.rng)
        return True

    def undo(self) -> bool:
        return self._rewind(self._past, self._future)

    def redo(self) -> bool:
        return self._rewind(self._future, self._past)
