"""Command-line entry point and plain-text desk for Friday, Filed."""

from __future__ import annotations

import argparse
from pathlib import Path
import secrets
import sys
import textwrap
from typing import TextIO

from desk.accounts import CLAIM_CAP, Entry
from desk.catalog import TEMPLATE_NAMES
from desk.game import (
    CASH_TARGET, DAILY_CHECKS, DESK_LIMIT, MAX_SEED, RATING_TARGET, REFERRAL,
    SOURCES, Game, RuleError, money, read_number,
)
from desk.schedule import (
    BLOCKS_PER_DAY, WEEK, Contract, Gig, blocks, clock_label, day_close, due_label, schedule_warning,
)
from desk.storage import SaveError, load_game, save_game


SAVE_PATH = Path(__file__).resolve().with_name("friday-filed.save.json")
TITLE = "FRIDAY, FILED"
INTRO = ("You have five days at a freelance desk. Bank HK$1,200, earn a 4.5/5 "
         "public rating and substantiate one scam report before Friday close.")
HELP = f"""DESK GUIDE

Read the board
  board                 Today's notices, active jobs and the clock
  brief ID              Scope, client's message and evidence slips
  plan [ID]             Lay out handoffs by deadline. Add an ID to try a booking.
  inbox                 Today's return briefs and tomorrow's incoming work
  portfolio             Filed templates and the booked jobs that can use them
  journal               Payments, public reviews and confirmed cases

Book and deliver
  take ID               Reserve one of your two desk slots. Locks the fee.
  hold ID               Keep one open notice overnight each day, if due later.
                        Its deadline still applies. Book when a slot opens.
  work ID               Do one block of the brief.
  reuse ID              Spend a matching template to do two steps in one block.
  deliver ID            Send a ready draft immediately. Paid work earns 4/5.
  polish ID             Polish and send in one block. Paid work earns 5/5
                        and files a template if that field's shelf is empty.
  extend ID             Once a week, move a booked deadline up to two blocks
                        for HK$40 off the fee per block. See the quote in brief.

Check a client
  check ID funds        Read the payment slip. Two new checks each day.
  check ID terms        Read the agreement. Re-reading either slip is free.
  audit ID              Spend one block to open all missing slips on a job.
  report ID funds       Cite a checked slip and spend one block filing.
  report ID terms       Cite the terms when the agreement breaks the promise.
  claim ID funds|terms  On an unpaid handoff, cite a slip kept before delivery.
                        Filing costs one block. Once a week the board reimburses
                        half the locked fee, up to {money(CLAIM_CAP)}, for an upheld claim.

Manage the week
  wait                  Pass one block.
  end                   Pass the remaining blocks today, through closing time.
  save                  Write this week to the local save slot.
  quit                  Leave the desk. Type save first to keep your place.

Working hours are 09:00 to 17:00, in four two-hour blocks. At the deadline
a ready draft ships automatically. An unfinished genuine job earns 1/5.
Accepted jobs carry over. Unheld notices leave the board at closing.
Paid public clients send a funded return brief the next working morning.
Two public reviews averaging 4.5/5 or higher add HK$60 to new bookings.
A confirmed report pulls the notice, even if you already took the job."""


def wrap(text: str, indent: str = "") -> str:
    return textwrap.fill(text, width=78, initial_indent=indent, subsequent_indent=indent)


def status(game: Game) -> str:
    used = BLOCKS_PER_DAY if game.complete else game.clock % BLOCKS_PER_DAY
    bar = "#" * used + "." * (BLOCKS_PER_DAY - used)
    rating = "unrated" if game.rating is None else f"{game.rating:.2f}/5"
    return (f"{clock_label(game.clock)}  [{bar}]  {blocks(BLOCKS_PER_DAY - used)} left today"
            f"  |  {game.checks_left}/{DAILY_CHECKS} checks\n"
            f"Earned {money(game.cash)}  |  Public rating {rating}"
            f"  |  Confirmed reports {game.reports}")


NOTICE_HEADER = f"  ID  {'Commission':<26}  {'Fee':>7}   {'Work':<5}   Deadline"


def notice_rows(game: Game, gig: Gig) -> list[str]:
    offer = game.contract_for(gig)
    effort = offer.blocks_needed(game.templates)
    details = [f"{gig.client} / {gig.brief.field}"]
    if gig.repeat_of is not None:
        details.append(f"(return from {gig.repeat_of:02})")
    if gig.number in game.holds:
        details.append(f"(held to {due_label(game.file_cutoff(gig))})")
    if offer.can_reuse(game.templates):
        details.append("(with template)")
    if effort > gig.due - game.clock:
        details.append("(too late to book)")
    return [f"  {gig.number:02}  {gig.brief.title:<26}  {money(offer.fee):>7}"
            f"   {effort} blk   {due_label(gig.due)}", "      " + "  ".join(details)]


def board_view(game: Game) -> str:
    lines = [status(game), "", "JOB BOARD", NOTICE_HEADER]
    for gig in game.board.values():
        lines.extend(notice_rows(game, gig))
    if not game.board:
        lines.append("  No open notices.")
    lines += ["", f"YOUR DESK  {len(game.active)}/{DESK_LIMIT}"]
    plan = game.schedule()
    planned = {row.gig.number: row for row in plan}
    for contract in game.active.values():
        gig = contract.gig
        row = planned[gig.number]
        progress = f"{blocks(row.work_blocks)} left" if row.work_blocks else "ready to deliver or polish"
        if row.reuse:
            progress += f" with reuse {gig.number:02}"
        lines.append(f"  {gig.number:02}  {gig.brief.title} / {progress} / due {due_label(contract.due)}")
    if not game.active:
        lines.append("  Both slots are open.")
    if any(not game.hold_problem(gig) for gig in game.board.values()):
        lines.append("  One overnight hold available. Use hold ID on a notice due after today.")
    if game.extended_job is not None:
        lines.append(f"  Weekly extension signed on {game.extended_job:02}.")
    elif any(job.due < WEEK for job in game.active.values()):
        lines.append("  Weekly extension available. See a booked brief for terms.")
    warning = schedule_warning(game.clock, plan)
    if warning:
        lines.append(wrap(warning, "  "))
    if game.referral:
        lines.append(f"  Referral rate in effect. Open quotes include {money(REFERRAL)} extra.")
    if game.templates:
        lines.append(f"  Filed templates / {', '.join(sorted(game.templates))}. Details in portfolio.")
    if game.board:
        first = next(iter(game.board))
        hint = "Type plan for your bookings." if game.active else "Try plan ID before booking."
        lines += ["", f"Read brief {first:02}. {hint} Type help for all commands."]
    return "\n".join(lines)


def slip_line(game: Game, gig: Gig, source: str) -> str:
    filed = " (already cited)" if (gig.number, source) in game.filed else ""
    return f"{source.title()}{filed} / {getattr(gig.trail, source)}"


def open_notice_terms(game: Game, offer: Contract) -> list[str]:
    gig = offer.gig
    number = gig.number
    cutoff = game.file_cutoff(gig)
    lines = []
    if number in game.holds:
        lines.append(f"Overnight hold signed. The notice stays open through {due_label(cutoff)}.")
    elif cutoff < gig.due:
        lines.append(f"The unclaimed notice leaves the board at {due_label(cutoff)}.")
        if not game.hold_problem(gig):
            lines.append(f"Use hold {number:02} to keep the file open overnight.")
    if offer.blocks_needed(game.templates) > gig.due - game.clock:
        lines.append("Too little time remains to book this job. Its slips are still open for review.")
    elif len(game.active) == DESK_LIMIT:
        lines.append("Both desk slots are occupied. Finish a contract to book this one.")
    else:
        lines.append(f"Book with take {number:02}. You have {blocks(gig.due - game.clock)} until handoff.")
        if offer.can_reuse(game.templates):
            lines.append(f"Once booked, reuse {number:02} covers the first two steps in one block.")
        if warning := game.pressure(gig):
            lines.append(wrap(warning))
    return lines


def booked_terms(game: Game, contract: Contract) -> list[str]:
    number = contract.gig.number
    plan = game.schedule()
    if not contract.remaining:
        lines = [f"Ready. Use deliver {number:02}, or spend one block with polish {number:02}."]
    elif len(plan) == 1:
        action = "reuse" if plan[0].reuse else "work"
        lines = [f"{contract.workload(game.templates)} left. Continue with {action} {number:02}."]
    else:
        row = next(row for row in plan if row.gig.number == number)
        reuse = f" with reuse {number:02}" if row.reuse else ""
        lines = [f"{blocks(row.work_blocks)} left on the current plan{reuse}. Type plan for both handoffs."]
    if game.extended_job is None:
        extra, fee = contract.extension_terms()
        if extra:
            lines.append(wrap(f"Weekly extension / extend {number:02} moves handoff to "
                              f"{due_label(contract.due + extra)} for a revised fee of {money(fee)}."))
    elif contract.extra_blocks:
        lines.append(f"Extension signed. Original deadline {due_label(contract.gig.due)}.")
    if warning := schedule_warning(game.clock, plan):
        lines.append(wrap(warning))
    return lines


def brief_view(game: Game, gig: Gig) -> str:
    number = gig.number
    active = number in game.active
    contract = game.contract_for(gig)
    fee_label = "Locked fee" if active else "Offered fee"
    scope = f"{gig.brief.blocks} production step" + ("" if gig.brief.blocks == 1 else "s")
    lines = [f"NOTICE {number:02}  /  {gig.brief.field.upper()}", gig.brief.title,
             f"{fee_label} {money(contract.fee)}  |  {scope}  |  Due {due_label(contract.due)}"]
    if gig.repeat_of is not None:
        lines.append(f"Funded return brief from {gig.client}, following handoff {gig.repeat_of:02}.")
    lines += ["", wrap(gig.brief.scope), wrap(f'"{gig.trail.pitch}" - {gig.client}'), "", "CLIENT FILE"]
    for source in SOURCES:
        if (number, source) in game.checked:
            lines.append(wrap(slip_line(game, gig, source), "  "))
        else:
            lines.append(f"  {source.title()} slip unopened. Read with check {number:02} {source}.")
    if game.unread_slips(gig) and game.clock + 1 < game.file_cutoff(gig):
        lines.append(f"  Open the missing slips together with audit {number:02} for one block.")
    lines.append("")
    lines.extend(booked_terms(game, contract) if active else open_notice_terms(game, contract))
    return "\n".join(lines)


def plan_view(game: Game, extra: Gig | None = None) -> str:
    lines = [f"DESK PLAN  /  {clock_label(game.clock)}"]
    if extra is not None and extra.number not in game.active:
        game.validate_booking(game.contract_for(extra))
        lines.append(f"Preview with take {extra.number:02} / {extra.brief.title}")
    plan = game.schedule(extra)
    if not plan:
        return "\n".join(lines + ["  Your desk is clear. Try plan ID on an open notice."])
    warning = schedule_warning(game.clock, plan)
    if warning:
        lines += [wrap(warning), ""]
        for row in plan:
            template = " with template" if row.reuse else ""
            lines.append(f"  {row.gig.number:02}  {row.gig.brief.title} / {blocks(row.work_blocks)}"
                         f"{template} / due {due_label(row.due)}")
        if game.extended_job is None and any(job.due < WEEK for job in game.active.values()):
            lines.append("  Read a booked brief for the price of moving its deadline.")
        return "\n".join(lines)
    lines.append("Ready drafts ship first, then work runs in deadline order. Delivery is free.")
    for row in plan:
        number = row.gig.number
        lines += ["", f"  {number:02}  {row.gig.brief.title} / due {due_label(row.due)}"]
        for tick in range(row.start, row.finish):
            action = "reuse" if row.reuse and tick == row.start else "work"
            lines.append(f"    {clock_label(tick)}   {action} {number:02}")
        if row.finish == row.due:
            lines.append(f"    {due_label(row.due)}   automatic deadline handoff")
        else:
            lines.append(f"    {clock_label(row.finish)}   deliver {number:02}")
    return "\n".join(lines)


def portfolio_view(game: Game) -> str:
    lines = ["FIELD PORTFOLIO",
             "Polish a paid gig to file one template in its field. Each shelf holds one.",
             "Spend it with reuse ID to finish two matching steps in one block."]
    if not game.templates:
        return "\n".join(lines + ["", "  Your shelves are empty."])
    for field, origin in sorted(game.templates.items()):
        lines += ["", f"  {field} / {TEMPLATE_NAMES.get(field, 'Production template')}",
                  f"    Filed from {origin.number:02} / {origin.brief.title}"]
        for job in game.active.values():
            if job.gig.brief.field == field and job.can_reuse(game.templates):
                lines.append(f"    reuse {job.gig.number:02} / {job.gig.brief.title}")
    return "\n".join(lines)


def inbox_view(game: Game) -> str:
    lines = ["CLIENT INBOX"]
    available = [gig for gig in game.board.values() if gig.repeat_of is not None]
    if not available and not game.incoming:
        return "\n".join(lines + ["  No return offers in the mail.",
                                  "  A paid public handoff through Thursday earns a brief the next morning."])
    if available:
        lines += ["", "On the board now", NOTICE_HEADER]
        for gig in available:
            lines.extend(notice_rows(game, gig))
        lines.append("  Read brief ID or preview the booking with plan ID.")
    if game.incoming:
        opens = clock_label(day_close(game.clock))
        lines += ["", f"Arriving {opens}"]
        for gig in game.incoming:
            lines.append(f"  {gig.number:02}  {gig.brief.title} / {gig.client} from {gig.repeat_of:02}"
                         f" / base {money(gig.fee)} / due {due_label(gig.due)}")
        lines.append("  Each funded return has two steps. Your referral rate applies when booked.")
    return "\n".join(lines)


def invoice_lines(game: Game, entry: Entry) -> list[str]:
    number = entry.gig.number
    lines = [f"      Unpaid invoice {money(entry.unpaid_fee)}."]
    opened = [source for source in SOURCES if (number, source) in game.checked]
    for source in opened:
        lines.append(wrap(slip_line(game, entry.gig, source), "      "))
    if not opened:
        lines.append("      No evidence slips kept before handoff.")
    elif not game.complete:
        if paid := game.paid_claim:
            lines.append(f"      Weekly protection payment used on invoice {paid.gig.number:02}.")
            return lines
        commands = [f"claim {number:02} {s}" for s in opened if (number, s) not in game.filed]
        if commands:
            lines.append(wrap(f"For a protection payment of {money(entry.claim_value)}, cite the slip "
                              f"that shows the breach. Use {' or '.join(commands)}. Filing takes one block.",
                              "      "))
        else:
            lines.append("      The desk has ruled on every slip kept for this invoice.")
    return lines


def journal_view(game: Game) -> str:
    lines = ["WEEK JOURNAL"]
    if not game.ledger:
        return "\n".join(lines + ["  Your first handoff or confirmed report will appear here."])
    for entry in game.ledger:
        detail = [entry.kind]
        if entry.amount:
            detail.append(money(entry.amount))
        if entry.stars is not None:
            detail.append(f"{entry.stars}/5")
        lines.append(f"  {entry.gig.number:02}  {entry.gig.brief.title}  /  {'  /  '.join(detail)}")
        lines.append(wrap(entry.attributed_note, "      "))
        if entry.kind == "Unpaid":
            lines.extend(invoice_lines(game, entry))
    return "\n".join(lines)


def statement(game: Game) -> str:
    rating = "unrated" if game.rating is None else f"{game.rating:.2f}/5"
    labels = (f"Fees banked       {money(game.cash)} of {money(CASH_TARGET)}",
              f"Public rating     {rating} (target {RATING_TARGET:.1f}/5)",
              f"Confirmed reports {game.reports} (target 1)")
    goals = [f"  [{'x' if met else ' '}] {label}" for met, label in zip(game.targets, labels)]
    verdict = ("Week won. You earned a place on next week's roster." if all(game.targets)
               else f"Week closed with {sum(game.targets)} of 3 targets met.")
    return "\n".join(["FRIDAY STATEMENT", verdict, "", *goals, "", journal_view(game), "",
                      f"Week seed {game.seed}. Run python play.py for a fresh board."])


DESK_VIEWS = {
    "board": board_view, "inbox": inbox_view, "journal": journal_view, "portfolio": portfolio_view,
}


def play(game: Game, stdin: TextIO, stdout: TextIO, save_path: Path, resumed: bool = False) -> None:
    def show(message: str) -> None:
        print(message, file=stdout, flush=True)

    show(f"{TITLE}   /   FREELANCE DESK\n{'Resumed week' if resumed else 'Week seed'} {game.seed}")
    if game.complete:
        show(statement(game))
        return
    show(wrap(INTRO) + "\n")
    show(board_view(game))
    while not game.complete:
        if stdin.isatty():
            print(f"\n{clock_label(game.clock)} > ", end="", file=stdout, flush=True)
        try:
            line = stdin.readline()
        except KeyboardInterrupt:
            show("\nDesk closed.")
            return
        if line == "":
            show("\nDesk closed.")
            return
        words = line.strip().lower().split()
        if not words:
            continue
        verb = words[0]
        try:
            if len(words) != 1 and (verb in DESK_VIEWS or verb in ("help", "?", "save", "quit")):
                raise RuleError(f"Use {verb} on its own.")
            if verb == "quit":
                show("Desk closed.")
                return
            if verb in ("help", "?"):
                show(HELP)
            elif verb in DESK_VIEWS:
                show(DESK_VIEWS[verb](game))
            elif verb == "brief":
                if len(words) != 2:
                    raise RuleError("Use brief ID.")
                show(brief_view(game, game.listing(read_number(words[1]))))
            elif verb == "plan":
                if len(words) > 2:
                    raise RuleError("Use plan or plan ID.")
                extra = game.listing(read_number(words[1])) if len(words) == 2 else None
                show(plan_view(game, extra))
            elif verb == "save":
                save_game(game, save_path)
                show(f"Week saved to {save_path.name}. Resume with python play.py --resume.")
            else:
                before = game.clock
                for message in game.act(line):
                    show(wrap(message))
                if game.complete:
                    show("\n" + statement(game))
                elif before // BLOCKS_PER_DAY != game.clock // BLOCKS_PER_DAY:
                    show("\n" + board_view(game))
                elif game.clock != before or verb in ("deliver", "extend"):
                    show(status(game))
                    if warning := game.pressure():
                        show(wrap(warning))
        except (RuleError, SaveError) as exc:
            show(wrap(str(exc)))


def seed_arg(value: str) -> int:
    try:
        seed = int(value, 10)
        if 0 <= seed <= MAX_SEED:
            return seed
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(f"choose an integer from 0 through {MAX_SEED}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Play a five-day freelance job board simulator.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--seed", type=seed_arg, help="replay a particular week's board")
    mode.add_argument("--resume", action="store_true", help="continue the local saved week")
    args = parser.parse_args()
    if args.resume:
        try:
            game = load_game(SAVE_PATH)
        except SaveError as exc:
            print(str(exc), file=sys.stderr)
            return 1
    else:
        seed = args.seed if args.seed is not None else secrets.randbelow(MAX_SEED + 1)
        game = Game(seed)
    play(game, sys.stdin, sys.stdout, SAVE_PATH, resumed=args.resume)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
