"""Store accepted moves and replay them through the same rules on load."""

from __future__ import annotations

import json
import secrets
from pathlib import Path

from engine import Game, RuleError
from jsonio import read_json
from story import Story


# Moves from earlier official editions replay in later ones. Edited stories
# still require an exact fingerprint match.
SAMPLE_EDITIONS = (
    "f9d5d01be90cf27153ee3f4372324223c52b635c9acb956bb0d5ba64932a3cc1",
    "105b56f9e632e272fb167b669d71dec8f17c1206fec4706cb4f85f1dcfe2fd2e",
    "05385c87f81be39ed2068cc4f911806a6761016e87f2fe18a28be5c708ac0726",
)


class SaveError(ValueError):
    """A slot could not be written or restored."""


def _edition_matches(story: Story, fingerprint: object) -> bool:
    if fingerprint == story.fingerprint:
        return True
    if story.id != "eleventh-morning" or story.fingerprint not in SAMPLE_EDITIONS:
        return False
    current = SAMPLE_EDITIONS.index(story.fingerprint)
    return fingerprint in SAMPLE_EDITIONS[:current]


def save_game(game: Game, path: Path) -> None:
    data = {
        "version": 1,
        "story": game.story.id,
        "fingerprint": game.story.fingerprint,
        "events": game.events,
    }
    temporary = path.with_name(f".{secrets.token_hex(8)}.tmp")
    try:
        output = temporary.open("x", encoding="utf-8")
        try:
            with output:
                json.dump(data, output, indent=2)
                output.write("\n")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    except OSError as error:
        raise SaveError(f"Could not save {path.name}. {error}") from error


def load_game(story: Story, path: Path) -> Game:
    try:
        data = read_json(path)
    except FileNotFoundError as error:
        raise SaveError(f"No save exists at {path.name}.") from error
    except (OSError, ValueError) as error:
        raise SaveError(f"Could not read {path.name}. {error}") from error

    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
        raise SaveError("Unrecognized save format.")
    if data.get("story") != story.id or not _edition_matches(story, data.get("fingerprint")):
        raise SaveError("This save belongs to a different adventure or edition.")
    events = data.get("events")
    if not isinstance(events, list):
        raise SaveError("The save needs a list of moves.")

    game = Game(story)
    for index, event in enumerate(events, start=1):
        try:
            game.apply(event)
        except RuleError as error:
            raise SaveError(f"Invalid move {index} in the save. {error}") from error
    return game
