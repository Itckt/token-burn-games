import unittest

from engine import Game, RuleError
from story import load_story, parse_story
from tests.support import SAMPLE, batch_story, counter_story, small_story


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story = load_story(SAMPLE)

    def setUp(self):
        self.game = Game(self.story)

    def state(self):
        game = self.game
        return (
            game.room.id, game.day, game.spent, game.balance, game.expired,
            game.flags, game.inventory, game.journal, game.events, game.ending, game.pending,
        )

    def assert_rejected(self, message, operation, *args):
        before = self.state()
        with self.assertRaisesRegex(RuleError, message):
            operation(*args)
        self.assertEqual(self.state(), before)

    def test_new_grant_and_deadline(self):
        game = self.game
        self.assertEqual((game.room.id, game.day, game.days_left), ("station", 1, 10))
        self.assertEqual((game.spent, game.balance, game.expired), (0, 10_000_000_000, 0))
        self.assertEqual((game.flags, game.journal, game.events), (set(), (), ()))
        self.assertFalse(game.finished)
        self.assertIsNone(game.ending)

    def test_travel_follows_exits_and_costs_nothing(self):
        game = self.game
        self.assert_rejected("already here", game.move, "station")
        self.assert_rejected("no exit", game.move, "common")
        self.assert_rejected("no exit", game.move, "moon")
        for destination in ("desk", "common", "press", "station"):
            self.assertEqual(game.move(destination).id, destination)
        self.assertEqual(len(game.events), 4)
        self.assertEqual((game.day, game.spent, game.journal), (1, 0, ()))

    def test_work_requires_the_correct_room_and_materials(self):
        game = self.game
        self.assert_rejected("no work", game.work, "fold")
        self.assert_rejected("Needs a finished map master", game.work, "post")
        game.move("desk")
        game.move("common")
        self.assert_rejected("a public rain map, an open reading drawer", game.work, "handover")

    def test_work_records_days_cost_and_flags_and_locks_alternative(self):
        game = self.game
        first = game.work("walk")
        self.assertEqual((first.first_day, first.last_day, first.cost), (1, 1, 0))
        self.assert_rejected("Already completed", game.work, "walk")
        game.move("desk")
        fold = game.work("fold")
        self.assertEqual((fold.first_day, fold.last_day, fold.cost), (2, 3, 1_500_000_000))
        self.assertEqual((game.day, game.days_left, game.balance), (4, 7, 8_500_000_000))
        self.assertEqual(game.flags, {"route-notes", "map-master"})
        self.assertEqual(game.journal, (first, fold))
        self.assert_rejected("Already completed", game.work, "fold")
        self.assert_rejected("Closed because", game.work, "tile")
        game.move("station")
        self.assertIsNone(game.block_reason(game.room.actions["post"]))

    def test_choices_lock_in_either_direction(self):
        game = self.game
        game.work("walk")
        game.move("desk")
        game.work("tile")
        self.assert_rejected("Closed because", game.work, "fold")
        game.move("station")
        game.move("press")
        game.work("listen")
        game.work("rush")
        self.assert_rejected("Closed because", game.work, "index")
        self.assertEqual((game.day, game.spent), (5, 9_000_000_000))

    def test_another_session_starts_with_independent_progress(self):
        self.game.work("walk")
        other = Game(self.story)
        self.assertEqual((other.day, other.flags, other.events), (1, set(), ()))
        self.assertIsNone(other.block_reason(other.room.actions["walk"]))

    def test_last_day_is_playable_but_cannot_start_two_day_work(self):
        game = self.game
        game.work("walk")
        for _ in range(8):
            game.wait()
        game.move("desk")
        self.assertEqual((game.day, game.days_left), (10, 1))
        self.assert_rejected("Only 1 day left", game.work, "fold")
        last = game.work("tile")
        self.assertEqual((last.first_day, last.last_day), (10, 10))
        self.assertTrue(game.finished)
        self.assertEqual((game.balance, game.spent, game.expired), (0, 5_000_000_000, 5_000_000_000))
        self.assertIn("map-master", game.flags)
        self.assert_rejected("deadline", game.wait)
        self.assert_rejected("deadline", game.work, "fold")
        self.assert_rejected("deadline", game.move, "station")

    def test_waiting_out_the_grant_expires_every_token_once(self):
        game = self.game
        for day in range(1, 11):
            entry = game.wait()
            self.assertEqual((entry.first_day, entry.last_day, entry.cost), (day, day, 0))
            self.assertEqual(game.days_left, 10 - day)
            self.assertEqual(game.balance + game.spent + game.expired, 10_000_000_000)
        self.assertEqual((game.spent, game.expired, game.ending.id), (0, 10_000_000_000, "envelope"))
        self.assert_rejected("deadline", game.wait)

    def test_exhausting_the_budget_still_allows_free_final_day_work(self):
        game = Game(parse_story(small_story()))
        game.work("collect")
        self.assertEqual((game.day, game.balance, game.finished), (2, 0, False))
        game.move("loft")
        game.work("deliver")
        self.assertTrue(game.finished)
        self.assertEqual((game.ending.id, game.spent, game.expired), ("signed", 7, 0))

    def test_unaffordable_work_reports_exact_shortfall_without_mutation(self):
        game = self.game
        game.work("walk")
        game.move("desk")
        game.work("tile")
        game.move("station")
        game.work("post")
        game.move("press")
        game.work("listen")
        game.work("rush")
        game.work("file")
        game.move("common")
        self.assertEqual((game.balance, game.days_left), (0, 4))
        self.assert_rejected("1,500,000,000 more AI tokens", game.work, "handover")
        self.assert_rejected("500,000,000 more AI tokens", game.work, "relay")
        game.wait()
        self.assertFalse(game.finished)

    def test_integer_accounting_above_floating_point_precision(self):
        data = small_story()
        data["budget"] = 2**60 + 1
        data["rooms"]["hall"]["actions"]["collect"]["cost"] = 2**60
        game = Game(parse_story(data))
        game.work("collect")
        self.assertEqual(game.balance, 1)
        game.wait()
        self.assertEqual((game.spent, game.expired), (2**60, 1))

    def test_zero_budget_and_single_day_adventure(self):
        data = small_story()
        data.update(budget=0, days=1)
        game = Game(parse_story(data))
        with self.assertRaisesRegex(RuleError, "7 more stamps"):
            game.work("collect")
        game.wait()
        self.assertEqual((game.days_left, game.balance, game.expired, game.ending.id), (0, 0, 0, "late"))

    def test_conversations_are_local_free_and_replayable_in_the_journal(self):
        game = self.game
        self.assert_rejected("No one called 'wai'", game.talk, "wai", "tape")
        self.assert_rejected("see Yan's topics", game.talk, "yan", "missing")
        self.assert_rejected("Needs Yan's route notes", game.talk, "yan", "crossing")
        game.move("desk")
        game.move("booth")
        entry = game.talk("wai", "tape")
        self.assertEqual((entry.first_day, entry.last_day, entry.cost), (1, 1, 0))
        self.assertEqual(entry.produced, (("blank", 1),))
        self.assertEqual((game.day, game.spent, game.inventory), (1, 0, {"blank": 1}))
        self.assertEqual(game.journal, (entry,))
        self.assertEqual(game.events[-1], ("talk", "wai", "tape"))
        self.assert_rejected("Already discussed", game.talk, "wai", "tape")
        game.inventory.clear()
        self.assertEqual(game.inventory, {"blank": 1})
        self.assertEqual(Game(self.story).inventory, {})

    def test_the_same_blank_cannot_be_promised_to_both_speakers(self):
        game = self.game
        game.work("walk")
        game.move("press")
        game.work("listen")
        game.move("booth")
        game.talk("wai", "tape")
        game.move("press")
        entry = game.talk("bo", "ticket")
        self.assertEqual((entry.consumed, entry.produced), ((("blank", 1),), (("ticket-take", 1),)))
        self.assertEqual(game.inventory, {"ticket-take": 1})
        game.move("station")
        self.assert_rejected("blank loop tape .*carrying 0", game.talk, "yan", "crossing")
        game.move("desk")
        game.move("booth")
        self.assert_rejected("Already discussed", game.talk, "wai", "tape")
        self.assert_rejected("Opens on day 4", game.work, "air-ticket")
        game.wait()
        game.work("air-ticket")
        self.assertEqual((game.day, game.spent, game.inventory), (5, 900_000_000, {}))
        game.move("press")
        game.talk("bo", "names")
        self.assertEqual(game.day, 5)

    def test_counter_exchange_checks_every_input_before_debiting_and_credits_afterwards(self):
        data = counter_story()
        # Even an output of the same kind cannot supply a missing input.
        data["rooms"]["hall"]["actions"]["collect"]["produces"]["seal"] = 2
        self.game = Game(parse_story(data))
        game = self.game
        game.wait()
        self.assert_rejected("brass seal .*carrying 0", game.work, "collect")
        game.talk("clerk", "collect")
        receipt = game.work("collect")
        self.assertEqual(dict(receipt.consumed), {"slip": 2, "seal": 1})
        self.assertEqual(dict(receipt.produced), {"slip": 1, "seal": 2})
        self.assertEqual((game.day, game.balance, game.inventory), (4, 0, {"slip": 2, "seal": 2}))
        self.assertEqual(Game(game.story).inventory, {"slip": 3})
        game.move("loft")
        # Same topic ID, different person. The last playable day and a zero balance allow a chat.
        game.talk("porter", "collect")
        self.assertEqual(game.inventory, {"slip": 2, "seal": 3})
        game.work("deliver")
        self.assertEqual(game.ending.id, "signed")
        self.assert_rejected("deadline", game.talk, "porter", "collect")

    def test_unaffordable_exchange_keeps_items_flags_and_history(self):
        data = counter_story()
        data["budget"] = 6
        self.game = Game(parse_story(data))
        game = self.game
        game.talk("clerk", "collect")
        game.wait()
        self.assert_rejected("1 more stamps", game.work, "collect")
        self.assertEqual(game.inventory, {"slip": 3, "seal": 1})

    def test_multiday_booking_allows_exact_fit_and_rejects_a_late_start(self):
        data = small_story()
        data["days"] = 5
        data["rooms"]["hall"]["actions"]["collect"].update(days=2, window=[2, 5])
        story = parse_story(data)
        for day in (2, 3, 4):
            with self.subTest(start=day):
                game = Game(story)
                for _ in range(day - 1):
                    game.wait()
                entry = game.work("collect")
                self.assertEqual((entry.first_day, entry.last_day, game.finished), (day, day + 1, day == 4))
                self.assertIn("parcel", game.flags)
        self.game = Game(story)
        self.assert_rejected("Opens on day 2", self.game.work, "collect")
        for _ in range(4):
            self.game.wait()
        self.assert_rejected("Last start was day 4", self.game.work, "collect")

    def test_conversation_choices_can_open_and_close_other_topics(self):
        data = counter_story()
        topics = data["rooms"]["hall"]["people"]["clerk"]["topics"]
        topics["sign"] = {"name": "Sign", "gives": ["parcel"], "result": "Your name goes in the book."}
        topics["collect"]["unless"] = ["parcel"]
        topics["receipt"] = {"name": "Get receipt", "requires": ["parcel"],
                             "result": "The clerk signs too."}
        self.game = Game(parse_story(data))
        game = self.game
        self.assert_rejected("Needs the parcel", game.talk, "clerk", "receipt")
        game.talk("clerk", "sign")
        self.assert_rejected("Closed because", game.talk, "clerk", "collect")
        game.talk("clerk", "receipt")
        self.assertEqual((game.day, game.flags, len(game.journal)), (1, {"parcel"}, 2))

    def test_shortest_routes_are_read_only_and_respect_exit_order_and_one_way_travel(self):
        before = self.state()
        self.assertEqual(self.game.route("booth"), ("desk", "booth"))
        self.assertEqual(self.game.route("station"), ())
        self.assert_rejected("Unknown room", self.game.route, "moon")
        self.assertEqual(self.state(), before)
        data = small_story()
        data["rooms"]["hall"]["exits"] = ["yard", "loft"]
        data["rooms"]["yard"] = {"name": "Yard", "description": "A wall.", "exits": ["hall", "loft"]}
        game = Game(parse_story(data))
        self.assertEqual(game.route("loft"), ("loft",))
        game.move("loft")
        self.assertIsNone(game.route("hall"))
        self.assertEqual((game.day, game.events), (1, (("go", "loft"),)))

    def test_six_seats_opens_an_optional_conversation_at_the_booth(self):
        game = self.game
        game.move("desk")
        game.move("booth")
        self.assert_rejected("Needs the Six Seats prototype", game.talk, "wai", "chime")
        game.move("desk")
        game.move("common")
        game.work("relay")
        game.move("desk")
        game.move("booth")
        entry = game.talk("wai", "chime")
        self.assertIn("sugar bowl", entry.text)
        self.assertEqual((game.day, game.spent, game.inventory), (2, 500_000_000, {}))

    def test_batch_debits_now_and_delivers_once_during_longer_daytime_work(self):
        self.game = game = Game(parse_story(batch_story()))
        self.assert_rejected("Needs the counter pass", game.queue, "run")
        game.talk("clerk", "pass")
        submission = game.queue("run")
        self.assertEqual((submission.first_day, submission.last_day, submission.cost), (1, 1, 4))
        self.assertEqual((submission.consumed, submission.produced), ((("paper", 1),), ()))
        self.assertEqual((game.day, game.balance, game.inventory), (1, 6, {"paper": 1}))
        self.assertEqual(game.pending.due_day, 2)
        self.assert_rejected("Already submitted", game.queue, "run")
        self.assert_rejected("needs a printed proof", game.move, "loft")
        self.assertIsNone(game.route("loft"))
        game.talk("clerk", "retire")  # A later change cannot revoke an accepted batch.
        self.assertNotIn("printed", game.flags)
        work = game.work("collect")
        self.assertEqual((work.first_day, work.last_day, work.delivery.due_day), (1, 3, 2))
        self.assertIsNone(game.pending)
        self.assertEqual((game.day, game.balance, game.inventory), (4, 3, {"paper": 1, "proof": 2}))
        self.assertEqual(game.route("loft"), ("loft",))
        self.assertIn("printed", game.flags)
        self.assert_rejected("Already submitted", game.queue, "run")
        self.assertIsNone(game.wait().delivery)
        self.assertEqual(sum(entry.delivery is not None for entry in game.journal), 1)
        self.assertEqual((game.spent, game.expired, game.ending.id), (7, 3, "in-print"))

    def test_queue_is_shared_across_rooms_and_accepts_another_job_after_delivery(self):
        data = batch_story()
        del data["rooms"]["hall"]["exit_requires"]
        self.game = game = Game(parse_story(data))
        self.assert_rejected("no batch called 'spare' here", game.queue, "spare")
        game.talk("clerk", "pass")
        game.queue("run")
        game.move("loft")
        self.assert_rejected("busy until the end of day 2", game.queue, "spare")
        self.assertIsNone(game.wait().delivery)
        self.assert_rejected("busy", game.queue, "spare")
        self.assertEqual(game.wait().delivery.job.id, "run")
        self.assertEqual((game.room.id, game.day), ("loft", 3))
        game.queue("spare")
        second = game.wait().delivery
        self.assertEqual((second.job.id, second.due_day, game.inventory), ("spare", 3, {"paper": 2, "proof": 2}))
        self.assert_rejected("Already submitted", game.queue, "spare")

    def test_failed_batch_submissions_keep_the_slot_items_money_and_history(self):
        for cost, inputs, error in [
            (11, {"paper": 1}, "1 more stamps"),
            (4, {"paper": 1, "proof": 1}, "stamped proof .*carrying 0"),
        ]:
            with self.subTest(error=error):
                data = batch_story()
                data["rooms"]["hall"]["batches"]["run"].update(cost=cost, consumes=inputs)
                self.game = game = Game(parse_story(data))
                game.talk("clerk", "pass")
                self.assert_rejected(error, game.queue, "run")
                self.assertEqual((game.inventory, game.balance, game.pending), ({"paper": 2}, 10, None))
                game.talk("clerk", "retire")
                self.assert_rejected("Closed because you have a retired plate", game.queue, "run")

    def test_work_and_batch_with_the_same_id_have_independent_receipts(self):
        data = batch_story()
        batches = data["rooms"]["hall"]["batches"]
        batches["collect"] = batches.pop("run")
        game = Game(parse_story(data))
        game.talk("clerk", "pass")
        game.queue("collect")
        self.assertEqual(game.work("collect").delivery.job.id, "collect")
        self.assertEqual(game.events[-2:], (("queue", "collect"), ("do", "collect")))

    def test_last_night_accepts_an_exact_fit_and_applies_it_before_expiry(self):
        data = batch_story()
        data["budget"] = 4
        batches = data["rooms"]["hall"]["batches"]
        batches["quick"] = batches["run"] | {"nights": 1}
        self.game = game = Game(parse_story(data))
        for _ in range(3):
            game.wait()
        game.talk("clerk", "pass")
        self.assert_rejected("finish on day 5.*day 4 deadline", game.queue, "run")
        game.queue("quick")
        self.assertEqual((game.day, game.balance, game.finished), (4, 0, False))
        self.assertIsNone(game.route("loft"))
        self.assertEqual(game.wait().delivery.due_day, 4)
        self.assertEqual((game.pending, game.ending.id, game.spent, game.expired), (None, "in-print", 4, 0))
        self.assert_rejected("deadline", game.queue, "run")
        self.assert_rejected("deadline", game.move, "loft")

    def test_gated_shortcut_needs_every_flag_and_the_return_edge_is_independent(self):
        data = batch_story()
        hall = data["rooms"]["hall"]
        hall["exits"].append("yard")
        hall["exit_requires"]["loft"] = ["pass", "printed"]
        data["rooms"]["yard"] = {"name": "Yard", "description": "A stairway.", "exits": ["loft"]}
        data["rooms"]["loft"]["exits"] = ["hall"]
        self.game = game = Game(parse_story(data))
        self.assertEqual(game.route("loft"), ("yard", "loft"))
        self.assert_rejected("the counter pass, a printed proof", game.move, "loft")
        for step in ("yard", "loft", "hall"):
            game.move(step)
        game.talk("clerk", "pass")
        self.assert_rejected("needs a printed proof", game.move, "loft")
        self.assertEqual(game.route("loft"), ("yard", "loft"))
        game.queue("run")
        game.wait()
        game.wait()
        self.assertEqual(game.route("loft"), ("loft",))
        self.assertEqual(game.move("loft").id, "loft")

    def test_an_explicit_self_loop_can_be_taken_and_replayed(self):
        data = small_story()
        data["rooms"]["hall"]["exits"].append("hall")
        game = Game(parse_story(data))
        self.assertEqual(game.move("hall").id, "hall")
        self.assertEqual((game.day, game.events, game.route("hall")), (1, (("go", "hall"),), ()))
        self.assertEqual(game.fork().events, game.events)

    def test_a_plan_can_finish_a_running_batch_without_altering_its_source(self):
        self.game = game = Game(parse_story(batch_story()))
        game.talk("clerk", "pass")
        game.queue("run")
        before = self.state()
        trial = game.fork()
        self.assertEqual((trial.pending, trial.events, trial.journal), (game.pending, game.events, game.journal))
        for move in (("do", "collect"), ("go", "loft"), ("do", "deliver")):
            trial.apply(move)
        self.assertEqual((trial.ending.id, trial.spent, trial.expired), ("signed", 7, 3))
        self.assertEqual(self.state(), before)
        self.assertIsNone(game.route("loft"))
