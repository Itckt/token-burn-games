from unittest import TestCase

from pinchline.battle import Battle
from pinchline.render import card_view, frame
from pinchline.roster import CHARGE_CAP, COPPER, INDIGO
from pinchline.tactics import CARDS, INK_CAP, Deck
from tests.helpers import arrange, cli


class DeckTests(TestCase):
    def test_patch_waits_at_full_ink_and_holds_up_every_card_behind_it(self):
        crew = Battle(11).fighters[:3]
        deck = Deck(("PATCH", "screen"))
        for _ in range(7):
            self.assertIsNone(deck.advance(crew))
        self.assertEqual((deck.ink, list(deck.remaining)), (INK_CAP, ["patch", "screen"]))
        crew[0].hp -= 7
        crew[1].hp -= 8
        self.assertEqual(deck.advance(crew), "plays patch -> B (+6 HP)")
        self.assertEqual(crew[1].hp, crew[1].hero.hp - 2)
        self.assertEqual((deck.ink, list(deck.remaining)), (0, ["screen"]))
        self.assertIsNone(deck.advance(crew))
        self.assertEqual(deck.advance(crew), "plays screen -> B (ward 4)")
        self.assertIsNone(deck.advance(crew))
        self.assertEqual((deck.ink, list(deck.remaining)), (0, []))

    def test_patch_caps_healing_breaks_ties_by_draft_order_and_skips_knockouts(self):
        a, b, c = Battle(8).fighters[:3]
        a.hp = 0
        b.hp -= 2
        c.hp -= 2
        deck = Deck(("patch",))
        deck.ink = 2
        self.assertEqual(deck.advance([a, b, c]), "plays patch -> B (+2 HP)")
        self.assertEqual((a.hp, b.hp, c.hp), (0, b.hero.hp, c.hero.hp - 2))

    def test_prime_waits_for_capacity_then_boosts_the_closest_to_ready(self):
        crew = Battle(8).fighters[:3]
        deck = Deck(("prime", "screen"))
        for fighter in crew:
            fighter.charge = CHARGE_CAP
        for _ in range(4):
            self.assertIsNone(deck.advance(crew))
        a, b, c = crew
        a.charge, b.charge = 1, CHARGE_CAP - 1
        self.assertEqual(deck.advance(crew), "plays prime -> B (+1 charge)")
        self.assertEqual((a.charge, b.charge, c.charge), (1, CHARGE_CAP, CHARGE_CAP))
        self.assertEqual((deck.ink, list(deck.remaining)), (1, ["screen"]))
        self.assertEqual((a.ward, b.ward, c.ward), (0, 0, 0))

    def test_screen_skips_full_and_stronger_wards_and_breaks_hp_ties_in_draft_order(self):
        crew = Battle(7).fighters[:3]
        a, b, c = crew
        a.hp, a.ward = 1, 5
        b.ward = c.ward = 4
        deck = Deck(("screen",))
        for _ in range(4):
            self.assertIsNone(deck.advance(crew))
        b.ward, c.ward = 2, 0
        self.assertEqual(deck.advance(crew), "plays screen -> B (ward 4)")
        self.assertEqual((a.ward, b.ward, c.ward), (5, 4, 0))

    def test_both_crews_can_prime_a_signature_before_the_same_locked_exchange(self):
        game, units = arrange({"B": (8, 5), "z": (10, 5)},
                              copper_deck=("prime",), indigo_deck=("prime",))
        b, z = units["B"], units["z"]
        b.charge = z.charge = 2
        game.decks[COPPER].ink = game.decks[INDIGO].ink = 1
        game.step()
        self.assertEqual(game.notes[:2], ["Copper plays prime -> B (+2 charge)",
                                          "Indigo plays prime -> z (+2 charge)"])
        self.assertEqual((b.stats.arts, z.stats.arts, b.charge, z.charge), (1, 1, 0, 0))
        self.assertEqual((b.hp, z.hp), (b.hero.hp - 4, z.hero.hp - 5))
        self.assertIn("Copper deck   Ink 0/3   spent", frame(game))

    def test_patch_precedes_hero_planning_and_separates_team_and_hero_healing(self):
        game, units = arrange({"A": (7, 5), "C": (6, 5), "x": (8, 5)}, copper_deck=("patch",))
        a, c = units["A"], units["C"]
        a.hp -= 5
        c.charge = CHARGE_CAP
        game.decks[COPPER].ink = 2
        game.step()
        self.assertEqual(a.hp, a.hero.hp - units["x"].hero.power)
        self.assertEqual((c.stats.healing, c.charge, c.stats.pulses), (0, CHARGE_CAP, 1))
        self.assertIn("Copper plays patch -> A (+5 HP)", game.notes)

    def test_screen_absorbs_incoming_damage_on_the_beat_it_is_played(self):
        game, units = arrange({"A": (7, 5), "x": (8, 5)}, copper_deck=("screen",))
        game.decks[COPPER].ink = 1
        game.step()
        a = units["A"]
        self.assertEqual((a.hp, a.ward, a.stats.blocked), (a.hero.hp, 0, 4))

    def test_empty_and_waiting_decks_leave_the_deal_and_combat_rng_alone(self):
        plain = Battle(123, limit=2)
        waiting = Battle(123, limit=2, copper_deck=("patch",))
        self.assertEqual(plain.decks, {})
        self.assertNotIn("deck", frame(plain))
        for _ in range(2):
            plain.step()
            waiting.step()
        self.assertEqual(plain.fighters, waiting.fighters)
        self.assertEqual(plain.result, waiting.result)
        self.assertEqual(plain.rng.getstate(), waiting.rng.getstate())

    def test_decks_are_per_match_and_copy_the_callers_card_order(self):
        cards = ["PRIME", "PATCH"]
        first = Battle(9, copper_deck=cards, indigo_deck=cards)
        second = Battle(9, copper_deck=cards)
        cards.reverse()
        for _ in range(2):
            first.step()
        self.assertEqual(list(first.decks[COPPER].remaining), ["patch"])
        self.assertEqual(list(first.decks[INDIGO].remaining), ["patch"])
        self.assertEqual((list(second.decks[COPPER].remaining), second.decks[COPPER].ink),
                         (["prime", "patch"], 0))

    def test_card_catalog_and_order_validation_through_the_cli(self):
        result = cli("--cards")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, card_view() + "\n")
        for name, card in CARDS.items():
            self.assertIn(name, result.stdout)
            self.assertIn(card.description, result.stdout)
        for args, message in [
            (("--copper-deck", "patch", "PATCH"), "three different cards"),
            (("--indigo-deck", "patch", "prime", "screen", "patch"), "three different cards"),
            (("--copper-deck", "quill"), "unknown sideline card"),
            (("--indigo-deck",), "expected at least one argument"),
        ]:
            with self.subTest(args=args):
                result = cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)
                self.assertEqual(result.stdout, "")
