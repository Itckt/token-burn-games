"""The six live fighters, their beat commitments, and the opening deal."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from random import Random
from typing import Literal

from .arena import Position
from .roster import ROSTER, START_CHARGE, Hero


@dataclass
class FighterStats:
    pulses: int = 0
    arts: int = 0
    power_sent: int = 0
    healing: int = 0
    blocked: int = 0
    fringe_beats: int = 0
    scoring_beats: int = 0
    carry_beats: int = 0
    pushes: int = 0


@dataclass
class Fighter:
    token: str
    team: str
    hero: Hero
    pos: Position
    hp: int
    charge: int = START_CHARGE
    ward: int = 0
    stats: FighterStats = field(default_factory=FighterStats)

    @property
    def alive(self) -> bool:
        return self.hp > 0


@dataclass(frozen=True)
class Intent:
    actor: Fighter
    kind: Literal["hold", "step", "pulse", "art"]
    targets: tuple[Fighter, ...] = ()
    destination: Position | None = None


def tags(fighters: Sequence[Fighter]) -> str:
    return ", ".join(fighter.token for fighter in fighters)


def deal_team(
    team: str, draft: Sequence[str], tokens: str, marks: tuple[Position, ...], rng: Random
) -> list[Fighter]:
    keys = [name.lower() for name in draft]
    if len(keys) != 3 or len(set(keys)) != 3:
        raise ValueError(f"{team} needs three different heroes")
    for key in keys:
        if key not in ROSTER:
            raise ValueError(f"unknown hero '{key}' for {team}. Use --roster to see the cards")
    pads = list(marks)
    rng.shuffle(pads)
    return [
        Fighter(token, team, ROSTER[key], pos, ROSTER[key].hp)
        for token, pos, key in zip(tokens, pads, keys)
    ]
