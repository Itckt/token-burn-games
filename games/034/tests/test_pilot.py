import unittest

from gutterlight.battle import Battle, FAR_TOWER, Lane, MAX_ENERGY, Move, Setup, Side, TOWER_HP
from gutterlight.cards import CARDS
from gutterlight.pilot import Pilot, simulate
from gutterlight.recording import document
from tests.support import arranged, place


class PilotTests(unittest.TestCase):
    def test_saves_energy_then_defends_lane_that_is_under_pressure(self):
        for side in Side:
            with self.subTest(side=side):
                game = arranged(amber=("wick", "patch", "squall", "rivet"),
                                indigo=("wick", "patch", "squall", "rivet"))
                game.players[side].energy = 2
                pilot = Pilot(4, side)
                self.assertIsNone(pilot.choose(game))
                place(game, side.other, Lane.CANAL, "ballast", side.base + 3 * side.direction)
                before = document(game)
                self.assertEqual(pilot.choose(game), Move(0, Lane.CANAL))
                self.assertEqual(document(game), before)

    def test_uses_burst_or_repair_when_the_board_calls_for_it(self):
        game = arranged(amber=("squall", "ballast", "rivet", "drum"))
        game.players[Side.AMBER].energy = 3
        for cell in (5, 5, 6):
            place(game, Side.INDIGO, Lane.CANAL, "clip", cell)
        self.assertEqual(Pilot(0, Side.AMBER).choose(game), Move(0, Lane.CANAL))

        game = arranged(indigo=("patch", "squall", "loom", "rivet"))
        game.players[Side.INDIGO].energy = 2
        game.towers[Side.INDIGO][Lane.ROOF].hp = 55
        self.assertEqual(Pilot(0, Side.INDIGO).choose(game), Move(0, Lane.ROOF))

    def test_pilots_consider_an_order_once_per_second_and_stop_at_finish(self):
        game = arranged(limit=2)
        pilot = Pilot(0, Side.INDIGO)
        self.assertIsNotNone(pilot.choose(game))
        game.step()
        self.assertIsNone(pilot.choose(game))
        game.step()
        self.assertIsNone(pilot.choose(game))

    def test_same_seed_and_choices_reproduce_a_full_match(self):
        setup = Setup.deal(2**32 - 1, amber="trestle", indigo="awning")
        first = simulate(setup)
        second = simulate(setup)
        self.assertEqual(document(first), document(second))
        self.assertEqual(first.events, second.events)
        self.assertIsNotNone(first.outcome)
        self.assertNotEqual(document(first)["plays"], document(simulate(Setup.deal(0)))["plays"])

    def test_seeded_matches_preserve_invariants_after_every_beat(self):
        seen_cards, seen_lanes, seen_sides = set(), set(), set()
        for seed in range(12):
            with self.subTest(seed=seed):
                amber = "awning" if seed % 2 else "trestle"
                indigo = "awning" if seed % 3 else "trestle"
                setup = Setup.deal(seed, amber=amber, indigo=indigo)
                game = Battle(setup)
                pilots = [Pilot(seed, side) for side in Side]
                while game.outcome is None:
                    orders = [pilot.choose(game) for pilot in pilots]
                    for side, move in zip(Side, orders):
                        if move is not None:
                            self.assertIsNone(game.problem(side, move))
                            seen_cards.add(game.players[side].hand[move.slot])
                            seen_lanes.add(move.lane)
                            seen_sides.add(side)
                    game.step(*orders)
                    self.assertLessEqual(game.tick, setup.limit_ticks)
                    for side in Side:
                        player = game.players[side]
                        self.assertTrue(0 <= player.energy <= MAX_ENERGY)
                        self.assertEqual((len(player.hand), len(player.reserve)), (4, 4))
                        self.assertCountEqual(player.hand + player.reserve, setup.opening[side])
                        self.assertTrue(all(0 <= t.hp <= TOWER_HP for t in game.towers[side]))
                    self.assertEqual(len({u.uid for u in game.units}), len(game.units))
                    for unit in game.units:
                        self.assertTrue(0 < unit.hp <= CARDS[unit.card].troop.hp)
                        self.assertTrue(0 < unit.cell < FAR_TOWER)
        self.assertEqual(seen_sides, set(Side))
        self.assertEqual(seen_lanes, set(Lane))
        self.assertTrue({"squall", "patch", "clip", "rivet"} <= seen_cards)
