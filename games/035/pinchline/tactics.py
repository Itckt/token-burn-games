"""Crew targeting orders and single-use sideline cards."""

from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .arena import Court
from .fighters import Fighter
from .roster import CHARGE_CAP

INK_CAP = 3
PATCH_HP = 6
PRIME_CHARGE = 2
SCREEN_WARD = 4
DEFAULT_ORDER = "weakest"
ORDERS = (DEFAULT_ORDER, "nearest", "charged")


def ranked_foes(actor: Fighter, initiative: Sequence[Fighter], court: Court,
                order: str, carrier: Fighter | None) -> list[Fighter]:
    """Rank from the common planning snapshot. Initiative settles exact ties."""
    def priority(foe: Fighter) -> tuple[int, ...]:
        distance = court.lane_distance(actor.pos, foe.pos)
        if order == "nearest":
            return foe is not carrier, distance, foe.hp
        if order == "charged":
            return foe is not carrier, -foe.charge, foe.hp, distance
        return foe is not carrier, foe.hp, distance

    return sorted((f for f in initiative if f.team != actor.team), key=priority)


def _patch(crew: Sequence[Fighter]) -> str | None:
    target = max(crew, key=lambda f: f.hero.hp - f.hp)
    amount = min(PATCH_HP, target.hero.hp - target.hp)
    if amount == 0:
        return None
    target.hp += amount
    return f"{target.token} (+{amount} HP)"


def _prime(crew: Sequence[Fighter]) -> str | None:
    target = max((f for f in crew if f.charge < CHARGE_CAP),
                 key=lambda f: f.charge, default=None)
    if target is None:
        return None
    amount = min(PRIME_CHARGE, CHARGE_CAP - target.charge)
    target.charge += amount
    return f"{target.token} (+{amount} charge)"


def _screen(crew: Sequence[Fighter]) -> str | None:
    target = min((f for f in crew if f.ward < SCREEN_WARD),
                 key=lambda f: f.hp, default=None)
    if target is None:
        return None
    target.ward = SCREEN_WARD
    return f"{target.token} (ward {SCREEN_WARD})"


@dataclass(frozen=True)
class Card:
    cost: int
    description: str
    play: Callable[[Sequence[Fighter]], str | None]


CARDS = {
    "patch": Card(3, f"Heal up to {PATCH_HP} HP on the ally missing the most HP.", _patch),
    "prime": Card(2, f"Add up to {PRIME_CHARGE} charge to the most charged ally with room.", _prime),
    "screen": Card(2, f"Set ward to {SCREEN_WARD} on the lowest-HP ally with less ward.", _screen),
}


class Deck:
    def __init__(self, names: Sequence[str]):
        keys = [name.lower() for name in names]
        if len(keys) > 3 or len(keys) != len(set(keys)):
            raise ValueError("a deck takes up to three different cards")
        for key in keys:
            if key not in CARDS:
                raise ValueError(f"unknown sideline card '{key}'. Use --cards to see the deck list")
        self.remaining = deque(keys)
        self.ink = 0

    def advance(self, crew: Sequence[Fighter]) -> str | None:
        """Give the front card a beat. Crew order breaks ties in draft order."""
        if not self.remaining:
            return None
        self.ink = min(INK_CAP, self.ink + 1)
        name = self.remaining[0]
        card = CARDS[name]
        living = [f for f in crew if f.alive]
        if self.ink < card.cost or not living:
            return None
        effect = card.play(living)
        if effect is None:
            return None
        self.remaining.popleft()
        self.ink -= card.cost
        return f"plays {name} -> {effect}"
