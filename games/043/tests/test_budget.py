import unittest
from itertools import accumulate

from ai import WIN_SCORE, choose_move
from games import CONNECT_FOUR, TIC_TAC_TOE, Position
from tests import reference, replay


class NodeBudgetTests(unittest.TestCase):
    def test_one_node_uses_a_legal_fallback_and_the_static_score_for_the_mover(self):
        for rules, moves, fallback in (
            (TIC_TAC_TOE, (5,), 1), (CONNECT_FOUR, (4,), 4), (CONNECT_FOUR, (4,) * 6, 3),
        ):
            with self.subTest(game=rules.title, moves=moves):
                board = replay(rules, moves)
                result = choose_move(board, node_budget=1)
                self.assertEqual((result.move, result.depth, result.nodes), (fallback, 0, 1))
                self.assertEqual((result.cutoffs, result.cache_hits), (0, 0))
                if rules == CONNECT_FOUR:
                    x_score = sum(reference.c4_window_value(line)
                                  for line in reference.c4_windows(reference.c4_replay(moves)))
                    self.assertEqual(result.score, x_score if board.turn == "X" else -x_score)
                else:
                    self.assertEqual(result.score, -4)

    def test_partial_deeper_search_keeps_the_last_complete_move_and_charges_all_visits(self):
        for rules, moves in ((TIC_TAC_TOE, (9, 8, 6)), (CONNECT_FOUR, (4, 3, 5, 2, 4))):
            board = replay(rules, moves)
            fixed = [choose_move(board, depth) for depth in range(1, 5)]
            costs = list(accumulate(result.nodes for result in fixed))
            budgets = {cost + delta for cost in costs for delta in (-1, 0, 1)}
            for budget in sorted(budgets):
                with self.subTest(game=rules.title, budget=budget):
                    result = choose_move(board, 4, node_budget=budget)
                    completed = sum(cost <= budget for cost in costs)
                    self.assertEqual(result.depth, completed)
                    self.assertEqual(result.nodes, min(budget, costs[-1]))
                    self.assertEqual(result, choose_move(board, 4, node_budget=budget))
                    if completed:
                        best = fixed[completed - 1]
                        self.assertEqual((result.move, result.score), (best.move, best.score))
                        if budget == costs[completed - 1] or completed == 4:
                            self.assertEqual(result.cache_hits, sum(r.cache_hits for r in fixed[:completed]))
                            self.assertEqual(result.cutoffs, sum(r.cutoffs for r in fixed[:completed]))
                    else:
                        self.assertEqual(result.move, board.legal_moves()[0])

    def test_budgeted_endgame_matches_unpruned_search_and_caps_at_the_empty_cells(self):
        for moves in (reference.C4_LAST_WIN[:-6], reference.C4_DRAW[:-5]):
            with self.subTest(moves=moves):
                board = replay(CONNECT_FOUR, moves)
                rows = reference.c4_replay(moves)
                result = choose_move(board, 100, node_budget=10_000)
                score, best = reference.c4_minimax(rows, board.turn, board.remaining)
                self.assertEqual(result.depth, board.remaining)
                self.assertEqual(result.score, score if board.turn == "X" else -score)
                self.assertEqual(result.move, next(move for move in CONNECT_FOUR.move_order if move in best))
                self.assertLess(result.nodes, 10_000)

    def test_finished_boards_cost_one_node_and_have_no_fallback(self):
        for rules, history, score in (
            (TIC_TAC_TOE, (1, 4, 2, 5, 3), -WIN_SCORE - 4),
            (CONNECT_FOUR, reference.C4_LAST_WIN, -WIN_SCORE),
            (CONNECT_FOUR, reference.C4_DRAW, 0),
        ):
            with self.subTest(game=rules.title, score=score):
                result = choose_move(replay(rules, history), node_budget=1)
                self.assertEqual((result.move, result.depth, result.score, result.nodes), (None, 0, score, 1))

    def test_invalid_limits_are_rejected_even_on_a_terminal_board(self):
        for board in (Position(TIC_TAC_TOE), replay(CONNECT_FOUR, reference.C4_DRAW)):
            for budget in (0, -1, False, True, 1.5, "3"):
                with self.subTest(budget=budget), self.assertRaisesRegex(ValueError, "Node budget"):
                    choose_move(board, node_budget=budget)
            with self.assertRaisesRegex(ValueError, "depth"):
                choose_move(board, False, node_budget=1)
