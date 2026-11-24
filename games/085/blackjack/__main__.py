"""Command-line entry point for the basic-strategy simulation."""

import argparse
from fractions import Fraction

from .analysis import analyze_opening, stand_odds
from .bankroll import simulate_sessions
from .practice import FOCUSES, run_practice
from .report import format_analysis, format_bankroll_study, format_odds, format_replay, format_report
from .simulation import simulate
from .table import ACE, TableRules


_RANKS = {str(rank): rank for rank in range(1, 11)} | {"A": ACE, "J": 10, "Q": 10, "K": 10}


def _parse_rank(text: str) -> int:
    try:
        return _RANKS[text.upper()]
    except KeyError:
        raise argparse.ArgumentTypeError("expected A, 1-10, J, Q or K") from None


def _parse_bankroll(text: str) -> Fraction:
    try:
        return Fraction(text)
    except (ValueError, ZeroDivisionError):
        raise argparse.ArgumentTypeError("expected an amount in whole or half units") from None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m blackjack",
        description="Simulate a six-deck table, study opening moves or practise basic strategy.",
    )
    parser.add_argument(
        "--rounds", type=int,
        help="rounds per session, trials per opening move, or practice questions (default 10000, practice 10)",
    )
    parser.add_argument(
        "--seed", type=int, help="integer seed for a session, study or drill (generated when omitted)",
    )
    parser.add_argument(
        "--hit-soft-17", action="store_true", help="dealer hits soft 17 (default stands)",
    )
    parser.add_argument(
        "--no-double-after-split", dest="double_after_split", action="store_false",
        help="disable doubling on split hands (default allowed)",
    )
    parser.add_argument(
        "--late-surrender", action="store_true", help="allow the opening hand to surrender after the peek",
    )
    parser.add_argument(
        "--bankroll", type=_parse_bankroll, metavar="UNITS",
        help="starting balance in whole or half units, reset for each session or opening (default unlimited)",
    )
    parser.add_argument(
        "--replay", type=int, metavar="ROUND", help="show decisions and payouts for this 1-based round",
    )
    parser.add_argument(
        "--by-upcard", action="store_true", help="break down session results by the dealer's visible card",
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--analyze", nargs=3, type=_parse_rank, metavar=("CARD", "CARD", "UPCARD"),
        help="compare every legal first move for these player cards and dealer upcard",
    )
    modes.add_argument(
        "--odds", nargs=3, type=_parse_rank, metavar=("CARD", "CARD", "UPCARD"),
        help="compute exact dealer totals and stand win/push/loss probabilities",
    )
    modes.add_argument(
        "--practice", nargs="?", choices=FOCUSES, const="mixed",
        help="quiz yourself on opening moves (default mixed hands)",
    )
    modes.add_argument(
        "--sessions", type=int, metavar="COUNT",
        help="study ending balances across independent sessions (requires --bankroll)",
    )
    return parser


def _run(args: argparse.Namespace) -> None:
    modes = (args.analyze, args.odds, args.practice, args.sessions)
    if any(mode is not None for mode in modes) and (args.replay is not None or args.by_upcard):
        raise ValueError("--replay and --by-upcard require a single simulated session")
    rules = TableRules(
        hit_soft_17=args.hit_soft_17, double_after_split=args.double_after_split,
        late_surrender=args.late_surrender,
    )
    if args.odds is not None:
        if any(value is not None for value in (args.rounds, args.seed, args.bankroll)):
            raise ValueError("--odds takes the three visible cards and table rules only")
        first, second, upcard = args.odds
        print(format_odds(stand_odds((first, second), upcard, rules=rules)))
        return

    default_rounds = 10 if args.practice is not None else 10_000
    rounds = default_rounds if args.rounds is None else args.rounds
    if args.practice is not None:
        run_practice(rounds, args.seed, focus=args.practice, rules=rules, bankroll=args.bankroll)
        return
    if args.sessions is not None:
        if args.bankroll is None:
            raise ValueError("--sessions requires --bankroll")
        study = simulate_sessions(args.sessions, rounds, args.seed, bankroll=args.bankroll, rules=rules)
        print(format_bankroll_study(study))
        return
    if args.analyze is not None:
        first, second, upcard = args.analyze
        analysis = analyze_opening(
            (first, second), upcard, rounds, args.seed, rules=rules, bankroll=args.bankroll,
        )
        print(format_analysis(analysis))
        return
    result = simulate(
        rounds, args.seed, rules=rules, bankroll=args.bankroll, replay_round=args.replay,
        by_upcard=args.by_upcard,
    )
    print(format_report(result))
    if result.replay is not None:
        print()
        print(format_replay(result.replay))
    elif args.replay is not None:
        print(f"Round {args.replay:,} was not dealt before the session stopped.")


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    try:
        _run(args)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
