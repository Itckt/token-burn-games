import os
import re
import subprocess
import sys
from contextlib import nullcontext
from io import StringIO
from unittest import TestCase
from unittest.mock import Mock, patch

from pinchline.__main__ import _live_terminal, _show, main
from pinchline.arena import HEIGHT, TILES, WIDTH, zone_at
from pinchline.battle import Battle
from pinchline.render import frame, roster_view
from pinchline.roster import ROSTER
from tests.helpers import ROOT, cli, grid


class AsciiTests(TestCase):
    def test_arena_has_one_cell_per_tile_and_the_six_correct_tokens(self):
        game = Battle(852)
        picture = frame(game)
        cells = grid(picture)
        self.assertEqual(len(cells), HEIGHT)
        self.assertTrue(all(len(row) == WIDTH for row in cells))
        occupied = {f.pos: f.token for f in game.fighters}
        for y, row in enumerate(cells):
            for x, char in enumerate(row):
                self.assertEqual(char, occupied.get((x, y), TILES[y][x]))
        self.assertIn("Beat 00/60", picture)
        self.assertIn("Next fold 05", picture)
        self.assertIn("[+....]", picture)

    def test_exposure_hud_walls_and_eliminated_heroes(self):
        game = Battle(0)
        game.beat, game.zone = 10, zone_at(10)
        hero, out = game.fighters[:2]
        hero.pos, hero.ward, hero.charge = (0, 5), 2, 3
        out.hp = 0
        picture = frame(game)
        cells = grid(picture)
        self.assertEqual(cells[5][0], "A")
        self.assertEqual(cells[0][0], "!")
        self.assertEqual(cells[2][5], "#")
        self.assertEqual(cells[5][8], ".")
        self.assertNotIn("B", [char for row in cells for char in row])
        self.assertRegex(picture, r"A! Pleatram\s+26/26\s+\[\+\+\+\.\.\]\s+2")
        self.assertRegex(picture, r"B  Inkrill\s+0/20\s+OUT")
        self.assertIn("Fringe -4 HP", picture)

    def test_no_fold_countdown_past_the_last_fold_or_bell(self):
        game = Battle(2, limit=4)
        self.assertNotIn("Next fold", frame(game))
        game = Battle(2)
        game.beat, game.zone = 40, zone_at(40)
        self.assertIn("Fold 8/8", frame(game))
        self.assertNotIn("Next fold", frame(game))

    def test_frames_fit_eighty_columns_and_use_plain_ascii(self):
        game = Battle(852)
        while True:
            picture = frame(game)
            self.assertTrue(picture.isascii())
            self.assertNotIn("\x1b", picture)
            self.assertLessEqual(max(map(len, picture.splitlines())), 80)
            if game.result:
                break
            game.step()
        self.assertIn("RESULT", picture)
        self.assertNotIn("Next fold", picture)

    def test_roster_identifies_every_card_and_its_signature(self):
        cards = roster_view()
        self.assertTrue(cards.isascii())
        for hero in ROSTER.values():
            self.assertIn(hero.name, cards)
            self.assertIn(hero.role, cards)
            self.assertIn(hero.art.value, cards)
            self.assertIn(hero.describe_art(), cards)

    def test_long_seed_and_limit_wrap_without_losing_replay_digits(self):
        seed, limit = -(10**95 + 852), 10**80 + 11
        picture = frame(Battle(seed, limit=limit))
        self.assertLessEqual(max(map(len, picture.splitlines())), 80)
        compact = "".join(picture.split())
        self.assertIn(f"seed{seed}", compact)
        self.assertIn(f"Beat00/{limit}", compact)


class PlaybackTests(TestCase):
    def test_live_frames_redraw_and_delay_once_per_played_beat(self):
        output = StringIO()
        match = Battle(33, limit=2)
        with patch("pinchline.__main__._live_terminal", return_value=nullcontext(True)), \
             patch("pinchline.__main__.time.sleep") as sleep:
            _show(match, output, "auto", 0.125)
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_called_with(0.125)
        self.assertEqual(output.getvalue().count("\x1b[2J\x1b[H"), 3)
        self.assertTrue(output.getvalue().endswith(frame(match) + "\n"))

    def test_redirected_and_dumb_terminals_support_plain_output(self):
        with _live_terminal(StringIO(), True) as enabled:
            self.assertFalse(enabled)
        terminal = Mock()
        terminal.isatty.return_value = True
        with patch.dict(os.environ, {"TERM": "dumb"}), _live_terminal(terminal, True) as enabled:
            self.assertFalse(enabled)

    def test_plain_playback_never_sleeps(self):
        with patch("pinchline.__main__.time.sleep", side_effect=AssertionError("unexpected delay")):
            for view in ("auto", "frames", "final"):
                output = StringIO()
                _show(Battle(0, limit=2), output, view, 10)
                self.assertNotIn("\x1b", output.getvalue())

    def test_interrupt_returns_a_short_message_and_exit_status(self):
        with patch("pinchline.__main__._live_terminal", return_value=nullcontext(True)), \
             patch("pinchline.__main__.time.sleep", side_effect=KeyboardInterrupt), \
             patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(main(["--seed", "0"]), 130)
        self.assertIn("Match stopped after beat 0.", output.getvalue())


class CommandLineTests(TestCase):
    def test_a_transcript_reader_can_close_early_without_an_error(self):
        command = [sys.executable, "-B", "-m", "pinchline", "--seed", "852",
                   "--view", "frames", "--pairs", "2"]
        with subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            try:
                self.assertTrue(process.stdout.read(1))
                process.stdout.close()
                self.assertEqual(process.wait(timeout=10), 0)
                self.assertEqual(process.stderr.read(), b"")
            finally:
                if process.poll() is None:
                    process.kill()

    def test_auto_when_piped_matches_the_final_simulation_frame(self):
        game = Battle(852)
        game.run()
        result = cli("--seed", "852")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, frame(game) + "\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(cli("--seed", "852", "--view", "final").stdout, result.stdout)

    def test_transcript_includes_opening_each_beat_and_one_verdict(self):
        result = cli("--seed", "3", "--view", "frames", "--limit", "6")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(re.findall(r"^Beat (\d+)/6", result.stdout, re.MULTILINE),
                         [f"{beat:02}" for beat in range(7)])
        self.assertIn("Fold 1 closes in.", result.stdout)
        self.assertEqual(result.stdout.count("RESULT"), 1)
        self.assertNotIn("\x1b", result.stdout)

    def test_generated_seed_is_printed_and_replays_the_exact_transcript(self):
        args = ("--limit", "5", "--view", "frames")
        fresh = cli(*args)
        self.assertEqual(fresh.returncode, 0, fresh.stderr)
        seed = re.search(r"seed (\d+)", fresh.stdout)
        self.assertIsNotNone(seed)
        replay = cli(*args, "--seed", seed[1])
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(replay.stdout, fresh.stdout)

    def test_custom_drafts_are_case_insensitive_and_allow_a_draw(self):
        draft = ("Tucklark", "DARNLET", "inkrill")
        result = cli("--seed", "-5", "--copper", *draft, "--indigo", *draft, "--limit", "1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("A  Tucklark", result.stdout)
        self.assertIn("z  Inkrill", result.stdout)
        self.assertIn("Draw (level on survivors and HP at the bell).", result.stdout)

    def test_help_and_roster_are_available_from_the_module_entry_point(self):
        help_page, cards = cli("--help"), cli("--roster")
        self.assertEqual(help_page.returncode, 0, help_page.stderr)
        for option in ("--seed", "--view", "--roster", "--copper", "--indigo", "--limit", "--delay",
                       "--mode", "--court", "--report", "--cards", "--pairs", "--copper-deck", "--indigo-deck"):
            self.assertIn(option, help_page.stdout)
        self.assertEqual(cards.returncode, 0, cards.stderr)
        self.assertEqual(cards.stdout, roster_view() + "\n")

    def test_bad_inputs_fail_with_usage_messages(self):
        cases = [
            (("--limit", "0"), "positive"),
            (("--delay", "-0.1"), "between 0 and 10"),
            (("--delay", "nan"), "between 0 and 10"),
            (("--delay", "inf"), "between 0 and 10"),
            (("--view", "cinema"), "invalid choice"),
            (("--court", "roof"), "invalid choice"),
            (("--mode", "duel"), "invalid choice"),
            (("--seed", "tea"), "invalid int"),
            (("--copper", "inkrill", "INKRILL", "pleatram"), "three different heroes"),
            (("--indigo", "darnlet", "nobody", "tucklark"), "unknown hero"),
            (("--copper", "inkrill", "darnlet"), "expected 3 arguments"),
        ]
        for args, message in cases:
            with self.subTest(args=args):
                result = cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn(message, result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(result.stdout, "")
