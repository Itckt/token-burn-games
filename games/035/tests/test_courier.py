from unittest import TestCase

from pinchline.arena import COURTS
from pinchline.battle import Battle, Outcome
from pinchline.render import frame, match_report
from pinchline.roster import CHARGE_CAP, COPPER, INDIGO
from tests.helpers import arrange, grid


class CourierTests(TestCase):
    def carrying(self, game, fighter):
        run = game.courier
        run.loose_at = fighter.pos
        run.settle(game.fighters, game.zone)
        self.assertIs(run.carrier, fighter)

    def test_opening_markers_and_mirrored_safe_gates_on_every_fold(self):
        for key, court in COURTS.items():
            game = Battle(0, mode="courier", court=key)
            run = game.courier
            cx, cy = court.center
            self.assertEqual(grid(frame(game))[cy][cx], "*")
            for beat in range(0, court.last_fold * 5 + 1, 5):
                with self.subTest(court=key, beat=beat):
                    game.zone = court.zone_at(beat)
                    run.fold(game.zone)
                    safe_row = sorted(p for p in court.floor if p[1] == cy and game.zone.contains(p))
                    west, east = run.gates[COPPER], run.gates[INDIGO]
                    self.assertEqual((west, east), (safe_row[0], safe_row[-1]))
                    self.assertEqual(west[0] + east[0], 2 * cx)
                    if west != east:
                        self.assertEqual((run.markers()[west], run.markers()[east]), ("<", ">"))
            self.assertEqual(west, east)
            self.assertEqual(run.markers()[west], "*")
            self.carrying(game, game.fighters[0])
            self.assertEqual(run.markers()[west], "=")

    def test_contested_pickup_has_one_surviving_owner(self):
        owners = set()
        for seed in range(12):
            game, _ = arrange({"A": (7, 5), "x": (9, 5)}, seed=seed, mode="courier")
            game.step()
            holder = game.courier.carrier
            owners.add(holder.team)
            self.assertEqual(holder.pos, game.court.center)
            self.assertIsNone(game.courier.loose_at)
            self.assertEqual(sum("picks up" in n for n in game.notes), 1)
            self.assertTrue(any("contested" in n for n in game.notes))
            self.assertIn(f"{holder.token} carries for {holder.team}", frame(game))
        self.assertEqual(owners, {COPPER, INDIGO})

    def test_courier_walks_instead_of_casting_and_an_ally_clears_its_gate(self):
        game, units = arrange({"A": (1, 5), "B": (0, 5), "x": (15, 5)}, mode="courier")
        carrier, escort = units["A"], units["B"]
        self.carrying(game, carrier)
        carrier.charge = CHARGE_CAP
        game.step()
        self.assertEqual(carrier.pos, (1, 5))
        self.assertNotEqual(escort.pos, (0, 5))
        game.step()
        self.assertEqual(carrier.pos, (0, 5))
        self.assertEqual((carrier.charge, carrier.stats.arts), (CHARGE_CAP, 0))
        self.assertEqual(game.result, Outcome(COPPER, "delivered the proof"))

    def test_pursuers_prefer_a_carrier_to_a_weaker_target(self):
        game, units = arrange({"B": (8, 5), "x": (11, 5), "z": (8, 6)}, mode="courier")
        self.carrying(game, units["x"])
        units["z"].hp = 1
        game.step()
        self.assertIn("B pulse -> x (3)", game.notes)
        self.assertEqual(units["z"].hp, 1)
        self.assertEqual(units["x"].hp, units["x"].hero.hp - 3)

    def test_pursuers_walk_toward_an_out_of_range_carrier(self):
        game, units = arrange({"B": (8, 5), "x": (13, 5), "y": (4, 5)}, mode="courier")
        self.carrying(game, units["x"])
        units["y"].hp = 1
        game.step()
        self.assertEqual(units["B"].pos, (9, 5))

    def test_delivery_requires_surviving_locked_hits_on_arrival(self):
        for health in (4, 5):
            with self.subTest(hp=health):
                game, units = arrange({"A": (1, 5), "x": (1, 4)}, mode="courier")
                self.carrying(game, units["A"])
                units["A"].hp = health
                game.step()
                self.assertEqual(units["A"].pos, game.courier.gates[COPPER])
                if health == 4:
                    self.assertEqual(game.result, Outcome(INDIGO, "elimination"))
                    self.assertIsNone(game.courier.delivered_by)
                    self.assertEqual(game.courier.loose_at, (0, 5))
                else:
                    self.assertEqual(game.result, Outcome(COPPER, "delivered the proof"))
                    self.assertEqual(units["A"].hp, 1)
                final = frame(game)
                game.step()
                self.assertEqual(frame(game), final)

    def test_safe_drop_stays_available_for_the_opposing_crew(self):
        game, units = arrange({"A": (1, 5), "B": (15, 5), "x": (1, 4)}, mode="courier")
        self.carrying(game, units["A"])
        units["A"].hp = 1
        game.step()
        self.assertIsNone(game.result)
        self.assertIsNone(game.courier.carrier)
        self.assertEqual(grid(frame(game))[5][0], "*")
        for _ in range(2):
            game.step()
        self.assertIs(game.courier.carrier, units["x"])
        self.assertIsNone(game.courier.delivered_by)

    def test_fold_returns_a_loose_proof_before_planning(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, beat=4, mode="courier")
        game.courier.loose_at = (0, 5)
        game.step()
        self.assertIn("The fold returns the loose proof to center.", game.notes)
        self.assertIs(game.courier.carrier, units["A"])
        self.assertEqual(units["A"].pos, (8, 5))

    def test_fringe_knockout_returns_the_proof_to_a_survivor_at_center(self):
        game, units = arrange({"A": (0, 0), "B": (8, 5), "x": (9, 5)}, beat=4, mode="courier")
        self.carrying(game, units["A"])
        units["A"].hp, units["A"].ward = 3, 5
        game.step()
        self.assertFalse(units["A"].alive)
        self.assertIs(game.courier.carrier, units["B"])
        self.assertTrue(any("returns to center" in n for n in game.notes))

    def test_shared_gate_requires_a_beat_of_possession_before_delivery(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, beat=39, mode="courier")
        game.step()
        self.assertIsNone(game.result)
        self.assertIs(game.courier.carrier, units["A"])
        self.assertEqual(game.courier.gates[COPPER], game.courier.gates[INDIGO])
        game.step()
        self.assertEqual(game.result, Outcome(COPPER, "delivered the proof"))
        self.assertTrue(units["x"].alive)
        self.assertEqual(units["A"].stats.carry_beats, 2)
        self.assertIn("Carry counts beats", match_report(game))

    def test_bell_prefers_possession_then_uses_normal_scores_if_loose(self):
        game, units = arrange({"A": (7, 5), "x": (15, 5), "y": (14, 8)}, limit=1, mode="courier")
        units["A"].hp = 1
        self.assertEqual(game.run(), Outcome(COPPER, "holding the proof at the bell"))
        game, units = arrange({"A": (2, 5), "x": (14, 5)}, limit=1, mode="courier")
        units["A"].hp = units["x"].hp = 8
        self.assertEqual(game.run(), Outcome(None, "level on survivors and HP at the bell"))

    def test_delivery_and_elimination_on_the_same_beat(self):
        game, units = arrange({"A": (1, 5), "B": (8, 5), "x": (9, 5)}, mode="courier")
        self.carrying(game, units["A"])
        units["x"].hp = 1
        game.step()
        self.assertIs(game.courier.delivered_by, units["A"])
        self.assertEqual(game.result, Outcome(COPPER, "elimination"))
