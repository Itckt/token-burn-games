from copy import deepcopy
import json
from shutil import copyfile, rmtree
import unittest
from unittest.mock import patch
from uuid import uuid4

from checkpoint import MAX_BYTES, load_watch, save_watch
from spillway import Game, PADS, Phase, RuleError, Tower, rehearse
from tests.test_terminal import ROOT, launch
from watchboard import report_view
from weirlight import WATCH_FILE, order


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.folder = ROOT / f"watch-test-{uuid4().hex[:12]}"
        self.folder.mkdir()
        self.addCleanup(rmtree, self.folder)
        self.slot = self.folder / WATCH_FILE.name

    def test_workshop_handover_includes_resources_refits_and_the_old_report(self):
        game = Game()
        for cmd in ("build B coil", "build A pin", "aim B heavy", "sluice 1", "rush",
                    "step 7", "v", "run", "sell B", "build B loom", "deck echo brace", "sluice 3"):
            order(game, cmd)
        self.assertEqual((game.gate, game.brass, game.vented), (12, 14, 3))
        before = deepcopy(game)
        save_watch(game, self.slot)
        resumed = load_watch(self.slot)
        self.assertEqual(game, before)
        self.assertEqual((resumed.gate, resumed.brass, resumed.charge, resumed.kills),
                         (game.gate, game.brass, game.charge, game.kills))
        self.assertEqual((resumed.deck, resumed.sluice, resumed.towers["B"].kind),
                         (("echo", "brace"), 3, "loom"))
        self.assertEqual(report_view(resumed), report_view(game))
        self.assertEqual(resumed.pad_reports["B"].aim, "heavy")
        for watch in (game, resumed):
            order(watch, "go")
        self.assertEqual(resumed, game)
        for watch in (game, resumed):
            order(watch, "run")
        self.assertEqual(resumed, game)

    def test_dawn_and_overtime_are_distinct_even_on_the_same_wave_number(self):
        game = Game(wave=19, cleared=19, kills=100, crowns=1,
                    towers={p: Tower("pin", 3, aim="heavy") for p in PADS})
        order(game, "go")
        order(game, "run")
        self.assertEqual((game.phase, game.crowns), (Phase.WON, 2))
        for overtime in (False, True):
            if overtime:
                game.continue_watch()
            save_watch(game, self.slot)
            resumed = load_watch(self.slot)
            self.assertEqual((resumed.wave, resumed.phase, resumed.overtime, resumed.crowns),
                             (20, game.phase, overtime, 2))
            self.assertEqual(report_view(resumed), report_view(game))
        resumed.start_wave()
        self.assertEqual((resumed.wave, resumed.phase, resumed.overtime), (21, Phase.WAVE, True))

    def test_illegal_phase_and_failed_replacement_preserve_the_previous_checkpoint(self):
        game = Game()
        save_watch(game, self.slot)
        original = self.slot.read_bytes()
        game.build("B", "coil")
        with patch("checkpoint.os.replace", side_effect=OSError("busy")):
            with self.assertRaisesRegex(RuleError, "write"):
                save_watch(game, self.slot)
        self.assertEqual(list(self.folder.iterdir()), [self.slot])
        for phase in (Phase.WAVE, Phase.LOST):
            game.phase = phase
            with self.assertRaises(RuleError):
                save_watch(game, self.slot)
            self.assertEqual(self.slot.read_bytes(), original)
        self.assertFalse(load_watch(self.slot).towers)
        self.assertEqual(self.slot.read_bytes(), original)

    def test_interrupted_write_discards_only_the_unfinished_copy(self):
        save_watch(Game(), self.slot)
        original = self.slot.read_bytes()

        def interrupt(data, file, **options):
            file.write('{"version":')
            raise KeyboardInterrupt

        with patch("checkpoint.json.dump", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                save_watch(Game(brass=18), self.slot)
        self.assertEqual(self.slot.read_bytes(), original)
        self.assertEqual(list(self.folder.iterdir()), [self.slot])

    def test_missing_unreadable_unsupported_and_damaged_files_give_player_errors(self):
        with self.assertRaisesRegex(RuleError, "No checkpoint"):
            load_watch(self.slot)
        with self.assertRaises(RuleError):
            load_watch(self.folder)
        for raw in (b"", b"garbage", b"{}", b"null", b"[]", b'{"version": 2}', b"\xff",
                    b"[" * 2000 + b"]" * 2000, b" " * MAX_BYTES + b"0"):
            with self.subTest(size=len(raw)):
                self.slot.write_bytes(raw)
                with self.assertRaisesRegex(RuleError, "Invalid or unsupported"):
                    load_watch(self.slot)
                self.assertEqual(self.slot.read_bytes(), raw)

    def test_bad_numbers_cards_tower_orders_and_report_rows_are_rejected(self):
        game = Game(towers={"A": Tower("coil")}, sluice=1)
        game.start_wave()
        order(game, "run")
        save_watch(game, self.slot)
        valid = json.loads(self.slot.read_text(encoding="utf-8"))
        for path, value in (
            (("version",), True), (("gate",), 0), (("charge",), 1.5), (("charge",), 7),
            (("brass",), -1), (("kills",), False), (("overtime",), True), (("wave",), 21),
            (("crowns",), 1), (("wave",), None), (("deck",), "jj"),
            (("deck",), ["echo", "echo"]), (("deck",), ["echo", "bad"]),
            (("sluice",), True), (("sluice",), 4), (("towers",), []),
            (("towers", "X"), {}), (("towers", "A", "aim"), "pack"),
            (("towers", "A", "kind"), "lost"), (("towers", "A", "level"), 4),
            (("last_wave", "rush"), 1), (("last_wave", "vented"), -1),
            (("last_wave", "pads", "A", "shots"), 0),
            (("last_wave", "pads", "A", "shots"), 999),
            (("last_wave", "pads", "A", "kills"), 999),
        ):
            with self.subTest(path=path, value=value):
                edited = deepcopy(valid)
                parent = edited
                for key in path[:-1]:
                    parent = parent[key]
                parent[path[-1]] = value
                self.slot.write_text(json.dumps(edited), encoding="utf-8")
                with self.assertRaises(RuleError):
                    load_watch(self.slot)

    def test_drills_predict_a_full_watch_across_three_boss_handovers(self):
        game = Game()
        shop = {
            1: ("build B coil", "build A pin", "sluice 1"), 3: ("up B",), 5: ("up B",),
            6: ("build D pin",), 7: ("up D",), 8: ("up D",), 9: ("build E loom",),
            10: ("build F coil",), 11: ("up F", "up F"), 12: ("up E",),
            13: ("up E", "build H pin"), 14: ("up H",), 15: ("up H",), 16: ("up A", "up A"),
            17: ("build C bell",), 18: ("up C",), 19: ("up C", "build G pin"), 20: ("up G", "up G"),
        }
        for wave in range(1, 31):
            with self.subTest(wave=wave):
                if game.phase is Phase.WON:
                    order(game, "overtime")
                for cmd in shop.get(wave, ()):
                    order(game, cmd)
                forecasts = [rehearse(game, rush=rush, vent_beat=7).watch for rush in (False, True)]
                best = max(forecasts, key=lambda watch: (watch.gate, watch.brass))
                order(game, "rush" if best.rush else "go")
                order(game, "step 7")
                if game.phase is Phase.WAVE:
                    if best.vented:
                        order(game, "v")
                    else:
                        with self.assertRaises(RuleError):
                            order(game, "v")
                    order(game, "run")
                self.assertEqual(game, best)
                if wave % 10 == 0:
                    self.assertEqual((game.cleared, game.crowns), (wave, wave // 10))
                    save_watch(game, self.slot)
                    game = load_watch(self.slot)
        self.assertEqual((game.phase, game.gate, game.cleared, game.crowns), (Phase.BUILD, 12, 30, 3))

    def test_documented_opening_saves_and_resumes_in_a_second_process(self):
        # Run a fresh copy so the normal CLI can never overwrite a player's watch.
        for name in ("weirlight.py", "spillway.py", "watchboard.py", "checkpoint.py"):
            copyfile(ROOT / name, self.folder / name)
        missing = launch(args=("--step", "--resume"), root=self.folder)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("No checkpoint", missing.stderr)
        self.assertFalse(self.slot.exists())
        commands = ("build B coil\nbuild A pin\nsluice 1\ndrill\ndrill 7\nrush\nstep 7\n"
                    "V\nrun\nreport\nsave\nquit\n")
        first = launch(commands, ("--step",), self.folder)
        self.assertEqual((first.returncode, first.stderr), (0, ""))
        self.assertRegex(first.stdout, r"Gate remaining\s+12\s+10")
        self.assertRegex(first.stdout, r"Vent after beat 7\s+1 moved\s+3 moved")
        self.assertIn("Inlet sluice sent 3 upstream", first.stdout)
        self.assertIn("Wave 1 held / clean water / +6 brass / rush +6", first.stdout)
        self.assertIn("Watch saved", first.stdout)
        saved_bytes = self.slot.read_bytes()
        second = launch("report\ngo\nrun\nquit\n", ("--resume",), self.folder)
        self.assertEqual((second.returncode, second.stderr), (0, ""))
        self.assertIn("Watch resumed. Waves held 1.", second.stdout)
        self.assertIn("Sluice moved 3", second.stdout)
        self.assertRegex(second.stdout, r"B\s+Wickcoil 1\s+front\s+\d+\s+\d+\s+2")
        self.assertIn("Waves held 2", second.stdout.splitlines()[-1])
        fresh = launch("quit\n", root=self.folder)
        self.assertIn("Waves held 0", fresh.stdout.splitlines()[-1])
        self.assertEqual(self.slot.read_bytes(), saved_bytes)
        self.assertNotIn("\x1b", first.stdout + second.stdout)
        self.slot.write_text("{", encoding="utf-8")
        broken = launch(args=("--resume",), root=self.folder)
        self.assertNotEqual(broken.returncode, 0)
        self.assertIn("Invalid or unsupported", broken.stderr)
        self.assertNotIn("Traceback", broken.stderr)
