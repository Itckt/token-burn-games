from contextlib import nullcontext, redirect_stdout
from io import StringIO
import json
import unittest
from unittest.mock import patch

from gutterlight.__main__ import main
from gutterlight.battle import Lane, Mode, Move, Setup
from gutterlight.cards import DECKS
from gutterlight.pilot import simulate
from gutterlight.recording import load, save
from gutterlight.sessions import replay_board
from tests.support import TimedConsole, arranged, cli, tape_folder


class CommandLineTests(unittest.TestCase):
    def test_discoverable_help_and_card_manual(self):
        for command in ((), ("--help",)):
            with self.subTest(command=command):
                result = cli(*command)
                self.assertEqual(result.returncode, 0, result.stderr)
                for name in ("play", "simulate", "replay", "cards", "practice", "cup"):
                    self.assertIn(name, result.stdout)
        manual = cli("cards")
        self.assertEqual(manual.returncode, 0, manual.stderr)
        self.assertIn("EIGHT-CARD DECKS", manual.stdout)
        self.assertIn("Patch Reel", manual.stdout)

    def test_simulation_and_file_replay_match_the_selected_seed_and_decks(self):
        with tape_folder() as folder:
            path = folder / "night shift.json"
            result = cli("simulate", "--seed", "93", "--seconds", "8", "--deck", "trestle",
                         "--opponent-deck", "awning", "--save", path)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"Saved replay to {path}", result.stdout)
            expected = simulate(Setup.deal(93, 16, "trestle", "awning"))
            tape = load(path)
            self.assertEqual(tape.frames[-1], expected.frame())
            self.assertIn(expected.outcome.text, result.stdout)
            for flags, tick in (((), tape.end), (("--tick", "0"), 0), (("--tick", "9"), 9)):
                with self.subTest(flags=flags):
                    result = cli("replay", path, *flags)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.rstrip("\n"), replay_board(tape, tick))
                    self.assertNotIn("\x1b", result.stdout)

    def test_events_and_frame_stream_are_in_chronological_order(self):
        with tape_folder() as folder:
            path = folder / "short.json"
            game = arranged(limit=3)
            while game.outcome is None:
                game.step()
            save(game, path)
            events = cli("replay", path, "--events")
            self.assertEqual(events.returncode, 0, events.stderr)
            self.assertLess(events.stdout.index("0:00.0"), events.stdout.index("0:01.5"))
            self.assertIn(game.outcome.text, events.stdout)
            frames = cli("replay", path, "--frames")
            self.assertEqual(frames.returncode, 0, frames.stderr)
            ticks = [line.split()[1] for line in frames.stdout.splitlines() if line.startswith("Beat ")]
            self.assertEqual(ticks, ["0/3", "1/3", "2/3", "3/3"])

    def test_seed_is_printed_and_stored_when_chosen_automatically(self):
        with tape_folder() as folder:
            path = folder / "random.json"
            result = cli("simulate", "--seconds", "1", "--save", path)
            self.assertEqual(result.returncode, 0, result.stderr)
            seed = json.loads(path.read_text(encoding="utf-8"))["seed"]
            self.assertTrue(0 <= seed < 2**32)
            self.assertIn(f"Seed {seed}", result.stdout)
            self.assertEqual(load(path).end, 2)

    def test_bad_arguments_missing_files_and_redirected_live_input_report_errors(self):
        with tape_folder() as folder:
            path = folder / "partial.json"
            save(arranged(), path)
            cases = (
                (("play", "--seed", "0"), "interactive terminal"),
                (("simulate", "--seconds", "0"), "match length"),
                (("simulate", "--seconds", "301"), "match length"),
                (("simulate", "--seed", "-1"), "Seed"),
                (("simulate", "--deck", "typo"), "invalid choice"),
                (("replay", path, "--tick", "1"), "recorded beat"),
                (("replay", path, "--tick", "-1"), "recorded beat"),
                (("replay", path, "--events", "--tick", "0"), "not allowed"),
                (("replay", folder / "missing.json"), "missing.json"),
                (("simulate", "--seconds", "1", "--save", folder / "missing" / "out.json"), "missing"),
            )
            for args, message in cases:
                with self.subTest(args=args):
                    result = cli(*args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(message, result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
            path.write_bytes(b"[")
            invalid = cli("replay", path)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("valid UTF-8 JSON", invalid.stderr)

    def test_live_and_interactive_viewer_entry_points_with_quit_at_opening(self):
        with tape_folder() as folder:
            path = folder / "opening.json"
            for args in (["play", "--seed", "0", "--save", str(path)], ["replay", str(path)]):
                terminal = TimedConsole([(0, "q")])
                with patch("gutterlight.__main__.interactive", return_value=True), \
                        patch("gutterlight.__main__.Terminal", return_value=nullcontext(terminal)), \
                        redirect_stdout(StringIO()) as output:
                    self.assertEqual(main(args), 0)
                if args[0] == "play":
                    self.assertEqual(load(path).end, 0)
                    self.assertIn("Match left in progress", output.getvalue())
                else:
                    self.assertIn("Replay closed at beat 0/0", output.getvalue())
                    self.assertIn("REPLAY 0/0", terminal.screens[0][1])

    def test_custom_deck_beacon_simulation_highlights_and_auto_practice_end_to_end(self):
        keys = "wick,bobbin,kiln,drum,ink,rivet,squall,patch"
        sheet = cli("cards", "--deck", keys)
        self.assertEqual(sheet.returncode, 0, sheet.stderr)
        self.assertIn("Average cost  3.25", sheet.stdout)
        with tape_folder() as folder:
            source = folder / "beacon.json"
            branch = folder / "practice.json"
            match = cli("simulate", "--seed", "27", "--mode", "beacon", "--deck", keys,
                        "--opponent-deck", "viaduct", "--save", source)
            self.assertEqual(match.returncode, 0, match.stderr)
            self.assertIn("Charge  Amber", match.stdout)
            original = source.read_bytes()
            tape = load(source)
            self.assertEqual(tape.setup.mode, Mode.BEACON)
            self.assertCountEqual(tape.setup.opening[0], keys.split(","))
            self.assertCountEqual(tape.setup.opening[1], DECKS["viaduct"])
            highlights = cli("replay", source, "--highlights")
            self.assertEqual(highlights.returncode, 0, highlights.stderr)
            lines = [line for line in highlights.stdout.splitlines() if line.startswith("Beat ")]
            self.assertEqual([int(line.split()[1]) for line in lines],
                             [mark.tick for mark in tape.highlights()])
            self.assertIn("first charge", highlights.stdout)
            tick = tape.highlights()[1].tick - 1
            practice = cli("practice", source, "--tick", tick, "--auto", "--save", branch)
            self.assertEqual(practice.returncode, 0, practice.stderr)
            self.assertIn(f"Practice from beat {tick}/", practice.stdout)
            self.assertEqual(load(branch), tape)
            self.assertEqual(source.read_bytes(), original)

    def test_practice_defaults_to_the_last_partial_frame_or_a_finished_tapes_opening(self):
        with tape_folder() as folder:
            source, branch = folder / "source.json", folder / "branch.json"
            game = arranged(limit=4)
            game.step(Move(1, Lane.CANAL))
            save(game, source)
            first = cli("practice", source, "--auto", "--save", branch)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("Practice from beat 1/1", first.stdout)
            self.assertEqual(load(branch).frames[:2], load(source).frames)
            second = cli("practice", branch, "--auto")
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("Practice from beat 0/4", second.stdout)

    def test_live_practice_can_save_and_leave_at_the_chosen_beat(self):
        with tape_folder() as folder:
            source, branch = folder / "source.json", folder / "branch.json"
            game = arranged()
            game.step(Move(1, Lane.CANAL))
            game.step()
            save(game, source)
            terminal = TimedConsole([(0, "q")])
            with patch("gutterlight.__main__.interactive", return_value=True), \
                    patch("gutterlight.__main__.Terminal", return_value=nullcontext(terminal)), \
                    redirect_stdout(StringIO()):
                self.assertEqual(main(["practice", str(source), "--tick", "1", "--save", str(branch)]), 0)
            self.assertIn("Beat 1/180", terminal.screens[0][1])
            self.assertEqual(load(branch).frames, load(source).frames[:2])

    def test_invalid_customizations_and_practice_sources_leave_recordings_intact(self):
        with tape_folder() as folder:
            source, branch = folder / "done.json", folder / "branch.json"
            game = arranged(limit=2)
            game.step()
            game.step()
            save(game, source)
            original = source.read_bytes()
            for args, message in (
                (("cards", "--deck", "wick,clip"), "exactly eight"),
                (("simulate", "--deck", "wick,clip,ink,drum,loom,rivet,kiln,wick"), "Repeated card"),
                (("simulate", "--opponent-deck", "wick,clip,ink,drum,loom,rivet,kiln,pin"), "Unknown card"),
                (("simulate", "--mode", "snow"), "invalid choice"),
                (("practice", source, "--auto", "--tick", "2", "--save", branch), "earlier beat"),
                (("practice", source, "--auto", "--tick", "3", "--save", branch), "recorded beat"),
                (("practice", source, "--tick", "0"), "interactive terminal"),
                (("practice", source, "--auto", "--save", source), "different file"),
                (("replay", source, "--highlights", "--events"), "not allowed"),
            ):
                with self.subTest(args=args):
                    result = cli(*args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(message, result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(source.read_bytes(), original)
            damaged = json.loads(original)
            damaged["state_sha256"] = "0" * 64
            source.write_text(json.dumps(damaged), encoding="utf-8")
            refused = cli("practice", source, "--tick", "0", "--auto", "--save", branch)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("fingerprint mismatch", refused.stderr)
            self.assertFalse(branch.exists())
