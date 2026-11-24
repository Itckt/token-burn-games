"""Seeded opening-hand drills using the live table's legal moves and strategy chart."""

from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations_with_replacement
from random import Random

from .config import bankroll_amount, require_positive_count, resolve_seed
from .engine import legal_actions
from .report import format_hand, format_rank, format_rules, format_units
from .strategy import basic_strategy, strategy_for_table
from .table import ACE, DEFAULT_RULES, Action, Cards, TableRules, is_blackjack


FOCUSES = ("mixed", "hard", "soft", "pairs")


@dataclass(frozen=True, slots=True)
class PracticeQuestion:
    cards: Cards
    upcard: int
    legal_actions: frozenset[Action]
    answer: Action


def _shuffled_questions(deck: list[PracticeQuestion], count: int, rng: Random) -> Iterator[PracticeQuestion]:
    for number in range(count):
        position = number % len(deck)
        if position == 0:
            rng.shuffle(deck)
        yield deck[position]


def practice_questions(
    count: int, seed: int | None = None, *, focus: str = "mixed", rules: TableRules = DEFAULT_RULES,
    bankroll: int | float | Fraction | None = None,
) -> Iterator[PracticeQuestion]:
    """Cover every distinct opening in the focus once before shuffling the deck again."""
    require_positive_count(count, "question count")
    if focus not in FOCUSES:
        raise ValueError(f"practice focus must be one of {', '.join(FOCUSES)}")
    balance = bankroll_amount(bankroll, opening=True)
    bot = strategy_for_table(basic_strategy, rules)
    rng = Random(resolve_seed(seed))
    deck = []
    for cards in combinations_with_replacement(range(1, 11), 2):
        if is_blackjack(cards):
            continue
        if cards[0] == cards[1]:
            kind = "pairs"
        elif ACE in cards:
            kind = "soft"
        else:
            kind = "hard"
        if focus != "mixed" and focus != kind:
            continue
        legal = legal_actions(cards, rules=rules, can_add_wager=balance is None or balance >= 2)
        for upcard in range(1, 11):
            deck.append(PracticeQuestion(cards, upcard, legal, bot(cards, upcard, legal)))
    return _shuffled_questions(deck, count, rng)


def _ask(question: PracticeQuestion) -> Action | None:
    choices = {move.value: move for move in Action if move in question.legal_actions}
    moves = ", ".join(choices)
    print(f"Choose {moves}, or q to finish.")
    while True:
        try:
            reply = input("> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return None
        if reply in ("q", "quit"):
            return None
        if reply in choices:
            return choices[reply]
        print(f"Enter one of {moves}, or q to finish.")


def run_practice(
    count: int, seed: int | None, *, focus: str, rules: TableRules, bankroll: Fraction | None,
) -> None:
    seed = resolve_seed(seed)
    questions = practice_questions(count, seed, focus=focus, rules=rules, bankroll=bankroll)
    print(f"Strategy practice  |  {focus}  |  seed {seed}")
    print(f"Table rules          {format_rules(rules)}")
    if bankroll is not None:
        print(f"Bankroll per opening  {format_units(bankroll)}")
    answered = correct = 0
    for number, question in enumerate(questions, start=1):
        print(f"\nQuestion {number}/{count}  {format_hand(question.cards)}"
              f" against dealer {format_rank(question.upcard)}")
        move = _ask(question)
        if move is None:
            break
        answered += 1
        if move == question.answer:
            correct += 1
            print(f"Correct. The chart plays {move.value}.")
        else:
            print(f"You chose {move.value}. The chart plays {question.answer.value}.")
    rate = f"{correct / answered:.1%}" if answered else "n/a"
    print(f"\nScore  {correct} of {answered} correct ({rate})")
