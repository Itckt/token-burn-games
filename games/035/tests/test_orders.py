from unittest import TestCase

from pinchline.battle import Battle
from pinchline.render import frame
from pinchline.roster import CHARGE_CAP, COPPER, COPPER_DRAFT, INDIGO, INDIGO_DRAFT
from pinchline.series import Lineup, Matchup
from tests.helpers import arrange, cli


class OrderTests(TestCase):
    def test_three_orders_pick_three_different_targets_from_the_same_exchange(self):
        for order, target in [("weakest", "y"), ("nearest", "x"), ("charged", "z")]:
            with self.subTest(order=order):
                game, units = arrange({"B": (8, 5), "x": (9, 5), "y": (11, 5), "z": (10, 5)},
                                      copper_order=order)
                units["y"].hp = 2
                units["z"].charge = 3
                game.step()
                self.assertIn(f"B pulse -> {target} (3)", game.notes)
                self.assertEqual(units["B"].stats.pulses, 1)

    def test_nearest_uses_lane_distance_around_a_baffle_for_signatures(self):
        game, units = arrange({"B": (4, 2), "x": (6, 2), "y": (4, 5)}, copper_order="Nearest")
        units["x"].hp = 1
        units["B"].charge = CHARGE_CAP
        self.assertEqual(game.court.lane_distance((4, 2), (6, 2)), 4)
        game.step()
        self.assertIn("B Carbon Chorus -> y (5)", game.notes)
        self.assertEqual(units["x"].hp, 1)

    def test_charged_order_reads_sideline_boost_before_the_target_spends_it(self):
        game, units = arrange({"B": (8, 5), "x": (9, 5), "y": (11, 5)},
                              copper_order="charged", indigo_deck=("prime",))
        units["y"].hp = 1
        units["x"].charge = units["y"].charge = 2
        game.decks[INDIGO].ink = 1
        game.step()
        self.assertIn("Indigo plays prime -> x (+2 charge)", game.notes)
        self.assertIn("B pulse -> x (3)", game.notes)
        self.assertEqual((units["x"].charge, units["x"].stats.arts, units["y"].hp), (0, 1, 1))

    def test_highest_charge_out_of_range_cannot_deny_an_available_shot(self):
        for ready, expected in [(False, "B pulse -> x (3)"), (True, "B Carbon Chorus -> x (5)")]:
            with self.subTest(ready=ready):
                game, units = arrange({"B": (8, 5), "x": (10, 5), "z": (15, 5)}, copper_order="charged")
                units["z"].charge = CHARGE_CAP
                units["B"].charge = CHARGE_CAP if ready else 0
                game.step()
                self.assertIn(expected, game.notes)

    def test_charged_order_pursues_its_target_when_there_is_no_shot(self):
        for order, destination in [("weakest", (7, 5)), ("charged", (9, 5))]:
            with self.subTest(order=order):
                game, units = arrange({"B": (8, 5), "x": (13, 5), "y": (4, 5)}, copper_order=order)
                units["y"].hp = 1
                units["x"].charge = 3
                game.step()
                self.assertEqual(units["B"].pos, destination)

    def test_courier_priority_overrides_either_alternate_order(self):
        for order in ("charged", "nearest"):
            with self.subTest(order=order):
                game, units = arrange({"B": (8, 5), "x": (11, 5), "z": (8, 6)},
                                      mode="courier", copper_order=order)
                game.courier.loose_at = units["x"].pos
                game.courier.settle(game.fighters, game.zone)
                units["z"].hp, units["z"].charge = 1, 3
                game.step()
                self.assertIn("B pulse -> x (3)", game.notes)
                self.assertEqual(units["z"].hp, 1)

    def test_exact_ties_use_seeded_initiative_with_either_order(self):
        for order in ("nearest", "charged"):
            targets = set()
            for seed in range(16):
                game, units = arrange({"B": (8, 5), "x": (7, 5), "y": (9, 5)},
                                      seed=seed, copper_order=order)
                units["x"].hp = units["y"].hp = 12
                game.step()
                targets.update(n for n in game.notes if n.startswith("B pulse"))
            self.assertEqual(targets, {"B pulse -> x (3)", "B pulse -> y (3)"})

    def test_explicit_default_replays_the_house_order_without_extra_rng_draws(self):
        house = Battle(852)
        explicit = Battle(852, copper_order="WEAKEST", indigo_order="weakest")
        while house.result is None:
            self.assertEqual(frame(house), frame(explicit))
            house.step()
            explicit.step()
        self.assertEqual(frame(house), frame(explicit))
        self.assertEqual(house.rng.getstate(), explicit.rng.getstate())
        self.assertNotIn("Orders", frame(house))

    def test_orders_travel_with_the_lineup_in_both_the_engine_and_cli(self):
        fixture = Matchup(Lineup(COPPER_DRAFT, ("prime",), "charged"),
                          Lineup(INDIGO_DRAFT, (), "nearest"), mode="rail", court="galley")
        first, second = fixture.pairs(852, 1)
        self.assertEqual(first.battle.orders, {COPPER: "charged", INDIGO: "nearest"})
        self.assertEqual(second.battle.orders, {COPPER: "nearest", INDIGO: "charged"})
        self.assertEqual(list(second.battle.decks[INDIGO].remaining), ["prime"])
        result = cli("--pairs", "1", "--seed", "852", "--mode", "rail", "--court", "galley",
                     "--copper-order", "CHARGED", "--indigo-order", "nearest",
                     "--copper-deck", "prime", "--view", "final", "--report")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("targets charged", result.stdout)
        self.assertIn("Orders   Copper charged   Indigo nearest", result.stdout)
        self.assertIn("Orders   Copper nearest   Indigo charged", result.stdout)
        self.assertEqual(result.stdout.count("Push counts roller"), 2)

    def test_invalid_orders_fail_before_a_fixture_starts(self):
        with self.assertRaisesRegex(ValueError, "unknown targeting order"):
            Battle(3, indigo_order="pancake")
        result = cli("--pairs", "1", "--copper-order", "pancake")
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid choice", result.stderr)
        self.assertEqual(result.stdout, "")
