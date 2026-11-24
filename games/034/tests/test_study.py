from collections import Counter
import unittest
from unittest.mock import patch

from gutterlight.battle import Battle, MIDFIELD, Lane, Mode, Move, Setup, Side
from gutterlight.pilot import Pilot, finish
from gutterlight.practice import pick_code, study_orders, study_table
from gutterlight.recording import document, load, reconstruct, save
from gutterlight.sessions import watch
from tests.support import ROOT, TimedConsole, arranged, cli, tape_folder


AMBER, INDIGO = Side
ROOF, CANAL = Lane
LEGACY = ROOT / "tests" / "round1-seed27.json"


class StudyTests(unittest.TestCase):
    def test_only_legal_orders_and_pass_are_offered_even_on_the_last_beat(self):
        game = arranged(amber=("patch", "squall", "chit", "shale"), limit=1)
        tape = reconstruct(document(game))
        study = study_orders(tape, 0, keep_pick=" 3c ")
        self.assertEqual([pick_code(t.move) for t in study.trials], ["PASS", "3R", "3C", "4R", "4C"])
        self.assertTrue(all(t.end == 1 and t.result_for(AMBER) == "DRAW" for t in study.trials))
        self.assertEqual(study.selected_game.dispatches[0].move, Move(2, CANAL))
        self.assertIsNone(study.recorded_pick)
        self.assertIn("recording ends at beat 0", study_table(study))

        game = arranged(amber=("ballast",), limit=4)
        game.step(Move(0, ROOF))
        game.step()
        game.step()
        study = study_orders(reconstruct(document(game)), 3, keep_pick="pass")
        self.assertEqual([t.move for t in study.trials], [None])
        self.assertEqual(study.selected_game.players[AMBER].energy, 1)

    def test_each_trial_matches_an_independent_game_and_ranks_for_the_selected_side(self):
        for mode in Mode:
            setup = Setup.deal(1, mode=mode)
            tape = reconstruct(document(Battle(setup)))
            for side in Side:
                with self.subTest(mode=mode, side=side):
                    study = study_orders(tape, 0, side)
                    ranks = []
                    for trial in study.trials:
                        branch = Battle(setup)
                        amber, indigo = (Pilot(setup.seed, s) for s in Side)
                        orders = [amber.choose(branch), indigo.choose(branch)]
                        self.assertEqual(orders[side.other], study.opponent_move)
                        orders[side] = trial.move
                        branch.step(*orders)
                        finish(branch, amber, indigo)
                        final = branch.frame()
                        self.assertEqual((trial.end, trial.outcome), (final.tick, final.outcome))
                        self.assertEqual(trial.hull_margin, sum(final.hull[side]) - sum(final.hull[side.other]))
                        objective = 0
                        if mode is Mode.BEACON:
                            objective = final.charge[side] - final.charge[side.other]
                        elif mode is Mode.CONVOY:
                            objective = sum(c - MIDFIELD for c in final.carts) * side.direction
                        self.assertEqual(trial.objective_margin, objective)
                        rank = 1 if final.outcome.winner is side else -1
                        ranks.append((0 if final.outcome.winner is None else rank, objective, trial.hull_margin))
                    self.assertEqual(ranks, sorted(ranks, reverse=True))
                    self.assertEqual(len(study.trials), len({t.move for t in study.trials}))
                    self.assertIsNone(study.selected_game)
                    table = study_table(study)
                    self.assertEqual("CHARGE" in table, mode is Mode.BEACON)
                    self.assertEqual("CART" in table, mode is Mode.CONVOY)

    def test_future_human_orders_only_identify_the_recorded_pick(self):
        game = arranged(amber=("wick",), indigo=("chit",), limit=24)
        game.step(Move(0, CANAL))
        prefix = reconstruct(document(game))
        game.step(None, Move(0, CANAL))
        full = reconstruct(document(game))
        first = study_orders(prefix, 1, INDIGO, keep_pick="1r")
        second = study_orders(full, 1, INDIGO, keep_pick="1r")
        self.assertEqual((first.recorded_pick, second.recorded_pick), (None, "1C"))
        self.assertEqual(first.trials, second.trials)
        self.assertEqual(first.opponent_move, second.opponent_move)
        self.assertEqual(document(first.selected_game), document(second.selected_game))
        branch = reconstruct(document(second.selected_game))
        self.assertEqual(branch.frames[:2], prefix.frames)
        self.assertEqual(branch.orders[1], (None, Move(0, ROOF)))
        self.assertEqual(full.orders[1], (None, Move(0, CANAL)))
        self.assertEqual(study_orders(full, 1, AMBER).recorded_pick, "PASS")

    def test_overriding_with_the_recorded_pilot_choice_reproduces_the_entire_legacy_tape(self):
        tape = load(LEGACY)
        study = study_orders(tape, 118, INDIGO, keep_pick="2R")
        self.assertEqual(study.recorded_pick, "2R")
        self.assertEqual(reconstruct(document(study.selected_game)), tape)
        actual = next(t for t in study.trials if pick_code(t.move) == "2R")
        self.assertEqual(actual.hull_margin, 64)
        self.assertGreater(study.trials[0].hull_margin, actual.hull_margin)

    def test_cli_saves_the_selected_branch_and_reports_its_actual_finish(self):
        original = LEGACY.read_bytes()
        with tape_folder() as folder:
            path = folder / "night class.json"
            run = cli("study", LEGACY, "--tick", 118, "--side", "indigo", "--save-pick", "4c", path)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn("Indigo to order on beat 119", run.stdout)
            self.assertIn("Recorded Indigo pick    2R", run.stdout)
            self.assertIn("Ink Glider / Canal", run.stdout)
            self.assertIn(f"Saved replay to {path}", run.stdout)
            tape, branch = load(LEGACY), load(path)
            self.assertEqual(branch.frames[:119], tape.frames[:119])
            self.assertEqual(branch.orders[118], (None, Move(3, CANAL)))
            self.assertEqual(branch.frames[-1].outcome.winner, INDIGO)
            self.assertEqual(study_orders(tape, 118, INDIGO).trials[0].hull_margin,
                             sum(branch.frames[-1].hull[INDIGO]) - sum(branch.frames[-1].hull[AMBER]))
        self.assertEqual(LEGACY.read_bytes(), original)

    def test_rejected_studies_preserve_the_source_and_existing_destination(self):
        with tape_folder() as folder:
            source, dest = folder / "original.json", folder / "branch.json"
            game = arranged(amber=("patch",), limit=1)
            game.step()
            save(game, source)
            original = source.read_bytes()
            dest.write_bytes(b"previous match")
            for args, message in (
                (("--tick", "-1"), "recorded beat"),
                (("--tick", "1"), "earlier beat"),
                (("--tick", "0", "--side", "jade"), "invalid choice"),
                (("--tick", "0", "--save-pick", "1R", dest), "legal pick"),
                (("--tick", "0", "--save-pick", "5X", dest), "legal pick"),
                (("--tick", "0", "--save-pick", "PASS", source), "different file"),
            ):
                with self.subTest(args=args):
                    refused = cli("study", source, *args)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn(message, refused.stderr)
                    self.assertNotIn("Traceback", refused.stderr)
            self.assertEqual(source.read_bytes(), original)
            source.write_bytes(original.replace(b'"seed": 19', b'"seed": 20'))
            refused = cli("study", source, "--tick", 0, "--save-pick", "PASS", dest)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("fingerprint mismatch", refused.stderr)
            self.assertEqual(dest.read_bytes(), b"previous match")


class StudyViewerTests(unittest.TestCase):
    def test_study_pauses_can_change_seats_and_handles_the_result_and_restart(self):
        game = arranged(limit=2)
        game.step()
        game.step()
        tape = reconstruct(document(game))
        keys = [(0.1, "d"), (2, "\t"), (3, "n"), (4, "e"), (5, "b"),
                (6, "s"), (7, "d"), (8, " "), (8.6, "q")]
        terminal = TimedConsole(keys)
        with patch("gutterlight.sessions.study_orders", wraps=study_orders) as run:
            self.assertEqual(watch(tape, terminal, terminal.now), 2)
        self.assertEqual(Counter((c.args[1], c.args[2]) for c in run.call_args_list),
                         {(0, AMBER): 1, (0, INDIGO): 1, (1, INDIGO): 1})
        screens = [s for _, s in terminal.screens]
        self.assertIn("0/2  1x paused", screens[1])
        self.assertIn("Amber to order on beat 1", screens[1])
        self.assertIn("Indigo to order on beat 1", screens[2])
        self.assertIn("Indigo to order on beat 2", screens[3])
        self.assertIn("Step back", screens[4])
        self.assertIn(tape.frames[-1].outcome.text, screens[4])
        self.assertIn("SCOUTING REPORT", screens[6])
        self.assertIn("DECISION STUDY", screens[7])
        self.assertIn("1/2  1x playing", screens[8])
        self.assertIn("AMBER HAND", screens[8])

    def test_partial_end_can_be_studied_and_all_choices_fit_on_the_console(self):
        for mode in Mode:
            game = arranged(mode=mode)
            tape = reconstruct(document(game))
            terminal = TimedConsole(enumerate(("d", "]", "\t", "d", "q")))
            self.assertEqual(watch(tape, terminal, terminal.now), 0)
            self.assertIn("recording ends at beat 0", terminal.screens[1][1])
            self.assertIn("HIGHLIGHT", terminal.screens[2][1])
            self.assertIn("Indigo to order", terminal.screens[3][1])
            self.assertIn("AMBER HAND", terminal.screens[4][1])
            for _, screen in terminal.screens:
                lines = screen.splitlines()
                self.assertLessEqual(len(lines), 24)
                self.assertLessEqual(max(map(len, lines)), 80)
