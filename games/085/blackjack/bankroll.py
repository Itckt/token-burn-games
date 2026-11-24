"""Measure how often a fixed starting balance lasts across independently seeded sessions."""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from fractions import Fraction
from random import Random

from .config import bankroll_amount, require_positive_count, resolve_seed
from .simulation import Tally, simulate
from .table import DEFAULT_RULES, TableRules, require_table_rules


@dataclass(frozen=True, slots=True)
class BankrollStudy:
    seed: int
    rules: TableRules
    starting_bankroll: Fraction
    rounds_per_session: int
    rounds_dealt: int
    stopped_early: int
    ending_balances: tuple[Fraction, ...]  # Sorted from lowest to highest.
    lowest_seed: int

    @property
    def outcomes(self) -> Tally:
        below = bisect_left(self.ending_balances, self.starting_bankroll)
        above = bisect_right(self.ending_balances, self.starting_bankroll)
        return Tally(wins=len(self.ending_balances) - above, losses=below, ties=above - below)

    @property
    def depleted(self) -> int:
        """Count all finishes below the next opening stake, including on the final deal."""
        return bisect_left(self.ending_balances, 1)

    def percentile(self, percent: int) -> Fraction:
        """Nearest-rank ending balance. The zeroth percentile is the minimum."""
        if isinstance(percent, bool) or not isinstance(percent, int) or not 0 <= percent <= 100:
            raise ValueError("percentile must be an integer from 0 through 100")
        rank = (percent * len(self.ending_balances) + 99) // 100
        return self.ending_balances[max(1, rank) - 1]


def simulate_sessions(
    sessions: int, rounds: int, seed: int | None = None, *,
    bankroll: int | float | Fraction, rules: TableRules = DEFAULT_RULES,
) -> BankrollStudy:
    """Reset the shoe and bankroll for each session. Retain one ending balance per session."""
    require_positive_count(sessions, "sessions")
    require_positive_count(rounds, "rounds")
    require_table_rules(rules)
    start = bankroll_amount(bankroll)
    if start is None:
        raise ValueError("a bankroll study requires a starting bankroll")
    seed = resolve_seed(seed)
    seeds = Random(seed)
    endings: list[Fraction] = []
    rounds_dealt = stopped_early = 0
    lowest, lowest_seed = start, seed
    for _ in range(sessions):
        child_seed = seeds.getrandbits(64)
        session = simulate(rounds, child_seed, bankroll=start, rules=rules)
        ending = session.ending_bankroll
        assert ending is not None  # Each session started with the specified balance.
        if not endings or ending < lowest:
            lowest, lowest_seed = ending, child_seed
        endings.append(ending)
        rounds_dealt += session.rounds.total
        if session.rounds.total < rounds:
            stopped_early += 1
    return BankrollStudy(
        seed, rules, start, rounds, rounds_dealt, stopped_early, tuple(sorted(endings)), lowest_seed,
    )
