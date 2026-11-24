import io
import json
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import unittest
from contextlib import closing, redirect_stdout
from unittest.mock import patch

import noodle
from factory import OFFLINE_LIMIT
from ledger import open_ledger
from tests.workspace import ROOT, WorkspaceCase


class CommandLineTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        self.game = self.folder / "game"
        self.game.mkdir()
        for source in ("noodle.py", "catalog.py", "factory.py", "ledger.py", "desk.py", "terminal.py"):
            shutil.copyfile(ROOT / source, self.game / source)
        self.entry = [sys.executable, "-B", str(self.game / "noodle.py")]
        self.database = self.game / "steamfold.sqlite3"
        self.process_options = dict(cwd=self.folder, text=True, encoding="utf-8",
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def run_game(self, *args, commands=""):
        return subprocess.run([*self.entry, *args], input=commands, capture_output=True,
                              timeout=10, **self.process_options)

    def snapshot(self, slot="main"):
        with closing(sqlite3.connect(self.database)) as connection:
            row = connection.execute("SELECT payload FROM factories WHERE slot = ?", (slot,)).fetchone()
        return json.loads(row[0])

    def test_pipe_plays_an_entire_first_order_and_upgrade(self):
        commands = "orders\n1\nbatch\nbatch\nbatch\ndeliver\nbuy roller\nstatus\nsave\nquit\n"
        result = self.run_game(commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ("Opening shift", "ORDER BOOK", "Booked Corner counter", "Extra batch shipped",
                         "Collected the 30-coin bonus", "Upgraded Dough roller", "Shift saved in 'main'"):
            self.assertIn(expected, result.stdout)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("works>", result.stdout)
        self.assertFalse((self.folder / "steamfold.sqlite3").exists())
        snap = self.snapshot()
        self.assertEqual((snap["deliveries"], snap["roller"], snap["active_order"]), (1, 2, None))
        self.assertGreaterEqual(snap["coins"], 90)
        again = self.run_game(commands="quit\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("Away", again.stdout)
        self.assertEqual(self.snapshot()["deliveries"], 1)

    def test_offline_receipt_reopening_and_delivery_with_real_processes(self):
        then = time.time_ns() // 1_000_000 - 2 * OFFLINE_LIMIT
        with open_ledger(self.database) as db, db.visit(then) as v:
            v.factory.book("counter")
            v.factory.steam_ms = 0
        result = self.run_game("--plain", commands="deliver\nq\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Packed 14,400 for 43,200 coins (8h cap)", result.stdout)
        self.assertIn("Order ready to deliver", result.stdout)
        self.assertIn("Collected the 30-coin bonus", result.stdout)
        snap = self.snapshot()
        self.assertEqual((snap["deliveries"], snap["steam_ms"]), (1, 90_000))
        self.assertEqual(snap["coins"], 36 + 3 * snap["shipped"] + 30)
        again = self.run_game("--plain", commands="deliver\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("Book an order first", again.stdout)
        self.assertNotIn("8h cap", again.stdout)
        self.assertLess(self.snapshot()["shipped"], 14_500)

    def test_first_shift_can_fill_two_tickets_with_the_same_noodles(self):
        commands = "o\n1\nt\n1\nb\nb\nb\nd\nr\n2\nstatus\nq\n"
        result = self.run_game("--plain", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        for term in ("RUSH BOARD", "Started Platform supper", "Rush paid +45 coins",
                     "Collected the 30-coin bonus", "RECIPE BOOK", "Cooking Scallion ribbons"):
            self.assertIn(term, result.stdout)
        snap = self.snapshot()
        self.assertEqual((snap["rush_wins"], snap["deliveries"], snap["recipe_key"]), (1, 1, "scallion"))
        self.assertGreaterEqual(snap["coins"], 165)
        again = self.run_game(commands="rushes\nquit\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("Platform supper paid +45c", again.stdout)
        self.assertEqual(self.snapshot()["rush_wins"], 1)

    def test_offline_dispatch_and_rush_receipt_survives_repeated_launches(self):
        then = time.time_ns() // 1_000_000 - 2 * OFFLINE_LIMIT
        with open_ledger(self.database) as db, db.visit(then) as v:
            f = v.factory
            f.coins, f.shipped, f.deliveries = 600, 90, 3
            f.roller = f.steamer = f.sealer = 2
            f.set_dispatch(True)
            f.book("counter")
            f.start_rush("relay")
            f.batch()
        result = self.run_game(commands="dispatch\nrushes\nquit\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        for term in ("Packed 34,560 for 69,120 coins (8h cap)", "Dispatcher sent 1,920 orders for +57,600 coins",
                     "Rush paid +120 coins", "Dispatcher on duty", "Tickets won 1"):
            self.assertIn(term, result.stdout)
        again = self.run_game(commands="status\nquit\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertNotIn("8h cap", again.stdout)
        self.assertNotIn("Rush paid +120 coins", again.stdout)
        snap = self.snapshot()
        packs = snap["shipped"] - 90
        orders, remainder = divmod(packs, 18)
        self.assertEqual((snap["filled"], snap["deliveries"], snap["rush_wins"]), (remainder, 3 + orders, 1))
        self.assertEqual(snap["coins"], 2 * packs + orders * 30 + 120)

    def test_eof_saves_and_slots_are_independent(self):
        result = self.run_game("--slot", "Study", "--plain", commands="buy roller\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Shift saved in 'study'", result.stdout)
        self.assertEqual(self.snapshot("study")["roller"], 2)
        other = self.run_game("--slot", "other")
        self.assertIn("Opening shift", other.stdout)
        self.assertEqual(self.snapshot("other")["roller"], 1)
        again = self.run_game("--slot", "STUDY")
        self.assertIn("Away", again.stdout)
        self.assertEqual(self.snapshot("study")["roller"], 2)

    def test_first_cart_from_a_fresh_slot_survives_a_real_restart(self):
        commands = ("w\n1\nb\nc\n1\nstock off\nb\nb\n"
                    "queue house\nqueue scallion\nrota start\nq\n")
        result = self.run_game("--plain", commands=commands)
        self.assertEqual(result.returncode, 0, result.stderr)
        for text in ("STOCKROOM", "Extra batch shelved 6 house packs", "LUNCH CART",
                     "Sent the cart to Foundry gate", "returns in 30s with 36 coins", "Rota started on House broth"):
            self.assertIn(text, result.stdout)
        first = self.snapshot()
        self.assertEqual((first["cart"]["key"], first["cart_runs"], first["stock"]["reserving"]), ("gate", 0, False))
        self.assertEqual(first["rota"]["slots"], ["house", "scallion"])
        self.assertIsNotNone(first["rota"]["phase_ms"])
        again = self.run_game(commands="cart\ncart gate\nquit\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("already out at Foundry gate", again.stdout)
        self.assertEqual(self.snapshot()["cart"], first["cart"])

    def test_eight_hour_rota_fills_the_cart_manifest_and_credits_one_return(self):
        then = time.time_ns() // 1_000_000 - 2 * OFFLINE_LIMIT
        with open_ledger(self.database) as db, db.visit(then) as visit:
            f = visit.factory
            f.shipped = 90
            f.set_stock(True)
            f.batch()
            f.send_cart("gate")
            f.queue_recipe("house")
            f.queue_recipe("scallion")
            f.set_rota("start")
        result = self.run_game(commands="stock\ncart steps\nrota\nq\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        for text in ("Sold 15,816 for 38,820 coins (8h cap)", "Shelved 24 packs",
                     "Cart returned from Foundry gate with 36 coins", "Sent the cart to Studio steps",
                     "returns in 90s with 114 coins", "house > scallion", "RECIPE ROTA"):
            self.assertIn(text, result.stdout)
        snap = self.snapshot()
        self.assertEqual((snap["cart_runs"], snap["cart"]["key"], snap["cart"]["bench_price"]), (1, "steps", 3))
        again = self.run_game(commands="cart\nq\n")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("returning with 114c", again.stdout)
        self.assertNotIn("Cart returned from Foundry gate", again.stdout)
        self.assertNotIn("8h cap", again.stdout)
        self.assertEqual(self.snapshot()["cart_runs"], 1)

    def test_eof_prints_a_pickup_paid_by_the_final_checkpoint(self):
        with open_ledger(self.database) as db, db.visit(0) as visit:
            visit.factory.start_rush("platform")
            visit.factory.batch()
        output = io.StringIO()
        with patch.object(noodle, "SAVE_PATH", self.database), \
             patch.object(noodle, "wall_ms", side_effect=[0, 24_000]), \
             patch.object(noodle.sys, "stdin", io.StringIO("")), redirect_stdout(output):
            self.assertEqual(noodle.main(["--plain"]), 0)
        self.assertEqual(output.getvalue().count("Rush paid +45 coins"), 1)
        self.assertEqual(self.snapshot()["rush_wins"], 1)

    def test_help_and_bad_arguments_leave_the_save_uncreated(self):
        help_result = self.run_game("--help")
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        self.assertIn("--plain", help_result.stdout)
        for args in (("--slot", "../outside"), ("--slot",), ("--bad-option",)):
            result = self.run_game(*args)
            self.assertEqual(result.returncode, 2)
            self.assertIn("usage", result.stderr)
        self.assertFalse(self.database.exists())

    def test_a_bad_command_does_not_end_the_shift(self):
        result = self.run_game("--plain", commands="nonsense\nbuy sealer\nhelp\nbatch\nquit\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ("Unknown command", "more.", "SHIFT GUIDE", "Extra batch shipped"):
            self.assertIn(expected, result.stdout)
        self.assertEqual(self.snapshot()["sealer"], 1)

    def test_damaged_ledger_produces_an_error_and_preserves_original_bytes(self):
        contents = b"This was never a SQLite database."
        self.database.write_bytes(contents)
        result = self.run_game()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Save ledger error", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(self.database.read_bytes(), contents)

    def test_acknowledged_actions_survive_an_abrupt_process_exit(self):
        seen_batch = threading.Event()
        with subprocess.Popen(self.entry, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, **self.process_options) as child:
            def read_output():
                for line in child.stdout:
                    if "Extra batch shipped" in line:
                        seen_batch.set()

            reader = threading.Thread(target=read_output, daemon=True)
            reader.start()
            try:
                child.stdin.write("order counter\nbatch\n")
                child.stdin.flush()
                self.assertTrue(seen_batch.wait(8), "Child did not finish its extra batch")
            finally:
                child.kill()
                child.wait(timeout=5)
                reader.join(timeout=5)
        saved = self.snapshot()
        self.assertEqual(saved["active_order"], "counter")
        self.assertGreaterEqual(saved["filled"], 6)
        self.assertLess(saved["steam_ms"], 90_000)
        recover = self.run_game(commands="status\nquit\n")
        self.assertEqual(recover.returncode, 0, recover.stderr)
        self.assertIn("Corner counter", recover.stdout)


if __name__ == "__main__":
    unittest.main()
