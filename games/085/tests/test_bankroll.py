from fractions import Fraction
import random
import unittest
from unittest.mock import patch

from blackjack.bankroll import simulate_sessions
from blackjack.report import format_bankroll_study, format_units
from blackjack.simulation import Tally, simulate
from blackjack.table import ACE, TableRules
from tests.support import ScriptedShoe


class BankrollStudyTests(unittest.TestCase):
    def test_stopping_early_and_ending_unfunded_on_the_last_round_are_distinct(self):
        loss = [8, ACE, 8, 10]
        push = [ACE, 10, 10, ACE]
        natural = [ACE, 6, 10, 7]
        shoes = [ScriptedShoe(draws) for draws in (
            loss, push + loss, natural + [5, 10, 6, 9, 2], push * 2, natural + [5, 10, 6, 9, 10],
        )]
        with patch("blackjack.simulation.Shoe", side_effect=shoes):
            study = simulate_sessions(5, 2, 852, bankroll=1.5)
        self.assertTrue(all(not shoe.cards for shoe in shoes))
        self.assertEqual(study.ending_balances, (0.5, 0.5, 1, 1.5, 5))
        self.assertEqual(study.outcomes, Tally(wins=1, losses=3, ties=1))
        self.assertEqual((study.rounds_dealt, study.stopped_early, study.depleted), (9, 1, 2))
        self.assertEqual(study.lowest_seed, random.Random(852).getrandbits(64))
        for p, expected in ((0, 0.5), (10, 0.5), (40, 0.5), (41, 1), (50, 1), (90, 5), (100, 5)):
            self.assertEqual(study.percentile(p), expected)

    def test_child_sessions_match_replays_and_reset_the_bankroll_and_rules(self):
        rules = TableRules(True, False, True)
        options = dict(rounds=120, bankroll=Fraction(25, 2), rules=rules)
        study = simulate_sessions(15, seed=-852, **options)
        seeds = random.Random(-852)
        children = [simulate(seed=seeds.getrandbits(64), **options) for _ in range(15)]
        self.assertEqual(study.ending_balances, tuple(sorted(s.ending_bankroll for s in children)))
        self.assertEqual(study.rounds_dealt, sum(s.rounds.total for s in children))
        self.assertEqual(study.depleted, sum(s.ending_bankroll < 1 for s in children))
        self.assertEqual(study.stopped_early, sum(s.rounds.total < 120 for s in children))
        self.assertEqual(study.lowest_seed, min(children, key=lambda s: s.ending_bankroll).seed)
        self.assertEqual(study.rules, rules)

    def test_generated_master_seed_replays_without_advancing_global_random(self):
        before = random.getstate()
        study = simulate_sessions(10, 25, bankroll=8)
        self.assertIsInstance(study.seed, int)
        self.assertEqual(simulate_sessions(10, 25, study.seed, bankroll=8), study)
        self.assertEqual(random.getstate(), before)

    def test_unfunded_starts_and_single_session_percentiles(self):
        with patch("blackjack.simulation.Shoe") as shoe:
            for start in (0, Fraction(1, 2)):
                study = simulate_sessions(1, 20, 0, bankroll=start)
                self.assertEqual(study.outcomes, Tally(ties=1))
                self.assertEqual((study.depleted, study.stopped_early, study.rounds_dealt), (1, 1, 0))
                self.assertTrue(all(study.percentile(p) == start for p in range(101)))
            shoe.assert_not_called()
        for p in (-1, 101, 1.5, False):
            with self.subTest(p=p), self.assertRaisesRegex(ValueError, "percentile"):
                study.percentile(p)

    def test_balances_above_float_precision_keep_exact_half_units(self):
        start = 2**80 + Fraction(1, 2)
        with patch("blackjack.simulation.Shoe", return_value=ScriptedShoe([ACE, 10, 10, ACE])):
            study = simulate_sessions(1, 1, 0, bankroll=start)
        self.assertEqual(study.percentile(50), start)
        self.assertIn(f"{2**80:,}.5 units", format_bankroll_study(study))

    def test_fractional_unit_formatting_respects_precision_and_sign(self):
        self.assertEqual(format_units(Fraction(5, 2), "+,.2f"), "+2.50 units")
        self.assertEqual(format_units(Fraction(-1), "+,.1f"), "-1.0 unit")
        self.assertEqual(format_units(Fraction(1, 4)), "0.25 units")

    def test_invalid_settings_fail_before_starting_any_session(self):
        with patch("blackjack.bankroll.simulate") as run:
            for key, values in (
                ("sessions", [0, -1, True, 1.5]), ("rounds", [False, 0]),
                ("bankroll", [None, -1, 0.25, True]), ("rules", [None]), ("seed", ["852"]),
            ):
                for value in values:
                    options = dict(sessions=1, rounds=1, seed=0, bankroll=1)
                    options[key] = value
                    with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                        simulate_sessions(**options)
            run.assert_not_called()
