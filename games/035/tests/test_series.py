import re
from io import StringIO
from unittest import TestCase
from unittest.mock import patch

from pinchline.__main__ import main
from pinchline.battle import Battle
from pinchline.roster import COPPER, COPPER_DRAFT, INDIGO, INDIGO_DRAFT
from pinchline.series import Lineup, Matchup
from tests.helpers import cli


class SeriesTests(TestCase):
    def test_return_leg_swaps_drafts_and_decks_on_the_exact_same_opening_pads(self):
        matchup = Matchup(Lineup(COPPER_DRAFT, ("screen", "patch")),
                          Lineup(INDIGO_DRAFT, ("prime",)), court="tramline", mode="courier", limit=12)
        legs = list(matchup.pairs(-1, 2))
        self.assertEqual([(leg.pair, leg.number, leg.battle.seed) for leg in legs],
                         [(1, 1, -1), (1, 2, -1), (2, 1, 0), (2, 2, 0)])
        for outward, back in (legs[:2], legs[2:]):
            left, right = outward.battle, back.battle
            self.assertEqual([f.pos for f in left.fighters], [f.pos for f in right.fighters])
            self.assertEqual([f.hero for f in left.fighters[:3]], [f.hero for f in right.fighters[3:]])
            self.assertEqual([f.hero for f in left.fighters[3:]], [f.hero for f in right.fighters[:3]])
            self.assertEqual((list(right.decks[COPPER].remaining), list(right.decks[INDIGO].remaining)),
                             (["prime"], ["screen", "patch"]))
            self.assertEqual((back.draft_on(COPPER), back.draft_on(INDIGO)), (INDIGO, COPPER))
            self.assertEqual((left.limit, right.limit), (12, 12))
            self.assertEqual(left.court.name, "Tramline Press")
            self.assertEqual(left.mode, right.mode)
            left.run()
            self.assertEqual((right.beat, right.decks[COPPER].ink), (0, 0))
            self.assertTrue(all(f.hp == f.hero.hp for f in right.fighters))

    def test_table_credits_wins_to_the_named_draft_on_either_side(self):
        args = ("--pairs", "2", "--seed", "852", "--limit", "1",
                "--copper", "Pleatram", "Tucklark", "Hushspool",
                "--indigo", "Darnlet", "Inkrill", "Vellumoth")
        result = cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("Copper draft wins (more HP at the bell)"), 4)
        self.assertIn("Copper draft wins 4   Indigo draft wins 0   Draws 0", result.stdout)
        self.assertTrue(result.stdout.endswith("Copper draft wins the series.\n"))
        self.assertNotIn("PINCHLINE SIX", result.stdout)
        self.assertEqual(cli(*args).stdout, result.stdout)

    def test_drawn_legs_count_once_and_do_not_break_a_tied_series(self):
        result = cli("--pairs", "2", "--limit", "1", "--seed", "6", "--indigo", *COPPER_DRAFT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Copper draft wins 0   Indigo draft wins 0   Draws 4", result.stdout)
        self.assertTrue(result.stdout.endswith("Series tied.\n"))

    def test_identical_lineups_split_a_decisive_pair(self):
        result = cli("--pairs", "1", "--seed", "852", "--indigo", *COPPER_DRAFT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Copper draft wins 1   Indigo draft wins 1   Draws 0", result.stdout)
        self.assertTrue(result.stdout.endswith("Series tied.\n"))

    def test_series_supports_final_or_full_frames_and_per_leg_reports(self):
        for view, count in [("final", 2), ("frames", 6)]:
            with self.subTest(view=view):
                args = ("--pairs", "1", "--seed", "0", "--limit", "2", "--mode", "courier",
                        "--court", "galley", "--report", "--view", view, "--copper-deck", "Prime")
                result = cli(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.count("PINCHLINE SIX   /   Galley Steps"), count)
                self.assertEqual(result.stdout.count("RESULT   "), 2)
                self.assertEqual(result.stdout.count("MATCH REPORT"), 2)
                self.assertIn("Copper plays prime", result.stdout)
                self.assertIn("Indigo plays prime", result.stdout)
                self.assertNotIn("\x1b", result.stdout)

    def test_generated_first_seed_replays_all_pairs(self):
        args = ("--pairs", "2", "--limit", "8", "--mode", "press", "--copper-deck", "screen")
        result = cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        seed = re.search(r"Pair 1  Leg 1   seed (\d+)", result.stdout)[1]
        replay = cli(*args, "--seed", seed)
        self.assertEqual(result.stdout, replay.stdout)

    def test_bad_pair_counts_and_drafts_fail_before_any_series_output(self):
        for args, message in [
            (("--pairs", "0"), "pair count must be positive"),
            (("--pairs", "-2"), "pair count must be positive"),
            (("--pairs", "1", "--indigo", "nobody", "inkrill", "darnlet"), "unknown hero"),
            (("--pairs", "1", "--indigo-deck", "nobody"), "unknown sideline card"),
        ]:
            with self.subTest(args=args):
                result = cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)
                self.assertEqual(result.stdout, "")

    def test_interrupted_series_names_the_unfinished_leg(self):
        with patch.object(Battle, "run", side_effect=KeyboardInterrupt), \
             patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(main(["--pairs", "2", "--seed", "11"]), 130)
        self.assertIn("Series stopped in pair 1, leg 1 after beat 0.", output.getvalue())
        self.assertNotIn("SERIES   Copper draft wins", output.getvalue())
