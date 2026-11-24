"""Bounded UTF-8 JSON files with same-directory atomic replacement."""

import json
import os
from pathlib import Path
from uuid import uuid4


def write_json(path: Path, record: dict, byte_limit: int) -> None:
    data = (json.dumps(record, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    if len(data) > byte_limit:
        raise ValueError("File is too large")
    temporary = path.parent / f".2048-{uuid4().hex}.tmp"
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path, byte_limit: int) -> object:
    with path.open("rb") as stream:
        data = stream.read(byte_limit + 1)
    if len(data) > byte_limit:
        raise ValueError("File is too large")
    try:
        return json.loads(data.decode("utf-8"))
    except (ValueError, RecursionError) as exc:
        raise ValueError("File is not valid UTF-8 JSON") from exc
