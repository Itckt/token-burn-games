import json
from contextlib import nullcontext, redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from unittest import TestCase
from unittest.mock import patch

from pinchline.__main__ import _show, main
from pinchline.battle import Battle
from pinchline.render import frame, match_report
from pinchline.replay import FORMAT, VERSION, RecordedBeat, read_replay, write_replay
from tests.helpers import ROOT, cli


class ReplayTests(TestCase):
    def setUp(self):
        with NamedTemporaryFile(dir=ROOT, prefix=".replay-test-", suffix=".json", delete=False) as file:
            self.path = Path(file.name)
        self.addCleanup(self.path.unlink, missing_ok=True)

    def test_recording_in_final_view_captures_every_board_and_its_running_totals(self):
        args = ("--seed", "852", "--mode", "rail", "--court", "galley",
                "--copper-deck", "prime", "patch", "--copper-order", "charged",
                "--indigo-order", "nearest", "--view", "final", "--report")
        result = cli(*args, "--record", str(self.path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count("PINCHLINE SIX"), 1)
        tape = read_replay(self.path)
        game = Battle(852, mode="rail", court="galley", copper_deck=("prime", "patch"),
                      copper_order="charged", indigo_order="nearest")
        for number, saved in enumerate(tape):
            with self.subTest(beat=number):
                self.assertEqual(game.beat, number)
                self.assertEqual(saved, RecordedBeat(frame(game), match_report(game)))
                if number < len(tape) - 1:
                    self.assertIsNone(game.result)
                    game.step()
        self.assertIsNotNone(game.result)
        self.assertLess(game.beat, game.limit)
        self.assertEqual(result.stdout, frame(game) + "\n\n" + match_report(game) + "\n")
        self.assertEqual(cli("replay", str(self.path), "--report").stdout, result.stdout)
        for number in (0, 5, game.beat):
            review = cli("replay", str(self.path), "--beat", str(number), "--report")
            self.assertEqual(review.returncode, 0, review.stderr)
            self.assertEqual(review.stdout, tape[number].board + "\n\n" + tape[number].report + "\n")

    def test_complete_transcript_replays_byte_for_byte_for_a_fresh_deal(self):
        match = cli("--record", str(self.path), "--view", "frames", "--mode", "courier",
                    "--indigo-deck", "prime", "--limit", "7", "--report")
        replay = cli("replay", str(self.path), "--view", "frames", "--report")
        self.assertEqual(match.returncode, 0, match.stderr)
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(replay.stdout, match.stdout)
        self.assertEqual(replay.stdout.count("RESULT   "), 1)
        self.assertEqual(replay.stdout.count("MATCH REPORT"), 1)
        self.assertNotIn("\x1b", replay.stdout)

    def test_recording_leaves_victor_state_and_combat_rng_alone(self):
        game, copy = Battle(16, mode="press"), Battle(16, mode="press")
        recording = []
        output = StringIO()
        _show(game, output, "auto", 10, recording)
        copy.run()
        self.assertEqual(output.getvalue(), frame(copy) + "\n")
        self.assertEqual(game.fighters, copy.fighters)
        self.assertEqual(game.rng.getstate(), copy.rng.getstate())
        self.assertEqual(len(recording), game.beat + 1)

    def test_live_replay_uses_saved_text_and_delays_only_between_frames(self):
        tape = [RecordedBeat(f"board {i}", f"totals {i}") for i in range(3)]
        write_replay(self.path, tape)
        output = StringIO()
        with patch.object(Battle, "__init__", side_effect=AssertionError("dealt a new game")), \
             patch("pinchline.__main__._live_terminal", return_value=nullcontext(True)), \
             patch("pinchline.__main__.time.sleep") as sleep, redirect_stdout(output):
            self.assertEqual(main(["replay", str(self.path), "--delay", "0.125", "--report"]), 0)
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(0.125)
        self.assertEqual(output.getvalue(),
                         "".join("\x1b[2J\x1b[H" + b.board + "\n" for b in tape) + "\ntotals 2\n")

    def test_seek_validates_the_recorded_range_and_accepts_zero(self):
        write_replay(self.path, [RecordedBeat("opening", "totals"), RecordedBeat("end", "final totals")])
        single = cli("replay", str(self.path), "--view", "frames", "--beat", "0")
        self.assertEqual(single.stdout, "opening\n")
        for beat in ("-1", "2"):
            with self.subTest(beat=beat):
                result = cli("replay", str(self.path), "--beat", beat)
                self.assertEqual(result.returncode, 2)
                self.assertIn("between 0 and 1", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_replay_rejects_invalid_documents_and_versions(self):
        for data, message in [
            ([], "expected a Pinchline Six replay"),
            ({"format": "other"}, "expected a Pinchline Six replay"),
            ({"format": FORMAT, "version": True}, "unsupported replay version"),
            ({"format": FORMAT, "version": 2}, "unsupported replay version"),
            ({"format": FORMAT, "version": VERSION, "beats": []}, "at least one recorded beat"),
            ({"format": FORMAT, "version": VERSION, "beats": {}}, "at least one recorded beat"),
        ]:
            with self.subTest(data=data):
                self.path.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    read_replay(self.path)
        for raw in (b'"unfinished', b'\xff'):
            self.path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, "invalid JSON"):
                read_replay(self.path)

    def test_an_empty_recording_or_unprintable_beat_cannot_be_published(self):
        original = [RecordedBeat("opening", "first report")]
        write_replay(self.path, original)
        with self.assertRaisesRegex(ValueError, "at least one recorded beat"):
            write_replay(self.path, [])
        with self.assertRaisesRegex(ValueError, "printable ASCII"):
            RecordedBeat("board", "\x1b[2J")
        self.assertEqual(read_replay(self.path), original)

    def test_validate_the_whole_file_before_printing_any_saved_terminal_text(self):
        first = {"board": "board zero", "report": "totals"}
        for bad in (None, {}, {"board": "", "report": "ok"}, {"board": "ok", "report": 0},
                    {"board": "ok", "report": "x\rrewind"}, {"board": "\x1b[2J", "report": "ok"}):
            with self.subTest(beat=bad):
                data = {"format": FORMAT, "version": VERSION, "beats": [first, bad]}
                self.path.write_text(json.dumps(data), encoding="utf-8")
                output, errors = StringIO(), StringIO()
                with redirect_stdout(output), redirect_stderr(errors), self.assertRaises(SystemExit) as stop:
                    main(["replay", str(self.path), "--view", "frames"])
                self.assertEqual(stop.exception.code, 2)
                self.assertIn("invalid board or report at beat 1", errors.getvalue())
                self.assertEqual(output.getvalue(), "")

    def test_interrupted_match_keeps_previous_recording_and_stops_live_replay_cleanly(self):
        tape = [RecordedBeat("old opening", "old report"), RecordedBeat("old end", "end report")]
        write_replay(self.path, tape)
        original = self.path.read_bytes()
        for argv, message in [(["--record", str(self.path)], "Match stopped after beat 0."),
                              (["replay", str(self.path)], "Replay stopped at beat 0.")]:
            with self.subTest(argv=argv):
                output = StringIO()
                with redirect_stdout(output), \
                     patch("pinchline.__main__._live_terminal", return_value=nullcontext(True)), \
                     patch("pinchline.__main__.time.sleep", side_effect=KeyboardInterrupt):
                    self.assertEqual(main(argv), 130)
                self.assertIn(message, output.getvalue())
                self.assertEqual(self.path.read_bytes(), original)

    def test_failed_replace_leaves_previous_recording_and_removes_partial_file(self):
        tape = [RecordedBeat("old board", "old report")]
        write_replay(self.path, tape)
        with patch("pinchline.replay.os.replace", side_effect=OSError("busy")) as replace:
            with self.assertRaisesRegex(OSError, "busy"):
                write_replay(self.path, [RecordedBeat("new", "new report")])
        temp, destination = replace.call_args.args
        self.assertEqual(destination, self.path)
        self.assertEqual(temp.parent, self.path.parent)
        self.assertFalse(temp.exists())
        self.assertEqual(read_replay(self.path), tape)

    def test_bad_paths_and_incompatible_options_report_usage_errors(self):
        missing = self.path / "missing.json"
        for args, message in [(("replay", str(missing)), "cannot read replay"),
                              (("--record", str(missing), "--limit", "1"), "cannot write replay"),
                              (("--record", str(self.path), "--pairs", "2"), "not allowed"),
                              (("replay", str(self.path), "--delay", "nan"), "between 0 and 10"),
                              (("replay", str(self.path), "--seed", "9"), "unrecognized arguments")]:
            with self.subTest(args=args):
                result = cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)
                self.assertNotIn("Traceback", result.stderr)
