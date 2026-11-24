import json
import unittest
from unittest.mock import patch

from desk.game import Game
from desk.storage import MAX_SAVE_BYTES, SaveError, load_game, save_game
from tests.support import moves, scratch_dir


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.path = self.enterContext(scratch_dir()) / "week.json"

    def test_round_trip_preserves_contracts_checks_rejected_citations_and_journal(self):
        game = Game(7)
        for cmd in ("take 1", "take 3", "check 3 terms", "report 3 terms",
                    "check 3 funds", "report 3 funds", "work 1", "end", "check 1 terms"):
            game.act(cmd)
        self.assertEqual(game.clock, 4)
        self.assertEqual(game.active[1].remaining, 1)
        self.assertEqual(game.reports, 1)
        save_game(game, self.path)
        restored = load_game(self.path)
        self.assertEqual(vars(restored), vars(game))
        for cmd in ("take 6", "work 1", "work 6", "polish 6", "end"):
            self.assertEqual(game.act(cmd), restored.act(cmd))
        self.assertEqual(vars(restored), vars(game))

    def test_new_and_finished_campaigns_round_trip(self):
        game = Game(0)
        save_game(game, self.path)
        self.assertEqual(vars(load_game(self.path)), vars(game))
        for _ in range(5):
            game.act("end")
        save_game(game, self.path)
        finished = load_game(self.path)
        self.assertTrue(finished.complete)
        self.assertEqual(vars(finished), vars(game))

    def test_replay_across_a_hold_return_offer_and_failed_then_paid_invoice_claim(self):
        game = Game(42)
        stages = (
            ("hold 2", "take 3", "work 3", "polish 3"),  # Return in tomorrow's mail.
            ("end",),                                    # Held and return notices together.
            ("take 18", "reuse 18", "polish 18", "check 6 terms", "check 6 funds", "take 6"),
            ("work 6", "work 6"),                         # Unpaid at the day's close.
            ("claim 6 terms",),
            ("claim 6 funds", "end", "end", "end"),
        )
        for stage in stages:
            with self.subTest(stage=stage):
                save_game(game, self.path)
                resumed = load_game(self.path)
                self.assertEqual(vars(resumed), vars(game))
                self.assertEqual(moves(resumed, *stage), moves(game, *stage))
                self.assertEqual(vars(resumed), vars(game))
        self.assertTrue(game.complete)
        self.assertEqual((game.paid_claim.amount, game.reports, game.cash), (150, 1, 660))
        save_game(game, self.path)
        self.assertEqual(vars(load_game(self.path)), vars(game))

    def test_replay_restores_audit_amendment_and_template_before_and_after_use(self):
        game = Game(42)
        moves(game, "take 3", "work 3", "polish 3", "end", "take 4", "extend 4", "audit 6")
        save_game(game, self.path)
        restored = load_game(self.path)
        self.assertEqual(vars(restored), vars(game))
        self.assertEqual((restored.active[4].due, restored.active[4].fee), (9, 410))
        self.assertEqual(restored.templates["Design"].number, 3)
        self.assertTrue({(6, "funds"), (6, "terms")} <= restored.checked)
        for cmd in ("reuse 4", "report 6 funds", "work 4", "polish 4"):
            self.assertEqual(game.act(cmd), restored.act(cmd))
        self.assertEqual(restored.templates["Design"].number, 4)
        save_game(restored, self.path)
        self.assertEqual(vars(load_game(self.path)), vars(game))

    def test_existing_version_one_history_keeps_its_clock_cash_and_reviews(self):
        history = ["take 3", "work 3", "polish 3", "take 2", "work 2", "work 2", "deliver 2"]
        self.path.write_text(json.dumps({"version": 1, "seed": 42, "moves": history}), encoding="utf-8")
        game = load_game(self.path)
        self.assertEqual((game.clock, game.cash, game.rating), (4, 550, 4.5))
        self.assertEqual(game.moves, history)
        self.assertEqual(game.templates["Design"].number, 3)

    def test_save_replaces_previous_slot_and_only_records_state_changing_moves(self):
        game = Game(42)
        game.act("check 1 funds")
        game.act("CHECK 01 FUNDS")
        save_game(game, self.path)
        data = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(data, {"version": 1, "seed": 42, "moves": ["check 1 funds"]})
        save_game(Game(17), self.path)
        self.assertEqual(load_game(self.path).seed, 17)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_failed_replace_keeps_previous_save_intact_and_cleans_up_temp_file(self):
        game = Game(5)
        save_game(game, self.path)
        old_save = self.path.read_bytes()
        game.act("end")
        with patch("desk.storage.os.replace", side_effect=PermissionError("slot in use")):
            with self.assertRaisesRegex(SaveError, "Could not write"):
                save_game(game, self.path)
        self.assertEqual(self.path.read_bytes(), old_save)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])
        self.assertEqual(load_game(self.path).clock, 0)

    def test_missing_and_inaccessible_files_have_readable_errors(self):
        with self.assertRaisesRegex(SaveError, "No saved week"):
            load_game(self.path)
        with self.assertRaisesRegex(SaveError, "Could not read"):
            load_game(self.path.parent)
        with self.assertRaisesRegex(SaveError, "Could not write"):
            save_game(Game(42), self.path / "missing-parent.json")

    def test_invalid_json_encoding_oversized_file_and_unsupported_version(self):
        for raw, message in ((b"{", "damaged"), (b"\xff", "damaged"),
                             (b" " * 65_538, "damaged"), (b'{"version":2}', "unsupported")):
            with self.subTest(prefix=raw[:20]):
                self.path.write_bytes(raw)
                with self.assertRaisesRegex(SaveError, message):
                    load_game(self.path)
                self.assertEqual(self.path.read_bytes(), raw)

    def test_limit_applies_to_disk_bytes_even_with_windows_newlines(self):
        header = b'{"version":1,"seed":0,"moves":[]}'
        space = MAX_SAVE_BYTES - len(header)
        data = header + b"\r\n" * (space // 2) + b" " * (space % 2)
        self.path.write_bytes(data)
        self.assertEqual(load_game(self.path).seed, 0)
        self.path.write_bytes(data + b"\n")
        with self.assertRaisesRegex(SaveError, "damaged"):
            load_game(self.path)

    def test_rejects_malformed_metadata_and_impossible_command_histories(self):
        bad_states = [
            [], {}, {"version": True}, {"version": "1"}, {"version": 1, "seed": 7},
            {"version": 1, "seed": True, "moves": []},
            {"version": 1, "seed": -1, "moves": []},
            {"version": 1, "seed": 7, "moves": "end"},
        ]
        for commands in ([3], ["?"], ["work 1"], ["end"] * 6, ["end"] * 129,
                         ["x" * 65], ["check 1 funds", "check 01 funds"], ["portfolio"],
                         ["plan 1"], ["take 1", "reuse 1"], ["take 1", "extend 1", "extend 1"],
                         ["audit 1", "audit 1"], ["inbox"], ["take 16"], ["claim 1 funds"],
                         ["end", "end", "end", "end", "hold 13"]):
            bad_states.append({"version": 1, "seed": 7, "moves": commands})
        for state in bad_states:
            with self.subTest(state=state):
                self.path.write_text(json.dumps(state), encoding="utf-8")
                with self.assertRaisesRegex(SaveError, "damaged"):
                    load_game(self.path)
