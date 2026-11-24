from dataclasses import replace
from fractions import Fraction
from random import Random

from game2048.engine import Game
from game2048.replay import load_replay, save_replay
from game2048.review import render_review, review_decisions
from game2048.session import Session
from tests import FileTestCase, STUCK
from tests.test_ai import reference_scores


class ReviewTests(FileTestCase):
    def record(self, session, directions):
        for direction in directions:
            self.assertTrue(session.move(direction))
        path = self.folder / "practice.json"
        save_replay(path, session)
        return load_replay(path)

    def test_gaps_match_independent_expectimax_on_each_pre_slide_board(self):
        board = ((256, 2, 128, 256), (0, 64, 32, 256), (4, 32, 0, 64), (8, 2, 256, 16))
        session = Session(Game(board, score=500, moves=30), Random(9), record=True)
        frames = self.record(session, ["left", "down", "up"])
        for depth in (1, 2):
            decisions = review_decisions(frames, depth)
            self.assertEqual([d.turn for d in decisions], [1, 2, 3])
            for before, after, decision in zip(frames, frames[1:], decisions):
                with self.subTest(depth=depth, turn=decision.turn):
                    exact = reference_scores(before.game.board, depth)
                    self.assertEqual(decision.played, after.direction)
                    self.assertEqual(exact[decision.best], max(exact.values()))
                    self.assertAlmostEqual(decision.gap, float(max(exact.values()) - exact[after.direction]))

    def test_review_ranks_misses_and_points_to_the_turn_before_each_choice(self):
        original = Session.new(17)
        resumed = Session(replace(original.game, moves=37, score=120), original.rng, record=True)
        frames = self.record(resumed, ("right", "down", "right", "down", "left", "right"))
        report = render_review(frames, 1, top=2)
        self.assertIn("+4 points in this recording", report)
        self.assertIn("1/6", report)
        rows = [line.split() for line in report.splitlines() if line.strip()[:1].isdigit()]
        self.assertEqual(rows, [["5", "left", "up", "145.32", "4"],
                                ["6", "right", "up", "93.14", "5"]])
        summary = render_review(frames, 1, top=0)
        self.assertEqual(summary, report.split("\n\n")[0])

    def test_equal_best_alternative_counts_and_opening_only_has_no_decisions(self):
        board = ((0, 0, 0, 0), (0, 2, 2, 0), (0, 2, 2, 0), (0, 0, 0, 0))
        frames = self.record(Session(Game(board), Random(8), record=True), ["down"])
        decision, = review_decisions(frames, 2)
        self.assertEqual((decision.played, decision.best, decision.gap), ("down", "up", 0))
        report = render_review(frames, 2, 5)
        self.assertIn("1/1", report)
        self.assertNotIn("Fork turn", report)
        empty = self.record(Session(Game(STUCK, 88, 12), Random(5), record=True), [])
        report = render_review(empty, 1, 5)
        self.assertIn("0/0", report)
        self.assertIn("only its opening", report)
        self.assertIn("+0 points", report)

    def test_review_preserves_small_gaps_on_extremely_large_merges(self):
        tile = 1 << 1200
        board = ((tile, tile, 0, 0), (8, 32, 32, 2), (4, 4, 4, 32), (0, 64, 4, 64))
        frames = self.record(Session(Game(board), Random(7), record=True), ["left"])
        decision, = review_decisions(frames, 1)
        self.assertEqual((decision.played, decision.best), ("left", "right"))
        exact = reference_scores(board, 1)
        self.assertEqual(decision.gap, exact["right"] - exact["left"])
        self.assertIsInstance(decision.gap, Fraction)
        self.assertIn(str(decision.gap), render_review(frames, 1, 1))
