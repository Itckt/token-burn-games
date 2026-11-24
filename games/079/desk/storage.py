"""Local saves store the seed and successful moves in the order they happened."""

from contextlib import suppress
import json
import os
from pathlib import Path
from uuid import uuid4

from .game import Game


SAVE_VERSION = 1
MAX_SAVE_BYTES = 65_536


class SaveError(Exception):
    pass


def save_game(game: Game, path: Path) -> None:
    payload = {"version": SAVE_VERSION, "seed": game.seed, "moves": game.moves}
    temp_path = path.with_name(f".friday-filed-{uuid4().hex}.tmp")
    created = False
    try:
        with temp_path.open("x", encoding="utf-8") as out:
            created = True
            json.dump(payload, out, indent=2)
            out.write("\n")
        os.replace(temp_path, path)
        created = False
    except OSError as exc:
        raise SaveError(f"Could not write {path.name}. Check the game folder's access and free space.") from exc
    finally:
        if created:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)


def load_game(path: Path) -> Game:
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_SAVE_BYTES + 1)
        if len(raw) > MAX_SAVE_BYTES:
            raise ValueError("file too large")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict) or type(data.get("version")) is not int:
            raise ValueError("missing version")
        if data["version"] != SAVE_VERSION:
            raise SaveError(f"Save version {data['version']} is unsupported by this edition.")
        moves = data.get("moves")
        if not isinstance(moves, list) or len(moves) > 128:
            raise ValueError("invalid move list")
        game = Game(data.get("seed"))
        for index, move in enumerate(moves, start=1):
            if not isinstance(move, str) or len(move) > 64:
                raise ValueError("invalid move")
            game.act(move)
            if len(game.moves) != index:
                raise ValueError("move did not change the desk")
        return game
    except FileNotFoundError as exc:
        raise SaveError(f"No saved week at {path.name}. Start a week and type save.") from exc
    except OSError as exc:
        raise SaveError(f"Could not read {path.name}. Check that the save slot is a readable file.") from exc
    except (ValueError, RecursionError) as exc:
        raise SaveError(f"The saved week in {path.name} is damaged or contains an invalid move.") from exc
