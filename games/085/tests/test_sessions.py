from dataclasses import replace
from fractions import Fraction
from random import Random
import unittest
from unittest.mock import patch

from blackjack.engine import ACE, Action, HandResult, Outcome, RoundResult, Shoe, play_round
from blackjack.report import format_replay, format_report
from blackjack.simulation import SimulationResult, Tally, UpcardStats, simulate
from blackjack.table import TableRules
from tests.support import ScriptedShoe


class SessionTests(unittest.TestCase):
    def scripted_session(self, draws, rounds, **options):
        shoe = ScriptedShoe(draws)
        with patch("blackjack.simulation.Shoe", return_value=shoe):
            result = simulate(rounds, seed=852, **options)
        self.assertEqual(shoe.preparations, result.rounds.total)
        self.assertFalse(shoe.cards, f"Undealt cards {shoe.cards}")
        return result

    def test_natural_funds_next_double_then_session_stops_with_half_a_unit(self):
        result = self.scripted_session(
            [ACE, 10, 10, 6, 5, 10, 6, 9, 2], 5, bankroll=1, replay_round=2,
        )
        self.assertEqual(result.rounds, Tally(1, 1, 0))
        self.assertEqual(result.paid_blackjacks, 1)
        self.assertEqual(result.units_wagered, 3)
        self.assertEqual(result.net_units, -0.5)
        self.assertEqual(result.peak_net_units, 1.5)
        self.assertEqual(result.max_drawdown, 2)
        self.assertEqual(result.ending_bankroll, Fraction(1, 2))
        self.assertEqual(result.replay.bankroll_before, Fraction(5, 2))
        self.assertEqual([d.action for d in result.replay.decisions], [Action.DOUBLE])
        self.assertIn("2 of 5 rounds dealt", format_report(result))

    def test_half_a_spare_unit_cannot_fund_a_double(self):
        result = self.scripted_session(
            [5, 10, 6, 9, 2, 10], 1, bankroll=1.5, replay_round=1,
        )
        self.assertEqual(result.replay.decisions[0].legal_actions, {Action.HIT, Action.STAND})
        self.assertEqual([d.action for d in result.replay.decisions], [Action.HIT, Action.HIT])
        self.assertEqual(result.units_wagered, 1)
        self.assertEqual(result.ending_bankroll, 0.5)
        self.assertNotIn("Session stopped", format_report(result))
        replay_text = format_replay(result.replay)
        self.assertIn("All player hands busted", replay_text)
        self.assertEqual(replay_text.splitlines()[-1], "Round net            -1 unit")

    def test_zero_funded_rounds_have_no_wager_or_rates(self):
        for amount in (0, Fraction(1, 2)):
            with self.subTest(amount=amount):
                result = self.scripted_session([], 4, bankroll=amount, replay_round=1)
                self.assertIsNone(result.replay)
                self.assertEqual(result.rounds.total, 0)
                self.assertEqual(result.units_wagered, 0)
                self.assertIsNone(result.return_on_wager)
                self.assertEqual(result.ending_bankroll, amount)
                self.assertEqual(result.max_drawdown, 0)
                self.assertIn("Net / total wagered  n/a", format_report(result))
        self.assertIn("Round win rate       n/a", format_report(SimulationResult(1)))

    def test_drawdown_uses_settled_rounds_and_the_initial_peak(self):
        result = SimulationResult(0)
        cases = [
            (2, Outcome.LOSS, 2), (1, Outcome.PUSH, 2), (1, Outcome.BLACKJACK, 2),
            (2, Outcome.LOSS, 2.5), (2, Outcome.WIN, 2.5), (2, Outcome.WIN, 2.5),
            (1, Outcome.LOSS, 2.5), (2, Outcome.LOSS, 3),
        ]
        for wager, outcome, expected_drawdown in cases:
            result.record(RoundResult((10, 7), (HandResult((9, 8), wager, outcome),)))
            self.assertEqual(result.max_drawdown, expected_drawdown)
        self.assertEqual(result.peak_net_units, 1.5)
        result.record(RoundResult((9, 9), (
            HandResult((8, 3, 2), 2, Outcome.LOSS), HandResult((8, 3, 9), 2, Outcome.WIN),
        )))
        self.assertEqual(result.max_drawdown, 3)

    def test_large_bankroll_preserves_half_unit_precision(self):
        whole = 2 ** 80
        start = whole + Fraction(1, 2)
        result = self.scripted_session([10, 9, 8, 9], 1, bankroll=start)
        self.assertEqual(result.ending_bankroll, start)
        self.assertIn(f"Ending bankroll      {whole:,}.5 units", format_report(result))

    def test_replay_of_an_opening_blackjack_never_invents_a_decision(self):
        for draws, net in (
            ([10, 9, ACE, 5], 1.5), ([10, ACE, ACE, 10], 0), ([5, 10, 6, ACE], -1),
        ):
            with self.subTest(draws=draws):
                replay = self.scripted_session(draws, 1, replay_round=1).replay
                self.assertEqual(replay.decisions, ())
                self.assertEqual(replay.result.net_units, net)
                self.assertIn("opening blackjack", format_replay(replay))

    def test_replay_of_split_aces_shows_only_the_split_and_even_money_win(self):
        replay = self.scripted_session([ACE, 6, ACE, 10, 10, ACE, 3], 1, replay_round=1).replay
        choice, = replay.decisions
        self.assertEqual((choice.cards, choice.upcard, choice.action), ((ACE, ACE), 6, Action.SPLIT))
        self.assertEqual(replay.result.dealer, (6, 10, 3))
        self.assertEqual([h.net_units for h in replay.result.hands], [1, -1])
        self.assertIn("[A 10] (soft 21)  win, wager 1, net +1", format_replay(replay))

    def test_replay_uses_custom_strategy_once_per_choice(self):
        calls = []

        def stand(cards, upcard, legal):
            calls.append((cards, upcard, legal))
            return Action.STAND

        result = self.scripted_session(
            [5, ACE, 6, 9], 1, rules=TableRules(hit_soft_17=True), strategy=stand, replay_round=1,
        )
        decision, = result.replay.decisions
        self.assertEqual(calls, [(decision.cards, decision.upcard, decision.legal_actions)])
        self.assertEqual(decision.action, Action.STAND)
        self.assertEqual(result.units_wagered, 1)

    def test_replay_after_reshuffle_matches_the_live_shoe_and_preserves_summary(self):
        seed, target = 852, 85
        rules = TableRules(hit_soft_17=True, double_after_split=False)
        options = dict(rules=rules, bankroll=400.5)
        baseline = simulate(150, seed, **options)
        result = simulate(150, seed, replay_round=target, **options)
        self.assertEqual(replace(result, replay=None), baseline)

        shoe = Shoe(Random(seed))
        balance = Fraction(801, 2)
        for _ in range(target - 1):
            played = play_round(shoe, rules=rules, wager_limit=int(balance))
            balance += Fraction(played.net_units)
        decisions = []
        played = play_round(shoe, rules=rules, wager_limit=int(balance), on_decision=decisions.append)
        self.assertEqual(result.replay.number, target)
        self.assertEqual(result.replay.result, played)
        self.assertEqual(result.replay.decisions, tuple(decisions))
        self.assertEqual(result.replay.bankroll_before, balance)

    def test_invalid_session_inputs(self):
        invalid = {
            "bankroll": [-1, -0.5, 0.25, True, "2", float("inf"), float("nan"), Fraction(1, 3)],
            "replay_round": [0, -1, 4, 1.5, True, "1"],
            "seed": [False, 2.5, "852", b"852"],
            "by_upcard": [0, 1, "yes", None],
        }
        for option, values in invalid.items():
            for value in values:
                with self.subTest(option=option, value=value), self.assertRaises(ValueError):
                    simulate(3, **{option: value})

    def test_unfunded_session_still_checks_strategy_and_table_before_shuffling(self):
        with patch("blackjack.simulation.Shoe") as shoe:
            for name, value in (("rules", None), ("strategy", "stand")):
                with self.subTest(option=name), self.assertRaisesRegex(ValueError, name):
                    simulate(2, seed=0, bankroll=0.5, **{name: value})
            shoe.assert_not_called()

    def test_surrender_refund_funds_the_next_round_and_the_replay_shows_the_settlement(self):
        result = self.scripted_session(
            [10, 10, 6, 9, 10, ACE, 6, 10], 3, bankroll=1.5, replay_round=1,
            rules=TableRules(late_surrender=True),
        )
        self.assertEqual(result.rounds, Tally(losses=2))
        self.assertEqual(result.hands, result.rounds)
        self.assertEqual((result.surrenders, result.units_wagered, result.max_drawdown), (1, 2, 1.5))
        self.assertEqual(result.ending_bankroll, 0)
        self.assertIn("Surrenders           1", format_report(result))
        replay = format_replay(result.replay)
        self.assertIn("[10 6] (16) -> surrender  (legal moves hit, stand, surrender)", replay)
        self.assertIn("Surrender returned half the opening stake.", replay)
        self.assertIn("surrender, wager 1, net -0.5", replay)
        self.assertNotIn("Dealer  [", replay)

    def test_upcard_groups_charge_all_split_stakes_to_one_round(self):
        result = self.scripted_session([
            8, 6, 8, 10, 3, 9, 10, 3,   # A doubled win and a single loss against six.
            10, 10, 6, 9,                # Surrender against ten.
            ACE, 10, 10, ACE,            # Two blackjacks push against ten.
            ACE, 6, 10, 9,               # A paid blackjack against six.
            8, ACE, 8, 10,               # Dealer blackjack before any split decision.
        ], 5, by_upcard=True, rules=TableRules(late_surrender=True))
        groups = result.by_upcard
        self.assertEqual(list(groups), [2, 3, 4, 5, 6, 7, 8, 9, 10, ACE])
        self.assertEqual(groups[6], UpcardStats(Tally(wins=2), 4, 2.5))
        self.assertEqual(groups[10], UpcardStats(Tally(losses=1, ties=1), 2, -0.5))
        self.assertEqual(groups[ACE], UpcardStats(Tally(losses=1), 1, -1))
        self.assertEqual(groups[2], UpcardStats())
        self.assertEqual(sum(g.rounds.total for g in groups.values()), result.rounds.total)
        self.assertEqual(sum(g.net_units for g in groups.values()), result.net_units)
        self.assertEqual(sum(g.units_wagered for g in groups.values()), result.units_wagered)

    def test_upcard_breakdown_preserves_a_seeded_session_including_its_replay(self):
        options = dict(seed=852, bankroll=300.5, replay_round=85, rules=TableRules(late_surrender=True))
        plain = simulate(150, **options)
        detailed = simulate(150, by_upcard=True, **options)
        self.assertIsNone(plain.by_upcard)
        self.assertEqual(replace(detailed, by_upcard=None), plain)
        for outcome in ("wins", "losses", "ties"):
            count = sum(getattr(g.rounds, outcome) for g in detailed.by_upcard.values())
            self.assertEqual(count, getattr(plain.rounds, outcome))

    def test_unfunded_session_lists_empty_upcard_groups_with_undefined_rates(self):
        result = self.scripted_session([], 5, by_upcard=True, bankroll=0.5)
        self.assertEqual(len(result.by_upcard), 10)
        self.assertTrue(all(group == UpcardStats() for group in result.by_upcard.values()))
        table = format_report(result).split("Rounds by dealer upcard\n")[1].splitlines()
        self.assertEqual(len(table), 11)
        for row in table[1:]:
            self.assertEqual(row.split()[1:], ["0", "0", "0", "0", "n/a", "0", "+0.0", "n/a"])

    def test_one_unit_wager_and_net_use_the_singular_in_the_summary(self):
        for draws, net in (([10, 9, 8, 8], "+1.0"), ([10, 9, 8, 10], "-1.0")):
            with self.subTest(draws=draws):
                report = format_report(self.scripted_session(draws, 1))
                self.assertIn("Total wagered        1 unit\n", report)
                self.assertIn(f"Net profit           {net} unit\n", report)
