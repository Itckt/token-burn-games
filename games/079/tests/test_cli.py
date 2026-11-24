from io import StringIO
import re
import shutil
import subprocess
import sys
import unittest

from desk.game import Game
from play import board_view, brief_view, journal_view, play
from tests.support import ROOT, scratch_dir


def launch(*args, commands="", folder=ROOT, cwd=None):
    return subprocess.run([sys.executable, "-B", str(folder / "play.py"), *args],
                          input=commands, text=True, capture_output=True,
                          cwd=cwd or folder, timeout=10, check=False)


def fold(text):
    return " ".join(text.split())


class DeskDisplayTests(unittest.TestCase):
    def test_file_reveals_only_the_opened_evidence_and_remembers_a_citation(self):
        game = Game(17)
        item = game.board[1]
        self.assertEqual(item.trail.breach, "terms")
        initial = fold(brief_view(game, item))
        self.assertIn(item.trail.pitch, initial)
        self.assertNotIn(item.trail.terms, initial)
        self.assertNotIn(item.trail.funds, initial)
        self.assertNotIn(item.trail.finding, initial)
        self.assertNotIn(item.trail.finding, board_view(game))
        game.act("check 1 funds")
        checked = fold(brief_view(game, item))
        self.assertIn(item.trail.funds, checked)
        self.assertNotIn(item.trail.terms, checked)
        game.act("report 1 funds")
        self.assertIn("Funds (already cited)", brief_view(game, item))
        game.act("check 1 terms")
        self.assertIn(item.trail.terms, fold(brief_view(game, item)))
        game.act("report 1 terms")
        self.assertIn(item.trail.finding, fold(journal_view(game)))

    def test_board_and_brief_show_feasibility_locked_fees_and_live_progress(self):
        game = Game(12)
        game.act("take 1")
        game.act("take 2")
        self.assertIn("Both desk slots are occupied", brief_view(game, game.board[3]))
        game.act("work 2")
        self.assertIn("too late to book", board_view(game))
        self.assertIn("Too little time", brief_view(game, game.board[3]))
        self.assertIn("ready to deliver or polish", board_view(game))
        self.assertIn("Locked fee HK$190", brief_view(game, game.active[2].gig))
        self.assertIn("polish 02", brief_view(game, game.active[2].gig))
        self.assertIn("2 blocks left", brief_view(game, game.active[1].gig))

    def test_read_only_commands_and_input_errors_leave_the_game_state_untouched(self):
        game = Game(42)
        output = StringIO()
        commands = ("\nHELP\nboard\nbrief 03\njournal\nPORTFOLIO\nINBOX\ninbox now\nplan\nplan 03\nplan 1 2\n"
                    "plan zero\nplan 99\nportfolio 03\nbrief\nbrief zero\nboard 4\nsave now\nnope\nquit\n")
        with scratch_dir() as folder:
            play(game, StringIO(commands), output, folder / "week.json")
            self.assertEqual(list(folder.iterdir()), [])
        transcript = output.getvalue()
        for expected in ("DESK GUIDE", "CLIENT FILE", "WEEK JOURNAL", "Use brief ID",
                         "numeric gig ID", "Use board on its own", "Unknown action", "Desk closed",
                         "FIELD PORTFOLIO", "DESK PLAN", "Preview with take 03", "Use plan or plan ID",
                         "Use portfolio on its own", "Gig 99 is closed", "CLIENT INBOX", "Use inbox on its own",
                         "hold ID", "claim ID funds|terms"):
            self.assertIn(expected, transcript)
        self.assertEqual(vars(game), vars(Game(42)))

    def test_keyboard_interrupt_leaves_the_input_loop_cleanly(self):
        class InterruptingInput(StringIO):
            def readline(self):
                raise KeyboardInterrupt

        game = Game(0)
        out = StringIO()
        with scratch_dir() as folder:
            play(game, InterruptingInput(), out, folder / "week.json")
        self.assertIn("Desk closed", out.getvalue())
        self.assertEqual(game.moves, [])

    def test_failed_save_leaves_session_playable(self):
        out = StringIO()
        game = Game(42)
        with scratch_dir() as folder:
            path = folder / "missing" / "week.json"
            play(game, StringIO("save\nwait\nquit\n"), out, path)
        self.assertIn("Could not write", out.getvalue())
        self.assertEqual(game.clock, 1)


class CommandLineTests(unittest.TestCase):
    def test_documented_first_gig_pays_and_enters_journal(self):
        commands = "brief 03\ncheck 03 funds\ncheck 03 terms\ntake 03\nwork 03\npolish 03\njournal\nquit\n"
        result = launch("--seed", "42", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        transcript = fold(result.stdout)
        self.assertIn("Pocket arena score slip", transcript)
        self.assertIn("Paid HK$210", transcript)
        self.assertIn("Mon 13:00", transcript)
        self.assertIn("Polished / HK$210 / 5/5", transcript)
        self.assertIn("Quiet Valve, 5/5", transcript)

    def test_a_complete_winning_week_via_the_real_entry_point(self):
        commands = """check 03 funds
check 03 terms
take 03
work 03
polish 03
take 02
work 02
work 02
deliver 02
take 05
work 05
polish 05
check 06 funds
report 06 funds
end
take 07
work 07
work 07
polish 07
end
end
end
"""
        result = launch("--seed", "42", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("FRIDAY STATEMENT"), 1)
        self.assertEqual(result.stdout.count("[x]"), 3)
        self.assertIn("Week won", result.stdout)
        self.assertIn("HK$1,280 of HK$1,200", result.stdout)
        self.assertIn("4.75/5", result.stdout)
        self.assertIn("Report confirmed on 06", result.stdout)
        self.assertIn("Referral rate earned", result.stdout)

    def test_an_unpaid_delivery_and_a_missed_deadline_reach_the_loss_statement(self):
        commands = "take 03\ntake 01\nwork 01\nwork 01\nwork 01\ndeliver 01\n" + "end\n" * 5
        result = launch("--seed", "17", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        transcript = fold(result.stdout)
        self.assertIn("Missed deadline on 03", transcript)
        self.assertIn("Unpaid handoff on 01", transcript)
        self.assertIn("Week closed with 0 of 3 targets met", transcript)
        self.assertIn("HK$0 of HK$1,200", transcript)
        self.assertIn("Public rating 1.00/5", transcript)

    def test_winning_week_with_templates_amended_terms_and_an_audit(self):
        commands = ("take 03\nwork 03\npolish 03\nend\nportfolio\nplan 04\ntake 04\n"
                    "brief 04\nextend 04\naudit 06\nreuse 04\nreport 06 funds\nwork 04\npolish 04\n"
                    "plan 07\ntake 07\nreuse 07\ndeliver 07\ntake 09\nwork 09\npolish 09\nend\nend\n")
        result = launch("--seed", "42", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        transcript = fold(result.stdout)
        for expected in ("Design / Pocket layout grid", "Tue 09:00 reuse 04",
                         "New deadline Wed 11:00", "New locked fee HK$410", "Audit completed on 06",
                         "Report confirmed on 06", "Used the Design template from 03", "Paid HK$410 for 04",
                         "Used the Design template from 04", "Week won", "HK$1,300 of HK$1,200", "4.75/5"):
            self.assertIn(expected, transcript)
        self.assertEqual(result.stdout.count("FRIDAY STATEMENT"), 1)
        self.assertEqual(result.stdout.count("[x]"), 3)

    def test_held_booking_return_brief_and_invoice_claim_in_a_winning_week(self):
        commands = ("take 03\nwork 03\npolish 03\nhold 02\nend\ntake 02\nwork 02\nwork 02\n"
                    "inbox\nplan 18\ntake 18\nreuse 18\npolish 18\ntake 08\ncheck 08 terms\n"
                    "reuse 08\nwork 08\ndeliver 08\njournal\nclaim 08 terms\ntake 09\nwork 09\n"
                    "polish 09\nend\nend\n")
        result = launch("--seed", "42", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        transcript = fold(result.stdout)
        for expected in ("Held 02 through Tue 13:00", "Paid HK$340 for 02", "On the board now",
                         "Quiet Valve / Design (return from 03)", "Tue 13:00 reuse 18",
                         "Paid HK$360 for 18", "Unpaid invoice HK$540", "Use claim 08 terms",
                         "Claim upheld on 08. Recovered HK$150", "Recovered / HK$150",
                         "Week won", "HK$1,320 of HK$1,200", "4.75/5"):
            self.assertIn(expected, transcript)
        self.assertEqual(result.stdout.count("FRIDAY STATEMENT"), 1)
        self.assertEqual(result.stdout.count("[x]"), 3)

    def test_help_argument_errors_eof_and_random_seed(self):
        help_result = launch("--help")
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("--resume", help_result.stdout)
        for args in (("--seed", "-1"), ("--seed", "bad"), ("--seed", "4294967296"),
                     ("--seed", "0", "--resume")):
            with self.subTest(args=args):
                result = launch(*args)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("Traceback", result.stderr)
        fresh = launch()
        self.assertEqual(fresh.returncode, 0, fresh.stderr)
        seed = re.search(r"Week seed (\d+)", fresh.stdout).group(1)
        same = launch("--seed", seed)
        self.assertEqual(fresh.stdout, same.stdout)
        self.assertIn("Desk closed.", same.stdout)

    def test_actual_save_and_resume_uses_the_game_folder_across_processes(self):
        with scratch_dir() as parent:
            app = parent / "game"
            app.mkdir()
            shutil.copy2(ROOT / "play.py", app)
            shutil.copytree(ROOT / "desk", app / "desk", ignore=shutil.ignore_patterns("__pycache__"))
            missing = launch("--resume", folder=app, cwd=parent)
            self.assertEqual(missing.returncode, 1)
            self.assertIn("No saved week", missing.stderr)
            result = launch("--seed", "42", commands="take 03\nwork 03\nsave\nquit\n",
                            folder=app, cwd=parent)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Week saved", result.stdout)
            save = app / "friday-filed.save.json"
            self.assertTrue(save.is_file())
            self.assertFalse((parent / save.name).exists())
            resumed = launch("--resume", commands="polish 03\njournal\nquit\n", folder=app, cwd=parent)
            self.assertEqual(resumed.returncode, 0, resumed.stderr)
            self.assertIn("Resumed week 42", resumed.stdout)
            self.assertIn("Paid HK$210", resumed.stdout)
            self.assertIn("5.00/5", resumed.stdout)
            # Quitting that session without saving leaves the original ready draft.
            again = launch("--resume", commands="deliver 03\nquit\n", folder=app, cwd=parent)
            self.assertIn("4.00/5", again.stdout)
            save.write_text("broken", encoding="utf-8")
            broken = launch("--resume", folder=app, cwd=parent)
            self.assertEqual(broken.returncode, 1)
            self.assertIn("damaged", broken.stderr)
            self.assertEqual(save.read_text(encoding="utf-8"), "broken")
