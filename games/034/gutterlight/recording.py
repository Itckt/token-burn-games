"""Portable replay tapes, validation, and seekable match history."""

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

from .battle import (
    Battle, Event, Frame, HAND_SIZE, IllegalMove, Lane, MAX_TICKS, Mode, Move, Setup, Side,
    clock_verdict,
)


FORMAT = "gutterlight-relay"
VERSION = 2
MAX_FILE_BYTES = 512 * 1024
Orders = tuple[Move | None, Move | None]


class ReplayError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Replay:
    frames: tuple[Frame, ...]
    events: tuple[Event, ...]
    setup: Setup
    orders: tuple[Orders, ...]  # orders[0] advances the opening to beat 1.

    @property
    def end(self) -> int:
        return len(self.frames) - 1

    def frame_at(self, tick: int) -> Frame:
        if type(tick) is not int or not 0 <= tick <= self.end:
            raise ValueError(f"Choose a recorded beat from 0 to {self.end}.")
        return self.frames[tick]

    def highlights(self) -> tuple[Event, ...]:
        if self.end == 0:
            return (Event(0, "Opening deal. End of recording."),)
        marks = [Event(0, "Opening deal.")]
        hit_towers = set()
        moved_carts = set()
        leader = None
        for previous, frame in zip(self.frames, self.frames[1:]):
            notes = []
            for side in Side:
                if frame.charge[side] and not previous.charge[side]:
                    notes.append(f"{side.label} banks its first charge.")
                for lane in Lane:
                    hp = frame.hull[side][lane]
                    if hp < previous.hull[side][lane] and (side, lane) not in hit_towers:
                        hit_towers.add((side, lane))
                        notes.append(f"First hit on {side.label} {lane.label} ({hp} hull).")
            if frame.mode is Mode.CONVOY:
                for lane in Lane:
                    if lane not in moved_carts and frame.carts[lane] != previous.carts[lane]:
                        moved_carts.add(lane)
                        notes.append(f"First push on {lane.label} (cell {frame.carts[lane]}).")
            standing = clock_verdict(frame.mode, frame.charge, map(sum, frame.hull), frame.carts).winner
            if standing != leader and frame.outcome is None:
                notes.append("Clock score level." if standing is None
                             else f"{standing.label} takes the clock lead.")
            leader = standing
            if frame.outcome:
                notes.append(frame.outcome.text)
            elif frame.tick == self.end:
                notes.append("End of recording. Match left in progress.")
            if notes:
                marks.append(Event(frame.tick, " ".join(notes)))
        return tuple(marks)


def _fingerprint(battle: Battle, version: int = VERSION) -> str:
    # Include hidden cooldowns and reserve order as well as the visible board.
    setup = asdict(battle.setup)
    if version == 1:
        del setup["mode"]
    state = (
        setup, battle.tick, battle.next_uid,
        [asdict(p) for p in battle.players],
        [[asdict(t) for t in pair] for pair in battle.towers],
        [asdict(u) for u in battle.units],
        [asdict(d) for d in battle.dispatches],
        asdict(battle.outcome) if battle.outcome else None,
    )
    if version >= 2:
        state += (battle.charge,)
    if battle.setup.mode is Mode.CONVOY:
        state += (battle.carts,)
    payload = json.dumps(state, sort_keys=True, separators=(",", ":")).encode("ascii")
    return hashlib.sha256(payload).hexdigest()


def document(battle: Battle) -> dict:
    return {
        "format": FORMAT,
        "version": VERSION,
        "mode": battle.setup.mode.value,
        "seed": battle.setup.seed,
        "limit_ticks": battle.setup.limit_ticks,
        "opening": [list(deck) for deck in battle.setup.opening],
        "end_tick": battle.tick,
        "plays": [
            {"tick": d.tick, "side": d.side.name.lower(), "slot": d.move.slot + 1,
             "lane": d.move.lane.name.lower()}
            for d in battle.dispatches
        ],
        "state_sha256": _fingerprint(battle),
    }


def save(battle: Battle, path: Path) -> None:
    tape = document(battle)
    temporary = path.parent / f".relay-{uuid4().hex}.tmp"
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(tape, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _integer(obj: dict, name: str, low: int, high: int) -> int:
    value = obj.get(name)
    if type(value) is not int or not low <= value <= high:
        raise ReplayError(f"{name} must be an integer from {low} to {high}.")
    return value


def _read_orders(plays: object, end: int) -> tuple[Orders, ...]:
    if not isinstance(plays, list) or len(plays) > 2 * end:
        raise ReplayError("Invalid play list for this recording length.")
    schedule: list[list[Move | None]] = [[None, None] for _ in range(end)]
    sides = {s.name.lower(): s for s in Side}
    lanes = {lane.name.lower(): lane for lane in Lane}
    last_tick = 0
    for play in plays:
        if not isinstance(play, dict):
            raise ReplayError("Each play must be an object.")
        tick = _integer(play, "tick", 1, end)
        if tick < last_tick:
            raise ReplayError("Plays must be in tick order.")
        last_tick = tick
        slot = _integer(play, "slot", 1, HAND_SIZE) - 1
        try:
            side = sides[play.get("side")]
            lane = lanes[play.get("lane")]
        except (KeyError, TypeError) as error:
            raise ReplayError("Unknown side or lane in play.") from error
        orders = schedule[tick - 1]
        if orders[side] is not None:
            raise ReplayError(f"Duplicate {side.label} play at tick {tick}.")
        orders[side] = Move(slot, lane)
    return tuple((amber, indigo) for amber, indigo in schedule)


def reconstruct(tape: object) -> Replay:
    if not isinstance(tape, dict) or tape.get("format") != FORMAT:
        raise ReplayError("Expected a Gutterlight Relay replay.")
    version = tape.get("version")
    if type(version) is not int or version not in (1, VERSION):
        raise ReplayError("Unsupported replay version.")
    seed = _integer(tape, "seed", 0, 2**32 - 1)
    limit = _integer(tape, "limit_ticks", 1, MAX_TICKS)
    end = _integer(tape, "end_tick", 0, limit)
    try:
        mode = Mode.CLASSIC if version == 1 else Mode(tape.get("mode"))
    except ValueError as error:
        raise ReplayError(f"Unknown replay mode. Choose {', '.join(m.value for m in Mode)}.") from error
    try:
        setup = Setup(seed, limit, tape.get("opening"), mode)
    except ValueError as error:
        raise ReplayError(str(error)) from error
    fingerprint = tape.get("state_sha256")
    if (not isinstance(fingerprint, str) or len(fingerprint) != 64
            or any(c not in "0123456789abcdef" for c in fingerprint)):
        raise ReplayError("Expected a SHA-256 state fingerprint.")

    schedule = _read_orders(tape.get("plays"), end)
    battle = Battle(setup)
    frames = [battle.frame()]
    for tick, orders in enumerate(schedule, start=1):
        try:
            battle.step(*orders)
        except IllegalMove as error:
            raise ReplayError(f"Invalid tick {tick}. {error}") from error
        frames.append(battle.frame())
    if _fingerprint(battle, version) != fingerprint:
        raise ReplayError("Replay state fingerprint mismatch.")
    return Replay(tuple(frames), tuple(battle.events), setup, schedule)


def load(path: Path) -> Replay:
    with path.open("rb") as stream:
        data = stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ReplayError("Replay exceeds the 512 KiB limit.")
    try:
        tape = json.loads(data.decode("utf-8"))
    except (ValueError, RecursionError) as error:
        raise ReplayError("Replay must contain valid UTF-8 JSON.") from error
    return reconstruct(tape)
