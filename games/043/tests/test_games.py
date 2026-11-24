import unittest

from games import CONNECT_FOUR, DRAW, TIC_TAC_TOE, GameHistory, InvalidHistory, Position
from tests import reference, replay


def rows_of(board):
    return tuple(
        "".join(board.cell_at(row, col) or "." for col in range(board.rules.columns))
        for row in range(board.rules.rows)
    )


class RulesTests(unittest.TestCase):
    def test_all_reachable_tic_tac_toe_boards(self):
        count = 0
        for cells, history in reference.ttt_positions():
            board = replay(TIC_TAC_TOE, history)
            outcome = reference.ttt_outcome(cells)
            self.assertEqual("".join(rows_of(board)), cells, history)
            self.assertEqual(board.outcome, outcome, cells)
            self.assertEqual(board.turn, "XO"[len(history) % 2], cells)
            self.assertEqual(board.remaining, cells.count("."), cells)
            legal = set(reference.ttt_children(cells)) if outcome is None else set()
            self.assertEqual(set(board.legal_moves()), legal, cells)
            count += 1
        self.assertEqual(count, 5478)

    def test_connect_four_successors_against_two_complete_games(self):
        for moves, final_result in ((reference.C4_DRAW, DRAW), (reference.C4_LAST_WIN, "O")):
            board = Position(CONNECT_FOUR)
            rows = reference.C4_EMPTY
            for ply, move in enumerate(moves):
                with self.subTest(final_result=final_result, ply=ply):
                    self.assertIsNone(board.outcome)
                    self.assertIsNone(reference.c4_outcome(rows))
                    mark = "XO"[ply % 2]
                    self.assertEqual(board.turn, mark)
                    children = reference.c4_children(rows, mark)
                    self.assertEqual(set(board.legal_moves()), set(children))
                    self.assertEqual(
                        {number: rows_of(child) for number, child in board.successors()},
                        children,
                    )
                    rows = children[move]
                    board = board.play(move)
                    self.assertEqual(rows_of(board), rows)
            self.assertEqual(board.remaining, 0)
            self.assertEqual(reference.c4_outcome(rows), final_result)
            self.assertEqual(board.outcome, final_result)

    def test_connect_four_wins_in_each_direction(self):
        rising = (1, 2, 2, 3, 5, 3, 3, 4, 5, 4, 6, 4, 4)
        cases = (
            ("horizontal", (1, 7, 2, 7, 3, 6, 4), "X"),
            ("vertical", (1, 4, 2, 4, 1, 4, 2, 4), "O"),
            ("rising diagonal", rising, "X"),
            ("falling diagonal", tuple(8 - move for move in rising), "X"),
            ("second-player diagonal", (7,) + rising, "O"),
        )
        for direction, moves, winner in cases:
            with self.subTest(direction=direction):
                board = replay(CONNECT_FOUR, moves[:-1])
                self.assertIsNone(board.outcome)
                self.assertEqual(board.play(moves[-1]).outcome, winner)

    def test_full_column_stacks_bottom_up_and_rejects_another_disc(self):
        board = replay(CONNECT_FOUR, [1] * 6)
        self.assertEqual([board.cell_at(row, 0) for row in range(6)], list("OXOXOX"))
        self.assertEqual(set(board.legal_moves()), set(range(2, 8)))
        with self.assertRaisesRegex(ValueError, "column is full"):
            board.play(1)

    def test_occupied_square_and_independent_branches(self):
        start = Position(TIC_TAC_TOE)
        middle = start.play(5)
        left = middle.play(1)
        right = middle.play(3)
        self.assertEqual(rows_of(start), ("...", "...", "..."))
        self.assertEqual(rows_of(middle), ("...", ".X.", "..."))
        self.assertEqual(rows_of(left), ("O..", ".X.", "..."))
        self.assertEqual(rows_of(right), ("..O", ".X.", "..."))
        with self.assertRaisesRegex(ValueError, "square is occupied"):
            middle.play(5)

    def test_invalid_move_numbers_and_cell_coordinates(self):
        for rules, max_move in ((TIC_TAC_TOE, 9), (CONNECT_FOUR, 7)):
            board = Position(rules)
            for move in (-1, 0, max_move + 1, 1.5, "1", True, None):
                with self.subTest(game=rules.title, move=move), self.assertRaises(ValueError):
                    board.play(move)
            for row, col in ((-1, 0), (rules.rows, 0), (0, -1), (0, rules.columns)):
                with self.subTest(row=row, col=col), self.assertRaises(IndexError):
                    board.cell_at(row, col)
            for row, col in ((True, 0), (1, False), (0.0, 1), (2, "0")):
                with self.subTest(row=row, col=col), self.assertRaises(TypeError):
                    board.cell_at(row, col)

    def test_no_moves_after_a_win_or_draw(self):
        for rules, moves, outcome in (
            (TIC_TAC_TOE, (3, 1, 5, 2, 7), "X"),
            (TIC_TAC_TOE, (1, 2, 3, 5, 4, 6, 8, 7, 9), DRAW),
            (CONNECT_FOUR, (1, 2, 1, 2, 1, 2, 1), "X"),
            (CONNECT_FOUR, reference.C4_DRAW, DRAW),
        ):
            with self.subTest(game=rules.title, outcome=outcome):
                board = replay(rules, moves)
                self.assertEqual(board.outcome, outcome)
                self.assertEqual(board.legal_moves(), ())
                self.assertEqual(list(board.successors()), [])
                with self.assertRaisesRegex(ValueError, "game is over"):
                    board.play(1)


class HistoryTests(unittest.TestCase):
    def test_turns_record_the_position_before_the_move(self):
        moves = (4, 4, 1, 1, 3)
        game = GameHistory(CONNECT_FOUR, iter(moves))
        self.assertEqual(tuple(game.turns()), tuple(
            (replay(CONNECT_FOUR, moves[:ply]), move) for ply, move in enumerate(moves)
        ))
        self.assertEqual(game.position, replay(CONNECT_FOUR, moves))
        self.assertEqual(game.moves, moves)

    def test_undo_one_move_or_a_pair_and_branch_from_that_board(self):
        game = GameHistory(TIC_TAC_TOE, (1, 4, 2, 5, 3))
        won = game.position
        self.assertTrue(game.undo_turn(1))
        self.assertEqual(game.position, replay(TIC_TAC_TOE, (1, 4, 2, 5)))
        self.assertIsNone(game.position.outcome)
        self.assertTrue(game.undo_turn())
        game.play(9)
        self.assertEqual(game.moves, (1, 4, 9))
        self.assertEqual(game.position, replay(TIC_TAC_TOE, game.moves))
        self.assertEqual(won.outcome, "X")

    def test_short_or_invalid_undo_preserves_the_record(self):
        game = GameHistory(TIC_TAC_TOE, (5,))
        before = game.position
        self.assertFalse(game.undo_turn())
        self.assertFalse(game.undo_turn(3))
        for plies in (0, -1, True, 1.5):
            with self.subTest(plies=plies), self.assertRaises(ValueError):
                game.undo_turn(plies)
        self.assertIs(game.position, before)
        self.assertEqual(game.moves, (5,))
        self.assertTrue(game.undo_turn(1))
        self.assertFalse(game.undo_turn(1))
        self.assertEqual(tuple(game.turns()), ())

    def test_failed_play_is_atomic_and_openings_name_the_first_illegal_ply(self):
        game = GameHistory(TIC_TAC_TOE, (2,))
        with self.assertRaisesRegex(ValueError, "occupied"):
            game.play(2)
        self.assertEqual(game.moves, (2,))
        self.assertEqual(game.position, Position(TIC_TAC_TOE).play(2))
        for rules, moves, message in (
            (TIC_TAC_TOE, (5, 5, 0), r"Move 2 .*occupied"),
            (CONNECT_FOUR, (1,) * 7, r"Move 7 .*full"),
            (TIC_TAC_TOE, (1, 4, 2, 5, 3, 9), r"Move 6 .*over"),
        ):
            with self.subTest(moves=moves), self.assertRaisesRegex(InvalidHistory, message):
                GameHistory(rules, moves)
