from collections import deque
from copy import deepcopy
from io import StringIO
from pathlib import Path
import re
import subprocess
import sys
import unittest

from spillway import BROODS, DESIGNS, Enemy, Game, PADS, Phase, RuleError, Tower, footprint
from watchboard import deck_view, forecast_view, frame, guide, map_rows, pad_view, report_view, side_panel
from weirlight import BEAT_SECONDS, draw, live_wave, order, play, skip_escape_sequences


ROOT = Path(__file__).resolve().parents[1]


class WatchBoardTests(unittest.TestCase):
    def test_boss_forecast_matches_the_actual_arrivals(self):
        game = Game(wave=9, cleared=9)
        panel = "\n".join(side_panel(game))
        self.assertIn("WAVE 10 / BOSS TIDE", panel)
        game.start_wave()
        for kind, brood in BROODS.items():
            count = sum(a.kind == kind for a in game.arrivals)
            self.assertRegex(panel, rf"{brood.name}\s+x{count}\b")

    def test_occupied_pads_and_stacks_have_distinct_plain_text_symbols(self):
        game = Game(towers={"C": Tower("pin", 2)}, enemies=[
            Enemy("ripple", 8, 4), Enemy("skate", 6, 5), Enemy("ballast", 18, 15),
        ])
        board = "\n".join(map_rows(game))
        for token in ("[A]", "CP2", "{s}", "(b)"):
            self.assertIn(token, board)
        self.assertNotIn("[C]", board)
        game.enemies.append(Enemy("crown", 80, 4))
        self.assertIn("{@}", "\n".join(map_rows(game)))

    def test_color_is_optional_and_all_normal_frames_fit_an_80_column_terminal(self):
        game = Game(wave=29, cleared=29, overtime=True,
                    towers={p: Tower("bell", 3) for p in PADS})
        for phase in Phase:
            with self.subTest(phase=phase):
                game.phase = phase
                plain = frame(game)
                colored = frame(game, color=True)
                self.assertIn("\x1b[", colored)
                self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", colored), plain)
                self.assertTrue(plain.isascii())
                self.assertNotIn("\x1b", plain)
                self.assertLess(max(map(len, plain.splitlines())), 80)
                self.assertLessEqual(len(plain.splitlines()), 22)

    def test_boss_status_shows_health_shell_and_reach(self):
        game = Game(phase=Phase.WAVE, wave=10, enemies=[Enemy("crown", 54, 24, shell=6)])
        page = frame(game, live=True, paused=True, fast=True)
        for value in ("PAUSED", "Crownwake  54 HP", "Shell 6 / reach 2", "3x", "Basin    1 in reach"):
            self.assertIn(value, page)

    def test_range_survey_matches_combat_and_shows_next_price_and_refund(self):
        game = Game(brass=100)
        preview = pad_view(game, "D", None)
        self.assertIn("D / PINRAIL 1", preview)
        self.assertIn("Build for 18", preview)
        for pad in PADS:
            for kind, design in DESIGNS.items():
                display = pad_view(game, pad, kind)
                board = [line.split("|")[1] for line in display.splitlines() if line.startswith("|")]
                self.assertEqual("".join(board).count("*"), len(footprint(pad, design.tiers[0].radius)))
        game.build("D", "loom")
        game.upgrade("D")
        preview = pad_view(game, "D", None)
        for value in ("D / SILT LOOM 2", "Next tier 30", "Salvage 28", "Hit 4 / range 3"):
            self.assertIn(value, preview)
        with self.assertRaises(RuleError):
            pad_view(game, "D", "bell")

    def test_guide_contains_buying_combat_and_both_sets_of_controls(self):
        game = Game()
        book = guide(game)
        for term in ("look PAD", "PRICE BY TIER", "1, 2 or 3", "Space", "step [1-999]", "Crownwake"):
            self.assertIn(term, book)
        self.assertLess(max(map(len, book.splitlines())), 80)
        self.assertLessEqual(len(book.splitlines()), 22)

    def test_arrival_sheets_match_the_actual_queue_down_to_each_paired_entry(self):
        for wave in (1, 3, 10, 30):
            for rush in (False, True):
                with self.subTest(wave=wave, rush=rush):
                    game = Game(wave=wave - 1, cleared=wave - 1)
                    before = deepcopy(game)
                    page = order(game, "forecast rush" if rush else "forecast")
                    entries = page.split("ENTRY BEAT / BROODS\n")[1].split("\n\n")[0]
                    printed = [(int(beat), mark)
                               for beat, group in re.findall(r"(\d+) ([rsb@+]+)", entries)
                               for mark in group.split("+")]
                    self.assertEqual(game, before)
                    order(game, "RuSh" if rush else "go")
                    self.assertEqual(printed, [(a.beat, BROODS[a.kind].mark) for a in game.arrivals])

    def test_new_views_and_packed_boss_hud_fit_with_or_without_color(self):
        game = Game(wave=29, cleared=29, overtime=True, charge=6,
                    towers={p: Tower("bell", 3, aim="pack") for p in PADS})
        game.set_deck("brace", "net")
        for rush in (False, True):
            page = forecast_view(game, rush=rush)
            self.assertLess(max(map(len, page.splitlines())), 80)
            self.assertLessEqual(len(page.splitlines()), 22)
        game.start_wave(rush=True)
        game.enemies.append(Enemy.arrive("crown", 30))
        game.play_signal("j")
        game.play_signal("k")
        before = deepcopy(game)
        for view in (frame, deck_view, report_view, guide):
            plain = view(game, color=False)
            color = view(game, color=True)
            self.assertEqual(re.sub(r"\x1b\[[0-9;]*m", "", color), plain)
            self.assertTrue(plain.isascii())
            self.assertLess(max(map(len, plain.splitlines())), 80)
            self.assertLessEqual(len(plain.splitlines()), 22)
        page = frame(game, live=True, paused=True, fast=True)
        for detail in ("RUSH", "J brace (spent)", "K net (spent)", "Gate brace 3", "Slowed 1", "PAUSED", "3x"):
            self.assertIn(detail, page)
        self.assertEqual(game, before)

    def test_report_in_an_existing_wave_includes_a_pad_before_its_first_shot(self):
        game = Game(phase=Phase.WAVE, wave=3, towers={"G": Tower("loom", 2, aim="heavy")})
        self.assertRegex(report_view(game), r"G\s+Silt Loom 2\s+heavy\s+0\s+0\s+0")


class LineOrderTests(unittest.TestCase):
    def test_new_orders_validate_shape_phase_and_slots_without_advancing(self):
        game = Game()
        for line in ("aim A", "aim A front extra", "report", "report 1", "deck net",
                     "deck echo net brace", "deck net net", "forecast pair", "rush now", "k"):
            with self.subTest(line=line), self.assertRaises(RuleError):
                order(game, line)
        self.assertEqual(game, Game())
        order(game, "build F bell")
        order(game, "  AiM    f   PaCk  ")
        self.assertIn("Aim pack", order(game, "look f"))
        order(game, "dEcK brace ECHO")
        order(game, "forecast rush")
        order(game, "go")
        self.assertFalse(game.rush)
        order(game, "J")
        snapshot = deepcopy(game)
        self.assertIn("J brace (spent)", order(game, "deck"))
        self.assertIn("Discharge kills 0", order(game, "report"))
        for line in ("aim F front", "rush", "forecast", "forecast rush", "deck echo brace", "j"):
            with self.subTest(line=line), self.assertRaises(RuleError):
                order(game, line)
        self.assertEqual(game, snapshot)

    def test_mixed_case_shortcuts_spacing_and_read_only_orders(self):
        game = Game(brass=100)
        order(game, "  B    c  PiN ")
        order(game, "u c")
        self.assertEqual((game.brass, game.towers["C"].level), (62, 2))
        snapshot = deepcopy(game)
        self.assertIn("C / PINRAIL 2", order(game, "Look C"))
        self.assertIn("range survey", order(game, "look d loom"))
        self.assertIn("field guide", order(game, "?"))
        order(game, "")
        self.assertEqual(game, snapshot)
        order(game, "SeLl c")
        self.assertEqual((game.brass, game.towers), (90, {}))

    def test_bad_command_shapes_and_wrong_phase_leave_the_game_intact(self):
        game = Game()
        for line in ("build", "up a extra", "go now", "look c pin extra", "sell", "1", "run", ".",
                     "step 2", "overtime", "not-a-command", "build I pin"):
            with self.subTest(line=line), self.assertRaises(RuleError):
                order(game, line)
        self.assertEqual(game, Game())
        order(game, "go")
        snapshot = deepcopy(game)
        for line in ("go", "look C", "build A pin", "sell A", "mend"):
            with self.subTest(line=line), self.assertRaises(RuleError):
                order(game, line)
        self.assertEqual(game, snapshot)

    def test_step_counts_are_positive_bounded_ascii_integers(self):
        game = Game()
        order(game, "go")
        for token in ("0", "000", "-1", "1.5", "1000", "1e2", "\u00b2", "\u0661", "9" * 6000):
            with self.assertRaises(RuleError):
                order(game, "step " + token)
        self.assertEqual(game.beat, 0)
        for line in ("", "step", ".", "step 3"):
            order(game, line)
        self.assertEqual(game.beat, 6)

    def test_batched_steps_and_run_stop_at_the_first_intermission(self):
        a = Game()
        for cmd in ("build C pin", "build F bell", "go", "step 1", "1"):
            order(a, cmd)
        b = deepcopy(a)
        order(a, "step 999")
        order(b, "run")
        self.assertEqual(a, b)
        self.assertEqual((a.cleared, a.phase, a.gate), (1, Phase.BUILD, 12))


class KeyTimeline:
    """Deliver keys at stated times and advance the clock by requested waits."""

    def __init__(self, *events):
        self.time = 0.0
        self.events = deque(events)
        self.polls = 0

    def read(self, timeout):
        self.polls += 1
        if self.polls > 1000:
            raise AssertionError("Live controller stopped making progress")
        deadline = self.time + timeout
        if self.events and self.events[0][0] <= deadline:
            self.time, key = self.events.popleft()
            return key
        self.time = deadline
        return None


class LiveControlTests(unittest.TestCase):
    def test_a_paused_live_sluice_matches_the_same_stepped_wave(self):
        game = Game()
        for line in ("build B coil", "build A pin", "sluice 1", "rush"):
            order(game, line)
        stepped = deepcopy(game)
        for line in ("step 7", "v", "run"):
            order(stepped, line)
        clock = KeyTimeline((0.01, "P"), (0.02, "v"),  # Too early. Keep the release.
                            *((i / 100, ".") for i in range(3, 10)),
                            (0.10, "V"), (0.11, "v"), (0.12, "P"))
        seen = []
        self.assertFalse(live_wave(game, clock.read,
                                  lambda p, f: seen.append((p, game.beat, game.vented)),
                                  lambda: clock.time))
        self.assertIn((True, 0, 0), seen)
        self.assertIn((True, 7, 3), seen)
        self.assertEqual(game, stepped)
        self.assertEqual((game.gate, game.brass), (12, 18))

    def test_alt_keys_and_multiline_bracketed_paste_cannot_play_combat_orders(self):
        # Clipboard delivery can pause for longer than a function-key timeout.
        data = "\x1bj\x1b1\x1bq\x1b[200~vf.\n123"
        tail = "q jk\x1b[20x\x1b[201~"
        clock = KeyTimeline(*[(i / 100, key) for i, key in enumerate(data)],
                            *[(0.60 + i / 100, key) for i, key in enumerate(tail)],
                            (0.82, "v"), (0.83, "q"))
        game = Game(phase=Phase.WAVE, wave=1, sluice=1, enemies=[Enemy("ballast", 20, 6)])
        reader = skip_escape_sequences(clock.read, lambda: clock.time)
        self.assertTrue(live_wave(game, reader, lambda *_: None, lambda: clock.time))
        self.assertEqual((game.beat, game.charge, game.vented, game.enemies[0].distance), (1, 3, 1, 5))
        self.assertFalse(game.spent_signals)

    def test_eof_or_interrupt_releases_an_incomplete_paste(self):
        for stop in ("\x03", "\x04", "\x1a"):
            data = "\x1b[200~q" + stop + "v"
            chars = iter(data)
            reader = skip_escape_sequences(lambda _: next(chars), lambda: 0.0)
            self.assertEqual([reader(1) for _ in data], [None] * 7 + [stop, "v"])

    def test_paused_cards_and_rush_play_identically_in_live_and_step_modes(self):
        game = Game(charge=6)
        for line in ("build C pin", "build F bell", "aim F pack", "deck echo net", "rush"):
            order(game, line)
        stepped = deepcopy(game)
        for line in ("step 4", "j", "k", "run"):
            order(stepped, line)
        clock = KeyTimeline((0.01, "p"), (0.02, "."), (0.03, "."), (0.04, "."), (0.05, "."),
                            (0.06, "J"), (0.07, "K"), (0.08, "P"))
        seen = []

        def paint(paused, fast):
            seen.append((game.beat, paused, game.charge, set(game.spent_signals)))

        self.assertFalse(live_wave(game, clock.read, paint, lambda: clock.time))
        self.assertIn((4, True, 3, {"echo"}), seen)
        self.assertIn((4, True, 1, {"echo", "net"}), seen)
        self.assertEqual(game, stepped)

    def test_paused_echo_can_end_a_rush_without_an_extra_beat(self):
        game = Game(phase=Phase.WAVE, wave=1, rush=True, brass=0, towers={"A": Tower("pin", cooldown=1)},
                    enemies=[Enemy("ripple", 2, 4)])
        clock = KeyTimeline((0.01, " "), (0.02, "K"))
        self.assertFalse(live_wave(game, clock.read, lambda *_: None, lambda: clock.time))
        self.assertEqual((game.phase, game.beat, game.charge, game.brass), (Phase.BUILD, 0, 0, 13))

    def test_posix_function_keys_cannot_trigger_embedded_combat_hotkeys(self):
        # Delete, F1, F5, End, and a keypad key contain digits or action letters.
        special = "\x1b[3~\x1bOP\x1b[15~\x1b[1;5F\x1bOk"
        clock = KeyTimeline(*[(i / 100, key) for i, key in enumerate(special)], (0.40, "Q"))
        game = Game(phase=Phase.WAVE, wave=1, charge=6, deck=("net", "brace"),
                    enemies=[Enemy("ripple", 20, 0), Enemy("ripple", 20, 45)])
        before = deepcopy(game)
        frames = []
        reader = skip_escape_sequences(clock.read, lambda: clock.time)
        self.assertTrue(live_wave(game, reader, lambda p, f: frames.append((p, f)), lambda: clock.time))
        self.assertEqual(game, before)
        self.assertEqual(frames, [(False, False)])

    def test_posix_key_sequence_can_straddle_a_beat_and_release_the_next_key(self):
        clock = KeyTimeline((0.46, "\x1b"), (0.47, "["), (0.49, "1"), (0.50, "~"),
                            (0.51, "1"), (0.52, "Q"))
        game = Game()
        game.start_wave()
        reader = skip_escape_sequences(clock.read, lambda: clock.time)
        self.assertTrue(live_wave(game, reader, lambda *_: None, lambda: clock.time))
        self.assertEqual((game.beat, game.kills, game.pulse_kills, game.charge), (1, 1, 1, 0))
        self.assertIn("Discharged the Inlet", game.notice)

    def test_truncated_posix_sequences_expire_and_do_not_hide_interrupt_or_eof(self):
        events = ((0.01, "\x1b"), (0.02, "["), (0.03, "1"), (0.30, "j"),
                  (0.31, "\x1b"), (0.32, "O"), (0.33, "\x03"),
                  (0.34, "\x1b"), (0.35, "["), (0.36, "\x04"))
        clock = KeyTimeline(*events)
        reader = skip_escape_sequences(clock.read, lambda: clock.time)
        self.assertEqual([reader(1) for _ in events],
                         [None, None, None, "j", None, None, "\x03", None, None, "\x04"])

    def test_live_and_stepped_wave_have_identical_results(self):
        game = Game()
        game.build("C", "pin")
        game.build("F", "bell")
        game.start_wave()
        stepped = deepcopy(game)
        order(stepped, "run")
        clock = KeyTimeline()
        seen = []
        quit_early = live_wave(game, clock.read, lambda p, f: seen.append(game.beat), lambda: clock.time)
        self.assertFalse(quit_early)
        self.assertEqual(seen, list(range(game.beat)))
        self.assertAlmostEqual(clock.time, BEAT_SECONDS * game.beat)
        self.assertEqual(game, stepped)

    def test_live_pause_single_beat_discharge_resume_and_three_times_speed(self):
        game = Game()
        game.start_wave()
        clock = KeyTimeline((0.10, "F"), (0.30, " "), (0.40, "."), (0.41, "1"),
                            (1.40, "P"), (1.58, "Q"))
        seen = []

        def paint(paused, fast):
            seen.append((round(clock.time, 2), game.beat, paused, fast, game.kills))

        self.assertTrue(live_wave(game, clock.read, paint, lambda: clock.time))
        self.assertIn((0.26, 1, False, True, 0), seen)
        self.assertIn((0.30, 1, True, True, 0), seen)
        self.assertIn((0.40, 2, True, True, 0), seen)
        self.assertIn((0.41, 2, True, True, 1), seen)
        self.assertIn((1.40, 2, False, True, 1), seen)
        self.assertEqual(game.beat, 3)

    def test_holding_the_speed_key_cannot_freeze_an_unpaused_wave(self):
        game = Game()
        game.start_wave()
        clock = KeyTimeline(*[(i / 20, "f") for i in range(1, 41)], (2.01, "q"))
        self.assertTrue(live_wave(game, clock.read, lambda *_: None, lambda: clock.time))
        self.assertGreaterEqual(game.beat, int(2 / BEAT_SECONDS))
        self.assertLessEqual(game.beat, int(2.01 / (BEAT_SECONDS / 3)))

    def test_invalid_pulse_and_unmapped_keys_do_not_consume_time_or_charge(self):
        game = Game()
        game.start_wave()
        clock = KeyTimeline((0.01, "3"), (0.02, "."), (0.03, "x"), (0.04, "\x04"))
        self.assertTrue(live_wave(game, clock.read, lambda *_: None, lambda: clock.time))
        self.assertEqual((game.beat, game.charge, game.kills), (0, 3, 0))
        self.assertIn("empty", game.notice)

    def test_last_pulse_exits_live_control_even_when_paused(self):
        game = Game(phase=Phase.WAVE, wave=1, enemies=[Enemy("ripple", 1)])
        clock = KeyTimeline((0.02, " "), (0.03, "1"))
        self.assertFalse(live_wave(game, clock.read, lambda *_: None, lambda: clock.time))
        self.assertEqual((game.phase, game.cleared, game.beat), (Phase.BUILD, 1, 0))

    def test_live_interrupt_propagates_for_terminal_cleanup(self):
        game = Game()
        game.start_wave()
        with self.assertRaises(KeyboardInterrupt):
            live_wave(game, lambda _: "\x03", lambda *_: None)

    def test_draw_hides_cursor_in_combat_and_restores_it_for_the_prompt(self):
        output = StringIO()
        draw(output, "A\nB", True, cursor=False)
        first = output.getvalue()
        self.assertIn("\x1b[?25l", first)
        self.assertIn("A\x1b[K\nB", first)
        draw(output, "C", True)
        self.assertIn("\x1b[?25h", output.getvalue()[len(first):])
        plain = StringIO()
        draw(plain, "A\nB", False)
        self.assertEqual(plain.getvalue(), "A\nB\n\n")


def launch(commands="", args=(), root=ROOT):
    return subprocess.run([sys.executable, "-B", str(root / "weirlight.py"), *args],
                          input=commands, capture_output=True, text=True, cwd=root,
                          check=False, timeout=10)


class TerminalProcessTests(unittest.TestCase):
    def test_rush_opener_and_firing_report_through_real_commands(self):
        commands = ("build C pin\nbuild F bell\naim F pack\ndeck echo net\nforecast rush\n"
                    "rush\nstep 4\nj\nrun\nreport\ngo\nstep\nk\nquit\n")
        result = launch(commands, ("--step",))
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        for detail in ("01 r+r", "06 r+r", "Echo Reel / extra shot from C",
                       "Wave 1 held / clean water / +6 brass / rush +6", "firing report",
                       "Slackwater Net / slowed 1", "Waves held 1"):
            self.assertIn(detail, result.stdout)
        self.assertRegex(result.stdout, r"F\s+Washbell 1\s+pack\s+3\s+3\s+2")
        self.assertNotIn("\x1b", result.stdout)

    def test_help_and_usage_error(self):
        result = launch(args=("--help",))
        self.assertEqual(result.returncode, 0)
        self.assertIn("--step", result.stdout)
        self.assertIn("terminal", result.stdout)
        self.assertNotEqual(launch(args=("--missing-option",)).returncode, 0)

    def test_quick_start_recovery_from_errors_and_eof(self):
        result = launch("bad order\nhelp\nbuild C pin\nbuild F bell\ngo\nstep 1\n1\nrun\nlook F\n",
                        ("--step",))
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        for term in ("Unknown order", "field guide", "CP1", "FB1", "Discharged the Inlet",
                     "Wave 1 held", "F / WASHBELL 1", "Waves held 1"):
            self.assertIn(term, result.stdout)
        self.assertNotIn("\x1b", result.stdout)

    def test_redirected_input_automatically_uses_steps_and_quits_midwave(self):
        result = launch("go\n\nq\n")
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn("STEP WATCH", result.stdout)
        self.assertIn("FLOW / BEAT 001", result.stdout)
        self.assertIn("Clocked off.", result.stdout)
        self.assertNotIn("\x1b", result.stdout)

    def test_an_undefended_gate_falls_and_the_process_ends(self):
        result = launch("go\nrun\n" * 5)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn("GATE BREACHED", result.stdout)
        self.assertIn("firing report", result.stdout)
        self.assertIn("No towers deployed.", result.stdout)
        self.assertIn("Gate breached on wave 3.", result.stdout.splitlines()[-1])
        self.assertIn("Waves held 2", result.stdout.splitlines()[-1])

    def test_entire_playable_campaign_and_third_boss_in_overtime(self):
        # Ordinary player orders and earned brass, including a deliberate early leak.
        shop = {
            1: ["build D pin", "build E loom"], 3: ["up D"], 6: ["up D"],
            7: ["build F pin"], 8: ["up F"], 10: ["up F"], 11: ["build B bell"],
            12: ["up B"], 13: ["up B"], 14: ["build C pin"], 15: ["up C"],
            16: ["up C"], 17: ["up E"], 18: ["up E"], 19: ["build H pin", "up H"],
            20: ["up H"], 21: ["build A loom", "up A"], 22: ["up A"],
            23: ["build G pin", "up G"], 24: ["up G"],
        }
        commands = []
        for wave in range(1, 31):
            if wave == 21:
                commands.append("overtime")
            commands.extend(shop.get(wave, []))
            commands.extend(["go", "run"])
        commands.append("quit")
        result = launch("\n".join(commands) + "\n")
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        for wave in (10, 20, 30):
            self.assertIn(f"WAVE {wave} / BOSS TIDE", result.stdout)
            self.assertIn(f"Wave {wave} held", result.stdout)
        self.assertIn("WATCH COMPLETE", result.stdout)
        self.assertIn("Waves held 30", result.stdout.splitlines()[-1])
        self.assertIn("Crownwakes stopped 3", result.stdout.splitlines()[-1])
        self.assertNotIn("Need ", result.stdout)

    def test_eof_and_keyboard_interrupt_close_cleanly(self):
        class InterruptingInput(StringIO):
            def readline(self):
                raise KeyboardInterrupt

        for source in (StringIO(""), InterruptingInput()):
            output = StringIO()
            play(Game(), source, output)
            self.assertIn("Clocked off.  Waves held 0", output.getvalue().splitlines()[-1])
