import unittest
from functools import cache

from games import CONNECT_FOUR, TIC_TAC_TOE
from tactics import inspect_tactics
from tests import reference, replay


def reference_tactics(cells, mark, order, children, outcome):
    """Build the three-ply evidence independently on string boards."""
    expected = {}
    if outcome(cells) is not None:
        return expected
    opponent = "O" if mark == "X" else "X"
    for move, child in children(cells, mark).items():
        end = outcome(child)
        if end is not None:
            expected[move] = (end, (), ())
            continue

        replies = children(child, opponent)
        losses = tuple(r for r in order if r in replies and outcome(replies[r]) == opponent)
        answers = []
        for reply in order:
            if reply not in replies or outcome(replies[reply]) is not None:
                continue
            finishes = children(replies[reply], mark)
            for win in order:
                if win in finishes and outcome(finishes[win]) == mark:
                    answers.append((reply, win))
                    break
        expected[move] = (None, losses, tuple(answers) if len(answers) == len(replies) else ())
    return expected


class TacticsTests(unittest.TestCase):
    def assert_report(self, board, expected):
        report = inspect_tactics(board)
        self.assertEqual(tuple(row.move for row in report),
                         tuple(m for m in board.rules.move_order if m in expected))
        self.assertEqual({r.move: (r.outcome, r.winning_replies, r.winning_answers) for r in report},
                         expected)
        wins = tuple(m for m in board.rules.move_order if m in expected and expected[m][0] == board.turn)
        self.assertEqual(tuple(board.winning_moves()), wins)

    def test_all_tactical_verdicts_and_reply_proofs_on_every_reachable_tic_tac_toe_board(self):
        outcome = cache(reference.ttt_outcome)
        children = cache(lambda cells, mark: reference.ttt_children(cells))
        count = 0
        for cells, moves in reference.ttt_positions():
            board = replay(TIC_TAC_TOE, moves)
            expected = reference_tactics(cells, board.turn, TIC_TAC_TOE.move_order, children, outcome)
            self.assert_report(board, expected)
            count += 1
        self.assertEqual(count, 5478)

    def test_connect_four_evidence_on_forks_floating_gaps_full_columns_and_endgames(self):
        for moves in (
            (3, 7, 4, 7), (1, 7, 2, 7, 3), (7, 1, 1, 2, 2, 3, 3, 7), (4,) * 6,
            reference.C4_DRAW[:-2], reference.C4_DRAW[:-1], reference.C4_LAST_WIN[:-1],
            reference.C4_LAST_WIN, reference.C4_DRAW,
        ):
            with self.subTest(moves=moves):
                board = replay(CONNECT_FOUR, moves)
                expected = reference_tactics(reference.c4_replay(moves), board.turn, CONNECT_FOUR.move_order,
                                            reference.c4_children, reference.c4_outcome)
                self.assert_report(board, expected)

    def test_two_distinct_winning_replies_and_a_counter_win(self):
        # X has open ends in columns 1 and 5. O can finish in column 7 first.
        board = replay(CONNECT_FOUR, (2, 7, 3, 7, 4, 7, 2))
        report = {row.move: row for row in inspect_tactics(board)}
        self.assertEqual(report[6].winning_replies, (5, 1))
        self.assertEqual(report[6].winning_answers, ())
        self.assertEqual(report[7].outcome, "O")
        self.assertEqual((report[7].winning_replies, report[7].winning_answers), ((), ()))
