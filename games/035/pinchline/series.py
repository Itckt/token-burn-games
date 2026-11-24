"""Seeded home-and-away fixtures. Decks and orders travel with their drafts."""

from collections.abc import Iterator
from dataclasses import dataclass

from .battle import BEAT_LIMIT, Battle
from .roster import COPPER, COPPER_DRAFT, INDIGO, INDIGO_DRAFT
from .tactics import DEFAULT_ORDER


@dataclass(frozen=True)
class Lineup:
    heroes: tuple[str, ...]
    deck: tuple[str, ...] = ()
    order: str = DEFAULT_ORDER


@dataclass(frozen=True)
class Leg:
    pair: int
    number: int
    battle: Battle

    def draft_on(self, side: str) -> str:
        if self.number == 1:
            return side
        return INDIGO if side == COPPER else COPPER


@dataclass(frozen=True)
class Matchup:
    copper: Lineup = Lineup(COPPER_DRAFT)
    indigo: Lineup = Lineup(INDIGO_DRAFT)
    limit: int = BEAT_LIMIT
    court: str = "loop"
    mode: str = "knockout"

    def deal(self, seed: int, *, swapped: bool = False) -> Battle:
        west, east = (self.indigo, self.copper) if swapped else (self.copper, self.indigo)
        return Battle(seed, west.heroes, east.heroes, self.limit, court=self.court, mode=self.mode,
                      copper_deck=west.deck, indigo_deck=east.deck,
                      copper_order=west.order, indigo_order=east.order)

    def pairs(self, seed: int, count: int) -> Iterator[Leg]:
        if count < 1:
            raise ValueError("the pair count must be positive")
        for index in range(count):
            for number in (1, 2):
                yield Leg(index + 1, number, self.deal(seed + index, swapped=number == 2))
