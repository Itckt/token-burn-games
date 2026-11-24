from pathlib import Path
import random
import re
import subprocess
import sys
import unittest

from blackjack.analysis import analyze_opening
from blackjack.bankroll import simulate_sessions
from blackjack.engine import ACE, Action, HandResult, Outcome, RoundResult, Shoe, play_round, score
from blackjack.practice import practice_questions
from blackjack.report import format_analysis, format_bankroll_study, format_report
from blackjack.simulation import SimulationResult, Tally, simulate
from blackjack.strategy import basic_strategy
from blackjack.table import TableRules


class SimulationTests(unittest.TestCase):
    def test_rounds_use_net_units_and_hands_use_individual_outcomes(self):
        summary = SimulationResult(seed=852)
        rounds = [
            # A doubled win offsets a single loss and still wins the round.
            (HandResult((8, 3, 9), 2, Outcome.WIN), HandResult((8, 10), 1, Outcome.LOSS)),
            # A single win and a single loss break even without a hand push.
            (HandResult((8, 9), 1, Outcome.LOSS), HandResult((8, 2, 10), 1, Outcome.WIN)),
            (HandResult((ACE, 10), 1, Outcome.BLACKJACK),),
            (HandResult((5, 6, 5), 2, Outcome.LOSS),),
            (HandResult((10, 9), 1, Outcome.PUSH),),
        ]
        for hands in rounds:
            summary.record(RoundResult((10, 9), hands))
        self.assertEqual(summary.rounds, Tally(wins=2, losses=1, ties=2))
        self.assertEqual(summary.hands, Tally(wins=3, losses=3, ties=1))
        self.assertEqual(summary.rounds.win_rate, 2 / 5)
        self.assertEqual(summary.hands.win_rate, 3 / 7)
        self.assertEqual(summary.paid_blackjacks, 1)
        self.assertEqual(summary.units_wagered, 9)
        self.assertEqual(summary.net_units, 0.5)

    def test_pushed_naturals_do_not_count_as_paid_blackjacks(self):
        summary = SimulationResult(seed=1)
        summary.record(RoundResult((ACE, 10), (HandResult((10, ACE), 1, Outcome.PUSH),)))
        self.assertEqual(summary.paid_blackjacks, 0)
        self.assertEqual(summary.hands.win_rate, 0.0)
        self.assertEqual(summary.net_units, 0)

    def test_simulation_matches_independent_accounting_of_seeded_deals(self):
        shoe = Shoe(random.Random(852))
        round_profits = []
        hand_profits = []
        wagers = []
        paid_blackjacks = 0
        for _ in range(2000):
            result = play_round(shoe, basic_strategy)
            self.assertTrue(1 <= len(result.hands) <= 4)
            profits = []
            for hand in result.hands:
                self.assertIn(hand.wager, (1, 2))
                player, dealer = score(hand.cards).total, score(result.dealer).total
                natural = len(result.hands) == 1 and len(hand.cards) == 2 and player == 21
                dealer_natural = len(result.dealer) == 2 and dealer == 21
                if natural and not dealer_natural:
                    paid_blackjacks += 1
                    profits.append(1.5)
                elif player > 21 or (dealer_natural and not natural):
                    profits.append(-hand.wager)
                elif dealer > 21 or player > dealer:
                    profits.append(hand.wager)
                elif player < dealer:
                    profits.append(-hand.wager)
                else:
                    profits.append(0)
                self.assertEqual(hand.net_units, profits[-1])
                wagers.append(hand.wager)
            hand_profits.extend(profits)
            round_profits.append(sum(profits))

        summary = simulate(2000, 852)
        for tally, profits in ((summary.rounds, round_profits), (summary.hands, hand_profits)):
            self.assertEqual(tally.total, len(profits))
            self.assertEqual(tally.wins, sum(p > 0 for p in profits))
            self.assertEqual(tally.losses, sum(p < 0 for p in profits))
            self.assertEqual(tally.ties, profits.count(0))
        self.assertEqual(summary.net_units, sum(round_profits))
        self.assertEqual(summary.units_wagered, sum(wagers))
        self.assertEqual(summary.paid_blackjacks, paid_blackjacks)
        self.assertGreater(summary.hands.total, summary.rounds.total)
        self.assertGreater(summary.units_wagered, summary.hands.total)

    def test_explicit_and_generated_seeds_replay_without_changing_global_random(self):
        before = random.getstate()
        for seed in (0, 852, None):
            with self.subTest(seed=seed):
                result = simulate(400, seed)
                self.assertIsInstance(result.seed, int)
                self.assertEqual(simulate(400, result.seed), result)
        self.assertEqual(random.getstate(), before)

    def test_injected_stand_strategy_never_splits_or_doubles(self):
        summary = simulate(800, seed=7, strategy=lambda cards, upcard, legal: Action.STAND)
        self.assertEqual(summary.rounds, summary.hands)
        self.assertEqual(summary.units_wagered, 800)
        even_money_profit = summary.hands.wins - summary.hands.losses
        self.assertEqual(summary.net_units, even_money_profit + 0.5 * summary.paid_blackjacks)

    def test_single_round_and_invalid_round_counts(self):
        self.assertEqual(simulate(1, 0).rounds.total, 1)
        for count in (0, -1, 2.5, True, "4"):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "positive integer"):
                simulate(count, seed=7)


class CommandLineTests(unittest.TestCase):
    def run_cli(self, *args, answers=""):
        return subprocess.run(
            [sys.executable, "-B", "-m", "blackjack", *args],
            cwd=Path(__file__).resolve().parents[1], capture_output=True,
            text=True, input=answers, timeout=30, check=False,
        )

    def test_report_matches_run_through_library(self):
        summary = simulate(850, seed=852)
        process = self.run_cli("--rounds", "850", "--seed", "852")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stderr, "")
        self.assertIn("seed 852", process.stdout)
        rows = dict(re.split(r"\s{2,}", line, maxsplit=1) for line in process.stdout.splitlines()[1:])
        for label, tally, tie in [("Rounds", summary.rounds, "even"), ("Hands", summary.hands, "pushed")]:
            outcomes = f"{tally.wins:,} won, {tally.losses:,} lost, {tally.ties:,} {tie}"
            self.assertEqual(rows[label], f"{tally.total:,}  ({outcomes})")
        self.assertEqual(rows["Round win rate"], f"{summary.rounds.win_rate:.2%}")
        self.assertEqual(rows["Hand win rate"], f"{summary.hands.win_rate:.2%}")
        self.assertEqual(rows["Paid blackjacks"], f"{summary.paid_blackjacks:,}")
        self.assertEqual(rows["Total wagered"], f"{summary.units_wagered:,} units")
        self.assertEqual(rows["Net profit"], f"{summary.net_units:+,.1f} units")
        self.assertEqual(rows["Net / total wagered"], f"{summary.net_units / summary.units_wagered:+.2%}")

    def test_default_run_prints_a_replayable_seed(self):
        first = self.run_cli()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertRegex(first.stdout, r"Rounds\s+10,000\b")
        seed = re.search(r"\bseed (\d+)", first.stdout)
        self.assertIsNotNone(seed)
        replay = self.run_cli("--seed", seed.group(1))
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(first.stdout, replay.stdout)

    def test_help_and_invalid_arguments(self):
        help_text = self.run_cli("--help")
        self.assertEqual(help_text.returncode, 0, help_text.stderr)
        for flag in ("--rounds", "--seed", "--hit-soft-17", "--no-double-after-split",
                     "--bankroll", "--replay", "--late-surrender", "--analyze", "--by-upcard",
                     "--odds", "--practice", "--sessions"):
            self.assertIn(flag, help_text.stdout)
        for args in (("--rounds", "0"), ("--rounds", "-1"), ("--rounds", "2.5"), ("--seed", "tea")):
            with self.subTest(args=args):
                process = self.run_cli(*args)
                self.assertEqual(process.returncode, 2)
                self.assertIn(args[0], process.stderr)
                self.assertNotIn("Traceback", process.stderr)

    def test_original_readme_example_still_matches_the_default_table(self):
        process = self.run_cli("--rounds", "20", "--seed", "852")
        self.assertEqual(process.returncode, 0, process.stderr)
        readme = Path(__file__).resolve().parents[1] / "README.md"
        self.assertIn(f"```text\n{process.stdout.rstrip()}\n```", readme.read_text(encoding="utf-8"))

    def test_combined_rules_bankroll_and_replay(self):
        args = ("--seed", "852", "--rounds", "20", "--hit-soft-17", "--no-double-after-split",
                "--bankroll", "12.5", "--replay", "12")
        process = self.run_cli(*args)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stderr, "")
        self.assertIn("dealer hits soft 17, double after split disabled", process.stdout)
        self.assertIn("Ending bankroll      13 units", process.stdout)
        self.assertIn("Maximum drawdown     5.0 units", process.stdout)
        self.assertIn("Bankroll at deal     7.5 units", process.stdout)
        self.assertIn("Hand 1  [2 2] (4) -> split", process.stdout)
        self.assertIn("Hand 2  [2 A] (soft 13) -> hit  (legal moves hit, stand)", process.stdout)
        self.assertIn("Dealer  [6 A] (soft 17) -> hit 10", process.stdout)
        self.assertIn("Dealer               [6 A 10] (17)", process.stdout)
        self.assertIn("Round net            +0 units", process.stdout)
        self.assertEqual(process.stdout, self.run_cli(*args).stdout)

    def test_session_reports_an_unreached_replay(self):
        process = self.run_cli("--seed", "852", "--rounds", "20", "--bankroll", "1", "--replay", "12")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("1 of 20 rounds dealt", process.stdout)
        self.assertIn("Round 12 was not dealt", process.stdout)
        self.assertNotIn("Round 12 replay", process.stdout)

    def test_invalid_bankroll_and_replay_flags_are_usage_errors(self):
        cases = (
            ("--bankroll", "-1"), ("--bankroll", "0.25"), ("--bankroll", "milk-tea"),
            ("--bankroll", "1/0"), ("--replay", "0"), ("--replay", "1.5"), ("--replay", "3"),
        )
        for flag, value in cases:
            with self.subTest(flag=flag, value=value):
                process = self.run_cli("--rounds", "2", flag, value)
                self.assertEqual(process.returncode, 2)
                self.assertEqual(process.stdout, "")
                self.assertIn(flag, process.stderr)
                self.assertNotIn("Traceback", process.stderr)

    def test_surrender_replay_and_upcard_report_share_the_session_results(self):
        process = self.run_cli("--rounds", "100", "--seed", "852", "--late-surrender",
                               "--by-upcard", "--replay", "42")
        self.assertEqual(process.returncode, 0, process.stderr)
        summary = simulate(100, 852, by_upcard=True, rules=TableRules(late_surrender=True))
        report, replay = process.stdout.split("\n\nRound 42 replay\n")
        self.assertEqual(report, format_report(summary))
        self.assertIn("Surrenders           4", report)
        table = report.split("Rounds by dealer upcard\n")[1].splitlines()
        for row, group in zip(table[1:], summary.by_upcard.values(), strict=True):
            rank, count, wins, losses, even, win_rate, wagered, net, roi = row.split()
            self.assertEqual(int(count), group.rounds.total, rank)
            self.assertEqual([int(wins), int(losses), int(even)],
                             [group.rounds.wins, group.rounds.losses, group.rounds.ties])
            self.assertEqual(win_rate, f"{group.rounds.win_rate:.2%}")
            self.assertEqual((int(wagered), float(net)), (group.units_wagered, group.net_units))
            self.assertEqual(roi, f"{group.net_units / group.units_wagered:+.2%}")
        self.assertIn("[6 10] (16) -> surrender", replay)
        self.assertIn("Round net            -0.5 units", replay)

    def test_opening_analysis_accepts_face_ranks_and_respects_all_table_options(self):
        flags = ("--hit-soft-17", "--no-double-after-split", "--late-surrender", "--bankroll", "1.5")
        for first, second, upcard, cards, dealer in (
            ("J", "q", "a", (10, 10), ACE), ("A", "7", "k", (ACE, 7), 10),
        ):
            with self.subTest(first=first):
                process = self.run_cli("--analyze", first, second, upcard, "--rounds", "9",
                                       "--seed", "-852", *flags)
                self.assertEqual(process.returncode, 0, process.stderr)
                analysis = analyze_opening(cards, dealer, 9, -852, bankroll=1.5, rules=TableRules(True, False, True))
                self.assertEqual(process.stdout.rstrip(), format_analysis(analysis))
                self.assertIn("Net/round  Vs chart  Paired SE", process.stdout)
                self.assertEqual(list(analysis.moves), [Action.HIT, Action.STAND, Action.SURRENDER])

    def test_invalid_analysis_arguments_are_usage_errors(self):
        cases = (
            ("--analyze", "8", "8"), ("--analyze", "8", "11", "6"), ("--analyze", "A", "10", "6"),
            ("--analyze", "8", "8", "6", "--bankroll", "0.5"),
            ("--analyze", "8", "8", "6", "--rounds", "0"),
            ("--analyze", "8", "8", "6", "--replay", "1"),
            ("--analyze", "8", "8", "6", "--by-upcard"),
        )
        for args in cases:
            with self.subTest(args=args):
                process = self.run_cli(*args)
                self.assertEqual(process.returncode, 2, process.stderr)
                self.assertEqual(process.stdout, "")
                self.assertIn("--analyze", process.stderr)
                self.assertNotIn("Traceback", process.stderr)

    def test_stand_odds_print_separate_pre_peek_and_post_peek_probabilities(self):
        process = self.run_cli("--odds", "k", "8", "A", "--hit-soft-17")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("[10 8] (18) against dealer A", process.stdout)
        self.assertIn("Dealer blackjack before peek    30.744%", process.stdout)
        self.assertIn("Stand win / push / loss    28.422% / 20.819% / 50.759%", process.stdout)
        self.assertIn("Stand net per unit         -0.22338", process.stdout)
        self.assertNotIn("seed", process.stdout)
        table = self.run_cli("--odds", "10", "8", "1", "--hit-soft-17", "--late-surrender", "--no-double-after-split")
        self.assertEqual(table.returncode, 0, table.stderr)
        self.assertEqual(table.stdout, process.stdout)

    def test_practice_grades_only_answered_questions_and_reprompts_illegal_moves(self):
        rules = TableRules(hit_soft_17=True, double_after_split=False, late_surrender=True)
        first, second, _ = practice_questions(3, 852, focus="pairs", rules=rules, bankroll=1.5)
        wrong = next(move for move in Action if move in second.legal_actions and move != second.answer)
        answers = f"split\n  {first.answer.value.upper()}  \n{wrong.value}\nq\n"
        process = self.run_cli("--practice", "pairs", "--rounds", "3", "--seed", "852", "--bankroll", "1.5",
                               "--hit-soft-17", "--late-surrender", "--no-double-after-split", answers=answers)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("Enter one of hit, stand, surrender", process.stdout)
        self.assertIn(f"Correct. The chart plays {first.answer.value}.", process.stdout)
        self.assertIn(f"You chose {wrong.value}. The chart plays {second.answer.value}.", process.stdout)
        self.assertIn("Question 3/3", process.stdout)
        self.assertIn("Score  1 of 2 correct (50.0%)", process.stdout)

    def test_practice_eof_and_generated_seed_replay(self):
        first = self.run_cli("--practice")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("Question 1/10", first.stdout)
        self.assertIn("Score  0 of 0 correct (n/a)", first.stdout)
        seed = re.search(r"seed (\d+)", first.stdout).group(1)
        self.assertEqual(self.run_cli("--practice", "--seed", seed).stdout, first.stdout)
        question, = practice_questions(1, int(seed))
        full = self.run_cli("--practice", "--rounds", "1", "--seed", seed, answers=question.answer.value + "\n")
        self.assertEqual(full.returncode, 0, full.stderr)
        self.assertIn("Score  1 of 1 correct (100.0%)", full.stdout)

    def test_bankroll_study_through_cli_and_lowest_finish_replay(self):
        options = ("--rounds", "40", "--bankroll", "12.5", "--hit-soft-17", "--late-surrender")
        process = self.run_cli("--sessions", "20", "--seed", "852", *options)
        study = simulate_sessions(20, 40, 852, bankroll=12.5, rules=TableRules(hit_soft_17=True, late_surrender=True))
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(process.stdout.rstrip(), format_bankroll_study(study))
        child = self.run_cli("--seed", str(study.lowest_seed), *options)
        self.assertEqual(child.returncode, 0, child.stderr)
        lowest = process.stdout.split("Lowest finish        ")[1].split("  |")[0]
        self.assertIn("Ending bankroll      " + lowest + "\n", child.stdout)

    def test_study_modes_reject_conflicts_and_unusable_arguments(self):
        for args in (
            ("--odds", "A", "K", "7"), ("--odds", "5", "6", "J", "--seed", "0"),
            ("--odds", "5", "6", "J", "--replay", "1"), ("--odds", "5", "6", "J", "--rounds", "1"),
            ("--practice", "soft", "--rounds", "0"), ("--practice", "hard", "--bankroll", "0.5"),
            ("--practice", "faces"), ("--practice", "--by-upcard"), ("--sessions", "1"),
            ("--sessions", "0", "--bankroll", "1"), ("--sessions", "2", "--bankroll", "1", "--rounds", "0"),
            ("--practice", "--sessions", "1"), ("--analyze", "8", "8", "6", "--odds", "9", "8", "6"),
        ):
            with self.subTest(args=args):
                process = self.run_cli(*args)
                self.assertEqual(process.returncode, 2, process.stderr)
                self.assertEqual(process.stdout, "")
                self.assertNotIn("Traceback", process.stderr)
