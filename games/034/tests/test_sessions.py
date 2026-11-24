from contextlib import redirect_stdout
from io import StringIO
import sys
import unittest
from unittest.mock import Mock, patch

from gutterlight.battle import Dispatch, Lane, Mode, Move, Side
from gutterlight.cards import CARDS, DECKS
from gutterlight.display import board, catalog, clock_text
from gutterlight.recording import document, reconstruct
from gutterlight.sessions import play_live, replay_board, watch
from gutterlight.terminal import Terminal
from tests.support import TimedConsole, arranged, place


class DisplayTests(unittest.TestCase):
    def test_half_second_clock_and_both_energy_bars(self):
        self.assertEqual([clock_text(t) for t in (0, 1, 119, 120, 601)],
                         ["0:00.0", "0:00.5", "0:59.5", "1:00.0", "5:00.5"])
        game = arranged()
        game.players[Side.AMBER].energy = 0
        game.players[Side.INDIGO].energy = 10
        screen = board(game.frame(), "LIVE", selected=2)
        self.assertIn("AMBER [..........]  0/10", screen)
        self.assertIn("INDIGO [##########] 10/10", screen)
        self.assertIn(">[3] Ink Glider (3)", screen)
        self.assertNotIn("INDIGO HAND", screen)
        self.assertIn("INDIGO HAND", board(game.frame(), "REPLAY", both_hands=True))
        self.assertTrue(screen.isascii())

    def test_two_lane_track_shows_stacks_mixed_groups_and_contested_cells(self):
        game = arranged()
        for side, lane, key, cell in (
            (Side.AMBER, Lane.ROOF, "wick", 3), (Side.AMBER, Lane.ROOF, "wick", 3),
            (Side.INDIGO, Lane.ROOF, "ink", 8), (Side.INDIGO, Lane.ROOF, "clip", 8),
            (Side.AMBER, Lane.CANAL, "rivet", 5), (Side.INDIGO, Lane.CANAL, "loom", 5),
        ):
            place(game, side, lane, key, cell)
        game.towers[Side.INDIGO][Lane.ROOF].hp = 42
        lines = board(game.frame(), "LIVE").splitlines()
        roof = next(line for line in lines if line.startswith("  Roof"))
        canal = next(line for line in lines if line.startswith("  Canal"))
        self.assertIn("W2", roof)
        self.assertIn("i+", roof)
        self.assertIn("42", roof)
        self.assertNotIn("><", roof)
        self.assertIn("><", canal)

    def test_catalog_explains_every_card_and_lists_both_decks(self):
        manual = catalog()
        for card in CARDS.values():
            self.assertIn(card.name, manual)
            self.assertIn(card.description, manual)
        for name in DECKS:
            self.assertIn(name.upper(), manual)


class LiveSessionTests(unittest.TestCase):
    def test_long_card_notice_fits_an_eighty_column_terminal(self):
        game = arranged(amber=("kiln",), mode=Mode.CONVOY)
        terminal = TimedConsole([(0.1, "1"), (0.2, "q")])
        play_live(game, terminal, terminal.now)
        lines = terminal.screens[-1][1].splitlines()
        self.assertIn(CARDS["kiln"].description, " ".join(lines))
        self.assertLessEqual(max(map(len, lines)), 80)
        self.assertLessEqual(len(lines), 24)

    def test_clock_runs_with_no_input_and_accounts_for_drawing_time(self):
        game = arranged(limit=4)
        terminal = TimedConsole(draw_cost=0.06)
        play_live(game, terminal, terminal.now)
        self.assertEqual(game.tick, 4)
        self.assertIsNotNone(game.outcome)
        self.assertEqual({d.side for d in game.dispatches}, {Side.INDIGO})
        self.assertEqual(len(terminal.screens), 5)
        for tick, (when, _) in enumerate(terminal.screens[1:], start=1):
            self.assertAlmostEqual(when, 0.06 + 0.5 * tick)

    def test_slot_then_lane_dispatches_once_and_reports_an_unaffordable_order(self):
        game = arranged(limit=3)
        terminal = TimedConsole([(0.01, "r"), (0.05, "1"), (0.1, "r"),
                                 (0.55, "1"), (0.6, "c")])
        play_live(game, terminal, terminal.now)
        amber = [d for d in game.dispatches if d.side == Side.AMBER]
        self.assertEqual(amber, [Dispatch(1, Side.AMBER, Move(0, Lane.ROOF))])
        screens = "\n".join(screen for _, screen in terminal.screens)
        for message in ("Select a hand slot", "Wick Runner  |", "Queued Wick Runner",
                        "Ballast Mule needs 5 energy"):
            self.assertIn(message, screens)

    def test_cancel_reselect_and_retarget_before_the_beat(self):
        game = arranged(limit=2)
        terminal = TimedConsole([(0.01, "1"), (0.02, "r"), (0.03, "x"),
                                 (0.51, "1"), (0.52, "r"), (0.53, "2"),
                                 (0.54, "r"), (0.55, "c")])
        play_live(game, terminal, terminal.now)
        amber = [d for d in game.dispatches if d.side == Side.AMBER]
        self.assertEqual(amber, [Dispatch(2, Side.AMBER, Move(1, Lane.CANAL))])

    def test_leaving_preserves_a_replayable_partial_match(self):
        game = arranged()
        terminal = TimedConsole([(0.1, "2"), (0.2, "c"), (0.55, "q")])
        play_live(game, terminal, terminal.now)
        self.assertEqual(game.tick, 1)
        self.assertIsNone(game.outcome)
        self.assertEqual(reconstruct(document(game)).frames[-1], game.frame())

    def test_a_slow_redraw_cannot_starve_a_queued_quit(self):
        game = arranged(limit=8)
        terminal = TimedConsole([(1.6, "q")], draw_cost=0.8)
        play_live(game, terminal, terminal.now)
        self.assertEqual(game.tick, 2)
        self.assertEqual(terminal.inputs, [])
        self.assertIn(0, terminal.waits)

    def test_lane_key_on_a_beat_deadline_queues_for_the_next_open_beat(self):
        game = arranged(limit=3)
        terminal = TimedConsole([(0.1, "1"), (0.5, "c")])
        play_live(game, terminal, terminal.now)
        amber = [d for d in game.dispatches if d.side == Side.AMBER]
        self.assertEqual(amber, [Dispatch(2, Side.AMBER, Move(0, Lane.CANAL))])


class ViewerTests(unittest.TestCase):
    def setUp(self):
        game = arranged(limit=4)
        while game.outcome is None:
            game.step()
        self.tape = reconstruct(document(game))

    def test_playback_pauses_on_last_frame_and_space_restarts(self):
        terminal = TimedConsole([(3.0, " "), (3.6, "q")])
        self.assertEqual(watch(self.tape, terminal, terminal.now), 1)
        views = [screen.splitlines()[0] for _, screen in terminal.screens]
        self.assertIn("4/4  1x paused", views[4])
        self.assertIn("0/4  1x playing", views[5])
        self.assertIn(None, terminal.waits)

    def test_pause_step_seek_clamp_and_resume(self):
        keys = [(0.1, " "), (1.0, "left"), (1.1, "n"), (1.2, "end"),
                (1.3, "right"), (1.4, "b"), (1.5, "home"), (2.0, " "), (2.6, "q")]
        terminal = TimedConsole(keys)
        self.assertEqual(watch(self.tape, terminal, terminal.now), 1)
        expected = [0, 0, 0, 1, 4, 4, 3, 0, 0, 1]
        self.assertEqual(len(terminal.screens), len(expected))
        for (_, screen), tick in zip(terminal.screens, expected):
            self.assertIn(f"REPLAY {tick}/4", screen)
        self.assertIn("INDIGO HAND", terminal.screens[0][1])

    def test_speed_controls_change_actual_playback_interval_and_clamp(self):
        keys = [(0.1, "+"), (0.2, "="), (0.21, "+"), (0.48, "q")]
        terminal = TimedConsole(keys)
        self.assertEqual(watch(self.tape, terminal, terminal.now), 2)
        self.assertIn("4x playing", terminal.screens[-1][1])
        terminal = TimedConsole([(0.01, "-"), (0.02, "-"), (0.9, "q")])
        self.assertEqual(watch(self.tape, terminal, terminal.now), 0)
        self.assertIn("0.5x playing", terminal.screens[-1][1])

    def test_empty_and_in_progress_tapes_have_a_distinct_end(self):
        tape = reconstruct(document(arranged()))
        terminal = TimedConsole([(0, "e"), (0.1, " "), (0.2, "n"), (0.3, "q")])
        self.assertEqual(watch(tape, terminal, terminal.now), 0)
        self.assertTrue(all("0/0  1x paused" in s for _, s in terminal.screens))
        self.assertIn("Match left in progress", replay_board(tape, 0))
        self.assertNotIn("Match left in progress", replay_board(self.tape, 4))

    def test_slow_replay_render_still_polls_before_reaching_the_end(self):
        terminal = TimedConsole([(1.6, "q")], draw_cost=0.8)
        self.assertEqual(watch(self.tape, terminal, terminal.now), 2)
        self.assertIn(0, terminal.waits)

    def test_speed_changes_preserve_fractional_progress_and_repeated_keys_do_not_stall(self):
        keys = [(0.1, "+"), (0.2, "+"), (0.21, "+"), (0.23, "+"), (0.24, "+"), (0.26, "q")]
        terminal = TimedConsole(keys)
        # At 0.2 s, 60% of the first beat has elapsed. The last 40% takes 0.05 s at 4x.
        self.assertEqual(watch(self.tape, terminal, terminal.now), 1)
        self.assertAlmostEqual(terminal.screens[-1][0], 0.25)


class ConsoleTests(unittest.TestCase):
    def test_interrupt_signal_while_reading_a_key_exits_replay_at_the_current_beat(self):
        game = arranged()
        game.step()
        tape = reconstruct(document(game))
        terminal = Terminal()
        terminal._fd = 0
        with patch("gutterlight.terminal.os.name", "posix"), patch.object(terminal, "draw"), \
                patch("gutterlight.terminal.select.select", side_effect=[([0], [], []), KeyboardInterrupt]), \
                patch("gutterlight.terminal.os.read", return_value=b"n"):
            self.assertEqual(watch(tape, terminal, now=lambda: 0), 1)

    def test_numbered_posix_home_end_sequences_seek_and_function_keys_stay_silent(self):
        terminal = Terminal()
        data = b"\x1b[1~\x1b[4~\x1b[7~\x1b[8~\x1b[1;5~\x1b[14~\x1b[18~c"
        keys = [terminal._decode_posix(bytes([byte])) for byte in data]
        self.assertEqual([key for key in keys if key], ["home", "end", "home", "end", "home", "c"])

    def test_linux_console_function_keys_cannot_send_a_card_to_canal(self):
        terminal = Terminal()
        data = b"1\x1b[[A\x1b[[B\x1b[[C\x1b[[D\x1b[[ER"
        keys = [terminal._decode_posix(bytes([byte])) for byte in data]
        self.assertEqual([key for key in keys if key], ["1", "r"])

    def test_split_posix_escape_sequences_do_not_trigger_lane_shortcuts(self):
        terminal = Terminal()
        data = b"1\x1b[C\x1b[1;5D\x1bOH\x1b[F\x1b[BRC"
        keys = [terminal._decode_posix(bytes([byte])) for byte in data]
        self.assertEqual([key for key in keys if key], ["1", "right", "left", "home", "end", "r", "c"])

    def test_windows_key_poll_handles_extended_keys_letters_and_timeouts(self):
        keyboard = Mock()
        keyboard.getwch.side_effect = ["\xe0", "M", "R", "\x00", "G"]
        keyboard.kbhit.return_value = True
        with patch.dict(sys.modules, msvcrt=keyboard):
            self.assertEqual(Terminal._windows_key(0), "right")
            self.assertEqual(Terminal._windows_key(None), "r")
            self.assertEqual(Terminal._windows_key(None), "home")
            keyboard.kbhit.return_value = False
            self.assertIsNone(Terminal._windows_key(0))

    def test_plain_and_ansi_draw_clear_old_text(self):
        terminal = Terminal()
        output = StringIO()
        with redirect_stdout(output):
            terminal.draw("frame")
        self.assertEqual(output.getvalue(), "frame\n\n")
        terminal._ansi = True
        with redirect_stdout(StringIO()) as output:
            terminal.draw("lane\nhand")
        self.assertIn("lane\x1b[K\nhand", output.getvalue())
        self.assertTrue(output.getvalue().endswith("\x1b[J"))
