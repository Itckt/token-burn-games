import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from ai import analyze_position
from games import CONNECT_FOUR, TIC_TAC_TOE
from play import run_puzzle
from puzzles import PUZZLES, Puzzle
from tests import replay


def can_force_win(board, player, plies):
    """Try every reply using only legal moves and game outcomes."""
    if board.outcome is not None or plies == 0:
        return board.outcome == player
    wins = (can_force_win(child, player, plies - 1) for _, child in board.successors())
    return any(wins) if board.turn == player else all(wins)


class PuzzleTests(unittest.TestCase):
    def test_every_catalog_goal_against_all_replies_at_short_and_long_horizons(self):
        for rules, catalog in PUZZLES.items():
            for name, puzzle in catalog.items():
                with self.subTest(game=rules.title, puzzle=name):
                    board = replay(rules, puzzle.opening)
                    self.assertIsNone(board.outcome)
                    solutions = set()
                    for move, child in board.successors():
                        if puzzle.win_in is None:
                            solves = not can_force_win(child, child.turn, 1)
                        else:
                            solves = can_force_win(child, board.turn, puzzle.plies - 1)
                        if solves:
                            solutions.add(move)
                    self.assertTrue(solutions)
                    self.assertLess(len(solutions), len(board.legal_moves()))
                    for depth in (puzzle.plies, puzzle.plies + 2):
                        analysis = analyze_position(board, depth)
                        accepted = {m.move for m in analysis.ranked_moves if puzzle.accepts(board, m.score)}
                        self.assertEqual(accepted, solutions)
                        self.assertIn(analysis.line[0], solutions)

    def test_both_open_ended_threats_solve_two_exits(self):
        puzzle = PUZZLES[CONNECT_FOUR]["two-exits"]
        board = replay(CONNECT_FOUR, puzzle.opening)
        choices = analyze_position(board, puzzle.plies).ranked_moves
        self.assertEqual({m.move for m in choices if puzzle.accepts(board, m.score)}, {2, 5})

    def test_wins_on_different_turns_respect_the_stated_deadline(self):
        one_turn = PUZZLES[TIC_TAC_TOE]["first-finish"]
        two_turns = Puzzle(one_turn.opening, win_in=2)
        board = replay(TIC_TAC_TOE, one_turn.opening)
        choices = analyze_position(board).ranked_moves
        self.assertEqual({m.move for m in choices if one_turn.accepts(board, m.score)}, {9})
        self.assertEqual({m.move for m in choices if two_turns.accepts(board, m.score)}, {4, 6, 7, 9})

    def test_defending_one_reply_counts_even_in_a_later_forced_loss(self):
        puzzle = Puzzle((9, 8, 6))
        board = replay(TIC_TAC_TOE, puzzle.opening)
        choices = analyze_position(board).ranked_moves
        self.assertTrue(can_force_win(board, "X", 4))
        self.assertEqual({m.move for m in choices if puzzle.accepts(board, m.score)}, {3})

    def test_custom_puzzles_reject_invalid_deadlines_and_explicit_search_depths(self):
        puzzle = PUZZLES[TIC_TAC_TOE]["first-finish"]
        for value in (0, -1, True, False, 1.5, "2"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "positive whole number"):
                    Puzzle((), win_in=value)
                with self.assertRaisesRegex(ValueError, "positive integer"):
                    run_puzzle(TIC_TAC_TOE, "practice", puzzle, value, False)

    def test_finished_or_unsolvable_custom_puzzles_stop_before_prompting(self):
        for puzzle, message in (
            (Puzzle((1, 4, 2, 5, 3), win_in=1), "X wins!"),
            (Puzzle((1, 2, 3, 5, 4, 6, 8, 7, 9)), "Draw."),
            (Puzzle((), win_in=1), "No legal move meets this goal."),
        ):
            with self.subTest(puzzle=puzzle), redirect_stdout(StringIO()) as output:
                with patch("builtins.input", side_effect=AssertionError("unexpected puzzle prompt")):
                    run_puzzle(TIC_TAC_TOE, "practice", puzzle, None, True)
                self.assertEqual(output.getvalue().splitlines()[-1], message)
                if message in ("X wins!", "Draw."):
                    self.assertIn("nodes 1 | cutoffs 0", output.getvalue())
