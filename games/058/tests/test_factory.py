import random
import unittest
from copy import deepcopy

from factory import (
    BATCH_TIME, CHARGE_TIME, MAX_CHARGES, MAX_LEVEL, MINUTE, OFFLINE_LIMIT, ORDERS,
    RANKS, STATIONS, Factory,
)


class ProductionTests(unittest.TestCase):
    def test_new_line_can_run_and_afford_its_first_upgrade(self):
        f = Factory(100)
        self.assertEqual((f.rate, f.price, f.coins, f.charges), (30, 3, 36, 3))
        self.assertGreaterEqual(f.coins, STATIONS[0].upgrade_cost(f.roller))
        self.assertEqual((f.shipped, f.filled, f.deliveries), (0, 0, 0))

    def test_first_pack_finishes_at_two_seconds(self):
        f = Factory(100)
        self.assertEqual(f.advance(2_099).packs, 0)
        self.assertEqual(f.progress, MINUTE - 30)
        report = f.advance(2_100)
        self.assertEqual((report.packs, report.coins), (1, 3))
        self.assertEqual((f.coins, f.shipped, f.progress), (39, 1, 0))
        self.assertEqual(f.advance(2_100).packs, 0)

    def test_one_minute_at_the_starter_rate(self):
        f = Factory(0)
        report = f.advance(MINUTE)
        self.assertEqual((report.packs, report.coins, f.coins), (30, 90, 126))

    def test_tick_size_does_not_change_the_result(self):
        rng = random.Random(73)
        for _ in range(24):
            f = Factory(1_000, steam_ms=rng.randrange(90_001), progress=rng.randrange(MINUTE))
            for station in STATIONS:
                setattr(f, station.key, rng.randint(1, MAX_LEVEL))
            f.book("counter")
            split = deepcopy(f)
            end = f.last_ms + rng.randint(10_000, OFFLINE_LIMIT)
            single = f.advance(end)
            packs = coins = 0
            while split.last_ms < end:
                report = split.advance(min(end, split.last_ms + rng.randint(1, 500_000)))
                packs += report.packs
                coins += report.coins
            self.assertEqual(split, f)
            self.assertEqual((packs, coins), (single.packs, single.coins))

    def test_long_absence_credits_eight_hours_and_consumes_the_whole_gap(self):
        f = Factory(0, roller=3, steamer=3, sealer=3, spice=3, progress=137, steam_ms=0)
        f.book("counter")
        report = f.advance(5 * OFFLINE_LIMIT)
        self.assertEqual((report.elapsed_ms, report.credited_ms), (5 * OFFLINE_LIMIT, OFFLINE_LIMIT))
        self.assertEqual((report.packs, report.coins), (43_200, 216_000))
        self.assertEqual((f.filled, f.progress, f.charges), (18, 137, MAX_CHARGES))
        self.assertEqual(f.advance(5 * OFFLINE_LIMIT).coins, 0)
        self.assertEqual(f.advance(5 * OFFLINE_LIMIT + MINUTE).packs, 90)

    def test_cap_boundary(self):
        for gap in (OFFLINE_LIMIT - 1, OFFLINE_LIMIT, OFFLINE_LIMIT + 1):
            with self.subTest(gap=gap):
                f = Factory(20)
                report = f.advance(20 + gap)
                self.assertEqual(report.credited_ms, min(gap, OFFLINE_LIMIT))
                self.assertEqual(f.last_ms, 20 + gap)

    def test_clock_rollback_preserves_timestamp_cash_work_and_steam(self):
        f = Factory(5_000, progress=300, steam_ms=777)
        original = deepcopy(f)
        for earlier in (4_999, 0, 5_000):
            self.assertEqual(f.advance(earlier).credited_ms, 0)
            self.assertEqual(f, original)
        self.assertEqual(f.advance(7_000).packs, 1)
        self.assertEqual((f.progress, f.steam_ms), (300, 2_777))


class UpgradeTests(unittest.TestCase):
    def test_constraint_moves_along_the_line(self):
        f = Factory(0, coins=1_000)
        for key, rate, coins in (("roller", 40, 970), ("steamer", 50, 928), ("sealer", 60, 874)):
            f.buy(key)
            self.assertEqual((f.rate, f.coins), (rate, coins))
        self.assertEqual(f.advance(MINUTE).packs, 60)

    def test_building_ahead_of_the_bottleneck(self):
        f = Factory(0, coins=100)
        f.buy("sealer")
        self.assertEqual((f.sealer, f.rate, f.coins), (2, 30, 46))

    def test_seasoning_changes_every_later_sale(self):
        f = Factory(0, coins=54)
        f.buy("spice")
        self.assertEqual((f.coins, f.price, f.rate), (0, 4, 30))
        report = f.advance(MINUTE)
        self.assertEqual((report.coins, report.packs), (120, 30))
        f.batch()
        self.assertEqual(f.coins, 144)

    def test_rejected_purchase_preserves_every_field(self):
        f = Factory(171, coins=29)
        original = deepcopy(f)
        self.assertIn("1 more", f.buy("roller"))
        self.assertIn("Choose", f.buy("forklift"))
        self.assertEqual(original, f)

    def test_each_station_exact_cost_growth_and_level_cap(self):
        for s in STATIONS:
            with self.subTest(s=s.key):
                f = Factory(0)
                for level in range(1, MAX_LEVEL):
                    expected = s.base_cost * sum(range(1, level + 1))
                    f.coins = expected
                    self.assertIn("Upgraded", f.buy(s.key))
                    self.assertEqual((f.coins, getattr(f, s.key)), (0, level + 1))
                f.coins = 1_000_000
                original = deepcopy(f)
                self.assertIn("maximum", f.buy(s.key))
                self.assertEqual(f, original)


class BoilerTests(unittest.TestCase):
    def test_batch_sells_now_without_advancing_the_clock(self):
        f = Factory(3_000, progress=123)
        f.batch()
        self.assertEqual((f.shipped, f.coins, f.charges), (6, 54, 2))
        self.assertEqual((f.last_ms, f.progress), (3_000, 123))

    def test_batch_uses_the_current_machines_and_price(self):
        f = Factory(0, roller=3, steamer=2, sealer=2, spice=4)
        f.batch()
        self.assertEqual((f.shipped, f.coins), (70 * BATCH_TIME // MINUTE, 36 + 14 * 6))

    def test_empty_boiler_recovers_at_the_exact_boundary(self):
        f = Factory(0)
        for _ in range(MAX_CHARGES):
            f.batch()
        empty = deepcopy(f)
        self.assertIn("30s", f.batch())
        self.assertEqual(f, empty)
        f.advance(CHARGE_TIME - 1)
        self.assertEqual((f.charges, f.next_charge_seconds), (0, 1))
        self.assertIn("1s", f.batch())
        f.advance(CHARGE_TIME)
        self.assertEqual((f.charges, f.next_charge_seconds), (1, 30))
        f.batch()
        self.assertEqual((f.charges, f.steam_ms), (0, 0))

    def test_spending_preserves_part_of_the_next_charge(self):
        f = Factory(0, steam_ms=CHARGE_TIME + 1_250)
        f.batch()
        self.assertEqual((f.steam_ms, f.next_charge_seconds), (1_250, 29))
        f.advance(CHARGE_TIME - 1_250)
        self.assertEqual(f.charges, 1)

    def test_full_boiler_stops_banking_steam(self):
        f = Factory(0, steam_ms=0)
        f.advance(20 * CHARGE_TIME)
        self.assertEqual((f.steam_ms, f.next_charge_seconds), (MAX_CHARGES * CHARGE_TIME, 0))
        f.batch()
        self.assertEqual((f.charges, f.next_charge_seconds), (2, 30))


class OrderTests(unittest.TestCase):
    def test_orders_unlock_on_the_exact_shipment(self):
        for order in ORDERS[1:]:
            with self.subTest(order=order.key):
                f = Factory(0, shipped=order.unlock - 1)
                self.assertIn("opens at", f.book(order.key))
                self.assertIsNone(f.order)
                f.advance(2_000)
                self.assertIn("Booked", f.book(order.key))
                self.assertEqual(f.filled, 0)

    def test_old_sales_do_not_fill_a_new_order(self):
        f = Factory(0)
        f.advance(10 * MINUTE)
        f.book("counter")
        self.assertEqual((f.shipped, f.filled), (300, 0))
        self.assertIn("18 more", f.deliver())

    def test_regular_and_extra_batches_fill_the_same_order(self):
        f = Factory(0)
        f.book("counter")
        f.advance(20_000)
        f.batch()
        self.assertEqual((f.filled, f.shipped), (16, 16))
        self.assertIn("2 more", f.deliver())
        f.advance(MINUTE)
        self.assertEqual((f.filled, f.shipped), (18, 36))
        sales = f.coins
        f.deliver()
        self.assertEqual((f.coins, f.deliveries, f.order, f.filled), (sales + 30, 1, None, 0))
        f.deliver()
        self.assertEqual((f.coins, f.deliveries), (sales + 30, 1))
        f.book("counter")
        self.assertEqual((f.active_order, f.filled), ("counter", 0))

    def test_active_and_ready_orders_cannot_be_overwritten(self):
        f = Factory(0, shipped=450)
        f.book("canteen")
        for filled in (0, 71, 72):
            f.filled = filled
            original = deepcopy(f)
            for key in ("canteen", "counter", "freight"):
                self.assertIn("on the books", f.book(key))
                self.assertEqual(f, original)

    def test_invalid_and_missing_order(self):
        f = Factory(0)
        self.assertIn("Choose", f.book("mystery"))
        self.assertIn("Book an order", f.deliver())
        self.assertEqual(f, Factory(0))

    def test_all_ranks_and_continued_production_after_the_charter(self):
        f = Factory(0)
        for index, (threshold, _) in enumerate(RANKS):
            if threshold:
                f.advance((threshold - 1) * 2_000)
                self.assertEqual(f.rank_index, index - 1)
            f.advance(threshold * 2_000)
            self.assertEqual(f.rank_index, index)
        f.advance(f.last_ms + MINUTE)
        self.assertEqual((f.shipped, f.rank_index), (5_030, len(RANKS) - 1))


if __name__ == "__main__":
    unittest.main()
