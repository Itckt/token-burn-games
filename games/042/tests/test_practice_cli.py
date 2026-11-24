import io
import json
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from game2048.checkpoint import load_session
from game2048.cli import main
from game2048.puzzles import PUZZLES
from game2048.replay import load_replay, save_replay
from game2048.session import Position, Session
from tests import FileTestCase
from tests.test_cli import run_cli


class PracticeCommandTests(FileTestCase):
    def test_preview_and_solve_work_inside_a_puzzle_without_spending_turns_or_draws(self):
        recording = self.folder / "puzzle.json"
        checkpoint = self.folder / "finish.json"
        log = run_cli("--puzzle", "double-merge", "--record", recording, "--save", checkpoint,
                      commands="preview\npreview north\npreview up\nPREVIEW\tA\nSOLVE\n"
                               "down\nsolve\nundo\npreview left\nredo\nundo\n"
                               "left\nsolve\npreview left\nleft\n")
        self.assertEqual(log.count("Use preview up, left, right or down."), 2)
        self.assertIn("Preview up | That slide is blocked.", log)
        self.assertIn("Preview left | +16 points before the spawn", log)
        self.assertIn("+32 points   100.0%", log)
        self.assertIn("Shortest solution | 2 slides\nleft -> left", log)
        self.assertIn("No solution in the remaining 1 slide.", log)
        self.assertIn("Shortest solution | 1 slide\nleft", log)
        self.assertIn("This slide finishes the challenge (solved).", log)
        self.assertIn("Puzzle solved! Reached 32 in 2 slides.", log)
        self.assertEqual([f.direction for f in load_replay(recording)], [None, "left", "left"])
        expected = Session.new(puzzle=PUZZLES["double-merge"])
        self.assertTrue(expected.move("left"))
        self.assertTrue(expected.move("left"))
        actual = load_session(checkpoint)
        self.assertEqual(Position.capture(actual.game, actual.rng),
                         Position.capture(expected.game, expected.rng))

    def test_standalone_solver_and_guidance_during_free_play(self):
        self.assertIn("Shortest solution | 3 slides\nup -> down -> left",
                      run_cli("solve", "switchback"))
        ordinary = run_cli("--seed", "2", commands="solve\nquit\n")
        self.assertIn("Solve is available during a puzzle", ordinary)
        self.assertEqual(ordinary.count("Best tile"), 1)
        help_text = run_cli("--help")
        for option in ("--fork", "--turn", "review FILE", "solve PUZZLE"):
            self.assertIn(option, help_text)

    def test_solver_identifies_a_session_cap_shorter_than_the_puzzle_route(self):
        output = run_cli("--puzzle", "double-merge", "--moves", "1", commands="solve\nleft\n")
        self.assertIn("Shortest solution | 2 slides\nleft -> left", output)
        self.assertIn("Move limit | 1 slide remaining in this session", output)
        self.assertIn("Move limit reached.", output)

    def test_review_to_fork_to_new_recording_uses_the_suggested_board_and_move(self):
        source = self.folder / "canteen drills.json"
        checkpoint = self.folder / "branch position.json"
        recording = self.folder / "branch turns.json"
        original = ("right", "down", "right", "down", "left", "right")
        run_cli("--seed", "17", "--moves", "6", "--record", source,
                commands="\n".join(original) + "\n")
        saved_source = source.read_bytes()
        report = run_cli("review", source, "--depth", "1", "--top", "1")
        turn, played, best, gap, fork = report.splitlines()[-1].split()
        self.assertEqual((turn, played, best, gap, fork), ("5", "left", "up", "145.32", "4"))
        log = run_cli("--fork", source, "--turn", fork, "--moves", "5", "--save", checkpoint,
                      "--record", recording, commands=f"undo\n{best}\n")
        self.assertIn("Nothing to undo.", log)
        self.assertIn("Move limit reached.", log)
        expected = Session.new(17)
        for direction in original[:int(fork)]:
            self.assertTrue(expected.move(direction))
        frames = load_replay(recording)
        self.assertEqual(frames[0].game, expected.game)
        self.assertEqual([frame.direction for frame in frames], [None, best])
        self.assertTrue(expected.move(best))
        branch = load_session(checkpoint)
        self.assertEqual(Position.capture(expected.game, expected.rng),
                         Position.capture(branch.game, branch.rng))
        self.assertIn("1/1", run_cli("review", recording, "--depth", "1"))
        self.assertEqual(source.read_bytes(), saved_source)

    def test_fork_output_paths_and_live_saves_protect_the_source(self):
        source = self.folder / "source.json"
        alias = self.folder / ".." / self.folder.name / source.name
        save_replay(source, Session.new(17, record=True))
        original = source.read_bytes()
        for flag in ("--save", "--record"):
            self.assert_usage_error(["--fork", str(source), flag, str(alias)], "different paths")
        error = io.StringIO()
        with redirect_stdout(io.StringIO()), redirect_stderr(error), patch(
            "builtins.input", side_effect=[f"save {alias}", "quit"]
        ):
            self.assertEqual(main(["--fork", str(source)]), 0)
        self.assertIn("different paths", error.getvalue())
        self.assertEqual(source.read_bytes(), original)

    def test_damaged_finish_is_rejected_before_a_fork_or_review_produces_output(self):
        source = self.folder / "broken.json"
        output = self.folder / "keep.json"
        output.write_bytes(b"previous contents")
        session = Session.new(17, record=True)
        self.assertTrue(session.move("right"))
        save_replay(source, session)
        record = json.loads(source.read_bytes())
        record["finish"]["moves"] += 1
        source.write_text(json.dumps(record), encoding="utf-8")
        self.assert_usage_error(["--fork", str(source), "--turn", "0", "--record", str(output)], "finish")
        self.assert_usage_error(["review", str(source), "--top", "0"], "finish")
        self.assertEqual(output.read_bytes(), b"previous contents")

    def test_invalid_practice_arguments_have_usage_errors(self):
        source = self.folder / "opening.json"
        save_replay(source, Session.new(17, record=True))
        for args, message in ((["--turn", "0"], "--fork"),
                              (["--fork", str(source), "--turn", "-1"], "0 to 0"),
                              (["--fork", str(source), "--turn", "1"], "0 to 0"),
                              (["--fork", str(source), "--seed", "5"], "--seed"),
                              (["review", str(source), "--top", "-1"], "--top"),
                              (["review", str(source), "--depth", "4"], "--depth"),
                              (["solve", "missing"], "invalid choice")):
            with self.subTest(args=args):
                self.assert_usage_error(args, message)

    def test_unresolvable_output_path_reports_the_filesystem_error(self):
        with patch.object(Path, "resolve", side_effect=RuntimeError("Symlink loop from output.json")):
            self.assert_usage_error(["--fork", "input.json", "--save", "output.json"], "Symlink loop")

    def assert_usage_error(self, args, expected):
        output, error = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(error), patch("builtins.input") as reader, \
                self.assertRaises(SystemExit) as caught:
            main(args)
        self.assertEqual(caught.exception.code, 2)
        self.assertIn(expected, error.getvalue())
        self.assertEqual(output.getvalue(), "")
        reader.assert_not_called()
