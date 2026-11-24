import random
import unittest

from gutterlight.battle import Battle, FAR_TOWER, Lane, Move, Setup, Side, TOWER_HP
from gutterlight.cards import CARDS, DECKS, checked_deck, resolve_deck
from gutterlight.display import board, deck_sheet
from gutterlight.recording import document, reconstruct
from tests.support import arranged, place


CUSTOM = "wick,bobbin,kiln,drum,ink,rivet,squall,patch"


class DeckWorkshopTests(unittest.TestCase):
    def test_custom_decks_use_seeded_independent_deals_and_normalize_cli_keys(self):
        spec = " , ".join(CUSTOM.upper().split(","))
        before = random.getstate()
        a = Setup.deal(31, amber=spec, indigo="viaduct")
        b = Setup.deal(31, amber=CUSTOM, indigo=DECKS["viaduct"])
        self.assertEqual(a, b)
        self.assertEqual(a.opening[0], Setup.deal(31, amber=spec, indigo="awning").opening[0])
        self.assertCountEqual(a.opening[0], CUSTOM.split(","))
        self.assertCountEqual(a.opening[1], DECKS["viaduct"])
        self.assertEqual(resolve_deck(" VIADUCT "), DECKS["viaduct"])
        self.assertEqual(random.getstate(), before)

    def test_bad_deck_specs_explain_wrong_size_unknown_and_repeated_cards(self):
        for spec, message in (
            ("wick", "Unknown deck"), (CUSTOM + ",foil", "exactly eight"),
            ("wick,clip", "exactly eight"), (CUSTOM.replace("ink", "wick"), "Repeated card 'wick'"),
            (CUSTOM.replace("ink", "glass"), "Unknown card 'glass'"),
            (CUSTOM.replace("ink", ""), "Unknown card ''"),
        ):
            with self.subTest(spec=spec), self.assertRaisesRegex(ValueError, message):
                resolve_deck(spec)
        for malformed in (None, [None] * 8, [["wick"]] * 8):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                checked_deck(malformed)

    def test_mutating_the_input_decks_cannot_change_the_opening_or_invalidate_a_tape(self):
        decks = [list(keys) for keys in Setup.deal(7).opening]
        game = Battle(Setup(7, 90, decks))
        original = game.setup.opening
        decks[0].reverse()
        decks.clear()
        self.assertEqual(tuple(game.players[0].hand), original[0][:4])
        self.assertEqual(reconstruct(document(game)).setup.opening, original)
        for seed in (None, True, 0.5, "7"):
            with self.subTest(seed=seed), self.assertRaisesRegex(ValueError, "Seed"):
                Setup.deal(seed)

    def test_sheet_lists_the_deck_cost_curve_and_playable_names(self):
        keys = resolve_deck(CUSTOM)
        sheet = deck_sheet(keys)
        self.assertIn("Average cost  3.25 energy    Crews 6    Orders 2", sheet)
        self.assertIn("3 energy  ###  (3)", sheet)
        self.assertIn("5 energy  #  (1)", sheet)
        for key in keys:
            self.assertIn(key, sheet)
            self.assertIn(CARDS[key].name, sheet)
        self.assertNotIn("Foil Fencer", sheet)

    def test_next_draw_follows_each_sides_reserve_and_stays_private_in_live_play(self):
        game = arranged()
        opening = game.frame()
        self.assertEqual(opening.next_draw, ("ballast", "loom"))
        live = board(opening, "LIVE")
        self.assertIn("Next draw  Ballast Mule (5)", live)
        self.assertNotIn("Loom Tender", live)
        self.assertIn("Next draw  Loom Tender (4)", board(opening, "REPLAY", both_hands=True))
        game.step(Move(1, Lane.CANAL))
        self.assertEqual(game.players[Side.AMBER].hand[1], opening.next_draw[Side.AMBER])
        self.assertEqual(game.frame().next_draw, ("rivet", "loom"))
        self.assertEqual(opening.next_draw, ("ballast", "loom"))

    def test_bobbin_pair_deploys_two_ranged_attackers_for_one_order(self):
        game = arranged(amber=("bobbin",))
        foe = place(game, Side.INDIGO, Lane.ROOF, "ballast", 4, move_at=99)
        game.step(Move(0, Lane.ROOF))
        units = game.in_lane(Side.AMBER, Lane.ROOF)
        self.assertEqual([(u.card, u.cell, u.hp) for u in units], [("bobbin", 2, 17)] * 2)
        self.assertEqual(foe.hp, CARDS["ballast"].troop.hp - 8)
        self.assertEqual((game.players[0].energy, len(game.dispatches)), (2, 1))

    def test_kiln_kite_can_siege_just_outside_tower_range_on_either_side(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged()
                cell = side.other.base - 4 * side.direction
                kite = place(game, side, Lane.CANAL, "kiln", cell)
                for _ in range(4):
                    game.step()
                self.assertEqual((kite.hp, kite.cell), (24, cell))
                self.assertEqual(abs(kite.cell - side.other.base), 4)
                self.assertTrue(0 < kite.cell < FAR_TOWER)
                self.assertEqual(game.towers[side.other][Lane.CANAL].hp, TOWER_HP - 16)
