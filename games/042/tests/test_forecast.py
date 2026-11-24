import unittest
from datetime import date
from fractions import Fraction
from random import Random

from game2048.ai import forecast_move
from game2048.display import render_preview
from game2048.engine import EMPTY_BOARD, Game
from game2048.puzzles import PUZZLES
from game2048.session import DAILY_MOVES, Position, Session
from tests import STUCK


class ForecastTests(unittest.TestCase):
    def test_corner_merge_weights_each_square_and_tile_value(self):
        board = ((2, 2, 0, 0), *EMPTY_BOARD[1:])
        forecast = forecast_move(board, "left")
        self.assertEqual(forecast.board, ((4, 0, 0, 0), *EMPTY_BOARD[1:]))
        self.assertEqual(forecast.merge_points, 4)
        # Six of fifteen empty cells share the 4's row or column. Only a 4 there can merge.
        self.assertEqual(forecast.replies, {8: Fraction(1, 25), 0: Fraction(24, 25)})
        self.assertEqual(sum(forecast.replies.values()), 1)
        text = render_preview(Session(Game(board), Random(12)), "left")
        self.assertIn("+8 points   4.0%", text)
        self.assertIn("+0 points   96.0%", text)
        self.assertNotIn("No legal slide", text)

    def test_last_square_distinguishes_loss_from_a_zero_point_slide(self):
        for neighbor, expected in (
            (2, {4: Fraction(9, 10), None: Fraction(1, 10)}),
            (4, {8: Fraction(1, 10), None: Fraction(9, 10)}),
            (32, {None: Fraction(1)}),
        ):
            board = ((0, 8, 16, neighbor), (32, 64, 128, 256),
                     (512, 1024, 2, 4), (8, 16, 32, 64))
            with self.subTest(neighbor=neighbor):
                self.assertEqual(forecast_move(board, "left").replies, expected)
                self.assertIn(f"No legal slide   {float(expected[None]):.1%}",
                              render_preview(Session(Game(board), Random(1)), "left"))

    def test_forecast_counts_all_merges_in_the_best_reply(self):
        board = ((2, 2, 4, 4), (2, 2, 4, 4), *EMPTY_BOARD[2:])
        forecast = forecast_move(board, "left")
        self.assertEqual(forecast.merge_points, 24)
        self.assertEqual(forecast.replies, {24: Fraction(1)})

    def test_blocked_and_invalid_directions(self):
        for board in (EMPTY_BOARD, STUCK, ((2, 0, 0, 0), *EMPTY_BOARD[1:])):
            self.assertIsNone(forecast_move(board, "left"))
        with self.assertRaises(ValueError):
            forecast_move(EMPTY_BOARD, "north")

    def test_preview_identifies_the_last_turn_without_changing_the_session(self):
        puzzle = PUZZLES["double-merge"]
        sprint = Session(Game(puzzle.board, moves=DAILY_MOVES - 1), Random(2), day=date(2026, 2, 3))
        solved = Session.new(puzzle=puzzle)
        self.assertTrue(solved.move("left"))
        out_of_turns = Session(Game(puzzle.board, moves=1), Random(3), puzzle=puzzle)
        capped = Session(Game(puzzle.board, moves=13), Random(4))
        for session, limit, ending in (
            (sprint, None, "sprint complete"), (solved, None, "solved"),
            (out_of_turns, None, "out of slides"), (capped, 14, "move limit"),
        ):
            with self.subTest(ending=ending):
                before = Position.capture(session.game, session.rng)
                report = render_preview(session, "left", limit)
                self.assertIn(ending, report)
                self.assertNotIn("following slide", report)
                self.assertEqual(Position.capture(session.game, session.rng), before)
