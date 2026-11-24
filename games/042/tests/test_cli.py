import io
import re
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from fractions import Fraction
from random import Random
from unittest.mock import patch

from game2048.checkpoint import load_session
from game2048.cli import TROPHY, main, play, read_move, render, render_coach
from game2048.engine import EMPTY_BOARD, Game, has_moves
from game2048.puzzles import PUZZLES
from game2048.replay import load_replay
from tests import FileTestCase, ROOT, STUCK


def run_cli(*args, commands=""):
    result = subprocess.run(
        [sys.executable, "-B", "-m", "game2048", *args],
        cwd=ROOT, input=commands, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(f"CLI exited with {result.returncode}\n{result.stderr}")
    return result.stdout


def grid_rows(output):
    return [tuple(int(cell.strip() or 0) for cell in line.strip("|").split("|"))
            for line in output.splitlines() if line.startswith("|")]


class InteractiveTests(unittest.TestCase):
    def test_letter_and_word_commands_ignore_case_and_whitespace(self):
        for direction, key in (("up", "w"), ("left", "a"), ("down", "s"), ("right", "d")):
            for command in (direction, key):
                with self.subTest(command=command):
                    with patch("builtins.input", return_value=f"  {command.upper()}  "):
                        self.assertEqual(read_move(STUCK, 1), direction)

    def test_hint_invalid_and_blocked_inputs_do_not_spend_a_turn(self):
        game = Game(((2, 4, 0, 0), *EMPTY_BOARD[1:]))
        output = io.StringIO()
        commands = ["wrong", "a", "h", "p", "quit"]
        with redirect_stdout(output), patch("builtins.input", side_effect=commands):
            play(game, Random(23), depth=1)
        log = output.getvalue()
        self.assertIn("Unknown command", log)
        self.assertIn("slide is blocked", log)
        hint = re.search(r"Try sliding (\w+)\.", log).group(1)
        self.assertIn(f"AI slides {hint}.", log)
        self.assertEqual(game.moves, 1)
        self.assertEqual(log.count("Best tile"), 2)
        self.assertIn("Session ended.", log)

    def test_reaching_2048_announces_once_and_play_continues(self):
        game = Game(((1024, 1024, 4, 0), *EMPTY_BOARD[1:]))
        output = io.StringIO()
        with redirect_stdout(output), patch("builtins.input", side_effect=["a", "d", "q"]):
            play(game, Random(12))
        self.assertEqual(game.largest, 2048)
        self.assertGreaterEqual(game.score, 2048)
        self.assertEqual(game.moves, 2)
        self.assertEqual(output.getvalue().count(TROPHY), 1)

    def test_terminal_board_ends_without_a_prompt(self):
        output = io.StringIO()
        with redirect_stdout(output), patch("builtins.input") as reader:
            play(Game(STUCK), Random(23))
        reader.assert_not_called()
        self.assertIn("Game over.", output.getvalue())

    def test_terminal_slide_at_move_limit_finishes_without_an_extra_undo_prompt(self):
        game = Game(((0, 8, 16, 32), (32, 64, 128, 256),
                     (512, 1024, 2, 4), (8, 16, 32, 64)))
        output = io.StringIO()
        with redirect_stdout(output), patch("builtins.input", side_effect=["left"]) as reader:
            play(game, Random(10), move_limit=1)
        reader.assert_called_once()
        self.assertFalse(has_moves(game.board))
        self.assertIn("Game over.", output.getvalue())

    def test_renderer_aligns_large_tiles_and_leaves_empty_cells_blank(self):
        board = ((0, 131072, 128, 2), *EMPTY_BOARD[1:])
        frame = render(Game(board, 765432, 321))
        status, *grid = frame.splitlines()
        self.assertEqual(status, "Score 765432    Moves 321    Best tile 131072")
        self.assertEqual(len(grid), 9)
        self.assertEqual(len({len(line) for line in grid}), 1)
        self.assertEqual(tuple(grid_rows(frame)), board)
        self.assertFalse(grid[1].split("|")[1].strip())

    def test_coach_can_display_a_merge_larger_than_a_float(self):
        tile = 1 << 1024
        board = ((tile, tile, 0, 0), *EMPTY_BOARD[1:])
        rows = [line.split() for line in render_coach(board, 1).splitlines()[2:]]
        move = next(row for row in rows if row[0] == "left")
        self.assertEqual(int(move[1]), tile * 2)
        self.assertGreater(Fraction(move[-1]), tile)

    def test_keyboard_interrupt_exits_cleanly(self):
        output = io.StringIO()
        with redirect_stdout(output), patch("builtins.input", side_effect=KeyboardInterrupt):
            self.assertEqual(main(["--seed", "19"]), 130)
        self.assertIn("Session interrupted.", output.getvalue())


class CommandLineTests(unittest.TestCase):
    def test_help_describes_the_game_and_options(self):
        help_text = run_cli("--help")
        for word in ("expectimax", "--ai", "--seed", "--depth", "--moves", "--quiet",
                     "--record", "replay", "benchmark", "--puzzle", "--list-puzzles"):
            self.assertIn(word, help_text)

    def test_invalid_arguments_exit_with_usage_errors(self):
        for args in (["--depth", "0"], ["--depth", "4"], ["--moves", "-1"],
                     ["--seed", "noon"], ["--quiet"], ["--puzzle", "missing"]):
            with self.subTest(args=args):
                errors = io.StringIO()
                with redirect_stderr(errors), self.assertRaises(SystemExit) as caught:
                    main(args)
                self.assertEqual(caught.exception.code, 2)
                self.assertIn(args[0], errors.getvalue())

    def test_zero_move_limit_shows_the_seeded_opening(self):
        output = run_cli("--seed", "91", "--ai", "--quiet", "--moves", "0")
        self.assertIn(render(Game.new(Random(91))), output)
        self.assertEqual(output.count("Best tile"), 1)
        self.assertIn("Move limit reached.", output)

    def test_end_of_input_closes_manual_play(self):
        output = run_cli("--seed", "91", commands="")
        self.assertIn("Session ended.", output)
        self.assertEqual(output.count("Best tile"), 1)

    def test_recorded_ai_moves_replay_through_the_human_interface(self):
        args = ("--seed", "41", "--moves", "12", "--depth", "1")
        detailed = run_cli("--ai", *args)
        directions = re.findall(r"^AI slides (\w+)\.$", detailed, flags=re.MULTILINE)
        self.assertEqual(len(directions), 12)
        self.assertEqual(detailed.count("Best tile"), 13)

        manual = run_cli(*args, commands="\n".join(directions) + "\n")
        quiet = run_cli("--ai", "--quiet", *args)
        self.assertEqual(quiet.count("Best tile"), 1)
        final_frame = quiet[quiet.index("Score "):]
        self.assertTrue(final_frame.endswith("Move limit reached.\n"))
        self.assertTrue(manual.endswith(final_frame))
        self.assertTrue(detailed.endswith(final_frame))

    def test_unattended_game_plays_to_a_genuine_terminal_board(self):
        output = run_cli("--ai", "--quiet", "--seed", "17", "--depth", "1")
        self.assertTrue(output.endswith("Game over. No legal slides remain.\n"))
        self.assertNotIn("Move>", output)
        board = tuple(grid_rows(output))
        self.assertEqual(len(board), 4)
        self.assertFalse(has_moves(board))
        score, moves, largest = map(int, re.search(
            r"Score (\d+)\s+Moves (\d+)\s+Best tile (\d+)", output).groups())
        self.assertGreater(score, 0)
        self.assertGreater(moves, 0)
        self.assertEqual(largest, max(map(max, board)))


class RoundTwoCommandTests(FileTestCase):
    def test_catalog_and_both_puzzle_endings(self):
        catalog = run_cli("--list-puzzles")
        for puzzle in PUZZLES.values():
            self.assertIn(puzzle.key, catalog)
            self.assertIn(puzzle.title, catalog)
        self.assertNotIn("Move>", catalog)
        lost = run_cli("--puzzle", "double-merge", commands="s\nw\n")
        self.assertIn("Puzzle ended (out of slides).", lost)
        self.assertIn("Moves 2", lost)
        won = run_cli("--puzzle", "switchback", commands="w\ns\na\n")
        self.assertIn("Puzzle solved! Reached 64 in 3 slides.", won)

    def test_manual_recording_replays_only_successful_slides_and_can_seek(self):
        recording = self.folder / "class break.json"
        checkpoint = self.folder / "resume.json"
        log = run_cli("--puzzle", "double-merge", "--record", recording, "--save", checkpoint,
                      "--depth", "1", commands="up\ncoach\nh\nleft\nu\nr\nleft\n")
        self.assertIn("Try sliding", log)
        self.assertIn("That slide is blocked.", log)
        self.assertIn("Puzzle solved!", log)
        replay = run_cli("replay", recording)
        self.assertEqual(replay.count("Best tile"), 3)
        self.assertIn("Replay turn 1 | left | +16 points", replay)
        self.assertIn("Replay turn 2 | left | +32 points", replay)
        finish = run_cli("replay", recording, "--turn", "2")
        self.assertEqual(finish.count("Best tile"), 1)
        self.assertTrue(replay.endswith(finish))
        self.assertIn(render(load_session(checkpoint).game), finish)
        self.assertIn("Puzzle solved!", run_cli("--load", checkpoint))

    def test_live_save_resumes_ai_and_recording_starts_at_the_loaded_move(self):
        checkpoint = self.folder / "lunch break.json"
        recording = self.folder / "continuation.json"
        run_cli("--seed", "19", "--depth", "1", commands=f"p\nsave {checkpoint}\nq\n")
        args = ("--ai", "--quiet", "--depth", "1", "--moves", "9")
        resumed = run_cli(*args, "--load", checkpoint, "--record", recording)
        direct = run_cli(*args, "--seed", "19")
        self.assertIn(direct[direct.index("Score "):], resumed)
        frames = load_replay(recording)
        self.assertEqual(len(frames), 9)
        self.assertEqual(frames[0].game, load_session(checkpoint).game)
        self.assertEqual(frames[-1].game.moves, 9)
        self.assertIn(render(frames[-1].game), direct)

    def test_bad_replay_and_conflicting_outputs_have_actionable_errors(self):
        path = self.folder / "one file.json"
        path.write_bytes(b"{}")
        for args, message in ((["replay", str(path)], "replay format"),
                              (["--record", str(path), "--save", str(path)], "different paths"),
                              (["--record", str(path), "--load", str(path)], "different paths"),
                              (["--puzzle", "last-train", "--seed", "17"], "--seed")):
            errors = io.StringIO()
            with self.subTest(args=args), redirect_stderr(errors), self.assertRaises(SystemExit) as caught:
                main(args)
            self.assertEqual(caught.exception.code, 2)
            self.assertIn(message, errors.getvalue())
            self.assertEqual(path.read_bytes(), b"{}")

    def test_failed_replay_output_still_leaves_a_loadable_checkpoint(self):
        checkpoint = self.folder / "keep.json"
        missing = self.folder / "absent" / "replay.json"
        errors = io.StringIO()
        with redirect_stderr(errors), redirect_stdout(io.StringIO()):
            code = main(["--moves", "0", "--save", str(checkpoint), "--record", str(missing)])
        self.assertEqual(code, 1)
        self.assertIn("Could not save", errors.getvalue())
        self.assertEqual(load_session(checkpoint).game.moves, 0)

    def test_interactive_save_cannot_overwrite_the_recording_destination(self):
        recording = self.folder / "turns.json"
        errors = io.StringIO()
        with redirect_stderr(errors), redirect_stdout(io.StringIO()), patch(
            "builtins.input", side_effect=[f"save {recording}", "q"]
        ):
            self.assertEqual(main(["--seed", "7", "--record", str(recording)]), 0)
        self.assertIn("different paths", errors.getvalue())
        self.assertEqual(load_replay(recording)[0].game, Game.new(Random(7)))


class BenchmarkTests(unittest.TestCase):
    def test_comparison_matches_individual_games_and_summary(self):
        args = ("benchmark", "--seed", "17", "--games", "2", "--depths", "2", "1", "--moves", "12")
        report = run_cli(*args)
        self.assertEqual(report, run_cli(*args))
        trials, summary = report.split("\n\n")
        rows = [line.split() for line in trials.splitlines()[2:]]
        self.assertEqual([(int(row[0]), int(row[1])) for row in rows],
                         [(17, 2), (17, 1), (18, 2), (18, 1)])
        for seed, depth, score, moves, tile, *finish in rows:
            single = run_cli("--ai", "--quiet", "--seed", seed, "--depth", depth, "--moves", "12")
            self.assertIn(f"Score {score}    Moves {moves}    Best tile {tile}", single)
            self.assertEqual(finish, ["move", "cap"])
        for row in summary.splitlines()[1:]:
            depth, count, avg_score, avg_moves, best, reached = row.split()
            results = [trial for trial in rows if trial[1] == depth]
            self.assertEqual(int(count), len(results))
            self.assertEqual(float(avg_score), sum(int(trial[2]) for trial in results) / len(results))
            self.assertEqual(float(avg_moves), 12)
            self.assertEqual(int(best), max(int(trial[4]) for trial in results))
            self.assertEqual(reached, "0/2")
        self.assertEqual(len(summary.splitlines()), 3)

    def test_zero_budget_and_a_run_that_ends_before_the_budget(self):
        common = ("--seed", "17", "--games", "1", "--depths", "1")
        opening = run_cli("benchmark", *common, "--moves", "0")
        self.assertEqual(opening.splitlines()[2].split(),
                         ["17", "1", "0", "0", str(Game.new(Random(17)).largest), "move", "cap"])
        single = run_cli("--seed", "17", "--ai", "--quiet", "--depth", "1")
        report = run_cli("benchmark", *common, "--moves", "10000")
        seed, depth, score, moves, tile, *finish = report.splitlines()[2].split()
        self.assertEqual(finish, ["game", "over"])
        self.assertLess(int(moves), 10000)
        self.assertIn(f"Score {score}    Moves {moves}    Best tile {tile}", single)
        self.assertEqual(report.splitlines()[-1].split()[-1], f"{int(int(tile) >= 2048)}/1")

    def test_invalid_benchmark_arguments(self):
        for option, values in (("--games", ["0"]), ("--moves", ["-1"]), ("--depths", ["2", "2"]),
                               ("--depths", ["4"]), ("--depths", [])):
            errors = io.StringIO()
            with self.subTest(option=option, values=values), redirect_stderr(errors), \
                    self.assertRaises(SystemExit) as caught:
                main(["benchmark", option, *values])
            self.assertEqual(caught.exception.code, 2)
            self.assertIn(option, errors.getvalue())
