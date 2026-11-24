import json
from dataclasses import replace
from datetime import date
from random import Random

from game2048.ai import choose_move
from game2048.checkpoint import load_session, save_session
from game2048.engine import EMPTY_BOARD, Game, legal_moves
from game2048.puzzles import PUZZLES
from game2048.replay import fork_replay, load_replay, save_replay
from game2048.session import DAILY_MOVES, HISTORY_LIMIT, Position, Session
from tests import FileTestCase


class ReplayTests(FileTestCase):
    def setUp(self):
        super().setUp()
        self.path = self.folder / "recorded slides.json"

    def test_all_frames_gains_and_random_spawns_survive_beyond_the_undo_window(self):
        session = Session.new(17, record=True)
        expected = [replace(session.game)]
        directions = []
        for _ in range(HISTORY_LIMIT + 3):
            direction = choose_move(session.game.board, 1)
            self.assertTrue(session.move(direction))
            directions.append(direction)
            expected.append(replace(session.game))
        finish = Position.capture(session.game, session.rng)
        save_replay(self.path, session)
        frames = load_replay(self.path)
        self.assertEqual([frame.game for frame in frames], expected)
        self.assertEqual([frame.direction for frame in frames], [None, *directions])
        self.assertEqual([frame.points for frame in frames[1:]],
                         [b.score - a.score for a, b in zip(expected, expected[1:])])
        for index in (0, 1, HISTORY_LIMIT, len(directions)):
            self.assertEqual(load_replay(self.path, turn=index), [frames[index]])
        self.assertEqual(Position.capture(session.game, session.rng), finish)

    def test_export_uses_only_the_active_branch_including_after_undo_or_redo(self):
        opening = Game(((2, 4, 0, 0), *EMPTY_BOARD[1:]), score=40, moves=8)
        session = Session(replace(opening), Random(7), record=True)
        self.assertTrue(session.move("right"))
        first_finish = replace(session.game)
        self.assertTrue(session.undo())
        self.assertFalse(session.move("left"))
        save_replay(self.path, session)
        self.assertEqual([f.game for f in load_replay(self.path)], [opening])
        self.assertTrue(session.redo())
        save_replay(self.path, session)
        self.assertEqual(load_replay(self.path, turn=1)[0].game, first_finish)
        self.assertTrue(session.undo())
        self.assertTrue(session.move("down"))
        self.assertFalse(session.redo())
        save_replay(self.path, session)
        frames = load_replay(self.path)
        self.assertEqual([f.direction for f in frames], [None, "down"])
        self.assertEqual([f.game for f in frames], [opening, session.game])
        self.assertEqual(frames[-1].game.moves, 9)

    def test_recording_can_start_at_a_loaded_checkpoint(self):
        checkpoint = self.folder / "checkpoint.json"
        live = Session.new(puzzle=PUZZLES["switchback"])
        self.assertTrue(live.move("up"))
        save_session(checkpoint, live)
        session = load_session(checkpoint, record=True)
        self.assertTrue(session.move("down"))
        self.assertTrue(session.move("left"))
        save_replay(self.path, session)
        frames = load_replay(self.path)
        self.assertEqual(frames[0].game, live.game)
        self.assertEqual(frames[-1].turn, 2)
        self.assertEqual(frames[-1].game, session.game)
        self.assertEqual(session.puzzle.outcome(frames[-1].game), "solved")

    def test_validation_checks_the_entire_recording_even_to_show_the_opening(self):
        game = Game(((2, 4, 0, 0), *EMPTY_BOARD[1:]))
        session = Session(game, Random(12), record=True)
        self.assertTrue(session.move("right"))
        save_replay(self.path, session)
        good = json.loads(self.path.read_bytes())
        cases = (
            ({"directions": ["left"]}, "turn 1"),      # blocked in the opening
            ({"directions": ["right", "diagonal"]}, "turn 2"),
            ({"directions": [None]}, "turn 1"),
            ({"directions": "right"}, "list"),
            ({"directions": []}, "finish"),
            ({"finish": good["finish"] | {"score": 4}}, "finish"),
            ({"opening": {}}, "checkpoint version"),
            ({"version": True}, "version"),
            ({"format": "something else"}, "format"),
        )
        for changes, message in cases:
            with self.subTest(changes=changes):
                self.path.write_text(json.dumps(good | changes), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    load_replay(self.path, turn=0)

    def test_cannot_extend_a_replay_past_a_challenge_finish(self):
        daily = Session.new(day=date(2026, 6, 2))
        last_slide = Session(replace(daily.game, moves=DAILY_MOVES - 1), daily.rng,
                             day=daily.day, record=True)
        puzzle = Session.new(puzzle=PUZZLES["double-merge"], record=True)
        for session, moves in ((last_slide, [choose_move(last_slide.game.board, 1)]),
                               (puzzle, ["left", "left"])):
            for direction in moves:
                self.assertTrue(session.move(direction))
            save_replay(self.path, session)
            self.assertEqual(load_replay(self.path)[-1].game, session.game)
            record = json.loads(self.path.read_bytes())
            record["directions"].append(next(legal_moves(session.game.board))[0])
            self.path.write_text(json.dumps(record), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, f"Illegal slide at replay turn {len(moves) + 1}"):
                load_replay(self.path)

    def test_turn_bounds_empty_recordings_and_opt_in(self):
        with self.assertRaises(ValueError):
            save_replay(self.path, Session.new(7))
        self.assertFalse(self.path.exists())
        session = Session.new(7, record=True)
        save_replay(self.path, session)
        self.assertEqual(load_replay(self.path, turn=0)[0].game, session.game)
        for index in (-1, 1, 0.0, False):
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "0 to 0"):
                load_replay(self.path, turn=index)

    def test_fork_restores_generator_counters_and_goal_at_every_recorded_turn(self):
        daily = Session.new(day=date(2024, 2, 29))
        daily.rng.gauss(0, 1)
        session = Session(replace(daily.game, moves=DAILY_MOVES - 3, score=200),
                          daily.rng, day=daily.day, record=True)
        expected = [Position.capture(session.game, session.rng)]
        directions = []
        for _ in range(3):
            direction = choose_move(session.game.board, 1)
            self.assertTrue(session.move(direction))
            directions.append(direction)
            expected.append(Position.capture(session.game, session.rng))
        save_replay(self.path, session)
        original_bytes = self.path.read_bytes()
        branch_path = self.folder / "branch.json"
        for turn, position in enumerate(expected):
            with self.subTest(turn=turn):
                branch = fork_replay(self.path, turn=turn, record=True)
                self.assertEqual(Position.capture(branch.game, branch.rng), position)
                self.assertEqual(branch.recording_start, position)
                self.assertEqual(branch.day, session.day)
                self.assertFalse(branch.undo())
                self.assertFalse(branch.redo())
                for direction in directions[turn:]:
                    self.assertTrue(branch.move(direction))
                self.assertEqual(Position.capture(branch.game, branch.rng), expected[-1])
                self.assertTrue(branch.daily_finished)
                self.assertFalse(branch.move("right"))
                save_replay(branch_path, branch)
                self.assertEqual([f.game.board for f in load_replay(branch_path)],
                                 [p.board for p in expected[turn:]])
        self.assertEqual(self.path.read_bytes(), original_bytes)

    def test_forked_puzzle_can_choose_a_different_finish_and_record_its_own_history(self):
        puzzle = PUZZLES["double-merge"]
        original = Session.new(puzzle=puzzle, record=True)
        self.assertTrue(original.move("left"))
        self.assertTrue(original.move("left"))
        save_replay(self.path, original)
        branch = fork_replay(self.path, turn=1, record=True)
        self.assertEqual(branch.puzzle, puzzle)
        self.assertTrue(branch.move("down"))
        self.assertEqual(puzzle.outcome(branch.game), "out of slides")
        self.assertTrue(branch.undo())
        self.assertFalse(branch.undo())
        self.assertTrue(branch.redo())
        self.assertEqual(branch.recorded_directions, ["down"])
        self.assertEqual(puzzle.outcome(load_replay(self.path)[-1].game), "solved")

    def test_opening_only_legacy_recording_and_invalid_fork_turns(self):
        session = Session.new(12, record=True)
        save_replay(self.path, session)
        legacy = json.loads(self.path.read_bytes())
        legacy["opening"]["version"] = 1
        del legacy["opening"]["puzzle"]
        self.path.write_text(json.dumps(legacy), encoding="utf-8")
        branch = fork_replay(self.path)
        self.assertEqual(Position.capture(branch.game, branch.rng), session.recording_start)
        self.assertIsNone(branch.recording_start)
        for invalid in (1, -1, True, 0.0, None):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                fork_replay(self.path, turn=invalid)

    def test_fork_verifies_illegal_suffix_and_mismatched_finish_even_at_turn_zero(self):
        session = Session.new(puzzle=PUZZLES["double-merge"], record=True)
        self.assertTrue(session.move("left"))
        self.assertTrue(session.move("left"))
        save_replay(self.path, session)
        good = json.loads(self.path.read_bytes())
        for changes, message in (({"directions": ["left", "diagonal"]}, "turn 2"),
                                 ({"finish": good["finish"] | {"score": 0}}, "finish")):
            self.path.write_text(json.dumps(good | changes), encoding="utf-8")
            for turn in (0, 1):
                with self.subTest(turn=turn, message=message), self.assertRaisesRegex(ValueError, message):
                    fork_replay(self.path, turn=turn)
