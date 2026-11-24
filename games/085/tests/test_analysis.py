from collections import Counter
from fractions import Fraction
from math import sqrt
import random
from statistics import mean, stdev
import unittest
from unittest.mock import patch

from blackjack.analysis import _trial_deals, analyze_opening
from blackjack.report import format_analysis
from blackjack.simulation import Tally
from blackjack.table import ACE, Action, TableRules


class OpeningAnalysisTests(unittest.TestCase):
    def scripted(self, opening, upcard, deals, **options):
        with patch("blackjack.analysis._trial_deals", return_value=iter(deals)):
            return analyze_opening(opening, upcard, trials=len(deals), seed=852, **options)

    def test_trial_shoes_conserve_all_cards_and_weight_the_allowed_hole_cards(self):
        full = Counter({rank: 24 for rank in range(1, 10)})
        full[10] = 96
        for opening, upcard in (((ACE, ACE), ACE), ((10, 10), 10), ((8, 8), 10), ((ACE, 7), 6)):
            with self.subTest(opening=opening, upcard=upcard):
                eligible = full.copy()
                eligible.subtract((*opening, upcard))
                if upcard == ACE:
                    del eligible[10]
                if upcard == 10:
                    del eligible[ACE]
                rng = random.Random(852)
                with patch.object(rng, "choice", wraps=rng.choice) as choose:
                    for dealer, remaining in _trial_deals(opening, upcard, 5, rng):
                        self.assertEqual(Counter(choose.call_args.args[0]), eligible)
                        self.assertEqual(dealer[0], upcard)
                        self.assertIn(dealer[1], eligible)
                        self.assertEqual(len(remaining), 308)
                        self.assertEqual(Counter((*opening, *dealer, *remaining)), full)
                    self.assertEqual(choose.call_count, 5)

    def test_matched_branches_and_paired_errors_agree_with_hand_calculated_payouts(self):
        deals = [((10, 7), [5]), ((10, 6), [10]), ((10, 7), [ACE])]
        analysis = self.scripted((10, 6), 10, deals, rules=TableRules(late_surrender=True))
        nets = {
            Action.HIT: [1, -1, 0], Action.STAND: [-1, 1, -1], Action.DOUBLE: [2, -2, 0],
            Action.SURRENDER: [-0.5, -0.5, -0.5],
        }
        self.assertEqual(analysis.chart_action, Action.SURRENDER)
        self.assertEqual(analysis.moves.keys(), nets.keys())
        for action, values in nets.items():
            with self.subTest(action=action):
                move = analysis.moves[action]
                deltas = [v - ref for v, ref in zip(values, nets[Action.SURRENDER])]
                self.assertEqual(move.rounds, Tally(
                    sum(v > 0 for v in values), sum(v < 0 for v in values), values.count(0),
                ))
                self.assertEqual(move.net_units, sum(values))
                self.assertAlmostEqual(move.mean_net, mean(values))
                self.assertAlmostEqual(move.mean_difference, mean(deltas))
                self.assertAlmostEqual(move.paired_standard_error, stdev(deltas) / sqrt(len(deltas)))

    def test_resplits_and_doubles_use_the_same_budget_as_a_live_round(self):
        # At an unrestricted table the left eight resplits, then the eleven doubles.
        deals = [((6, 10), [8, 3, 9, 10, 10, 3])] * 2
        full = self.scripted((8, 8), 6, deals)
        limited = self.scripted((8, 8), 6, deals, bankroll=Fraction(5, 2))
        self.assertEqual(full.chart_action, Action.SPLIT)
        self.assertEqual(full.moves[Action.SPLIT].rounds, Tally(ties=2))
        self.assertEqual(limited.moves[Action.SPLIT].rounds, Tally(wins=2))
        self.assertEqual(limited.moves[Action.SPLIT].mean_net, 2)
        self.assertEqual(limited.bankroll, Fraction(5, 2))

    def test_followup_moves_use_both_table_switches(self):
        # Splitting fives creates two elevens against an ace. H17/DAS doubles both.
        deals = [((ACE, 9), [6, 10, 6, 10])]
        for h17 in (False, True):
            for das in (False, True):
                with self.subTest(h17=h17, das=das):
                    analysis = self.scripted((5, 5), ACE, deals, rules=TableRules(h17, das))
                    self.assertEqual(analysis.moves[Action.SPLIT].mean_net, 4 if h17 and das else 2)
                    self.assertNotEqual(analysis.chart_action, Action.SPLIT)

    def test_split_aces_keep_their_one_card_limit_and_even_money_payout(self):
        analysis = self.scripted((ACE, ACE), 6, [((6, 10), [10, ACE, 3, 10])])
        self.assertEqual(analysis.chart_action, Action.SPLIT)
        self.assertEqual(analysis.moves[Action.SPLIT].rounds, Tally(ties=1))
        self.assertEqual(analysis.moves[Action.SPLIT].net_units, 0)

    def test_one_funded_unit_limits_moves_each_trial_and_one_trial_has_no_standard_error(self):
        analysis = analyze_opening([8, 8], 10, 1, 0, bankroll=1.5, rules=TableRules(late_surrender=True))
        self.assertEqual(analysis.cards, (8, 8))
        self.assertEqual(analysis.chart_action, Action.SURRENDER)
        self.assertEqual(list(analysis.moves), [Action.HIT, Action.STAND, Action.SURRENDER])
        for move in analysis.moves.values():
            self.assertEqual(move.rounds.total, 1)
            self.assertIsNone(move.paired_standard_error)
        self.assertEqual(format_analysis(analysis).count("n/a"), 3)

    def test_generated_seed_repeats_every_estimate_and_leaves_global_random_alone(self):
        before = random.getstate()
        for seed in (0, -852, None):
            with self.subTest(seed=seed):
                analysis = analyze_opening((8, 8), ACE, 75, seed, rules=TableRules(True, False, True))
                self.assertIsInstance(analysis.seed, int)
                self.assertEqual(analysis, analyze_opening(
                    analysis.cards, analysis.upcard, analysis.trials, analysis.seed, rules=analysis.rules,
                ))
        self.assertEqual(random.getstate(), before)

    def test_invalid_openings_or_trial_parameters_fail_before_sampling(self):
        bad_cards = [(), (4,), (2, 3, 4), (10, ACE), (True, 6), (1.5, 8), (0, 8), ("8", 8), None]
        cases = [(cards, 6, {}) for cards in bad_cards]
        cases.extend(((8, 8), rank, {}) for rank in (0, 11, True, 6.0, "A"))
        cases.extend(((8, 8), 6, {name: value}) for name, values in (
            ("trials", [0, -1, True, 3.5]), ("seed", [False, 1.0]),
            ("rules", [None, False]),
            ("bankroll", [0, 0.5, -1, 2.25, True, float("nan")]),
        ) for value in values)
        with patch("blackjack.analysis._trial_deals") as sample:
            for opening, upcard, options in cases:
                with self.subTest(case=(opening, upcard, options)), self.assertRaises(ValueError):
                    analyze_opening(opening, upcard, **options)
            sample.assert_not_called()
