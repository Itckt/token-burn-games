"""Run repeated rounds on one shoe and accumulate results in constant space."""

from dataclasses import dataclass, field
from fractions import Fraction
from random import Random

from .config import bankroll_amount, require_positive_count, resolve_seed
from .engine import Decision, Outcome, RoundResult, Shoe, play_round
from .strategy import basic_strategy, strategy_for_table
from .table import ACE, DEFAULT_RULES, Strategy, TableRules


@dataclass(slots=True)
class Tally:
    wins: int = 0
    losses: int = 0
    ties: int = 0

    def record(self, net_units: float) -> None:
        if net_units > 0:
            self.wins += 1
        elif net_units < 0:
            self.losses += 1
        else:
            self.ties += 1

    @property
    def total(self) -> int:
        return self.wins + self.losses + self.ties

    @property
    def win_rate(self) -> float:
        return self.wins / self.total if self.total else 0.0


@dataclass(frozen=True, slots=True)
class RoundReplay:
    number: int
    bankroll_before: Fraction | None
    decisions: tuple[Decision, ...]
    result: RoundResult


@dataclass(slots=True)
class UpcardStats:
    rounds: Tally = field(default_factory=Tally)
    units_wagered: int = 0
    net_units: float = 0.0


@dataclass(slots=True)
class SimulationResult:
    seed: int
    rounds: Tally = field(default_factory=Tally)
    hands: Tally = field(default_factory=Tally)
    paid_blackjacks: int = 0
    units_wagered: int = 0
    net_units: float = 0.0
    peak_net_units: float = 0.0
    max_drawdown: float = 0.0
    rules: TableRules = DEFAULT_RULES
    starting_bankroll: Fraction | None = None
    requested_rounds: int | None = None
    replay: RoundReplay | None = None
    surrenders: int = 0
    by_upcard: dict[int, UpcardStats] | None = None

    @property
    def ending_bankroll(self) -> Fraction | None:
        if self.starting_bankroll is None:
            return None
        return self.starting_bankroll + Fraction(self.net_units)

    @property
    def return_on_wager(self) -> float | None:
        return self.net_units / self.units_wagered if self.units_wagered else None

    def record(self, result: RoundResult) -> None:
        net = result.net_units
        wagered = result.units_wagered
        self.rounds.record(net)
        self.net_units += net
        self.units_wagered += wagered
        self.peak_net_units = max(self.peak_net_units, self.net_units)
        self.max_drawdown = max(self.max_drawdown, self.peak_net_units - self.net_units)
        if self.by_upcard is not None:
            bucket = self.by_upcard[result.dealer[0]]
            bucket.rounds.record(net)
            bucket.net_units += net
            bucket.units_wagered += wagered
        for hand in result.hands:
            self.hands.record(hand.net_units)
            if hand.outcome is Outcome.BLACKJACK:
                self.paid_blackjacks += 1
            elif hand.outcome is Outcome.SURRENDER:
                self.surrenders += 1


def simulate(
    rounds: int, seed: int | None = None, strategy: Strategy = basic_strategy,
    *, rules: TableRules = DEFAULT_RULES, bankroll: int | float | Fraction | None = None,
    replay_round: int | None = None, by_upcard: bool = False,
) -> SimulationResult:
    """Play successive rounds, optionally recording one replay and totals per dealer upcard."""
    require_positive_count(rounds, "rounds")
    if not isinstance(by_upcard, bool):
        raise ValueError("by_upcard must be a boolean")
    if replay_round is not None and (
        isinstance(replay_round, bool) or not isinstance(replay_round, int)
        or not 1 <= replay_round <= rounds
    ):
        raise ValueError("replay round must be an integer between 1 and the requested round count")
    starting_bankroll = bankroll_amount(bankroll)
    strategy = strategy_for_table(strategy, rules)
    seed = resolve_seed(seed)
    result = SimulationResult(
        seed, rules=rules, starting_bankroll=starting_bankroll, requested_rounds=rounds,
        by_upcard={rank: UpcardStats() for rank in (*range(2, 11), ACE)} if by_upcard else None,
    )
    if starting_bankroll is not None and starting_bankroll < 1:
        return result
    shoe = Shoe(Random(seed))
    for number in range(1, rounds + 1):
        balance = result.ending_bankroll
        if balance is not None and balance < 1:
            break
        decisions: list[Decision] | None = [] if number == replay_round else None
        played = play_round(
            shoe, strategy, rules=rules, wager_limit=None if balance is None else int(balance),
            on_decision=None if decisions is None else decisions.append,
        )
        result.record(played)
        if decisions is not None:
            result.replay = RoundReplay(number, balance, tuple(decisions), played)
    return result
