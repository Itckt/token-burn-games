import unittest
from fractions import Fraction
from random import Random

from game2048.ai import LOSS, _chance_value, choose_move, evaluate, rank_moves
from game2048.engine import DIRECTIONS, EMPTY_BOARD, Game, has_moves, legal_moves, slide
from tests import STUCK


def spawn_outcomes(board):
    """Build an independent probability distribution with exact fractions."""
    spaces = [(r, c) for r in range(4) for c in range(4) if board[r][c] == 0]
    for r, c in spaces:
        for tile, weight in ((2, 9), (4, 1)):
            rows = [list(row) for row in board]
            rows[r][c] = tile
            yield tuple(map(tuple, rows)), Fraction(weight, 10 * len(spaces))


def reference_scores(board, turns):
    """Enumerate the whole tree without caching, using the game's leaf heuristic."""
    scores = {}
    for direction in DIRECTIONS:
        moved, points = slide(board, direction)
        if moved == board:
            continue
        expected = Fraction(points)
        for child, probability in spawn_outcomes(moved):
            if turns == 1:
                future = evaluate(child)
            else:
                future = max(reference_scores(child, turns - 1).values(), default=LOSS)
            expected += probability * Fraction(future)
        scores[direction] = expected
    return scores


class ExpectimaxTests(unittest.TestCase):
    def test_all_move_values_match_an_exact_tree_at_three_depths(self):
        board = ((256, 2, 128, 256),
                 (0, 64, 32, 256),
                 (4, 32, 0, 64),
                 (8, 2, 256, 16))
        choices = []
        for depth in (1, 2, 3):
            exact = reference_scores(board, depth)
            for direction, moved, points in legal_moves(board):
                with self.subTest(depth=depth, direction=direction):
                    self.assertAlmostEqual(points + _chance_value(moved, depth - 1),
                                           float(exact[direction]), places=7)
            choices.append(choose_move(board, depth))
            self.assertEqual(choices[-1], max(exact, key=exact.get))
            advice = rank_moves(board, depth)
            self.assertEqual([entry.direction for entry in advice],
                             sorted(exact, key=exact.get, reverse=True))
            for entry in advice:
                moved, points = slide(board, entry.direction)
                self.assertEqual(entry.merge_points, points)
                self.assertAlmostEqual(entry.expected_value, float(exact[entry.direction]))
                risk = sum(prob for child, prob in spawn_outcomes(moved) if not has_moves(child))
                self.assertAlmostEqual(entry.loss_probability, float(risk))
        self.assertNotEqual(choices[0], choices[1])

    def test_real_spawn_odds_change_the_preferred_move(self):
        board = ((256, 32, 4, 128),
                 (128, 16, 0, 2),
                 (0, 128, 128, 4),
                 (128, 16, 64, 32))
        even_odds = {}
        worst_case = {}
        for direction, moved, points in legal_moves(board):
            scores = [points + evaluate(child) for child, _ in spawn_outcomes(moved)]
            even_odds[direction] = sum(scores) / len(scores)
            worst_case[direction] = min(scores)
        self.assertEqual(max(even_odds, key=even_odds.get), "down")
        self.assertEqual(max(worst_case, key=worst_case.get), "down")
        exact = reference_scores(board, 1)
        self.assertEqual(max(exact, key=exact.get), "left")
        self.assertEqual(choose_move(board, 1), "left")

    def test_last_spawn_can_end_the_game(self):
        board = ((0, 4, 2, 4), *STUCK[1:])
        survives_with_four = ((4, 4, 2, 4), *STUCK[1:])
        self.assertEqual(evaluate(STUCK), LOSS)
        self.assertGreater(evaluate(survives_with_four), LOSS)
        self.assertAlmostEqual(_chance_value(board, 0),
                               0.9 * LOSS + 0.1 * evaluate(survives_with_four))
        self.assertEqual(_chance_value(STUCK, 2), LOSS)

    def test_game_over_and_only_legal_move(self):
        self.assertIsNone(choose_move(STUCK))
        self.assertIsNone(choose_move(EMPTY_BOARD))
        board = tuple((v, 0, 0, 0) for v in (2, 4, 8, 16))
        self.assertEqual(choose_move(board), "right")

    def test_tie_uses_fixed_direction_order(self):
        board = ((0, 0, 0, 0), (0, 2, 2, 0), (0, 2, 2, 0), (0, 0, 0, 0))
        for depth in (1, 2):
            self.assertEqual(choose_move(board, depth), "up")
            self.assertEqual(tuple(entry.direction for entry in rank_moves(board, depth)), DIRECTIONS)

    def test_coach_reports_immediate_loss_not_long_term_search_value(self):
        for neighbor, expected in ((2, 0.1), (4, 0.9), (32, 1.0)):
            board = ((0, 8, 16, neighbor), (32, 64, 128, 256),
                     (512, 1024, 2, 4), (8, 16, 32, 64))
            for depth in (1, 2):
                with self.subTest(neighbor=neighbor, depth=depth):
                    advice = {entry.direction: entry for entry in rank_moves(board, depth)}
                    self.assertEqual(advice["left"].loss_probability, expected)
                    self.assertEqual(advice["left"].merge_points, 0)
        for terminal in (STUCK, EMPTY_BOARD):
            self.assertEqual(rank_moves(terminal), [])

    def test_invalid_search_depth(self):
        for depth in (0, -1, 1.5, True, False):
            for search in (choose_move, rank_moves):
                with self.subTest(depth=depth, search=search), self.assertRaises(ValueError):
                    search(STUCK, depth)

    def test_custom_board_with_merge_points_beyond_float_range(self):
        value = 1 << 1024
        board = ((value, value, 2, 4), (2, 4, 8, 16),
                 (4, 8, 16, 32), (8, 16, 32, 64))
        for depth in (1, 2):
            expected = reference_scores(board, depth)
            ranked = rank_moves(board, depth)
            self.assertEqual({a.direction: a.expected_value for a in ranked}, expected)
            self.assertEqual(choose_move(board, depth), max(expected, key=expected.get))

    def test_large_finite_merge_does_not_erase_a_fractional_advantage(self):
        tile = 1 << 60
        board = ((tile, tile, 0, 0), (8, 32, 32, 2), (4, 4, 4, 32), (0, 64, 4, 64))
        expected = reference_scores(board, 1)
        self.assertEqual(float(expected["right"]), float(expected["left"]))
        self.assertEqual(expected["right"] - expected["left"], Fraction(239, 10))
        self.assertEqual(choose_move(board, 1), "right")
        self.assertEqual({a.direction: a.expected_value for a in rank_moves(board, 1)}, expected)

    def test_heuristic_rewards_order_and_treats_all_corners_equally(self):
        orderly = ((512, 256, 128, 64), (4, 8, 16, 32), (0, 0, 0, 2), (0, 0, 0, 0))
        scrambled = ((256, 512, 64, 128), *orderly[1:])
        self.assertGreater(evaluate(orderly), evaluate(scrambled))
        self.assertEqual(evaluate(orderly), evaluate(orderly[::-1]))
        self.assertEqual(evaluate(orderly), evaluate(tuple(zip(*orderly))))

    def test_asking_for_hints_does_not_change_a_seeded_round(self):
        rng_a, rng_b = Random(63), Random(63)
        a, b = Game.new(rng_a), Game.new(rng_b)
        for _ in range(30):
            hint = choose_move(a.board)
            self.assertEqual(choose_move(a.board), hint)
            self.assertTrue(a.move(hint, rng_a))
            self.assertTrue(b.move(hint, rng_b))
            self.assertEqual(a, b)
        self.assertGreater(a.score, 0)
