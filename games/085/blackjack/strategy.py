"""Total-dependent six-deck basic strategy for American peek games."""

from functools import partial

from .table import ACE, DEFAULT_RULES, Action, Cards, Strategy, TableRules, require_table_rules, score


# Dealer upcards against which basic strategy splits each pair. Missing pairs
# (fives and tens) play as hard totals. Ten also represents every face card.
_SPLIT_AGAINST = {
    ACE: frozenset(range(1, 11)),
    2: frozenset(range(2, 8)),
    3: frozenset(range(2, 8)),
    4: frozenset({5, 6}),
    6: frozenset(range(2, 7)),
    7: frozenset(range(2, 8)),
    8: frozenset(range(1, 11)),
    9: frozenset({2, 3, 4, 5, 6, 8, 9}),
}
_SPLIT_WITHOUT_DAS = {
    **_SPLIT_AGAINST,
    2: frozenset(range(4, 8)),
    3: frozenset(range(4, 8)),
    4: frozenset(),
    6: frozenset(range(3, 7)),
}
# Minimum dealer upcard for doubling soft totals below 18. Each range ends at six.
_SOFT_DOUBLE_FROM = {13: 5, 14: 5, 15: 4, 16: 4, 17: 3}


def _soft_move(total: int, upcard: int, can_double: bool, rules: TableRules) -> Action:
    if total >= 19:
        if total == 19 and rules.hit_soft_17 and upcard == 6 and can_double:
            return Action.DOUBLE
        return Action.STAND
    if total == 18:
        first_double = 2 if rules.hit_soft_17 else 3
        if can_double and first_double <= upcard <= 6:
            return Action.DOUBLE
        return Action.STAND if 2 <= upcard <= 8 else Action.HIT
    minimum = _SOFT_DOUBLE_FROM.get(total)
    if can_double and minimum is not None and minimum <= upcard <= 6:
        return Action.DOUBLE
    return Action.HIT


def basic_strategy(
    cards: Cards, upcard: int, legal: frozenset[Action], *, rules: TableRules = DEFAULT_RULES,
) -> Action:
    """Choose a move from the table's chart, subject to current wager limits."""
    total, soft = score(cards)
    two_cards = len(cards) == 2
    can_surrender = two_cards and Action.SURRENDER in legal and not soft
    # At H17 this takes precedence even over splitting eights.
    if can_surrender and rules.hit_soft_17 and upcard == ACE and 15 <= total <= 17:
        return Action.SURRENDER

    splits = _SPLIT_AGAINST if rules.double_after_split else _SPLIT_WITHOUT_DAS
    pair = two_cards and cards[0] == cards[1]
    if pair and Action.SPLIT in legal and upcard in splits.get(cards[0], ()):
        return Action.SPLIT
    if can_surrender:
        if total == 16 and upcard in (9, 10, ACE):
            return Action.SURRENDER
        if total == 15 and upcard == 10:
            return Action.SURRENDER

    can_double = two_cards and Action.DOUBLE in legal
    if soft:
        return _soft_move(total, upcard, can_double, rules)

    if total >= 17 or (13 <= total <= 16 and 2 <= upcard <= 6):
        return Action.STAND
    if total == 12 and 4 <= upcard <= 6:
        return Action.STAND
    if can_double:
        if total == 9 and 3 <= upcard <= 6:
            return Action.DOUBLE
        if total == 10 and 2 <= upcard <= 9:
            return Action.DOUBLE
        if total == 11 and (upcard != ACE or rules.hit_soft_17):
            return Action.DOUBLE
    return Action.HIT


def strategy_for_table(strategy: Strategy, rules: TableRules) -> Strategy:
    """Bind the built-in chart to this table and preserve a caller's custom strategy."""
    require_table_rules(rules)
    if not callable(strategy):
        raise ValueError("strategy must be callable")
    if strategy is basic_strategy and rules != DEFAULT_RULES:
        return partial(basic_strategy, rules=rules)
    return strategy
