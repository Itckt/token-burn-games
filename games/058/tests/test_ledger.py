import json
import sqlite3
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import asdict

from factory import CHARGE_TIME, MINUTE, OFFLINE_LIMIT, Factory
from ledger import SAVE_VERSION, SaveError, open_ledger, slot_name
from tests.workspace import WorkspaceCase


class LedgerTests(WorkspaceCase):
    def setUp(self):
        super().setUp()
        self.path = self.folder / "ledger.sqlite3"

    def simultaneous_visits(self, stamp, action):
        gate = threading.Barrier(2, timeout=5)

        def run():
            with open_ledger(self.path) as db:
                gate.wait()
                with db.visit(stamp) as visit:
                    return action(visit)

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run) for _ in range(2)]
            return [future.result(timeout=7) for future in futures]

    def test_reopen_preserves_an_entire_working_factory(self):
        with open_ledger(self.path) as db:
            with db.visit(100) as v:
                self.assertTrue(v.fresh)
                v.factory.book("counter")
                v.factory.batch()
                v.factory.buy("roller")
            with db.visit(3_147) as v:
                saved = deepcopy(v.factory)
        with open_ledger(self.path) as reopened, reopened.visit(3_147) as v:
            self.assertFalse(v.fresh)
            self.assertEqual(v.factory, saved)
            self.assertNotEqual(v.factory.progress, 0)
            self.assertEqual(v.factory.steam_ms, 2 * CHARGE_TIME + 3_047)
            self.assertEqual(v.factory.filled, 8)

    def test_production_settles_at_the_old_rate_before_an_upgrade(self):
        with open_ledger(self.path) as db:
            with db.visit(0):
                pass
            with db.visit(1_000) as v:
                v.factory.buy("roller")
            with db.visit(1_750) as v:
                self.assertEqual((v.factory.shipped, v.factory.progress), (1, 0))
            with db.visit(61_750) as v:
                self.assertEqual((v.earnings.packs, v.factory.coins), (40, 129))

    def test_sale_price_and_order_start_only_apply_after_the_visit(self):
        with open_ledger(self.path) as db:
            with db.visit(0):
                pass
            with db.visit(MINUTE) as v:
                self.assertEqual(v.factory.coins, 126)
                v.factory.buy("spice")
                v.factory.book("counter")
            with db.visit(2 * MINUTE) as v:
                self.assertEqual((v.factory.coins, v.factory.filled), (192, 18))
                v.factory.deliver()
        with open_ledger(self.path) as db, db.visit(2 * MINUTE) as v:
            self.assertEqual((v.factory.coins, v.factory.deliveries), (222, 1))
            self.assertIsNone(v.factory.order)

    def test_long_offline_return_is_committed_exactly_once(self):
        with open_ledger(self.path) as db, db.visit(1_000):
            pass
        later = 1_000 + 3 * OFFLINE_LIMIT
        with open_ledger(self.path) as db, db.visit(later) as v:
            self.assertEqual((v.earnings.packs, v.earnings.coins), (14_400, 43_200))
            self.assertEqual(v.factory.last_ms, later)
        for stamp in (later - MINUTE, later):
            with open_ledger(self.path) as db, db.visit(stamp) as v:
                self.assertEqual(v.earnings.coins, 0)
                self.assertEqual((v.factory.coins, v.factory.last_ms), (43_236, later))

    def test_slot_names_are_case_insensitive_and_factories_are_independent(self):
        with open_ledger(self.path, "Night-Shift_2") as db, db.visit(0) as v:
            v.factory.buy("roller")
        with open_ledger(self.path, "MAIN") as db, db.visit(MINUTE) as v:
            self.assertEqual(v.factory, Factory(MINUTE))
            self.assertTrue(v.fresh)
        with open_ledger(self.path, "night-shift_2") as db, db.visit(MINUTE) as v:
            self.assertEqual((v.factory.shipped, v.factory.coins), (40, 126))

    def test_invalid_slot_is_rejected_before_creating_a_file(self):
        for name in ("", "-shift", "../a", "a/b", "a b", "a" * 25, "Ａ", "slot\n"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                with open_ledger(self.path, name):
                    self.fail("opened a ledger")
        self.assertFalse(self.path.exists())
        self.assertEqual(slot_name("A" * 24), "a" * 24)

    def test_interrupted_action_rolls_back_clock_purchase_and_steam_together(self):
        with open_ledger(self.path) as db:
            with db.visit(0):
                pass
            with self.assertRaises(KeyboardInterrupt):
                with db.visit(MINUTE) as v:
                    v.factory.buy("roller")
                    v.factory.batch()
                    raise KeyboardInterrupt
            with db.visit(MINUTE) as v:
                self.assertEqual(v.earnings.packs, 30)
                self.assertEqual((v.factory.coins, v.factory.roller, v.factory.charges), (126, 1, 3))

    def test_failed_commit_leaves_the_previous_factory_playable(self):
        with open_ledger(self.path) as db:
            with db.visit(0):
                pass
            db.connection.execute("CREATE TRIGGER interrupted BEFORE INSERT ON factories "
                                  "BEGIN SELECT RAISE(ABORT, 'interrupted write'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                with db.visit(MINUTE) as v:
                    v.factory.batch()
            db.connection.execute("DROP TRIGGER interrupted")
            with db.visit(MINUTE) as v:
                self.assertEqual((v.factory.coins, v.factory.charges, v.earnings.coins), (126, 3, 90))

    def test_invalid_snapshot_is_reported_and_left_intact(self):
        original = asdict(Factory(0))
        invalid = [dict(original, **change) for change in (
            {"roller": 0}, {"sealer": 11}, {"spice": True}, {"coins": -1}, {"last_ms": 1.5},
            {"progress": MINUTE}, {"steam_ms": 90_001}, {"active_order": "missing"},
            {"active_order": []}, {"active_order": "canteen"}, {"filled": 1},
            {"active_order": "counter", "shipped": 20, "filled": 19},
            {"active_order": "counter", "shipped": 0, "filled": 1}, {"unexpected": 1},
        )]
        del original["steamer"]
        payloads = [json.dumps(value) for value in [*invalid, original, [], None]]
        with open_ledger(self.path) as db:
            for payload in [*payloads, "{bad"]:
                with self.subTest(payload=payload):
                    db.connection.execute("INSERT OR REPLACE INTO factories VALUES ('main', ?, ?)",
                                          (SAVE_VERSION, payload))
                    with self.assertRaises(SaveError):
                        with db.visit(MINUTE):
                            self.fail("accepted damaged factory")
                    stored = db.connection.execute("SELECT payload FROM factories").fetchone()[0]
                    self.assertEqual(stored, payload)

    def test_unknown_save_version_is_preserved(self):
        with open_ledger(self.path) as db:
            db.connection.execute("INSERT INTO factories VALUES ('main', 99, 'future-data')")
            with self.assertRaisesRegex(SaveError, "version 99"):
                with db.visit(5):
                    self.fail("opened a future save")
            row = db.connection.execute("SELECT version, payload FROM factories").fetchone()
            self.assertEqual(row, (99, "future-data"))

    def test_two_tills_cannot_collect_the_same_order(self):
        with open_ledger(self.path) as db, db.visit(0) as v:
            v.factory.book("counter")
        messages = self.simultaneous_visits(MINUTE, lambda v: v.factory.deliver())
        self.assertEqual(sum("Collected" in msg for msg in messages), 1)
        with open_ledger(self.path) as db, db.visit(MINUTE) as v:
            self.assertEqual((v.factory.coins, v.factory.deliveries, v.factory.shipped), (156, 1, 30))

    def test_two_open_connections_buy_against_the_latest_balance(self):
        with open_ledger(self.path) as desk_a, open_ledger(self.path) as desk_b:
            with desk_a.visit(0):
                pass
            with desk_b.visit(0) as v:
                v.factory.buy("roller")
            with desk_a.visit(0) as v:
                self.assertIn("84 more", v.factory.buy("roller"))
                self.assertEqual((v.factory.coins, v.factory.roller), (6, 2))

    def test_version_one_migrates_in_the_same_transaction_as_offline_pay(self):
        old = {"last_ms": 4_200, "coins": 713, "shipped": 99, "progress": 15_000,
               "steam_ms": 35_001, "roller": 3, "steamer": 2, "sealer": 1, "spice": 2,
               "active_order": "canteen", "filled": 5, "deliveries": 1}
        payload = json.dumps(old)
        with open_ledger(self.path) as db:
            db.connection.execute("INSERT INTO factories VALUES ('main', 1, ?)", (payload,))
            later = old["last_ms"] + MINUTE
            with self.assertRaises(KeyboardInterrupt):
                with db.visit(later) as v:
                    v.factory.select_recipe("sesame")
                    raise KeyboardInterrupt
            self.assertEqual(db.connection.execute("SELECT version, payload FROM factories").fetchone(),
                             (1, payload))
            with db.visit(later) as v:
                expected = Factory(**old)
                expected.advance(later)
                self.assertEqual(v.factory, expected)
                self.assertEqual((v.earnings.coins, v.factory.filled, v.factory.progress), (200, 55, 15_000))
                self.assertFalse(v.fresh)
            self.assertEqual(db.connection.execute("SELECT version FROM factories").fetchone(), (SAVE_VERSION,))
        with open_ledger(self.path) as db, db.visit(later) as v:
            self.assertEqual((v.earnings.packs, v.factory.coins, v.factory.recipe_key), (0, 913, "house"))

    def test_invalid_v1_and_round_two_fields_are_preserved(self):
        base = asdict(Factory(0))
        slip = {"key": "platform", "deadline_ms": 24_000, "filled": 0}
        changes = (
            {"recipe_key": "missing"}, {"recipe_key": []}, {"recipe_key": "sesame"},
            {"dispatch_mode": "yes"}, {"dispatch_mode": "running"}, {"dispatch_mode": "paused"},
            {"dispatch_mode": "running", "deliveries": 3, "active_order": "counter",
             "shipped": 18, "filled": 18},
            {"rush_wins": True}, {"rush_wins": 1}, {"ticket": []}, {"ticket": {}},
            {"ticket": dict(slip, key="unknown")}, {"ticket": dict(slip, filled=True)},
            {"ticket": dict(slip, deadline_ms=23_999)}, {"ticket": dict(slip, deadline_ms=24_001)},
            {"ticket": dict(slip, filled=1)}, {"ticket": dict(slip, filled=19), "shipped": 90},
            {"ticket": dict(slip, filled=18), "shipped": 18, "rush_wins": 0},
            {"ticket": dict(slip, key="relay", deadline_ms=45_000)},
        )
        invalid = [(1, json.dumps(base)), (1, "{}"), (SAVE_VERSION, "[" * 2_000 + "]" * 2_000)]
        v2 = {key: value for key, value in base.items() if key not in {"stock", "cart", "cart_runs", "rota"}}
        invalid.extend((2, json.dumps(v2 | change)) for change in changes)
        invalid.extend((SAVE_VERSION, json.dumps(base | change)) for change in changes)
        with open_ledger(self.path) as db:
            for version, payload in invalid:
                with self.subTest(version=version, payload=payload[:200]):
                    db.connection.execute("INSERT OR REPLACE INTO factories VALUES ('main', ?, ?)",
                                          (version, payload))
                    with self.assertRaises(SaveError):
                        db.checkpoint(MINUTE)
                    self.assertEqual(db.connection.execute("SELECT version, payload FROM factories").fetchone(),
                                     (version, payload))

    def test_live_ticket_recipe_and_fraction_restore_on_clock_rollback(self):
        with open_ledger(self.path) as db, db.visit(10_000) as v:
            f = v.factory
            f.shipped = 90
            f.start_rush("relay")
            f.batch()
            saved = deepcopy(f)
        with open_ledger(self.path) as db, db.visit(2_000) as v:
            self.assertEqual(v.factory, saved)
            self.assertEqual(v.earnings.notices(), "")
            self.assertEqual((v.factory.ticket.filled, v.factory.progress), (7, 12_000))
            v.factory.select_recipe("sesame")
        with open_ledger(self.path) as db, db.visit(55_000) as v:
            self.assertEqual((v.factory.recipe_key, v.factory.ticket.filled), ("sesame", 7))
            self.assertTrue(v.earnings.rush_expired)
        with open_ledger(self.path, "other") as db, db.visit(55_000) as v:
            self.assertEqual(v.factory, Factory(55_000))

    def test_two_tills_finish_one_rush_and_hire_one_dispatcher(self):
        with open_ledger(self.path) as db, db.visit(0) as v:
            f = v.factory
            f.coins, f.deliveries = 600, 3
            f.book("counter")
            f.start_rush("platform")
            f.batch()

        def hire(visit):
            return visit.earnings.bonuses.rush_coins, visit.factory.set_dispatch(True)

        results = self.simultaneous_visits(24_000, hire)
        self.assertEqual(sum(bonus for bonus, _ in results), 45)
        self.assertEqual(sum("Hired" in note for _, note in results), 1)
        with open_ledger(self.path) as db, db.visit(24_000) as v:
            f = v.factory
            self.assertEqual((f.coins, f.rush_wins, f.deliveries, f.filled), (129, 1, 4, 0))
            self.assertEqual((f.dispatch_mode, f.ticket.status(f.last_ms)), ("running", "paid"))

    def test_round_two_slot_migrates_with_its_live_ticket_and_dispatcher(self):
        old = {"last_ms": 10_000, "coins": 713, "shipped": 150, "progress": 15_000,
               "steam_ms": 35_001, "roller": 2, "steamer": 1, "sealer": 1, "spice": 1,
               "active_order": "counter", "filled": 12, "deliveries": 7, "recipe_key": "scallion",
               "ticket": {"key": "relay", "deadline_ms": 54_000, "filled": 13},
               "rush_wins": 2, "dispatch_mode": "running"}
        payload = json.dumps(old)
        with open_ledger(self.path) as db:
            db.connection.execute("INSERT INTO factories VALUES ('main', 2, ?)", (payload,))
            with self.assertRaises(KeyboardInterrupt), db.visit(55_000) as visit:
                visit.factory.set_stock(True)
                raise KeyboardInterrupt
            self.assertEqual(db.connection.execute("SELECT version, payload FROM factories").fetchone(), (2, payload))
            visit = db.checkpoint(55_000)
            f = visit.factory
            self.assertEqual((f.recipe_key, f.coins, f.shipped, f.progress), ("scallion", 965, 186, 15_000))
            self.assertEqual((f.dispatch_mode, f.deliveries, f.filled, f.rush_wins), ("running", 9, 12, 3))
            self.assertEqual((visit.earnings.bonuses.rush_coins, visit.earnings.bonuses.dispatch_coins), (120, 60))
            self.assertEqual((f.stock.reserving, sum(f.stock.bins.values()), f.rota.slots, f.cart_runs, f.cart),
                             (False, 0, [], 0, None))
            self.assertEqual(db.connection.execute("SELECT version FROM factories").fetchone(), (SAVE_VERSION,))
        with open_ledger(self.path) as db:
            self.assertEqual(db.checkpoint(55_000).factory, f)

    def test_round_three_restore_preserves_the_partial_rota_bins_and_loaded_cart(self):
        with open_ledger(self.path) as db, db.visit(1_234) as visit:
            f = visit.factory
            f.shipped, f.coins = 90, 180
            f.expand_stock()
            f.set_stock(True)
            f.batch()
            f.send_cart("gate")
            f.queue_recipe("scallion")
            f.queue_recipe("sesame")
            f.set_rota("start")
        with open_ledger(self.path) as db:
            saved = db.checkpoint(19_999).factory
            self.assertEqual((saved.stock.tier, saved.stock.bins["scallion"], saved.rota.phase_ms), (2, 11, 18_765))
            self.assertGreater(saved.progress, 0)
        with open_ledger(self.path) as db:
            rolled_back = db.checkpoint(99)
            self.assertEqual(rolled_back.factory, saved)
            self.assertEqual(rolled_back.earnings.notices(), "")
            with self.assertRaises(KeyboardInterrupt), db.visit(31_234) as visit:
                self.assertEqual(visit.earnings.returned_cart.payout, 36)
                visit.factory.sell_stock("scallion")
                visit.factory.set_rota("clear")
                raise KeyboardInterrupt
            self.assertEqual(db.checkpoint(19_999).factory, saved)
            returned = db.checkpoint(31_234)
            self.assertEqual((returned.earnings.returned_cart.payout, returned.factory.cart_runs), (36, 1))
            self.assertEqual(returned.factory.rota.phase_ms, 30_000)
        with open_ledger(self.path, "other") as db:
            self.assertEqual(db.checkpoint(31_234).factory, Factory(31_234))

    def test_two_tills_share_one_cart_and_can_only_empty_a_bin_once(self):
        with open_ledger(self.path) as db, db.visit(0) as visit:
            f = visit.factory
            f.set_stock(True)
            f.batch()
            f.batch()
        messages = self.simultaneous_visits(0, lambda v: v.factory.send_cart("gate"))
        self.assertEqual(sum("Sent the cart" in message for message in messages), 1)

        def sell_on_return(visit):
            return visit.earnings.returned_cart is not None, visit.factory.sell_stock("house")

        results = self.simultaneous_visits(30_000, sell_on_return)
        self.assertEqual(sum(returned for returned, _ in results), 1)
        self.assertEqual(sum("Sold 12" in note for _, note in results), 1)
        with open_ledger(self.path) as db:
            f = db.checkpoint(30_000).factory
            # 6 packed for the cart, 9 overflow sales, 12 sold from the bin.
            self.assertEqual((f.shipped, f.coins, f.cart_runs, f.stock.bins["house"]), (27, 135, 1, 0))

    def test_invalid_round_three_snapshots_leave_the_original_payload_intact(self):
        base = asdict(Factory(500, shipped=90))
        stock = base["stock"]
        bins = stock["bins"]
        trip = {"key": "gate", "due_ms": 30_500, "bench_price": 3}
        running = {"slots": ["house", "scallion"], "phase_ms": 0}
        changes = [
            {"stock": None}, {"stock": {"tier": 1}}, {"stock": stock | {"reserving": 1}},
            {"stock": stock | {"tier": True}}, {"stock": stock | {"tier": 4}},
            {"stock": stock | {"bins": []}}, {"stock": stock | {"bins": {"house": 3}}},
            {"stock": stock | {"bins": bins | {"house": 13}}}, {"stock": stock | {"bins": bins | {"house": False}}},
            {"shipped": 89, "stock": stock | {"bins": bins | {"sesame": 1}}},
            {"cart_runs": -1}, {"cart": []}, {"cart": trip | {"key": "far"}},
            {"cart": trip | {"bench_price": 4}}, {"cart": trip | {"bench_price": True}},
            {"cart": trip | {"due_ms": 30_501}}, {"cart": trip | {"due_ms": 500}},
            {"cart": trip, "shipped": 5}, {"cart": trip | {"key": "quay", "due_ms": 180_500}, "shipped": 200},
            {"rota": []}, {"rota": running | {"slots": {}}}, {"rota": running | {"slots": ["house"] * 4}},
            {"rota": running | {"slots": ["house", "house"]}}, {"rota": running | {"phase_ms": -1}},
            {"rota": running | {"phase_ms": True}}, {"rota": running | {"phase_ms": 2 * MINUTE}},
            {"rota": running | {"phase_ms": MINUTE}}, {"rota": running, "shipped": 17},
            {"rota": running | {"slots": ["house", "missing"], "phase_ms": None}},
        ]
        payloads = [json.dumps(base | change) for change in changes]
        # Duplicate keys would silently discard the first recorded balance or bin count.
        valid = json.dumps(base)
        payloads += [valid.replace('"coins": 36', '"coins": 0, "coins": 36'),
                     valid.replace('"house": 0', '"house": 12, "house": 0')]
        with open_ledger(self.path) as db:
            for payload in payloads:
                with self.subTest(payload=payload):
                    db.connection.execute("INSERT OR REPLACE INTO factories VALUES ('main', ?, ?)",
                                          (SAVE_VERSION, payload))
                    with self.assertRaises(SaveError):
                        db.checkpoint(MINUTE)
                    row = db.connection.execute("SELECT version, payload FROM factories").fetchone()
                    self.assertEqual(row, (SAVE_VERSION, payload))


if __name__ == "__main__":
    unittest.main()
