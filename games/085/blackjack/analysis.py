"""Study live openings after the dealer's blackjack check at a fresh six-deck table."""

from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from math import sqrt
from random import Random

from .config import bankroll_amount, require_positive_count, resolve_seed
from .engine import DECK, DECKS, _play_after_peek, legal_actions
from .simulation import Tally
from .strategy import basic_strategy, strategy_for_table
from .table import DEFAULT_RULES, Action, Cards, TableRules, is_blackjack, require_table_rules, score


@dataclass(slots=True)
class MoveEstimate:
    rounds: Tally = field(default_factory=Tally)
    net_units: float = 0.0
    mean_difference: float = 0.0
    _sum_squared_deviations: float = field(default=0.0, init=False, repr=False)

    def record(self, net: float, chart_net: float) -> None:
        self.rounds.record(net)
        self.net_units += net
        # Welford's update on the within-deal differences keeps memory constant.
        difference = net - chart_net
        change = difference - self.mean_difference
        self.mean_difference += change / self.rounds.total
        self._sum_squared_deviations += change * (difference - self.mean_difference)

    @property
    def mean_net(self) -> float:
        return self.net_units / self.rounds.total if self.rounds.total else 0.0

    @property
    def paired_standard_error(self) -> float | None:
        n = self.rounds.total
        return sqrt(self._sum_squared_deviations / (n * (n - 1))) if n > 1 else None


@dataclass(frozen=True, slots=True)
class OpeningAnalysis:
    cards: Cards
    upcard: int
    trials: int
    seed: int
    rules: TableRules
    bankroll: Fraction | None
    chart_action: Action
    moves: dict[Action, MoveEstimate]


def _live_opening(cards: Sequence[int], upcard: int) -> Cards:
    if not isinstance(cards, Sequence) or len(cards) != 2:
        raise ValueError("an opening decision requires exactly two player cards")
    opening = tuple(cards)
    for rank in (*opening, upcard):
        if isinstance(rank, bool) or not isinstance(rank, int) or not 1 <= rank <= 10:
            raise ValueError("card ranks must be integers from 1 (ace) through 10")
    if is_blackjack(opening):
        raise ValueError("a player blackjack settles before any opening decision")
    return opening


def _opening_shoe(opening: Cards, upcard: int) -> tuple[list[int], list[int]]:
    """Return all unseen cards and the subset eligible to be the hole card."""
    unseen = list(DECK) * DECKS
    for card in (*opening, upcard):
        unseen.remove(card)
    # One entry per physical card preserves the rank frequencies after the peek.
    return unseen, [card for card in unseen if not is_blackjack((upcard, card))]


def _trial_deals(
    opening: Cards, upcard: int, trials: int, rng: Random,
) -> Iterator[tuple[Cards, list[int]]]:
    unseen, possible_holes = _opening_shoe(opening, upcard)
    for _ in range(trials):
        hole = rng.choice(possible_holes)
        remaining = unseen.copy()
        remaining.remove(hole)
        rng.shuffle(remaining)
        yield (upcard, hole), remaining


def analyze_opening(
    cards: Sequence[int], upcard: int, trials: int = 10_000, seed: int | None = None,
    *, rules: TableRules = DEFAULT_RULES, bankroll: int | float | Fraction | None = None,
) -> OpeningAnalysis:
    """Try each legal first move after a negative peek, then follow the table's basic strategy."""
    require_positive_count(trials, "trials")
    opening = _live_opening(cards, upcard)
    balance = bankroll_amount(bankroll, opening=True)
    bot = strategy_for_table(basic_strategy, rules)
    seed = resolve_seed(seed)
    wager_limit = int(balance) if balance is not None else None
    legal = legal_actions(opening, rules=rules, can_add_wager=wager_limit is None or wager_limit >= 2)
    chart_action = bot(opening, upcard, legal)
    moves = {move: MoveEstimate() for move in Action if move in legal}
    for dealer, remaining in _trial_deals(opening, upcard, trials, Random(seed)):
        nets = {}
        for action in moves:
            # Each branch starts at the same next card, however many cards the last one used.
            played = _play_after_peek(
                opening, dealer, iter(remaining).__next__, bot, rules=rules,
                wager_limit=wager_limit, opening_action=action,
            )
            nets[action] = played.net_units
        for action, estimate in moves.items():
            estimate.record(nets[action], nets[chart_action])
    return OpeningAnalysis(opening, upcard, trials, seed, rules, balance, chart_action, moves)


@dataclass(frozen=True, slots=True)
class StandOdds:
    cards: Cards
    upcard: int
    rules: TableRules
    blackjack_before_peek: Fraction
    dealer_totals: dict[int, Fraction]  # 17 through 21, conditional on a negative peek.

    @property
    def dealer_bust(self) -> Fraction:
        return 1 - sum(self.dealer_totals.values(), Fraction())

    @property
    def win(self) -> Fraction:
        player = score(self.cards).total
        return self.dealer_bust + sum(p for total, p in self.dealer_totals.items() if total < player)

    @property
    def push(self) -> Fraction:
        return self.dealer_totals.get(score(self.cards).total, Fraction())

    @property
    def loss(self) -> Fraction:
        return 1 - self.win - self.push

    @property
    def expected_net(self) -> Fraction:
        return self.win - self.loss


def stand_odds(
    cards: Sequence[int], upcard: int, *, rules: TableRules = DEFAULT_RULES,
) -> StandOdds:
    """Enumerate dealer draws without replacement for a player who stands after the peek."""
    opening = _live_opening(cards, upcard)
    require_table_rules(rules)
    unseen, holes = _opening_shoe(opening, upcard)
    counts = Counter(unseen)
    totals = {total: Fraction() for total in range(17, 22)}

    def visit(dealer: Cards, remaining: int, probability: Fraction) -> None:
        value = score(dealer)
        if not rules.dealer_hits(value):
            if value.total <= 21:
                totals[value.total] += probability
            return
        for rank, copies in counts.items():
            if copies:
                counts[rank] -= 1
                visit(dealer + (rank,), remaining - 1, probability * copies / remaining)
                counts[rank] += 1

    for hole, copies in Counter(holes).items():
        counts[hole] -= 1
        visit((upcard, hole), len(unseen) - 1, Fraction(copies, len(holes)))
        counts[hole] += 1
    natural = Fraction(len(unseen) - len(holes), len(unseen))
    return StandOdds(opening, upcard, rules, natural, totals)
