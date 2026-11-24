import random
import unittest

from desk.game import (
    BLOCKS_PER_DAY, DAILY_CHECKS, DAYS, MAX_SEED, REFERRAL, WEEK,
    Game, clock_label, due_label, make_week,
)
from tests.support import DeskCase, desk_with, gig, moves


class GenerationTests(unittest.TestCase):
    def test_seed_reproduces_board_without_changing_global_randomness(self):
        old_state = random.getstate()
        self.assertEqual(make_week(71), make_week(71))
        self.assertNotEqual(make_week(71), make_week(72))
        self.assertEqual(random.getstate(), old_state)

    def test_seed_domain_and_edges(self):
        for seed in (-1, MAX_SEED + 1, None, True, 1.5, "42"):
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                Game(seed)
        for seed in (0, MAX_SEED):
            with self.subTest(seed=seed):
                self.assertEqual(Game(seed).seed, seed)

    def test_generated_boards_have_variety_real_clients_and_feasible_deadlines(self):
        for seed in range(128):
            with self.subTest(seed=seed):
                week = make_week(seed)
                self.assertEqual(len(week), len(DAYS))
                all_gigs = [item for day in week for item in day]
                self.assertEqual([g.number for g in all_gigs], list(range(1, 16)))
                self.assertEqual(len({g.brief.title for g in all_gigs}), 15)
                self.assertEqual(len({g.client for g in all_gigs}), 15)
                self.assertTrue(any(g.trail.breach for g in all_gigs))
                for day, board in enumerate(week):
                    self.assertEqual(sorted(g.brief.blocks for g in board), [1, 2, 3])
                    self.assertTrue(any(not g.trail.breach for g in board))
                    for item in board:
                        self.assertLessEqual(day * BLOCKS_PER_DAY + item.brief.blocks, item.due)
                        self.assertLessEqual(item.due, WEEK)
                        self.assertGreater(item.fee, 0)

    def test_deadline_and_opening_labels_at_day_and_week_boundaries(self):
        self.assertEqual(clock_label(0), "Mon 09:00")
        self.assertEqual(due_label(1), "Mon 11:00")
        self.assertEqual(due_label(4), "Mon 17:00")
        self.assertEqual(clock_label(4), "Tue 09:00")
        self.assertEqual(due_label(5), "Tue 11:00")
        self.assertEqual(clock_label(20), due_label(20))
        self.assertEqual(due_label(20), "Fri 17:00")


class DeskRulesTests(DeskCase):
    def test_initial_state_has_two_slots_no_reviews_and_three_live_notices(self):
        game = Game(7)
        self.assertEqual(list(game.board), [1, 2, 3])
        self.assertEqual(game.clock, 0)
        self.assertEqual(game.active, {})
        self.assertEqual(game.cash, 0)
        self.assertIsNone(game.rating)
        self.assertEqual(game.targets, (False, False, False))
        self.assertEqual(game.checks_left, DAILY_CHECKS)

    def test_actions_reject_bad_syntax_ids_and_operating_on_unbooked_work(self):
        game = Game(1)
        cases = {"": "Unknown action", "delete 1": "Unknown action", "work": "Use work",
                 "take 1 2": "Use take", "wait 2": "Use wait", "end now": "Use end",
                 "take 00": "numeric gig ID", "take -1": "numeric gig ID",
                 "work 2.5": "numeric gig ID", "take 99": "closed or unavailable",
                 "check 1 result": "funds or terms", "work 1": "Take gig",
                 "polish 1": "Take gig", "deliver 1": "Take gig", "audit": "Use audit",
                 "audit 1 funds": "Use audit", "extend": "Use extend", "reuse 1 2": "Use reuse"}
        for command, reason in cases.items():
            with self.subTest(command=command):
                self.assert_rejected(game, command, reason)

    def test_booking_is_free_exclusive_and_limited_to_two_jobs(self):
        game = Game(42)
        moves(game, "  TaKe   01 ", "take 2")
        self.assertEqual(game.clock, 0)
        self.assertEqual(game.moves, ["take 1", "take 2"])
        self.assertEqual(set(game.active), {1, 2})
        self.assertEqual(set(game.board), {3})
        self.assert_rejected(game, "take 01", "already on your desk")
        self.assert_rejected(game, "take 03", "Both desk slots")

    def test_individually_impossible_booking_can_be_checked_until_its_cutoff(self):
        game = desk_with(gig(1, effort=2, due=2))
        game.act("wait")
        self.assert_rejected(game, "take 1", "Only 1 block")
        moves(game, "check 1 terms", "wait")
        self.assertNotIn(1, game.board)
        self.assertEqual(game.ledger, [])
        self.assert_rejected(game, "take 1", "closed or unavailable")

    def test_aggregate_schedule_clash_warns_about_the_earliest_bottleneck(self):
        game = desk_with(gig(1, effort=2, due=2), gig(2, effort=2, due=3))
        moves(game, "take 1")
        self.assertEqual(game.pressure(), "")
        expected = "4 blocks of work due by Mon 15:00, with 3 blocks available"
        self.assertIn(expected, game.pressure(game.board[2]))
        self.assertIn(expected, moves(game, "take 2"))
        moves(game, "work 1")
        self.assertIn("3 blocks of work", game.pressure())

    def test_working_a_draft_then_delivering_is_free_and_pays_exactly_once(self):
        game = desk_with(gig(1, effort=2, fee=410))
        moves(game, "take 1", "work 1")
        self.assert_rejected(game, "deliver 1", "draft needs 1 block")
        self.assert_rejected(game, "polish 1", "draft needs 1 block")
        self.assertIn("Draft ready", moves(game, "work 1"))
        self.assert_rejected(game, "work 1", "draft is ready")
        self.assertEqual(game.cash, 0)
        self.assertIn("Paid HK$410", moves(game, "deliver 1"))
        self.assertEqual(game.clock, 2)
        self.assertEqual((game.cash, game.rating, game.active), (410, 4, {}))
        self.assertEqual(game.ledger[0].kind, "Delivered")
        self.assert_rejected(game, "deliver 1", "closed or unavailable")

    def test_deadline_is_inclusive_for_last_work_block(self):
        game = desk_with(gig(1, effort=2, due=2))
        log = moves(game, "take 1", "work 1", "work 1")
        self.assertIn("Deadline handoff", log)
        self.assertEqual((game.cash, game.rating), (200, 4))
        self.assertEqual(len(game.ledger), 1)

    def test_polishing_on_the_last_block_earns_five_stars_before_auto_handoff(self):
        game = desk_with(gig(1, due=2))
        moves(game, "take 1", "work 1", "polish 1")
        self.assertEqual(game.clock, 2)
        self.assertEqual(game.rating, 5)
        self.assertEqual(len(game.ledger), 1)
        self.assertEqual(game.ledger[0].note, "Beautiful proof.")
        self.assertEqual(game.ledger[0].kind, "Polished")

    def test_ready_job_auto_delivers_while_working_on_a_second_one(self):
        game = desk_with(gig(1, due=2), gig(2, effort=2, due=4))
        moves(game, "take 1", "take 2", "work 1", "work 2")
        self.assertEqual(game.ledger[0].gig.number, 1)
        self.assertEqual(game.ledger[0].stars, 4)
        self.assertEqual(game.active[2].remaining, 1)
        self.assertEqual(game.clock, 2)

    def test_missed_deadline_releases_slot_and_only_genuine_clients_leave_a_review(self):
        for breach, stars in (("", 1), ("terms", None)):
            with self.subTest(breach=breach):
                game = desk_with(gig(1, effort=2, due=2, breach=breach))
                moves(game, "take 1", "work 1", "wait", "end")
                self.assertEqual(game.active, {})
                self.assertEqual(game.cash, 0)
                self.assertEqual(game.rating, stars)
                self.assertEqual([entry.kind for entry in game.ledger], ["Missed"])

    def test_standard_and_polished_deliveries_to_a_scam_both_go_unpaid(self):
        for verb, breach in (("deliver", "funds"), ("polish", "terms")):
            with self.subTest(verb=verb):
                game = desk_with(gig(1, due=3, fee=700, breach=breach))
                moves(game, "take 1", "work 1", f"{verb} 1")
                self.assertEqual(game.ledger[0].kind, "Unpaid")
                self.assertTrue(game.ledger[0].note)
                self.assertEqual(game.cash, 0)
                self.assertIsNone(game.rating)
                self.assertEqual(game.reports, 0)

    def test_unused_checks_do_not_bank_and_reading_a_filed_slip_remains_free(self):
        game = desk_with(gig(1, effort=2, due=6), gig(2, due=7))
        moves(game, "take 1", "check 1 terms", "check 2 funds")
        history = game.moves.copy()
        log = moves(game, "check 1 terms")
        self.assertIn(game.active[1].gig.trail.terms, log)
        self.assertEqual(game.moves, history)
        self.assertEqual(game.clock, 0)
        self.assert_rejected(game, "check 1 funds", "Both checks are used")
        moves(game, "work 1", "end")
        self.assertEqual(game.clock, 4)
        self.assertEqual(set(game.board), {4, 5, 6})
        self.assertEqual(game.active[1].remaining, 1)
        self.assert_rejected(game, "check 2 funds", "closed or unavailable")
        moves(game, "check 1 terms")
        self.assertEqual(game.checks_left, DAILY_CHECKS)
        moves(game, "check 1 funds", "work 1", "deliver 1", "end")
        self.assertEqual(game.checks_left, DAILY_CHECKS)
        self.assertEqual(game.cash, 200)

    def test_report_needs_a_checked_slip_and_pulls_the_job(self):
        game = desk_with(gig(1, breach="terms"))
        self.assert_rejected(game, "report 1 terms", "Read the slip first")
        moves(game, "check 1 terms")
        self.assert_rejected(game, "report 1 funds", "Read the slip first")
        log = moves(game, "report 1 terms")
        self.assertIn("Report confirmed", log)
        self.assertEqual((game.clock, game.cash, game.reports), (1, 0, 1))
        self.assertEqual(game.targets, (False, False, True))
        self.assertIsNone(game.rating)
        self.assertNotIn(1, game.board)
        self.assert_rejected(game, "report 1 terms", "closed or unavailable")

    def test_one_bad_citation_does_not_prevent_filing_with_the_correct_evidence(self):
        game = desk_with(gig(1, breach="terms"))
        moves(game, "check 1 terms", "check 1 funds")
        log = moves(game, "report 1 funds")
        self.assertIn("unsubstantiated", log)
        self.assertIn(1, game.board)
        self.assertEqual((game.clock, game.reports), (1, 0))
        self.assert_rejected(game, "report 1 funds", "already ruled")
        moves(game, "report 1 terms")
        self.assertEqual((game.clock, game.reports), (2, 1))

    def test_unsubstantiated_report_against_real_client_keeps_contract_playable(self):
        game = desk_with(gig(1, due=3))
        moves(game, "take 1", "check 1 funds", "report 1 funds")
        self.assertEqual(game.clock, 1)
        self.assertEqual(game.ledger, [])
        moves(game, "work 1", "polish 1")
        self.assertEqual((game.rating, game.reports, game.cash), (5, 0, 200))

    def test_reporting_active_scam_frees_slot_even_on_the_final_block(self):
        game = desk_with(gig(1, effort=2, due=2, breach="funds"))
        moves(game, "check 1 funds", "take 1", "work 1", "report 1 funds")
        self.assertEqual(game.clock, 2)
        self.assertEqual(game.active, {})
        self.assertEqual([entry.kind for entry in game.ledger], ["Reported"])
        self.assertIsNone(game.rating)

    def test_filing_uses_a_block_and_can_cost_another_contract_its_deadline(self):
        game = desk_with(gig(1, due=1), gig(2, due=2, breach="terms"))
        moves(game, "take 1", "check 2 terms", "report 2 terms")
        self.assertEqual(game.clock, 1)
        self.assertEqual([e.kind for e in game.ledger], ["Reported", "Missed"])
        self.assertEqual((game.rating, game.cash), (1, 0))

    def test_referral_at_exact_threshold_and_locked_fees_survive_both_rate_changes(self):
        game = desk_with(gig(1), gig(2), gig(3, due=5), gig(4, due=8), gig(5, due=8))
        moves(game, "take 1", "take 3", "work 1", "polish 1")
        self.assertEqual(game.rating, 5)
        self.assertEqual(game.referral, 0)
        moves(game, "take 2", "work 2", "deliver 2")
        self.assertEqual((game.rating, game.referral), (4.5, REFERRAL))
        self.assertEqual(game.quote(game.active[3].gig), 200)
        moves(game, "end")
        self.assertEqual(game.quote(game.board[4]), 200 + REFERRAL)
        moves(game, "take 4", "wait")  # Job 3 misses its Tuesday cutoff.
        self.assertEqual(game.referral, 0)
        self.assertEqual(game.quote(game.board[5]), 200)
        self.assertEqual(game.quote(game.active[4].gig), 200 + REFERRAL)
        moves(game, "work 4", "deliver 4")
        self.assertEqual(game.cash, 600 + REFERRAL)

    def test_friday_settles_two_ready_jobs_and_never_opens_a_sixth_day(self):
        game = desk_with(gig(13, effort=3, due=WEEK), gig(14, due=WEEK))
        moves(game, "end", "end", "end", "end")
        self.assertEqual(game.clock, 16)
        moves(game, "take 13", "take 14", "work 13", "work 13", "work 13", "work 14")
        self.assertTrue(game.complete)
        self.assertEqual((game.clock, game.cash), (WEEK, 400))
        self.assertEqual([e.gig.number for e in game.ledger], [13, 14])
        self.assertEqual((game.board, game.active), ({}, {}))
        self.assert_rejected(game, "end", "week has closed")

    def test_referral_announcements_use_the_rate_available_after_all_deadlines_settle(self):
        game = desk_with(gig(1), gig(2), gig(3))
        moves(game, "take 1", "work 1", "polish 1", "take 2", "take 3", "work 2")
        log = moves(game, "polish 2")
        self.assertEqual([e.stars for e in game.ledger], [5, 5, 1])
        self.assertEqual(game.referral, 0)
        self.assertNotIn("referral rate", log.lower())

        game = desk_with(gig(13, due=WEEK), gig(14, due=WEEK))
        moves(game, *["end"] * 4, "take 13", "work 13", "polish 13", "take 14", "work 14")
        log = moves(game, "polish 14")
        self.assertTrue(game.complete)
        self.assertEqual(game.rating, 5)
        self.assertNotIn("Open quotes", log)

    def test_passing_a_whole_week_leaves_unaccepted_jobs_out_of_the_journal(self):
        game = Game(42)
        moves(game, "end", "end", "end", "end", "end")
        self.assertTrue(game.complete)
        self.assertEqual(game.ledger, [])
        self.assertEqual(game.targets, (False, False, False))


class CampaignTests(unittest.TestCase):
    def test_mixed_playthroughs_keep_time_slots_cash_and_resolutions_consistent(self):
        for seed in range(64):
            with self.subTest(seed=seed):
                rng = random.Random(seed)
                game = Game(seed)
                while not game.complete:
                    if rng.randrange(4) == 0:
                        holdable = [g for g in game.board.values() if not game.hold_problem(g)]
                        if holdable:
                            game.act(f"hold {rng.choice(holdable).number}")
                    bookable = [g for g in game.board.values()
                                if game.contract_for(g).blocks_needed(game.templates) <= g.due - game.clock]
                    if bookable and len(game.active) < 2 and rng.randrange(4):
                        game.act(f"take {rng.choice(bookable).number}")
                    eligible = [c for c in game.active.values() if c.due < WEEK]
                    if eligible and game.extended_job is None and rng.randrange(8) == 0:
                        game.act(f"extend {rng.choice(eligible).gig.number}")
                    options = ["wait"]
                    if game.paid_claim is None:
                        for entry in game.ledger:
                            if entry.kind == "Unpaid":
                                number = entry.gig.number
                                options.extend(f"claim {number} {s}" for s in ("funds", "terms")
                                               if (number, s) in game.checked - game.filed)
                    if rng.randrange(5) == 0:
                        options.append("end")
                    for number, contract in list(game.active.items()):
                        if contract.remaining:
                            options.extend([f"work {number}"] * 4)
                            if contract.can_reuse(game.templates):
                                options.append(f"reuse {number}")
                        elif rng.randrange(2):
                            options.append(f"polish {number}")
                        else:
                            game.act(f"deliver {number}")
                    open_ids = sorted(set(game.board) | set(game.active))
                    if open_ids:
                        number = rng.choice(open_ids)
                        source = rng.choice(("funds", "terms"))
                        if game.checks_left:
                            game.act(f"check {number} {source}")
                        if (number, source) in game.checked - game.filed:
                            options.append(f"report {number} {source}")
                        if (game.clock + 1 < game.file_cutoff(game.listing(number))
                                and any((number, s) not in game.checked for s in ("funds", "terms"))):
                            options.append(f"audit {number}")
                    clock, cash = game.clock, game.cash
                    game.act(rng.choice(options))
                    self.assertTrue(clock < game.clock <= WEEK)
                    self.assertGreaterEqual(game.cash, cash)
                    self.assertLessEqual(len(game.active), 2)
                    self.assertTrue(0 <= game.checks_left <= DAILY_CHECKS)
                    closed = [e.gig.number for e in game.ledger]
                    self.assertEqual(len(closed), len(set(closed)))
                    self.assertTrue(set(closed).isdisjoint(game.board))
                    self.assertTrue(set(closed).isdisjoint(game.active))
                    self.assertTrue(set(game.board).isdisjoint(game.active))
                    self.assertTrue(all(g.due > game.clock for g in game.board.values()))
                    self.assertTrue(all(game.clock < c.due <= WEEK for c in game.active.values()))
                    self.assertEqual(len(game.holds), len(set(game.holds.values())))
                    self.assertLessEqual(sum(e.kind == "Recovered" for e in game.ledger), 1)
                    paid_clients = {e.gig.number: e.gig.client for e in game.reviews if e.amount > 0}
                    for offer in [*game.incoming, *game.board.values()]:
                        if offer.repeat_of is not None:
                            self.assertEqual(paid_clients[offer.repeat_of], offer.client)
                    polished = {e.gig.number for e in game.ledger if e.kind == "Polished"}
                    for field, origin in game.templates.items():
                        self.assertEqual(field, origin.brief.field)
                        self.assertIn(origin.number, polished)
                self.assertEqual((game.board, game.active), ({}, {}))
                self.assertEqual(game.incoming, [])
