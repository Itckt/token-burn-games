"""Read UTF-8 story and save files without discarding duplicate fields."""

import json
from pathlib import Path


def _unique_keys(pairs):
    record = {}
    for key, value in pairs:
        if key in record:
            raise ValueError(f"Duplicate JSON key {key!r}.")
        record[key] = value
    return record


def _invalid_number(token):
    raise ValueError(f"{token} is not a JSON number.")


def read_json(path: Path):
    with path.open(encoding="utf-8-sig") as source:
        try:
            return json.load(source, object_pairs_hook=_unique_keys, parse_constant=_invalid_number)
        except RecursionError as error:
            raise ValueError("The JSON is nested too deeply to read.") from error
