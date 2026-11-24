"""Versioned match recordings. Each beat keeps its original ASCII board and report."""

import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

FORMAT = "pinchline-six-replay"
VERSION = 1


def _plain_text(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    return value.isascii() and all(line.isprintable() for line in value.split("\n"))


@dataclass(frozen=True)
class RecordedBeat:
    board: str
    report: str

    def __post_init__(self) -> None:
        if not _plain_text(self.board) or not _plain_text(self.report):
            raise ValueError("a recorded board and report must contain printable ASCII")


def write_replay(path: Path, beats: Sequence[RecordedBeat]) -> None:
    """Replace the destination only once the complete recording is on disk."""
    if not beats:
        raise ValueError("replay needs at least one recorded beat")
    payload = {"format": FORMAT, "version": VERSION,
               "beats": [{"board": beat.board, "report": beat.report} for beat in beats]}
    temp = path.parent / f".pinchline-{uuid4().hex}.tmp"
    stream = temp.open("x", encoding="utf-8", newline="\n")
    try:
        with stream:
            json.dump(payload, stream, indent=2)
            stream.write("\n")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_replay(path: Path) -> list[RecordedBeat]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("replay contains invalid JSON") from error
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise ValueError("expected a Pinchline Six replay")
    version = data.get("version")
    if type(version) is not int or version != VERSION:
        raise ValueError("unsupported replay version")
    beats = data.get("beats")
    if not isinstance(beats, list) or not beats:
        raise ValueError("replay needs at least one recorded beat")
    result = []
    for index, beat in enumerate(beats):
        if not isinstance(beat, dict):
            raise ValueError(f"invalid board or report at beat {index}")
        try:
            result.append(RecordedBeat(beat["board"], beat["report"]))
        except (KeyError, ValueError) as error:
            raise ValueError(f"invalid board or report at beat {index}") from error
    return result
