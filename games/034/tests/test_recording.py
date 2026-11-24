from copy import deepcopy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import UUID

from gutterlight.battle import Battle, Lane, MAX_TICKS, Move, Setup, Side
from gutterlight.cards import CARDS
from gutterlight.pilot import Pilot
from gutterlight.recording import (
    MAX_FILE_BYTES, ReplayError, document, load, reconstruct, save,
)
from tests.support import arranged, tape_folder


def short_game() -> Battle:
    game = arranged(limit=5)
    game.step(Move(0, Lane.ROOF), Move(1, Lane.CANAL))
    game.step()
    game.step(Move(2, Lane.CANAL))
    return game


class ReproductionTests(unittest.TestCase):
    def test_full_match_reconstructs_every_frame_and_event_without_pilots(self):
        game = Battle(Setup.deal(15))
        pilots = [Pilot(game.setup.seed, side) for side in Side]
        frames = [game.frame()]
        while game.outcome is None:
            game.step(*(p.choose(game) for p in pilots))
            frames.append(game.frame())
        with patch.object(Pilot, "choose", side_effect=AssertionError("Replay ran the AI")):
            tape = reconstruct(document(game))
        self.assertEqual(tape.frames, tuple(frames))
        self.assertEqual(tape.events, tuple(game.events))
        self.assertEqual(tape.end, game.tick)

    def test_partial_and_empty_matches_round_trip(self):
        for game in (arranged(), short_game()):
            with self.subTest(tick=game.tick):
                replay = reconstruct(document(game))
                self.assertEqual(replay.frames[-1], game.frame())
                self.assertEqual(replay.end, game.tick)
                self.assertIsNone(replay.frames[-1].outcome)

    def test_saves_are_portable_json_with_one_based_slots_and_explicit_deals(self):
        game = short_game()
        with tape_folder() as folder:
            path = Path(folder, "night shift.json")
            save(game, path)
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["opening"], [list(d) for d in game.setup.opening])
            self.assertEqual(stored["plays"][0],
                             {"tick": 1, "side": "amber", "slot": 1, "lane": "roof"})
            self.assertEqual(load(path).frames[-1], game.frame())
            game.step()
            save(game, path)
            self.assertEqual(load(path).end, 4)
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_failed_save_preserves_existing_tape_and_removes_temporary_file(self):
        with tape_folder() as folder:
            path = Path(folder, "last.json")
            save(arranged(), path)
            original = path.read_bytes()
            with patch("gutterlight.recording.os.replace", side_effect=OSError("busy")):
                with self.assertRaisesRegex(OSError, "busy"):
                    save(short_game(), path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_interrupted_write_leaves_the_previous_recording_intact(self):
        def interrupted_dump(tape, stream, **kwargs):
            stream.write('{"format":')
            raise OSError("write interrupted")

        with tape_folder() as folder:
            path = folder / "last.json"
            save(short_game(), path)
            expected = load(path)
            with patch("gutterlight.recording.json.dump", side_effect=interrupted_dump):
                with self.assertRaisesRegex(OSError, "write interrupted"):
                    save(arranged(), path)
            self.assertEqual(load(path), expected)
            self.assertEqual(list(folder.iterdir()), [path])

    def test_concurrent_temporary_name_collision_leaves_the_other_writer_alone(self):
        with tape_folder() as folder:
            identifier = UUID(int=0)
            other = folder / f".relay-{identifier.hex}.tmp"
            other.write_bytes(b"another writer")
            with patch("gutterlight.recording.uuid4", return_value=identifier):
                with self.assertRaises(FileExistsError):
                    save(arranged(), folder / "last.json")
            self.assertEqual(other.read_bytes(), b"another writer")
            self.assertEqual(list(folder.iterdir()), [other])


class ReplayValidationTests(unittest.TestCase):
    def test_rejects_wrong_header_types_ranges_and_missing_fields(self):
        good = document(short_game())
        for field, value in (("format", "other"), ("version", True), ("version", 99),
                             ("seed", -1), ("seed", 2**32), ("seed", 1.0),
                             ("limit_ticks", 0), ("limit_ticks", MAX_TICKS + 1),
                             ("end_tick", False), ("end_tick", -1), ("end_tick", 6),
                             ("state_sha256", None), ("state_sha256", "0" * 63),
                             ("state_sha256", "Z" * 64), ("plays", None)):
            with self.subTest(field=field, value=value), self.assertRaises(ReplayError):
                reconstruct({**good, field: value})
        for field in good:
            with self.subTest(missing=field), self.assertRaises(ReplayError):
                reconstruct({k: v for k, v in good.items() if k != field})
        for obj in (None, [], "relay"):
            with self.subTest(obj=obj), self.assertRaises(ReplayError):
                reconstruct(obj)

    def test_invalid_deck_shapes_keys_and_uniqueness(self):
        good = document(short_game())
        amber, indigo = good["opening"]
        for opening in (None, [], [amber], [None, indigo], ["wick", indigo],
                        [[3] + amber[1:], indigo], [["noise"] + amber[1:], indigo],
                        [amber[:-1], indigo], [[amber[1]] + amber[1:], indigo]):
            with self.subTest(opening=opening), self.assertRaises(ReplayError):
                reconstruct({**good, "opening": opening})

    def test_invalid_play_fields_and_play_order(self):
        good = document(short_game())
        first, second, third = good["plays"]
        for field, value in (("side", []), ("side", "jade"), ("lane", 0), ("lane", "dock"),
                             ("slot", 0), ("slot", 5), ("slot", True),
                             ("tick", 4), ("tick", 0), ("tick", 1.5)):
            with self.subTest(field=field, value=value), self.assertRaises(ReplayError):
                reconstruct({**good, "plays": [{**first, field: value}, second, third]})
        for plays, message in (([first, first], "Duplicate"), ([third, first], "tick order"),
                               ([None], "object"), ([first] * 7, "play list")):
            with self.subTest(message=message), self.assertRaisesRegex(ReplayError, message):
                reconstruct({**good, "plays": plays})

    def test_illegal_orders_are_rejected_at_their_recorded_tick(self):
        game = arranged(amber=("patch",))
        game.step()
        tape = document(game)
        tape["plays"] = [{"tick": 1, "side": "amber", "slot": 1, "lane": "canal"}]
        with self.assertRaisesRegex(ReplayError, "Invalid tick 1.*full hull"):
            reconstruct(tape)

    def test_altered_but_legal_schedule_seed_and_hash_are_detected(self):
        good = document(short_game())
        changed = deepcopy(good)
        changed["plays"][0]["lane"] = "canal"
        for tape in (changed, {**good, "seed": 29}, {**good, "state_sha256": "0" * 64}):
            with self.subTest(tape=tape), self.assertRaisesRegex(ReplayError, "fingerprint mismatch"):
                reconstruct(tape)

    def test_recording_cannot_continue_past_a_tower_fall(self):
        game = arranged(limit=MAX_TICKS)
        while game.outcome is None:
            move = None
            for slot, key in enumerate(game.players[Side.AMBER].hand):
                candidate = Move(slot, Lane.ROOF)
                if CARDS[key].troop and not game.problem(Side.AMBER, candidate):
                    move = candidate
                    break
            game.step(move)
        self.assertEqual(game.outcome.reason, "tower")
        tape = document(game)
        self.assertEqual(reconstruct(tape).frames[-1], game.frame())
        tape["end_tick"] += 1
        with self.assertRaisesRegex(ReplayError, "match has finished"):
            reconstruct(tape)

    def test_file_reader_limits_size_and_reports_invalid_encoding_and_json(self):
        with tape_folder() as folder:
            path = Path(folder, "invalid.json")
            for data, message in ((b"x" * (MAX_FILE_BYTES + 1), "512 KiB"),
                                  (b"\xff", "UTF-8 JSON"), (b"{", "UTF-8 JSON"),
                                  (b"[" * 2000 + b"]" * 2000, "UTF-8 JSON")):
                with self.subTest(message=message):
                    path.write_bytes(data)
                    with self.assertRaisesRegex(ReplayError, message):
                        load(path)
