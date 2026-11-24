import random
import unittest
from copy import deepcopy

from factory import (
    DISPATCH_COST, DISPATCH_UNLOCK, MINUTE, OFFLINE_LIMIT, RECIPES, RUSHES, Factory,
)


class RecipeTests(unittest.TestCase):
    def test_unlocks_on_the_exact_shipment_and_bad_choices_cost_nothing(self):
        for recipe in RECIPES[1:]:
            with self.subTest(recipe=recipe.key):
                f = Factory(0, shipped=recipe.unlock - 1)
                before = deepcopy(f)
                self.assertIn("opens at", f.select_recipe(recipe.key))
                self.assertIn("Choose", f.select_recipe("pepper"))
                self.assertEqual(f, before)
                f.advance(2_000)
                coins = f.coins
                f.select_recipe(recipe.key)
                self.assertEqual((f.recipe, f.coins, f.shipped), (recipe, coins, recipe.unlock))

    def test_recipes_use_the_current_bottleneck_and_seasoning(self):
        f = Factory(0, shipped=90, coins=1_000, roller=2, spice=3)
        for key, rate, price in (("house", 40, 5), ("scallion", 48, 4), ("sesame", 32, 7)):
            with self.subTest(key=key):
                f.select_recipe(key)
                self.assertEqual((f.capacity, f.rate, f.price), (40, rate, price))
                sales = f.advance(f.last_ms + MINUTE)
                self.assertEqual((sales.packs, sales.coins), (rate, rate * price))
        f.buy("steamer")
        f.buy("spice")
        self.assertEqual((f.rate, f.price), (40, 8))

    def test_switch_preserves_fraction_order_and_boiler(self):
        f = Factory(0, shipped=90)
        f.book("canteen")
        f.advance(1_500)
        f.select_recipe("sesame")
        self.assertEqual((f.progress, f.filled, f.charges), (45_000, 0, 3))
        self.assertEqual(f.advance(2_124).packs, 0)
        sale = f.advance(2_125)
        self.assertEqual((sale.packs, sale.coins, f.progress, f.filled), (1, 5, 0, 1))
        f.batch()
        self.assertEqual((f.filled, f.progress, f.shipped, f.coins), (5, 48_000, 95, 61))


class RushTests(unittest.TestCase):
    def test_lock_rejection_and_live_ticket_replacement_are_side_effect_free(self):
        f = Factory(200)
        for key in ("relay", "tasting", "typo"):
            before = deepcopy(f)
            self.assertTrue(f.start_rush(key))
            self.assertEqual(f, before)
        f.shipped = 90
        f.select_recipe("sesame")
        f.start_rush("relay")
        self.assertEqual((f.recipe_key, f.ticket.deadline_ms, f.ticket.filled), ("scallion", 45_200, 0))
        f.batch()
        before = deepcopy(f)
        for key in ("platform", "relay", "tasting"):
            self.assertIn("on the clock", f.start_rush(key))
            self.assertEqual(f, before)

    def test_final_seal_on_the_deadline_pays_once_alongside_a_standing_order(self):
        f = Factory(0)
        f.book("counter")
        f.start_rush("platform")
        f.batch()
        f.advance(23_999)
        self.assertEqual((f.ticket.filled, f.progress, f.rush_wins), (17, 59_970, 0))
        report = f.advance(24_000)
        self.assertEqual((report.packs, report.coins, report.bonuses.rush_coins), (1, 3, 45))
        self.assertFalse(report.rush_expired)
        self.assertEqual((f.rush_wins, f.ticket.status(f.last_ms), f.filled, f.coins), (1, "paid", 18, 135))
        self.assertEqual(f.advance(24_000).bonuses.rush_coins, 0)
        f.deliver()
        self.assertEqual(f.coins, 165)
        f.start_rush("platform")
        self.assertEqual((f.ticket.filled, f.ticket.deadline_ms), (0, 48_000))

    def test_one_millisecond_changes_whether_a_batch_beats_the_bell(self):
        early = Factory(0)
        early.advance(1)
        early.start_rush("platform")
        early.advance(24_000)
        late = deepcopy(early)
        self.assertIn("Rush paid +45", early.batch())
        self.assertEqual((early.ticket.filled, early.rush_wins), (18, 1))
        self.assertTrue(late.advance(24_001).rush_expired)
        late.batch()
        self.assertEqual((late.ticket.filled, late.rush_wins), (12, 0))

    def test_switching_away_changes_eligible_packs_but_the_clock_keeps_running(self):
        f = Factory(0, shipped=90)
        f.start_rush("relay")
        f.book("canteen")
        f.batch()
        f.select_recipe("house")
        f.advance(10_000)
        self.assertEqual((f.ticket.filled, f.filled, f.ticket.deadline_ms), (7, 12, 45_000))
        f.select_recipe("scallion")
        f.advance(50_000)
        self.assertEqual((f.ticket.filled, f.filled, f.shipped, f.rush_wins), (28, 36, 126, 0))
        self.assertEqual(f.ticket.status(f.last_ms), "expired")
        f.start_rush("tasting")
        self.assertEqual((f.ticket.filled, f.recipe_key), (0, "sesame"))

    def test_long_absence_counts_only_eligible_seals_and_consumes_the_gap(self):
        for steamer, expected in ((1, 16), (2, 18)):
            with self.subTest(steamer=steamer):
                f = Factory(0, roller=2, steamer=steamer)
                f.start_rush("platform")
                report = f.advance(2 * OFFLINE_LIMIT)
                self.assertEqual(report.packs, f.rate * 480)
                self.assertEqual(f.ticket.filled, expected)
                self.assertEqual(report.rush_expired, expected < 18)
                self.assertEqual(report.bonuses.rush_coins, 45 if expected == 18 else 0)
                before = deepcopy(f)
                for now in (0, f.last_ms):
                    self.assertEqual(f.advance(now).notices(), "")
                    self.assertEqual(f, before)

    def test_stepping_the_clock_or_settling_once_produces_the_same_receipt(self):
        rng = random.Random(791)
        for offer in RUSHES:
            for level in (1, 5):
                with self.subTest(rush=offer.key, level=level):
                    f = Factory(1_100, shipped=600, coins=600, deliveries=3, progress=45_678,
                                roller=level, steamer=level, sealer=level, steam_ms=12_345)
                    f.set_dispatch(True)
                    f.book("counter")
                    f.start_rush(offer.key)
                    split = deepcopy(f)
                    end = f.last_ms + 3 * MINUTE
                    whole = f.advance(end)
                    reports = []
                    while split.last_ms < end:
                        reports.append(split.advance(min(end, split.last_ms + rng.randint(1, 15_000))))
                    self.assertEqual(split, f)
                    self.assertEqual(sum(r.coins for r in reports), whole.coins)
                    self.assertEqual(sum(r.bonuses.dispatch_coins for r in reports), whole.bonuses.dispatch_coins)
                    self.assertEqual(sum(r.bonuses.rush_coins for r in reports), whole.bonuses.rush_coins)
                    self.assertEqual(sum(r.rush_expired for r in reports), int(whole.rush_expired))


class DispatcherTests(unittest.TestCase):
    def test_hire_requires_both_the_delivery_count_and_exact_fee(self):
        f = Factory(0, deliveries=DISPATCH_UNLOCK - 1, coins=DISPATCH_COST)
        before = deepcopy(f)
        self.assertIn("Hire after", f.set_dispatch(True))
        self.assertEqual(f, before)
        f.deliveries += 1
        f.coins -= 1
        before = deepcopy(f)
        self.assertIn("1 more", f.set_dispatch(True))
        f.set_dispatch(False)
        self.assertEqual(f, before)
        f.coins += 1
        self.assertIn("Book a standing order", f.set_dispatch(True))
        self.assertEqual((f.coins, f.dispatch_mode), (0, "running"))
        self.assertIn("already on duty", f.set_dispatch(True))
        report = f.advance(MINUTE)
        self.assertEqual((f.coins, report.bonuses.orders, f.deliveries), (90, 0, 3))

    def test_hiring_collects_a_waiting_order_once_and_starts_the_next_empty(self):
        f = Factory(0, coins=600, deliveries=3)
        f.book("counter")
        f.advance(MINUTE)
        self.assertIn("1 order for +30", f.set_dispatch(True))
        self.assertEqual((f.filled, f.deliveries, f.coins, f.active_order), (0, 4, 120, "counter"))
        before = deepcopy(f)
        f.set_dispatch(True)
        f.deliver()
        self.assertEqual(f, before)

    def test_bulk_delivery_keeps_remainder_and_lists_wholesale_separately(self):
        f = Factory(0, coins=600, deliveries=3, shipped=450)
        f.set_dispatch(True)
        f.book("canteen")
        report = f.advance(310_000)
        self.assertEqual((report.packs, report.coins), (155, 465))
        self.assertEqual((report.bonuses.orders, report.bonuses.dispatch_coins), (2, 300))
        self.assertEqual((f.filled, f.active_order, f.deliveries, f.coins), (11, "canteen", 5, 765))

    def test_pause_resume_and_change_customers_without_losing_a_partial_order(self):
        f = Factory(0, shipped=90, coins=600, deliveries=3)
        f.set_dispatch(True)
        f.book("counter")
        f.advance(30_000)
        self.assertIn("+30 coins", f.batch())
        f.set_dispatch(False)
        self.assertEqual((f.filled, f.deliveries, f.dispatch_mode), (3, 4, "paused"))
        f.advance(90_000)
        self.assertEqual((f.filled, f.deliveries), (18, 4))
        f.set_dispatch(True)
        self.assertEqual((f.filled, f.deliveries), (0, 5))
        f.set_dispatch(False)
        f.advance(126_000)
        f.deliver()
        f.book("canteen")
        till = f.coins
        f.set_dispatch(True)
        f.set_dispatch(True)
        self.assertEqual((f.active_order, f.filled, f.coins, f.deliveries), ("canteen", 0, till, 6))


if __name__ == "__main__":
    unittest.main()
