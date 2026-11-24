"""The dispatch catalog and the rules for building an eight-card deck."""

from collections.abc import Sequence
from dataclasses import dataclass


DECK_SIZE = 8


@dataclass(frozen=True, slots=True)
class Troop:
    mark: str
    hp: int
    hit: int
    reach: int
    walk_ticks: int
    attack_ticks: int
    count: int = 1
    splash: bool = False
    tower_bonus: int = 0
    armor: int = 0
    mend: int = 0


@dataclass(frozen=True, slots=True)
class Card:
    key: str
    name: str
    cost: int
    description: str
    troop: Troop | None = None
    burst: int = 0
    repair: int = 0


_CATALOG = (
    Card("wick", "Wick Runner", 2, "A courier who covers a cell every beat.",
         Troop("W", 24, 7, 1, 1, 2)),
    Card("clip", "Clip Crew", 3, "Three small scrappers share one dispatch.",
         Troop("C", 14, 4, 1, 2, 2, count=3)),
    Card("ink", "Ink Glider", 3, "A paper-wing spotter with three cells of reach.",
         Troop("I", 26, 6, 3, 2, 2)),
    Card("drum", "Drum Roller", 4, "A resonator hits every enemy on its target's cell.",
         Troop("D", 48, 9, 2, 3, 3, splash=True)),
    Card("ballast", "Ballast Mule", 5, "A slow cargo hauler with a 92-point hull.",
         Troop("B", 92, 12, 1, 3, 3)),
    Card("rivet", "Rivet Ram", 4, "A pile driver deals 14 extra damage to towers.",
         Troop("R", 50, 7, 1, 2, 3, tower_bonus=14)),
    Card("foil", "Foil Fencer", 2, "A folded-metal duelist strikes every beat.",
         Troop("F", 27, 5, 1, 2, 1)),
    Card("loom", "Loom Tender", 4, "A steady backliner casts heavy wire from three cells.",
         Troop("L", 43, 11, 3, 3, 3)),
    Card("bobbin", "Bobbin Pair", 3, "Two wire-spinners each strike from two cells away.",
         Troop("P", 17, 4, 2, 2, 2, count=2)),
    Card("kiln", "Kiln Kite", 5, "A fragile clay-wing crew fires from four cells, beyond tower range.",
         Troop("K", 24, 8, 4, 3, 3)),
    Card("squall", "Squall Lens", 3, "Deal 16 to the enemy front and foes within one cell of it.",
         burst=16),
    Card("patch", "Patch Reel", 2, "Restore up to 24 hull to your tower in the chosen lane.",
         repair=24),
    Card("shale", "Shale Porter", 4, "Armor takes 3 off each crew or tower hit, down to 1.",
         Troop("S", 52, 6, 1, 3, 2, armor=3)),
    Card("hem", "Hem Weaver", 3, "Mends 8 hull on a wounded ally within two cells before attacking.",
         Troop("H", 28, 4, 2, 2, 2, mend=8)),
    Card("awl", "Twin Awls", 3, "Two riggers each deal 5 extra damage on a tower strike.",
         Troop("A", 18, 4, 1, 2, 2, count=2, tower_bonus=5)),
    Card("chit", "Chit Skater", 1, "A one-energy canteen runner covers a cell every beat.",
         Troop("T", 11, 3, 1, 1, 3)),
)

CARDS = {card.key: card for card in _CATALOG}
DECKS = {
    "awning": ("wick", "clip", "ink", "drum", "ballast", "rivet", "squall", "patch"),
    "trestle": ("wick", "clip", "ink", "foil", "loom", "rivet", "squall", "patch"),
    "viaduct": ("wick", "bobbin", "ink", "kiln", "foil", "clip", "squall", "patch"),
}


def checked_deck(keys: Sequence[str]) -> tuple[str, ...]:
    if not isinstance(keys, Sequence) or isinstance(keys, str) or len(keys) != DECK_SIZE:
        raise ValueError("A deck needs exactly eight card keys.")
    seen = set()
    for key in keys:
        if not isinstance(key, str) or key not in CARDS:
            raise ValueError(f"Unknown card {key!r}. See 'gutterlight cards' for the keys.")
        if key in seen:
            raise ValueError(f"Repeated card {key!r}. Choose eight distinct cards.")
        seen.add(key)
    return tuple(keys)


def resolve_deck(spec: str | Sequence[str]) -> tuple[str, ...]:
    if isinstance(spec, str):
        name = spec.strip().lower()
        if name in DECKS:
            return DECKS[name]
        if "," not in name:
            raise ValueError(f"Unknown deck {spec!r}. Choose {', '.join(DECKS)} "
                             "or give eight comma-separated card keys.")
        return checked_deck([key.strip() for key in name.split(",")])
    return checked_deck(spec)
