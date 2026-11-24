import json
import unittest
from pathlib import Path
from unittest.mock import patch

from engine import Game
from saves import SaveError, load_game, save_game
from story import load_story, parse_story
from tests.support import SAMPLE, batch_story, small_story, work_directory


class SaveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story = load_story(SAMPLE)

    def setUp(self):
        self.path = self.enterContext(work_directory()) / "slot.json"
        self.game = Game(self.story)

    def write_slot(self, data):
        self.path.write_text(json.dumps(data), encoding="utf-8")

    def assert_same_game(self, original, restored):
        self.assertEqual(restored.room.id, original.room.id)
        self.assertEqual(restored.events, original.events)
        self.assertEqual(restored.journal, original.journal)
        self.assertEqual(restored.flags, original.flags)
        self.assertEqual(restored.inventory, original.inventory)
        self.assertEqual(restored.day, original.day)
        self.assertEqual(restored.spent, original.spent)
        self.assertEqual(restored.balance, original.balance)
        self.assertEqual(restored.expired, original.expired)
        self.assertEqual(restored.ending, original.ending)
        self.assertEqual(restored.pending, original.pending)
        for room in original.story.rooms.values():
            self.assertEqual(restored.route(room.id), original.route(room.id))
            for job in room.batches.values():
                self.assertEqual(restored.block_reason(job), original.block_reason(job))
        for action in original.room.actions.values():
            self.assertEqual(restored.block_reason(action), original.block_reason(action))
        for person in original.room.people.values():
            for topic in person.topics.values():
                self.assertEqual(restored.block_reason(topic, person), original.block_reason(topic, person))

    def test_round_trip_preserves_location_budget_choices_waits_and_journal(self):
        self.game.work("walk")
        self.game.move("desk")
        self.game.work("fold")
        self.game.wait()
        save_game(self.game, self.path)
        restored = load_game(self.story, self.path)
        self.assert_same_game(self.game, restored)
        for game in (self.game, restored):
            game.move("station")
            game.work("post")
            while not game.finished:
                game.wait()
        self.assert_same_game(self.game, restored)
        save_game(restored, self.path)
        self.assert_same_game(restored, load_game(self.story, self.path))

    def test_save_and_resave_even_before_any_work(self):
        save_game(self.game, self.path)
        self.assert_same_game(self.game, load_game(self.story, self.path))
        self.game.move("press")
        save_game(self.game, self.path)
        self.assert_same_game(self.game, load_game(self.story, self.path))
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_failed_replacement_keeps_previous_slot_and_cleans_temporary_file(self):
        save_game(self.game, self.path)
        old_slot = self.path.read_bytes()
        self.game.work("walk")
        with patch.object(Path, "replace", side_effect=OSError("file is busy")):
            with self.assertRaisesRegex(SaveError, "file is busy"):
                save_game(self.game, self.path)
        self.assertEqual(self.path.read_bytes(), old_slot)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_partial_write_never_replaces_previous_save(self):
        save_game(self.game, self.path)
        old_slot = self.path.read_bytes()

        def interrupted_write(data, output, **kwargs):
            output.write('{"version":')
            raise OSError("write interrupted")

        with patch("saves.json.dump", side_effect=interrupted_write):
            with self.assertRaisesRegex(SaveError, "write interrupted"):
                save_game(self.game, self.path)
        self.assertEqual(self.path.read_bytes(), old_slot)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_missing_unreadable_or_unwritable_slot(self):
        with self.assertRaisesRegex(SaveError, "No save exists"):
            load_game(self.story, self.path)
        self.path.write_bytes(b"\xff")
        with self.assertRaisesRegex(SaveError, "Could not read"):
            load_game(self.story, self.path)
        self.path.write_text('{"truncated"', encoding="utf-8")
        with self.assertRaisesRegex(SaveError, "Could not read"):
            load_game(self.story, self.path)
        with self.assertRaisesRegex(SaveError, "Could not save"):
            save_game(self.game, self.path.parent / "absent" / "slot.json")

    def test_ambiguous_or_deep_json_is_reported_as_a_save_error(self):
        self.game.work("walk")
        save_game(self.game, self.path)
        content = self.path.read_text(encoding="utf-8").rstrip()
        self.path.write_text(content[:-1] + ',"events":[]}', encoding="utf-8")
        with self.assertRaisesRegex(SaveError, "Duplicate JSON key 'events'"):
            load_game(self.story, self.path)
        self.path.write_text("[" * 2000 + "]" * 2000, encoding="utf-8")
        with self.assertRaisesRegex(SaveError, "Could not read"):
            load_game(self.story, self.path)
        self.path.write_text(content[:-1] + ',"extra":NaN}', encoding="utf-8")
        with self.assertRaisesRegex(SaveError, "JSON number"):
            load_game(self.story, self.path)
        self.path.write_text(content, encoding="utf-8-sig")
        self.assert_same_game(self.game, load_game(self.story, self.path))

    def test_round_one_sample_slot_replays_and_resaves_under_the_new_edition(self):
        self.game.work("walk")
        self.game.move("desk")
        self.game.work("fold")
        old = {
            "version": 1, "story": "eleventh-morning",
            "fingerprint": "f9d5d01be90cf27153ee3f4372324223c52b635c9acb956bb0d5ba64932a3cc1",
            "events": [["do", "walk"], ["go", "desk"], ["do", "fold"]],
        }
        self.write_slot(old)
        restored = load_game(self.story, self.path)
        self.assert_same_game(self.game, restored)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), old)
        edited = json.loads(SAMPLE.read_text(encoding="utf-8"))
        edited["budget"] += 1
        with self.assertRaisesRegex(SaveError, "different adventure or edition"):
            load_game(parse_story(edited), self.path)
        save_game(restored, self.path)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["fingerprint"], self.story.fingerprint)

    def test_save_during_a_tape_exchange_and_after_a_booking(self):
        game = self.game
        game.move("desk")
        game.move("booth")
        game.talk("wai", "tape")
        save_game(game, self.path)
        self.assert_same_game(game, load_game(self.story, self.path))
        game.move("press")
        game.work("listen")
        game.talk("bo", "ticket")
        game.move("booth")
        game.wait()
        game.wait()
        save_game(game, self.path)
        resumed = load_game(self.story, self.path)
        self.assert_same_game(game, resumed)
        for session in (game, resumed):
            session.work("air-ticket")
            while not session.finished:
                session.wait()
        self.assert_same_game(game, resumed)
        save_game(resumed, self.path)
        self.assert_same_game(resumed, load_game(self.story, self.path))

    def test_round_two_slot_preserves_the_tape_booking_and_upgrades_only_on_save(self):
        game = self.game
        for event in (("go", "press"), ("do", "listen"), ("go", "booth"), ("talk", "wai", "tape"),
                      ("go", "press"), ("talk", "bo", "ticket"), ("go", "booth"), ("wait",), ("wait",),
                      ("do", "air-ticket")):
            game.apply(event)
        previous = "105b56f9e632e272fb167b669d71dec8f17c1206fec4706cb4f85f1dcfe2fd2e"
        self.write_slot({"version": 1, "story": self.story.id, "fingerprint": previous, "events": game.events})
        old_contents = self.path.read_bytes()
        restored = load_game(self.story, self.path)
        self.assert_same_game(game, restored)
        self.assertEqual(self.path.read_bytes(), old_contents)
        edited = json.loads(SAMPLE.read_text(encoding="utf-8"))
        edited["rooms"]["desk"]["batches"]["proof"]["cost"] += 1
        with self.assertRaisesRegex(SaveError, "different adventure or edition"):
            load_game(parse_story(edited), self.path)
        save_game(restored, self.path)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["fingerprint"], self.story.fingerprint)

    def test_replay_between_submission_and_delivery_pays_and_awards_once(self):
        story = parse_story(batch_story())
        game = Game(story)
        game.talk("clerk", "pass")
        game.queue("run")
        game.wait()
        save_game(game, self.path)
        resumed = load_game(story, self.path)
        self.assert_same_game(game, resumed)
        self.assertEqual((resumed.pending.due_day, resumed.balance), (2, 6))
        for session in (game, resumed):
            session.wait()
            session.move("loft")
            session.queue("spare")
            session.wait()
        self.assert_same_game(game, resumed)
        save_game(resumed, self.path)
        self.assert_same_game(game, load_game(story, self.path))
        self.assertEqual((resumed.inventory, resumed.spent), ({"paper": 2, "proof": 2}, 4))
        stored = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(stored["events"], [
            ["talk", "clerk", "pass"], ["queue", "run"], ["wait"], ["wait"],
            ["go", "loft"], ["queue", "spare"], ["wait"],
        ])

    def test_invalid_batch_gate_and_preview_moves_cannot_be_replayed(self):
        story = parse_story(batch_story())
        submit = [["talk", "clerk", "pass"], ["queue", "run"]]
        for events, error in [
            ([["queue"]], "move 1.*Unrecognized"), ([["queue", 1]], "move 1.*Unrecognized"),
            ([["queue", "spare"]], "move 1.*no batch"), ([["queue", "run"]], "move 1.*Needs"),
            (submit + [["queue", "run"]], "move 3.*Already submitted"),
            (submit + [["go", "loft"]], "move 3.*needs a printed proof"),
            (submit + [["deliver", "run"]], "move 3.*Unrecognized"),
            ([["plan", "wait"]], "move 1.*Unrecognized"),
            ([["wait"]] * 4 + [["queue", "run"]], "move 5.*deadline"),
        ]:
            with self.subTest(events=events):
                self.write_slot({"version": 1, "story": story.id, "fingerprint": story.fingerprint,
                                 "events": events})
                with self.assertRaisesRegex(SaveError, error):
                    load_game(story, self.path)

    def test_rejects_incompatible_format_or_story_edition(self):
        save_game(self.game, self.path)
        valid = json.loads(self.path.read_text(encoding="utf-8"))
        for changes in ({"version": True}, {"version": 2}, {"version": "1"}, {"version": None}):
            with self.subTest(changes=changes):
                self.write_slot(valid | changes)
                with self.assertRaisesRegex(SaveError, "format"):
                    load_game(self.story, self.path)
        for other_data in (None, [], {}):
            with self.subTest(other_data=other_data):
                self.write_slot(other_data)
                with self.assertRaisesRegex(SaveError, "format"):
                    load_game(self.story, self.path)
        for changes in ({"story": "elsewhere"}, {"fingerprint": "old-edition"}):
            with self.subTest(changes=changes):
                self.write_slot(valid | changes)
                with self.assertRaisesRegex(SaveError, "different adventure or edition"):
                    load_game(self.story, self.path)
        self.write_slot(valid)
        with self.assertRaisesRegex(SaveError, "different adventure or edition"):
            load_game(parse_story(small_story()), self.path)

    def test_replay_rejects_unknown_malformed_illegal_and_post_deadline_moves(self):
        save_game(self.game, self.path)
        valid = json.loads(self.path.read_text(encoding="utf-8"))
        for events, message in [
            (None, "list of moves"),
            (["wait"], "Unrecognized move"),
            ([["wait", "twice"]], "Unrecognized move"),
            ([["go", 1]], "Unrecognized move"),
            ([["mint", "999"]], "Unrecognized move"),
            ([["go", "common"]], "no exit"),
            ([["do", "post"]], "Needs"),
            ([["do", "walk"], ["do", "walk"]], "move 2"),
            ([["wait"]] * 11, "move 11"),
            ([["talk", "yan"]], "Unrecognized move"),
            ([["talk", "yan", 1]], "Unrecognized move"),
            ([["talk", "wai", "tape"]], "No one called"),
            ([["talk", "yan", "crossing"]], "Needs Yan"),
            ([["do", "walk"], ["talk", "yan", "crossing"]], "blank loop tape"),
            ([["go", "desk"], ["go", "booth"], ["talk", "wai", "tape"], ["talk", "wai", "tape"]],
             "Invalid move 4.*Already discussed"),
            ([["go", "press"], ["go", "booth"], ["do", "air-turn"]], "Opens on day 4"),
            ([["wait"]] * 7 + [["go", "desk"], ["go", "booth"], ["do", "air-turn"]], "Last start"),
            ([["wait"]] * 10 + [["talk", "yan", "button"]], "deadline"),
        ]:
            with self.subTest(events=events):
                self.write_slot(valid | {"events": events})
                with self.assertRaisesRegex(SaveError, message):
                    load_game(self.story, self.path)
