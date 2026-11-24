import unittest

from gutterlight.battle import (
    BEACON_GOAL, FAR_TOWER, Lane, Mode, Move, Outcome, SIGNAL_TICKS, Side, TOWER_HP,
)
from gutterlight.display import board
from gutterlight.pilot import Pilot
from tests.support import arranged, place


AMBER, INDIGO = Side
ROOF, CANAL = Lane


class BeaconTests(unittest.TestCase):
    def test_one_charge_per_second_for_exclusive_control_of_the_lit_middle_three_cells(self):
        for side in Side:
            for cell in range(4, 9):
                with self.subTest(side=side, cell=cell):
                    game = arranged(mode=Mode.BEACON)
                    for _ in range(2):
                        place(game, side, ROOF, "clip", cell, move_at=99)
                    place(game, side.other, CANAL, "clip", 6, move_at=99)
                    before = game.frame()
                    for tick in range(1, 5):
                        game.step()
                        expected = tick // 2 if 5 <= cell <= 7 else 0
                        self.assertEqual(game.charge[side], expected)
                        self.assertEqual(game.charge[side.other], 0)
                    self.assertEqual(before.charge, (0, 0))

    def test_contested_zone_stays_level_even_with_more_friendly_units(self):
        game = arranged(mode=Mode.BEACON)
        for side, cell in ((AMBER, 5), (AMBER, 5), (INDIGO, 7)):
            place(game, side, ROOF, "clip", cell, move_at=99)
        for _ in range(4):
            game.step()
        self.assertEqual(game.charge, [0, 0])
        self.assertIn("Beacon ROOF (*) contested", board(game.frame(), "LIVE"))

    def test_sample_follows_movements_and_simultaneous_casualties(self):
        game = arranged(mode=Mode.BEACON)
        game.step()
        runner = place(game, AMBER, ROOF, "wick", 4, move_at=2)
        game.step()
        self.assertEqual((runner.cell, game.charge), (5, [1, 0]))
        for foe_hp, expected in ((7, [0, 0]), (8, [0, 1])):
            with self.subTest(foe_hp=foe_hp):
                game = arranged(mode=Mode.BEACON)
                game.step()
                place(game, AMBER, ROOF, "wick", 5, hp=7)
                place(game, INDIGO, ROOF, "wick", 6, hp=foe_hp)
                game.step()
                self.assertEqual(game.charge, expected)

    def test_signal_switch_scores_outgoing_lane_then_previews_incoming_lane(self):
        for limit in (SIGNAL_TICKS, SIGNAL_TICKS + 2):
            with self.subTest(limit=limit):
                game = arranged(mode=Mode.BEACON, limit=limit)
                for _ in range(SIGNAL_TICKS - 1):
                    game.step()
                place(game, AMBER, ROOF, "clip", 6, move_at=99)
                place(game, INDIGO, CANAL, "clip", 6, move_at=99)
                game.step()
                self.assertEqual(game.charge, [1, 0])
                screen = board(game.frame(), "REPLAY")
                if limit == SIGNAL_TICKS:
                    self.assertIn("Beacon ROOF (*) Amber holds", screen)
                else:
                    self.assertIn("Beacon CANAL (*) Indigo holds", screen)
                    game.step()
                    game.step()
                    self.assertEqual(game.charge, [1, 1])

    def test_quota_finishes_on_its_scoring_beat_including_at_the_time_limit(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged(mode=Mode.BEACON, limit=2 * BEACON_GOAL)
                for lane in Lane:
                    place(game, side, lane, "clip", 6, move_at=99)
                for _ in range(2 * BEACON_GOAL - 1):
                    game.step()
                    self.assertIsNone(game.outcome)
                self.assertEqual(game.charge[side], BEACON_GOAL - 1)
                game.step()
                self.assertEqual(game.outcome, Outcome(side, "beacon"))
                self.assertEqual(game.charge[side], BEACON_GOAL)

    def test_tower_fall_and_double_fall_take_priority_over_a_winning_charge(self):
        for double in (False, True):
            with self.subTest(double=double):
                game = arranged(mode=Mode.BEACON, limit=2)
                game.step()
                game.charge[AMBER] = BEACON_GOAL - 1
                place(game, AMBER, ROOF, "clip", 6, move_at=99)
                place(game, INDIGO, CANAL, "rivet", 1)
                game.towers[AMBER][CANAL].hp = 1
                if double:
                    place(game, AMBER, ROOF, "rivet", FAR_TOWER - 1)
                    game.towers[INDIGO][ROOF].hp = 1
                game.step()
                self.assertEqual(game.charge[AMBER], BEACON_GOAL)
                expected = Outcome(None, "double fall") if double else Outcome(INDIGO, "tower")
                self.assertEqual(game.outcome, expected)

    def test_clock_compares_charge_then_combined_hull_then_draws(self):
        for charge, hull, expected in (
            ((2, 1), 30, Outcome(AMBER, "beacon clock")),
            ((2, 2), 30, Outcome(INDIGO, "clock")),
            ((2, 2), TOWER_HP, Outcome(None, "beacon draw")),
        ):
            with self.subTest(charge=charge, hull=hull):
                game = arranged(mode=Mode.BEACON, limit=1)
                game.charge[:] = charge
                game.towers[AMBER][ROOF].hp = hull
                game.step()
                self.assertEqual(game.outcome, expected)
                self.assertIn(expected.text, board(game.frame(), "FINAL"))

    def test_classic_ignores_an_occupied_beacon_and_open_beacon_board_marks_the_zone(self):
        game = arranged()
        for lane in Lane:
            place(game, AMBER, lane, "clip", 6, move_at=99)
        for _ in range(2 * BEACON_GOAL):
            game.step()
        self.assertEqual(game.charge, [0, 0])
        self.assertIsNone(game.outcome)
        self.assertNotIn("Beacon", board(game.frame(), "LIVE"))
        screen = board(arranged(mode=Mode.BEACON).frame(), "LIVE")
        self.assertIn("Beacon ROOF (*) open", screen)
        self.assertEqual(next(line for line in screen.splitlines() if line.startswith("  Roof")).count("*"), 3)
        self.assertNotIn("*", next(line for line in screen.splitlines() if line.startswith("  Canal")))

    def test_pilot_can_spend_its_reserve_to_arrive_in_time_for_a_switch(self):
        hand = ("wick", "patch", "squall", "rivet")
        for side in Side:
            for tick, destination in ((0, ROOF), (SIGNAL_TICKS - 2, CANAL)):
                with self.subTest(side=side, tick=tick):
                    game = arranged(mode=Mode.BEACON, amber=hand, indigo=hand)
                    for _ in range(tick):
                        game.step()
                    game.players[side].energy = 2
                    self.assertEqual(Pilot(4, side).choose(game), Move(0, destination))
