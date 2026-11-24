"""Small, explicitly arranged boards for testing timing and lane edges."""

from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from gutterlight.battle import Battle, Lane, Mode, Setup, Side, Unit
from gutterlight.cards import CARDS, DECK_SIZE, DECKS


ROOT = Path(__file__).resolve().parents[1]


def cli(*args):
    return subprocess.run(
        [sys.executable, "-B", "-m", "gutterlight", *map(str, args)],
        cwd=ROOT, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
    )


@contextmanager
def tape_folder():
    """Use a fresh project-local folder with the project's inherited permissions."""
    folder = ROOT / f".relay-test-{uuid4().hex}"
    folder.mkdir()
    try:
        yield folder
    finally:
        for file in folder.iterdir():
            file.unlink()
        folder.rmdir()


def arranged(*, amber=(), indigo=(), limit=180, mode=Mode.CLASSIC) -> Battle:
    def ordered(name, first):
        keys = tuple(first) + tuple(k for k in DECKS[name] if k not in first)
        return keys[:DECK_SIZE]

    opening = (ordered("awning", amber), ordered("trestle", indigo))
    return Battle(Setup(19, limit, opening, mode))


def place(battle: Battle, side: Side, lane: Lane, card: str, cell: int,
          *, hp: int | None = None, move_at: int = 1, attack_at: int = 1) -> Unit:
    unit = Unit(battle.next_uid, side, lane, card, cell,
                CARDS[card].troop.hp if hp is None else hp, move_at, attack_at)
    battle.next_uid += 1
    battle.units.append(unit)
    return unit


class TimedConsole:
    """A terminal with scheduled keys and a monotonic clock that never sleeps."""

    def __init__(self, inputs=(), draw_cost=0.0):
        self.time = 0.0
        self.inputs = list(inputs)
        self.draw_cost = draw_cost
        self.screens = []
        self.waits = []

    def now(self):
        return self.time

    def draw(self, screen):
        self.screens.append((self.time, screen))
        self.time += self.draw_cost

    def read_key(self, timeout):
        self.waits.append(timeout)
        if self.inputs:
            arrival, key = self.inputs[0]
            if timeout is None or arrival <= self.time + timeout:
                self.time = max(self.time, arrival)
                self.inputs.pop(0)
                return key
        if timeout is None:
            raise AssertionError("Paused viewer waited with no scheduled input")
        self.time += timeout
        return None
