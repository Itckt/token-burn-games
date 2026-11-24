import io
import os
import unittest
from contextlib import redirect_stdout
from copy import deepcopy
from unittest.mock import patch

import noodle
from desk import PAGES, duration, operate, page_lines, welcome
from factory import MAX_LEVEL, MINUTE, OFFLINE_LIMIT, Earnings, Factory
from ledger import Visit, open_ledger
from terminal import ESC, _posix_key_reader, console_keys, paint, screen_rows


class ControlsTests(unittest.TestCase):
    def test_a_plain_command_reports_an_elapsed_win_before_starting_a_new_rush(self):
        output = io.StringIO()
        with open_ledger(":memory:") as db:
            with db.visit(0) as v:
                v.factory.start_rush("platform")
                v.factory.batch()
            with patch.object(noodle, "wall_ms", return_value=24_000), \
                 patch.object(noodle.sys, "stdin", io.StringIO("rush platform\nquit\n")), redirect_stdout(output):
                noodle.line_console(db, db.checkpoint(0))
            f = db.checkpoint(24_000).factory
            self.assertEqual((f.rush_wins, f.ticket.filled, f.ticket.deadline_ms), (1, 0, 48_000))
        self.assertIn("Rush paid +45 coins. Started Platform supper.", output.getvalue())

    def test_floor_numbers_buy_and_order_book_numbers_book(self):
        f = Factory(0)
        page = operate(f, "floor", "O").page
        reply = operate(f, page, "1")
        self.assertEqual((f.active_order, f.roller, reply.page), ("counter", 1, "floor"))
        reply = operate(f, reply.page, "1")
        self.assertEqual((f.roller, f.coins, reply.page), (2, 6, "floor"))

    def test_named_commands_handle_casing_and_whitespace(self):
        f = Factory(0)
        operate(f, "floor", "  OrDeR    COUNTER\n")
        operate(f, "floor", " batch  ")
        self.assertEqual((f.active_order, f.filled, f.charges), ("counter", 6, 2))
        operate(f, "help", " BUY\tSpice ")
        self.assertEqual((f.spice, f.coins), (2, 0))

    def test_locked_and_unknown_orders_keep_the_order_book_open(self):
        f = Factory(0)
        for command in ("order canteen", "order freight", "order soup"):
            self.assertEqual(operate(f, "floor", command).page, "orders")
            self.assertEqual(f, Factory(0))

    def test_bad_or_incomplete_commands_are_harmless(self):
        for page, text in (("floor", "0"), ("orders", "4"), ("floor", "buy"), ("floor", "buy roller twice"),
                           ("floor", "batch!"), ("orders", "order"), ("floor", "quit now"),
                           ("floor", "unknown"), ("floor", "1 2"), ("floor", "buy ginger")):
            with self.subTest(page=page, command=text):
                f = Factory(0)
                reply = operate(f, page, text)
                self.assertTrue(reply.note)
                self.assertFalse(reply.finished)
                self.assertEqual(f, Factory(0))

    def test_navigation_help_save_and_quit(self):
        f = Factory(100)
        for cmd in ("?", "h", "help"):
            self.assertEqual(operate(f, "floor", cmd).page, "help")
        for cmd in ("x", "back", "shop", "status", "floor"):
            self.assertEqual(operate(f, "orders", cmd).page, "floor")
        self.assertEqual(operate(f, "orders", "  ").page, "orders")
        self.assertIn("saved", operate(f, "orders", "s").note)
        for cmd in ("q", "exit", "quit"):
            self.assertTrue(operate(f, "help", cmd).finished)
        self.assertEqual(f, Factory(100))

    def test_unlisted_numbers_on_menus_never_buy_a_floor_upgrade(self):
        for page, digits in (("help", "1234"), ("dispatch", "34"), ("recipes", "4"), ("rushes", "4")):
            for digit in digits:
                with self.subTest(page=page, digit=digit):
                    f = Factory(0, coins=999)
                    original = deepcopy(f)
                    reply = operate(f, page, digit)
                    self.assertEqual(reply.page, page)
                    self.assertIn("Unknown command", reply.note)
                    self.assertEqual(f, original)

    def test_numbered_and_named_round_two_commands_do_the_same_work(self):
        for key, menu, choice, command in (
                ("R", "recipes", "2", "recipe SCALLION"), ("T", "rushes", "3", "Rush Tasting"),
                ("A", "dispatch", "1", "dispatch ON"), ("A", "dispatch", "2", "dispatch off")):
            with self.subTest(key=key, command=command):
                by_name = Factory(0, shipped=90, deliveries=3, coins=600)
                by_key = deepcopy(by_name)
                self.assertEqual(operate(by_key, "floor", key).page, menu)
                self.assertEqual(operate(by_key, menu, choice), operate(by_name, "floor", command))
                self.assertEqual(by_name, by_key)

    def test_numbered_logistics_controls_play_the_same_shift_as_named_commands(self):
        by_name = Factory(500, shipped=90, coins=780)
        by_key = deepcopy(by_name)
        for hotkey, menu, digit, command in (
                ("W", "stock", "1", "stock on"), ("W", "stock", "6", "stock expand"),
                ("W", "stock", "2", "stock off"), ("W", "stock", "1", "stock on"),
                ("C", "cart", "1", "cart gate"), ("C", "cart", "2", "cart steps"),
                ("C", "cart", "3", "cart quay"), ("W", "stock", "3", "sell house"),
                ("W", "stock", "4", "sell scallion"), ("W", "stock", "5", "sell sesame"),
                ("P", "rota", "3", "QUEUE sesame"), ("P", "rota", "2", "queue scallion"),
                ("P", "rota", "1", "queue house"), ("P", "rota", "4", "rota start"),
                ("P", "rota", "5", "rota stop"), ("P", "rota", "6", "rota clear")):
            with self.subTest(command=command):
                self.assertEqual(operate(by_key, "floor", hotkey).page, menu)
                self.assertEqual(operate(by_key, menu, digit), operate(by_name, "floor", command))
                self.assertEqual(by_key, by_name)
                if command == "stock on":
                    by_key.batch()
                    by_name.batch()
        self.assertEqual((by_key.stock.bins["house"], by_key.cart.key, by_key.rota.slots), (0, "gate", []))

    def test_new_menus_reject_unlisted_keys_and_incomplete_edits(self):
        f = Factory(0)
        for page, inputs in (("stock", ("7", "stock yes", "sell")),
                             ("cart", ("4", "cart gate twice")), ("rota", ("7", "queue", "queue too many"))):
            for command in inputs:
                with self.subTest(page=page, command=command):
                    reply = operate(f, page, command)
                    self.assertEqual(reply.page, page)
                    self.assertIn("Unknown command", reply.note)
                    self.assertEqual(f, Factory(0))


class ViewsTests(unittest.TestCase):
    def test_floor_labels_the_current_limit_and_upgrade_costs(self):
        f = Factory(0)
        rows = page_lines(f, "floor")
        self.assertIn("Dough roller", next(row for row in rows if "* LIMIT" in row))
        self.assertIn("30c", next(row for row in rows if "Dough roller" in row))
        f.buy("roller")
        rows = page_lines(f, "floor")
        self.assertIn("Steam tunnel", next(row for row in rows if "* LIMIT" in row))
        self.assertIn("90c", next(row for row in rows if "Dough roller" in row))
        f.spice = MAX_LEVEL
        self.assertIn("MAX", next(row for row in page_lines(f, "floor") if "Seasoning bench" in row))

    def test_boiler_order_and_charter_feedback(self):
        f = Factory(0, shipped=4_999, steam_ms=30_000)
        f.book("counter")
        f.batch()
        rows = "\n".join(page_lines(f, "floor"))
        self.assertIn("6/18 packs", rows)
        self.assertIn("+1 in 30s", rows)
        self.assertIn("Brass Ladle earned!", rows)
        f.advance(MINUTE)
        self.assertIn("[D] Deliver +30c", "\n".join(page_lines(f, "floor")))
        self.assertIn("ready to deliver", "\n".join(page_lines(f, "orders")))
        f.deliver()
        self.assertIn("[O] Book an order", "\n".join(page_lines(f, "floor")))

    def test_order_book_displays_unlocks_and_active_progress(self):
        f = Factory(0)
        self.assertIn("opens at 90 shipped", "\n".join(page_lines(f, "orders")))
        f.shipped = 90
        f.book("canteen")
        f.batch()
        rows = "\n".join(page_lines(f, "orders"))
        self.assertIn("Kowloon Tong canteen   /   booked 6/72", rows)
        self.assertIn("opens at 450 shipped", rows)

    def test_return_receipt_includes_sales_cap_and_ready_order(self):
        f = Factory(0)
        fresh = Visit(f, Earnings(0, 0, 0, 0), True)
        self.assertIn("Opening shift", welcome(fresh))
        f.book("counter")
        earnings = f.advance(2 * OFFLINE_LIMIT)
        message = welcome(Visit(f, earnings, False))
        for item in ("16h 0m", "14,400", "43,200 coins", "8h cap", "ready to deliver"):
            self.assertIn(item, message)
        self.assertNotIn("cap", welcome(Visit(f, f.advance(f.last_ms), False)))
        self.assertEqual([duration(x) for x in (599, 2_000, 72_999)], ["0s", "2s", "1m 12s"])

    def test_live_frames_fit_resizes_and_leave_the_factory_untouched(self):
        f = Factory(0, shipped=50, coins=149, steam_ms=17_315, progress=55_000)
        f.book("counter")
        original = deepcopy(f)
        for width, height in ((79, 24), (61, 18), (41, 14), (26, 8), (1, 1)):
            for page in PAGES:
                with self.subTest(width=width, height=height, page=page):
                    rows = screen_rows(f, page, "The next lot is on its way.", width, height)
                    self.assertTrue(0 < len(rows) <= height)
                    self.assertTrue(all(len(line) <= width for line in rows))
                    if width >= 41:
                        self.assertIn("Quit", " ".join(rows))
        self.assertEqual(f, original)

    def test_recipe_book_quotes_actual_income_and_floor_marks_raw_bottleneck(self):
        f = Factory(0, progress=48_000)
        book = "\n".join(page_lines(f, "recipes"))
        for text in ("House broth   /   cooking", "opens at 18 shipped", "24/min x 5c = 120 coins/min"):
            self.assertIn(text, book)
        f.shipped = 90
        f.select_recipe("sesame")
        rows = page_lines(f, "floor")
        self.assertIn("Dough roller", next(line for line in rows if "* LIMIT" in line))
        self.assertIn("24/min", "\n".join(rows))
        self.assertIn("[B] +5 packs", "\n".join(rows))
        self.assertIn("shipped 5 packs", f.batch())

    def test_rush_board_reports_countdown_paid_and_expired_slips(self):
        f = Factory(0)
        f.start_rush("platform")
        f.advance(23_999)
        self.assertIn("11/18 house packs | 1s left", "\n".join(page_lines(f, "rushes")))
        report = f.advance(24_000)
        self.assertIn("Rush ticket expired", welcome(Visit(f, report, False)))
        self.assertIn("expired at 12/18", "\n".join(page_lines(f, "floor")))
        f.start_rush("platform")
        for _ in range(3):
            f.batch()
        board = "\n".join(page_lines(f, "rushes"))
        self.assertIn("Platform supper paid +45c", board)
        self.assertIn("Tickets won 1", board)

    def test_color_is_optional_and_old_frame_contents_get_cleared(self):
        rows = ["STEAMFOLD", "Till 36 coins", "> Saved"]
        rich = paint(rows, color=True)
        plain = paint(rows, color=False)
        self.assertIn(ESC + "[1;33m", rich)
        self.assertNotIn(ESC + "[1;33m", plain)
        for frame in (rich, plain):
            self.assertTrue(frame.startswith(ESC + "[H"))
            self.assertTrue(frame.endswith(ESC + "[J"))
            self.assertEqual(frame.count(ESC + "[K"), len(rows))

    def test_live_boards_show_stock_sale_values_route_quotes_and_rota_position(self):
        f = Factory(0, shipped=90, coins=180)
        f.queue_recipe("house")
        f.queue_recipe("scallion")
        f.set_rota("start")
        f.set_stock(True)
        f.advance(MINUTE)
        stock = "\n".join(page_lines(f, "stock"))
        cart = "\n".join(page_lines(f, "cart"))
        for term in ("Reserving", "12/12   sell 36c", "24 per bin for 180c"):
            self.assertIn(term, stock)
        for term in ("6 house / load ready", "90s   114c", "expand bins"):
            self.assertIn(term, cart)
        f.send_cart("gate")
        f.advance(MINUTE + 29_999)
        self.assertIn("1s left | returning with 36c", "\n".join(page_lines(f, "cart")))
        self.assertIn("Slot 2 cooking scallion | 31s left", "\n".join(page_lines(f, "rota")))
        frame = "\n".join(page_lines(f, "floor"))
        for indicator in ("[C] Cart 1s", "[P] Rota 31s", "[W] 18 held"):
            self.assertIn(indicator, frame)


class LiveConsoleTests(unittest.TestCase):
    def test_cart_and_rush_receipts_commit_before_the_next_key_or_autosave(self):
        output = io.StringIO()
        now = 0
        with open_ledger(":memory:") as db:
            with db.visit(0) as v:
                f = v.factory
                f.set_stock(True)
                f.batch()
                f.send_cart("gate")
                f.set_stock(False)
            with db.visit(6_000) as v:
                v.factory.start_rush("platform")
                v.factory.batch()
            now = 6_000
            keys = iter([None, "s", "q"])

            def read_key(timeout):
                nonlocal now
                key = next(keys)
                if key is None:
                    now = 30_000
                elif key == "s":
                    # Reading this same instant should find the preview already committed.
                    record = db.checkpoint(now)
                    self.assertFalse(record.earnings.has_event)
                    self.assertEqual((record.factory.cart_runs, record.factory.rush_wins), (1, 1))
                return key

            with patch.object(noodle, "wall_ms", side_effect=lambda: now), \
                 patch.object(noodle.time, "monotonic", return_value=0), \
                 patch.object(noodle.shutil, "get_terminal_size", return_value=os.terminal_size((86, 30))), \
                 redirect_stdout(output):
                noodle.live_console(db, db.checkpoint(now), read_key)
        text = output.getvalue()
        self.assertEqual(text.count("Cart returned from Foundry gate with 36 coins."), 1)
        self.assertEqual(text.count("Rush paid +45 coins."), 1)
        self.assertIn("> Shift saved.", text)

    def test_live_keys_stock_launch_and_rotate_without_a_text_command(self):
        with open_ledger(":memory:") as db:
            with db.visit(0) as visit:
                visit.factory.shipped = 18
            keys = iter(("w", "1", "b", "c", "1", "p", "1", "2", "4", None, "q"))
            now = 0

            def read_key(timeout):
                nonlocal now
                key = next(keys)
                if key is None:
                    now = MINUTE
                return key

            output = io.StringIO()
            with patch.object(noodle, "wall_ms", side_effect=lambda: now), \
                 patch.object(noodle.shutil, "get_terminal_size", return_value=os.terminal_size((80, 24))), \
                 redirect_stdout(output):
                noodle.live_console(db, db.checkpoint(0), read_key)
            f = db.checkpoint(now).factory
            self.assertEqual((f.cart_runs, f.recipe_key, f.stock.bins["house"], f.coins), (1, "scallion", 12, 126))
        for term in ("STOCKROOM", "LUNCH CART", "RECIPE ROTA", "Queued", "Rota started", "Cart returned"):
            self.assertIn(term, output.getvalue())

    def test_posix_escape_preserves_a_following_command_and_ignores_arrow_keys(self):
        data = iter([b"\x1b", b"q", b"\x1b", b"[", b"D", b"\x1b", b"O", b"P",
                     b"\x1b", b"[", b"1", b";", b"2", b"B", b"\x1b", b"[", b"[", b"B",
                     b"\x1b", None, None, b""])
        read_key = _posix_key_reader(lambda timeout: next(data))
        self.assertEqual([read_key(1) for _ in range(9)], [ESC, "q", "", "", "", "", ESC, None, "q"])

    def test_live_shift_can_start_a_rush_change_recipe_and_run_dispatch(self):
        keys = iter(("t", "1", "b", "b", "b", "r", "2", "a", "1", "o", "1", "q"))
        output = io.StringIO()
        with open_ledger(":memory:") as db:
            with db.visit(0) as v:
                v.factory.coins, v.factory.shipped, v.factory.deliveries = 600, 84, 3
            initial = db.checkpoint(0)
            with patch.object(noodle, "wall_ms", return_value=0), \
                 patch.object(noodle.shutil, "get_terminal_size", return_value=os.terminal_size((80, 24))), \
                 redirect_stdout(output):
                noodle.live_console(db, initial, lambda timeout: next(keys))
            saved = db.checkpoint(0).factory
            self.assertEqual((saved.rush_wins, saved.recipe_key, saved.dispatch_mode, saved.active_order),
                             (1, "scallion", "running", "counter"))
            self.assertEqual(saved.coins, 99)
        for text in ("RUSH BOARD", "RECIPE BOOK", "DISPATCH DESK", "Rush paid +45", "Milestone reached"):
            self.assertIn(text, output.getvalue())
        milestone_frame = next(frame for frame in output.getvalue().split(ESC + "[H") if "Milestone" in frame)
        self.assertIn("Extra batch shipped", milestone_frame)

    def test_idle_live_floor_announces_the_rush_outcome_without_a_keypress(self):
        for batch, notice in ((False, "Rush ticket expired."), (True, "Rush paid +45 coins.")):
            with self.subTest(batch=batch), open_ledger(":memory:") as db:
                with db.visit(0) as v:
                    v.factory.start_rush("platform")
                    if batch:
                        v.factory.batch()
                now = 0

                def read_key(timeout):
                    nonlocal now
                    if now == 0:
                        now = 24_000
                        return None
                    return "q"

                output = io.StringIO()
                with patch.object(noodle, "wall_ms", side_effect=lambda: now), \
                     patch.object(noodle.time, "monotonic", side_effect=lambda: now / 1_000), \
                     patch.object(noodle.shutil, "get_terminal_size", return_value=os.terminal_size((80, 24))), \
                     redirect_stdout(output):
                    noodle.live_console(db, db.checkpoint(0), read_key)
                self.assertIn("> " + notice, output.getvalue())
                self.assertEqual(db.checkpoint(now).factory.rush_wins, int(batch))

    def test_autosave_while_idle_and_single_key_play(self):
        now = 0
        keys = iter(["o", "1", "b", None, "d", "1", "?", "\x1b", "", "\r", "q"])
        output = io.StringIO()
        with open_ledger(":memory:") as ledger:
            with ledger.visit(0) as initial:
                pass

            def read_key(timeout):
                nonlocal now
                key = next(keys)
                if key is None:
                    now += MINUTE
                if key == "d":
                    # Inspect the committed checkpoint before the next key is handled.
                    with ledger.visit(now) as v:
                        self.assertEqual(v.earnings.elapsed_ms, 0)
                        self.assertEqual((v.factory.shipped, v.factory.filled), (36, 18))
                return key

            with patch.object(noodle, "wall_ms", side_effect=lambda: now), \
                 patch.object(noodle.time, "monotonic", side_effect=lambda: now / 1_000), \
                 patch.object(noodle.shutil, "get_terminal_size", return_value=os.terminal_size((80, 24))), \
                 redirect_stdout(output):
                noodle.live_console(ledger, initial, read_key)
            with ledger.visit(now) as end:
                self.assertEqual((end.factory.deliveries, end.factory.roller, end.factory.coins), (1, 2, 144))
        for section in ("FACTORY FLOOR", "ORDER BOOK", "SHIFT GUIDE", "Extra batch shipped"):
            self.assertIn(section, output.getvalue())

    def test_cursor_screen_and_keyboard_restored_after_interruption(self):
        restores = []
        adapter = (lambda timeout: "q", lambda: restores.append(True))
        platform = "terminal._windows_console" if os.name == "nt" else "terminal._posix_console"
        output = io.StringIO()
        with patch(platform, return_value=adapter), redirect_stdout(output):
            with self.assertRaises(KeyboardInterrupt):
                with console_keys() as read_key:
                    self.assertEqual(read_key(0), "q")
                    raise KeyboardInterrupt
        self.assertEqual(restores, [True])
        self.assertIn(ESC + "[?25h" + ESC + "[?1049l", output.getvalue())

    def test_unsupported_console_leaves_the_transcript_available(self):
        platform = "terminal._windows_console" if os.name == "nt" else "terminal._posix_console"
        output = io.StringIO()
        with patch(platform, return_value=None), redirect_stdout(output), console_keys() as reader:
            self.assertIsNone(reader)
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
