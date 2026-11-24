import unittest

from gutterlight.battle import Battle, Event, Lane, Mode, Move, Outcome, Setup, Side
from gutterlight.pilot import Pilot, finish, simulate
from gutterlight.recording import ReplayError, document, load, reconstruct
from gutterlight.sessions import play_live, practice_start, replay_board, watch
from tests.support import ROOT, TimedConsole, arranged


class PracticeTests(unittest.TestCase):
    def test_real_round_one_recording_verifies_and_its_pilots_reproduce_the_finish(self):
        tape = load(ROOT / "tests" / "round1-seed27.json")
        self.assertEqual((tape.setup.mode, tape.setup.seed, tape.end), (Mode.CLASSIC, 27, 180))
        final = tape.frames[-1]
        self.assertEqual((final.hull, final.outcome), (((108, 128), (150, 150)), Outcome(Side.INDIGO, "clock")))
        match, amber, indigo = practice_start(tape, 118)
        finish(match, amber, indigo)
        self.assertEqual(reconstruct(document(match)), tape)

    def test_auto_continuations_restore_cooldowns_reserves_charge_and_pilot_rng(self):
        for mode in Mode:
            original = simulate(Setup.deal(41, amber="viaduct", mode=mode))
            tape = reconstruct(document(original))
            for tick in (0, 1, 16, tape.end - 1):
                with self.subTest(mode=mode, tick=tick):
                    branch, amber, indigo = practice_start(tape, tick)
                    self.assertEqual(branch.frame(), tape.frames[tick])
                    finish(branch, amber, indigo)
                    self.assertEqual(document(branch), document(original))
                    self.assertEqual(branch.events, original.events)

    def test_live_takeover_changes_only_future_orders_and_leaves_the_tape_reusable(self):
        game = arranged(mode=Mode.BEACON)
        game.step(Move(0, Lane.ROOF))
        game.step()
        game.step(None, Move(1, Lane.ROOF))
        tape = reconstruct(document(game))
        branch, _, indigo = practice_start(tape, 2)
        terminal = TimedConsole([(0.1, "2"), (0.2, "c"), (0.6, "q")])
        play_live(branch, terminal, terminal.now, opponent=indigo)
        saved = reconstruct(document(branch))
        self.assertEqual(saved.end, 3)
        self.assertEqual(saved.frames[:3], tape.frames[:3])
        self.assertEqual(saved.orders[:2], tape.orders[:2])
        self.assertEqual(saved.orders[2][Side.AMBER], Move(1, Lane.CANAL))
        self.assertIsNone(tape.orders[2][Side.AMBER])
        self.assertEqual(practice_start(tape, 3)[0].frame(), game.frame())
        self.assertIn("Beat 2/180", terminal.screens[0][1])

    def test_partial_human_tape_restores_indigos_exact_next_decision(self):
        original = Battle(Setup.deal(23, mode=Mode.BEACON))
        opponent = Pilot(23, Side.INDIGO)
        for tick in range(23):
            manual = None
            if tick in (3, 14):
                manual = next((Move(slot, Lane.CANAL) for slot in range(4)
                               if not original.problem(Side.AMBER, Move(slot, Lane.CANAL))), None)
            original.step(manual, opponent.choose(original))
        tape = reconstruct(document(original))
        branch, _, restored_opponent = practice_start(tape, tape.end)
        for _ in range(12):
            expected = opponent.choose(original)
            actual = restored_opponent.choose(branch)
            self.assertEqual(actual, expected)
            original.step(None, expected)
            branch.step(None, actual)
        self.assertEqual(document(branch), document(original))

    def test_practice_rejects_result_and_bad_tick_but_accepts_an_empty_tape(self):
        match = arranged(limit=1)
        opening = reconstruct(document(match))
        self.assertEqual(practice_start(opening, 0)[0].frame(), match.frame())
        match.step()
        tape = reconstruct(document(match))
        for tick, message in ((-1, "recorded beat"), (2, "recorded beat"), (True, "recorded beat"),
                              (0.5, "recorded beat"), (1, "earlier beat")):
            with self.subTest(tick=tick), self.assertRaisesRegex(ValueError, message):
                practice_start(tape, tick)
        with self.assertRaisesRegex(ValueError, "recorded beat"):
            replay_board(tape, -1)

    def test_version_two_records_the_mode_and_detects_a_valid_mode_substitution(self):
        tape = document(arranged(mode=Mode.BEACON))
        self.assertEqual((tape["version"], tape["mode"]), (2, "beacon"))
        for mode in (None, True, "fog", ["beacon"]):
            with self.subTest(mode=mode), self.assertRaisesRegex(ReplayError, "replay mode"):
                reconstruct({**tape, "mode": mode})
        with self.assertRaisesRegex(ReplayError, "fingerprint mismatch"):
            reconstruct({**tape, "mode": "classic"})
        game = arranged(mode=Mode.BEACON)
        hashed = document(game)["state_sha256"]
        game.charge[Side.INDIGO] += 1
        self.assertNotEqual(document(game)["state_sha256"], hashed)


class HighlightTests(unittest.TestCase):
    def test_first_charge_and_lead_group_on_one_beat_and_partial_end_is_marked(self):
        game = arranged(mode=Mode.BEACON)
        game.step(Move(0, Lane.ROOF))
        while game.tick < 6:
            game.step()
        marks = reconstruct(document(game)).highlights()
        self.assertEqual([event.tick for event in marks], [0, 4, 6])
        self.assertIn("Amber banks its first charge", marks[1].text)
        self.assertIn("Amber takes the clock lead", marks[1].text)
        self.assertIn("left in progress", marks[-1].text)
        self.assertEqual(reconstruct(document(arranged())).highlights(),
                         (Event(0, "Opening deal. End of recording."),))

    def test_legacy_highlights_include_first_hit_clock_tie_and_result(self):
        tape = load(ROOT / "tests" / "round1-seed27.json")
        marks = tape.highlights()
        self.assertEqual([mark.tick for mark in marks], [0, 119, 129, 135, 163, 180])
        self.assertIn("First hit on Amber Canal (143 hull)", marks[1].text)
        self.assertNotIn("First hit", marks[3].text)
        self.assertEqual(marks[2].text, "Clock score level.")
        self.assertEqual(marks[-1].text, tape.frames[-1].outcome.text)

    def test_highlight_keys_seek_strictly_from_the_current_frame_and_pause(self):
        tape = load(ROOT / "tests" / "round1-seed27.json")
        keys = [(0.01, "["), (0.02, "]"), (0.03, "n"), (0.04, "["),
                (0.05, "["), (0.06, "e"), (0.07, "]"), (0.08, "q")]
        terminal = TimedConsole(keys)
        self.assertEqual(watch(tape, terminal, terminal.now), tape.end)
        expected = [0, 0, 119, 120, 119, 0, 180, 180]
        self.assertEqual(len(terminal.screens), len(expected))
        for (_, screen), tick in zip(terminal.screens[1:], expected[1:]):
            self.assertIn(f"REPLAY {tick}/180  1x paused", screen)
        self.assertIn("HIGHLIGHT  First hit on Amber Canal", terminal.screens[2][1])
        self.assertNotIn("HIGHLIGHT", terminal.screens[3][1])
