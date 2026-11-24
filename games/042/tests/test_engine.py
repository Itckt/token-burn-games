import unittest
from itertools import product
from random import Random
from unittest.mock import Mock

from game2048.engine import (
    DIRECTIONS, EMPTY_BOARD, Game, empty_cells, has_moves, legal_moves,
    place_tile, slide, spawn_tile,
)
from tests import STUCK

ZERO = (0, 0, 0, 0)


def push_to_wall(line):
    """Independent reference that moves each tile one square at a time."""
    wall = [0, 0, 0, 0]
    sealed = set()
    score = 0
    for start, tile in enumerate(line):
        if not tile:
            continue
        pos = start
        while pos > 0 and wall[pos - 1] == 0:
            pos -= 1
        if pos > 0 and wall[pos - 1] == tile and pos - 1 not in sealed:
            wall[pos - 1] *= 2
            sealed.add(pos - 1)
            score += wall[pos - 1]
        else:
            wall[pos] = tile
    return tuple(wall), score


class SlideTests(unittest.TestCase):
    def test_merge_examples(self):
        examples = [
            ((2, 2, 2, 2), (4, 4, 0, 0), 8),
            ((2, 2, 4, 0), (4, 4, 0, 0), 4),
            ((4, 0, 4, 4), (8, 4, 0, 0), 8),
            ((2, 0, 4, 2), (2, 4, 2, 0), 0),
            ((2, 2, 4, 4), (4, 8, 0, 0), 12),
            ((2048, 2048, 0, 0), (4096, 0, 0, 0), 4096),
        ]
        for row, merged, points in examples:
            with self.subTest(row=row):
                self.assertEqual(slide((row, ZERO, ZERO, ZERO), "left"),
                                 ((merged, ZERO, ZERO, ZERO), points))

    def test_every_four_cell_line_in_all_directions(self):
        def horizontal(row):
            return (ZERO, row, ZERO, ZERO)

        def vertical(row):
            return tuple((0, 0, tile, 0) for tile in row)

        for line in product((0, 2, 4, 8), repeat=4):
            forward, fgain = push_to_wall(line)
            backward, bgain = push_to_wall(line[::-1])
            cases = [
                ("left", horizontal, forward, fgain),
                ("right", horizontal, backward[::-1], bgain),
                ("up", vertical, forward, fgain),
                ("down", vertical, backward[::-1], bgain),
            ]
            for direction, layout, expected, points in cases:
                with self.subTest(line=line, direction=direction):
                    self.assertEqual(slide(layout(line), direction),
                                     (layout(expected), points))

    def test_tile_sum_and_score_on_random_complete_boards(self):
        def potential(board):
            return sum(v * (v.bit_length() - 1) for row in board for v in row)

        rng = Random(153)
        for _ in range(80):
            board = tuple(tuple(rng.choices((0, 2, 4, 8, 16, 32), k=4))
                          for _ in range(4))
            for direction in DIRECTIONS:
                moved, points = slide(board, direction)
                with self.subTest(board=board, direction=direction):
                    self.assertEqual(sum(map(sum, moved)), sum(map(sum, board)))
                    self.assertEqual(potential(moved) - potential(board), points)
            self.assertEqual(has_moves(board), bool(list(legal_moves(board))))

    def test_legal_directions_and_terminal_states(self):
        corner = ((2, 0, 0, 0), ZERO, ZERO, ZERO)
        self.assertEqual([d for d, _, _ in legal_moves(corner)], ["right", "down"])
        for board in (EMPTY_BOARD, STUCK):
            self.assertFalse(has_moves(board))
            self.assertEqual(list(legal_moves(board)), [])
        self.assertTrue(has_moves(corner))
        # On each full board the only pair is at the far edge of one axis.
        for pair in (16, 32):
            board = ((2, 4, 2, 4), (4, 2, 4, 2), (2, 4, 2, 16), (4, 2, 32, pair))
            self.assertTrue(has_moves(board))
            expected = {"up", "down"} if pair == 16 else {"left", "right"}
            self.assertEqual({d for d, _, _ in legal_moves(board)}, expected)


class SpawnTests(unittest.TestCase):
    def test_each_empty_cell_is_offered_and_probability_boundary_is_exact(self):
        board = ((0, 8, 0, 16), *STUCK[1:])
        cells = [(0, 0), (0, 2)]
        self.assertEqual(empty_cells(board), cells)
        for cell, (draw, expected) in product(cells, [(0, 2), (0.89999, 2),
                                                      (0.9, 4), (0.99999, 4)]):
            with self.subTest(cell=cell, draw=draw):
                rng = Mock(spec=Random)
                rng.choice.return_value = cell
                rng.random.return_value = draw
                spawned = spawn_tile(board, rng)
                self.assertEqual(spawned[cell[0]][cell[1]], expected)
                differences = [(r, c) for r in range(4) for c in range(4)
                               if spawned[r][c] != board[r][c]]
                self.assertEqual(differences, [cell])
                rng.choice.assert_called_once_with(cells)
                rng.random.assert_called_once_with()

    def test_full_board_does_not_draw_randomness(self):
        rng = Mock(spec=Random)
        self.assertEqual(spawn_tile(STUCK, rng), STUCK)
        self.assertEqual(rng.mock_calls, [])

    def test_cannot_spawn_on_an_occupied_cell(self):
        with self.assertRaises(ValueError):
            place_tile(STUCK, (0, 0), 4)

    def test_spawn_position_must_be_on_the_board(self):
        for cell in ((-1, 0), (0, -1), (4, 0), (0, 4), (True, 0), (0, 0.5)):
            with self.subTest(cell=cell), self.assertRaises(IndexError):
                place_tile(EMPTY_BOARD, cell, 2)

    def test_placing_a_tile_rejects_values_that_break_the_board_invariant(self):
        for tile in (0, 1, -2, 3, 6, 4.0, True, "2"):
            with self.subTest(tile=tile), self.assertRaises(ValueError):
                place_tile(EMPTY_BOARD, (0, 0), tile)
        self.assertEqual(place_tile(EMPTY_BOARD, (0, 0), 4096)[0][0], 4096)


class GameTests(unittest.TestCase):
    def test_new_game_has_two_tiles_and_replays_from_seed(self):
        for seed in range(20):
            game = Game.new(Random(seed))
            tiles = [v for row in game.board for v in row if v]
            self.assertEqual(len(tiles), 2)
            self.assertLessEqual(set(tiles), {2, 4})
            self.assertEqual((game.score, game.moves), (0, 0))
            self.assertEqual(game, Game.new(Random(seed)))

    def test_successful_turn_scores_all_merges_then_spawns_one_tile(self):
        board = ((2, 2, 0, 0), (4, 0, 4, 0), ZERO, ZERO)
        game = Game(board, score=100, moves=10)
        rng = Mock(spec=Random)
        rng.choice.return_value = (0, 1)  # Occupied until the slide frees it.
        rng.random.return_value = 0.95
        self.assertTrue(game.move("left", rng))
        self.assertEqual(game.board, ((4, 4, 0, 0), (8, 0, 0, 0), ZERO, ZERO))
        self.assertEqual((game.score, game.moves, game.largest), (112, 11, 8))
        self.assertEqual(board[0], (2, 2, 0, 0))
        rng.choice.assert_called_once()
        rng.random.assert_called_once()

    def test_blocked_and_unknown_moves_preserve_state_and_random_stream(self):
        board = ((2, 4, 0, 0), ZERO, ZERO, ZERO)
        game = Game(board, score=20, moves=3)
        rng = Random(82)
        before = rng.getstate()
        self.assertFalse(game.move("left", rng))
        with self.assertRaises(ValueError):
            game.move("diagonal", rng)
        self.assertEqual(game, Game(board, score=20, moves=3))
        self.assertEqual(rng.getstate(), before)

    def test_slide_without_merge_still_counts_a_turn_and_spawns(self):
        game = Game(((0, 0, 0, 8), ZERO, ZERO, ZERO))
        self.assertTrue(game.move("left", Random(1)))
        self.assertEqual((game.score, game.moves, game.board[0][0]), (0, 1, 8))
        self.assertEqual(len(empty_cells(game.board)), 14)
