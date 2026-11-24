import json
from datetime import date
from pathlib import Path
from random import Random
from unittest.mock import patch

from game2048.checkpoint import MAX_BYTES, load_session, save_session
from game2048.engine import Game
from game2048.puzzles import PUZZLES
from game2048.session import DAILY_MOVES, Position, Session
from tests import FileTestCase


class CheckpointTests(FileTestCase):
    def setUp(self):
        super().setUp()
        self.path = self.folder / "saved game.json"

    def test_legacy_daily_save_resumes_with_identical_spawns_and_gaussian_cache(self):
        rng = Random(808)
        rng.gauss(0, 1)
        game = Game.new(rng)
        self.assertTrue(game.move("left", rng))
        # Literal v1 fields also exercise loading files that predate puzzles.
        legacy = {"version": 1, "board": game.board, "score": game.score,
                  "moves": game.moves, "daily": "2024-02-29", "rng": rng.getstate()}
        self.path.write_text(json.dumps(legacy), encoding="utf-8")
        session = load_session(self.path)
        self.assertEqual(session.day, date(2024, 2, 29))
        self.assertIsNone(session.puzzle)
        self.assertFalse(session.can_undo)
        self.assertEqual(session.rng.getstate(), rng.getstate())
        for direction in ("right", "up", "left"):
            self.assertEqual(session.move(direction), game.move(direction, rng))
            self.assertEqual(Position.capture(session.game, session.rng), Position.capture(game, rng))

    def test_puzzle_save_keeps_objective_budget_and_stream(self):
        puzzle = PUZZLES["last-train"]
        session = Session.new(puzzle=puzzle)
        for direction in ("up", "left"):
            self.assertTrue(session.move(direction))
        save_session(self.path, session)
        restored = load_session(self.path)
        self.assertEqual(restored.puzzle, puzzle)
        self.assertFalse(restored.can_undo)
        for direction in ("up", "left", "up"):
            self.assertTrue(restored.move(direction))
            self.assertTrue(session.move(direction))
            self.assertEqual(Position.capture(restored.game, restored.rng),
                             Position.capture(session.game, session.rng))
        self.assertEqual(restored.puzzle.outcome(restored.game), "solved")

    def test_rejects_invalid_board_counters_mode_and_generator(self):
        save_session(self.path, Session.new(2))
        original = json.loads(self.path.read_bytes())
        invalid_fields = (
            {"version": True}, {"version": 30}, {"board": [[0] * 4] * 3},
            {"board": [[0, 2, 4, False]] * 4}, {"board": [[0, 1, 4, 8]] * 4},
            {"score": -1}, {"moves": False}, {"daily": "2023-02-29"},
            {"daily": "2024-02-29", "moves": DAILY_MOVES + 1},
            {"puzzle": "missing"}, {"puzzle": []}, {"puzzle": "last-train", "moves": 6},
            {"puzzle": "switchback", "daily": "2024-02-29"},
            {"rng": [3, [0] * 624 + [624], None]},
            {"rng": [3, [1] * 624 + [625], None]},
            {"rng": [3, [1], None]}, {"rng": [3, original["rng"][1], "bad"]},
        )
        for fields in invalid_fields:
            with self.subTest(fields=list(fields)):
                self.path.write_text(json.dumps(original | fields), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_session(self.path)

    def test_rejects_invalid_encoding_truncated_and_oversized_files(self):
        for data in (b"\xff", b'{"version":1', b" " * (MAX_BYTES + 1)):
            with self.subTest(size=len(data)):
                self.path.write_bytes(data)
                with self.assertRaises(ValueError):
                    load_session(self.path)

    def test_failed_replacement_preserves_previous_file_and_cleans_up(self):
        original = Session.new(7)
        save_session(self.path, original)
        with patch.object(Path, "replace", side_effect=OSError("write failed")), self.assertRaises(OSError):
            save_session(self.path, Session.new(8))
        self.assertEqual(list(self.folder.iterdir()), [self.path])
        restored = load_session(self.path)
        self.assertEqual(Position.capture(restored.game, restored.rng),
                         Position.capture(original.game, original.rng))

    def test_denied_creation_fails_immediately_and_preserves_the_save(self):
        save_session(self.path, Session.new(7))
        original = self.path.read_bytes()
        with patch("game2048.storage.os.open", side_effect=[
            PermissionError("directory is read only"), AssertionError("retried a denied write"),
        ]) as create, self.assertRaises(PermissionError):
            save_session(self.path, Session.new(8))
        create.assert_called_once()
        self.assertEqual(self.path.read_bytes(), original)
