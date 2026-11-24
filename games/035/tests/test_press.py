from unittest import TestCase

from pinchline.battle import Outcome, STAMP_TARGET
from pinchline.render import frame, match_report
from pinchline.roster import COPPER, INDIGO
from tests.helpers import arrange, grid


class PressTests(TestCase):
    def test_a_majority_earns_one_stamp_and_credits_each_surviving_holder(self):
        game, units = arrange({"A": (8, 5), "B": (7, 5), "x": (9, 5)}, mode="press")
        game.step()
        self.assertEqual(game.stamps, {COPPER: 1, INDIGO: 0})
        self.assertEqual([units[t].stats.scoring_beats for t in "ABx"], [1, 1, 0])
        self.assertIn("Stamp", match_report(game))
        self.assertIn("Copper 1/5", frame(game))

    def test_equal_holders_contest_and_a_knocked_out_holder_cannot_score(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, mode="press")
        game.step()
        self.assertEqual(game.stamps, {COPPER: 0, INDIGO: 0})
        self.assertIn("Press contested   1 each.", game.notes)
        units["A"].hp = 1
        game.step()
        self.assertEqual(game.stamps, {COPPER: 0, INDIGO: 1})
        self.assertEqual(units["A"].stats.scoring_beats, 0)
        self.assertEqual(game.result, Outcome(INDIGO, "elimination"))

    def test_fold_closes_exposed_press_tiles_before_scoring(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, beat=39, mode="press")
        game.step()
        self.assertTrue(units["x"].alive)
        self.assertFalse(game.on_press(units["x"].pos))
        self.assertTrue(game.on_press(units["A"].pos))
        self.assertEqual(game.stamps, {COPPER: 1, INDIGO: 0})
        self.assertEqual(grid(frame(game))[5][7], "!")

    def test_fifth_stamp_precedes_bell_and_lower_stamp_total_loses_at_bell(self):
        for initial, reason in [(STAMP_TARGET - 1, "earned 5 stamps"), (0, "more stamps at the bell")]:
            with self.subTest(stamps=initial):
                game, units = arrange({"A": (8, 5), "x": (15, 5), "y": (14, 8)}, limit=1, mode="press")
                game.stamps[COPPER] = initial
                units["A"].hp = 1
                self.assertEqual(game.run(), Outcome(COPPER, reason))
                self.assertLess(game.score(COPPER), game.score(INDIGO))
