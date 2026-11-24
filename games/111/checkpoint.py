"""Local handover between waves. The next launch reloads every tower and signal."""

from collections.abc import Iterator
from contextlib import ExitStack
from dataclasses import asdict
import json
import os
from pathlib import Path
from uuid import uuid4

from spillway import (
    CHARGE_MAX, DESIGNS, FINAL_WAVE, GATE_MAX, Game, PadReport, Phase, RuleError,
    Tower, check_aim, check_design, check_pad,
)


VERSION = 1
MAX_BYTES = 64 * 1024  # Eight installed towers and eight report rows fit in a few KB.


def save_watch(game: Game, path: Path) -> None:
    if game.phase not in (Phase.BUILD, Phase.WON):
        raise RuleError("Save in the workshop or at dawn, between waves.")
    data = {
        "version": VERSION, "wave": game.cleared, "overtime": game.overtime,
        "gate": game.gate, "brass": game.brass, "charge": game.charge,
        "kills": game.kills, "crowns": game.crowns,
        "towers": {pad: {"kind": t.kind, "level": t.level, "aim": t.aim}
                   for pad, t in game.towers.items()},
        "deck": list(game.deck), "sluice": game.sluice,
        "last_wave": {
            "rush": game.rush, "beat": game.beat, "leaked": game.leaked,
            "pulse_kills": game.pulse_kills, "vented": game.vented,
            "pads": {pad: asdict(row) for pad, row in game.pad_reports.items()},
        },
    }
    staged = path.with_name(f".weir-{uuid4().hex}.tmp")
    try:
        with ExitStack() as cleanup:
            with staged.open("x", encoding="utf-8") as file:
                cleanup.callback(staged.unlink, missing_ok=True)
                json.dump(data, file, indent=2, sort_keys=True)
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())
            staged.replace(path)
    except OSError as err:
        raise RuleError(f"Could not write the checkpoint in {path.parent.name}.") from err


def _integer(data: dict, key: str, minimum: int = 0, maximum: int | None = None) -> int:
    value = data[key]
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise ValueError(key)
    return value


def _flag(data: dict, key: str) -> bool:
    value = data[key]
    if type(value) is not bool:
        raise ValueError(key)
    return value


def _pads(rows: dict) -> Iterator[tuple[str, str, int, str, dict]]:
    if not isinstance(rows, dict):
        raise ValueError("pads")
    for pad, data in rows.items():
        check_pad(pad)
        kind, aim = data["kind"], data["aim"]
        check_design(kind)
        check_aim(kind, aim)
        level = _integer(data, "level", 1, len(DESIGNS[kind].tiers))
        yield pad, kind, level, aim, data


def _restore(data: dict) -> Game:
    if _integer(data, "version") != VERSION:
        raise ValueError("version")
    wave = _integer(data, "wave")
    overtime = _flag(data, "overtime")
    if (wave < FINAL_WAVE and overtime) or (wave > FINAL_WAVE and not overtime):
        raise ValueError("overtime")
    last = data["last_wave"]
    kills = _integer(data, "kills")
    game = Game(wave=wave, cleared=wave, overtime=overtime, gate=_integer(data, "gate", 1, GATE_MAX),
                brass=_integer(data, "brass"), charge=_integer(data, "charge", 0, CHARGE_MAX),
                kills=kills, crowns=_integer(data, "crowns", 0, min(kills, wave // 10)),
                rush=_flag(last, "rush"), beat=_integer(last, "beat"), leaked=_integer(last, "leaked"),
                pulse_kills=_integer(last, "pulse_kills", 0, kills), vented=_integer(last, "vented"))
    deck = data["deck"]
    if not isinstance(deck, list) or len(deck) != 2:
        raise ValueError("deck")
    game.set_deck(*deck)
    game.set_sluice(data["sluice"])
    for pad, kind, level, aim, _ in _pads(data["towers"]):
        game.towers[pad] = Tower(kind, level, aim=aim)
    for pad, kind, level, aim, entry in _pads(last["pads"]):
        shots = _integer(entry, "shots")
        hits = _integer(entry, "hits", shots)
        if hits and not shots:
            raise ValueError("hits without a shot")
        game.pad_reports[pad] = PadReport(kind, level, aim, shots, hits, _integer(entry, "kills", 0, hits))
    if game.pulse_kills + sum(row.kills for row in game.pad_reports.values()) > game.kills:
        raise ValueError("wave kills exceed watch kills")
    if wave == FINAL_WAVE and not overtime:
        game.phase = Phase.WON
    game.notice = f"Watch resumed. Waves held {wave}."
    return game


def load_watch(path: Path) -> Game:
    try:
        with path.open("rb") as file:
            raw = file.read(MAX_BYTES + 1)
    except FileNotFoundError as err:
        raise RuleError("No checkpoint yet. Type 'save' in the workshop to make one.") from err
    except OSError as err:
        raise RuleError("Could not read the watch checkpoint.") from err
    try:
        if len(raw) > MAX_BYTES:
            raise ValueError("size")
        return _restore(json.loads(raw.decode("utf-8")))
    except (ValueError, KeyError, TypeError, RecursionError) as err:
        raise RuleError("Invalid or unsupported watch checkpoint.") from err
