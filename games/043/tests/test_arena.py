import unittest

from arena import OPENINGS, play_pair
from games import CONNECT_FOUR, DRAW, TIC_TAC_TOE, GameHistory, InvalidHistory
from tests import reference


class ArenaTests(unittest.TestCase):
    def test_seats_swap_and_the_same_opening_is_snapshotted_for_both_games(self):
        opening = GameHistory(TIC_TAC_TOE, (1, 5, 9))
        pair = play_pair(opening, 1, 9)
        first = next(pair)
        opening.play(2)
        second = next(pair)
        self.assertEqual(list(pair), [])
        self.assertEqual((first.x_engine, first.o_engine), ("A", "B"))
        self.assertEqual((second.x_engine, second.o_engine), ("B", "A"))
        self.assertEqual((first.outcome, second.outcome), ("O", "X"))
        for game in (first, second):
            self.assertEqual(game.moves[:3], (1, 5, 9))
            self.assertEqual(len(game.searches), len(game.moves) - 3)
            self.assertEqual(game.searches[0][0], game.o_engine)
            self.assertEqual(game.winner, "B")
        self.assertEqual(opening.moves, (1, 5, 9, 2))

    def test_connect_four_decisions_and_winner_match_independent_play_in_each_seat(self):
        depths = {"A": 1, "B": 3}
        for opening in ((3, 7, 4, 7), reference.C4_LAST_WIN[:-5], reference.C4_DRAW[:-6]):
            record = GameHistory(CONNECT_FOUR, opening)
            for game in play_pair(record, depths["A"], depths["B"]):
                with self.subTest(opening=opening, x=game.x_engine):
                    rows = reference.c4_replay(opening)
                    self.assertEqual(game.moves[:len(opening)], opening)
                    decisions = zip(game.moves[len(opening):], game.searches, strict=True)
                    for ply, (move, (engine, result)) in enumerate(decisions, len(opening)):
                        mark = "XO"[ply % 2]
                        self.assertEqual(engine, game.x_engine if mark == "X" else game.o_engine)
                        self.assertIsNone(reference.c4_outcome(rows))
                        depth = min(depths[engine], 42 - ply)
                        score, best_moves = reference.c4_minimax(rows, mark, depth)
                        best = next(m for m in CONNECT_FOUR.move_order if m in best_moves)
                        self.assertEqual((result.move, move, result.depth), (best, best, depth))
                        self.assertEqual(result.score, score if mark == "X" else -score)
                        rows = reference.c4_children(rows, mark)[move]
                    self.assertEqual(reference.c4_outcome(rows), game.outcome)
                    self.assertIsNotNone(game.outcome)
                    winner = {"X": game.x_engine, "O": game.o_engine, DRAW: None}[game.outcome]
                    self.assertEqual(game.winner, winner)
            self.assertEqual(record.moves, opening)

    def test_equal_engines_repeat_each_book_opening_and_both_seats_obey_the_budget(self):
        for rules, openings in OPENINGS.items():
            self.assertIn((), openings)
            self.assertEqual(len(set(openings)), 3)
            for moves in openings:
                with self.subTest(game=rules.title, moves=moves):
                    first, second = play_pair(GameHistory(rules, moves), 4, 4, node_budget=25)
                    self.assertEqual(first.moves, second.moves)
                    self.assertEqual(first.outcome, second.outcome)
                    for game in (first, second):
                        self.assertEqual(game.moves[:len(moves)], moves)
                        self.assertEqual(GameHistory(rules, game.moves).position.outcome, game.outcome)
                        for _, result in game.searches:
                            self.assertLessEqual(result.nodes, 25)
                            self.assertGreater(result.nodes, 0)

    def test_finished_openings_and_invalid_depths_are_rejected(self):
        for rules, moves in ((TIC_TAC_TOE, (1, 4, 2, 5, 3)), (CONNECT_FOUR, reference.C4_DRAW)):
            with self.assertRaisesRegex(InvalidHistory, "unfinished"):
                play_pair(GameHistory(rules, moves), 1, 2)
        for depths in ((0, 1), (2, -1), (True, 1), (1, "2")):
            with self.subTest(depths=depths), self.assertRaisesRegex(ValueError, "depth"):
                play_pair(GameHistory(TIC_TAC_TOE), *depths)
