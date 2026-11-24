import unittest

from gutterlight.battle import TOWER_HP, Lane, Mode, Move, Setup, Side
from gutterlight.pilot import simulate
from gutterlight.recording import document, reconstruct
from gutterlight.report import LaneTotals, scouting_report, totals_at
from gutterlight.sessions import practice_start, watch
from tests.support import ROOT, TimedConsole, arranged, cli


AMBER, INDIGO = Side
ROOF, CANAL = Lane


class ReportTests(unittest.TestCase):
    def test_opening_and_prefix_use_only_orders_already_played(self):
        game = arranged(amber=("clip",), indigo=("squall",))
        opening = reconstruct(document(game))
        self.assertIn("No cards played yet", scouting_report(opening, 0))
        game.step(Move(0, ROOF))
        prefix = reconstruct(document(game))
        game.step(None, Move(0, ROOF))
        while game.tick < 12:
            game.step()
        game.step(Move(0, CANAL))  # The old Clip slot now holds Ballast.
        tape = reconstruct(document(game))
        self.assertEqual(totals_at(tape, 0), totals_at(opening, 0))
        self.assertEqual(totals_at(tape, 1), totals_at(prefix, 1))
        self.assertEqual(totals_at(tape, 1)[AMBER].lanes[ROOF],
                         LaneTotals(plays=1, spent=3, deployed=3))
        self.assertNotIn("Ballast Mule", scouting_report(tape, 1))
        amber, indigo = totals_at(tape, tape.end)
        self.assertEqual(amber.cards, {"clip": 1, "ballast": 1})
        self.assertEqual(amber.lanes[ROOF], LaneTotals(plays=1, spent=3, deployed=3, lost=3))
        self.assertEqual(amber.lanes[CANAL], LaneTotals(plays=1, spent=5, deployed=1))
        self.assertEqual(indigo.lanes[ROOF], LaneTotals(plays=1, spent=3))
        self.assertIn("Match left in progress", scouting_report(tape, tape.end))
        for tick in (True, -1, tape.end + 1):
            with self.subTest(tick=tick), self.assertRaisesRegex(ValueError, "recorded beat"):
                totals_at(tape, tick)

    def test_repair_and_strike_on_one_beat_count_even_when_hull_stays_level(self):
        game = arranged(amber=("rivet",), indigo=("patch",))
        game.step(Move(0, ROOF))
        tower = game.towers[INDIGO][ROOF]
        while tower.hp == TOWER_HP and game.outcome is None:
            game.step()
        self.assertEqual(tower.hp, 129)
        game.step()
        game.step()
        game.step(None, Move(0, ROOF))
        self.assertEqual(tower.hp, 129)
        tape = reconstruct(document(game))
        previous = totals_at(tape, tape.end - 1)
        current = totals_at(tape, tape.end)
        self.assertEqual(previous[AMBER].lanes[ROOF].damage, 21)
        self.assertEqual(current[AMBER].lanes[ROOF].damage, 42)
        self.assertEqual(current[INDIGO].lanes[ROOF].repaired, 21)
        self.assertEqual(current[INDIGO].lanes[ROOF].damage, 0)
        self.assertEqual(current[AMBER].lanes[CANAL].damage, 0)

    def test_spending_on_a_regen_beat_frees_room_before_the_cap(self):
        game = arranged()
        while game.tick < 23:
            game.step()
        game.step(Move(0, ROOF))
        tape = reconstruct(document(game))
        self.assertEqual([side.missed_regen for side in totals_at(tape, 23)], [0, 0])
        self.assertEqual([side.missed_regen for side in totals_at(tape, 24)], [0, 1])
        self.assertEqual(tape.frames[24].energy, (9, 10))

    def test_totals_reconcile_with_real_matches_in_every_mode(self):
        for mode in Mode:
            with self.subTest(mode=mode):
                game = simulate(Setup.deal(11, amber="viaduct", mode=mode))
                tape = reconstruct(document(game))
                report = totals_at(tape, tape.end)
                rows = [lane for side in report for lane in side.lanes]
                self.assertEqual(sum(lane.plays for lane in rows), len(game.dispatches))
                self.assertEqual(sum(lane.deployed for lane in rows), game.next_uid - 1)
                self.assertEqual(sum(lane.lost for lane in rows), game.next_uid - 1 - len(game.units))
                self.assertEqual(sum(lane.damage - lane.repaired for lane in rows),
                                 4 * TOWER_HP - sum(map(sum, game.frame().hull)))
                screen = scouting_report(tape, tape.end)
                self.assertIn(game.outcome.text, screen)
                self.assertEqual("Beacon charge" in screen, mode is Mode.BEACON)
                self.assertEqual("Cart cells" in screen, mode is Mode.CONVOY)

    def test_viewer_report_pauses_can_step_and_returns_to_the_same_board(self):
        game = arranged(limit=3)
        game.step(Move(1, CANAL))
        game.step()
        game.step()
        tape = reconstruct(document(game))
        keys = [(0.1, "s"), (2.0, "n"), (2.1, "s"), (2.2, "s"),
                (2.3, "e"), (2.4, "q")]
        terminal = TimedConsole(keys)
        self.assertEqual(watch(tape, terminal, terminal.now), tape.end)
        screens = [screen for _, screen in terminal.screens]
        self.assertIn("0/3  1x paused", screens[1])
        self.assertIn("No cards played yet", screens[1])
        self.assertIn("SCOUTING REPORT", screens[2])
        self.assertIn("Clip Crew", screens[2])
        self.assertNotIn("RESULT", screens[2])
        self.assertIn("1/3  1x paused", screens[3])
        self.assertIn("AMBER HAND", screens[3])
        self.assertIn("RESULT", screens[-1])

    def test_board_report_and_controls_fit_a_standard_terminal(self):
        for mode in Mode:
            with self.subTest(mode=mode):
                tape = reconstruct(document(simulate(Setup.deal(27, mode=mode))))
                partial, _, _ = practice_start(tape, tape.end - 1)
                keys = [(3.1, "s"), (3.2, "e"), (3.3, "]"), (3.4, "s"), (3.5, "["), (3.6, "q")]
                for replay in (tape, reconstruct(document(partial))):
                    terminal = TimedConsole(keys)
                    watch(replay, terminal, terminal.now)
                    for _, screen in terminal.screens:
                        lines = screen.splitlines()
                        self.assertLessEqual(len(lines), 24)
                        self.assertLessEqual(max(map(len, lines)), 80)

    def test_cli_report_on_legacy_tape_and_invalid_combinations(self):
        path = ROOT / "tests" / "round1-seed27.json"
        at_open = cli("replay", path, "--stats", "--tick", 0)
        self.assertEqual(at_open.returncode, 0, at_open.stderr)
        self.assertIn("No cards played yet", at_open.stdout)
        self.assertNotIn("RESULT", at_open.stdout)
        final = cli("replay", path, "--stats")
        self.assertEqual(final.returncode, 0, final.stderr)
        self.assertIn("Indigo wins", final.stdout)
        for flags in (("--events",), ("--frames",), ("--highlights",), ("--tick", "181")):
            with self.subTest(flags=flags):
                refused = cli("replay", path, "--stats", *flags)
                self.assertNotEqual(refused.returncode, 0)
                self.assertNotIn("Traceback", refused.stderr)
                self.assertEqual(refused.stdout, "")
