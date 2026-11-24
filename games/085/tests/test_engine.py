from collections import Counter, deque
from itertools import combinations_with_replacement
from random import Random
import unittest

from blackjack.engine import ACE, Action, HandResult, Outcome, Shoe, play_round, score
from blackjack.strategy import basic_strategy
from blackjack.table import TableRules
from tests.support import ScriptedShoe


DEFAULT_PAIR_ACTIONS = frozenset({Action.HIT, Action.STAND, Action.DOUBLE, Action.SPLIT})


class ScoringTests(unittest.TestCase):
    def test_totals_match_enumerating_every_ace_valuation(self):
        for size in range(1, 6):
            for cards in combinations_with_replacement(range(1, 11), size):
                low = sum(cards)
                totals = [low + 10 * n for n in range(cards.count(ACE) + 1)]
                best = max((n for n in totals if n <= 21), default=low)
                self.assertEqual(score(cards), (best, best > low), cards)

    def test_ace_can_become_hard_after_a_hit(self):
        self.assertEqual(score((ACE, ACE, 9)), (21, True))
        self.assertEqual(score((ACE, ACE, 9, 10)), (21, False))
        self.assertEqual(score((ACE, ACE, 9, 10, 2)), (23, False))


class ShoeTests(unittest.TestCase):
    def test_full_shoe_has_six_decks_without_replacement(self):
        shoe = Shoe(Random(852))
        expected = {rank: 24 for rank in range(1, 10)}
        expected[10] = 96
        self.assertEqual(shoe.remaining, 312)
        self.assertEqual(Counter(shoe.draw() for _ in range(312)), expected)
        self.assertEqual(shoe.remaining, 0)

    def test_cut_card_only_reshuffles_at_a_round_boundary(self):
        for extra in (0, 5):
            with self.subTest(extra=extra):
                shoe = Shoe(Random(1))
                for _ in range(233):
                    shoe.draw()
                shoe.prepare_round()
                self.assertEqual(shoe.remaining, 79)
                for _ in range(1 + extra):
                    shoe.draw()
                self.assertEqual(shoe.remaining, 78 - extra)
                shoe.prepare_round()
                self.assertEqual(shoe.remaining, 312)

    def test_seed_repeats_the_sequence_including_later_shuffles(self):
        def two_shoes(seed):
            shoe = Shoe(Random(seed))
            first = [shoe.draw() for _ in range(312)]
            shoe.prepare_round()
            return first, [shoe.draw() for _ in range(312)]

        first, second = two_shoes(852)
        self.assertNotEqual(first, second)
        self.assertCountEqual(first, second)
        self.assertEqual((first, second), two_shoes(852))
        self.assertNotEqual(first, two_shoes(853)[0])


class RoundTests(unittest.TestCase):
    def deal(self, draws, *actions, **options):
        shoe = ScriptedShoe(draws)
        moves = deque(actions)

        def strategy(cards, upcard, legal):
            self.assertTrue(moves, f"Unexpected decision for {cards} against {upcard}")
            return moves.popleft()

        result = play_round(shoe, strategy, **options)
        self.assertEqual(shoe.preparations, 1)
        self.assertFalse(shoe.cards, f"Undealt cards {shoe.cards}")
        self.assertFalse(moves, f"Unused actions {moves}")
        return result

    def test_player_blackjack_pays_three_to_two_without_dealer_play(self):
        result = self.deal([ACE, 10, 10, 6])
        self.assertEqual(result.hands, (HandResult((ACE, 10), 1, Outcome.BLACKJACK),))
        self.assertEqual(result.net_units, 1.5)
        self.assertEqual(result.dealer, (10, 6))

    def test_both_blackjacks_push(self):
        result = self.deal([10, ACE, ACE, 10])
        self.assertEqual(result.hands[0].outcome, Outcome.PUSH)
        self.assertEqual(result.net_units, 0)

    def test_dealer_peek_precedes_splits_and_doubles(self):
        for draws in ([8, ACE, 8, 10], [5, 10, 6, ACE]):
            with self.subTest(draws=draws):
                result = self.deal(draws)
                self.assertEqual(result.hands[0].outcome, Outcome.LOSS)
                self.assertEqual(result.net_units, -1)

    def test_hit_to_twenty_one_wins_even_money(self):
        result = self.deal([7, 10, 4, 9, 10], Action.HIT)
        self.assertEqual(result.hands, (HandResult((7, 4, 10), 1, Outcome.WIN),))
        self.assertEqual(result.net_units, 1)

    def test_player_can_hit_again_after_a_soft_hand_turns_hard(self):
        result = self.deal([ACE, 10, 5, 7, 10, 2], Action.HIT, Action.HIT, Action.STAND)
        self.assertEqual(result.hands, (HandResult((ACE, 5, 10, 2), 1, Outcome.WIN),))

    def test_dealer_stands_on_both_soft_and_hard_seventeen(self):
        for upcard, hole in ((ACE, 6), (10, 7)):
            with self.subTest(upcard=upcard):
                result = self.deal([10, upcard, 8, hole], Action.STAND)
                self.assertEqual(result.dealer, (upcard, hole))
                self.assertEqual(result.net_units, 1)

    def test_dealer_hits_soft_then_hard_sixteen(self):
        result = self.deal([10, ACE, 8, 5, 10, 3], Action.STAND)
        self.assertEqual(result.dealer, (ACE, 5, 10, 3))
        self.assertEqual(result.net_units, -1)

    def test_equal_three_card_twenty_ones_push(self):
        result = self.deal([5, 7, 6, 4, 10, 10], Action.HIT)
        self.assertEqual(result.hands[0].outcome, Outcome.PUSH)
        self.assertEqual(result.net_units, 0)

    def test_live_hand_wins_when_dealer_busts(self):
        result = self.deal([10, 6, 2, 10, 10], Action.STAND)
        self.assertEqual(result.dealer, (6, 10, 10))
        self.assertEqual(result.net_units, 1)

    def test_bust_ends_round_without_extra_dealer_draws(self):
        result = self.deal([10, 6, 6, 10, 10], Action.HIT)
        self.assertEqual(result.dealer, (6, 10))
        self.assertEqual(result.hands[0].outcome, Outcome.LOSS)

    def test_double_draws_exactly_one_card_and_settles_two_units(self):
        cases = [
            ([6, 10, 5, 9, 10], Outcome.WIN, 2),
            ([5, 10, 6, 9, 2], Outcome.LOSS, -2),
            ([5, 10, 5, 7, 7], Outcome.PUSH, 0),
            ([10, 6, 6, 10, 10], Outcome.LOSS, -2),
        ]
        for draws, outcome, net in cases:
            with self.subTest(draws=draws):
                result = self.deal(draws, Action.DOUBLE)
                hand, = result.hands
                self.assertEqual((len(hand.cards), hand.wager, hand.outcome), (3, 2, outcome))
                self.assertEqual(result.net_units, net)

    def test_split_aces_get_one_card_each_even_if_another_ace_arrives(self):
        for left, right in ((ACE, 10), (10, ACE)):
            with self.subTest(left=left):
                result = self.deal([ACE, 6, ACE, 10, left, right, 3], Action.SPLIT)
                self.assertEqual([hand.cards for hand in result.hands], [(ACE, left), (ACE, right)])
                self.assertCountEqual([hand.outcome for hand in result.hands], [Outcome.WIN, Outcome.LOSS])
                self.assertEqual(result.net_units, 0)

    def test_split_hands_finish_left_first_and_can_double(self):
        result = self.deal([8, 6, 8, 10, 3, 9, 10, 3], Action.SPLIT, Action.DOUBLE, Action.STAND)
        self.assertEqual(result.hands, (
            HandResult((8, 3, 9), 2, Outcome.WIN),
            HandResult((8, 10), 1, Outcome.LOSS),
        ))
        self.assertEqual(result.net_units, 1)

    def test_mixed_split_hand_bust_loses_even_if_dealer_busts(self):
        result = self.deal([8, 6, 8, 10, 6, 10, 10, 10], Action.SPLIT, Action.HIT, Action.STAND)
        self.assertEqual(result.dealer, (6, 10, 10))
        self.assertEqual([hand.outcome for hand in result.hands], [Outcome.LOSS, Outcome.WIN])
        self.assertEqual(result.net_units, 0)

    def test_no_dealer_draw_after_all_split_hands_bust(self):
        result = self.deal([8, 6, 8, 10, 6, 10, 5, 10], Action.SPLIT, Action.HIT, Action.HIT)
        self.assertEqual(result.dealer, (6, 10))
        self.assertEqual(result.net_units, -2)

    def test_four_hand_limit_includes_already_completed_splits(self):
        pair_actions = []

        def split_if_possible(cards, upcard, legal):
            if cards == (8, 8):
                pair_actions.append(legal)
            return Action.SPLIT if Action.SPLIT in legal else Action.STAND

        shoe = ScriptedShoe([8, 6, 8, 10, 10, 8, 10, 8, 8, 8, 4])
        result = play_round(shoe, split_if_possible)
        self.assertFalse(shoe.cards)
        self.assertEqual([hand.cards for hand in result.hands], [(8, 10), (8, 10), (8, 8), (8, 8)])
        self.assertEqual([Action.SPLIT in legal for legal in pair_actions], [True, True, True, False, False])
        self.assertTrue(all(Action.DOUBLE in legal for legal in pair_actions))

    def test_strategy_sees_the_upcard_and_current_legal_moves(self):
        seen = []

        def hit_once(cards, upcard, legal):
            seen.append((cards, upcard, legal))
            return Action.HIT if len(cards) == 2 else Action.STAND

        play_round(ScriptedShoe([2, 6, 2, 10, 5, 4]), hit_once)
        self.assertEqual(seen, [
            ((2, 2), 6, DEFAULT_PAIR_ACTIONS),
            ((2, 2, 5), 6, frozenset({Action.HIT, Action.STAND})),
        ])

    def test_illegal_strategy_actions_fail_at_the_decision(self):
        cases = [
            ([8, 10, 9, 9], [Action.SPLIT]),
            ([3, 10, 4, 7, 2], [Action.HIT, Action.DOUBLE]),
            ([10, 9, 8, 9], ["stand"]),
        ]
        for draws, moves in cases:
            with self.subTest(moves=moves), self.assertRaisesRegex(ValueError, "Illegal action"):
                self.deal(draws, *moves)

    def test_hit_soft_17_rechecks_the_ace_after_each_draw(self):
        rules = TableRules(hit_soft_17=True)
        cases = (
            ([10, ACE, 8, 6, 10], (ACE, 6, 10), Outcome.WIN),
            ([10, ACE, 8, 5, ACE, ACE], (ACE, 5, ACE, ACE), Outcome.PUSH),
            ([10, 10, 8, 7], (10, 7), Outcome.WIN),
        )
        for draws, dealer, outcome in cases:
            with self.subTest(draws=draws):
                result = self.deal(draws, Action.STAND, rules=rules)
                self.assertEqual(result.dealer, dealer)
                self.assertEqual(result.hands[0].outcome, outcome)

    def test_hit_soft_17_skips_dealer_play_after_a_natural_or_player_bust(self):
        rules = TableRules(hit_soft_17=True)
        natural = self.deal([ACE, ACE, 10, 6], rules=rules)
        bust = self.deal([10, ACE, 6, 6, 9], Action.HIT, rules=rules)
        self.assertEqual((natural.dealer, bust.dealer), ((ACE, 6), (ACE, 6)))
        self.assertEqual((natural.net_units, bust.net_units), (1.5, -1))

    def test_no_double_after_split_keeps_opening_doubles_and_resplits(self):
        rules = TableRules(double_after_split=False)
        opening = self.deal([5, 10, 6, 9, 10], Action.DOUBLE, rules=rules)
        self.assertEqual(opening.net_units, 2)

        choices = []
        shoe = ScriptedShoe([8, 6, 8, 10, 8, 3, 10, 10, 3, 7, 3])
        result = play_round(shoe, rules=rules, on_decision=choices.append)
        self.assertFalse(shoe.cards)
        self.assertEqual([c.action for c in choices], [
            Action.SPLIT, Action.SPLIT, Action.HIT, Action.STAND, Action.HIT, Action.STAND,
        ])
        self.assertEqual([c.hand_number for c in choices], [1, 1, 1, 2, 3, 3])
        self.assertIn(Action.DOUBLE, choices[0].legal_actions)
        self.assertTrue(all(Action.DOUBLE not in c.legal_actions for c in choices[1:]))
        self.assertEqual([h.wager for h in result.hands], [1, 1, 1])
        self.assertEqual(result.net_units, -1)

    def test_default_and_explicit_bot_follow_the_selected_table(self):
        for args in ((), (basic_strategy,)):
            with self.subTest(args=args):
                result = play_round(
                    ScriptedShoe([5, ACE, 6, 9, 10]), *args, rules=TableRules(hit_soft_17=True),
                )
                self.assertEqual(result.hands, (HandResult((5, 6, 10), 2, Outcome.WIN),))
        choices = []
        play_round(
            ScriptedShoe([4, 6, 4, 10, 10, 10]), rules=TableRules(double_after_split=False),
            on_decision=choices.append,
        )
        self.assertEqual(choices[0].action, Action.HIT)
        self.assertIn(Action.SPLIT, choices[0].legal_actions)

    def test_one_unit_leaves_only_hit_and_stand(self):
        choices = []
        result = play_round(
            ScriptedShoe([8, 6, 8, 10, 5]), wager_limit=1, on_decision=choices.append,
        )
        self.assertEqual(result.hands, (HandResult((8, 8), 1, Outcome.LOSS),))
        self.assertEqual(choices[0].legal_actions, frozenset({Action.HIT, Action.STAND}))

    def test_unfinished_splits_and_busted_hands_keep_their_stakes(self):
        choices = []
        result = self.deal(
            [8, 6, 8, 10, 8, 10, 3, 9, 4],
            Action.SPLIT, Action.HIT, Action.HIT, Action.STAND,
            wager_limit=2, on_decision=choices.append,
        )
        self.assertEqual([c.hand_number for c in choices], [1, 1, 2, 2])
        self.assertEqual(choices[0].legal_actions, DEFAULT_PAIR_ACTIONS)
        self.assertTrue(all(c.legal_actions == {Action.HIT, Action.STAND} for c in choices[1:]))
        self.assertEqual([h.outcome for h in result.hands], [Outcome.LOSS, Outcome.PUSH])

    def test_split_hands_share_the_remaining_double_budget(self):
        choices = []
        result = self.deal(
            [8, 6, 8, 10, 3, 9, 8, 4], Action.SPLIT, Action.DOUBLE, Action.STAND,
            wager_limit=3, on_decision=choices.append,
        )
        self.assertEqual(choices[-1].legal_actions, {Action.HIT, Action.STAND})
        self.assertEqual([hand.wager for hand in result.hands], [2, 1])
        enough = self.deal(
            [8, 6, 8, 10, 3, 9, 3, 10, 4], Action.SPLIT, Action.DOUBLE, Action.DOUBLE,
            wager_limit=4,
        )
        self.assertEqual([hand.wager for hand in enough.hands], [2, 2])
        self.assertEqual(enough.net_units, 2)

    def test_unfunded_or_disallowed_actions_are_rejected_before_drawing(self):
        cases = (
            ([8, 6, 8, 10], [Action.SPLIT], {"wager_limit": 1}),
            ([5, 6, 6, 10], [Action.DOUBLE], {"wager_limit": 1}),
            ([8, 6, 8, 10, 3], [Action.SPLIT, Action.DOUBLE],
             {"rules": TableRules(double_after_split=False)}),
        )
        for draws, moves, options in cases:
            with self.subTest(moves=moves), self.assertRaisesRegex(ValueError, "Illegal action"):
                self.deal(draws, *moves, **options)

    def test_invalid_wager_limit_is_rejected_before_the_deal(self):
        shoe = ScriptedShoe([])
        for limit in (0, -1, 2.5, True):
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, "wager_limit"):
                play_round(shoe, wager_limit=limit)
        self.assertEqual(shoe.preparations, 0)

    def test_invalid_rules_and_callbacks_cannot_silently_settle_a_natural(self):
        for name, value in (("rules", False), ("strategy", None), ("on_decision", True)):
            shoe = ScriptedShoe([ACE, 9, 10, 7])
            with self.subTest(option=name), self.assertRaisesRegex(ValueError, name):
                play_round(shoe, **{name: value})
            self.assertEqual(shoe.preparations, 0)
            self.assertEqual(len(shoe.cards), 4)

    def test_late_surrender_settles_half_the_opening_wager_before_dealer_draws(self):
        choices = []
        result = self.deal(
            [10, ACE, 6, 5], Action.SURRENDER, rules=TableRules(late_surrender=True),
            wager_limit=1, on_decision=choices.append,
        )
        self.assertEqual(result.hands, (HandResult((10, 6), 1, Outcome.SURRENDER),))
        self.assertEqual(result.dealer, (ACE, 5))
        self.assertEqual((result.units_wagered, result.net_units), (1, -0.5))
        choice, = choices
        self.assertEqual(choice.action, Action.SURRENDER)
        self.assertEqual(choice.legal_actions, {Action.HIT, Action.STAND, Action.SURRENDER})

    def test_naturals_settle_before_late_surrender_is_offered(self):
        cases = (
            ([10, ACE, 6, 10], Outcome.LOSS), ([9, 10, 7, ACE], Outcome.LOSS),
            ([ACE, ACE, 10, 10], Outcome.PUSH), ([ACE, 10, 10, 7], Outcome.BLACKJACK),
        )
        for draws, expected in cases:
            with self.subTest(draws=draws):
                result = self.deal(draws, rules=TableRules(late_surrender=True))
                self.assertEqual(result.hands[0].outcome, expected)

    def test_surrender_is_illegal_when_disabled_after_a_hit_or_on_either_split_hand(self):
        enabled = TableRules(late_surrender=True)
        cases = (
            ([10, 9, 6, 10], TableRules(), ()),
            ([5, 9, 4, 10, 7], enabled, (Action.HIT,)),
            ([8, 10, 8, 9, 8], enabled, (Action.SPLIT,)),
            ([8, 10, 8, 9, 10, 8], enabled, (Action.SPLIT, Action.STAND)),
        )
        for draws, rules, actions in cases:
            with self.subTest(draws=draws), self.assertRaisesRegex(ValueError, "Illegal action"):
                self.deal(draws, *actions, Action.SURRENDER, rules=rules)
