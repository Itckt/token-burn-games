"""Versioned JSON checkpoints. Only the current position goes to disk."""

from datetime import date
from math import isfinite
from pathlib import Path
from random import Random

from .engine import SIZE, Board, Game, is_tile
from .puzzles import PUZZLES, Puzzle
from .session import DAILY_MOVES, Position, Session, parse_day
from .storage import read_json, write_json

VERSION = 2
MAX_BYTES = 128 * 1024


def position_record(position: Position, day: date | None, puzzle: Puzzle | None) -> dict:
    return {"version": VERSION, "board": position.board, "score": position.score,
            "moves": position.moves, "rng": position.random_state,
            "daily": day.isoformat() if day else None,
            "puzzle": puzzle.key if puzzle else None}


def save_session(path: Path, session: Session) -> None:
    position = Position.capture(session.game, session.rng)
    write_json(path, position_record(position, session.day, session.puzzle), MAX_BYTES)


def _board(rows: object) -> Board:
    if not isinstance(rows, list) or len(rows) != SIZE or any(
        not isinstance(row, list) or len(row) != SIZE for row in rows
    ):
        raise ValueError(f"Board must have {SIZE} rows and {SIZE} columns")
    if any(type(tile) is not int or (tile != 0 and not is_tile(tile))
           for row in rows for tile in row):
        raise ValueError("Board contains an invalid tile")
    return tuple(tuple(row) for row in rows)


def _generator(state: object) -> Random:
    if not isinstance(state, list) or len(state) != 3:
        raise ValueError("Invalid random generator state")
    version, words, gaussian = state
    if (type(version) is not int or version != Random.VERSION
            or not isinstance(words, list) or not any(words[:-1])
            or not all(type(word) is int and 0 <= word < 2**32 for word in words)
            or (gaussian is not None and not (type(gaussian) is float and isfinite(gaussian)))):
        raise ValueError("Invalid random generator state")
    rng = Random(0)
    try:
        rng.setstate((version, tuple(words), gaussian))
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Invalid random generator state") from exc
    return rng


def game_from_record(record: object) -> Game:
    if not isinstance(record, dict):
        raise ValueError("Missing game position")
    board = _board(record.get("board"))
    score, moves = record.get("score"), record.get("moves")
    if not all(type(value) is int and value >= 0 for value in (score, moves)):
        raise ValueError("Score and move count must be nonnegative integers")
    return Game(board, score, moves)


def session_from_record(record: object, *, record_moves: bool = False) -> Session:
    if (not isinstance(record, dict) or type(record.get("version")) is not int
            or record["version"] not in (1, VERSION)):
        raise ValueError("Unrecognized checkpoint version")
    game = game_from_record(record)
    day = record.get("daily")
    if day is not None:
        if not isinstance(day, str) or game.moves > DAILY_MOVES:
            raise ValueError("Invalid daily sprint date or move count")
        day = parse_day(day)
    puzzle = None
    key = record.get("puzzle") if record["version"] >= 2 else None
    if key is not None:
        if not isinstance(key, str) or key not in PUZZLES:
            raise ValueError("Unknown checkpoint puzzle")
        puzzle = PUZZLES[key]
        if day is not None or game.moves > puzzle.limit:
            raise ValueError("Invalid puzzle mode or move count")
    return Session(game, _generator(record.get("rng")), day=day, puzzle=puzzle, record=record_moves)


def load_session(path: Path, *, record: bool = False) -> Session:
    return session_from_record(read_json(path, MAX_BYTES), record_moves=record)
