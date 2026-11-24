import json
import unittest

from story import StoryError, load_story, parse_story
from tests.support import SAMPLE, batch_story, counter_story, small_story, work_directory


class StoryTests(unittest.TestCase):
    def test_sample_defines_ten_days_and_nine_distinct_endings(self):
        story = load_story(SAMPLE)
        self.assertEqual((story.days, story.budget, story.resource), (10, 10_000_000_000, "AI tokens"))
        self.assertEqual(len(story.rooms), 6)
        self.assertEqual(len({ending.id for ending in story.endings}), 9)
        self.assertEqual(sum(len(room.actions) for room in story.rooms.values()), 13)
        self.assertEqual(sum(len(room.batches) for room in story.rooms.values()), 2)
        self.assertEqual(story.endings[-1].requires, ())
        self.assertEqual(set(story.notices), {4, 7, 10})

    def test_minimal_fields_and_defaults(self):
        data = small_story()
        story = parse_story(data)
        deliver = story.rooms["loft"].actions["deliver"]
        self.assertEqual((deliver.days, deliver.cost, deliver.unless), (1, 0, ()))
        self.assertEqual(story.rooms["loft"].exits, ())
        self.assertEqual((story.items, story.starting_items, story.rooms["loft"].people), ({}, {}, {}))
        self.assertEqual((deliver.consumes, deliver.produces, deliver.window), ((), (), None))
        hall = story.rooms["hall"]
        self.assertEqual((deliver.nights, hall.exit_requires, hall.batches), (0, {}, {}))
        self.assertEqual((story.rooms["hall"].details, story.notices), ({}, {}))
        data["rooms"] = {"hall": {"name": "Hall", "description": "Quiet."}}
        del data["flags"]
        data["endings"] = [data["endings"][-1]]
        story = parse_story(data)
        self.assertEqual((story.rooms["hall"].actions, story.flags), ({}, {}))

    def test_rejects_invalid_types_ids_costs_and_missing_fields(self):
        cases = [
            (("id",), "../unsafe", "ID"),
            (("title",), "  ", "nonempty text"),
            (("days",), True, "integer"),
            (("days",), 0, "integer"),
            (("budget",), -1, "integer"),
            (("budget",), 2.5, "integer"),
            (("start",), "roof", "starting room"),
            (("flags",), [], "object"),
            (("rooms",), [], "object"),
            (("rooms", "hall", "actions"), "collect", "object"),
            (("rooms", "hall", "actions", "collect", "result"), None, "nonempty text"),
            (("rooms", "hall", "actions", "collect", "days"), 0, "integer"),
            (("rooms", "hall", "actions", "collect", "cost"), False, "integer"),
            (("rooms", "hall", "actions", "collect", "cost"), -9, "integer"),
            (("rooms", "hall", "actions", "collect", "gives"), ["lost"], "unknown ID"),
            (("rooms", "loft", "actions", "deliver", "requires"), "parcel", "list"),
            (("rooms", "loft", "actions", "deliver", "unless"), ["parcel"], "needs and excludes"),
            (("rooms", "loft", "actions", "deliver", "unless"), [None], "unknown ID"),
            (("rooms", "loft", "details"), {"lost": "A note."}, "unknown ID"),
            (("rooms", "hall", "exits"), ["loft", "loft"], "repeated ID"),
            (("rooms", "hall", "exits"), ["void"], "unknown ID"),
            (("endings",), [], "at least one"),
            (("endings", 0, "requires"), ["lost"], "unknown ID"),
            (("endings", 1, "id"), "signed", "repeated"),
        ]
        self.assert_invalid_fields(small_story, cases)
        with self.assertRaisesRegex(StoryError, "object"):
            parse_story(None)
        data = small_story()
        del data["resource"]
        with self.assertRaisesRegex(StoryError, "resource"):
            parse_story(data)

    def assert_invalid_fields(self, factory, cases):
        for path, value, message in cases:
            with self.subTest(path=path, value=value):
                data = factory()
                parent = data
                for key in path[:-1]:
                    parent = parent[key]
                parent[path[-1]] = value
                with self.assertRaisesRegex(StoryError, message):
                    parse_story(data)

    def test_item_catalogue_and_all_exchange_fields_are_validated(self):
        work = ("rooms", "hall", "actions", "collect")
        talk = ("rooms", "hall", "people", "clerk", "topics", "collect")
        self.assert_invalid_fields(counter_story, [
            (("items",), [], "object"), (("items", "seal"), "", "nonempty text"),
            (("items", "two slips"), "Slip", "lowercase ID"),
            (("starting_items",), {"stamp": 1}, "unknown ID"),
            (("starting_items", "slip"), 0, "integer"),
            (work + ("consumes",), ["slip"], "object"),
            (work + ("consumes",), {"stamp": 2}, "unknown ID"),
            (work + ("produces", "slip"), True, "integer"),
            (talk + ("produces", "seal"), 1.5, "integer"),
            (talk + ("consumes",), {"seal": -1}, "integer"),
        ])

    def test_bookings_require_real_ordered_days_and_time_to_finish(self):
        path = ("rooms", "hall", "actions", "collect", "window")
        self.assert_invalid_fields(counter_story, [
            (path, None, "pair"), (path, [1], "pair"), (path, [1, 2, 3], "pair"),
            (path, [0, 3], "integer"), (path, [True, 3], "integer"),
            (path, [1, "3"], "integer"), (path, [2, 5], "within days"),
            (path, [3, 2], "in order"), (path, [4, 4], "too short"),
        ])
        data = small_story()
        data["rooms"]["loft"]["actions"]["deliver"]["window"] = [2, 2]
        window = parse_story(data).rooms["loft"].actions["deliver"].window
        self.assertEqual((window.first, window.last, window.latest_start(1)), (2, 2, 2))

    def test_people_and_topics_are_validated_in_their_own_scope(self):
        people = ("rooms", "hall", "people")
        topics = people + ("clerk", "topics")
        self.assert_invalid_fields(counter_story, [
            (people, [], "object"), (people + ("bad id",), {}, "lowercase ID"),
            (people + ("clerk", "greeting"), None, "nonempty text"),
            (topics, {}, "at least one"), (topics + ("Bad",), {}, "lowercase ID"),
            (topics + ("collect", "result"), None, "nonempty text"),
            (topics + ("collect", "requires"), ["lost"], "unknown ID"),
            (topics + ("collect", "days"), 0, "conversation topic"),
            (topics + ("collect", "cost"), 2, "conversation topic"),
            (topics + ("collect", "window"), [1, 2], "conversation topic"),
        ])
        data = counter_story()
        self.assertEqual(parse_story(data).rooms["loft"].people["porter"].topics["collect"].days, 0)
        data["rooms"]["loft"]["people"] = data["rooms"]["hall"]["people"]
        with self.assertRaisesRegex(StoryError, "Person ID.*more than one room"):
            parse_story(data)

    def test_room_reachability_and_unique_work_ids(self):
        data = small_story()
        data["rooms"]["hall"]["exits"] = []
        with self.assertRaisesRegex(StoryError, "No path.*loft"):
            parse_story(data)
        data = small_story()
        data["rooms"]["loft"]["actions"]["collect"] = data["rooms"]["hall"]["actions"]["collect"]
        with self.assertRaisesRegex(StoryError, "more than one room"):
            parse_story(data)

    def test_fallback_ending_is_last_and_guaranteed(self):
        data = small_story()
        data["endings"].reverse()
        with self.assertRaisesRegex(StoryError, "Only the last"):
            parse_story(data)
        data["endings"] = [data["endings"][1]]
        with self.assertRaisesRegex(StoryError, "must be unconditional"):
            parse_story(data)

    def test_notices_use_real_days_in_the_story(self):
        for key in ("0", "01", "2.5", "-1", "3", "soon"):
            with self.subTest(key=key):
                data = small_story()
                data["notices"] = {key: "A bell rings."}
                with self.assertRaisesRegex(StoryError, "Notice day"):
                    parse_story(data)
        data = small_story()
        data["notices"] = {"2": "The shutters are coming down."}
        self.assertEqual(parse_story(data).notices, {2: "The shutters are coming down."})

    def test_gates_name_listed_exits_and_declared_milestones(self):
        gate = ("rooms", "hall", "exit_requires")
        self.assert_invalid_fields(batch_story, [
            (gate, [], "object"), (gate, {"hall": []}, "unknown ID"),
            (gate, {"yard": ["pass"]}, "unknown ID"),
            (gate + ("loft",), "pass", "list"), (gate + ("loft",), ["ticket"], "unknown ID"),
            (gate + ("loft",), ["pass", "pass"], "repeated ID"),
        ])
        story = parse_story(batch_story())
        self.assertEqual(story.rooms["hall"].exit_requires, {"loft": ("printed",)})
        self.assertEqual(story.rooms["loft"].exit_requires, {})

    def test_batches_validate_timing_references_and_id_scope(self):
        batches = ("rooms", "hall", "batches")
        job = batches + ("run",)
        self.assert_invalid_fields(batch_story, [
            (batches, [], "object"), (batches + ("Bad",), {}, "lowercase ID"),
            (job + ("nights",), True, "integer"), (job + ("nights",), 0, "integer"),
            (job + ("nights",), 1.5, "integer"), (job + ("nights",), 5, "deadline"),
            (job + ("days",), 1, "batch"), (job + ("window",), [1, 3], "batch"),
            (job + ("cost",), -1, "integer"), (job + ("cost",), False, "integer"),
            (job + ("result",), "", "nonempty text"), (job + ("gives",), ["stamp"], "unknown ID"),
            (job + ("unless",), ["pass"], "needs and excludes"),
            (job + ("consumes",), {"ink": 1}, "unknown ID"), (job + ("produces",), {"proof": 0}, "integer"),
            (("rooms", "hall", "actions", "collect", "nights"), 1, "belongs on a batch"),
            (("rooms", "hall", "people", "clerk", "topics", "pass", "nights"), 1, "conversation topic"),
        ])
        data = batch_story()
        del data["rooms"]["hall"]["batches"]["run"]["nights"]
        with self.assertRaisesRegex(StoryError, "run.nights"):
            parse_story(data)
        data = batch_story()
        data["rooms"]["loft"]["batches"]["run"] = data["rooms"]["hall"]["batches"]["run"]
        with self.assertRaisesRegex(StoryError, "Batch ID.*more than one room"):
            parse_story(data)
        # Separate commands can use the same ID for a foreground job and a batch.
        data["rooms"]["loft"]["batches"] = {"deliver": {"name": "Mail", "result": "Posted.", "nights": 4}}
        job = parse_story(data).rooms["loft"].batches["deliver"]
        self.assertEqual((job.days, job.nights, job.cost, job.gives, job.produces), (0, 4, 0, (), ()))

    def test_loads_utf8_with_bom_and_fingerprints_content(self):
        data = small_story()
        data["title"] = "Lumi\u00e8re"
        with work_directory() as directory:
            path = directory / "alternate.json"
            path.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8-sig")
            first = load_story(path)
            self.assertEqual(first.title, data["title"])
            path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
            self.assertEqual(first.fingerprint, load_story(path).fingerprint)
            data["budget"] += 1
            self.assertNotEqual(first.fingerprint, parse_story(data).fingerprint)

    def test_file_errors_malformed_json_and_duplicate_keys(self):
        with work_directory() as directory:
            path = directory / "bad.json"
            with self.assertRaisesRegex(StoryError, "bad.json"):
                load_story(path)
            for content, message in [(b"{", "read"), (b"\xff", "read"), (b'{"x":1,"x":2}', "Duplicate"),
                                     (b"[" * 2000 + b"]" * 2000, "read")]:
                with self.subTest(content=content):
                    path.write_bytes(content)
                    with self.assertRaisesRegex(StoryError, message):
                        load_story(path)

    def test_invalid_json_constants_and_unprintable_text_are_reported_at_load(self):
        with work_directory() as directory:
            path = directory / "post.json"
            for constant in ("NaN", "Infinity", "-Infinity"):
                with self.subTest(constant=constant):
                    path.write_text(json.dumps(small_story())[:-1] + ', "extra":' + constant + '}', encoding="utf-8")
                    with self.assertRaisesRegex(StoryError, "JSON number"):
                        load_story(path)
            data = small_story()
            data["intro"] = "\ud800"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(StoryError, "intro.*Unicode"):
                load_story(path)
