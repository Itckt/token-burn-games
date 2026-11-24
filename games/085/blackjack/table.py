"""Cards, decisions and table rules shared by the engine and its strategies."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import Enum
from typing import NamedTuple


ACE = 1
Cards = tuple[int, ...]


class HandValue(NamedTuple):
    total: int
    soft: bool


def score(cards: Sequence[int]) -> HandValue:
    """Count one ace as eleven if doing so keeps the total at or below 21."""
    low = sum(cards)
    soft = ACE in cards and low + 10 <= 21
    return HandValue(low + 10 if soft else low, soft)


def is_blackjack(cards: Cards) -> bool:
    """Test the two cards of an original deal for a natural."""
    return len(cards) == 2 and ACE in cards and 10 in cards


class Action(Enum):
    HIT = "hit"
    STAND = "stand"
    DOUBLE = "double"
    SPLIT = "split"
    SURRENDER = "surrender"


# Strategies see only the active hand, the dealer's upcard and the legal moves.
Strategy = Callable[[Cards, int, frozenset[Action]], Action]


@dataclass(frozen=True, slots=True)
class TableRules:
    hit_soft_17: bool = False
    double_after_split: bool = True
    late_surrender: bool = False

    def __post_init__(self) -> None:
        if not all(isinstance(flag, bool) for flag in (
            self.hit_soft_17, self.double_after_split, self.late_surrender,
        )):
            raise ValueError("hit_soft_17, double_after_split and late_surrender must be booleans")

    def dealer_hits(self, value: HandValue) -> bool:
        return value.total < 17 or (self.hit_soft_17 and value.soft and value.total == 17)


DEFAULT_RULES = TableRules()


def require_table_rules(rules: TableRules) -> None:
    if not isinstance(rules, TableRules):
        raise ValueError("rules must be a TableRules instance")
