from contextlib import nullcontext, redirect_stdout
from io import StringIO
from itertools import product
import random
import unittest
from unittest.mock import patch

from gutterlight.__main__ import main
from gutterlight.battle import Mode, Setup
from gutterlight.cards import CARDS, resolve_deck
from gutterlight.draft import draft_decks, draft_offers, draft_sheet
from gutterlight.pilot import simulate
from gutterlight.recording import document, load, reconstruct
from gutterlight.sessions import pick_draft
from tests.support import TimedConsole, cli, tape_folder


class PairDraftTests(unittest.TestCase):
    def test_seeded_offers_cover_the_catalog_once_and_keep_comparable_roles_together(self):
        before = random.getstate()
        for seed in (0, 1, 27, 2**32 - 1):
            with self.subTest(seed=seed):
                offers = draft_offers(seed)
                self.assertEqual(draft_offers(seed), offers)
                self.assertEqual(len(offers), 8)
                self.assertCountEqual([key for pair in offers for key in pair], list(CARDS))
                self.assertIn({"squall", "patch"}, [set(pair) for pair in offers])
                self.assertIn({"rivet", "awl"}, [set(pair) for pair in offers])
        self.assertNotEqual(draft_offers(0), draft_offers(1))
        self.assertEqual(random.getstate(), before)
        for seed in (-1, 2**32, True, "27"):
            with self.subTest(seed=seed), self.assertRaisesRegex(ValueError, "Seed"):
                draft_offers(seed)

    def test_every_pick_code_builds_two_disjoint_playable_eight_card_decks(self):
        offers = draft_offers(27)
        for digits in product("12", repeat=8):
            picks = "".join(digits)
            amber, indigo = draft_decks(offers, picks)
            self.assertEqual(amber, tuple(pair[int(d) - 1] for d, pair in zip(picks, offers)))
            self.assertEqual(indigo, tuple(pair[2 - int(d)] for d, pair in zip(picks, offers)))
            self.assertTrue(set(amber).isdisjoint(indigo))
            for deck in (amber, indigo):
                self.assertEqual(resolve_deck(",".join(deck)), deck)
                self.assertEqual(sum(CARDS[key].troop is not None for key in deck), 7)

    def test_sheet_and_picker_use_the_same_pairs_and_invalid_keys_do_not_spend_a_pick(self):
        offers = draft_offers(27)
        picks = "12121212"
        terminal = TimedConsole(enumerate(("x", "right", *picks)))
        self.assertEqual(pick_draft(27, offers, terminal), picks)
        self.assertEqual(len(terminal.screens), 8)
        sheet = draft_sheet(27, offers)
        for i, (pair, (_, screen)) in enumerate(zip(offers, terminal.screens), 1):
            self.assertIn(f"Pair {i}/8", screen)
            self.assertLessEqual(max(map(len, screen.splitlines())), 80)
            if i == 2:
                first, other = offers[0]
                self.assertIn(f"Amber deck   {CARDS[first].name}", screen)
                self.assertIn(f"Indigo deck   {CARDS[other].name}", screen)
            for index, key in enumerate(pair, 1):
                card = CARDS[key]
                self.assertIn(f"[{index}] {card.name}", screen)
                self.assertIn(card.description, screen)
                self.assertIn(f"{card.name} ({card.cost})", sheet)

    def test_invalid_draft_codes_and_seeds_fail_before_saving(self):
        for picks in ("", "12", "1" * 9, "11220112", "1 212121", "１１１１１１１１", None):
            with self.subTest(picks=picks), self.assertRaisesRegex(ValueError, "eight picks"):
                draft_decks(draft_offers(27), picks)
        with tape_folder() as folder:
            path = folder / "existing.json"
            path.write_bytes(b"earlier match")
            for cmd, message in (
                (("simulate", "--draft", "12121213"), "eight picks"),
                (("simulate", "--draft", "12121212", "--deck", "awning"), "both decks"),
                (("simulate", "--draft", "12121212", "--opponent-deck", "awning"), "both decks"),
                (("play", "--draft"), "interactive terminal"),
                (("simulate", "--draft", "12121212", "--seed", "-1"), "Seed"),
            ):
                with self.subTest(cmd=cmd):
                    refused = cli(*cmd, "--save", path)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn(message, refused.stderr)
                    self.assertNotIn("Traceback", refused.stderr)
            self.assertEqual(path.read_bytes(), b"earlier match")

    def test_preview_codes_run_the_same_seeded_match_with_copiable_deck_lists(self):
        picks = "12121212"
        preview = cli("draft", "--seed", 27)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertEqual(preview.stdout.rstrip(), draft_sheet(27, draft_offers(27)))
        receipt = cli("draft", "--seed", 27, "--picks", picks)
        self.assertEqual(receipt.returncode, 0, receipt.stderr)
        amber, indigo = draft_decks(draft_offers(27), picks)
        self.assertIn(",".join(amber), receipt.stdout)
        self.assertIn(",".join(indigo), receipt.stdout)
        with tape_folder() as folder:
            path = folder / "pair night.json"
            match = cli("simulate", "--seed", 27, "--draft", picks, "--mode", "convoy", "--save", path)
            self.assertEqual(match.returncode, 0, match.stderr)
            self.assertIn(receipt.stdout, match.stdout)
            expected = simulate(Setup.deal(27, amber=amber, indigo=indigo, mode=Mode.CONVOY))
            self.assertEqual(load(path), reconstruct(document(expected)))

    def test_live_draft_can_cancel_before_or_leave_after_the_opening_deal(self):
        picks = "22111122"
        with tape_folder() as folder:
            path = folder / "match.json"
            path.write_bytes(b"earlier match")
            args = ["play", "--seed", "27", "--draft", "--save", str(path)]
            with patch("gutterlight.__main__.interactive", return_value=True), redirect_stdout(StringIO()):
                cancelled = TimedConsole([(0, "1"), (0, "q")])
                with patch("gutterlight.__main__.Terminal", return_value=nullcontext(cancelled)):
                    self.assertEqual(main(args), 0)
                self.assertEqual(path.read_bytes(), b"earlier match")
                draft = TimedConsole(enumerate(picks))
                live = TimedConsole([(0, "q")])
                with patch("gutterlight.__main__.Terminal",
                           side_effect=[nullcontext(draft), nullcontext(live)]):
                    self.assertEqual(main(args), 0)
            tape = load(path)
            self.assertEqual(tape.end, 0)
            amber, indigo = draft_decks(draft_offers(27), picks)
            self.assertEqual(tape.setup, Setup.deal(27, amber=amber, indigo=indigo))
            self.assertIn("Beat 0/180", live.screens[0][1])
