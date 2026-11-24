from unittest import TestCase

from pinchline.battle import Outcome
from pinchline.roster import CHARGE_CAP, COPPER, INDIGO
from tests.helpers import arrange


class CombatTests(TestCase):
    def arrange(self, positions, *, seed=852, beat=0, limit=60):
        """Play the next beat of an arranged position using the normal engine."""
        self.game, self.units = arrange(positions, seed=seed, beat=beat, limit=limit)
        return tuple(self.units[token] for token in positions)

    def ready(self, unit):
        unit.charge = CHARGE_CAP - 1

    def test_ward_protects_nearby_ally_in_the_casting_beat(self):
        a, c, b, z = self.arrange({"A": (6, 5), "C": (7, 5), "B": (1, 2), "z": (8, 5)})
        self.ready(a)
        self.game.step()
        self.assertEqual((a.ward, c.ward, b.ward), (5, 2, 0))
        self.assertEqual(c.hp, c.hero.hp)
        self.assertEqual(a.charge, 0)
        self.assertEqual(z.hp, z.hero.hp - c.hero.power)

    def test_ward_refreshes_to_cap_and_a_full_ward_holds_charge(self):
        a, _ = self.arrange({"A": (2, 5), "z": (15, 5)})
        a.ward = 3
        self.ready(a)
        self.game.step()
        self.assertEqual((a.ward, a.charge), (5, 0))
        self.ready(a)
        self.game.step()
        self.assertEqual((a.ward, a.charge), (5, CHARGE_CAP))

    def test_mend_selects_greatest_missing_hp_in_range(self):
        c, a, b, _ = self.arrange({"C": (8, 5), "A": (7, 5), "B": (8, 6), "x": (15, 0)})
        a.hp -= 8
        b.hp -= 6
        self.ready(c)
        self.game.step()
        self.assertEqual((a.hp, b.hp, c.charge), (a.hero.hp - 1, b.hero.hp - 6, 0))

    def test_mend_allows_self_heal_and_caps_health(self):
        c, _, a = self.arrange({"C": (8, 5), "x": (15, 0), "A": (0, 2)})
        c.hp -= 1
        a.hp = 1
        self.ready(c)
        self.game.step()
        self.assertEqual((c.hp, c.charge, a.hp), (c.hero.hp, 0, 1))

    def test_healthy_mender_holds_charge_and_pulses(self):
        c, x = self.arrange({"C": (8, 5), "x": (9, 5)})
        self.ready(c)
        self.game.step()
        self.assertEqual(c.charge, CHARGE_CAP)
        self.assertEqual(x.hp, x.hero.hp - c.hero.power)
        self.assertEqual(self.units["A"].hp, 0)

    def test_mend_applies_before_incoming_hits(self):
        c, a, x = self.arrange({"C": (6, 5), "A": (7, 5), "x": (8, 5)})
        a.hp = 1
        self.ready(c)
        self.game.step()
        self.assertEqual(a.hp, 1 + c.hero.art_power - x.hero.power)
        self.assertTrue(a.alive)

    def test_echo_hits_only_one_neighbor_of_the_primary(self):
        b, x, y, z = self.arrange({"B": (5, 5), "x": (9, 5), "y": (10, 5), "z": (11, 5)})
        x.hp = 8
        x.ward = 2
        self.ready(b)
        self.game.step()
        self.assertEqual((x.hp, x.ward), (5, 0))
        self.assertEqual((y.hp, z.hp), (y.hero.hp - 3, z.hero.hp))
        self.assertEqual(b.charge, 0)

    def test_echo_hits_an_isolated_primary_without_friendly_fire(self):
        b, a, x, y = self.arrange({"B": (5, 5), "A": (8, 5), "x": (9, 5), "y": (15, 5)})
        self.ready(b)
        self.game.step()
        self.assertEqual(x.hp, x.hero.hp - b.hero.art_power - a.hero.power)
        self.assertEqual(a.hp, a.hero.hp - x.hero.power)
        self.assertEqual(y.hp, y.hero.hp)

    def test_power_counts_overkill_and_echo_and_block_counts_absorbed_hits_only(self):
        b, x, y = self.arrange({"B": (5, 5), "x": (9, 5), "y": (10, 5)})
        x.hp, x.ward = 1, 2
        self.ready(b)
        self.game.step()
        self.assertEqual((b.stats.arts, b.stats.pulses, b.stats.power_sent), (1, 0, 8))
        self.assertEqual((x.hp, x.stats.blocked), (0, 2))
        self.assertEqual((y.hp, y.stats.blocked), (y.hero.hp - 3, 0))

    def test_hop_lands_beside_a_locked_target_and_hits(self):
        b, x = self.arrange({"B": (7, 5), "x": (4, 5)})
        self.ready(x)
        self.game.step()
        self.assertEqual((x.pos, x.charge), ((6, 5), 0))
        self.assertEqual(b.hp, b.hero.hp - x.hero.art_power)
        self.assertEqual(x.hp, x.hero.hp - b.hero.power)

    def test_hop_in_contact_can_strike_from_its_own_tile(self):
        a, x = self.arrange({"A": (7, 5), "x": (8, 5)})
        self.ready(x)
        self.game.step()
        self.assertEqual(x.pos, (8, 5))
        self.assertEqual((a.hp, x.charge), (a.hero.hp - x.hero.art_power, 0))

    def test_blocked_hop_holds_its_charge(self):
        x, _, _ = self.arrange({"x": (4, 5), "B": (7, 5), "y": (6, 5)})
        self.ready(x)
        self.game.step()
        self.assertEqual(x.charge, CHARGE_CAP)
        self.assertFalse(any("Margin Hop" in n for n in self.game.notes))

    def test_lost_hop_reservation_spends_nothing_and_deals_no_damage(self):
        results = set()
        for seed in range(16):
            a, x = self.arrange({"A": (7, 5), "x": (4, 5)}, seed=seed)
            self.ready(x)
            self.game.step()
            self.assertNotEqual(a.pos, x.pos)
            landed = x.pos == (6, 5)
            results.add(landed)
            if landed:
                self.assertEqual((a.pos, a.hp, x.charge), ((7, 5), a.hero.hp - x.hero.art_power, 0))
            else:
                self.assertEqual((a.pos, a.hp, x.charge), ((6, 5), a.hero.hp, CHARGE_CAP))
        self.assertEqual(results, {True, False})

    def test_piercing_hit_bypasses_and_preserves_ward(self):
        y, a = self.arrange({"y": (6, 5), "A": (10, 5)})
        self.ready(y)
        a.ward = 5
        self.game.step()
        self.assertEqual((a.hp, a.ward, y.charge), (a.hero.hp - y.hero.art_power, 5, 0))

    def test_charge_drain_is_clamped_at_zero(self):
        z, b = self.arrange({"z": (8, 5), "B": (10, 5)})
        self.ready(z)
        self.game.step()
        self.assertEqual((b.hp, b.charge), (b.hero.hp - z.hero.art_power, 0))
        self.assertEqual(z.hp, z.hero.hp - b.hero.power)

    def test_drain_cannot_cancel_a_committed_art(self):
        z, b = self.arrange({"z": (8, 5), "B": (10, 5)})
        self.ready(z)
        self.ready(b)
        self.game.step()
        self.assertEqual((b.hp, b.charge), (b.hero.hp - z.hero.art_power, 0))
        self.assertEqual((z.hp, z.charge), (z.hero.hp - b.hero.art_power, 0))

    def test_full_charge_waits_for_a_valid_target(self):
        b, x = self.arrange({"B": (1, 5), "x": (15, 5)})
        self.ready(b)
        self.game.step()
        self.assertEqual(b.charge, CHARGE_CAP)
        self.assertEqual(b.pos, (2, 5))
        self.assertEqual(x.hp, x.hero.hp)

    def test_baffle_puts_target_out_of_pulse_but_in_art_range(self):
        for ready in (False, True):
            with self.subTest(ready=ready):
                b, x = self.arrange({"B": (4, 2), "x": (6, 2)})
                if ready:
                    self.ready(b)
                self.game.step()
                self.assertEqual(x.hp, x.hero.hp - (b.hero.art_power if ready else 0))

    def test_target_ranking_uses_lowest_hp_then_nearest(self):
        for far_hp, expected in [(8, "y"), (10, "x")]:
            with self.subTest(far_hp=far_hp):
                b, x, y = self.arrange({"B": (8, 5), "x": (9, 5), "y": (11, 5)})
                x.hp, y.hp = 10, far_hp
                self.game.step()
                self.assertIn(f"B pulse -> {expected} ({b.hero.power})", self.game.notes)

    def test_walkers_contest_one_tile_without_overlapping(self):
        a, x = self.arrange({"A": (6, 5), "x": (8, 5)})
        self.game.step()
        self.assertIn((7, 5), (a.pos, x.pos))
        self.assertNotEqual(a.pos, x.pos)
        self.assertEqual((a.hp, x.hp), (a.hero.hp, x.hero.hp))
        self.assertTrue(any("contested" in n for n in self.game.notes))

    def test_new_fringe_prioritizes_escape_before_an_available_art(self):
        y, b = self.arrange({"y": (0, 5), "B": (2, 5)}, beat=4)
        self.ready(y)
        self.game.step()
        self.assertEqual((y.pos, y.charge), ((1, 5), CHARGE_CAP))
        self.assertEqual(y.hp, y.hero.hp - b.hero.power)
        self.assertEqual(b.hp, b.hero.hp)
        self.assertIn("Fold 1 closes in.", self.game.notes)

    def test_exposure_uses_final_position_and_ignores_ward(self):
        a, _ = self.arrange({"A": (0, 0), "z": (14, 5)}, beat=9)
        a.ward = 5
        self.game.step()
        self.assertNotEqual(a.pos, (0, 0))
        self.assertFalse(self.game.zone.contains(a.pos))
        self.assertEqual((a.hp, a.ward), (a.hero.hp - 4, 5))
        self.assertIn("Fringe -4 HP   A", self.game.notes)

    def test_trapped_hero_can_fight_while_exposed(self):
        a, _, _ = self.arrange({"A": (0, 0), "B": (1, 0), "x": (0, 1)}, beat=4)
        self.game.step()
        self.assertEqual(a.pos, (0, 0))
        self.assertIn(f"A pulse -> x ({a.hero.power})", self.game.notes)
        self.assertEqual(a.hp, a.hero.hp - 3)

    def test_knocked_out_units_leave_their_tile_free(self):
        a, x = self.arrange({"A": (6, 5), "x": (10, 5)})
        corpse = self.units["C"]
        corpse.pos = (7, 5)
        self.game.step()
        self.assertEqual(a.pos, corpse.pos)
        self.assertFalse(corpse.alive)
        self.assertEqual(corpse.charge, 0)
        self.assertEqual(x.hp, x.hero.hp)

    def test_simultaneous_final_hits_draw_and_stop_the_clock(self):
        a, x = self.arrange({"A": (7, 5), "x": (8, 5)}, limit=1)
        a.hp = x.hp = 4
        self.game.step()
        self.assertEqual(self.game.result, Outcome(None, "double knockout"))
        self.assertEqual((a.hp, x.hp, a.charge, x.charge), (0, 0, 0, 0))
        notes = self.game.notes.copy()
        self.game.step()
        self.assertEqual(self.game.run(), Outcome(None, "double knockout"))
        self.assertEqual((self.game.beat, self.game.notes), (1, notes))

    def test_bell_prioritizes_survivors_over_total_hp(self):
        a, b, _ = self.arrange({"A": (2, 2), "B": (1, 5), "x": (14, 8)}, limit=1)
        a.hp = b.hp = 1
        self.assertEqual(self.game.run(), Outcome(COPPER, "more survivors at the bell"))
        self.assertLess(self.game.score(COPPER)[1], self.game.score(INDIGO)[1])

    def test_bell_compares_hp_then_awards_an_exact_draw(self):
        for hp, result in [(11, Outcome(INDIGO, "more HP at the bell")),
                           (10, Outcome(None, "level on survivors and HP at the bell"))]:
            with self.subTest(hp=hp):
                a, x = self.arrange({"A": (2, 2), "x": (14, 8)}, limit=1)
                a.hp, x.hp = 10, hp
                self.assertEqual(self.game.run(), result)
