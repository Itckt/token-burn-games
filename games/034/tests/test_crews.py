import unittest

from gutterlight.battle import FAR_TOWER, TOWER_HP, Lane, Move, Side
from gutterlight.cards import CARDS
from gutterlight.pilot import Pilot
from tests.support import arranged, place


AMBER, INDIGO = Side
ROOF, CANAL = Lane


class ArmorTests(unittest.TestCase):
    def test_armor_reduces_each_crew_and_tower_hit_with_a_one_point_floor(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged()
                cell = side.other.base - 2 * side.direction
                porter = place(game, side, ROOF, "shale", cell)
                for key in ("clip", "clip", "chit"):
                    place(game, side.other, ROOF, key, cell + side.direction)
                game.step()
                # Two 4-point hits, a 3-point hit and the tower's 8-point hit.
                self.assertEqual(porter.hp, porter.stats.hp - (1 + 1 + 1 + 5))

    def test_splash_applies_each_targets_armor_and_squall_bypasses_it(self):
        game = arranged(indigo=("squall",))
        porter = place(game, AMBER, ROOF, "shale", 5)
        runner = place(game, AMBER, ROOF, "wick", 5, move_at=99)
        place(game, INDIGO, ROOF, "drum", 7)
        game.step()
        self.assertEqual((porter.hp, runner.hp), (52 - 6, 24 - 9))
        game.step(None, Move(0, ROOF))
        self.assertEqual((porter.hp, runner.hp), (52 - 6 - 16, 15 - 16))
        self.assertNotIn(runner, game.units)


class MendingTests(unittest.TestCase):
    def test_mender_prefers_most_missing_hull_then_nearest_then_oldest(self):
        game = arranged()
        weaver = place(game, AMBER, ROOF, "hem", 6)
        farther = place(game, AMBER, ROOF, "wick", 4, hp=8, move_at=99)
        first = place(game, AMBER, ROOF, "wick", 5, hp=8, move_at=99)
        second = place(game, AMBER, ROOF, "wick", 7, hp=8, move_at=99)
        closest = place(game, AMBER, ROOF, "clip", 6, hp=1, move_at=99)
        foe = place(game, INDIGO, ROOF, "ballast", 8, move_at=99, attack_at=99)
        second.attack_at = 99
        game.step()
        self.assertEqual([u.hp for u in (farther, first, second, closest)], [8, 16, 8, 1])
        self.assertEqual(foe.hp, foe.stats.hp)
        game.step()
        self.assertEqual((weaver.cell, first.hp, second.hp), (6, 16, 8))
        game.step()
        self.assertEqual((first.hp, second.hp), (16, 16))

    def test_self_other_lane_and_distant_allies_cannot_distract_a_weaver(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged()
                weaver = place(game, side, CANAL, "hem", 6, hp=4)
                distant = place(game, side, CANAL, "ballast", 6 - 3 * side.direction,
                                hp=1, move_at=99)
                other_lane = place(game, side, ROOF, "ballast", 6, hp=1, move_at=99)
                foe = place(game, side.other, CANAL, "ballast", 6 + 2 * side.direction,
                            move_at=99, attack_at=99)
                game.step()
                self.assertEqual((weaver.hp, distant.hp, other_lane.hp), (4, 1, 1))
                self.assertEqual(foe.hp, foe.stats.hp - weaver.stats.hit)

    def test_several_mends_share_the_pre_hit_cap_and_cannot_shield_a_full_unit(self):
        game = arranged()
        for cell in (4, 5):
            place(game, AMBER, ROOF, "hem", cell)
        patient = place(game, AMBER, ROOF, "clip", 6, hp=13)
        place(game, INDIGO, ROOF, "wick", 7)
        full = place(game, AMBER, CANAL, "clip", 6)
        place(game, AMBER, CANAL, "hem", 5)
        place(game, INDIGO, CANAL, "wick", 7)
        game.step()
        self.assertEqual(patient.hp, 14 - 7)
        self.assertEqual(full.hp, 14 - 7)
        mends = [e.text for e in game.events if "mended" in e.text]
        self.assertEqual(mends, ["Amber mended 1 hull on Clip Crew in Roof."])

    def test_a_lethal_trade_still_delivers_the_heal_and_saves_the_patient(self):
        game = arranged()
        weaver = place(game, AMBER, ROOF, "hem", 4, hp=7)
        patient = place(game, AMBER, ROOF, "clip", 6, hp=3)
        place(game, INDIGO, ROOF, "wick", 4)
        place(game, INDIGO, ROOF, "wick", 7)
        game.step()
        self.assertNotIn(weaver, game.units)
        self.assertIn(patient, game.units)
        self.assertEqual(patient.hp, 3 + 8 - 7)

    def test_pulse_casualties_leave_before_mending_and_survivors_can_be_treated(self):
        game = arranged(amber=("hem",), indigo=("squall",))
        fallen = place(game, AMBER, ROOF, "clip", 4, move_at=99)
        hurt = place(game, AMBER, ROOF, "ballast", 4, move_at=99)
        game.step(Move(0, ROOF), Move(0, ROOF))
        self.assertNotIn(fallen, game.units)
        self.assertEqual(hurt.hp, hurt.stats.hp - 16 + 8)
        self.assertEqual(game.in_lane(AMBER, ROOF)[-1].card, "hem")
        self.assertEqual(game.frame().hull, ((TOWER_HP, TOWER_HP),) * 2)

    def test_pilot_will_spend_its_reserve_to_treat_the_wounded_lane(self):
        for side in Side:
            with self.subTest(side=side):
                hand = ("hem", "patch", "squall", "ballast")
                game = arranged(amber=hand, indigo=hand)
                game.players[side].energy = CARDS["hem"].cost
                pilot = Pilot(2, side)
                self.assertIsNone(pilot.choose(game))
                place(game, side, CANAL, "shale", side.base + 3 * side.direction, hp=10)
                self.assertEqual(pilot.choose(game), Move(0, CANAL))


class DispatchTests(unittest.TestCase):
    def test_twin_awls_cycle_once_and_each_earns_its_own_siege_bonus(self):
        game = arranged(amber=("awl",))
        next_draw = game.frame().next_draw[AMBER]
        game.step(Move(0, CANAL))
        self.assertEqual(game.players[AMBER].hand[0], next_draw)
        self.assertEqual(game.players[AMBER].energy, 2)
        self.assertEqual([(u.card, u.cell) for u in game.units], [("awl", 1)] * 2)
        for unit in game.units:
            unit.cell = FAR_TOWER - 1
        game.step()
        self.assertEqual(game.towers[INDIGO][CANAL].hp, TOWER_HP - 2 * (4 + 5))

    def test_one_energy_skater_advances_each_beat(self):
        game = arranged(indigo=("chit",))
        game.players[INDIGO].energy = 1
        game.step(None, Move(0, ROOF))
        self.assertEqual(game.players[INDIGO].energy, 0)
        for expected in (10, 9, 8):
            self.assertEqual(game.units[0].cell, expected)
            game.step()
