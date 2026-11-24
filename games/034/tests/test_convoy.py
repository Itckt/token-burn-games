import unittest
from unittest.mock import Mock

from gutterlight.battle import FAR_TOWER, MIDFIELD, Lane, Mode, Move, Outcome, Setup, Side
from gutterlight.display import board
from gutterlight.pilot import Pilot, simulate
from gutterlight.recording import ReplayError, document, reconstruct
from gutterlight.sessions import play_live, practice_start
from tests.support import TimedConsole, arranged, place


AMBER, INDIGO = Side
ROOF, CANAL = Lane


class ConvoyTests(unittest.TestCase):
    def test_survivors_within_one_cell_push_once_per_whole_second(self):
        for side in Side:
            for offset in (-2, -1, 0, 1, 2):
                with self.subTest(side=side, offset=offset):
                    game = arranged(mode=Mode.CONVOY)
                    opening = game.frame()
                    for _ in range(3):
                        place(game, side, ROOF, "clip", MIDFIELD + offset, move_at=99)
                    game.step()
                    self.assertEqual(game.carts, [6, 6])
                    game.step()
                    push = side.direction if abs(offset) <= 1 else 0
                    self.assertEqual(game.carts, [6 + push, 6])
                    self.assertEqual(opening.carts, (6, 6))
                    game.step()
                    self.assertEqual(game.carts, [6 + push, 6])

    def test_both_lanes_move_and_an_unescorted_cart_stops_and_can_reverse(self):
        game = arranged(mode=Mode.CONVOY)
        escort = place(game, AMBER, ROOF, "wick", 5, move_at=99)
        place(game, INDIGO, CANAL, "clip", 6, move_at=99)
        game.step()
        game.step()
        self.assertEqual(game.carts, [7, 5])
        game.step()
        game.step()
        self.assertEqual(game.carts, [7, 4])
        self.assertEqual(escort.cell, 5)
        place(game, INDIGO, ROOF, "foil", 8, move_at=99)
        game.step()
        game.step()
        self.assertEqual(game.carts, [6, 4])

    def test_unequal_crews_contest_and_board_shows_units_at_the_cart(self):
        game = arranged(mode=Mode.CONVOY)
        for side in (INDIGO, AMBER, AMBER):
            place(game, side, ROOF, "ballast", 6, move_at=99, attack_at=99)
        for _ in range(4):
            game.step()
        self.assertEqual(game.carts, [6, 6])
        lines = board(game.frame(), "LIVE").splitlines()
        roof = next(i for i, line in enumerate(lines) if line.startswith("  Roof"))
        self.assertIn("><", lines[roof])
        self.assertIn("Cell 6, contested", lines[roof + 1])
        self.assertEqual(lines[roof].index("><"), lines[roof + 1].index("@"))
        for mode in (Mode.CLASSIC, Mode.BEACON):
            other = arranged(mode=mode)
            self.assertEqual(other.frame().carts, ())
            self.assertNotIn("Cart", board(other.frame(), "LIVE"))

    def test_sampling_follows_movement_and_lethal_combat(self):
        game = arranged(mode=Mode.CONVOY)
        game.step()
        place(game, INDIGO, CANAL, "wick", 8, move_at=2)
        place(game, INDIGO, ROOF, "wick", 7, hp=7)
        place(game, AMBER, ROOF, "wick", 6, hp=8)
        game.step()
        self.assertEqual(game.carts, [7, 5])
        self.assertEqual(len(game.in_lane(INDIGO, ROOF)), 0)

    def test_delivery_at_either_dock_wins_on_the_clock_and_double_delivery_draws(self):
        for first, second, expected in (
            (AMBER, None, Outcome(AMBER, "delivery")),
            (INDIGO, None, Outcome(INDIGO, "delivery")),
            (AMBER, AMBER, Outcome(AMBER, "delivery")),
            (INDIGO, AMBER, Outcome(None, "double delivery")),
        ):
            with self.subTest(first=first, second=second):
                game = arranged(mode=Mode.CONVOY, limit=2)
                for lane, side in zip(Lane, (first, second)):
                    if side is not None:
                        cell = side.other.base - side.direction
                        game.carts[lane] = cell
                        place(game, side, lane, "ballast", cell)
                game.step()
                self.assertIsNone(game.outcome)
                game.step()
                self.assertEqual(game.outcome, expected)
                self.assertEqual(game.carts[ROOF], first.other.base)
                self.assertIn(expected.text, board(game.frame(), "FINAL"))

    def test_tower_destruction_precedes_a_delivery_even_on_a_double_fall(self):
        for double in (False, True):
            with self.subTest(double=double):
                game = arranged(mode=Mode.CONVOY, limit=2)
                game.step()
                game.carts[ROOF] = FAR_TOWER - 1
                place(game, AMBER, ROOF, "rivet", FAR_TOWER - 1)
                place(game, INDIGO, CANAL, "rivet", 1)
                game.towers[AMBER][CANAL].hp = 1
                if double:
                    game.towers[INDIGO][ROOF].hp = 1
                game.step()
                self.assertEqual(game.carts[ROOF], FAR_TOWER)
                expected = Outcome(None, "double fall") if double else Outcome(INDIGO, "tower")
                self.assertEqual(game.outcome, expected)

    def test_clock_totals_signed_progress_then_hull_then_draw(self):
        for carts, hull, winner in (
            ((3, 10), 1, Outcome(AMBER, "convoy clock")),
            ((8, 3), 150, Outcome(INDIGO, "convoy clock")),
            ((2, 10), 100, Outcome(INDIGO, "clock")),
            ((4, 8), 150, Outcome(None, "convoy draw")),
        ):
            with self.subTest(carts=carts, hull=hull):
                game = arranged(mode=Mode.CONVOY, limit=1)
                game.carts[:] = carts
                game.towers[AMBER][CANAL].hp = hull
                game.step()
                self.assertEqual(game.outcome, winner)

    def test_pilots_spend_their_reserve_to_intercept_an_unguarded_cart(self):
        hand = ("wick", "patch", "squall", "rivet")
        for side in Side:
            with self.subTest(side=side):
                game = arranged(amber=hand, indigo=hand, mode=Mode.CONVOY)
                game.carts[CANAL] = side.base + 2 * side.direction
                game.players[side].energy = 2
                self.assertEqual(Pilot(27, side).choose(game), Move(0, CANAL))

    def test_live_dispatch_pushes_a_cart_and_practice_restores_its_position(self):
        game = arranged(mode=Mode.CONVOY)
        terminal = TimedConsole([(0.1, "1"), (0.2, "r"), (2.1, "q")])
        opponent = Mock(spec=Pilot)
        opponent.choose.return_value = None
        play_live(game, terminal, terminal.now, opponent=opponent)
        self.assertEqual((game.tick, game.carts), (4, [7, 6]))
        self.assertIn("Cell 7", terminal.screens[-1][1])
        tape = reconstruct(document(game))
        before, _, _ = practice_start(tape, 3)
        self.assertEqual(before.carts, [6, 6])
        before.step()
        self.assertEqual(before.frame(), game.frame())

    def test_tape_verifies_cart_positions_and_marks_the_first_push_on_each_lane(self):
        game = simulate(Setup.deal(27, mode=Mode.CONVOY))
        tape = reconstruct(document(game))
        self.assertEqual(tape.frames[-1], game.frame())
        marks = tape.highlights()
        for lane in Lane:
            first = next(f for f in tape.frames if f.carts[lane] != MIDFIELD)
            matching = [e for e in marks if f"First push on {lane.label}" in e.text]
            self.assertEqual([e.tick for e in matching], [first.tick])
        self.assertIn(game.outcome.text, marks[-1].text)
        game.carts[ROOF] -= 1
        with self.assertRaisesRegex(ReplayError, "fingerprint mismatch"):
            reconstruct(document(game))
