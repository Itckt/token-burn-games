"""Deal and settle one round with American hole-card rules and a 3:2 blackjack."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from random import Random
from typing import Protocol

from .strategy import basic_strategy, strategy_for_table
from .table import ACE, DEFAULT_RULES, Action, Cards, Strategy, TableRules, is_blackjack, score
from .table import HandValue as HandValue  # Public scoring type from the original engine API.

DECK = (ACE, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10) * 4
DECKS = 6
CUT_REMAINING = len(DECK) * DECKS // 4
MAX_HANDS = 4
_HIT_STAND = frozenset({Action.HIT, Action.STAND})


class CardSource(Protocol):
    def prepare_round(self) -> None: ...

    def draw(self) -> int: ...


class Shoe:
    """Six shuffled decks. The cut card takes effect before the next round."""

    def __init__(self, rng: Random):
        self._rng = rng
        self._cards: list[int] = []
        self.prepare_round()

    @property
    def remaining(self) -> int:
        return len(self._cards)

    def prepare_round(self) -> None:
        if self.remaining <= CUT_REMAINING:
            self._cards = list(DECK) * DECKS
            self._rng.shuffle(self._cards)

    def draw(self) -> int:
        return self._cards.pop()


@dataclass(frozen=True, slots=True)
class Decision:
    """One player choice, in deal order. Hand numbers start at one."""

    hand_number: int
    cards: Cards
    upcard: int
    legal_actions: frozenset[Action]
    action: Action


class Outcome(Enum):
    """The value is the net payout per unit wagered on the hand."""

    LOSS = -1
    PUSH = 0
    WIN = 1
    BLACKJACK = 1.5
    SURRENDER = -0.5


@dataclass(frozen=True, slots=True)
class HandResult:
    cards: Cards
    wager: int
    outcome: Outcome

    @property
    def net_units(self) -> float:
        return self.wager * self.outcome.value


@dataclass(frozen=True, slots=True)
class RoundResult:
    dealer: Cards
    hands: tuple[HandResult, ...]

    @property
    def net_units(self) -> float:
        return sum(hand.net_units for hand in self.hands)

    @property
    def units_wagered(self) -> int:
        return sum(hand.wager for hand in self.hands)


def legal_actions(
    cards: Cards, *, rules: TableRules = DEFAULT_RULES, hand_count: int = 1,
    can_add_wager: bool = True,
) -> frozenset[Action]:
    """Moves after the dealer peek. The hand count includes finished and pending splits."""
    if len(cards) < 2 or score(cards).total >= 21 or (hand_count > 1 and cards[0] == ACE):
        return frozenset()
    if len(cards) != 2:
        return _HIT_STAND
    moves = {Action.HIT, Action.STAND}
    if hand_count == 1 and rules.late_surrender:
        moves.add(Action.SURRENDER)
    if can_add_wager:
        if hand_count == 1 or rules.double_after_split:
            moves.add(Action.DOUBLE)
        if hand_count < MAX_HANDS and cards[0] == cards[1]:
            moves.add(Action.SPLIT)
    return frozenset(moves)


def _play_after_peek(
    opening: Cards, dealer: Cards, draw: Callable[[], int], strategy: Strategy, *,
    rules: TableRules, wager_limit: int | None, on_decision: Callable[[Decision], None] | None = None,
    opening_action: Action | None = None,
) -> RoundResult:
    """Finish a live opening. A trial can supply its first choice and use the bot thereafter."""
    upcard = dealer[0]
    pending = [opening]
    finished: list[tuple[Cards, int]] = []
    committed = 1
    while pending:
        cards = pending.pop()
        if len(cards) == 1:
            cards += (draw(),)
        hand_number = len(finished) + 1
        legal = legal_actions(
            cards, rules=rules, hand_count=hand_number + len(pending),
            can_add_wager=wager_limit is None or committed < wager_limit,
        )
        if not legal:
            finished.append((cards, 1))
            continue

        action = strategy(cards, upcard, legal) if opening_action is None else opening_action
        opening_action = None
        if not isinstance(action, Action) or action not in legal:
            choices = ", ".join(sorted(move.value for move in legal))
            raise ValueError(f"Illegal action {action!r} for {cards}. Legal moves are {choices}.")
        if on_decision is not None:
            on_decision(Decision(hand_number, cards, upcard, legal, action))

        if action is Action.SURRENDER:
            return RoundResult(dealer, (HandResult(cards, 1, Outcome.SURRENDER),))
        if action is Action.SPLIT:
            committed += 1
            # Push the right card first so the left hand plays to completion.
            pending.extend(((cards[1],), (cards[0],)))
        elif action is Action.HIT:
            pending.append(cards + (draw(),))
        elif action is Action.DOUBLE:
            committed += 1
            finished.append((cards + (draw(),), 2))
        else:
            finished.append((cards, 1))
    return _settle(dealer, finished, draw, rules)


def _settle(
    dealer: Cards, played: list[tuple[Cards, int]], draw: Callable[[], int], rules: TableRules,
) -> RoundResult:
    dealer_value = score(dealer)
    totals = [score(cards).total for cards, _ in played]
    if any(total <= 21 for total in totals):
        while rules.dealer_hits(dealer_value):
            dealer += (draw(),)
            dealer_value = score(dealer)
    hands = tuple(
        HandResult(cards, wager, _compare(total, dealer_value.total))
        for (cards, wager), total in zip(played, totals)
    )
    return RoundResult(dealer, hands)


def _compare(player_total: int, dealer_total: int) -> Outcome:
    if player_total > 21:
        return Outcome.LOSS
    if dealer_total > 21 or player_total > dealer_total:
        return Outcome.WIN
    if player_total == dealer_total:
        return Outcome.PUSH
    return Outcome.LOSS


def play_round(
    shoe: CardSource, strategy: Strategy = basic_strategy, *, rules: TableRules = DEFAULT_RULES,
    wager_limit: int | None = None, on_decision: Callable[[Decision], None] | None = None,
) -> RoundResult:
    """Open for one unit. A wager limit caps all stakes committed before settlement."""
    if wager_limit is not None and (
        isinstance(wager_limit, bool) or not isinstance(wager_limit, int) or wager_limit < 1
    ):
        raise ValueError("wager_limit must be a positive integer")
    strategy = strategy_for_table(strategy, rules)
    if on_decision is not None and not callable(on_decision):
        raise ValueError("on_decision must be callable")
    shoe.prepare_round()
    first = shoe.draw()
    upcard = shoe.draw()
    opening = (first, shoe.draw())
    dealer = (upcard, shoe.draw())

    player_natural = is_blackjack(opening)
    dealer_natural = is_blackjack(dealer)
    if player_natural or dealer_natural:
        if player_natural and dealer_natural:
            outcome = Outcome.PUSH
        elif player_natural:
            outcome = Outcome.BLACKJACK
        else:
            outcome = Outcome.LOSS
        return RoundResult(dealer, (HandResult(opening, 1, outcome),))

    return _play_after_peek(
        opening, dealer, shoe.draw, strategy, rules=rules, wager_limit=wager_limit,
        on_decision=on_decision,
    )
