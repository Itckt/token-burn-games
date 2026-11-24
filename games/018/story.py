"""Load and validate the rooms, actions and endings of an adventure."""

from __future__ import annotations

import hashlib
import json
import re
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

from jsonio import read_json


ItemCounts = tuple[tuple[str, int], ...]


class StoryError(ValueError):
    """The supplied adventure cannot be played."""


@dataclass(frozen=True)
class Window:
    first: int
    last: int

    def latest_start(self, days: int) -> int:
        return self.last - days + 1


@dataclass(frozen=True)
class Action:
    """Work uses days. A batch uses nights while the player does other work."""

    id: str
    name: str
    days: int
    cost: int
    requires: tuple[str, ...]
    unless: tuple[str, ...]
    gives: tuple[str, ...]
    result: str
    consumes: ItemCounts = ()
    produces: ItemCounts = ()
    window: Window | None = None
    nights: int = 0


@dataclass(frozen=True, kw_only=True)
class Puzzle(Action):
    prompt: str
    pieces: dict[str, str]
    solution: tuple[str, ...]
    clues: dict[str, str]


@dataclass(frozen=True)
class Shift:
    room: str
    days: Window


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    greeting: str
    topics: dict[str, Action]
    home: str
    shifts: tuple[Shift, ...] = ()

    def room_on(self, day: int) -> str:
        for shift in self.shifts:
            if shift.days.first <= day <= shift.days.last:
                return shift.room
        return self.home


@dataclass(frozen=True)
class Room:
    id: str
    name: str
    description: str
    details: dict[str, str]
    exits: tuple[str, ...]
    actions: dict[str, Action]
    people: dict[str, Person] = field(default_factory=dict)
    exit_requires: dict[str, tuple[str, ...]] = field(default_factory=dict)
    batches: dict[str, Action] = field(default_factory=dict)
    puzzles: dict[str, Puzzle] = field(default_factory=dict)


@dataclass(frozen=True)
class Ending:
    id: str
    title: str
    requires: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class Letter:
    sender: str
    text: str
    requires: tuple[str, ...]
    unless: tuple[str, ...]


@dataclass(frozen=True)
class Story:
    id: str
    title: str
    intro: str
    resource: str
    budget: int
    days: int
    start: str
    flags: dict[str, str]
    notices: dict[int, str]
    rooms: dict[str, Room]
    endings: tuple[Ending, ...]
    fingerprint: str
    items: dict[str, str] = field(default_factory=dict)
    starting_items: dict[str, int] = field(default_factory=dict)
    letters: tuple[Letter, ...] = ()

    @cached_property
    def people(self) -> dict[str, Person]:
        return {key: person for room in self.rooms.values() for key, person in room.people.items()}


def _object(value, where):
    if not isinstance(value, dict):
        raise StoryError(f"{where} must be a JSON object.")
    return value


def _text(value, where):
    if not isinstance(value, str) or not value.strip():
        raise StoryError(f"{where} must be nonempty text.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise StoryError(f"{where} contains an unpaired Unicode surrogate.") from error
    return value


def _id(value, where):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", value):
        raise StoryError(f"{where} needs a lowercase ID such as 'print-room'.")
    return value


def _integer(value, where, minimum):
    if type(value) is not int or value < minimum:
        raise StoryError(f"{where} must be an integer of at least {minimum}.")
    return value


def _references(value, known, where):
    if not isinstance(value, list):
        raise StoryError(f"{where} must be a list of IDs.")
    for key in value:
        if not isinstance(key, str) or key not in known:
            raise StoryError(f"{where} references an unknown ID {key!r}.")
    if len(value) != len(set(value)):
        raise StoryError(f"{where} contains a repeated ID.")
    return tuple(value)


def _labels(raw, where):
    return {
        _id(key, f"{where} key"): _text(label, f"{where}.{key}")
        for key, label in _object(raw, where).items()
    }


def _quantities(raw, items, where):
    quantities = _object(raw, where)
    _references(list(quantities), items, where)
    return {key: _integer(count, f"{where}.{key}", 1) for key, count in quantities.items()}


def _flag_text(raw, flags, where):
    lines = _object(raw, where)
    _references(list(lines), flags, where)
    return {key: _text(line, f"{where}.{key}") for key, line in lines.items()}


def _conditions(record, flags, path):
    requires = _references(record.get("requires", []), flags, f"{path}.requires")
    unless = _references(record.get("unless", []), flags, f"{path}.unless")
    if set(requires).intersection(unless):
        raise StoryError(f"{path} both needs and excludes the same flag.")
    return requires, unless


def _read_window(raw, deadline, where):
    if not isinstance(raw, list) or len(raw) != 2:
        raise StoryError(f"{where} must be a pair of day numbers.")
    first, last = (_integer(day, where, 1) for day in raw)
    if not first <= last <= deadline:
        raise StoryError(f"{where} must be in order and within days 1-{deadline}.")
    return Window(first, last)


def _timing(record, kind, deadline, path):
    if kind == "topic":
        if {"days", "nights", "cost", "window"}.intersection(record):
            raise StoryError(f"{path} is a conversation topic. Omit days, nights, cost and window.")
        return 0, 0, None
    if kind == "batch":
        if {"days", "window"}.intersection(record):
            raise StoryError(f"{path} is a batch. Use nights for its running time and omit days and window.")
        nights = _integer(record.get("nights"), f"{path}.nights", 1)
        if nights > deadline:
            raise StoryError(f"{path}.nights exceeds the adventure's {deadline}-day deadline.")
        return 0, nights, None
    if "nights" in record:
        raise StoryError(f"{path}.nights belongs on a batch. Use days for daytime work.")
    days = _integer(record.get("days", 1), f"{path}.days", 1)
    if days > deadline:
        raise StoryError(f"{path}.days exceeds the adventure's {deadline}-day deadline.")
    window = _read_window(record["window"], deadline, f"{path}.window") if "window" in record else None
    if window and window.latest_start(days) < window.first:
        raise StoryError(f"{path}.window is too short for {days} days of work.")
    return days, 0, window


def _read_puzzle(record, fields, flags, path):
    pieces = _labels(record.get("pieces"), f"{path}.pieces")
    if len(pieces) < 2:
        raise StoryError(f"{path}.pieces needs at least two different pieces.")
    solution = _references(record.get("solution"), pieces, f"{path}.solution")
    if len(solution) != len(pieces):
        raise StoryError(f"{path}.solution must use every piece exactly once.")
    return Puzzle(
        **fields, prompt=_text(record.get("prompt"), f"{path}.prompt"), pieces=pieces,
        solution=solution, clues=_flag_text(record.get("clues", {}), flags, f"{path}.clues"),
    )


def _read_choices(raw, flags, items, deadline, where, *, kind="work"):
    choices = {}
    for key, record in _object(raw, where).items():
        _id(key, f"{where} key")
        path = f"{where}.{key}"
        record = _object(record, path)
        days, nights, window = _timing(record, kind, deadline, path)
        requires, unless = _conditions(record, flags, path)
        consumes = _quantities(record.get("consumes", {}), items, f"{path}.consumes")
        produces = _quantities(record.get("produces", {}), items, f"{path}.produces")
        fields = dict(
            id=key, name=_text(record.get("name"), f"{path}.name"),
            days=days, cost=_integer(record.get("cost", 0), f"{path}.cost", 0),
            requires=requires, unless=unless,
            gives=_references(record.get("gives", []), flags, f"{path}.gives"),
            result=_text(record.get("result"), f"{path}.result"),
            consumes=tuple(consumes.items()), produces=tuple(produces.items()), window=window, nights=nights,
        )
        choices[key] = _read_puzzle(record, fields, flags, path) if kind == "puzzle" else Action(**fields)
    return choices


def _read_shifts(raw, rooms, deadline, where):
    if not isinstance(raw, list):
        raise StoryError(f"{where} must be a list of shifts.")
    shifts = []
    for index, record in enumerate(raw, 1):
        path = f"{where}[{index}]"
        record = _object(record, path)
        room = _id(record.get("room"), f"{path}.room")
        if room not in rooms:
            raise StoryError(f"{path}.room references an unknown room {room!r}.")
        shifts.append(Shift(room, _read_window(record.get("days"), deadline, f"{path}.days")))
    shifts.sort(key=lambda shift: shift.days.first)
    for previous, following in zip(shifts, shifts[1:]):
        if following.days.first <= previous.days.last:
            raise StoryError(f"{where} contains overlapping shifts on day {following.days.first}.")
    return tuple(shifts)


def _read_people(raw, flags, items, deadline, home, rooms):
    where = f"{home}.people"
    people = {}
    for key, record in _object(raw, where).items():
        _id(key, f"{where} key")
        path = f"{where}.{key}"
        record = _object(record, path)
        topics = _read_choices(record.get("topics"), flags, items, deadline, f"{path}.topics", kind="topic")
        if not topics:
            raise StoryError(f"{path} needs at least one conversation topic.")
        people[key] = Person(
            key, _text(record.get("name"), f"{path}.name"),
            _text(record.get("greeting"), f"{path}.greeting"), topics, home,
            _read_shifts(record.get("shifts", []), rooms, deadline, f"{path}.shifts"),
        )
    return people


def _read_rooms(raw, flags, items, deadline):
    rooms = {}
    used = {"Action": set(), "Person": set(), "Batch": set(), "Puzzle": set()}
    for room_id, record in raw.items():
        _id(room_id, "Room key")
        room = _object(record, room_id)
        exits = _references(room.get("exits", []), raw, f"{room_id}.exits")
        gates = _object(room.get("exit_requires", {}), f"{room_id}.exit_requires")
        _references(list(gates), exits, f"{room_id}.exit_requires")
        exit_requires = {
            key: _references(required, flags, f"{room_id}.exit_requires.{key}")
            for key, required in gates.items()
        }
        details = _flag_text(room.get("details", {}), flags, f"{room_id}.details")
        actions = _read_choices(room.get("actions", {}), flags, items, deadline, f"{room_id}.actions")
        people = _read_people(room.get("people", {}), flags, items, deadline, room_id, raw)
        batches = _read_choices(room.get("batches", {}), flags, items, deadline, f"{room_id}.batches", kind="batch")
        puzzles = _read_choices(room.get("puzzles", {}), flags, items, deadline, f"{room_id}.puzzles", kind="puzzle")
        for label, records in (("Action", actions), ("Person", people), ("Batch", batches), ("Puzzle", puzzles)):
            duplicate = used[label].intersection(records)
            if duplicate:
                raise StoryError(f"{label} ID {min(duplicate)!r} is used in more than one room.")
            used[label].update(records)
        rooms[room_id] = Room(
            id=room_id, name=_text(room.get("name"), f"{room_id}.name"),
            description=_text(room.get("description"), f"{room_id}.description"),
            details=details, exits=exits, actions=actions, people=people, exit_requires=exit_requires,
            batches=batches, puzzles=puzzles,
        )
    return rooms


def _read_endings(raw, flags):
    if not isinstance(raw, list) or not raw:
        raise StoryError("The story needs at least one ending.")
    endings = []
    ids = set()
    for index, item in enumerate(raw):
        item = _object(item, f"Ending {index + 1}")
        key = _id(item.get("id"), "Ending ID")
        if key in ids:
            raise StoryError(f"Ending ID {key!r} is repeated.")
        ids.add(key)
        requires = _references(item.get("requires", []), flags, f"{key}.requires")
        if not requires and index != len(raw) - 1:
            raise StoryError("Only the last ending can be unconditional.")
        endings.append(Ending(
            key, _text(item.get("title"), f"{key}.title"), requires,
            _text(item.get("text"), f"{key}.text"),
        ))
    if endings[-1].requires:
        raise StoryError("The last ending must be unconditional.")
    return tuple(endings)


def _read_letters(raw, flags):
    if not isinstance(raw, list):
        raise StoryError("letters must be a list.")
    letters = []
    for index, record in enumerate(raw, 1):
        path = f"letters[{index}]"
        record = _object(record, path)
        requires, unless = _conditions(record, flags, path)
        letters.append(Letter(_text(record.get("sender"), f"{path}.sender"),
                              _text(record.get("text"), f"{path}.text"), requires, unless))
    return tuple(letters)


def paths_from(rooms: dict[str, Room], start: str,
               allowed: Callable[[Room, str], bool] | None = None) -> dict[str, str | None]:
    """Map each reachable room to its predecessor along a shortest directed path."""
    previous: dict[str, str | None] = {start: None}
    queue = deque([start])
    while queue:
        here = queue.popleft()
        for neighbour in rooms[here].exits:
            if neighbour not in previous and (allowed is None or allowed(rooms[here], neighbour)):
                previous[neighbour] = here
                queue.append(neighbour)
    return previous


def parse_story(data: dict) -> Story:
    """Build a story from the same JSON-compatible structure used on disk."""
    data = _object(data, "Story")
    story_id = _id(data.get("id"), "Story ID")
    days = _integer(data.get("days"), "days", 1)
    flags = _labels(data.get("flags", {}), "flags")
    items = _labels(data.get("items", {}), "items")
    starting_items = _quantities(data.get("starting_items", {}), items, "starting_items")
    rooms = _read_rooms(_object(data.get("rooms"), "rooms"), flags, items, days)
    start = _id(data.get("start"), "start")
    if start not in rooms:
        raise StoryError(f"The starting room {start!r} does not exist.")
    reachable = paths_from(rooms, start)
    if len(reachable) != len(rooms):
        missing = ", ".join(sorted(rooms.keys() - reachable))
        raise StoryError(f"No path from {start!r} reaches {missing}.")

    notices = {}
    for key, message in _object(data.get("notices", {}), "notices").items():
        if not isinstance(key, str) or not re.fullmatch(r"[1-9][0-9]*", key):
            raise StoryError(f"Notice day {key!r} must be a positive day number.")
        if len(key) > len(str(days)) or int(key) > days:
            raise StoryError(f"Notice day {key!r} is past the deadline.")
        notices[int(key)] = _text(message, f"notices.{key}")

    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return Story(
        id=story_id, title=_text(data.get("title"), "title"), intro=_text(data.get("intro"), "intro"),
        resource=_text(data.get("resource"), "resource"), budget=_integer(data.get("budget"), "budget", 0),
        days=days, start=start, flags=flags, notices=notices, rooms=rooms,
        endings=_read_endings(data.get("endings"), flags), items=items, starting_items=starting_items,
        letters=_read_letters(data.get("letters", []), flags),
        fingerprint=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def load_story(path: Path) -> Story:
    try:
        return parse_story(read_json(path))
    except (OSError, ValueError, RecursionError) as error:
        raise StoryError(f"Could not read {path.name}. {error}") from error
