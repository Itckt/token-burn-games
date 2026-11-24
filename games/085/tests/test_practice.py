import random
import unittest

from blackjack.practice import practice_questions
from blackjack.table import ACE, Action, TableRules


class PracticeTests(unittest.TestCase):
    def test_each_focus_deals_every_distinct_visible_opening_once_per_pass(self):
        for focus, size in (("mixed", 540), ("pairs", 100), ("soft", 80), ("hard", 360)):
            with self.subTest(focus=focus):
                quiz = list(practice_questions(2 * size, 852, focus=focus))
                first = {(q.cards, q.upcard) for q in quiz[:size]}
                second = {(q.cards, q.upcard) for q in quiz[size:]}
                self.assertEqual(len(first), size)
                self.assertEqual(first, second)
                self.assertNotEqual(quiz[:size], quiz[size:])
                for (left, right), upcard in first:
                    self.assertTrue(1 <= left <= right <= 10 and 1 <= upcard <= 10)
                    self.assertNotEqual((left, right), (ACE, 10))
                    if focus == "pairs":
                        self.assertEqual(left, right)
                    elif focus == "hard":
                        self.assertTrue(1 < left < right)
                    elif focus == "soft":
                        self.assertTrue(left == ACE and 2 <= right <= 9)

    def test_drills_use_live_rules_and_reset_the_wager_limit_on_each_question(self):
        rules = TableRules(hit_soft_17=True, double_after_split=False, late_surrender=True)

        def positions(balance):
            questions = practice_questions(540, -852, rules=rules, bankroll=balance)
            return {(q.cards, q.upcard): q for q in questions}

        funded, limited = positions(2), positions(1.5)
        for key, move in (
            (((ACE, 8), 6), Action.DOUBLE), (((4, 4), 6), Action.HIT), (((8, 8), ACE), Action.SURRENDER),
            (((8, 8), 10), Action.SPLIT), (((5, 10), 10), Action.SURRENDER),
        ):
            self.assertEqual(funded[key].answer, move, key)
        self.assertEqual(limited[((ACE, 8), 6)].answer, Action.STAND)
        self.assertEqual(limited[((8, 8), 10)].answer, Action.SURRENDER)
        available = {Action.HIT, Action.STAND, Action.SURRENDER}
        self.assertTrue(all(q.legal_actions == available for q in limited.values()))
        self.assertTrue(all(q.answer in q.legal_actions for q in funded.values()))
        self.assertTrue(all(q.answer in q.legal_actions for q in limited.values()))

    def test_seed_reproduces_the_prefix_and_leaves_global_random_alone(self):
        before = random.getstate()
        prefix = list(practice_questions(10, 852))
        self.assertEqual(list(practice_questions(20, 852))[:10], prefix)
        self.assertNotEqual(list(practice_questions(10, 853)), prefix)
        self.assertEqual(random.getstate(), before)

    def test_invalid_settings_are_rejected_before_the_first_question(self):
        for key, values in (
            ("count", [0, False, 1.5]), ("seed", [False, "852"]), ("focus", [None, "unknown"]),
            ("bankroll", [0.5, -1, 1.1, True]), ("rules", [None]),
        ):
            for value in values:
                options = dict(count=1, seed=852)
                options[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    practice_questions(**options)
