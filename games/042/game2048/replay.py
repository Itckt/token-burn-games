"""Record the active line of play and reproduce it through the normal game rules."""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path

from .checkpoint import game_from_record, position_record, session_from_record
from .engine import DIRECTIONS, Game
from .session import Session
from .storage import read_json, write_json

MAX_BYTES = 1024 * 1024


def save_replay(path: Path, session: Session) -> None:
    if session.recording_start is None:
        raise ValueError("Recording was not enabled for this session")
    game = session.game
    record = {
        "format": "2048-replay",
        "version": 1,
        "opening": position_record(session.recording_start, session.day, session.puzzle),
        "directions": session.recorded_directions,
        "finish": {"board": game.board, "score": game.score, "moves": game.moves},
    }
    write_json(path, record, MAX_BYTES)


@dataclass(frozen=True)
class ReplayFrame:
    turn: int
    game: Game
    direction: str | None = None
    points: int = 0


def _playback(path: Path, turn: int | None) -> Iterator[tuple[ReplayFrame, Session]]:
    """Yield selected frames with their live cursor. Exhaust to verify the finish."""
    record = read_json(path, MAX_BYTES)
    if (not isinstance(record, dict) or record.get("format") != "2048-replay"
            or type(record.get("version")) is not int or record["version"] != 1):
        raise ValueError("Unrecognized replay format or version")
    directions = record.get("directions")
    if not isinstance(directions, list):
        raise ValueError("Replay directions must be a list")
    if turn is not None and (type(turn) is not int or not 0 <= turn <= len(directions)):
        raise ValueError(f"Choose a replay turn from 0 to {len(directions)}")
    session = session_from_record(record.get("opening"))
    finish = game_from_record(record.get("finish"))
    game = session.game
    if turn in (None, 0):
        yield ReplayFrame(0, replace(game)), session
    for index, direction in enumerate(directions, 1):
        before = game.score
        if direction not in DIRECTIONS or not session.move(direction):
            raise ValueError(f"Illegal slide at replay turn {index}")
        if turn is None or turn == index:
            yield ReplayFrame(index, replace(game), direction, game.score - before), session
    if game != finish:
        raise ValueError("Replay finish does not match the recorded board, score and move count")


def load_replay(path: Path, *, turn: int | None = None) -> list[ReplayFrame]:
    """Verify every slide and the finish, retaining just the requested frames."""
    return [frame for frame, _ in _playback(path, turn)]


def fork_replay(path: Path, *, turn: int = 0, record: bool = False) -> Session:
    """Resume at a replay turn after verifying the entire original line of play."""
    if type(turn) is not int:
        raise ValueError("Choose an integer replay turn")
    # Copy at the chosen turn and finish checking the source before returning it.
    branches = [live.fork(record=record) for _, live in _playback(path, turn)]
    return branches[0]
