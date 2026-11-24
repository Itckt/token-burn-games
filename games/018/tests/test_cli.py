import io
import json
import os
import subprocess
import sys
import unittest

from engine import Game
from game import play
from saves import save_game
from story import load_story
from tests.support import ROOT, SAMPLE, batch_story, counter_story, small_story, work_directory


SUPPER_SLIP_TO_DESK = [
    "go press", "talk bo hatch", "go hatch", "talk siu slip", "go press", "go station", "go desk",
]


class CliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story = load_story(SAMPLE)

    def setUp(self):
        self.directory = self.enterContext(work_directory())
        self.slot = self.directory / "eleventh-morning.save.json"

    def launch(self, commands, *args):
        return subprocess.run(
            [sys.executable, "-B", str(ROOT / "game.py"), *args],
            input="".join(line + "\n" for line in commands),
            capture_output=True, encoding="utf-8", timeout=15, cwd=self.directory,
            env=os.environ | {"PYTHONIOENCODING": "utf-8"},
        )

    def transcript(self, commands, *args):
        result = self.launch(commands, *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def test_all_nine_endings_reachable_through_real_cli_with_expected_accounting(self):
        pocket = ["do walk", "go desk", "do fold", "go station", "do post"]
        wall = ["do walk", "go desk", "do tile", "go station", "do post"]
        drawer = ["go press", "do listen", "do index", "do file"]
        fast_drawer = ["go press", "do listen", "do rush", "do file"]
        crossing = ["do walk", "go desk", "go booth", "talk wai tape", "go desk", "go station",
                    "talk yan crossing", "go desk", "go booth"] + ["wait"] * 4 + ["do air-turn"]
        dance = ["go press", "do listen", "go booth", "talk wai tape", "go press",
                 "talk bo ticket", "go booth"] + ["wait"] * 5 + ["do air-ticket"]
        supper = SUPPER_SLIP_TO_DESK + ["queue proof", "go station", "do walk", "go press",
                                        "do listen", "go hatch", "do hang"]
        cases = {
            "Someone else has the key": (pocket + drawer + ["go common", "do handover"], 6_500_000_000),
            "Two sets of fingerprints": (wall + fast_drawer, 10_000_000_000),
            "One bowl left": (supper, 800_000_000),
            "Four steps to the left": (crossing, 600_000_000),
            "The fourth chair": (dance, 900_000_000),
            "The first dry page": (pocket, 2_000_000_000),
            "A name in the margin": (drawer + ["go common", "do relay"], 3_500_000_000),
            "One more round": (["go desk", "go common", "do relay"], 500_000_000),
            "The back of the envelope": ([], 0),
        }
        self.assertEqual(set(cases), {end.title for end in self.story.endings})
        for title, (route, spent) in cases.items():
            with self.subTest(title=title):
                text = self.transcript(route + ["wait"] * 10)
                self.assertEqual(text.count("Ending |"), 1)
                self.assertIn(f"Ending | {title}\n", text)
                self.assertIn("closed at midnight on day 10", text)
                self.assertRegex(text, rf"(?m)^  Spent +{spent:,} AI tokens$")
                self.assertRegex(text, r"(?m)^  Available +0 AI tokens$")
                self.assertRegex(text, rf"(?m)^  Expired +{10_000_000_000 - spent:,} AI tokens$")
                for day in (4, 7, 10):
                    self.assertEqual(text.count(f"Day {day} notice |"), 1)

    def test_numeric_input_room_changes_and_journal(self):
        text = self.transcript([
            "go desk", "go station", "  1  ", "GO  DESK", "do 1",
            "go station", "2", "look", "STATUS", "journal", "Q",
        ])
        self.assertIn("Needs Yan's route notes.", text)
        self.assertIn("2 days, 1,500,000,000 AI tokens", text)
        self.assertIn("A small crowd consults the new rain map.", text)
        self.assertIn("Day 5 of 10 | 8,000,000,000 AI tokens available", text)
        journal = text.split("\nJournal\n", maxsplit=1)[1]
        self.assertLess(journal.index("Day 1 | Walk"), journal.index("Days 2-3 | Lay out"))
        self.assertLess(journal.index("Days 2-3 | Lay out"), journal.index("Day 4 | Print"))
        self.assertIn("a public rain map", text)

    def test_inspection_and_invalid_input_do_not_use_time_or_money(self):
        text = self.transcript([
            "", "?", "help", "look", "map", "STATUS", "journal", "go", "do", "0", "do 3",
            "not-a-command", "wait twice", "go common", "do post", "do fold", "load", "save", "quit",
        ])
        for message in (
            "Rooms and exits", "(you are here)", "Your journal is empty",
            "Use go <exit>", "Use do <id>", "Choose a work number", "Unrecognized command",
            "no exit 'common'", "Needs a finished map master.", "no work called 'fold'",
            "No save exists", "Saved to", "Session closed.",
        ):
            with self.subTest(message=message):
                self.assertIn(message, text)
        self.assertNotIn("Day 2 of 10", text)
        self.assertEqual(json.loads(self.slot.read_text(encoding="utf-8"))["events"], [])

    def test_save_and_load_across_processes(self):
        self.transcript(["1", "go desk", "1", "save", "go station", "2", "quit"])
        text = self.transcript(["load", "journal", "go station", "do post", "save"])
        self.assertIn("Loaded eleventh-morning.save.json.", text)
        self.assertIn("Day 4 of 10 | 8,500,000,000 AI tokens available\nStudy desk", text)
        self.assertIn("Days 2-3 | Lay out a pocket edition", text)
        self.assertIn("Closed because you have a finished map master.", text)
        self.assertIn("Day 5 of 10 | 8,000,000,000 AI tokens available", text)
        events = json.loads(self.slot.read_text(encoding="utf-8"))["events"]
        self.assertEqual(events, [
            ["do", "walk"], ["go", "desk"], ["do", "fold"], ["go", "station"], ["do", "post"],
        ])

    def test_invalid_save_leaves_current_session_playable(self):
        save_game(Game(self.story), self.slot)
        data = json.loads(self.slot.read_text(encoding="utf-8"))
        data["events"] = [["go", "press"], ["do", "listen"], ["do", "file"]]
        self.slot.write_text(json.dumps(data), encoding="utf-8")
        text = self.transcript(["1", "go desk", "load", "do fold", "status", "save"])
        self.assertIn("Invalid move 3", text)
        self.assertIn("Day 4 of 10 | 8,500,000,000 AI tokens available", text)
        self.assertEqual(json.loads(self.slot.read_text(encoding="utf-8"))["events"], [
            ["do", "walk"], ["go", "desk"], ["do", "fold"],
        ])

    def test_loading_a_completed_game_shows_the_ending_and_exits(self):
        game = Game(self.story)
        for _ in range(10):
            game.wait()
        save_game(game, self.slot)
        text = self.transcript(["load", "invalid-input-after-the-ending"])
        self.assertEqual(text.count("Ending | The back of the envelope"), 1)
        self.assertNotIn("Unrecognized command", text)
        self.assertNotIn("Day 11 of 10", text)

    def test_custom_story_from_another_working_directory(self):
        data = small_story()
        data["notices"] = {"1": "The post is open.", "2": "Last collection."}
        path = self.directory / "post.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        text = self.transcript(["1", "go loft", "save", "do deliver"], "--story", path.name)
        self.assertIn("Last Post", text)
        self.assertIn("Day 1 notice | The post is open.", text)
        self.assertEqual(text.count("Day 2 notice | Last collection."), 1)
        self.assertIn("Day 2 of 2 | 0 stamps available", text)
        self.assertIn("Ending | Signed for", text)
        self.assertIn("Saved to last-post.save.json.", text)
        self.assertTrue((self.directory / "last-post.save.json").is_file())
        self.assertNotIn("AI tokens", text)
        self.assertFalse(self.slot.exists())

    def test_conversation_menus_calendar_and_directions_leave_no_moves_in_the_save(self):
        text = self.transcript([
            "route booth", "route station", "route nowhere", "route", "talk", "talk yan",
            "talk wai", "talk yan lost", "talk yan button extra", "calendar", "bag",
            "go desk", "talk", "go booth", "  TALK  WAI ", "talk wai tape", "talk wai tape",
            "bag", "inventory", "journal", "save", "quit",
        ])
        for message in (
            "Listening booth [booth] | go desk -> go booth", "Station concourse [station] | You are here.",
            "Unknown room 'nowhere'", "Use route <room>", "People here   Yan (talk yan)",
            "Topics | talk yan <topic>", "Uses 1 x blank loop tape", "Adds 1 x crossing field tape",
            "No one called 'wai' is here", "Use talk yan to see Yan's topics", "Use talk <person>",
            "Days 4-7 | Start by day 6", "Days 4-7 | Start by day 7", "Your bag is empty.",
            "There's no one to talk to here.", "Already discussed. See journal.",
            "Day 1 | Wai-lam | Borrow the last blank tape", "Received 1 x blank loop tape",
        ):
            with self.subTest(message=message):
                self.assertIn(message, text)
        self.assertEqual(text.count("In your bag\n  1 x blank loop tape"), 2)
        self.assertNotIn("Day 2 of 10", text)
        self.assertEqual(json.loads(self.slot.read_text(encoding="utf-8"))["events"], [
            ["go", "desk"], ["go", "booth"], ["talk", "wai", "tape"],
        ])

    def test_cross_process_resume_keeps_the_recording_and_unlocks_the_listener_response(self):
        self.transcript(["go press", "do listen", "go booth", "talk wai tape",
                         "go press", "talk bo ticket", "save", "quit"])
        text = self.transcript(["load", "bag", "talk bo ticket", "go booth", "wait", "wait",
                                "calendar", "do air-ticket", "bag", "go press", "talk bo names",
                                "journal", "save", "quit"])
        for message in (
            "In your bag\n  1 x dance ticket field tape", "Already discussed.", "Ready to start.",
            "Day 4 | Edit and air the last dance | 900,000,000 AI tokens",
            "Day 5 | Bo | Bring back word from the landing", "Your bag is empty.",
            "Used 1 x blank loop tape\nReceived 1 x dance ticket field tape",
            "Used 1 x dance ticket field tape", "Day 5 of 10 | 9,100,000,000 AI tokens available",
        ):
            with self.subTest(message=message):
                self.assertIn(message, text)
        self.assertEqual(text.count("Day 4 notice |"), 1)
        events = json.loads(self.slot.read_text(encoding="utf-8"))["events"]
        self.assertEqual(events.count(["talk", "bo", "ticket"]), 1)
        self.assertEqual(events[-1], ["talk", "bo", "names"])

    def test_calendar_orders_bookings_and_reports_unreachable_rooms_in_a_custom_story(self):
        data = counter_story()
        data["rooms"]["loft"]["actions"]["deliver"]["window"] = [1, 4]
        path = self.directory / "counter.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        text = self.transcript(["calendar", "go loft", "calendar", "quit"], "--story", path.name)
        _, start, in_loft = text.split("\nWork calendar\n")
        self.assertLess(start.index("[deliver]"), start.index("[collect]"))
        self.assertIn("Loft [loft] | go loft", start)
        self.assertIn("Hall [hall] | No route from Loft.", in_loft)
        self.assertIn("Days 2-3 | Start by day 2", in_loft)
        self.assertNotIn("AI tokens", text)

    def test_optional_features_have_empty_states_in_an_original_story(self):
        path = self.directory / "post.json"
        path.write_text(json.dumps(small_story()), encoding="utf-8")
        text = self.transcript(["talk", "inventory", "calendar", "queue", "route loft", "go loft", "route hall"],
                               "--story", path.name)
        for message in ("no one to talk to", "Your bag is empty.", "no scheduled bookings",
                        "no batch terminals", "Loft [loft] | go loft", "Hall [hall] | No route from Loft."):
            self.assertIn(message, text)

    def test_map_room_and_directions_follow_the_supper_hatch_key(self):
        text = self.transcript(["map", "route hatch", "go press", "go hatch", "talk bo hatch",
                                "look", "map", "route hatch", "go hatch", "save"])
        locked, opened = text.split("Day 1 | Bo | Sign out the supper hatch key", 1)
        self.assertIn("hatch [needs Bo's supper hatch key]", locked)
        self.assertIn("hatch (Supper hatch) [needs Bo's supper hatch key]", locked)
        self.assertIn("Locked at Print room [press]", locked)
        self.assertIn("The exit to Supper hatch needs Bo's supper hatch key.", locked)
        self.assertIn("Supper hatch [hatch] | go hatch", opened)
        self.assertNotIn("[needs", opened)
        self.assertEqual(json.loads(self.slot.read_text(encoding="utf-8"))["events"], [
            ["go", "press"], ["talk", "bo", "hatch"], ["go", "hatch"],
        ])

    def test_overnight_proof_arrives_away_from_the_terminal_after_resuming(self):
        start = self.transcript(SUPPER_SLIP_TO_DESK + ["queue", "queue proof-rush", "queue proof", "status", "save"])
        self.assertIn("Compute queue | one batch at a time", start)
        self.assertIn("1 night, 2,000,000,000 AI tokens", start)
        self.assertIn("2 nights, 800,000,000 AI tokens", start)
        self.assertIn("Delivers 1 x print-ready tile proof", start)
        self.assertIn("The queue is busy until the end of day 1.", start)
        self.assertNotIn("Batch delivered |", start)
        text = self.transcript(["load", "go station", "queue", "do walk", "bag", "go press",
                                "go hatch", "do hang", "journal", "save"])
        self.assertIn("Running | Proof Siu's tiles overnight | Due at the end of day 1.", text)
        self.assertEqual(text.count("End of day 1 | Batch delivered | Proof Siu's tiles overnight"), 2)
        self.assertIn("In your bag\n  1 x print-ready tile proof", text)
        self.assertIn("Day 2 | Hang the reversible supper tiles | free", text)
        self.assertIn("Day 3 of 10 | 8,000,000,000 AI tokens available", text)
        resumed = self.transcript(["load", "wait", "bag", "queue", "status", "quit"])
        self.assertIn("Your bag is empty.", resumed)
        self.assertIn("The queue is idle.", resumed)
        self.assertNotIn("Batch delivered |", resumed)
        self.assertIn("reversible tiles at the supper hatch", resumed)

    def test_plan_forecasts_an_entire_ending_from_a_pending_save(self):
        path = self.directory / "counter.json"
        data = batch_story()
        data["notices"] = {"2": "Morning post.", "3": "New mailbag.", "4": "Last collection."}
        path.write_text(json.dumps(data), encoding="utf-8")
        args = ("--story", path.name)
        self.transcript(["talk clerk pass", "queue run", "save"], *args)
        slot = self.directory / "last-post.save.json"
        original = slot.read_bytes()
        text = self.transcript(["load", "plan 1/go loft/１/wait", "status", "route loft", "bag", "quit"], *args)
        self.assertIn("1. 1 | Days 1-3 | Collect the parcel | 3 stamps", text)
        self.assertIn("End of day 2 | Batch delivered | Pull the proof", text)
        self.assertIn("2. go loft | Day 4 | Loft", text)
        self.assertIn("3. １ | Day 4 | Deliver the parcel", text)
        self.assertIn("The adventure ends at step 3.", text)
        self.assertNotIn("4. wait |", text)
        self.assertIn("New milestones | the parcel, a signed receipt, a printed proof", text)
        self.assertIn("Projected ending | Signed for", text)
        self.assertIn("Projected bag | 1 x sheet, 2 x stamped proof", text)
        projected_ledger = text.split("Projected ending | Signed for\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("Day 1 of 4 | 6 stamps available\n4 days left | Hall", text)
        self.assertIn("Locked at Hall [hall]", text)
        self.assertIn("In your bag\n  1 x sheet", text)
        self.assertEqual(slot.read_bytes(), original)
        actual = self.transcript(["load", "1", "go loft", "1"], *args)
        self.assertIn("Ending | Signed for", actual)
        self.assertTrue(actual.rstrip().endswith(projected_ledger))
        day_two = actual.index("Day 2 notice | Morning post.")
        delivered = actual.index("End of day 2 | Batch delivered")
        day_three = actual.index("Day 3 notice | New mailbag.")
        self.assertLess(day_two, delivered)
        self.assertLess(delivered, day_three)
        self.assertEqual(actual.count("Batch delivered |"), 1)

    def test_plan_stops_on_the_first_failure_and_cannot_perform_session_commands(self):
        text = self.transcript([
            "plan go press / go hatch / wait", "plan", "plan wait // wait", "plan wait /",
            "plan save", "plan load", "plan quit", "plan plan wait", "status", "journal",
        ])
        self.assertIn("2. go hatch | Blocked | The exit to Supper hatch needs Bo's supper hatch key.", text)
        self.assertIn("Projected | Day 1 of 10 | 10,000,000,000 AI tokens available | Print room", text)
        self.assertNotIn("3. wait |", text)
        self.assertEqual(text.count("Use plan <move> / <move>"), 3)
        self.assertEqual(text.count("Blocked | Unrecognized move."), 4)
        self.assertIn("10 days left | Station concourse", text)
        self.assertIn("Your journal is empty.", text)
        self.assertFalse(self.slot.exists())

    def test_full_width_and_padded_menu_numbers_resolve_to_canonical_ids(self):
        text = self.transcript(["9" * 5000, "０１", "go desk", "do ００１", "save"])
        self.assertIn("Choose a work number shown by look.", text)
        self.assertIn("Days 2-3 | Lay out a pocket edition", text)
        self.assertEqual(json.loads(self.slot.read_text(encoding="utf-8"))["events"], [
            ["do", "walk"], ["go", "desk"], ["do", "fold"],
        ])

    def test_unprintable_move_in_a_save_reports_the_move_and_preserves_live_progress(self):
        self.slot.write_text(json.dumps({"version": 1, "story": self.story.id,
                                         "fingerprint": self.story.fingerprint, "events": [["go", "\ud800"]]}),
                             encoding="utf-8")
        text = self.transcript(["do walk", "load", "go desk", "do fold", "status"])
        self.assertIn(r"Invalid move 1 in the save. There is no exit '\ud800'", text)
        self.assertIn("Day 4 of 10 | 8,500,000,000 AI tokens available", text)

    def test_save_preserves_a_story_whose_name_matches_the_default_slot(self):
        path = self.directory / "last-post.save.json"
        contents = json.dumps(small_story())
        path.write_text(contents, encoding="utf-8")
        text = self.transcript(["1", "save", "load", "go loft", "1"], "--story", path.name)
        self.assertIn("Saved to last-post.slot.save.json.", text)
        self.assertIn("Ending | Signed for", text)
        self.assertEqual(path.read_text(encoding="utf-8"), contents)

    def test_cli_help_and_invalid_story_exit_codes(self):
        text = self.transcript([], "--help")
        self.assertIn("--story", text)
        for name, contents in (("absent.json", None), ("broken.json", "{"), ("empty.json", "{}"),
                               ("unprintable.json", json.dumps(small_story() | {"title": "\ud800"}))):
            with self.subTest(name=name):
                if contents is not None:
                    (self.directory / name).write_text(contents, encoding="utf-8")
                result = self.launch([], "--story", name)
                self.assertEqual(result.returncode, 2)
                self.assertIn(name, result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_eof_quit_and_interactive_prompt(self):
        text = self.transcript([])
        self.assertIn("The Eleventh Morning", text)
        self.assertNotIn("\n> ", text)
        self.assertNotIn("Ending |", text)
        self.assertFalse(self.slot.exists())

        class Terminal(io.StringIO):
            def isatty(self):
                return True

        output = io.StringIO()
        play(self.story, self.slot, Terminal("quit\n"), output)
        self.assertIn("\n> ", output.getvalue())
        self.assertIn("Session closed.", output.getvalue())
