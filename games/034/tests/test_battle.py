import random
import unittest

from gutterlight.battle import (
    Battle, DECK_SIZE, FAR_TOWER, HAND_SIZE, IllegalMove, Lane, MAX_ENERGY,
    MAX_TICKS, Move, Outcome, Player, REGEN_TICKS, SIGNAL_TICKS, Setup, Side,
    TOWER_HP, signal_at,
)
from gutterlight.cards import CARDS, DECKS
from gutterlight.recording import document
from tests.support import arranged, place


AMBER, INDIGO = Side
ROOF, CANAL = Lane


class DeckTests(unittest.TestCase):
    def test_catalog_and_decks(self):
        for key, card in CARDS.items():
            with self.subTest(card=key):
                self.assertEqual(key, card.key)
                self.assertIn(card.cost, range(1, MAX_ENERGY + 1))
                self.assertEqual(sum(bool(a) for a in (card.troop, card.burst, card.repair)), 1)
                if card.troop:
                    self.assertGreater(min(card.troop.hp, card.troop.hit, card.troop.reach,
                                           card.troop.attack_ticks, card.troop.walk_ticks,
                                           card.troop.count), 0)
        for deck in DECKS.values():
            self.assertEqual(len(set(deck)), DECK_SIZE)
            self.assertTrue(set(deck) <= CARDS.keys())

    def test_deal_reproduces_each_side_without_touching_global_rng(self):
        before = random.getstate()
        setup = Setup.deal(0)
        self.assertEqual(setup, Setup.deal(0))
        self.assertNotEqual(setup.opening, Setup.deal(27).opening)
        swap = Setup.deal(0, amber="trestle", indigo="awning")
        self.assertCountEqual(swap.opening[AMBER], DECKS["trestle"])
        self.assertCountEqual(swap.opening[INDIGO], DECKS["awning"])
        self.assertEqual(random.getstate(), before)
        game = Battle(setup)
        for side in Side:
            player = game.players[side]
            self.assertEqual(len(player.hand), HAND_SIZE)
            self.assertEqual(tuple(player.hand + player.reserve), setup.opening[side])
            self.assertEqual(player.energy, 5)
        self.assertEqual(game.frame().hull, ((150, 150), (150, 150)))

    def test_invalid_match_setup(self):
        valid = Setup.deal(1).opening
        bad = (("x",) + valid[0][1:], valid[1])
        duplicate = ((valid[0][1],) + valid[0][1:], valid[1])
        for args in ((True, 1, valid), (-1, 1, valid), (2**32, 1, valid),
                     (0, 0, valid), (0, MAX_TICKS + 1, valid), (0, True, valid),
                     (0, 1, valid[:1]), (0, 1, (valid[0][:-1], valid[1])),
                     (0, 1, bad), (0, 1, duplicate)):
            with self.subTest(args=args), self.assertRaises(ValueError):
                Setup(*args)
        with self.assertRaisesRegex(ValueError, "Unknown deck"):
            Setup.deal(0, amber="missing")

    def test_played_card_waits_at_back_of_four_card_reserve(self):
        deck = DECKS["awning"]
        player = Player(list(deck[:4]), list(deck[4:]))
        drawn = []
        for _ in range(5):
            player.cycle(1)
            drawn.append(player.hand[1])
            self.assertEqual(player.hand[0], deck[0])
            self.assertEqual(player.hand[2:], list(deck[2:4]))
            self.assertCountEqual(player.hand + player.reserve, deck)
        self.assertEqual(drawn, [*deck[4:], deck[1]])


class DispatchTests(unittest.TestCase):
    def test_malformed_order_cannot_charge_the_other_player_or_advance_the_clock(self):
        game = arranged()
        before = document(game)
        for invalid in ("1R", 3, (0, ROOF)):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(IllegalMove, "slot and a lane"):
                game.step(Move(0, ROOF), invalid)
            self.assertEqual(document(game), before)

    def test_order_spends_cycles_and_spawns_only_on_chosen_lane(self):
        game = arranged()
        game.step(Move(0, ROOF), Move(1, CANAL))
        self.assertEqual(game.frame().energy, (3, 2))
        self.assertEqual(game.players[AMBER].hand[0], "ballast")
        self.assertEqual(game.players[INDIGO].reserve[-1], "clip")
        self.assertEqual([u.cell for u in game.in_lane(AMBER, ROOF)], [2])
        self.assertEqual([u.cell for u in game.in_lane(INDIGO, CANAL)], [11, 11, 11])
        self.assertEqual([u.uid for u in game.units], [1, 2, 3, 4])
        self.assertEqual([d.tick for d in game.dispatches], [1, 1])

    def test_regeneration_happens_after_orders_and_caps_for_both_sides(self):
        game = arranged()
        game.step(Move(0, CANAL))
        for _ in range(REGEN_TICKS - 2):
            game.step()
        self.assertEqual(game.frame().energy, (3, 5))
        self.assertIn("needs 5", game.problem(AMBER, Move(0, ROOF)))
        game.step()
        self.assertEqual(game.frame().energy, (4, 6))
        for _ in range(REGEN_TICKS * 9):
            game.step()
        self.assertEqual(game.frame().energy, (MAX_ENERGY, MAX_ENERGY))

    def test_invalid_second_order_is_atomic_for_both_sides(self):
        for bad in (Move(-1, ROOF), Move(4, ROOF), Move(True, ROOF), Move(1, 7),
                    Move(0, ROOF), Move(1, CANAL)):
            with self.subTest(move=bad):
                game = arranged(indigo=("patch", "squall"))
                before = document(game)
                events = list(game.events)
                with self.assertRaises(IllegalMove):
                    game.step(Move(0, ROOF), bad)
                self.assertEqual(document(game), before)
                self.assertEqual(game.events, events)

    def test_insufficient_energy_cannot_borrow_from_regen_beat(self):
        game = arranged(amber=("ballast",))
        for _ in range(REGEN_TICKS - 1):
            game.step()
        game.players[AMBER].energy = 4
        before = document(game)
        with self.assertRaisesRegex(IllegalMove, "needs 5"):
            game.step(Move(0, ROOF))
        self.assertEqual(document(game), before)
        game.step()
        game.step(Move(0, ROOF))
        self.assertEqual(game.players[AMBER].energy, 0)

    def test_signal_changes_after_the_boundary_dispatch(self):
        game = arranged()
        for _ in range(SIGNAL_TICKS - 1):
            game.step()
        self.assertEqual(signal_at(game.tick), ROOF)
        game.step(Move(0, ROOF))
        self.assertEqual(game.units[0].cell, 2)
        self.assertEqual(signal_at(game.tick), CANAL)
        self.assertIn("switches to Canal", game.events[-1].text)
        game.step(None, Move(0, CANAL))
        self.assertEqual(game.in_lane(INDIGO, CANAL)[0].cell, FAR_TOWER - 2)
        self.assertEqual(signal_at(2 * SIGNAL_TICKS), ROOF)

    def test_signal_cannot_launch_behind_an_intruder(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged()
                cell = side.base + side.direction
                place(game, side.other, ROOF, "ballast", cell)
                orders = [None, None]
                orders[side] = Move(0, ROOF)
                game.step(*orders)
                self.assertEqual(game.in_lane(side, ROOF)[0].cell, cell)

    def test_burst_hits_only_front_cluster_in_chosen_lane(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged(amber=("squall",), indigo=("squall",))
                foes = [place(game, side.other, ROOF, "ink", side.base + side.direction * c,
                              hp=20, move_at=99) for c in (5, 6, 8)]
                other_lane = place(game, side.other, CANAL, "ink", 5, move_at=99)
                ally = place(game, side, ROOF, "wick", side.base + side.direction, move_at=99)
                orders = [None, None]
                orders[side] = Move(0, ROOF)
                game.step(*orders)
                self.assertEqual([u.hp for u in foes], [4, 4, 20])
                self.assertEqual((other_lane.hp, ally.hp), (26, 24))
                self.assertEqual(game.frame().hull, ((150, 150), (150, 150)))

    def test_burst_targets_preexisting_foes_and_casualties_cannot_retaliate(self):
        game = arranged(amber=("squall",))
        old = place(game, INDIGO, ROOF, "ink", 9, hp=16)
        ally = place(game, AMBER, ROOF, "ballast", 8, move_at=99, attack_at=99)
        game.step(Move(0, ROOF), Move(0, ROOF))
        self.assertNotIn(old, game.units)
        self.assertEqual(game.in_lane(INDIGO, ROOF)[0].hp, CARDS["wick"].troop.hp)
        self.assertEqual(ally.hp, CARDS["ballast"].troop.hp)

    def test_repair_touches_only_own_selected_tower_and_clamps_to_maximum(self):
        for hull, expected in ((50, 74), (145, TOWER_HP)):
            with self.subTest(hull=hull):
                game = arranged(amber=("patch",))
                game.towers[AMBER][CANAL].hp = hull
                game.towers[INDIGO][CANAL].hp = 40
                self.assertIn("full hull", game.problem(AMBER, Move(0, ROOF)))
                game.step(Move(0, CANAL))
                self.assertEqual(game.frame().hull, ((150, expected), (150, 40)))
                self.assertEqual(game.players[AMBER].energy, 3)

    def test_frame_is_an_immutable_snapshot(self):
        game = arranged()
        game.step(Move(0, ROOF))
        frame = game.frame()
        game.step(Move(1, CANAL))
        self.assertEqual(frame.tick, 1)
        self.assertEqual(frame.pieces[0].cell, 2)
        self.assertEqual(frame.hands[AMBER][1], "clip")
        self.assertEqual(frame.energy, (3, 5))
        self.assertNotEqual(game.frame().pieces, frame.pieces)
        with self.assertRaises(AttributeError):
            frame.pieces[0].hp = 1


class CombatTests(unittest.TestCase):
    def test_opposite_directions_and_move_cooldowns(self):
        game = arranged()
        game.step(Move(2, ROOF), Move(0, CANAL))
        self.assertEqual([u.cell for u in game.units], [2, 11])
        game.step()
        self.assertEqual([u.cell for u in game.units], [2, 10])
        game.step()
        self.assertEqual([u.cell for u in game.units], [3, 9])

    def test_ranged_unit_holds_position_and_obeys_attack_cooldown(self):
        game = arranged()
        glider = place(game, AMBER, ROOF, "ink", 4)
        target = place(game, INDIGO, ROOF, "ballast", 7, move_at=99)
        for expected in (86, 86, 80):
            game.step()
            self.assertEqual((glider.cell, target.hp), (4, expected))

    def test_nearest_unit_then_oldest_id_breaks_target_ties(self):
        game = arranged()
        place(game, AMBER, ROOF, "ink", 5)
        far = place(game, INDIGO, ROOF, "ballast", 8)
        near = place(game, INDIGO, ROOF, "ballast", 7)
        tied = place(game, INDIGO, ROOF, "ballast", 7)
        game.step()
        self.assertEqual((far.hp, near.hp, tied.hp), (92, 86, 92))

    def test_splash_is_limited_to_the_target_cell_and_lane(self):
        game = arranged()
        place(game, AMBER, ROOF, "drum", 5)
        foes = [place(game, INDIGO, ROOF, "clip", c) for c in (6, 6, 7)]
        safe = place(game, INDIGO, CANAL, "clip", 6)
        game.step()
        self.assertEqual([u.hp for u in foes], [5, 5, 14])
        self.assertEqual(safe.hp, 14)

    def test_simultaneous_lethal_hits_trade(self):
        game = arranged()
        place(game, AMBER, CANAL, "wick", 5, hp=7)
        place(game, INDIGO, CANAL, "wick", 6, hp=7)
        game.step()
        self.assertEqual(game.units, [])
        self.assertEqual(game.frame().hull, ((150, 150), (150, 150)))

    def test_tower_range_nearest_target_and_reload(self):
        game = arranged()
        near = place(game, INDIGO, CANAL, "ballast", 2, move_at=99)
        farther = place(game, INDIGO, CANAL, "ballast", 3, move_at=99)
        safe = place(game, INDIGO, ROOF, "ballast", 4, move_at=99)
        for expected in (84, 84, 84, 76):
            game.step()
            self.assertEqual((near.hp, farther.hp, safe.hp), (expected, 92, 92))

    def test_tower_strike_and_siege_attack_resolve_together(self):
        game = arranged()
        place(game, AMBER, CANAL, "rivet", FAR_TOWER - 1, hp=8)
        game.step()
        self.assertEqual(game.units, [])
        self.assertEqual(game.towers[INDIGO][CANAL].hp, TOWER_HP - 21)
        self.assertEqual(game.towers[INDIGO][ROOF].hp, TOWER_HP)

    def test_in_range_enemy_takes_priority_over_tower(self):
        game = arranged()
        place(game, AMBER, ROOF, "rivet", FAR_TOWER - 1)
        guard = place(game, INDIGO, ROOF, "ballast", FAR_TOWER - 2)
        game.step()
        self.assertEqual(guard.hp, 85)
        self.assertEqual(game.towers[INDIGO][ROOF].hp, TOWER_HP)


class VerdictTests(unittest.TestCase):
    def test_first_broken_tower_finishes_and_cannot_be_overkilled(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged(limit=1)
                game.towers[side.other][CANAL].hp = 3
                place(game, side, CANAL, "rivet", side.other.base - side.direction)
                game.step()
                self.assertEqual(game.outcome, Outcome(side, "tower"))
                self.assertEqual(game.towers[side.other][CANAL].hp, 0)
                self.assertIn("finished", game.problem(side, Move(0, ROOF)))
                with self.assertRaises(IllegalMove):
                    game.step()
                self.assertEqual(game.tick, 1)

    def test_simultaneous_tower_falls_in_different_lanes_draw(self):
        game = arranged()
        for side, lane in ((AMBER, ROOF), (INDIGO, CANAL)):
            game.towers[side.other][lane].hp = 1
            place(game, side, lane, "wick", side.other.base - side.direction)
        game.step()
        self.assertEqual(game.outcome, Outcome(None, "double fall"))
        self.assertIn("same beat", game.outcome.text)

    def test_timeout_uses_sum_of_both_towers_including_equal_totals(self):
        for hull, winner in ((100, AMBER), (130, None), (135, INDIGO)):
            with self.subTest(hull=hull):
                game = arranged(limit=2)
                game.towers[AMBER][CANAL].hp = 100
                game.towers[INDIGO][ROOF].hp = 120
                game.towers[INDIGO][CANAL].hp = hull
                game.step()
                self.assertIsNone(game.outcome)
                game.step()
                self.assertEqual(game.outcome, Outcome(winner, "clock"))
