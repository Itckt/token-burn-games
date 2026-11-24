import random
import unittest
from copy import deepcopy

from catalog import MINUTE, OFFLINE_LIMIT
from factory import Factory


class StockroomTests(unittest.TestCase):
    def test_first_seals_fill_the_bin_and_only_overflow_earns_cash(self):
        f = Factory(0)
        f.book("counter")
        f.set_stock(True)
        full = f.advance(24_000)
        self.assertEqual((full.stored, full.packs, full.coins), (12, 0, 0))
        self.assertEqual((f.stock.bins["house"], f.shipped, f.filled, f.coins), (12, 0, 0, 36))
        self.assertEqual(f.advance(25_999).packs, 0)
        sale = f.advance(26_000)
        self.assertEqual((sale.stored, sale.packs, sale.coins, f.filled), (0, 1, 3, 1))
        self.assertEqual(f.shipped + sum(f.stock.bins.values()), 13)

    def test_one_batch_splits_across_the_last_two_spaces_and_both_order_books(self):
        f = Factory(0)
        f.set_stock(True)
        f.advance(20_000)
        f.book("counter")
        f.start_rush("platform")
        note = f.batch()
        self.assertIn("shipped 4 packs for 12 coins", note)
        self.assertIn("Shelved 2 packs", note)
        self.assertEqual((f.filled, f.ticket.filled, f.stock.bins["house"], f.charges), (4, 4, 12, 2))
        # Selling the ten older seals and two new ones cannot fill either ticket a second time.
        f.sell_stock("house")
        self.assertEqual((f.shipped, f.filled, f.ticket.filled, f.coins), (16, 4, 4, 84))

    def test_overflow_after_the_rush_deadline_is_ineligible_even_in_one_large_tick(self):
        f = Factory(0)
        f.start_rush("platform")
        f.set_stock(True)
        report = f.advance(MINUTE)
        self.assertTrue(report.rush_expired)
        self.assertEqual((report.stored, report.packs, f.ticket.filled, f.rush_wins), (12, 18, 0, 0))

    def test_selling_uses_the_bins_recipe_and_the_current_bench_price(self):
        f = Factory(0, coins=54, shipped=90)
        f.set_stock(True)
        f.select_recipe("scallion")
        f.batch()
        f.select_recipe("sesame")
        f.batch()
        f.set_stock(False)
        f.buy("spice")
        self.assertEqual(f.stock.bins, {"house": 0, "scallion": 7, "sesame": 5})
        self.assertIn("21 coins", f.sell_stock("scallion"))
        self.assertEqual((f.recipe_key, f.shipped, f.coins, f.stock.bins["sesame"]), ("sesame", 97, 21, 5))
        before = deepcopy(f)
        self.assertIn("empty", f.sell_stock("scallion"))
        self.assertIn("Choose", f.sell_stock("no-such-bin"))
        self.assertEqual(f, before)
        self.assertIn("30 coins", f.sell_stock("sesame"))

    def test_expansion_charges_exactly_once_per_tier_and_keeps_stock(self):
        f = Factory(0, coins=179)
        f.set_stock(True)
        f.batch()
        before = deepcopy(f)
        self.assertIn("1 more", f.expand_stock())
        self.assertEqual(f, before)
        for fee, capacity in ((180, 24), (600, 48)):
            f.coins = fee
            f.expand_stock()
            self.assertEqual((f.coins, f.stock.capacity, f.stock.bins["house"]), (0, capacity, 6))
        f.coins = 1_000
        before = deepcopy(f)
        self.assertIn("maximum", f.expand_stock())
        self.assertEqual(f, before)


class CartTests(unittest.TestCase):
    def test_missing_even_one_pack_leaves_the_whole_manifest_at_the_bay(self):
        f = Factory(0, shipped=90)
        f.stock.bins.update(house=6, scallion=11)
        before = deepcopy(f)
        self.assertIn("1 scallion more", f.send_cart("steps"))
        self.assertIn("Choose", f.send_cart("lake"))
        self.assertEqual(f, before)

    def test_cart_locks_price_and_pays_at_return_down_to_the_millisecond(self):
        f = Factory(500, shipped=90, coins=54)
        f.stock.bins.update(house=12, scallion=12)
        f.book("counter")
        f.start_rush("platform")
        self.assertIn("114 coins", f.send_cart("steps"))
        self.assertEqual((f.stock.bins, f.shipped, f.coins, f.filled, f.ticket.filled),
                         ({"house": 6, "scallion": 0, "sesame": 0}, 108, 54, 0, 0))
        before = deepcopy(f)
        self.assertIn("already out", f.send_cart("gate"))
        self.assertEqual(f, before)
        f.buy("spice")
        self.assertIsNone(f.advance(90_499).returned_cart)
        till = f.coins
        returned = f.advance(90_500)
        self.assertEqual((returned.returned_cart.payout, returned.coins, f.coins), (114, 4, till + 118))
        self.assertEqual((f.cart_runs, f.cart), (1, None))
        for earlier in (200, 90_500):
            self.assertIsNone(f.advance(earlier).returned_cart)
            self.assertEqual(f.coins, till + 118)
        self.assertIn("42 coins", f.send_cart("gate"))

    def test_quay_requires_a_larger_bin_and_uses_all_three_recipes(self):
        f = Factory(0, shipped=90, coins=180)
        f.set_stock(True)
        f.expand_stock()
        for key in ("house", "scallion", "sesame"):
            f.select_recipe(key)
            f.advance(f.last_ms + MINUTE)
        self.assertEqual(list(f.stock.bins.values()), [24, 24, 24])
        self.assertIn("432 coins", f.send_cart("quay"))
        self.assertEqual(f.stock.bins, {"house": 12, "scallion": 6, "sesame": 0})
        report = f.advance(f.last_ms + 2 * OFFLINE_LIMIT)
        self.assertEqual((f.cart_runs, report.returned_cart.payout, report.stored), (1, 432, 24))


class RotaTests(unittest.TestCase):
    def test_slots_check_unlocks_distinct_recipes_and_capacity(self):
        f = Factory(0, shipped=17)
        before = deepcopy(f)
        self.assertIn("18 lifetime", f.queue_recipe("scallion"))
        self.assertIn("Choose", f.queue_recipe("missing"))
        self.assertIn("two different", f.set_rota("start"))
        self.assertEqual(f, before)
        f.advance(2_000)
        f.queue_recipe("house")
        f.queue_recipe("house")
        self.assertIn("two different", f.set_rota("start"))
        f.queue_recipe("scallion")
        before = deepcopy(f)
        self.assertIn("full", f.queue_recipe("house"))
        self.assertEqual(f, before)
        f.set_rota("start")
        result = f.advance(f.last_ms + 3 * MINUTE)
        self.assertEqual((result.packs, result.coins, f.rota.phase_ms, f.recipe_key), (96, 252, 0, "house"))

    def test_last_seal_uses_the_old_recipe_and_an_instant_batch_uses_the_new_one(self):
        f = Factory(0, shipped=90)
        f.queue_recipe("house")
        f.queue_recipe("scallion")
        f.set_rota("start")
        f.advance(MINUTE - 1)
        self.assertEqual((f.recipe_key, f.progress, f.rota.remaining_ms), ("house", 59_970, 1))
        self.assertIn("6 packs for 18 coins", f.batch())
        self.assertEqual(f.rota.remaining_ms, 1)
        boundary = f.advance(MINUTE)
        self.assertEqual((boundary.packs, boundary.coins, f.recipe_key, f.progress), (1, 3, "scallion", 0))
        self.assertIn("7 packs for 14 coins", f.batch())
        self.assertEqual((f.progress, f.rota.remaining_ms, f.last_ms), (12_000, MINUTE, MINUTE))
        report = f.advance(2 * MINUTE)
        self.assertEqual((report.packs, report.coins, f.progress, f.recipe_key), (36, 72, 12_000, "house"))

    def test_changeover_rush_deadline_and_cart_return_can_share_one_millisecond(self):
        f = Factory(0, shipped=90, roller=3, steamer=3, sealer=3)
        f.stock.bins.update(house=6, scallion=12)
        f.send_cart("steps")
        f.advance(30_000)
        f.start_rush("tasting")
        f.queue_recipe("sesame")
        f.queue_recipe("house")
        f.set_rota("start")
        f.advance(89_999)
        self.assertEqual((f.ticket.filled, f.rota.remaining_ms, f.cart_runs), (71, 1, 0))
        before = f.coins
        final = f.advance(90_000)
        self.assertEqual((final.coins, final.bonuses.rush_coins, final.returned_cart.payout), (5, 240, 114))
        self.assertEqual((f.coins - before, f.recipe_key, f.cart_runs, f.rush_wins), (359, "house", 1, 1))
        self.assertEqual(f.advance(90_000).notices(), "")

    def test_only_a_successful_manual_change_overrides_the_rota(self):
        f = Factory(0, shipped=18, progress=57)
        f.queue_recipe("house")
        f.queue_recipe("scallion")
        f.set_rota("start")
        f.advance(21_000)
        before = deepcopy(f)
        self.assertIn("already", f.set_rota("start"))
        self.assertIn("Stop the rota", f.queue_recipe("house"))
        self.assertIn("opens at 90", f.select_recipe("sesame"))
        self.assertIn("opens at 90", f.start_rush("tasting"))
        self.assertEqual(f, before)
        self.assertIn("Rota stopped", f.start_rush("relay"))
        self.assertEqual((f.recipe_key, f.rota.slots, f.rota.phase_ms, f.progress),
                         ("scallion", ["house", "scallion"], None, before.progress))
        f.set_rota("start")
        before = deepcopy(f)
        self.assertIn("already on the clock", f.start_rush("platform"))
        self.assertEqual(f, before)
        self.assertIn("Rota stopped", f.select_recipe("scallion"))
        self.assertEqual((f.rota.slots, f.recipe_key), (["house", "scallion"], "scallion"))

    def test_stop_restart_and_clear_preserve_current_work(self):
        f = Factory(0, shipped=90)
        f.queue_recipe("sesame")
        f.queue_recipe("house")
        f.set_rota("start")
        f.advance(MINUTE + 125)
        f.set_rota("stop")
        self.assertEqual((f.recipe_key, f.rota.running, f.progress), ("house", False, 3_750))
        self.assertEqual((f.rota.current, f.rota.remaining_ms), (None, 0))
        f.advance(f.last_ms + MINUTE)
        f.set_rota("start")
        self.assertEqual((f.recipe_key, f.rota.phase_ms, f.progress), ("sesame", 0, 3_750))
        f.set_rota("clear")
        self.assertEqual((f.recipe_key, f.rota.slots, f.rota.running, f.progress), ("sesame", [], False, 3_750))

    def test_offline_cap_freezes_the_rota_for_the_uncredited_time(self):
        f = Factory(0, shipped=90, progress=321)
        f.queue_recipe("house")
        f.queue_recipe("scallion")
        f.set_rota("start")
        f.set_stock(True)
        f.advance(5_678)
        exact = deepcopy(f)
        expected = exact.advance(exact.last_ms + OFFLINE_LIMIT)
        late = f.advance(f.last_ms + OFFLINE_LIMIT + 30_001)
        self.assertEqual((late.packs, late.coins, late.stored), (expected.packs, expected.coins, expected.stored))
        self.assertEqual((f.progress, f.rota.phase_ms, f.stock.bins), (exact.progress, 5_678, exact.stock.bins))
        before = deepcopy(f)
        self.assertEqual(f.advance(f.last_ms - MINUTE).notices(), "")
        self.assertEqual(f, before)

    def test_stepped_rotations_match_one_settlement_for_sales_stock_and_every_payout(self):
        rng = random.Random(379)
        for level in (1, 3, 10):
            with self.subTest(level=level):
                f = Factory(700, shipped=450, coins=600, deliveries=3, progress=17_891,
                            roller=level, steamer=level, sealer=level)
                f.set_dispatch(True)
                f.book("counter")
                f.set_stock(True)
                f.batch()
                f.send_cart("gate")
                f.start_rush("platform")
                for recipe in ("house", "sesame", "scallion"):
                    f.queue_recipe(recipe)
                f.set_rota("start")
                split = deepcopy(f)
                end = f.last_ms + 11 * MINUTE + 1_555
                whole = f.advance(end)
                reports = []
                while split.last_ms < end:
                    reports.append(split.advance(min(end, split.last_ms + rng.randint(1, 17_250))))
                self.assertEqual(split, f)
                for field in ("packs", "coins", "stored", "rush_expired"):
                    self.assertEqual(sum(getattr(r, field) for r in reports), getattr(whole, field))
                for field in ("orders", "dispatch_coins", "rush_coins"):
                    self.assertEqual(sum(getattr(r.bonuses, field) for r in reports), getattr(whole.bonuses, field))
                self.assertEqual([r.returned_cart for r in reports if r.returned_cart], [whole.returned_cart])
