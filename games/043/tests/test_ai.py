import unittest

from ai import WIN_SCORE, analyze_position, choose_move, plies_to_finish, review_game
from games import CONNECT_FOUR, TIC_TAC_TOE, GameHistory, Position
from tests import reference, replay


class SearchTests(unittest.TestCase):
    def test_optimal_score_and_move_on_every_tic_tac_toe_board(self):
        for cells, history in reference.ttt_positions():
            result = choose_move(replay(TIC_TAC_TOE, history))
            x_score, _ = reference.ttt_minimax(cells)
            self.assertEqual(result.score, x_score if len(history) % 2 == 0 else -x_score, cells)
            if reference.ttt_outcome(cells) is None:
                children = reference.ttt_children(cells)
                self.assertIn(result.move, children, cells)
                child_score, _ = reference.ttt_minimax(children[result.move])
                self.assertEqual(child_score, x_score, cells)
            else:
                self.assertIsNone(result.move, cells)

    def test_connect_four_agrees_with_unpruned_minimax(self):
        cases = (
            ((), 1),
            ((4,), 2),
            ((4, 3, 5, 2, 4), 3),
            ((3, 4, 3, 5, 5, 4, 2, 2), 4),
            (reference.C4_DRAW[:12], 3),
            (reference.C4_DRAW[:-8], 42),
            (reference.C4_LAST_WIN[:-7], 42),
        )
        for history, requested_depth in cases:
            with self.subTest(history=history, depth=requested_depth):
                rows = reference.c4_replay(history)
                mark = "XO"[len(history) % 2]
                depth = min(requested_depth, 42 - len(history))
                x_score, best_moves = reference.c4_minimax(rows, mark, depth)
                result = choose_move(replay(CONNECT_FOUR, history), requested_depth)
                self.assertEqual(result.depth, depth)
                self.assertEqual(result.score, x_score if mark == "X" else -x_score)
                self.assertIn(result.move, best_moves)

    def test_connect_four_takes_a_win_at_the_search_horizon(self):
        for history in ((1, 7, 2, 7, 3, 7), (1, 4, 2, 4, 7, 4, 7)):
            with self.subTest(history=history):
                board = replay(CONNECT_FOUR, history)
                result = choose_move(board, depth=1)
                self.assertEqual(result.move, 4)
                self.assertEqual(board.play(result.move).outcome, board.turn)
                self.assertEqual(result.score, WIN_SCORE + board.remaining - 1)

    def test_connect_four_blocks_a_forced_loss_for_either_side(self):
        for history, block in (((1, 7, 2, 7, 3), 4), ((2, 6, 1, 6, 2, 6), 6)):
            with self.subTest(history=history):
                result = choose_move(replay(CONNECT_FOUR, history), depth=2)
                self.assertEqual(result.move, block)

    def test_tied_moves_follow_deterministic_board_order(self):
        self.assertEqual(choose_move(Position(TIC_TAC_TOE)).move, 5)
        board = replay(CONNECT_FOUR, (2, 7, 3, 7, 4, 6))
        self.assertEqual(board.play(1).outcome, "X")
        self.assertEqual(board.play(5).outcome, "X")
        self.assertEqual(choose_move(board, depth=3).move, 5)

    def test_alpha_beta_visits_fewer_nodes_in_both_games(self):
        _, full_ttt_tree = reference.ttt_minimax("." * 9)
        # All seven columns are legal throughout the first four plies.
        full_connect_four_tree = sum(7 ** ply for ply in range(5))
        for rules, depth, full_size in (
            (TIC_TAC_TOE, 9, full_ttt_tree), (CONNECT_FOUR, 4, full_connect_four_tree),
        ):
            with self.subTest(game=rules.title):
                result = choose_move(Position(rules), depth)
                self.assertGreater(result.nodes, 1)
                self.assertGreater(result.cutoffs, 0)
                self.assertLess(result.nodes, full_size)

    def test_default_and_one_ply_search_depths(self):
        for rules, default_depth, root_moves in ((TIC_TAC_TOE, 9, 9), (CONNECT_FOUR, 6, 7)):
            with self.subTest(game=rules.title):
                board = Position(rules)
                self.assertEqual(choose_move(board).depth, default_depth)
                shallow = choose_move(board, depth=1)
                self.assertEqual(shallow.depth, 1)
                self.assertEqual(shallow.nodes, 1 + root_moves)
                self.assertEqual(shallow.cutoffs, 0)

    def test_terminal_search_stops_at_the_root(self):
        for rules, history, score in (
            (TIC_TAC_TOE, (1, 4, 2, 5, 3), -(WIN_SCORE + 4)),
            (CONNECT_FOUR, reference.C4_LAST_WIN, -WIN_SCORE),
            (CONNECT_FOUR, reference.C4_DRAW, 0),
        ):
            with self.subTest(game=rules.title, score=score):
                result = choose_move(replay(rules, history))
                self.assertIsNone(result.move)
                self.assertEqual(result.score, score)
                self.assertEqual(result.nodes, 1)
                self.assertEqual(result.cutoffs, 0)

    def test_depth_must_be_a_positive_integer(self):
        for depth in (0, -1, 1.5, "3", True):
            with self.subTest(depth=depth), self.assertRaises(ValueError):
                choose_move(Position(TIC_TAC_TOE), depth)


class AnalysisTests(unittest.TestCase):
    def test_every_full_depth_tic_tac_toe_ranking_and_continuation(self):
        for cells, history in reference.ttt_positions():
            board = replay(TIC_TAC_TOE, history)
            analysis = analyze_position(board)
            if reference.ttt_outcome(cells) is not None:
                self.assertEqual((analysis.ranked_moves, analysis.line), ((), ()), cells)
                continue
            sign = 1 if board.turn == "X" else -1
            scores = {m: sign * reference.ttt_minimax(child)[0]
                      for m, child in reference.ttt_children(cells).items()}
            ordered = sorted(board.legal_moves(), key=scores.__getitem__, reverse=True)
            self.assertEqual([(m.move, m.score) for m in analysis.ranked_moves],
                             [(m, scores[m]) for m in ordered], cells)
            self.assertEqual(analysis.line[0], ordered[0], cells)
            line_board = cells
            for move in analysis.line:
                best_score, _ = reference.ttt_minimax(line_board)
                self.assertIsNone(reference.ttt_outcome(line_board), cells)
                line_board = reference.ttt_children(line_board)[move]
                self.assertEqual(reference.ttt_minimax(line_board)[0], best_score, cells)
            self.assertIsNotNone(reference.ttt_outcome(line_board), cells)

    def test_rankings_and_each_best_reply_against_unpruned_connect_four(self):
        for history, limit in (
            ((3, 7, 4, 7), 3), ((4, 3, 5, 2, 4), 4),
            (reference.C4_LAST_WIN[:-6], 42), (reference.C4_DRAW[:-1], 9),
        ):
            with self.subTest(history=history):
                board = replay(CONNECT_FOUR, history)
                rows = reference.c4_replay(history)
                depth = min(limit, board.remaining)
                analysis = analyze_position(board, limit)
                scores = reference.c4_move_scores(rows, board.turn, depth)
                ordered = sorted(board.legal_moves(), key=scores.__getitem__, reverse=True)
                self.assertEqual([(m.move, m.score) for m in analysis.ranked_moves],
                                 [(m, scores[m]) for m in ordered])
                self.assertEqual((analysis.best.move, analysis.best.score), (ordered[0], scores[ordered[0]]))
                self.assertEqual(analysis.line[0], ordered[0])
                for ply, move in enumerate(analysis.line):
                    mark = "XO"[(len(history) + ply) % 2]
                    self.assertIsNone(reference.c4_outcome(rows))
                    _, best_moves = reference.c4_minimax(rows, mark, depth - ply)
                    self.assertEqual(move, next(m for m in CONNECT_FOUR.move_order if m in best_moves))
                    rows = reference.c4_children(rows, mark)[move]
                self.assertLessEqual(len(analysis.line), depth)
                self.assertTrue(len(analysis.line) == depth or reference.c4_outcome(rows) is not None)

    def test_empty_analysis_on_finished_boards_and_cache_hits_on_live_boards(self):
        for game, moves in ((TIC_TAC_TOE, (1, 4, 2, 5, 3)), (CONNECT_FOUR, reference.C4_DRAW)):
            with self.subTest(game=game.title):
                finished = replay(game, moves)
                analysis = analyze_position(finished)
                self.assertEqual(analysis.best, choose_move(finished))
                self.assertEqual((analysis.ranked_moves, analysis.line), ((), ()))
                result = choose_move(Position(game), depth=4)
                self.assertGreater(result.cache_hits, 0)
                self.assertLess(result.cache_hits, result.nodes)


class ReviewTests(unittest.TestCase):
    def assert_review_scores(self, turn, scores):
        order = turn.position.legal_moves()
        best_move = max(order, key=scores.__getitem__)
        self.assertEqual(turn.best.move, best_move)
        self.assertEqual(turn.best.score, scores[best_move])
        self.assertEqual(turn.played.score, scores[turn.played.move])
        self.assertEqual(turn.loss, scores[best_move] - scores[turn.played.move])

    def test_full_depth_review_recognizes_ties_and_forced_losses_for_both_seats(self):
        game = GameHistory(TIC_TAC_TOE, (1, 2, 5, 3, 9))
        cells = "." * 9
        turns = tuple(review_game(game))
        self.assertEqual(tuple(t.played.move for t in turns), game.moves)
        for turn in turns:
            children = reference.ttt_children(cells)
            sign = 1 if cells.count("X") == cells.count("O") else -1
            scores = {m: sign * reference.ttt_minimax(child)[0] for m, child in children.items()}
            self.assert_review_scores(turn, scores)
            self.assertEqual(turn.best.depth, cells.count("."))
            cells = children[turn.played.move]
        self.assertNotEqual(turns[0].played.move, turns[0].best.move)
        self.assertEqual(turns[0].loss, 0)
        self.assertEqual(plies_to_finish(turns[1].position, turns[1].played.score), 6)
        self.assertEqual(plies_to_finish(turns[-1].position, turns[-1].played.score), 1)
        self.assertIsNone(plies_to_finish(turns[0].position, turns[0].best.score))

    def test_review_every_move_of_connect_four_through_the_last_cell(self):
        game = GameHistory(CONNECT_FOUR, reference.C4_LAST_WIN)
        final = game.position
        turns = tuple(review_game(game, 2))
        self.assertEqual(tuple(t.played.move for t in turns), reference.C4_LAST_WIN)
        rows = reference.C4_EMPTY
        for ply, turn in enumerate(turns):
            mark = "XO"[ply % 2]
            depth = min(2, 42 - ply)
            self.assertEqual(turn.best.depth, depth)
            self.assert_review_scores(turn, reference.c4_move_scores(rows, mark, depth))
            rows = reference.c4_children(rows, mark)[turn.played.move]
        self.assertEqual(turns[-1].played.score, WIN_SCORE)
        self.assertIs(game.position, final)

    def test_review_uses_only_the_surviving_branch_and_validates_empty_histories(self):
        game = GameHistory(TIC_TAC_TOE)
        self.assertEqual(tuple(review_game(game)), ())
        with self.assertRaises(ValueError):
            tuple(review_game(game, 0))
        game.play(5)
        game.play(1)
        game.undo_turn(1)
        game.play(9)
        self.assertEqual([turn.played.move for turn in review_game(game, 1)], [5, 9])
