import copy
import re
import unittest

from desk.game import DAILY_CHECKS, WEEK, Game, RuleError, clock_label
from play import board_view, brief_view, plan_view, portfolio_view
from tests.support import DeskCase, desk_with, gig, moves


class PortfolioTests(DeskCase):
    def test_polish_files_one_template_per_field_and_keeps_its_origin(self):
        game = desk_with(gig(1), gig(2, due=5), gig(4, due=8, field="Audio"))
        moves(game, "take 1", "work 1", "polish 1", "take 2", "work 2", "polish 2",
              "take 4", "work 4", "polish 4")
        self.assertEqual({f: g.number for f, g in game.templates.items()}, {"Design": 1, "Audio": 4})
        self.assertEqual((game.cash, game.rating), (660, 5))
        self.assertIn("Filed from 01", portfolio_view(game))
        self.assertIn("Track routing sheet", portfolio_view(game))

    def test_only_a_paid_polished_handoff_earns_a_template(self):
        for ending, breach, kind in (("deliver 1", "", "Delivered"), ("wait", "", "Missed"),
                                     ("polish 1", "terms", "Unpaid"), ("report 1 funds", "funds", "Reported")):
            with self.subTest(kind=kind):
                game = desk_with(gig(1, due=2, breach=breach))
                moves(game, "take 1", "check 1 funds")
                moves(game, "wait" if kind == "Missed" else "work 1", ending)
                self.assertEqual(game.ledger[0].kind, kind)
                self.assertFalse(game.templates)

    def test_matching_template_makes_a_last_block_booking_possible(self):
        game = desk_with(gig(1), gig(2, effort=2, due=3, fee=460))
        moves(game, "take 1", "work 1", "polish 1")
        self.assertIn("1 blk   Mon 15:00", board_view(game))
        self.assertIn("reuse 02", plan_view(game, game.board[2]))
        moves(game, "take 2")
        self.assertIn("reuse 02", portfolio_view(game))
        log = moves(game, "reuse 02")
        self.assertIn("02 / Proof pass 1.", log)
        self.assertIn("02 / Proof pass 2.", log)
        self.assertIn("Deadline handoff", log)
        self.assertEqual((game.clock, game.cash, game.rating), (3, 660, 4.5))
        self.assertFalse(game.templates)
        self.assert_rejected(game, "reuse 2", "closed or unavailable")

    def test_reuse_finishes_the_next_two_steps_and_polish_can_refill_the_shelf(self):
        for breach in ("", "terms"):
            with self.subTest(breach=breach):
                game = desk_with(gig(1), gig(2, effort=3, due=5, breach=breach))
                moves(game, "take 1", "work 1", "polish 1", "take 2", "work 2")
                log = moves(game, "reuse 2")
                self.assertNotIn("Proof pass 1.", log)
                self.assertIn("Proof pass 2.", log)
                self.assertIn("Proof pass 3.", log)
                self.assertEqual((game.active[2].remaining, game.clock), (0, 4))
                self.assertFalse(game.templates)
                self.assert_rejected(game, "reuse 2", "draft is ready")
                moves(game, "polish 2")
                if breach:
                    self.assertFalse(game.templates)
                    self.assertEqual((game.cash, len(game.reviews)), (200, 1))
                else:
                    self.assertEqual(game.templates["Design"].number, 2)
                    self.assertEqual((game.cash, game.rating), (400, 5))

    def test_wrong_field_and_single_remaining_step_cannot_spend_a_template(self):
        game = desk_with(gig(1), gig(2, effort=2, due=6, field="Audio"), gig(3, effort=2, due=6))
        self.assert_rejected(game, "reuse 2", "Take gig")
        moves(game, "take 1", "work 1", "polish 1", "take 2", "take 3")
        self.assert_rejected(game, "reuse 2", "No Audio template")
        moves(game, "work 3")
        self.assert_rejected(game, "reuse 3", "two unfinished steps")
        self.assertEqual(game.templates["Design"].number, 1)


class ExtensionTests(DeskCase):
    def test_amendment_reorders_two_handoffs_and_locks_the_discount_until_payment(self):
        game = desk_with(gig(1, effort=2, due=3, fee=410), gig(2, effort=2, due=3), gig(4, due=8))
        posted = game.board[1]
        self.assert_rejected(game, "extend 1", "Take gig")
        moves(game, "take 1", "take 2")
        self.assertIn("Schedule clash", game.pressure())
        details = " ".join(brief_view(game, posted).split())
        self.assertIn("Tue 11:00 for a revised fee of HK$330", details)
        moves(game, "extend 01")
        self.assertEqual((game.clock, game.quote(posted), game.active[1].due), (0, 330, 5))
        self.assertEqual((posted.fee, posted.due), (410, 3))
        self.assertEqual(game.pressure(), "")
        self.assertIn("due Tue 11:00", board_view(game))
        self.assertIn("Locked fee HK$330", brief_view(game, posted))
        self.assert_rejected(game, "extend 2", "extension went to gig 01")
        moves(game, "work 2", "work 2", "deliver 2", "wait", "work 1", "work 1")
        self.assertEqual([(e.gig.number, e.amount) for e in game.ledger], [(2, 200), (1, 330)])
        self.assertEqual((game.clock, game.rating), (5, 4))
        moves(game, "take 4")
        self.assert_rejected(game, "extend 4", "extension went to gig 01")

    def test_friday_close_refuses_an_extension_and_charges_only_for_available_blocks(self):
        game = desk_with(gig(13, due=WEEK), gig(14, due=WEEK - 1, fee=300))
        moves(game, *["end"] * 4, "take 13", "take 14")
        self.assert_rejected(game, "extend 13", "Friday close")
        moves(game, "extend 14", "work 14", "wait", "wait")
        self.assertEqual((game.active[14].due, game.active[14].fee), (WEEK, 260))
        self.assert_rejected(game, "extend 14", "extension went to gig 14")
        moves(game, "polish 14")
        self.assertTrue(game.complete)
        self.assertEqual([(e.kind, e.amount) for e in game.ledger], [("Polished", 260), ("Missed", 0)])
        self.assertEqual(game.active, {})

    def test_amendment_uses_the_booked_referral_rate(self):
        game = desk_with(gig(1), gig(2), gig(3, fee=500, due=6))
        moves(game, "take 1", "work 1", "polish 1", "take 2", "work 2", "deliver 2", "take 3")
        self.assertEqual(game.active[3].fee, 560)
        moves(game, "extend 3", "work 3", "deliver 3")
        self.assertEqual(game.ledger[-1].amount, 480)

    def test_amendment_neither_certifies_the_client_nor_refunds_a_used_extension(self):
        replies = []
        for breach in ("", "funds"):
            game = desk_with(gig(1, due=2, breach=breach), gig(2, due=4))
            moves(game, "take 1")
            replies.append(moves(game, "extend 1"))
            if breach:
                moves(game, "check 1 funds", "report 1 funds")
            else:
                moves(game, "end")
                self.assertEqual(game.ledger[-1].kind, "Missed")
            self.assertEqual((game.extended_job, game.cash), (1, 0))
        self.assertEqual(replies[0], replies[1])


class AuditTests(DeskCase):
    def test_last_block_audit_advice_accounts_for_spent_checks(self):
        game = desk_with(gig(1, due=1))
        self.assert_rejected(game, "audit 1", "unused daily check")
        moves(game, "check 2 funds", "check 2 terms")
        self.assert_rejected(game, "audit 1", "Both daily checks have been spent")

    def test_audit_works_after_daily_checks_run_out_and_still_requires_a_citation(self):
        game = desk_with(gig(1), gig(2, due=3, breach="terms"))
        moves(game, "check 1 funds", "check 1 terms")
        log = moves(game, "audit 02")
        self.assertEqual((game.clock, game.checks_left, game.reports), (1, 0, 0))
        self.assertIn(game.board[2].trail.funds, log)
        self.assertIn(game.board[2].trail.terms, log)
        self.assertNotIn(game.board[2].trail.finding, log)
        self.assertEqual(game.moves[-1], "audit 2")
        self.assert_rejected(game, "audit 2", "already on file")
        old_moves = list(game.moves)
        moves(game, "check 2 terms")
        self.assertEqual(game.moves, old_moves)
        moves(game, "report 2 funds", "report 2 terms")
        self.assertEqual((game.reports, game.clock, game.cash), (1, 3, 0))

    def test_partial_audit_preserves_allowance_and_prior_ruling_and_advances_other_deadlines(self):
        game = desk_with(gig(1, due=5, breach="terms"), gig(2, due=2))
        moves(game, "check 1 funds", "report 1 funds", "take 2")
        log = moves(game, "audit 1")
        self.assertIn("Filed 1 new slip", log)
        self.assertNotIn("Funds slip /", log)
        self.assertIn("Terms slip /", log)
        self.assertEqual(game.checks_left, DAILY_CHECKS - 1)
        self.assertEqual(game.ledger[0].kind, "Missed")
        self.assert_rejected(game, "report 1 funds", "already ruled")
        moves(game, "report 1 terms")
        self.assertEqual((game.reports, game.rating), (1, 1))

    def test_notice_closes_overnight_but_a_booked_file_can_be_audited_across_days(self):
        game = desk_with(gig(1, due=4, breach="funds"), gig(2, due=6))
        moves(game, "take 1", "check 2 terms", "wait", "wait", "wait")
        self.assert_rejected(game, "audit 1", "file closes")
        self.assert_rejected(game, "audit 2", "file closes")
        moves(game, "take 2", "audit 2")
        self.assertEqual((game.clock, game.checks_left), (4, DAILY_CHECKS))
        self.assertTrue({(2, "funds"), (2, "terms")} <= game.checked)
        self.assertEqual(set(game.active), {2})
        self.assertEqual([e.kind for e in game.ledger], ["Missed"])

    def test_amended_cutoff_allows_a_last_day_audit_and_final_block_report(self):
        game = desk_with(gig(13, due=19, breach="terms"))
        moves(game, *["end"] * 4, "take 13", "wait", "wait")
        self.assert_rejected(game, "audit 13", "file closes")
        moves(game, "extend 13", "audit 13", "report 13 terms")
        self.assertTrue(game.complete)
        self.assertEqual((game.reports, game.rating), (1, None))
        self.assertEqual(len(game.ledger), 1)


class PlannerTests(unittest.TestCase):
    def test_booked_briefs_assign_a_shared_template_once_and_keep_the_original_scope(self):
        game = desk_with(gig(1), gig(2, effort=3, due=6), gig(3, effort=2, due=7))
        moves(game, "take 1", "work 1", "polish 1", "take 3", "take 2")
        first = game.active[2].gig
        second = game.active[3].gig
        self.assertIn("2 blocks left on the current plan with reuse 02", brief_view(game, first))
        self.assertIn("2 blocks left on the current plan.", brief_view(game, second))
        moves(game, "reuse 2")
        brief = brief_view(game, first)
        self.assertIn("3 production steps", brief)
        self.assertIn("1 block left", brief)
        self.assertNotIn("3 blocks of work", brief)

    def test_playing_the_printed_preview_commands_meets_both_booked_deadlines(self):
        actions_used = set()
        for seed in range(32):
            with self.subTest(seed=seed):
                game = Game(seed)
                quick = next(g for g in game.board.values() if g.brief.blocks == 1)
                if quick.due >= 2:
                    moves(game, f"take {quick.number}", f"work {quick.number}", f"polish {quick.number}")
                game.act("end")
                first, second = list(game.board.values())[:2]
                game.act(f"take {first.number}")
                if seed % 2 == 0:
                    game.act(f"extend {first.number}")
                preview = plan_view(game, second)
                if "Schedule clash" in preview:
                    continue
                game.act(f"take {second.number}")
                timeline = re.findall(r"^    (\w+ \d\d:\d\d) +((work|reuse|deliver) \d\d)$", preview, re.M)
                for when, command, verb in timeline:
                    self.assertEqual(when, clock_label(game.clock))
                    game.act(command)
                    actions_used.add(verb)
                self.assertFalse(game.active)
                self.assertEqual({e.gig.number for e in game.ledger[-2:]}, {first.number, second.number})
                self.assertTrue(all(e.kind in ("Delivered", "Unpaid") for e in game.ledger[-2:]))
        self.assertEqual(actions_used, {"work", "reuse", "deliver"})

    def test_single_template_is_allocated_once_to_the_first_deadline(self):
        game = desk_with(gig(1), gig(2, effort=2, due=4), gig(3, effort=2, due=4))
        moves(game, "take 1", "work 1", "polish 1", "take 3")
        before = copy.deepcopy(vars(game))
        plan = game.schedule(game.board[2])
        self.assertEqual([(r.gig.number, r.reuse, r.work_blocks) for r in plan],
                         [(2, True, 1), (3, False, 2)])
        self.assertIn("3 blocks of work due by Mon 17:00, with 2 blocks available",
                      plan_view(game, game.board[2]))
        self.assertEqual(vars(game), before)
        moves(game, "take 2")
        desk = board_view(game)
        self.assertIn("Brief 2 / 1 block left with reuse 02", desk)
        self.assertIn("Brief 3 / 2 blocks left", desk)
        moves(game, "extend 3")
        self.assertEqual([r.finish for r in game.schedule()], [3, 5])
        self.assertIn("Tue 11:00   deliver 03", plan_view(game))
        moves(game, "reuse 2", "deliver 2", "work 3", "work 3", "deliver 3")
        self.assertEqual((game.clock, game.cash), (5, 520))

    def test_preview_ships_ready_work_first_and_distinguishes_close_from_next_opening(self):
        game = desk_with(gig(1, due=6), gig(2, effort=2, due=5, breach="funds"))
        moves(game, "take 1", "work 1", "wait", "wait")
        preview = plan_view(game, game.board[2])
        self.assertIn("Mon 15:00   deliver 01", preview)
        self.assertIn("Mon 15:00   work 02", preview)
        self.assertIn("Tue 09:00   work 02", preview)
        self.assertIn("Tue 11:00   automatic deadline handoff", preview)
        for hidden in (game.board[2].trail.funds, game.board[2].trail.terms, game.board[2].trail.finding):
            self.assertNotIn(hidden, preview)
        moves(game, "take 2")
        self.assertEqual(plan_view(game, game.active[2].gig), plan_view(game))
        moves(game, "deliver 1", "work 2", "work 2")
        self.assertEqual([(e.gig.number, e.kind) for e in game.ledger], [(1, "Delivered"), (2, "Unpaid")])

    def test_impossible_preview_or_full_desk_never_books_a_third_job(self):
        game = Game(12)
        self.assertIn("desk is clear", plan_view(game))
        moves(game, "take 1", "take 2")
        before = copy.deepcopy(vars(game))
        with self.assertRaisesRegex(RuleError, "Both desk slots"):
            plan_view(game, game.board[3])
        self.assertNotIn("Schedule clash", brief_view(game, game.board[3]))
        self.assertEqual(vars(game), before)
        moves(game, "work 2", "deliver 2")
        with self.assertRaisesRegex(RuleError, "Only 2 blocks"):
            plan_view(game, game.board[3])

    def test_friday_plan_finishes_at_close_and_proposes_no_sixth_day(self):
        game = desk_with(gig(13, effort=3, due=WEEK), gig(14, due=WEEK))
        moves(game, *["end"] * 4, "take 13", "take 14")
        self.assertIn("Fri 17:00   automatic deadline handoff", plan_view(game))
        moves(game, "wait")
        self.assertIn("4 blocks of work due by Fri 17:00, with 3 blocks available", plan_view(game))
