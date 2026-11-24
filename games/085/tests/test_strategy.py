import unittest

from blackjack.engine import ACE, Action
from blackjack.strategy import basic_strategy
from blackjack.table import DEFAULT_RULES, TableRules


UPCARDS = (2, 3, 4, 5, 6, 7, 8, 9, 10, ACE)
MOVES = {"H": Action.HIT, "S": Action.STAND, "D": Action.DOUBLE, "P": Action.SPLIT, "R": Action.SURRENDER}
HIT_STAND = frozenset({Action.HIT, Action.STAND})
WITH_DOUBLE = HIT_STAND | {Action.DOUBLE}
WITH_SPLIT = WITH_DOUBLE | {Action.SPLIT}


class BasicStrategyTests(unittest.TestCase):
    def assert_row(self, cards, legal, row, rules=DEFAULT_RULES):
        # Each column is a visible dealer card, from two through ace.
        for upcard, expected in zip(UPCARDS, row, strict=True):
            with self.subTest(cards=cards, upcard=upcard, legal=legal, rules=rules):
                self.assertEqual(basic_strategy(cards, upcard, legal, rules=rules), MOVES[expected])

    def test_hard_totals_against_every_upcard(self):
        rows = {
            **dict.fromkeys(range(4, 9), "HHHHHHHHHH"),
            9:  "HDDDDHHHHH",
            10: "DDDDDDDDHH",
            11: "DDDDDDDDDH",
            12: "HHSSSHHHHH",
            **dict.fromkeys(range(13, 17), "SSSSSHHHHH"),
            **dict.fromkeys(range(17, 21), "SSSSSSSSSS"),
        }
        for total, row in rows.items():
            first = min(10, total - 2)
            self.assert_row((first, total - first), WITH_DOUBLE, row)

    def test_soft_totals_against_every_upcard(self):
        rows = {
            ACE: "HHHHHHHHHH",  # A pair of aces when the split limit is reached.
            2:   "HHHDDHHHHH",
            3:   "HHHDDHHHHH",
            4:   "HHDDDHHHHH",
            5:   "HHDDDHHHHH",
            6:   "HDDDDHHHHH",
            7:   "SDDDDSSHHH",
            8:   "SSSSSSSSSS",
            9:   "SSSSSSSSSS",
        }
        for other, row in rows.items():
            self.assert_row((ACE, other), WITH_DOUBLE, row)

    def test_pairs_against_every_upcard(self):
        rows = {
            ACE: "PPPPPPPPPP",
            2:   "PPPPPPHHHH",
            3:   "PPPPPPHHHH",
            4:   "HHHPPHHHHH",
            5:   "DDDDDDDDHH",
            6:   "PPPPPHHHHH",
            7:   "PPPPPPHHHH",
            8:   "PPPPPPPPPP",
            9:   "PPPPPSPPSS",
            10:  "SSSSSSSSSS",
        }
        for rank, row in rows.items():
            self.assert_row((rank, rank), WITH_SPLIT, row)

    def test_hard_doubles_fall_back_to_hit_after_a_draw(self):
        for cards in ((2, 3, 4), (2, 3, 5), (2, 4, 5)):
            self.assert_row(cards, HIT_STAND, "HHHHHHHHHH")

    def test_soft_double_fallbacks(self):
        for other in (2, 3, 4, 5, 6):
            self.assert_row((ACE, ACE, other - 1), HIT_STAND, "HHHHHHHHHH")
        self.assert_row((ACE, 2, 5), HIT_STAND, "SSSSSSSHHH")
        self.assert_row((ACE, ACE, 7), HIT_STAND, "SSSSSSSSSS")

    def test_split_limit_falls_back_to_playing_the_total(self):
        self.assert_row((8, 8), WITH_DOUBLE, "SSSSSHHHHH")
        self.assert_row((6, 6), WITH_DOUBLE, "HHSSSHHHHH")
        self.assert_row((9, 9), WITH_DOUBLE, "SSSSSSSSSS")
        self.assert_row((ACE, ACE), WITH_DOUBLE, "HHHHHHHHHH")

    def test_hit_soft_17_double_rows_and_their_fallbacks(self):
        for das in (False, True):
            rules = TableRules(hit_soft_17=True, double_after_split=das)
            self.assert_row((5, 6), WITH_DOUBLE, "DDDDDDDDDD", rules)
            self.assert_row((5, 6), HIT_STAND, "HHHHHHHHHH", rules)
            self.assert_row((ACE, 7), WITH_DOUBLE, "DDDDDSSHHH", rules)
            self.assert_row((ACE, 7), HIT_STAND, "SSSSSSSHHH", rules)
            self.assert_row((ACE, 8), WITH_DOUBLE, "SSSSDSSSSS", rules)
            self.assert_row((ACE, 8), HIT_STAND, "SSSSSSSSSS", rules)

    def test_no_double_after_split_changes_four_pair_rows(self):
        rows = {2: "HHPPPPHHHH", 3: "HHPPPPHHHH", 4: "HHHHHHHHHH", 6: "HPPPPHHHHH"}
        for h17 in (False, True):
            rules = TableRules(hit_soft_17=h17, double_after_split=False)
            for rank, row in rows.items():
                for legal in (WITH_SPLIT, HIT_STAND | {Action.SPLIT}):
                    self.assert_row((rank, rank), legal, row, rules)
            self.assert_row((5, 5), WITH_SPLIT, "DDDDDDDDHH", rules)
            self.assert_row((8, 8), WITH_SPLIT, "PPPPPPPPPP", rules)

    def test_rule_switches_require_booleans(self):
        for options in ({"hit_soft_17": "no"}, {"double_after_split": 1}, {"late_surrender": 1}):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, "booleans"):
                TableRules(**options)

    def test_late_surrender_rows_and_split_eight_exceptions(self):
        for h17 in (False, True):
            for das in (False, True):
                rules = TableRules(hit_soft_17=h17, double_after_split=das, late_surrender=True)
                legal = WITH_DOUBLE | {Action.SURRENDER}
                self.assert_row((10, 5), legal, "SSSSSHHHRR" if h17 else "SSSSSHHHRH", rules)
                self.assert_row((10, 6), legal, "SSSSSHHRRR", rules)
                self.assert_row((10, 7), legal, "SSSSSSSSSR" if h17 else "SSSSSSSSSS", rules)
                self.assert_row((ACE, 5), legal, "HHDDDHHHHH", rules)
                self.assert_row((8, 8), frozenset(Action), "PPPPPPPPPR" if h17 else "PPPPPPPPPP", rules)
                self.assert_row((8, 8), HIT_STAND | {Action.SURRENDER}, "SSSSSHHRRR", rules)
                self.assert_row((10, 2, 4), HIT_STAND, "SSSSSHHHHH", rules)
