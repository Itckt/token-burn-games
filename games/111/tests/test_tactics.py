from collections import deque
from copy import deepcopy
import random
import unittest

from spillway import (
    Arrival, BRACE_STRENGTH, CHARGE_MAX, Enemy, GATE_MAX, Game, NET_BEATS,
    PADS, Phase, RuleError, SIGNALS, TRACK, Tower, wave_bonus, wave_plan,
)
from tests.test_spillway import battle


class TacticsTestCase(unittest.TestCase):
    def assert_rejected(self, game, action, *args):
        before = deepcopy(game)
        with self.assertRaises(RuleError):
            action(*args)
        self.assertEqual(game, before)


class AimTests(TacticsTestCase):
    def test_heavy_counts_shell_in_range_and_rechecks_as_it_takes_damage(self):
        boss = Enemy("crown", 4, 2, shell=12)
        front = Enemy("ripple", 15, 6)
        outside = Enemy("ballast", 50, 30)
        game = battle(boss, front, outside, towers={"A": Tower("pin", aim="heavy")})
        game.tick()
        self.assertEqual((boss.hp, boss.shell, front.hp, outside.hp), (4, 8, 15, 50))
        # The front Ripple has moved out of A's range. A fresh one is now heavier.
        incoming = Enemy("ripple", 13, 4)
        game.enemies.append(incoming)
        game.play_signal("k")
        self.assertEqual((boss.shell, incoming.hp, front.hp, outside.hp), (8, 9, 15, 50))

    def test_equal_heavy_targets_use_half_cell_progress_then_arrival_order(self):
        behind = Enemy("ballast", 10, 4)
        first = Enemy("ripple", 8, 5, shell=2)
        tied = Enemy("ripple", 10, 5)
        game = battle(behind, first, tied, towers={"A": Tower("pin", aim="heavy")})
        game.tick()
        self.assertEqual((behind.hp, first.hp, first.shell, tied.hp), (10, 6, 0, 10))

    def test_pack_counts_living_neighbors_outside_the_footprint(self):
        # A reaches cells 1-3. Cell 1 catches four enemies, cell 3 catches three.
        enemies = [Enemy("ballast", 10, cell * 2) for cell in (0, 0, 1, 3, 5)]
        game = battle(*enemies, towers={"A": Tower("bell", aim="pack")})
        game.tick()
        self.assertEqual([e.hp for e in enemies], [6, 6, 6, 6, 10])
        self.assertEqual((game.pad_reports["A"].shots, game.pad_reports["A"].hits), (1, 4))

    def test_pack_ignores_dead_neighbors_and_breaks_density_ties(self):
        rear = [Enemy("ripple", 4, 6), Enemy("skate", 5, 7), Enemy("ballast", 0, 5)]
        first, second = Enemy("ripple", 4, 30), Enemy("ballast", 10, 30)
        tower = Tower("bell", 2, aim="pack")
        self.assertIs(tower.choose_target("C", [*rear, first, second]), first)

    def test_aim_orders_are_free_survive_upgrades_and_reset_on_rebuild(self):
        game = Game(brass=100)
        game.build("C", "pin")
        for pad, mode in (("I", "heavy"), ("D", "front"), ("C", "pack"), ("C", "nearest")):
            self.assert_rejected(game, game.set_aim, pad, mode)
        game.set_aim("C", "heavy")
        self.assertEqual(game.brass, 82)
        game.upgrade("C")
        game.start_wave()
        self.assertEqual(game.towers["C"].aim, "heavy")
        self.assert_rejected(game, game.set_aim, "C", "front")
        while game.phase is Phase.WAVE:
            game.tick()
        game.sell("C")
        game.build("C", "bell")
        self.assertEqual(game.towers["C"].aim, "front")


class SignalTests(TacticsTestCase):
    def test_deck_slots_are_distinct_fixed_during_combat_and_local_to_one_watch(self):
        game = Game()
        for cards in (("net", "net"), ("missing", "brace"), ("net", "missing")):
            self.assert_rejected(game, game.set_deck, *cards)
        self.assert_rejected(game, game.play_signal, "j")
        game.set_deck("brace", "net")
        game.start_wave()
        self.assert_rejected(game, game.set_deck, "echo", "brace")
        game.play_signal("j")
        self.assertEqual((game.brace, game.charge, game.beat), (BRACE_STRENGTH, 1, 0))
        self.assertEqual(game.spent_signals, {"brace"})
        fresh = Game()
        self.assertEqual(fresh.deck, ("net", "echo"))
        self.assertFalse(fresh.spent_signals)

    def test_invalid_empty_out_of_range_and_unfunded_signals_are_atomic(self):
        game = battle(towers={"A": Tower("pin", cooldown=1)}, fired=["A"])
        for key in ("?", "j", "k"):
            self.assert_rejected(game, game.play_signal, key)
        enemy = Enemy("skate", 20, 44)
        game.enemies.append(enemy)
        self.assert_rejected(game, game.play_signal, "k")
        enemy.distance = 4
        game.charge = 1
        for key in ("j", "k"):
            self.assert_rejected(game, game.play_signal, key)
        game.towers.clear()
        game.charge = CHARGE_MAX
        self.assert_rejected(game, game.play_signal, "k")

    def test_net_spans_reaches_and_loom_hits_never_shorten_its_slow(self):
        boss, skate, ripple = Enemy("crown", 70, 0, shell=11), Enemy("skate", 30, 18), Enemy("ripple", 20, 40)
        game = battle(boss, skate, ripple, wave=10, towers={"A": Tower("loom")},
                      arrivals=deque([Arrival(2, "skate")]), charge=CHARGE_MAX)
        game.play_signal("j")
        self.assertEqual(([e.slow for e in game.enemies], boss.shell, game.charge),
                         ([NET_BEATS] * 3, 11, 4))
        self.assert_rejected(game, game.play_signal, "j")
        game.tick()
        self.assertEqual((boss.slow, boss.shell, boss.distance, skate.distance, ripple.distance),
                         (NET_BEATS - 1, 9, 1, 20, 41))
        game.tick()
        new_skate = game.enemies[-1]
        self.assertEqual((new_skate.distance, new_skate.slow), (3, 0))
        game.towers.clear()
        for _ in range(NET_BEATS - 2):
            game.tick()
        self.assertEqual((skate.slow, skate.distance), (0, 18 + 2 * NET_BEATS))
        game.tick()
        self.assertEqual(skate.distance, 18 + 2 * NET_BEATS + 3)

    def test_echo_retargets_in_pad_order_even_during_reload(self):
        heavy, front, distant = Enemy("ballast", 5, 10), Enemy("ripple", 4, 12), Enemy("ripple", 20, 40)
        towers = {"C": Tower("pin", cooldown=1), "B": Tower("pin", 2, cooldown=1, aim="heavy")}
        game = battle(heavy, front, distant, towers=towers, brass=0, charge=CHARGE_MAX)
        game.play_signal("k")
        self.assertEqual((game.fired, game.enemies, game.charge, game.beat), (["B", "C"], [distant], 3, 0))
        self.assertEqual((heavy.hp, front.hp, game.kills, game.brass), (-1, 0, 2, 4))
        self.assertEqual([t.cooldown for t in towers.values()], [1, 1])
        self.assertEqual([game.pad_reports[p].kills for p in "BC"], [1, 1])
        self.assert_rejected(game, game.play_signal, "k")
        game.tick()
        self.assertEqual(([t.cooldown for t in towers.values()], game.brass), ([0, 0], 4))

    def test_brace_absorbs_partial_leaks_on_the_same_beat(self):
        end = 2 * len(TRACK) - 1
        game = battle(*(Enemy(kind, 10, end) for kind in ("ballast", "ballast", "ripple")),
                      deck=("net", "brace"), rush=True, brass=0)
        game.play_signal("k")
        game.tick()
        self.assertEqual((game.brace, game.gate, game.leaked, game.kills), (0, GATE_MAX - 2, 3, 0))
        self.assertEqual((game.phase, game.brass), (Phase.BUILD, wave_bonus(1)))

    def test_fully_absorbed_leak_costs_the_rush_premium_and_spare_brace_expires(self):
        game = battle(Enemy("ripple", 4, 2 * len(TRACK) - 1),
                      deck=("brace", "echo"), rush=True, brass=0)
        game.play_signal("j")
        game.tick()
        self.assertEqual((game.gate, game.leaked, game.brace, game.brass), (GATE_MAX, 1, 0, wave_bonus(1)))
        game.start_wave()
        self.assertFalse(game.spent_signals or game.rush)
        self.assertEqual((game.deck, game.charge, game.brace), (("brace", "echo"), 1, 0))
        for _ in range(5):
            game.tick()
        game.play_signal("j")
        self.assertEqual(game.brace, BRACE_STRENGTH)

    def test_crown_pierces_a_fresh_brace_and_denies_all_hold_pay(self):
        game = battle(Enemy("crown", 5, 2 * len(TRACK) - 1), wave=10,
                      deck=("brace", "echo"), rush=True, brass=0)
        game.play_signal("j")
        game.tick()
        self.assertEqual((game.phase, game.gate, game.brass, game.cleared), (Phase.LOST, 0, 0, 0))
        self.assert_rejected(game, game.play_signal, "k")


class RushAndReportTests(TacticsTestCase):
    def test_rush_pairs_the_standard_roster_in_order_including_overtime_bosses(self):
        for wave in (1, 3, 4, 10, 19, 20, 30, 9999):
            with self.subTest(wave=wave):
                normal = wave_plan(wave)
                rush = wave_plan(wave, rush=True)
                self.assertEqual([a.kind for a in normal], [a.kind for a in rush])
                self.assertEqual([a.beat for a in rush], [normal[i // 2].beat for i in range(len(normal))])
                self.assertLess(rush[-1].beat, normal[-1].beat)
                self.assertEqual(sum(a.kind == "crown" for a in rush), int(wave % 10 == 0))

    def test_wiping_a_pair_waits_for_the_remaining_arrivals(self):
        game = Game(brass=0)
        game.start_wave(rush=True)
        game.tick()
        self.assertEqual(len(game.enemies), 2)
        game.pulse(1)
        self.assertEqual((game.phase, game.kills, game.brass, game.pulse_kills), (Phase.WAVE, 2, 2, 2))
        for _ in range(4):
            game.tick()
            self.assertEqual((game.phase, len(game.enemies)), (Phase.WAVE, 0))
        game.tick()
        self.assertEqual((game.beat, len(game.enemies), len(game.arrivals)), (6, 2, 0))

    def test_clean_rush_pays_once_for_a_finishing_pulse_or_echo_on_wave_twenty(self):
        for action in ("pulse", "echo"):
            with self.subTest(action=action):
                game = battle(Enemy("crown", 1, 4, shell=2), wave=20, rush=True,
                              towers={"A": Tower("pin")}, brass=0)
                if action == "pulse":
                    game.pulse(1)
                else:
                    game.play_signal("k")
                self.assertEqual((game.phase, game.cleared, game.kills, game.crowns),
                                 (Phase.WON, 20, 1, 1))
                self.assertEqual(game.brass, 10 + 2 * wave_bonus(20))
                self.assert_rejected(game, game.play_signal, "k")
                self.assert_rejected(game, game.pulse, 1)
                game.continue_watch()
                game.start_wave()
                self.assertEqual((game.wave, game.rush, game.pulse_kills), (21, False, 0))
                self.assertEqual(tuple(game.arrivals), wave_plan(21))

    def test_report_credits_splash_echo_and_pulse_and_snapshots_idle_pads(self):
        game = Game(towers={"A": Tower("bell", aim="pack"), "H": Tower("loom")}, charge=6)
        game.start_wave(rush=True)
        # At beat two the bell hits both members of the first pair.
        game.tick()
        game.tick()
        game.play_signal("k")
        row = game.pad_reports["A"]
        self.assertEqual((row.shots, row.hits, row.kills), (2, 4, 2))
        for _ in range(4):
            game.tick()
        game.pulse(1)
        self.assertEqual((game.phase, game.pulse_kills, game.kills), (Phase.BUILD, 2, 4))
        self.assertEqual(game.pad_reports["H"].shots, 0)
        snapshot = deepcopy(game.pad_reports)
        game.upgrade("A")
        game.set_aim("A", "heavy")
        game.sell("H")
        self.assertEqual(game.pad_reports, snapshot)
        game.start_wave()
        self.assertEqual(set(game.pad_reports), {"A"})
        row = game.pad_reports["A"]
        self.assertEqual((row.level, row.aim, row.shots, row.hits, row.kills, game.pulse_kills),
                         (2, "heavy", 0, 0, 0, 0))

    def test_mixed_signals_aims_and_tides_account_for_every_enemy_and_kill(self):
        for wave in (1, 4, 10, 20, 31, 50):
            for rush in (False, True):
                with self.subTest(wave=wave, rush=rush):
                    rng = random.Random(2 * wave + rush)
                    game = Game(wave=wave - 1, cleared=wave - 1, charge=CHARGE_MAX)
                    game.set_deck(*rng.sample(list(SIGNALS), 2))
                    for pad in rng.sample(list(PADS), 4):
                        kind = rng.choice(("pin", "bell", "loom"))
                        modes = ["front", "heavy", "pack"] if kind == "bell" else ["front", "heavy"]
                        game.towers[pad] = Tower(kind, rng.randint(1, 3), aim=rng.choice(modes))
                    game.start_wave(rush=rush)
                    expected = len(game.arrivals)
                    last_beat = game.arrivals[-1].beat + 4 * len(TRACK)
                    while game.phase is Phase.WAVE:
                        game.tick()
                        if game.phase is Phase.WAVE and game.enemies and rng.randrange(3) == 0:
                            action = rng.choice(("j", "k", "pulse"))
                            try:
                                if action == "pulse":
                                    game.pulse(rng.choice(game.enemies).reach)
                                else:
                                    game.play_signal(action)
                            except RuleError:
                                pass  # The charge meter or a spent slot can block a play.
                        counted = len(game.arrivals) + len(game.enemies) + game.kills + game.leaked
                        self.assertEqual(counted, expected)
                        self.assertEqual(sum(r.kills for r in game.pad_reports.values()) + game.pulse_kills,
                                         game.kills)
                        self.assertTrue(0 <= game.charge <= CHARGE_MAX)
                        self.assertLessEqual(game.beat, last_beat)
