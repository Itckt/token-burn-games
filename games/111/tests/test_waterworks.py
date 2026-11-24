from copy import deepcopy
import re
import unittest

from spillway import (
    Enemy, Game, PADS, Phase, REACH_STARTS, RuleError, Tower, rehearse, shell_strength,
)
from tests.test_spillway import battle
from watchboard import drill_view, frame, guide, pad_view, report_view, sluice_view
from weirlight import order


class WickcoilTests(unittest.TestCase):
    def test_each_tier_links_past_its_footprint_and_stops_at_its_limit(self):
        for level, power, limit in ((1, 3, 2), (2, 5, 3), (3, 7, 4)):
            with self.subTest(level=level):
                enemies = [Enemy("ballast", 30, d) for d in (2, 8, 14, 20, 26)]
                enemies[0].hp = 100
                tower = Tower("coil", level, aim="heavy")
                hits = tower.fire("A", enemies)
                self.assertEqual(hits, enemies[:limit])
                self.assertEqual([e.hp for e in enemies],
                                 [100 - power] + [30 - power] * (limit - 1) + [30] * (5 - limit))
                self.assertIn(f"Up to {limit} linked targets",
                              pad_view(Game(towers={"A": tower}), "A", None))

    def test_link_uses_nearest_half_cell_then_front_then_first_arrival(self):
        start = Enemy("ripple", 30, 5)
        rear = Enemy("ripple", 10, 3)
        first, tied = Enemy("ripple", 10, 7), Enemy("ripple", 10, 7)
        dead = Enemy("ripple", 0, 5)
        nearest = Enemy("ripple", 10, 4)
        pool = [rear, dead, first, tied, start]
        self.assertIs(start.chain_targets(pool + [nearest], 2)[1], nearest)
        hits = start.chain_targets(pool, 3)
        self.assertIs(hits[1], first)
        self.assertIs(hits[2], tied)

    def test_dead_units_cannot_bridge_a_gap_and_a_half_cell_too_far_breaks_it(self):
        start, far = Enemy("ballast", 80, 4), Enemy("ripple", 20, 11)
        dead = Enemy("ripple", 0, 7)
        tower = Tower("coil", 3, aim="heavy")
        self.assertEqual(tower.fire("A", [start, dead, far]), [start])
        far.distance -= 1
        self.assertEqual(tower.fire("A", [start, dead, far]), [start, far])
        self.assertEqual(far.hp, 13)
        self.assertEqual(tower.fire("H", [far]), [])

    def test_echo_conducts_through_identical_stacked_units_once_each(self):
        enemies = [Enemy("ripple", 7, 4) for _ in range(4)]
        enemies.append(Enemy("crown", 80, 10, shell=11))
        game = battle(*enemies, towers={"A": Tower("coil", 3, cooldown=1)}, brass=0)
        game.play_signal("k")
        self.assertEqual((game.beat, game.towers["A"].cooldown), (0, 1))
        self.assertEqual((game.enemies, game.brass, game.kills), ([enemies[-1]], 4, 4))
        row = game.pad_reports["A"]
        self.assertEqual((row.shots, row.hits, row.kills), (1, 4, 4))
        self.assertEqual([e.hp for e in enemies], [0, 0, 0, 0, 80])

    def test_link_damage_hits_shell_and_finishing_echo_settles_once(self):
        boss, link = Enemy("crown", 3, 4, shell=2), Enemy("skate", 5, 10)
        game = battle(boss, link, wave=20, towers={"A": Tower("coil", 2)}, rush=True, brass=0)
        game.play_signal("k")
        self.assertEqual((boss.hp, boss.shell, link.hp), (0, 0, 0))
        self.assertEqual((game.phase, game.crowns, game.brass), (Phase.WON, 1, 35))
        with self.assertRaises(RuleError):
            game.play_signal("k")
        self.assertEqual(game.brass, 35)


class SluiceTests(unittest.TestCase):
    def test_push_respects_half_cells_reach_edges_mass_and_shells(self):
        for reach, cell in enumerate(REACH_STARTS, 1):
            with self.subTest(reach=reach):
                start = cell * 2
                enemies = [Enemy(kind, 30, start + offset, slow=2, shell=shell)
                           for kind, offset, shell in (
                               ("ripple", 0, 0), ("skate", 1, 0), ("ripple", 9, 0),
                               ("ballast", 5, 0), ("crown", 5, 0), ("crown", 5, 1))]
                other = Enemy("skate", 10, 2 * REACH_STARTS[reach % 3] + 5)
                before_other = deepcopy(other)
                game = battle(*enemies, other, wave=10, sluice=reach, charge=0)
                game.vent()
                self.assertEqual([e.distance - start for e in enemies], [0, 0, 3, 3, 3, 5])
                self.assertEqual([e.slow for e in enemies], [2] * 6)
                self.assertTrue(all(e.hp == 30 and e.reach == reach for e in enemies))
                self.assertEqual((game.vented, game.charge, game.beat, game.kills), (4, 0, 0, 0))
                self.assertEqual(other, before_other)
                snapshot = deepcopy(game)
                with self.assertRaises(RuleError):
                    game.vent()
                self.assertEqual(game, snapshot)

    def test_an_empty_anchored_or_unarmed_reach_keeps_the_release(self):
        for reach, enemies in ((None, [Enemy("ripple", 2, 4)]), (1, []),
                               (1, [Enemy("skate", 15, 0), Enemy("ballast", 30, 20)]),
                               (1, [Enemy("crown", 20, 6, shell=1)])):
            with self.subTest(reach=reach, enemies=enemies):
                game = battle(*enemies, sluice=reach)
                before = deepcopy(game)
                with self.assertRaises(RuleError):
                    game.vent()
                self.assertEqual(game, before)

    def test_stripping_a_boss_allows_a_push_without_regrowing_its_shell(self):
        start = 2 * REACH_STARTS[1]
        boss = Enemy("crown", 100, start + 1, shell=11)
        game = battle(boss, wave=10, sluice=2)
        with self.assertRaises(RuleError):
            game.vent()
        game.pulse(2)
        game.vent()
        self.assertEqual((boss.distance, boss.hp, boss.shell, game.charge), (start, 89, 0, 0))
        while boss.distance < 2 * REACH_STARTS[2] - 1:
            game.tick()
            self.assertEqual(boss.shell, 0)
        game.tick()
        self.assertEqual((boss.reach, boss.shell), (3, shell_strength(10)))

    def test_setting_is_free_and_persists_but_the_release_refreshes_at_launch(self):
        game = Game()
        with self.assertRaises(RuleError):
            game.vent()
        order(game, "sLuIcE 1")
        self.assertEqual((game.sluice, game.brass), (1, 42))
        order(game, "rush")
        before = deepcopy(game)
        for line in ("sluice 2", "sluice off", "v"):
            with self.assertRaises(RuleError):
                order(game, line)
            self.assertEqual(game, before)
        order(game, "step")
        order(game, "vent")
        self.assertEqual(game.vented, 2)
        order(game, "run")
        self.assertIn("Sluice moved 2", report_view(game))
        order(game, "go")
        self.assertEqual((game.sluice, game.vented), (1, 0))
        order(game, "step")
        order(game, "V")
        self.assertEqual(game.vented, 1)
        order(game, "run")
        order(game, "sluice off")
        self.assertIsNone(game.sluice)

    def test_non_integer_reaches_are_rejected_before_mutating_the_watch(self):
        for reach in (True, False, 1.0, 2.0, 0, 4, "1"):
            with self.subTest(reach=reach):
                shop = Game()
                with self.assertRaises(RuleError):
                    shop.set_sluice(reach)
                self.assertEqual(shop, Game())
                game = battle(Enemy("ripple", 1, 2))
                snapshot = deepcopy(game)
                with self.assertRaises(RuleError):
                    game.pulse(reach)
                self.assertEqual(game, snapshot)


class DrillTests(unittest.TestCase):
    def test_two_previews_match_the_real_wave_with_and_without_a_release(self):
        game = Game()
        for cmd in ("build B coil", "build A pin", "sluice 1"):
            order(game, cmd)
        before = deepcopy(game)
        for rush in (False, True):
            for beat in (None, 7):
                with self.subTest(rush=rush, beat=beat):
                    result = rehearse(game, rush=rush, vent_beat=beat)
                    actual = deepcopy(game)
                    order(actual, "rush" if rush else "go")
                    first_leak = None
                    while actual.phase is Phase.WAVE:
                        actual.tick()
                        if actual.leaked and first_leak is None:
                            first_leak = actual.beat
                        if actual.beat == beat:
                            order(actual, "v")
                    self.assertEqual((result.watch, result.first_leak), (actual, first_leak))
                    self.assertEqual(game, before)
        self.assertRegex(drill_view(game), r"Gate remaining\s+12\s+10\b")
        page = drill_view(game, 7)
        self.assertRegex(page, r"Gate remaining\s+12\s+12\b")
        self.assertRegex(page, r"Brass earned\s+10\s+16\b")
        self.assertRegex(page, r"Vent after beat 7\s+1 moved\s+3 moved")

    def test_boss_breach_and_unreachable_or_empty_vent_beats(self):
        game = Game(wave=29, cleared=29, overtime=True, sluice=3)
        for rush in (False, True):
            early = rehearse(game, rush=rush, vent_beat=1)
            self.assertEqual(early.vent_result, "Nobody moved")
            self.assertEqual((early.watch.phase, early.watch.brass), (Phase.LOST, game.brass))
            self.assertLessEqual(early.first_leak, early.watch.beat)
            for beat in (early.watch.beat, 999):
                late = rehearse(game, rush=rush, vent_beat=beat)
                self.assertEqual(late.vent_result, "Wave already over")
                self.assertEqual(late.watch, early.watch)
        self.assertRegex(drill_view(game), r"Lamp\s+BREACHED\s+BREACHED")

    def test_preview_preserves_last_report_orders_and_all_resources(self):
        game = Game()
        for cmd in ("build A coil", "sluice 1", "rush", "step 2", "k", "v", "run", "sell A"):
            order(game, cmd)
        snapshot = deepcopy(game)
        for beat in (None, 1, 999):
            drill_view(game, beat)
            self.assertEqual(game, snapshot)
        self.assertIn("Wickcoil 1", report_view(game))

    def test_bad_drills_and_wrong_phase_leave_state_untouched(self):
        game = Game()
        for line in ("drill 1", "drill 0", "drill -1", "drill 1000", "drill 1.5",
                     "drill \u0661", "drill 1 2", "drill " + "9" * 6000, "sluice 01", "sluice all"):
            with self.subTest(line=line[:20]), self.assertRaises(RuleError):
                order(game, line)
            self.assertEqual(game, Game())
        for phase in (Phase.WAVE, Phase.WON, Phase.LOST):
            game.phase = phase
            before = deepcopy(game)
            for line in ("drill", "drill 1", "sluice 1"):
                with self.assertRaises(RuleError):
                    order(game, line)
            self.assertEqual(game, before)

    def test_full_drill_and_sluice_views_fit_the_watch_terminal(self):
        game = Game(wave=19, cleared=19, sluice=3, towers={p: Tower("coil", 3) for p in PADS})
        for render in (lambda c: drill_view(game, 15, c), lambda c: sluice_view(game, c),
                       lambda c: pad_view(game, "B", None, c), lambda c: frame(game, color=c),
                       lambda c: guide(game, c)):
            plain = render(False)
            self.assertTrue(plain.isascii())
            self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", render(True)), plain)
            self.assertLess(max(map(len, plain.splitlines())), 80)
            self.assertLessEqual(len(plain.splitlines()), 22)
