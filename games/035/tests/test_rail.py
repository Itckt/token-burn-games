from unittest import TestCase

from pinchline.arena import COURTS, FOLD_INTERVAL
from pinchline.battle import Battle, Outcome
from pinchline.render import frame, match_report
from pinchline.roster import COPPER, INDIGO
from tests.helpers import arrange, grid


class RailTests(TestCase):
    def test_rail_fits_open_floor_and_shrinks_to_center_on_each_court(self):
        for key, radius in (("loop", 4), ("galley", 2), ("tramline", 4)):
            game = Battle(0, court=key, mode="rail")
            rail, court = game.rail, COURTS[key]
            cx, cy = court.center
            cells = grid(frame(game))
            self.assertEqual((cells[cy][cx - radius], cells[cy][cx], cells[cy][cx + radius]),
                             ("<", "@", ">"))
            self.assertEqual(cells[cy][cx + 1], ":")
            for level in range(court.last_fold + 1):
                with self.subTest(court=key, fold=level):
                    zone = court.zone_at(level * FOLD_INTERVAL)
                    rail.fold(zone)
                    span = min(radius, cx - zone.left)
                    expected = {(x, cy) for x in range(cx - span, cx + span + 1)}
                    self.assertEqual(set(rail.markers()), expected)
                    self.assertTrue(expected <= court.floor)
                    self.assertTrue(all(zone.contains(p) for p in expected))
            self.assertEqual(rail.markers(), {court.center: "@"})
            self.assertIsNone(rail.finished_by)

    def test_majority_moves_one_column_even_when_someone_stands_on_it(self):
        game, units = arrange({"A": (8, 5), "B": (7, 5), "x": (9, 5)}, mode="rail")
        game.step()
        self.assertEqual(game.rail.pos, units["x"].pos)
        self.assertEqual(game.rail.offset, 1)
        self.assertIsNone(game.rail.finished_by)
        self.assertEqual([units[t].stats.pushes for t in "ABx"], [1, 1, 0])
        self.assertNotIn(units["B"].pos, game.rail.escort_tiles)
        self.assertIn("Copper pushes the roller to +1.   A, B", game.notes)
        self.assertIn("Rail Run   Roller +1", frame(game))
        self.assertEqual(grid(frame(game))[5][9], "x")
        self.assertIn("Push counts roller pushes", match_report(game))

    def test_trying_to_join_the_escort_can_win_a_push_on_arrival(self):
        game, units = arrange({"A": (6, 5), "x": (15, 5)}, mode="rail")
        game.step()
        self.assertEqual(units["A"].pos, (7, 5))
        self.assertEqual((game.rail.offset, units["A"].stats.pushes), (1, 1))

    def test_roller_can_be_taken_back_across_center(self):
        game, units = arrange({"A": (1, 5), "x": (9, 5)}, mode="rail")
        game.rail.pos = (9, 5)
        game.step()
        self.assertEqual((game.rail.offset, game.rail.leader), (0, None))
        game.step()
        self.assertEqual((game.rail.offset, game.rail.leader), (-1, INDIGO))
        self.assertEqual(units["x"].stats.pushes, 2)

    def test_empty_escort_and_equal_crews_leave_the_roller_still(self):
        for occupied in (False, True):
            with self.subTest(occupied=occupied):
                positions = {"A": (8, 5), "x": (9, 5)} if occupied else {"A": (0, 0), "x": (16, 10)}
                game, _ = arrange(positions, mode="rail")
                game.step()
                self.assertEqual(game.rail.pos, game.court.center)
                self.assertEqual(sum(f.stats.pushes for f in game.fighters), 0)
                self.assertEqual("Roller contested   1 each." in game.notes, occupied)

    def test_a_fallen_escort_loses_the_vote_on_that_beat(self):
        game, units = arrange({"A": (8, 5), "B": (2, 2), "x": (9, 5)}, mode="rail")
        units["A"].hp = 4
        game.step()
        self.assertFalse(units["A"].alive)
        self.assertIsNone(game.result)
        self.assertEqual(game.rail.offset, -1)
        self.assertEqual((units["A"].stats.pushes, units["x"].stats.pushes), (0, 1))

    def test_contraction_moves_the_roller_before_plans_and_confers_no_win(self):
        game, _ = arrange({"A": (10, 5), "x": (9, 5)}, beat=29, mode="rail")
        game.rail.pos = (11, 5)
        game.step()
        self.assertEqual(game.notes[:2], ["Fold 6 closes in.", "The fold pulls the roller back to +2."])
        self.assertEqual(game.rail.pos, (game.rail.east, 5))
        self.assertIn("Roller contested   1 each.", game.notes)
        self.assertIsNone(game.rail.finished_by)
        self.assertIsNone(game.result)

    def test_fringe_neighbor_cannot_stall_a_push_at_the_shared_stop(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, beat=39, mode="rail")
        game.step()
        self.assertEqual(game.rail.west, game.rail.east)
        self.assertTrue(units["x"].alive)
        self.assertFalse(game.zone.contains(units["x"].pos))
        self.assertEqual((units["A"].stats.pushes, units["x"].stats.pushes), (1, 0))
        self.assertEqual(game.result, Outcome(COPPER, "pushed the roller to the far stop"))

    def test_elimination_precedes_finishing_push_and_finishing_push_precedes_bell(self):
        for enemy, reason in [((8, 4), "elimination"), ((11, 4), "pushed the roller to the far stop")]:
            with self.subTest(reason=reason):
                game, units = arrange({"A": (7, 4), "x": enemy}, court="galley", mode="rail", limit=1)
                game.rail.pos = (7, 4)
                units["x"].hp = 4
                self.assertEqual(game.run(), Outcome(COPPER, reason))
                self.assertEqual(game.rail.finished_by, COPPER)
                self.assertEqual(game.rail.pos, (8, 4))
                final = frame(game)
                game.step()
                self.assertEqual(frame(game), final)
                self.assertEqual(units["A"].stats.pushes, 1)

    def test_bell_compares_signed_position_before_survivors_and_hp(self):
        cases = [({"A": (8, 5), "x": (15, 5), "y": (14, 8)}, "A", COPPER),
                 ({"x": (8, 5), "A": (1, 5), "B": (2, 2)}, "x", INDIGO)]
        for positions, escort, team in cases:
            with self.subTest(team=team):
                game, units = arrange(positions, mode="rail", limit=1)
                units[escort].hp = 1
                self.assertEqual(game.run(), Outcome(team, "ahead on the rail at the bell"))
                self.assertEqual(game.score(team), (1, 1))
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, mode="rail", limit=1)
        units["A"].hp = units["x"].hp = 8
        self.assertEqual(game.run(), Outcome(None, "level on survivors and HP at the bell"))
        self.assertEqual(game.rail.offset, 0)

    def test_double_knockout_leaves_an_empty_roller_even_at_the_bell(self):
        game, units = arrange({"A": (8, 5), "x": (9, 5)}, mode="rail", limit=1)
        units["A"].hp = units["x"].hp = 4
        self.assertEqual(game.run(), Outcome(None, "double knockout"))
        self.assertEqual(sum(f.stats.pushes for f in game.fighters), 0)
