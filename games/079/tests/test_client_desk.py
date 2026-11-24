import copy

from desk.accounts import CLAIM_CAP
from desk.game import DAILY_CHECKS, WEEK
from play import board_view, brief_view, inbox_view, journal_view, plan_view
from tests.support import DeskCase, desk_with, gig, moves


class OvernightHoldTests(DeskCase):
    def test_full_desk_can_hold_evidence_overnight_and_lock_a_later_referral_rate(self):
        game = desk_with(gig(1), gig(2), gig(3, effort=2, due=6, fee=390))
        notice = game.board[3]
        moves(game, "take 1", "take 2", "check 3 terms")
        brief = brief_view(game, notice)
        for detail in ("Both desk slots are occupied", "leaves the board at Mon 17:00", "hold 03"):
            self.assertIn(detail, brief)
        self.assertIn("Held 03 through Tue 13:00", moves(game, "  HOLD 03 "))
        self.assertEqual((game.clock, game.checks_left, set(game.active)), (0, 1, {1, 2}))
        self.assertEqual(game.moves[-1], "hold 3")
        self.assertEqual(game.quote(notice), 390)
        moves(game, "work 1", "polish 1", "work 2", "deliver 2", "end")
        self.assertEqual(game.board[3], notice)
        self.assertIn("(held to Tue 13:00)", board_view(game))
        self.assertIn("already on file", moves(game, "check 3 terms").lower())
        self.assertEqual(game.checks_left, DAILY_CHECKS)
        moves(game, "take 3")
        self.assertEqual((game.active[3].due, game.active[3].fee), (6, 450))
        moves(game, "work 3", "work 3")
        self.assertEqual(game.ledger[-1].amount, 450)

    def test_using_or_pulling_the_held_notice_does_not_reissue_todays_hold(self):
        for action in ("take 1", "report 1 funds"):
            with self.subTest(action=action):
                game = desk_with(gig(1, due=6, breach="funds"), gig(2, due=7), gig(4, due=10))
                moves(game, "hold 1", "check 1 funds")
                self.assert_rejected(game, "hold 1", "already has an overnight hold")
                moves(game, action)
                self.assert_rejected(game, "hold 2", "hold has been used")
                moves(game, "end", "hold 4")
                self.assertEqual(game.holds, {1: 4, 4: 8})
                self.assertNotIn(1, game.board)
                self.assertNotIn(2, game.board)

    def test_held_file_can_be_audited_across_close_and_reported_at_its_deadline(self):
        game = desk_with(gig(1, due=5, breach="terms"))
        moves(game, "wait", "wait", "wait")
        self.assert_rejected(game, "audit 1", "file closes")
        moves(game, "hold 1", "audit 1")
        self.assertEqual((game.clock, game.checks_left), (4, DAILY_CHECKS))
        self.assertEqual(set(game.board), {1, 4, 5, 6})
        moves(game, "report 1 terms")
        self.assertEqual((game.clock, game.reports, game.cash), (5, 1, 0))
        self.assert_rejected(game, "take 1", "closed or unavailable")

    def test_untaken_hold_expires_at_the_earlier_of_its_deadline_and_second_close(self):
        for due, cutoff in ((5, 5), (8, 8), (10, 8)):
            with self.subTest(due=due):
                game = desk_with(gig(1, due=due), gig(4, due=10))
                moves(game, "hold 1", "end")
                self.assertEqual(game.file_cutoff(game.board[1]), cutoff)
                self.assert_rejected(game, "hold 1", "already has an overnight hold")
                moves(game, "hold 4")
                while game.clock < cutoff:
                    self.assertIn(1, game.board)
                    game.act("wait")
                self.assertNotIn(1, game.board)
                self.assertIn(4, game.board)
                self.assertFalse(game.ledger)

    def test_rejected_holds_leave_the_allowance_and_clock_alone(self):
        game = desk_with(gig(1, due=4), gig(2, due=7), gig(3, due=6))
        for command, reason in (("hold", "Use hold"), ("hold 0", "numeric gig ID"),
                                ("hold 99", "closed or unavailable"), ("hold 1", "deadline")):
            self.assert_rejected(game, command, reason)
        moves(game, "take 2")
        self.assert_rejected(game, "hold 2", "already booked")
        moves(game, "hold 3", "end", "end", "end", "end")
        self.assert_rejected(game, "hold 13", "Friday")
        self.assertEqual(game.holds, {3: 4})


class ReturnBriefTests(DeskCase):
    def test_each_field_has_a_funded_two_step_followup_from_the_client_who_paid(self):
        for field in ("Design", "Copy", "Data", "Audio"):
            with self.subTest(field=field):
                game = desk_with(gig(1, field=field))
                original = game.board[1]
                self.assertIn("No return offers", inbox_view(game))
                moves(game, "take 1", "work 1", "deliver 1")
                offer, = game.incoming
                self.assertEqual((offer.number, offer.repeat_of, offer.client), (16, 1, original.client))
                self.assertEqual((offer.brief.field, offer.brief.blocks, offer.due), (field, 2, 8))
                self.assertEqual((offer.fee, offer.trail.breach), (300, ""))
                self.assertNotEqual(offer.brief.title, original.brief.title)
                self.assert_rejected(game, "take 16", "closed or unavailable")
                before = copy.deepcopy(vars(game))
                self.assertIn("Arriving Tue 09:00", inbox_view(game))
                self.assertEqual(vars(game), before)
                game.act("end")
                self.assertFalse(game.incoming)
                self.assertEqual(game.board[16], offer)
                self.assertIn("return from 01", board_view(game))
                self.assertIn("following handoff 01", brief_view(game, offer))
                self.assertIn("On the board now", inbox_view(game))

    def test_deadline_handoff_at_close_and_manual_delivery_at_open_go_in_different_mail(self):
        game = desk_with(gig(1, due=4), gig(2, due=6))
        moves(game, "take 1", "take 2", "work 2", "wait", "wait", "work 1")
        self.assertEqual(game.clock, 4)
        self.assertEqual(set(game.board), {4, 5, 6, 16})
        moves(game, "deliver 2")
        self.assertEqual([g.number for g in game.incoming], [17])
        self.assertEqual(game.incoming[0].due, 12)
        game.act("end")
        self.assertEqual(set(game.board), {7, 8, 9, 17})
        self.assertEqual([entry.gig.number for entry in game.ledger], [1, 2])

    def test_two_paid_handoffs_on_one_closing_block_get_distinct_offers(self):
        game = desk_with(gig(1, due=4), gig(2, due=4))
        moves(game, "take 1", "take 2", "work 1", "work 2", "wait", "polish 2")
        self.assertEqual([(e.gig.number, e.kind) for e in game.ledger], [(2, "Polished"), (1, "Delivered")])
        self.assertEqual({n: g.repeat_of for n, g in game.board.items() if g.repeat_of}, {16: 1, 17: 2})
        self.assertEqual([game.quote(game.board[n]) for n in (16, 17)], [360, 360])
        self.assertFalse(game.incoming)

    def test_return_uses_normal_booking_terms_templates_and_reviews_without_chaining(self):
        game = desk_with(gig(1), gig(2))
        moves(game, "take 1", "work 1", "polish 1", "take 2", "work 2", "deliver 2", "end")
        self.assertIn("reuse 16", plan_view(game, game.board[16]))
        moves(game, "take 16", "extend 16")
        self.assertEqual((game.active[16].due, game.active[16].fee), (10, 280))
        moves(game, "end", "reuse 16", "polish 16")
        self.assertEqual((game.ledger[-1].amount, game.ledger[-1].stars), (280, 5))
        self.assertEqual((game.cash, game.templates["Design"].number), (680, 16))
        self.assertFalse(game.incoming)
        game.act("end")
        self.assertEqual(set(game.board), {10, 11, 12})

    def test_a_return_requires_slot_and_work_time_and_expires_if_unclaimed(self):
        game = desk_with(gig(1), gig(4, due=9), gig(5, due=10))
        moves(game, "take 1", "work 1", "deliver 1", "end", "take 4", "take 5")
        self.assert_rejected(game, "take 16", "Both desk slots")
        moves(game, "work 4", "deliver 4", "wait", "wait")
        self.assert_rejected(game, "take 16", "Only 1 block")
        self.assert_rejected(game, "hold 16", "deadline")
        game.act("end")
        self.assertNotIn(16, game.board)
        self.assertNotIn(16, [e.gig.number for e in game.ledger])

    def test_unpaid_missed_reported_and_friday_handoffs_generate_no_return(self):
        game = desk_with(gig(1, due=2, breach="terms"), gig(2, due=2),
                         gig(3, due=3, breach="funds"), gig(13, due=WEEK))
        moves(game, "take 1", "take 2", "check 3 funds", "work 1", "deliver 1", "report 3 funds", "end")
        self.assertEqual([e.kind for e in game.ledger], ["Unpaid", "Reported", "Missed"])
        self.assertEqual(set(game.board), {4, 5, 6})
        moves(game, "end", "end", "end", "take 13", "work 13", "deliver 13", "end")
        self.assertTrue(game.complete)
        self.assertEqual((game.incoming, game.board), ([], {}))


class InvoiceClaimTests(DeskCase):
    def test_handoff_without_evidence_records_the_loss_and_offers_no_claim_command(self):
        game = desk_with(gig(1, due=1, breach="funds"))
        notice = game.board[1]
        moves(game, "take 1", "work 1")
        journal = " ".join(journal_view(game).split())
        self.assertIn(notice.trail.finding, journal)
        self.assertIn("No evidence slips kept before handoff", journal)
        for hidden in (notice.trail.funds, notice.trail.terms, "claim 01"):
            self.assertNotIn(hidden, journal)
        self.assert_rejected(game, "claim 1 funds", "never opened")

    def test_payout_uses_locked_amended_fee_with_referral_and_rounds_down(self):
        game = desk_with(gig(1), gig(2), gig(3, due=6, fee=201, breach="terms", field="Audio"))
        moves(game, "take 1", "work 1", "polish 1", "take 2", "work 2", "deliver 2",
              "check 3 terms", "take 3", "extend 3", "work 3", "polish 3")
        self.assertEqual((game.ledger[-1].kind, game.ledger[-1].unpaid_fee), ("Unpaid", 181))
        self.assertIn("claim 03 terms", " ".join(journal_view(game).split()))
        moves(game, "  CLAIM 03 TERMS ")
        receipt = game.ledger[-1]
        self.assertEqual((receipt.kind, receipt.amount, receipt.stars), ("Recovered", 90, None))
        self.assertEqual(game.moves[-1], "claim 3 terms")
        self.assertEqual((game.clock, game.cash, game.rating, game.reports), (6, 490, 4.5, 1))
        self.assertEqual(len(game.ledger), 3)
        self.assertFalse(game.incoming)
        self.assertNotIn("Audio", game.templates)
        self.assertIn("locked fee of HK$181", " ".join(journal_view(game).split()))

    def test_protection_cap_and_simultaneous_deadline_apply_once(self):
        game = desk_with(gig(1, due=3, fee=900, breach="funds"), gig(2, due=2))
        moves(game, "check 1 funds", "take 1", "work 1", "deliver 1", "take 2", "claim 1 funds")
        self.assertEqual((game.clock, game.reports, game.cash, game.rating), (2, 1, CLAIM_CAP, 1))
        self.assertEqual([e.kind for e in game.ledger], ["Recovered", "Missed"])
        self.assert_rejected(game, "claim 1 funds", "payment went to invoice 01")
        self.assert_rejected(game, "report 1 funds", "closed or unavailable")

    def test_wrong_claim_costs_time_and_leaves_the_payment_for_another_invoice(self):
        game = desk_with(gig(1, due=6, breach="funds"), gig(2, due=6, fee=125, breach="terms"))
        moves(game, "audit 1", "check 2 terms", "take 1", "take 2", "work 1", "deliver 1",
              "work 2", "deliver 2")
        self.assertIn("unsubstantiated", moves(game, "claim 1 terms"))
        self.assertEqual((game.clock, game.cash, game.reports, game.paid_claim), (4, 0, 0, None))
        self.assert_rejected(game, "claim 1 terms", "already ruled")
        journal = " ".join(journal_view(game).split())
        self.assertIn("Terms (already cited)", journal)
        self.assertIn("claim 01 funds", journal)
        self.assertNotIn("claim 01 terms", journal)
        moves(game, "claim 2 terms")
        self.assertEqual((game.cash, game.rating, game.reports), (62, None, 1))
        self.assert_rejected(game, "claim 1 funds", "payment went to invoice 02")
        self.assertEqual([e.kind for e in game.ledger], ["Unpaid", "Recovered"])
        self.assertNotIn("claim 01 funds", journal_view(game))

    def test_closed_invoice_cannot_gain_slips_or_retry_an_earlier_report_ruling(self):
        game = desk_with(gig(1, due=4, breach="funds"))
        notice = game.board[1]
        moves(game, "check 1 terms", "report 1 terms", "take 1", "work 1", "deliver 1")
        self.assert_rejected(game, "claim 1 terms", "already ruled")
        self.assert_rejected(game, "claim 1 funds", "never opened")
        self.assert_rejected(game, "check 1 funds", "closed or unavailable")
        journal = " ".join(journal_view(game).split())
        self.assertIn(notice.trail.terms, journal)
        self.assertNotIn(notice.trail.funds, journal)
        self.assertIn("ruled on every slip", journal)
        self.assertNotIn("Use claim", journal)

    def test_only_an_unpaid_handoff_is_an_invoice_and_bad_input_is_atomic(self):
        game = desk_with(gig(1, due=3), gig(2, due=2), gig(3, due=4, breach="terms"))
        for command, reason in (("claim", "Use claim"), ("claim 1", "Use claim"),
                                ("claim 0 terms", "numeric gig ID"), ("claim 1 tip", "funds or terms"),
                                ("claim 99 terms", "No unpaid handoff"), ("claim 1 terms", "No unpaid handoff")):
            self.assert_rejected(game, command, reason)
        moves(game, "take 1", "take 2", "check 3 terms")
        self.assert_rejected(game, "claim 1 funds", "No unpaid handoff")
        moves(game, "work 1", "deliver 1", "report 3 terms")
        self.assertEqual([e.kind for e in game.ledger], ["Delivered", "Reported", "Missed"])
        for number in (1, 2, 3):
            self.assert_rejected(game, f"claim {number} terms", "No unpaid handoff")

    def test_final_block_can_settle_a_claim_but_friday_close_ends_filing(self):
        game = desk_with(gig(13, due=19, breach="funds"), gig(14, due=WEEK, breach="terms"))
        moves(game, *["end"] * 4, "check 13 funds", "check 14 terms", "take 13", "take 14",
              "work 13", "deliver 13", "work 14", "wait", "claim 13 funds")
        self.assertTrue(game.complete)
        self.assertEqual([e.kind for e in game.ledger], ["Recovered", "Unpaid"])
        self.assertEqual((game.cash, game.reports, game.reviews), (100, 1, []))
        self.assert_rejected(game, "claim 14 terms", "week has closed")
        self.assertNotIn("Use claim", journal_view(game))
