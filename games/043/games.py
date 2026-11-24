"""Rules and immutable positions for the two game boards."""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from functools import cached_property


DRAW = "draw"


@dataclass(frozen=True)
class Rules:
    title: str
    rows: int
    columns: int
    run_length: int
    gravity: bool
    move_order: tuple[int, ...]
    default_depth: int

    @cached_property
    def winning_masks(self) -> tuple[int, ...]:
        """Each mask contains one complete horizontal, vertical, or diagonal line."""
        masks = []
        for row in range(self.rows):
            for col in range(self.columns):
                for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                    end_row = row + (self.run_length - 1) * dr
                    end_col = col + (self.run_length - 1) * dc
                    if 0 <= end_row < self.rows and 0 <= end_col < self.columns:
                        mask = 0
                        for step in range(self.run_length):
                            index = (row + step * dr) * self.columns + col + step * dc
                            mask |= 1 << index
                        masks.append(mask)
        return tuple(masks)

    @cached_property
    def target_masks(self) -> tuple[int, ...]:
        """Cells a move can fill, indexed by the displayed move number minus one."""
        if self.gravity:
            return tuple(
                sum(1 << (row * self.columns + col) for row in range(self.rows))
                for col in range(self.columns)
            )
        return tuple(1 << cell for cell in range(self.rows * self.columns))


TIC_TAC_TOE = Rules(
    "Tic-tac-toe", rows=3, columns=3, run_length=3, gravity=False,
    move_order=(5, 1, 3, 7, 9, 2, 4, 6, 8), default_depth=9,
)
CONNECT_FOUR = Rules(
    "Connect Four", rows=6, columns=7, run_length=4, gravity=True,
    move_order=(4, 3, 5, 2, 6, 1, 7), default_depth=6,
)


@dataclass(frozen=True)
class Position:
    """Start with Position(rules). Each play returns a new position. X goes first."""

    rules: Rules
    x_bits: int = 0
    o_bits: int = 0

    @property
    def occupied(self) -> int:
        return self.x_bits | self.o_bits

    @property
    def remaining(self) -> int:
        return self.rules.rows * self.rules.columns - self.occupied.bit_count()

    @property
    def turn(self) -> str:
        return "O" if self.occupied.bit_count() % 2 else "X"

    @cached_property
    def outcome(self) -> str | None:
        """The winner's mark, DRAW, or None while play can continue."""
        # Only the player who just moved can have completed a line.
        last_mark, bits = ("X", self.x_bits) if self.turn == "O" else ("O", self.o_bits)
        if bits.bit_count() >= self.rules.run_length:
            if any(bits & line == line for line in self.rules.winning_masks):
                return last_mark
        return DRAW if self.remaining == 0 else None

    def cell_at(self, row: int, col: int) -> str | None:
        """Read a cell by zero-based row and column, starting at the top left."""
        if type(row) is not int or type(col) is not int:
            raise TypeError("Cell coordinates must be integers.")
        if not (0 <= row < self.rules.rows and 0 <= col < self.rules.columns):
            raise IndexError("Cell is outside the board.")
        bit = 1 << (row * self.rules.columns + col)
        if self.x_bits & bit:
            return "X"
        if self.o_bits & bit:
            return "O"
        return None

    def _choices(self) -> Iterator[tuple[int, int]]:
        if self.outcome is None:
            empty = ~self.occupied
            for move in self.rules.move_order:
                available = self.rules.target_masks[move - 1] & empty
                if available:
                    yield move, available

    def legal_moves(self) -> tuple[int, ...]:
        """Legal one-based move numbers, in deterministic search order."""
        return tuple(move for move, _ in self._choices())

    def _place(self, available: int) -> "Position":
        # Rows are numbered top to bottom. The highest free bit in a column
        # is its lowest free cell. In tic-tac-toe the mask has just one bit.
        piece = 1 << (available.bit_length() - 1)
        if self.turn == "X":
            return Position(self.rules, self.x_bits | piece, self.o_bits)
        return Position(self.rules, self.x_bits, self.o_bits | piece)

    def play(self, move: int) -> "Position":
        """Play a numbered square or drop into a numbered column."""
        if self.outcome is not None:
            raise ValueError("The game is over.")
        targets = self.rules.target_masks
        if type(move) is not int or not 1 <= move <= len(targets):
            raise ValueError(f"Choose a number from 1 to {len(targets)}.")
        available = targets[move - 1] & ~self.occupied
        if not available:
            raise ValueError("That column is full." if self.rules.gravity else "That square is occupied.")
        return self._place(available)

    def successors(self) -> Iterator[tuple[int, "Position"]]:
        """Generate children lazily so a pruned branch never constructs them."""
        for move, available in self._choices():
            yield move, self._place(available)

    def winning_moves(self) -> Iterator[int]:
        """Yield every legal move that wins on this turn, in board order."""
        for move, after in self.successors():
            if after.outcome == self.turn:
                yield move


class InvalidHistory(ValueError):
    """A move record cannot serve as the requested opening or replay."""


class GameHistory:
    """A chronological record of legal moves and the boards they produced."""

    def __init__(self, rules: Rules, moves: Iterable[int] = ()):
        self._start = Position(rules)
        self._turns: list[tuple[int, Position]] = []
        for ply, move in enumerate(moves, 1):
            try:
                self.play(move)
            except ValueError as error:
                raise InvalidHistory(f"Move {ply} ({move}) is invalid. {error}") from error

    @property
    def position(self) -> Position:
        return self._turns[-1][1] if self._turns else self._start

    @property
    def moves(self) -> tuple[int, ...]:
        return tuple(move for move, _ in self._turns)

    def turns(self) -> Iterator[tuple[Position, int]]:
        """Yield the board before each move together with the move that was played."""
        before = self._start
        for move, after in self._turns:
            yield before, move
            before = after

    def play(self, move: int) -> None:
        self._turns.append((move, self.position.play(move)))

    def undo_turn(self, plies: int = 2) -> bool:
        """Rewind exactly this many moves. The default takes back a move and reply."""
        if type(plies) is not int or plies < 1:
            raise ValueError("The number of plies to undo must be a positive integer.")
        if len(self._turns) < plies:
            return False
        del self._turns[-plies:]
        return True
