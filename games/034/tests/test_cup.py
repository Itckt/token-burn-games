import random
import unittest
from unittest.mock import patch

from gutterlight.battle import Mode, Outcome, Setup, Side
from gutterlight.cards import DECKS
from gutterlight.cup import Cup, Fixture, Standing, cup_table, run_cup
from gutterlight.pilot import simulate
from gutterlight.recording import document, load, reconstruct
from tests.support import cli, tape_folder


CUSTOM = "wick,bobbin,kiln,drum,ink,rivet,squall,patch"


class CupTests(unittest.TestCase):
    def test_every_pair_plays_both_seats_on_each_seed_including_wraparound(self):
        before = random.getstate()
        decks = ("awning", CUSTOM, "viaduct")
        seed = 2**32 - 1
        cup = run_cup(decks, seed, rounds=2, limit_ticks=12, mode=Mode.BEACON)
        expected = [(0, 1), (1, 0), (0, 2), (2, 0), (1, 2), (2, 1)]
        self.assertEqual([(g.amber, g.indigo) for g in cup.fixtures], expected * 2)
        self.assertEqual([g.seed for g in cup.fixtures], [seed] * 6 + [0] * 6)
        for fixture in cup.fixtures:
            match = simulate(Setup.deal(fixture.seed, 12, decks[fixture.amber],
                                        decks[fixture.indigo], mode=Mode.BEACON))
            self.assertEqual((fixture.tick, fixture.outcome), (match.tick, match.outcome))
        self.assertEqual(random.getstate(), before)
        self.assertIsNone(cup.selected_game)
        self.assertEqual(cup, run_cup(decks, seed, rounds=2, limit_ticks=12, mode=Mode.BEACON))

    def test_wins_follow_the_deck_across_seats_and_ties_share_places(self):
        decks = tuple(DECKS.values())
        draw = Outcome(None, "clock")
        amber = Outcome(Side.AMBER, "tower")
        indigo = Outcome(Side.INDIGO, "tower")
        games = tuple(Fixture(0, left, right, 10, outcome) for left, right, outcome in (
            (0, 1, draw), (1, 0, draw), (0, 2, amber), (2, 0, indigo),
            (1, 2, amber), (2, 1, indigo),
        ))
        cup = Cup(decks, Mode.CLASSIC, 10, games, None)
        self.assertEqual(cup.standings(), [Standing(0, 2, 2, 0), Standing(1, 2, 2, 0),
                                           Standing(2, 0, 0, 4)])
        table = cup_table(cup).splitlines()[-3:]
        self.assertEqual([line.split()[0] for line in table], ["1", "1", "3"])
        self.assertEqual([line.split()[-1] for line in table], ["8", "8", "0"])

    def test_identical_decks_are_distinct_entries_and_an_all_draw_cup_has_no_sole_winner(self):
        cup = run_cup(("awning", "awning"), 0, limit_ticks=1, keep_game=2)
        self.assertEqual(cup.standings(), [Standing(0, 0, 2, 0), Standing(1, 0, 2, 0)])
        self.assertEqual(cup.selected_game.frame().tick, 1)
        self.assertIn("1. Awning", cup_table(cup))
        self.assertIn("2. Awning", cup_table(cup))

    def test_invalid_seeds_rounds_entries_and_fixture_numbers_skip_simulation(self):
        with patch("gutterlight.cup.simulate", side_effect=AssertionError("Started a fixture")):
            for decks, seed, kwargs, message in (
                ((), 0, {}, "two deck"), (("viaduct",), 0, {}, "two deck"),
                (("awning", "unknown"), 0, {}, "Unknown deck"),
                (("awning", "trestle"), -1, {}, "Seed"),
                (("awning", "trestle"), 2**32, {}, "Seed"),
                (("awning", "trestle"), 0, {"rounds": 0}, "rounds"),
                (("awning", "trestle"), 0, {"rounds": True}, "rounds"),
                (("awning", "trestle"), 0, {"limit_ticks": 0}, "Match length"),
                (("awning", "trestle"), 0, {"keep_game": True}, "fixture number"),
                (("awning", "trestle"), 0, {"keep_game": 0}, "fixture number"),
                (("awning", "trestle"), 0, {"rounds": 2, "keep_game": 5}, "1 to 4"),
            ):
                with self.subTest(decks=decks, seed=seed, kwargs=kwargs):
                    with self.assertRaisesRegex(ValueError, message):
                        run_cup(decks, seed, **kwargs)

    def test_cli_defaults_to_preset_round_robin(self):
        result = cli("cup", "--seed", "0", "--seconds", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("6 fixtures", result.stdout)
        for preset in DECKS:
            self.assertIn(preset.title(), result.stdout)

    def test_cli_saves_exact_selected_fixture_for_scouting_and_practice(self):
        with tape_folder() as folder:
            path = folder / "cup fixture.json"
            result = cli("cup", "awning", CUSTOM, "--seed", 2**32 - 1, "--rounds", 2,
                         "--mode", "convoy", "--seconds", 35, "--save-game", 4, path)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(CUSTOM, result.stdout)
            self.assertIn(f"Saved replay to {path}", result.stdout)
            expected = simulate(Setup.deal(0, 70, CUSTOM, "awning", mode=Mode.CONVOY))
            self.assertEqual(load(path), reconstruct(document(expected)))
            self.assertEqual(list(folder.iterdir()), [path])
            for flags in (("replay", path, "--stats"), ("practice", path, "--auto", "--tick", "3")):
                result = cli(*flags)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(expected.outcome.text, result.stdout)

    def test_invalid_export_choices_preserve_an_existing_file(self):
        with tape_folder() as folder:
            path = folder / "existing.json"
            path.write_bytes(b"existing")
            for number in ("x", "0", "3"):
                with self.subTest(number=number):
                    result = cli("cup", "awning", "viaduct", "--save-game", number, path)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("fixture", result.stderr.lower())
                    self.assertNotIn("Traceback", result.stderr)
                    self.assertEqual(path.read_bytes(), b"existing")
