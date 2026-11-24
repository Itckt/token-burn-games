"""Board mechanics shared by the game and the search."""

from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from random import Random

SIZE = 4
TARGET = 2048
DIRECTIONS = ("up", "left", "right", "down")
SPAWNS = ((2, 0.9), (4, 0.1))

Row = tuple[int, ...]
Board = tuple[Row, ...]
Cell = tuple[int, int]
EMPTY_BOARD: Board = ((0,) * SIZE,) * SIZE


@lru_cache(maxsize=8192)
def _merge_left(row: Row) -> tuple[Row, int]:
    tiles = [tile for tile in row if tile]
    merged = []
    points = 0
    i = 0
    while i < len(tiles):
        value = tiles[i]
        if i + 1 < len(tiles) and value == tiles[i + 1]:
            value *= 2
            points += value
            i += 1
        merged.append(value)
        i += 1
    return tuple(merged) + (0,) * (SIZE - len(merged)), points


def slide(board: Board, direction: str) -> tuple[Board, int]:
    """Slide and merge once. Return the new board and points before spawning."""
    if direction not in DIRECTIONS:
        raise ValueError(f"Unknown direction {direction!r}")
    vertical = direction in ("up", "down")
    reverse = direction in ("right", "down")
    rows = zip(*board) if vertical else board
    result = []
    score = 0
    for row in rows:
        merged, points = _merge_left(row[::-1] if reverse else row)
        result.append(merged[::-1] if reverse else merged)
        score += points
    moved = tuple(zip(*result)) if vertical else tuple(result)
    return moved, score


def legal_moves(board: Board) -> Iterator[tuple[str, Board, int]]:
    for direction in DIRECTIONS:
        moved, points = slide(board, direction)
        if moved != board:
            yield direction, moved, points


def empty_cells(board: Board) -> list[Cell]:
    return [
        (r, c)
        for r, row in enumerate(board)
        for c, tile in enumerate(row)
        if tile == 0
    ]


def is_tile(value: object) -> bool:
    """A numbered tile is a power of two starting at two (zero is empty)."""
    return type(value) is int and value >= 2 and value & (value - 1) == 0


def place_tile(board: Board, cell: Cell, value: int) -> Board:
    """Return a board with the given empty cell filled."""
    r, c = cell
    if type(r) is not int or type(c) is not int or not (0 <= r < SIZE and 0 <= c < SIZE):
        raise IndexError("Tile position is outside the board")
    if not is_tile(value):
        raise ValueError("A tile must be a power of two of at least 2")
    row = board[r]
    if row[c] != 0:
        raise ValueError("A new tile needs an empty cell")
    filled = row[:c] + (value,) + row[c + 1:]
    return board[:r] + (filled,) + board[r + 1:]


def spawn_tile(board: Board, rng: Random) -> Board:
    cells = empty_cells(board)
    if not cells:
        return board
    cell = rng.choice(cells)
    two, four = SPAWNS
    value = two[0] if rng.random() < two[1] else four[0]
    return place_tile(board, cell, value)


def has_moves(board: Board) -> bool:
    if any(0 in row for row in board):
        return board != EMPTY_BOARD
    for r, row in enumerate(board):
        for c, tile in enumerate(row):
            if c + 1 < SIZE and tile == row[c + 1]:
                return True
            if r + 1 < SIZE and tile == board[r + 1][c]:
                return True
    return False


@dataclass
class Game:
    board: Board
    score: int = 0
    moves: int = 0

    @classmethod
    def new(cls, rng: Random) -> "Game":
        first = spawn_tile(EMPTY_BOARD, rng)
        return cls(spawn_tile(first, rng))

    @property
    def largest(self) -> int:
        return max(map(max, self.board))

    def move(self, direction: str, rng: Random) -> bool:
        """Apply one legal turn, including its spawn. A blocked slide does nothing."""
        moved, points = slide(self.board, direction)
        if moved == self.board:
            return False
        self.board = spawn_tile(moved, rng)
        self.score += points
        self.moves += 1
        return True
