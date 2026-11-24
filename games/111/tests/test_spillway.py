from collections import deque
from copy import deepcopy
import random
import unittest

from spillway import (
    Arrival, BROODS, CHARGE_MAX, DESIGNS, Enemy, FINAL_WAVE, GATE_MAX, Game,
    MEND_COST, PADS, PULSE_COST, Phase, RuleError, TRACK, Tower, footprint,
    pulse_power, reach_at, shell_strength, wave_plan,
)


def battle(*enemies, wave=1, **settings):
    """A running wave with its final arrivals already on the road."""
    return Game(phase=Phase.WAVE, wave=wave, enemies=list(enemies), **settings)


class LayoutAndTideTests(unittest.TestCase):
    def test_track_is_one_unbroken_route_past_eight_distinct_pads(self):
        self.assertEqual(TRACK[0], (0, 1))
        self.assertEqual(TRACK[-1], (14, 4))
        self.assertEqual(len(TRACK), len(set(TRACK)))
        for (x, y), (nx, ny) in zip(TRACK, TRACK[1:]):
            self.assertEqual(abs(x - nx) + abs(y - ny), 1)
        self.assertEqual(set(PADS), set("ABCDEFGH"))
        self.assertEqual(len(set(PADS.values())), 8)
        self.assertTrue(set(PADS.values()).isdisjoint(TRACK))

    def test_reaches_partition_the_entire_road_in_order(self):
        groups = [reach_at(i) for i in range(len(TRACK))]
        self.assertEqual(groups, sorted(groups))
        self.assertEqual(set(groups), {1, 2, 3})
        sizes = [groups.count(i) for i in (1, 2, 3)]
        self.assertLessEqual(max(sizes) - min(sizes), 1)

    def test_all_designs_on_every_pad_can_reach_water(self):
        for pad, (x, y) in PADS.items():
            for design in DESIGNS.values():
                for tier in design.tiers:
                    with self.subTest(pad=pad, design=design.name, radius=tier.radius):
                        cells = footprint(pad, tier.radius)
                        self.assertTrue(cells)
                        self.assertEqual(set(cells), {
                            i for i, (tx, ty) in enumerate(TRACK)
                            if abs(x - tx) + abs(y - ty) <= tier.radius
                        })

    def test_schedule_is_deterministic_ordered_and_bounded_in_overtime(self):
        for number in (1, 2, 4, 8, 10, 20, 99, 10000):
            with self.subTest(wave=number):
                plan = wave_plan(number)
                self.assertEqual(plan, wave_plan(number))
                beats = [a.beat for a in plan]
                self.assertEqual(beats[0], 1)
                self.assertEqual(beats, sorted(set(beats)))
                self.assertLessEqual(len(plan), 19)
                self.assertTrue(all(a.kind in BROODS for a in plan))
        self.assertEqual({a.kind for a in wave_plan(1)}, {"ripple"})
        self.assertIn("skate", [a.kind for a in wave_plan(2)])
        self.assertIn("ballast", [a.kind for a in wave_plan(4)])
        for number in (0, -1):
            with self.assertRaises(ValueError):
                wave_plan(number)

    def test_exactly_one_escorted_boss_on_every_tenth_wave(self):
        for number in range(1, 122):
            with self.subTest(wave=number):
                lineup = [a.kind for a in wave_plan(number)]
                self.assertEqual(lineup.count("crown"), int(number % 10 == 0))
                if "crown" in lineup:
                    self.assertNotIn("crown", (lineup[0], lineup[-1]))
        self.assertGreater(Enemy.arrive("crown", 20).hp, Enemy.arrive("crown", 10).hp)
        self.assertGreater(shell_strength(20), shell_strength(10))


class WorkshopTests(unittest.TestCase):
    def setUp(self):
        self.game = Game()

    def assert_rejected(self, operation, *args):
        snapshot = deepcopy(self.game)
        with self.assertRaises(RuleError):
            operation(*args)
        self.assertEqual(self.game, snapshot)

    def test_independent_new_watches(self):
        self.game.build("D", "loom")
        self.game.start_wave()
        self.game.tick()
        fresh = Game()
        self.assertFalse(fresh.towers or fresh.arrivals or fresh.enemies or fresh.fired)
        self.assertEqual((fresh.wave, fresh.gate, fresh.brass), (0, 12, 42))

    def test_build_costs_and_rejects_bad_orders_atomically(self):
        self.assert_rejected(self.game.build, "Z", "pin")
        self.assert_rejected(self.game.build, "C", "missing")
        self.game.build("C", "bell")
        self.assertEqual(self.game.brass, 18)
        self.assertEqual(self.game.towers["C"], Tower("bell"))
        self.assert_rejected(self.game.build, "C", "pin")
        self.assert_rejected(self.game.build, "A", "loom")
        self.assert_rejected(self.game.upgrade, "C")
        self.assert_rejected(self.game.upgrade, "A")
        self.assert_rejected(self.game.sell, "Z")
        self.assert_rejected(self.game.sell, "A")

    def test_all_upgrade_prices_stats_caps_and_sale_refunds(self):
        for kind, design in DESIGNS.items():
            for level in (1, 2, 3):
                with self.subTest(kind=kind, level=level):
                    self.game = Game(brass=200)
                    self.game.build("C", kind)
                    for _ in range(1, level):
                        self.game.upgrade("C")
                    tower = self.game.towers["C"]
                    self.assertEqual((tower.level, tower.tier), (level, design.tiers[level - 1]))
                    cost = sum(t.price for t in design.tiers[:level])
                    self.assertEqual(self.game.brass, 200 - cost)
                    if level == 3:
                        self.assert_rejected(self.game.upgrade, "C")
                    self.game.sell("C")
                    self.assertNotIn("C", self.game.towers)
                    self.assertEqual(self.game.brass, 200 - cost + cost * 3 // 4)
                    self.game.build("C", "pin")
                    self.assertEqual(self.game.towers["C"].level, 1)

    def test_mend_caps_gate_rejects_full_gate_and_insufficient_funds(self):
        self.assert_rejected(self.game.mend)
        self.game.gate = 8
        self.game.mend()
        self.assertEqual((self.game.gate, self.game.brass), (11, 42 - MEND_COST))
        self.game.mend()
        self.assertEqual(self.game.gate, GATE_MAX)
        self.game.gate, self.game.brass = 5, MEND_COST - 1
        self.assert_rejected(self.game.mend)

    def test_phase_guards_and_loaded_towers_on_launch(self):
        self.assert_rejected(self.game.tick)
        self.assert_rejected(self.game.pulse, 1)
        self.assert_rejected(self.game.continue_watch)
        self.game.build("A", "loom")
        self.game.towers["A"].cooldown = 1
        self.game.start_wave()
        self.assertEqual(self.game.phase, Phase.WAVE)
        self.assertEqual((self.game.wave, self.game.beat, self.game.towers["A"].cooldown), (1, 0, 0))
        self.assertEqual(tuple(self.game.arrivals), wave_plan(1))
        for operation, args in ((self.game.mend, ()), (self.game.build, ("B", "pin")),
                                (self.game.upgrade, ("A",)), (self.game.sell, ("A",)),
                                (self.game.start_wave, ()), (self.game.continue_watch, ())):
            self.assert_rejected(operation, *args)


class FireAndFlowTests(unittest.TestCase):
    def test_arrivals_and_half_cell_speeds(self):
        game = battle(arrivals=deque([Arrival(1, "ripple"), Arrival(2, "skate"), Arrival(2, "ballast")]))
        game.tick()
        self.assertEqual([(e.kind, e.distance) for e in game.enemies], [("ripple", 2)])
        game.tick()
        self.assertEqual([e.distance for e in game.enemies], [4, 3, 1])
        self.assertFalse(game.arrivals)

    def test_prioritizes_frontmost_in_range_then_earliest_arrival(self):
        behind, first, tied, outside = [Enemy("ripple", 12, d) for d in (2, 5, 5, 20)]
        game = battle(behind, first, tied, outside, towers={"A": Tower("pin")})
        game.tick()
        self.assertEqual([e.hp for e in game.enemies], [12, 8, 12, 12])
        self.assertEqual(game.fired, ["A"])

    def test_cooldown_interval_and_idle_tower_holds_its_shot(self):
        target = Enemy("ballast", 40, 0)
        game = battle(target, towers={"A": Tower("pin")})
        expected = [40, 40, 36, 36, 32, 32]
        for hp in expected:
            game.tick()
            self.assertEqual(target.hp, hp)

    def test_towers_retarget_within_a_beat_and_pay_each_bounty_once(self):
        a, b = Enemy("ballast", 1, 12), Enemy("ripple", 1, 11)
        game = battle(a, b, towers={"C": Tower("pin"), "B": Tower("pin")}, brass=0)
        game.tick()
        self.assertEqual(game.fired, ["B", "C"])
        self.assertEqual(game.kills, 2)
        self.assertEqual(game.brass, 3 + 1 + 6)
        self.assertEqual(game.phase, Phase.BUILD)

    def test_bell_splash_extends_beyond_coverage_but_respects_road_distance(self):
        # Pad A covers cells 1-3. Splash centred on 3 also hits 5 but misses 6.
        enemies = [Enemy("ballast", 20, 2 * i) for i in (1, 3, 5, 6)]
        game = battle(*enemies, towers={"A": Tower("bell")})
        game.tick()
        self.assertEqual([e.hp for e in enemies], [16, 16, 16, 20])
        self.assertEqual(game.towers["A"].cooldown, 3)

    def test_loom_slows_immediately_refreshes_and_wears_off(self):
        skate = Enemy("skate", 50, 2)
        game = battle(skate, towers={"A": Tower("loom")})
        for _ in range(3):
            game.tick()
        self.assertEqual((skate.distance, skate.slow, skate.hp), (8, 2, 46))
        game.towers.clear()
        for _ in range(3):
            game.tick()
        self.assertEqual((skate.distance, skate.slow), (15, 0))

    def test_slow_works_through_shell_and_cannot_freeze_a_heavy_forever(self):
        boss = Enemy.arrive("crown", 10)
        game = battle(boss, wave=10, towers={"A": Tower("loom")})
        for _ in range(4):
            game.tick()
        self.assertEqual((boss.hp, boss.shell), (BROODS["crown"].health(10), shell_strength(10) - 4))
        self.assertEqual(boss.distance, 2)

    def test_leaks_cost_gate_and_earn_no_bounty(self):
        end = 2 * len(TRACK) - 1
        game = battle(*(Enemy(kind, 30, end) for kind in ("ripple", "skate", "ballast")), brass=0)
        game.tick()
        self.assertEqual((game.gate, game.leaked, game.kills), (8, 3, 0))
        self.assertEqual((game.phase, game.cleared, game.brass), (Phase.BUILD, 1, 6))

    def test_fatal_leak_beats_clear_bonus_and_stops_the_clock(self):
        game = battle(Enemy("crown", 1, 2 * len(TRACK) - 1), wave=10, brass=0)
        game.tick()
        self.assertEqual((game.phase, game.gate, game.brass, game.cleared), (Phase.LOST, 0, 0, 0))
        with self.assertRaises(RuleError):
            game.tick()
        with self.assertRaises(RuleError):
            game.start_wave()

    def test_empty_road_between_arrivals_does_not_clear_the_wave(self):
        game = battle(arrivals=deque([Arrival(4, "ripple")]), brass=0)
        for _ in range(3):
            game.tick()
        self.assertEqual((game.phase, game.brass), (Phase.WAVE, 0))
        game.tick()
        self.assertEqual(len(game.enemies), 1)


class DischargeAndBossTests(unittest.TestCase):
    def test_shell_absorbs_only_its_remaining_strength(self):
        boss = Enemy("crown", 50, shell=7)
        boss.hit(5)
        self.assertEqual((boss.shell, boss.hp), (2, 50))
        boss.hit(5)
        self.assertEqual((boss.shell, boss.hp), (0, 47))
        boss.hit(5)
        self.assertEqual((boss.shell, boss.hp), (0, 42))

    def test_boss_regrows_one_shell_at_each_reach_boundary(self):
        game = Game(wave=9)
        game.start_wave()
        shells = []
        while game.phase is Phase.WAVE:
            game.tick()
            for boss in (e for e in game.enemies if e.kind == "crown"):
                if boss.shell:
                    shells.append((boss.reach, boss.shell))
                    boss.hit(boss.shell)
        self.assertEqual(shells, [(i, shell_strength(10)) for i in (1, 2, 3)])

    def test_pulse_only_hits_selected_reach_and_strips_shell_first(self):
        boss = Enemy.arrive("crown", 10)
        neighbor, distant = Enemy("ripple", 2), Enemy("skate", 10, 20)
        game = battle(boss, neighbor, distant, wave=10)
        game.pulse(1)
        self.assertEqual(boss.hp, BROODS["crown"].health(10) - pulse_power(10))
        self.assertEqual((boss.shell, distant.hp), (0, 10))
        self.assertEqual((game.enemies, game.kills, game.charge, game.beat), ([boss, distant], 1, 0, 0))

    def test_invalid_empty_and_unaffordable_pulses_preserve_state(self):
        game = battle(Enemy("ripple", 10), charge=PULSE_COST - 1)
        for reach in (0, 4, 2, 1):
            snapshot = deepcopy(game)
            with self.assertRaises(RuleError):
                game.pulse(reach)
            self.assertEqual(game, snapshot)

    def test_charge_refills_every_five_beats_and_caps(self):
        game = battle(Enemy("ballast", 100), charge=CHARGE_MAX - 2)
        for beat in range(1, 18):
            game.tick()
            self.assertEqual(game.charge, min(CHARGE_MAX, CHARGE_MAX - 2 + beat // 5))

    def test_last_kill_by_pulse_can_win_and_pay_out_only_once(self):
        game = battle(Enemy("crown", 1, shell=999), wave=FINAL_WAVE, brass=0)
        game.pulse(1)
        self.assertEqual((game.phase, game.cleared, game.crowns, game.kills), (Phase.WON, 20, 1, 1))
        self.assertEqual(game.brass, 10 + 6 + 20 // 3)
        with self.assertRaises(RuleError):
            game.pulse(1)
        with self.assertRaises(RuleError):
            game.start_wave()
        game.continue_watch()
        self.assertTrue(game.overtime)
        self.assertEqual(game.phase, Phase.BUILD)
        game.start_wave()
        self.assertEqual(game.wave, 21)

    def test_finishing_a_wave_carries_resources_and_reloads_towers(self):
        game = battle(Enemy("ripple", 1, 4), towers={"A": Tower("pin")}, brass=0, charge=5)
        game.tick()
        self.assertEqual((game.cleared, game.brass, game.charge, game.kills), (1, 7, 5, 1))
        game.start_wave()
        self.assertEqual((game.beat, game.leaked, game.wave, game.towers["A"].cooldown), (0, 0, 2, 0))
        self.assertFalse(game.fired)
        self.assertEqual((game.brass, game.charge, game.kills), (7, 5, 1))


class WaveAccountingTests(unittest.TestCase):
    def test_every_arrival_is_accounted_for_across_mixed_towers_and_pulses(self):
        # Fixed seeds explore clumps, leaks and shell breaks without a timing dependency.
        for number in (1, 7, 10, 20, 30, 49):
            with self.subTest(wave=number):
                rng = random.Random(number)
                pads = rng.sample(list(PADS), 4)
                game = Game(wave=number - 1, cleared=number - 1)
                for pad in pads:
                    game.towers[pad] = Tower(rng.choice(list(DESIGNS)), rng.randint(1, 3))
                game.start_wave()
                expected = len(game.arrivals)
                # Even a continually slowed heavy crosses a road cell in four beats.
                deadline = game.arrivals[-1].beat + 4 * len(TRACK)
                while game.phase is Phase.WAVE:
                    game.tick()
                    if game.phase is Phase.WAVE and game.enemies and game.charge >= PULSE_COST:
                        if rng.randrange(4) == 0:
                            game.pulse(rng.choice(game.enemies).reach)
                    accounted = len(game.arrivals) + len(game.enemies) + game.kills + game.leaked
                    self.assertEqual(accounted, expected)
                    self.assertLessEqual(game.beat, deadline)
                    self.assertTrue(0 <= game.gate <= GATE_MAX and 0 <= game.charge <= CHARGE_MAX)
                    for enemy in game.enemies:
                        self.assertGreater(enemy.hp, 0)
                        self.assertIn(enemy.cell, range(len(TRACK)))
