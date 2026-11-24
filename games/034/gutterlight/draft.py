"""Two complementary decks from eight seeded pairs."""

import random

from .battle import check_seed
from .cards import CARDS, DECK_SIZE, checked_deck


# Each seat gets two light crews, two backliners, two heavy crews, a siege
# crew and a tower or field order. Every card is offered exactly once.
_GROUPS = (
    ("chit", "wick", "foil", "clip"),
    ("ink", "bobbin", "loom", "hem"),
    ("shale", "ballast", "drum", "kiln"),
    ("rivet", "awl"),
    ("squall", "patch"),
)
Offers = tuple[tuple[str, str], ...]


def draft_offers(seed: int) -> Offers:
    check_seed(seed)
    rng = random.Random(seed ^ 3593)
    pairs = []
    for group in _GROUPS:
        cards = list(group)
        rng.shuffle(cards)
        pairs.extend(zip(cards[::2], cards[1::2]))
    rng.shuffle(pairs)
    return tuple(pairs)


def split_pair(pair: tuple[str, str], pick: str) -> tuple[str, str]:
    """Return the cards in seat order for a validated pick."""
    return pair if pick == "1" else (pair[1], pair[0])


def draft_decks(offers: Offers, picks: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if not isinstance(picks, str) or len(picks) != DECK_SIZE or any(p not in "12" for p in picks):
        raise ValueError("A draft needs eight picks. Use 1 or 2 for each pair, e.g. 12121212.")
    amber, indigo = [], []
    for pair, pick in zip(offers, picks, strict=True):
        take, give = split_pair(pair, pick)
        amber.append(take)
        indigo.append(give)
    return checked_deck(amber), checked_deck(indigo)


def draft_sheet(seed: int, offers: Offers) -> str:
    lines = [f"GUTTERLIGHT RELAY  /  PAIR DRAFT     Seed {seed}",
             "Amber keeps your pick from each pair. The other card goes to Indigo.",
             "", "PAIR   [1] CARD (ENERGY)         [2] CARD (ENERGY)"]
    for number, pair in enumerate(offers, 1):
        left, right = (f"{CARDS[k].name} ({CARDS[k].cost})" for k in pair)
        lines.append(f"{number:>4}   {left:<25} {right}")
    lines.extend(["", f"Use --seed {seed} --draft PICKS with play or simulate.",
                  "For example, 12121212 takes the left card of pair 1 and the right of pair 2."])
    return "\n".join(lines)


def draft_receipt(seed: int, picks: str, decks: tuple[tuple[str, ...], tuple[str, ...]]) -> str:
    amber, indigo = decks
    return (f"Draft seed {seed}    Picks {picks}\n"
            f"Amber deck   {','.join(amber)}\nIndigo deck  {','.join(indigo)}")
