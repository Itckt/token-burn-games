"""Expectimax over legal slides and the complete random tile distribution."""

from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache
from math import fsum
from operator import attrgetter, itemgetter
from sys import float_info

from .engine import Board, Row, SIZE, SPAWNS, empty_cells, has_moves, legal_moves, place_tile, slide

DEFAULT_DEPTH = 2
DEPTHS = (1, 2, 3)
LOSS = -1_000_000
Score = float | Fraction
EXACT_SPAWNS = tuple((tile, Fraction(str(weight))) for tile, weight in SPAWNS)


@lru_cache(maxsize=8192)
def _line_value(line: Row) -> int:
    ranks = [tile.bit_length() - 1 if tile else 0 for tile in line]
    # Cubing the ranks makes disorder among the largest tiles more expensive.
    rise = fall = 0
    cubes = [rank ** 3 for rank in ranks]
    for a, b in zip(cubes, cubes[1:]):
        if a < b:
            rise += b - a
        else:
            fall += a - b
    occupied = [rank for rank in ranks if rank]
    pairs = sum(a == b for a, b in zip(occupied, occupied[1:]))
    roughness = sum(abs(a - b) for a, b in zip(occupied, occupied[1:]))
    return 80 * ranks.count(0) + 45 * pairs - 3 * min(rise, fall) - 4 * roughness


def evaluate(board: Board) -> int:
    """Favor free space, merge opportunities and orderly rows and columns."""
    if not has_moves(board):
        return LOSS
    return sum(map(_line_value, board)) + sum(map(_line_value, zip(*board)))


@lru_cache(maxsize=32768)
def _player_value(board: Board, depth: int, exact: bool = False) -> Score:
    if depth == 0:
        return evaluate(board)
    return max((value for _, _, _, value in _scored_slides(board, depth, exact)), default=LOSS)


@lru_cache(maxsize=16384)
def _chance_value(board: Board, depth: int, exact: bool = False) -> Score:
    cells = empty_cells(board)
    if not cells:
        return _player_value(board, depth, exact)
    weights = EXACT_SPAWNS if exact else SPAWNS
    outcomes = (
        probability * _player_value(place_tile(board, cell, tile), depth, exact)
        for cell in cells
        for tile, probability in weights
    )
    total = sum(outcomes) if exact else fsum(outcomes)
    return total / len(cells)


def _scored_slides(board: Board, depth: int, exact: bool = False) -> Iterator[tuple[str, Board, int, Score]]:
    for direction, moved, points in legal_moves(board):
        yield direction, moved, points, points + _chance_value(moved, depth - 1, exact)


def _spawn_loss_probability(moved: Board) -> float:
    """A legal slide leaves space; only filling its last square can end the game."""
    cells = empty_cells(moved)
    if len(cells) != 1:
        return 0.0
    return fsum(weight for tile, weight in SPAWNS
                if not has_moves(place_tile(moved, cells[0], tile)))


@dataclass(frozen=True)
class MoveAdvice:
    direction: str
    merge_points: int
    expected_value: Score
    loss_probability: float


def _root_slides(board: Board, depth: int) -> Iterator[tuple[str, Board, int, Score]]:
    if type(depth) is not int or depth < 1:
        raise ValueError("Search depth must be a positive integer")
    # A large merge can round two different search values to the same float
    # long before overflow. Bound both cumulative points and the chance sum.
    mass = sum(map(sum, board)) + depth * max(tile for tile, _ in SPAWNS)
    exact = mass * depth * SIZE ** 2 >= (1 << float_info.mant_dig)
    return _scored_slides(board, depth, exact)


def rank_moves(board: Board, depth: int = DEFAULT_DEPTH) -> list[MoveAdvice]:
    """Best first, preserving the game's direction order for exact ties."""
    options = [MoveAdvice(direction, points, value, _spawn_loss_probability(moved))
               for direction, moved, points, value in _root_slides(board, depth)]
    return sorted(options, key=attrgetter("expected_value"), reverse=True)


def choose_move(board: Board, depth: int = DEFAULT_DEPTH) -> str | None:
    """Look ahead depth player turns, including the spawn after the last slide."""
    best = max(_root_slides(board, depth), key=itemgetter(3), default=None)
    return best[0] if best is not None else None


@dataclass(frozen=True)
class MoveForecast:
    board: Board
    merge_points: int
    # Keys are the maximum immediate points on a reply. None means game over.
    replies: dict[int | None, Fraction]


def forecast_move(board: Board, direction: str) -> MoveForecast | None:
    """Preview a slide and the best immediate reply after each possible spawn."""
    moved, points = slide(board, direction)
    if moved == board:
        return None
    cells = empty_cells(moved)
    replies: dict[int | None, Fraction] = {}
    for cell in cells:
        for tile, weight in EXACT_SPAWNS:
            child = place_tile(moved, cell, tile)
            best = max((gain for _, _, gain in legal_moves(child)), default=None)
            replies[best] = replies.get(best, Fraction(0)) + weight / len(cells)
    return MoveForecast(moved, points, replies)
