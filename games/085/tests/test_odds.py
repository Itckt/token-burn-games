from collections import Counter
from fractions import Fraction
from itertools import permutations
import unittest
from unittest.mock import patch

from blackjack.analysis import stand_odds
from blackjack.engine import play_round
from blackjack.table import ACE, Action, TableRules, is_blackjack, score
from tests.support import ScriptedShoe


class StandOddsTests(unittest.TestCase):
    def test_exact_fractions_match_every_physical_order_of_a_small_shoe(self):
        # Repeated ranks still represent distinct cards. The live engine deals each permutation.
        unseen = (ACE, 2, 4, 6, 10, 10)
        for cards, upcard in (((8, 8), ACE), ((10, 8), 10), ((ACE, 7), 6)):
            for h17 in (False, True):
                with self.subTest(cards=cards, upcard=upcard, h17=h17):
                    rules = TableRules(hit_soft_17=h17)
                    totals, payouts = Counter(), Counter()
                    naturals = 0
                    for order in permutations(unseen):
                        shoe = ScriptedShoe([cards[0], upcard, cards[1], *order])
                        played = play_round(shoe, lambda *_: Action.STAND, rules=rules)
                        if is_blackjack(played.dealer):
                            naturals += 1
                        else:
                            totals[score(played.dealer).total] += 1
                            payouts[played.net_units] += 1
                    deck = (*cards, upcard, *unseen)
                    with patch.multiple("blackjack.analysis", DECK=deck, DECKS=1):
                        odds = stand_odds(cards, upcard, rules=rules)

                    live = totals.total()
                    self.assertEqual(odds.blackjack_before_peek, Fraction(naturals, live + naturals))
                    self.assertEqual(odds.dealer_totals, {t: Fraction(totals[t], live) for t in range(17, 22)})
                    busts = sum(n for t, n in totals.items() if t > 21)
                    self.assertEqual(odds.dealer_bust, Fraction(busts, live))
                    expected = tuple(Fraction(payouts[x], live) for x in (1, 0, -1))
                    self.assertEqual((odds.win, odds.push, odds.loss), expected)
                    self.assertEqual(odds.expected_net, Fraction(payouts[1] - payouts[-1], live))

    def test_visible_cards_change_peek_probability_in_a_full_shoe(self):
        for cards, upcard, natural_cards in (
            ((10, 10), ACE, 94), ((ACE, ACE), 10, 22), ((8, 8), 10, 24), ((ACE, 7), 6, 0),
        ):
            with self.subTest(cards=cards, upcard=upcard):
                odds = stand_odds(list(cards), upcard)
                self.assertEqual(odds.cards, cards)
                self.assertEqual(odds.blackjack_before_peek, Fraction(natural_cards, 309))
                self.assertEqual(odds.win + odds.push + odds.loss, 1)
                self.assertTrue(all(isinstance(p, Fraction) and 0 < p < 1 for p in odds.dealer_totals.values()))

    def test_hard_sixteen_only_wins_on_a_bust_and_h17_changes_the_distribution(self):
        stand = stand_odds((10, 6), ACE)
        hit = stand_odds((10, 6), ACE, rules=TableRules(hit_soft_17=True))
        self.assertEqual(stand.push, 0)
        self.assertEqual(stand.win, stand.dealer_bust)
        self.assertLess(hit.dealer_totals[17], stand.dealer_totals[17])
        self.assertGreater(hit.dealer_bust, stand.dealer_bust)
        self.assertEqual(hit.blackjack_before_peek, stand.blackjack_before_peek)
        self.assertEqual(stand_odds((6, 10), ACE).dealer_totals, stand.dealer_totals)

    def test_invalid_openings_fail_before_enumeration(self):
        with patch("blackjack.analysis._opening_shoe") as shoe:
            for cards, upcard in (((ACE, 10), 2), ((3,), 2), ((False, 5), 8), ((9, 7), 11), ((5, 5), 6.0)):
                with self.subTest(cards=cards, upcard=upcard), self.assertRaises(ValueError):
                    stand_odds(cards, upcard)
            with self.assertRaisesRegex(ValueError, "rules"):
                stand_odds((9, 8), 6, rules=None)
            shoe.assert_not_called()
