import unittest
from dataclasses import replace
from datetime import date
from itertools import product
from random import Random

from game2048.engine import DIRECTIONS, Game
from game2048.puzzles import PUZZLES
from game2048.session import Position, Session
from tests import STUCK


class PuzzleTests(unittest.TestCase):
    def test_every_puzzle_can_be_solved_on_its_last_slide(self):
        solutions = {
            "double-merge": ("left", "left"),
            "switchback": ("up", "down", "left"),
            "last-train": ("left", "down", "right", "up", "right"),
        }
        self.assertEqual(set(PUZZLES), set(solutions))
        for key, directions in solutions.items():
            with self.subTest(key=key):
                puzzle = PUZZLES[key]
                session = Session.new(puzzle=puzzle)
                self.assertEqual(session.game, Game(puzzle.board))
                for direction in directions:
                    self.assertIsNone(puzzle.outcome(session.game))
                    self.assertTrue(session.move(direction))
                self.assertEqual(puzzle.outcome(session.game), "solved")
                self.assertEqual((session.game.largest, session.game.moves), (puzzle.target, puzzle.limit))
                finish = Position.capture(session.game, session.rng)
                self.assertFalse(session.move("left"))
                self.assertEqual(Position.capture(session.game, session.rng), finish)
                self.assertTrue(session.undo())
                self.assertIsNone(puzzle.outcome(session.game))
                self.assertTrue(session.redo())
                self.assertEqual(Position.capture(session.game, session.rng), finish)

    def test_blocked_move_keeps_budget_and_randomness_and_missed_goal_ends_puzzle(self):
        puzzle = PUZZLES["double-merge"]
        session = Session.new(puzzle=puzzle)
        opening = Position.capture(session.game, session.rng)
        self.assertFalse(session.move("up"))
        self.assertEqual(Position.capture(session.game, session.rng), opening)
        self.assertTrue(session.move("down"))
        self.assertTrue(session.move("up"))
        self.assertEqual(puzzle.outcome(session.game), "out of slides")
        self.assertFalse(session.move("left"))
        self.assertTrue(session.undo())
        self.assertIsNone(puzzle.outcome(session.game))

    def test_dead_board_ends_before_budget_and_target_takes_precedence(self):
        puzzle = PUZZLES["switchback"]
        session = Session(Game(STUCK, moves=1), Random(9), puzzle=puzzle)
        self.assertEqual(puzzle.outcome(session.game), "no legal slides")
        self.assertFalse(session.move("up"))
        won = Game(((64, 4, 2, 4), *STUCK[1:]), moves=1)
        self.assertEqual(puzzle.outcome(won), "solved")

    def test_puzzle_has_exactly_one_source_for_its_opening(self):
        puzzle = PUZZLES["switchback"]
        for other in ({"seed": 1}, {"day": date(2026, 1, 1)}):
            with self.subTest(other=other), self.assertRaises(ValueError):
                Session.new(puzzle=puzzle, **other)


class PuzzleSolverTests(unittest.TestCase):
    def test_every_catalog_route_wins_and_no_shorter_route_can_win(self):
        for puzzle in PUZZLES.values():
            with self.subTest(puzzle=puzzle.key):
                session = Session.new(puzzle=puzzle)
                before = Position.capture(session.game, session.rng)
                route = puzzle.shortest_solution(session.game, session.rng)
                self.assertIsNotNone(route)
                self.assertEqual(Position.capture(session.game, session.rng), before)
                for direction in route:
                    self.assertTrue(session.move(direction))
                self.assertEqual(puzzle.outcome(session.game), "solved")
                for length in range(len(route)):
                    for candidate in product(DIRECTIONS, repeat=length):
                        trial = Session.new(puzzle=puzzle)
                        for direction in candidate:
                            if not trial.move(direction):
                                break
                        self.assertLess(trial.game.largest, puzzle.target, candidate)

    def test_solver_uses_the_current_random_stream_even_on_identical_boards(self):
        puzzle = PUZZLES["switchback"]
        for seed, first in ((0, "up"), (1, "right")):
            session = Session(Game(puzzle.board), Random(seed), puzzle=puzzle)
            route = puzzle.shortest_solution(session.game, session.rng)
            with self.subTest(seed=seed):
                self.assertEqual(route[0], first)
                for direction in route:
                    self.assertTrue(session.move(direction))
                self.assertEqual(puzzle.outcome(session.game), "solved")

    def test_solver_respects_remaining_budget_and_preserves_redo_and_recording(self):
        puzzle = PUZZLES["double-merge"]
        session = Session.new(puzzle=puzzle, record=True)
        self.assertTrue(session.move("down"))
        self.assertIsNone(puzzle.shortest_solution(session.game, session.rng))
        after_down = Position.capture(session.game, session.rng)
        self.assertTrue(session.undo())
        self.assertEqual(puzzle.shortest_solution(session.game, session.rng), ("left", "left"))
        self.assertEqual(session.recorded_directions, [])
        self.assertTrue(session.redo())
        self.assertEqual(Position.capture(session.game, session.rng), after_down)
        self.assertEqual(session.recorded_directions, ["down"])

    def test_shortest_route_can_finish_early_and_terminal_outcomes_are_distinct(self):
        puzzle = replace(PUZZLES["double-merge"], limit=4)
        session = Session.new(puzzle=puzzle)
        self.assertEqual(puzzle.shortest_solution(session.game, session.rng), ("left", "left"))
        self.assertTrue(session.move("left"))
        self.assertEqual(puzzle.shortest_solution(session.game, session.rng), ("left",))
        self.assertTrue(session.move("left"))
        for moves in (2, 4):
            self.assertEqual(puzzle.shortest_solution(replace(session.game, moves=moves), session.rng), ())
        for game in (Game(puzzle.board, moves=4), Game(STUCK)):
            self.assertIsNone(puzzle.shortest_solution(game, Random(9)))
