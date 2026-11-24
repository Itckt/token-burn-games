import re
import subprocess
import sys
import unittest
from pathlib import Path

from games import CONNECT_FOUR, DRAW, TIC_TAC_TOE, Position
from tests import reference


ROOT = Path(__file__).resolve().parents[1]


def run_cli(*args, user_input=""):
    return subprocess.run(
        [sys.executable, "-B", "play.py", *args],
        cwd=ROOT, input=user_input, text=True, capture_output=True, timeout=30,
    )


class CommandLineTests(unittest.TestCase):
    def test_self_play_finishes_legal_games_and_reports_search_stats(self):
        for name, rules in (("tic-tac-toe", TIC_TAC_TOE), ("connect-four", CONNECT_FOUR)):
            with self.subTest(game=name):
                run = run_cli(name, "--self-play", "--stats")
                self.assertEqual(run.returncode, 0, run.stderr)
                moves = re.findall(r"^Computer ([XO]) plays (\d+)\.$", run.stdout, re.MULTILINE)
                stats = re.findall(
                    r"^Depth (\d+) \| score -?\d+ \| nodes (\d+) \| cutoffs \d+$",
                    run.stdout, re.MULTILINE,
                )
                self.assertGreater(len(moves), 0)
                self.assertEqual(len(stats), len(moves))
                board = Position(rules)
                for (player, move), (depth, nodes) in zip(moves, stats):
                    self.assertEqual(player, board.turn)
                    self.assertEqual(int(depth), min(rules.default_depth, board.remaining))
                    self.assertGreater(int(nodes), 0)
                    board = board.play(int(move))
                self.assertIsNotNone(board.outcome)
                if rules == TIC_TAC_TOE:
                    self.assertEqual(board.outcome, DRAW)
                message = "Draw." if board.outcome == DRAW else f"{board.outcome} wins!"
                self.assertEqual(run.stdout.splitlines()[-1], message)

    def test_default_game_retries_bad_input_then_accepts_quit(self):
        run = run_cli(user_input="tea\n0\n1\n1\n QUIT \n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("Tic-tac-toe", run.stdout)
        self.assertIn("You play X.", run.stdout)
        self.assertIn(" 1 | 2 | 3", run.stdout)
        self.assertIn("Enter a whole number", run.stdout)
        self.assertIn("Choose a number from 1 to 9", run.stdout)
        self.assertIn("That square is occupied.", run.stdout)
        self.assertIn(" X | 2 | 3", run.stdout)
        self.assertEqual(run.stdout.count("Computer O plays "), 1)
        self.assertNotIn("cutoffs", run.stdout)
        self.assertTrue(run.stdout.rstrip().endswith("Game ended."))

    def test_play_second_depth_override_and_end_of_input(self):
        run = run_cli("connect-four", "--second", "--depth", "1", "--stats")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("You play O.", run.stdout)
        self.assertIn("Computer X plays 4.", run.stdout)
        self.assertIn("Depth 1 |", run.stdout)
        self.assertIn("| . . . X . . . |", run.stdout)
        self.assertIn("  1 2 3 4 5 6 7", run.stdout)
        self.assertIn("O, choose a column", run.stdout)
        self.assertTrue(run.stdout.rstrip().endswith("Game ended."))

    def test_help_and_invalid_arguments(self):
        help_run = run_cli("--help")
        self.assertEqual(help_run.returncode, 0, help_run.stderr)
        for option in ("tic-tac-toe", "connect-four", "--second", "--self-play", "--stats", "--depth",
                       "--two-player", "--moves", "--analyze", "--review", "--puzzle",
                       "--tactics", "--arena", "--node-budget"):
            self.assertIn(option, help_run.stdout)
        for args in (
            ("unknown-game",), ("--depth", "0"), ("--depth", "half"),
            ("--second", "--self-play"), ("--two-player", "--self-play"),
            ("--review", "--two-player"), ("--analyze", "--puzzle", "list"),
        ):
            with self.subTest(args=args):
                run = run_cli(*args)
                self.assertEqual(run.returncode, 2)
                self.assertIn("error", run.stderr.lower())

    def test_two_players_can_rewind_one_move_and_finish_a_win(self):
        run = run_cli("--two-player", user_input="undo\n1\n5\nundo\nhistory\n4\n2\n5\n3\n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("No moves to undo.", run.stdout)
        self.assertIn("Rewound one move.", run.stdout)
        self.assertIn("Move history  --moves 1\nO, choose a square", run.stdout)
        self.assertNotIn("Computer ", run.stdout)
        self.assertTrue(run.stdout.endswith("Move history  --moves 1,4,2,5,3\nX wins!\n"))

    def test_two_players_resume_connect_four_and_get_advice_before_the_last_disc(self):
        opening = ",".join(map(str, reference.C4_DRAW[:-1]))
        run = run_cli("connect-four", "--moves", opening, "--two-player", "--depth", "1",
                      user_input="1\nhint\nreview\nhistory\n7\n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("That column is full.", run.stdout)
        self.assertIn("Best move for O at depth 1 is 7.", run.stdout)
        self.assertIn("Best line  O7", run.stdout)
        self.assertIn("Moves matching the best score", run.stdout)
        self.assertIn(f"Move history  --moves {opening}\nO, choose a column", run.stdout)
        self.assertTrue(run.stdout.endswith(f"Move history  --moves {opening},7\nDraw.\n"))

    def test_undo_as_second_preserves_the_computer_opening(self):
        run = run_cli("--second", "--depth", "1", user_input="undo\n1\nundo\nhistory\nq\n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("No move of yours to undo.", run.stdout)
        self.assertIn("Rewound your move and the computer's reply.", run.stdout)
        self.assertIn("Move history  --moves 5\nO, choose a square", run.stdout)
        self.assertEqual(run.stdout.count("Computer X plays"), 2)

    def test_analyze_openings_and_report_terminal_search_stats(self):
        run = run_cli("connect-four", "--moves", " 3, 7,4 ,7", "--analyze", "--depth", "3")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("Best move for X at depth 3 is 5.", run.stdout)
        self.assertIn("Best line  X5 O", run.stdout)
        self.assertNotIn("choose a column", run.stdout)
        for moves, score, status in (
            ("1,4,2,5,3", -10004, "X wins!"), ("1,2,3,5,4,6,8,7,9", 0, "Draw."),
        ):
            with self.subTest(moves=moves):
                run = run_cli("--analyze", "--moves", moves, "--stats")
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn(f"score {score} | nodes 1 | cutoffs 0", run.stdout)
                self.assertIn("Cache hits 0", run.stdout)
                self.assertNotIn("Best move", run.stdout)
                self.assertEqual(run.stdout.splitlines()[-1], status)

    def test_review_scores_an_entire_game_and_explains_its_largest_loss(self):
        run = run_cli("--review", "--moves", "1,2,5,3,9", "--stats")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("Nodes  Cutoffs  Cache hits", run.stdout)
        rows = [line.split() for line in run.stdout.splitlines() if re.match(r"^\s*\d+\s+[XO]\s", line)]
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0][:8], ["1", "X", "9", "1", "0", "5", "0", "0"])
        self.assertEqual(rows[1][:8], ["2", "O", "8", "2", "-10002", "5", "0", "10002"])
        self.assertTrue(all(len(row) == 11 and int(row[8]) > 0 for row in rows))
        self.assertIn("X 3/3 | O 0/2", run.stdout)
        self.assertIn("O2 gives a forced loss in 6 plies. O5 gives a draw with best play.", run.stdout)
        self.assertTrue(run.stdout.endswith("X wins!\n"))

    def test_review_empty_or_unfinished_games_without_prompting(self):
        empty = run_cli("--review")
        self.assertEqual(empty.returncode, 0, empty.stderr)
        self.assertIn("No moves to review.\nX to move.", empty.stdout)
        partial = run_cli("connect-four", "--review", "--moves", "1", "--depth", "1")
        self.assertEqual(partial.returncode, 0, partial.stderr)
        self.assertIn("X1 gives a depth-1 estimate", partial.stdout)
        self.assertNotIn("Cache hits", partial.stdout)
        self.assertTrue(partial.stdout.endswith("O to move.\n"))
        for run in (empty, partial):
            self.assertNotIn("q to quit", run.stdout)

    def test_replays_report_the_first_bad_move_before_showing_a_board(self):
        for game, moves, message in (
            ("tic-tac-toe", "", "Move 1 must be a whole number"),
            ("tic-tac-toe", "1,2,", "Move 3 must be a whole number"),
            ("tic-tac-toe", "1,1,tea", "Move 2 (1) is invalid. That square is occupied."),
            ("tic-tac-toe", "1,4,2,5,3,7", "Move 6 (7) is invalid. The game is over."),
            ("connect-four", "4,4,4,4,4,4,4", "Move 7 (4) is invalid. That column is full."),
        ):
            with self.subTest(moves=moves):
                run = run_cli(game, "--review", "--moves", moves)
                self.assertEqual(run.returncode, 2)
                self.assertIn(message, run.stderr)
                self.assertEqual(run.stdout, "")

    def test_puzzle_list_and_selection_errors(self):
        for game, names in (
            ("tic-tac-toe", {"first-finish", "one-reply", "crossroads"}),
            ("connect-four", {"fourth-disc", "platform-gap", "two-exits"}),
        ):
            with self.subTest(game=game):
                run = run_cli(game, "--puzzle", "list")
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual({line.split()[0] for line in run.stdout.splitlines()[1:]}, names)
        for args, message in (
            (("--puzzle", "two-exits"), "unknown puzzle"),
            (("--puzzle", "crossroads", "--moves", "5"), "supplies its own opening"),
        ):
            with self.subTest(args=args):
                run = run_cli(*args)
                self.assertEqual(run.returncode, 2)
                self.assertIn(message, run.stderr)

    def test_puzzle_retries_hint_and_an_alternative_winning_move(self):
        run = run_cli("connect-four", "--puzzle", "two-exits", "--depth", "1", "--stats",
                      user_input="tea\n0\n4\n HiNt \n2\n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("Depth 3 |", run.stdout)
        self.assertIn("Enter a whole number", run.stdout)
        self.assertIn("Choose a number from 1 to 7", run.stdout)
        self.assertIn("That move misses the goal. Try again.", run.stdout)
        self.assertIn("One solution line  X5 ", run.stdout)
        self.assertIn("| . X X X . . O |", run.stdout)
        self.assertIn("One winning line  X2 O4 X5", run.stdout)
        self.assertIn("Solved. X2 meets the goal.", run.stdout)

    def test_defensive_puzzle_shows_the_winning_reply_then_accepts_a_block(self):
        run = run_cli("connect-four", "--puzzle", "platform-gap", user_input="7\n4\n")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("X can win with 4. Try again.", run.stdout)
        self.assertIn("Solved. O4 meets the goal.", run.stdout)

    def test_puzzle_quit_and_eof_leave_the_board_unsolved(self):
        for user_input in ("quit\n", "1\n"):
            with self.subTest(user_input=user_input):
                run = run_cli("--puzzle", "first-finish", user_input=user_input)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertTrue(run.stdout.endswith("Puzzle ended.\n"))
                self.assertNotIn("Solved.", run.stdout)
                if user_input.startswith("1"):
                    self.assertIn("That square is occupied.", run.stdout)

    def test_node_budget_keeps_the_last_complete_depth_on_a_computer_turn(self):
        # O must block 3. Depth one prefers 5. The second iteration completes at node 29.
        for budget, depth, move in ((1, 0, 5), (28, 1, 5), (29, 2, 3)):
            with self.subTest(budget=budget):
                run = run_cli("--moves", "9,8,6", "--node-budget", str(budget), "--stats")
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertIn(f"Computer O plays {move}.", run.stdout)
                self.assertRegex(run.stdout, rf"Depth {depth} \| score -?\d+ \| nodes {budget} \|")
                self.assertEqual("static board score" in run.stdout, depth == 0)
                self.assertTrue(run.stdout.endswith("Game ended.\n"))

    def test_both_self_play_seats_receive_a_fresh_budget_on_every_move(self):
        for name, rules in (("tic-tac-toe", TIC_TAC_TOE), ("connect-four", CONNECT_FOUR)):
            with self.subTest(game=name):
                run = run_cli(name, "--self-play", "--node-budget", "8", "--stats")
                self.assertEqual(run.returncode, 0, run.stderr)
                moves = re.findall(r"Computer ([XO]) plays (\d+)\.", run.stdout)
                nodes = re.findall(r"\| nodes (\d+) \|", run.stdout)
                board = Position(rules)
                for (mark, move), visits in zip(moves, nodes, strict=True):
                    self.assertEqual(mark, board.turn)
                    self.assertTrue(1 <= int(visits) <= 8)
                    board = board.play(int(move))
                self.assertIsNotNone(board.outcome)
                self.assertIn("Move history  --moves " + ",".join(m for _, m in moves), run.stdout)

    def test_tactics_works_as_a_report_and_in_live_games_without_consuming_a_turn(self):
        report = run_cli("--tactics", "--moves", "1,4,2,5")
        live = run_cli("--two-player", "--moves", "1,4,2,5", user_input=" TaCtIcS \nhistory\n3\n")
        for run in (report, live):
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn("X3  wins now", run.stdout)
            self.assertIn("X7  allows an immediate win by O6", run.stdout)
            self.assertIn("X6  survives the next reply", run.stdout)
        self.assertNotIn("q to quit", report.stdout)
        self.assertIn("Move history  --moves 1,4,2,5\nX, choose a square", live.stdout)
        self.assertTrue(live.stdout.endswith("Move history  --moves 1,4,2,5,3\nX wins!\n"))
        puzzle = run_cli("connect-four", "--puzzle", "two-exits", user_input="tactics\n2\n")
        self.assertEqual(puzzle.returncode, 0, puzzle.stderr)
        self.assertIn("X5  forces a win next turn", puzzle.stdout)
        self.assertIn("O5 -> X1", puzzle.stdout)
        self.assertTrue(puzzle.stdout.endswith("Solved. X2 meets the goal.\n"))

    def test_tactics_handles_last_cell_wins_draws_and_finished_positions(self):
        for moves, verdict, status in (
            (reference.C4_DRAW, "draws now", "Draw."),
            (reference.C4_LAST_WIN, "wins now", "O wins!"),
        ):
            with self.subTest(status=status):
                for history, expected in ((moves[:-1], f"O{moves[-1]}  {verdict}"), (moves, status)):
                    run = run_cli("connect-four", "--moves", ",".join(map(str, history)), "--tactics")
                    self.assertEqual(run.returncode, 0, run.stderr)
                    self.assertEqual(run.stdout.splitlines()[-1].strip(), expected)
                    self.assertNotIn("q to quit", run.stdout)

    def test_arena_reports_replayable_games_and_charges_only_searched_moves_to_each_engine(self):
        moves = reference.C4_LAST_WIN
        opening = ",".join(map(str, moves[:-1]))
        finished = ",".join(map(str, moves))
        run = run_cli("connect-four", "--arena", "1", "9", "--moves", opening, "--node-budget", "2", "--stats")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn(f"Opening 1  {opening}  | O to move", run.stdout)
        self.assertIn(f"X=A O=B | O wins for B. | --moves {finished}", run.stdout)
        self.assertIn(f"X=B O=A | O wins for A. | --moves {finished}", run.stdout)
        self.assertIn("A wins 1 | B wins 1 | Draws 0", run.stdout)
        for engine in "AB":
            self.assertIn(f"{engine} moves 1 | nodes 2 | cutoffs 0 | cache hits 0", run.stdout)

    def test_default_arena_completes_six_games_and_totals_the_results(self):
        run = run_cli("--arena", "1", "9")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual((run.stdout.count("X=A O=B"), run.stdout.count("X=B O=A")), (3, 3))
        self.assertEqual(run.stdout.count("--moves"), 6)
        self.assertTrue(run.stdout.endswith("A wins 0 | B wins 2 | Draws 4\n"))

    def test_round_three_argument_errors_precede_any_board_or_match(self):
        for args, message in (
            (("--arena", "1"), "expected 2 arguments"),
            (("--arena", "1", "-1"), "positive integer"),
            (("--arena", "1", "2", "--depth", "3"), "both search depths"),
            (("--node-budget", "0"), "positive integer"),
            (("--node-budget", "2.5"), "positive integer"),
            (("--two-player", "--node-budget", "10"), "applies to computer moves"),
            (("--analyze", "--node-budget", "10"), "applies to computer moves"),
            (("--tactics", "--depth", "1"), "three plies"),
            (("--tactics", "--moves", "5,5"), "occupied"),
            (("--arena", "1", "2", "--moves", "5,5,tea"), "Move 2 (5)"),
            (("--arena", "1", "2", "--moves", "1,4,2,5,3"), "unfinished opening"),
        ):
            with self.subTest(args=args):
                run = run_cli(*args)
                self.assertEqual(run.returncode, 2)
                self.assertIn(message, run.stderr)
                self.assertEqual(run.stdout, "")
