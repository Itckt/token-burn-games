import gc
import weakref
from random import Random
from unittest import TestCase

from pinchline.arena import (
    COURTS, EAST_MARKS, FLOOR, HEIGHT, LAST_FOLD, NEIGHBORS, TILES, WEST_MARKS,
    WIDTH, Court, lane_distance, next_step, zone_at,
)


class CourtTests(TestCase):
    def test_all_courts_have_two_reachable_mirrored_trios_of_pads(self):
        for key, court in COURTS.items():
            with self.subTest(court=key):
                self.assertEqual(court.tiles, tuple(row[::-1] for row in court.tiles[::-1]))
                self.assertTrue(all(len(row) == court.width for row in court.tiles))
                pads = set(court.west_marks + court.east_marks)
                self.assertEqual(len(pads), 6)
                self.assertTrue(pads <= court.floor)
                for tile in court.floor:
                    self.assertGreaterEqual(court.lane_distance(court.center, tile), 0)

    def test_cached_routes_are_released_with_their_court(self):
        practice = Court("Practice table", TILES, WEST_MARKS)
        reference = weakref.ref(practice)
        self.assertEqual(practice.lane_distance((1, 5), (3, 5)), 2)
        del practice
        gc.collect()
        self.assertIsNone(reference())

    def test_map_and_gate_symmetry(self):
        self.assertEqual(len(TILES), HEIGHT)
        self.assertTrue(all(len(row) == WIDTH for row in TILES))
        for x, y in FLOOR:
            self.assertIn((WIDTH - 1 - x, HEIGHT - 1 - y), FLOOR)
        self.assertEqual(len(set(WEST_MARKS + EAST_MARKS)), 6)
        for (x, y), opposite in zip(WEST_MARKS, EAST_MARKS):
            self.assertIn((x, y), FLOOR)
            self.assertEqual(opposite, (WIDTH - 1 - x, HEIGHT - 1 - y))

    def test_all_floor_is_reachable_and_neighbors_are_orthogonal(self):
        for tile in FLOOR:
            self.assertGreaterEqual(lane_distance(WEST_MARKS[0], tile), 0)
            for other in NEIGHBORS[tile]:
                self.assertIn(tile, NEIGHBORS[other])
                self.assertEqual(sum(abs(a - b) for a, b in zip(tile, other)), 1)

    def test_pulses_follow_lanes_around_walls(self):
        self.assertEqual(lane_distance((4, 2), (6, 2)), 4)
        self.assertEqual(lane_distance((6, 2), (4, 2)), 4)
        self.assertEqual(lane_distance((6, 2), (6, 2)), 0)
        self.assertEqual(lane_distance((4, 5), (6, 5)), 2)

    def test_walking_detours_around_an_occupied_tile(self):
        target = (4, 0)
        pos = (2, 0)
        steps = []
        rng = Random(852)
        while pos != target and len(steps) < 6:
            pos = next_step(pos, {(3, 0)}, lambda p: p[1] <= 1,
                            lambda p: lane_distance(p, target), rng)
            self.assertIsNotNone(pos)
            steps.append(pos)
        self.assertEqual(steps, [(2, 1), (3, 1), (4, 1), (4, 0)])

    def test_unreachable_goal_takes_shortest_improvement_or_holds(self):
        allowed = lambda p: p[1] == 0
        gap = lambda p: lane_distance(p, (5, 0))
        self.assertEqual(next_step((1, 0), {(3, 0)}, allowed, gap, Random(0)), (2, 0))
        self.assertIsNone(next_step((2, 0), {(3, 0)}, allowed, gap, Random(0)))
        self.assertIsNone(next_step((5, 0), set(), allowed, gap, Random(0)))


class FoldTests(TestCase):
    def test_opening_fringe_is_off_and_negative_beats_are_invalid(self):
        self.assertEqual(zone_at(0).damage, 0)
        self.assertEqual(zone_at(4).damage, 0)
        with self.assertRaisesRegex(ValueError, "negative"):
            zone_at(-1)

    def test_an_even_width_or_height_still_folds_to_one_open_tile(self):
        practice = Court("Practice table", ("........",) * 6, ((0, 0), (0, 2), (0, 4)))
        previous = practice.floor
        for beat in range(0, 26, 5):
            safe = {tile for tile in practice.floor if practice.zone_at(beat).contains(tile)}
            self.assertTrue(safe <= previous)
            self.assertIn(practice.center, safe)
            previous = safe
        self.assertEqual(previous, {practice.center})

    def test_first_contraction_uses_inclusive_edges(self):
        self.assertTrue(zone_at(4).contains((0, 0)))
        first = zone_at(5)
        self.assertEqual(first, zone_at(9))
        self.assertEqual((first.left, first.top, first.right, first.bottom), (1, 1, 15, 9))
        self.assertTrue(first.contains((1, 9)))
        self.assertTrue(first.contains((15, 1)))
        self.assertFalse(first.contains((0, 3)))
        self.assertEqual(first.damage, 3)
        self.assertEqual(zone_at(10).damage, 4)

    def test_gap_counts_steps_on_both_axes(self):
        zone = zone_at(10)
        self.assertEqual(zone.gap((8, 5)), 0)
        self.assertEqual(zone.gap((0, 1)), 3)
        self.assertEqual(zone.gap((16, 10)), 4)

    def test_zone_only_contracts_and_finishes_on_an_open_center(self):
        previous = FLOOR
        for beat in range(65):
            zone = zone_at(beat)
            safe = {p for p in FLOOR if zone.contains(p)}
            self.assertTrue(safe <= previous)
            self.assertTrue(safe)
            self.assertTrue(all(zone.gap(p) == 0 for p in safe))
            previous = safe
        self.assertEqual(previous, {(8, 5)})
        self.assertEqual(zone_at(40).level, LAST_FOLD)
        self.assertEqual(zone_at(40), zone_at(10000))
