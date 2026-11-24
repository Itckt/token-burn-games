"""Campaign rules. One tick is one two-hour working block."""

from __future__ import annotations

from .accounts import Entry, handoff_receipt, money
from .commissions import make_week, return_brief
from .schedule import (
    BLOCKS_PER_DAY, DAYS, WEEK, Contract, Gig, PlannedJob, blocks, clock_label,
    day_close, due_label, plan_jobs, schedule_warning,
)


DAILY_CHECKS = 2
DESK_LIMIT = 2
CASH_TARGET = 1200
RATING_TARGET = 4.5
REFERRAL = 60
MAX_SEED = 2**32 - 1
SOURCES = ("funds", "terms")
ACTION_USAGE = {
    "take": "take ID", "work": "work ID", "deliver": "deliver ID",
    "polish": "polish ID", "check": "check ID funds|terms",
    "report": "report ID funds|terms", "wait": "wait", "end": "end",
    "audit": "audit ID", "reuse": "reuse ID", "extend": "extend ID",
    "hold": "hold ID", "claim": "claim ID funds|terms",
}


class RuleError(ValueError):
    """An action the desk cannot carry out. The state stays as it was."""


def read_number(word: str) -> int:
    if not (word.isascii() and word.isdigit() and 1 <= len(word) <= 2 and int(word) > 0):
        raise RuleError("Use a numeric gig ID from the board, such as 01.")
    return int(word)


class Game:
    def __init__(self, seed: int):
        if type(seed) is not int or not 0 <= seed <= MAX_SEED:
            raise ValueError(f"Choose a whole-number seed from 0 through {MAX_SEED}.")
        self.seed = seed
        self.week = make_week(seed)
        self.clock = 0
        self.board = {g.number: g for g in self.week[0]}
        self.active: dict[int, Contract] = {}
        self.checks_left = DAILY_CHECKS
        self.checked: set[tuple[int, str]] = set()
        self.filed: set[tuple[int, str]] = set()
        self.ledger: list[Entry] = []
        self.templates: dict[str, Gig] = {}
        self.extended_job: int | None = None
        self.holds: dict[int, int] = {}  # Notice ID to the closing tick it can carry over.
        self.incoming: list[Gig] = []
        self.moves: list[str] = []

    @property
    def complete(self) -> bool:
        return self.clock == WEEK

    @property
    def cash(self) -> int:
        return sum(entry.amount for entry in self.ledger)

    @property
    def reviews(self) -> list[Entry]:
        return [entry for entry in self.ledger if entry.stars is not None]

    @property
    def rating(self) -> float | None:
        stars = [entry.stars for entry in self.ledger if entry.stars is not None]
        return sum(stars) / len(stars) if stars else None

    @property
    def reports(self) -> int:
        return sum(entry.kind in ("Reported", "Recovered") for entry in self.ledger)

    @property
    def paid_claim(self) -> Entry | None:
        return next((entry for entry in self.ledger if entry.kind == "Recovered"), None)

    @property
    def referral(self) -> int:
        if len(self.reviews) >= 2 and (self.rating or 0) >= RATING_TARGET:
            return REFERRAL
        return 0

    @property
    def targets(self) -> tuple[bool, bool, bool]:
        return self.cash >= CASH_TARGET, (self.rating or 0) >= RATING_TARGET, self.reports >= 1

    def listing(self, number: int) -> Gig:
        if number in self.active:
            return self.active[number].gig
        if number in self.board:
            return self.board[number]
        raise RuleError(f"Gig {number:02} is closed or unavailable. Type board to see open IDs.")

    def quote(self, gig: Gig) -> int:
        return self.contract_for(gig).fee

    def contract_for(self, gig: Gig) -> Contract:
        """Return the booking, or the terms currently offered on the board."""
        if gig.number in self.active:
            return self.active[gig.number]
        return Contract(gig, gig.fee + self.referral)

    def schedule(self, extra: Gig | None = None) -> list[PlannedJob]:
        jobs = list(self.active.values())
        if extra is not None and extra.number not in self.active:
            jobs.append(self.contract_for(extra))
        return plan_jobs(self.clock, jobs, self.templates)

    def pressure(self, extra: Gig | None = None) -> str:
        return schedule_warning(self.clock, self.schedule(extra))

    def act(self, line: str) -> list[str]:
        words = line.lower().split()
        if self.complete:
            raise RuleError("The week has closed.")
        if not words or words[0] not in ACTION_USAGE:
            raise RuleError("Unknown action. Type help for the command list.")
        verb = words[0]
        if len(words) != len(ACTION_USAGE[verb].split()):
            raise RuleError(f"Use {ACTION_USAGE[verb]}.")
        previous_rate = self.referral
        if verb in ("wait", "end"):
            messages = self._pass_time(verb)
        else:
            number = read_number(words[1])
            words[1] = str(number)
            if len(words) == 3 and words[2] not in SOURCES:
                raise RuleError("Choose funds or terms as the evidence source.")
            if verb == "claim":
                messages = self._claim(number, words[2])
            elif verb == "report":
                messages = self._report(self.listing(number), words[2])
            elif verb == "check":
                gig = self.listing(number)
                source = words[2]
                if (number, source) in self.checked:
                    return [self._slip(gig, source), "Already on file. Reading it again is free."]
                messages = self._check(gig, source)
            else:
                messages = self._job_action(verb, self.listing(number))
        self.moves.append(" ".join(words))
        if not self.complete and self.referral != previous_rate:
            if self.referral:
                messages.append(f"Referral rate earned. Open quotes now include {money(REFERRAL)} extra.")
            else:
                messages.append("Your public average fell below the referral rate.")
        return messages

    def _pass_time(self, verb: str) -> list[str]:
        count = 1 if verb == "wait" else day_close(self.clock) - self.clock
        messages = [f"Passed {blocks(count)}."]
        for _ in range(count):
            messages.extend(self._tick())
        return messages

    def _job_action(self, verb: str, gig: Gig) -> list[str]:
        if verb == "take":
            return self._take(gig)
        if verb == "audit":
            return self._audit(gig)
        if verb == "hold":
            return self._hold(gig)
        contract = self.active.get(gig.number)
        if contract is None:
            raise RuleError(f"Take gig {gig.number:02} before working on it.")
        if verb == "extend":
            return self._extend(contract)
        if verb in ("work", "reuse"):
            return self._work(contract, reuse=verb == "reuse")
        return self._handoff(contract, polished=verb == "polish")

    def validate_booking(self, contract: Contract) -> None:
        if contract.gig.number in self.active:
            raise RuleError("This contract is already on your desk.")
        if len(self.active) == DESK_LIMIT:
            raise RuleError("Both desk slots are occupied. Finish a contract to open a slot.")
        needed = contract.blocks_needed(self.templates)
        available = contract.due - self.clock
        if needed > available:
            raise RuleError(f"This job needs {blocks(needed)}. Only {blocks(available)} available "
                            "before the deadline.")

    def _take(self, gig: Gig) -> list[str]:
        contract = self.contract_for(gig)
        self.validate_booking(contract)
        self.active[gig.number] = contract
        del self.board[gig.number]
        first = "reuse" if contract.can_reuse(self.templates) else "work"
        next_step = f"Start with {first} {gig.number:02}." if len(self.active) == 1 else "Type plan for both jobs."
        messages = [f"Booked {gig.number:02} / {gig.brief.title}. Fee locked at {money(contract.fee)}.",
                    f"Due {due_label(contract.due)}. {next_step}"]
        warning = self.pressure()
        if warning:
            messages.append(warning)
        return messages

    def hold_problem(self, gig: Gig) -> str:
        close = day_close(self.clock)
        if gig.number in self.active:
            return "This job is already booked. A hold is for an open notice."
        if gig.number in self.holds:
            return "This notice already has an overnight hold."
        if close == WEEK:
            return "The desk closes for the week on Friday. There is no overnight hold today."
        if gig.due <= close:
            return "This notice reaches its deadline by today's close."
        if close in self.holds.values():
            return "Today's overnight hold has been used."
        return ""

    def _hold(self, gig: Gig) -> list[str]:
        if problem := self.hold_problem(gig):
            raise RuleError(problem)
        self.holds[gig.number] = day_close(self.clock)
        return [f"Held {gig.number:02} through {due_label(self.file_cutoff(gig))}. "
                "Book later to lock the fee and use a desk slot."]

    def _extend(self, contract: Contract) -> list[str]:
        if self.extended_job is not None:
            raise RuleError(f"This week's extension went to gig {self.extended_job:02}.")
        extra, fee = contract.extension_terms()
        if not extra:
            raise RuleError("This contract is already due at Friday close.")
        self.extended_job = contract.gig.number
        contract.extra_blocks = extra
        contract.fee = fee
        return [f"Amended {contract.gig.number:02}. New deadline {due_label(contract.due)}. "
                f"New locked fee {money(fee)}."]

    @staticmethod
    def _slip(gig: Gig, source: str) -> str:
        return f"{source.title()} slip / {getattr(gig.trail, source)}"

    def _check(self, gig: Gig, source: str) -> list[str]:
        if self.checks_left == 0:
            message = "Both checks are used. The desk issues two each morning."
            if self.clock + 1 < self.file_cutoff(gig):
                message += f" Use audit {gig.number:02} to open the missing slips for one block."
            raise RuleError(message)
        self.checked.add((gig.number, source))
        self.checks_left -= 1
        return [self._slip(gig, source), f"Checks left today / {self.checks_left}"]

    def file_cutoff(self, gig: Gig) -> int:
        """Last tick when this notice or booked contract can resolve."""
        if gig.number in self.active:
            return self.active[gig.number].due
        if gig.number in self.holds:
            return min(gig.due, self.holds[gig.number] + BLOCKS_PER_DAY)
        return min(gig.due, day_close(self.clock))

    def unread_slips(self, gig: Gig) -> list[str]:
        return [source for source in SOURCES if (gig.number, source) not in self.checked]

    def _audit(self, gig: Gig) -> list[str]:
        missing = self.unread_slips(gig)
        if not missing:
            raise RuleError("Both slips are already on file. Read them in the brief.")
        if self.clock + 1 >= self.file_cutoff(gig):
            hint = ("An unused daily check can open a slip immediately." if self.checks_left
                    else "Both daily checks have been spent.")
            raise RuleError(f"The file closes before you could use the audit. {hint}")
        messages = [f"Audit completed on {gig.number:02}. Filed {len(missing)} new "
                    f"{'slip' if len(missing) == 1 else 'slips'} in one work block."]
        for source in missing:
            self.checked.add((gig.number, source))
            messages.append(self._slip(gig, source))
        messages.extend(self._tick())
        return messages

    def _cite(self, gig: Gig, source: str, *, archived: bool = False) -> bool:
        key = (gig.number, source)
        if key not in self.checked:
            if archived:
                raise RuleError(f"The {source} slip was never opened before handoff. "
                                "The journal lists the slips you kept.")
            raise RuleError(f"Read the slip first with check {gig.number:02} {source}.")
        if key in self.filed:
            raise RuleError("The desk has already ruled on that slip.")
        self.filed.add(key)
        return gig.trail.breach == source

    def _report(self, gig: Gig, source: str) -> list[str]:
        if self._cite(gig, source):
            self.board.pop(gig.number, None)
            self.active.pop(gig.number, None)
            self.ledger.append(Entry(gig, "Reported", 0, None, gig.trail.finding))
            messages = [f"Report confirmed on {gig.number:02}. The listing has been pulled.",
                        gig.trail.finding]
        else:
            messages = [f"Report unsubstantiated. The {source} slip on {gig.number:02} "
                        "supports no violation. The filing used one block."]
        messages.extend(self._tick())
        return messages

    def _claim(self, number: int, source: str) -> list[str]:
        if paid := self.paid_claim:
            raise RuleError(f"The weekly protection payment went to invoice {paid.gig.number:02}.")
        for index, invoice in enumerate(self.ledger):
            if invoice.gig.number == number and invoice.kind == "Unpaid":
                break
        else:
            raise RuleError(f"No unpaid handoff for {number:02}. See journal for open invoices.")
        if self._cite(invoice.gig, source, archived=True):
            receipt = invoice.recover(source)
            self.ledger[index] = receipt
            messages = [f"Claim upheld on {number:02}. Recovered {money(receipt.amount)}. "
                        "One confirmed report entered in the journal."]
        else:
            messages = [f"Claim unsubstantiated. The {source} slip on {number:02} "
                        "supports no violation. The filing used one block."]
        messages.extend(self._tick())
        return messages

    def _work(self, contract: Contract, reuse: bool) -> list[str]:
        gig = contract.gig
        if not contract.remaining:
            raise RuleError("The draft is ready. Deliver it now or spend a block on polish.")
        count = 1
        messages = []
        if reuse:
            if contract.remaining < 2:
                raise RuleError("Reuse needs two unfinished steps on this job.")
            field = gig.brief.field
            if field not in self.templates:
                raise RuleError(f"No {field} template is on file. Polish a paid {field} gig to earn one.")
            origin = self.templates.pop(field)
            messages.append(f"Used the {field} template from {origin.number:02} / {origin.brief.title}.")
            count = 2
        for step in gig.brief.steps[contract.finished:contract.finished + count]:
            messages.append(f"{gig.number:02} / {step}")
        contract.finished += count
        messages.extend(self._tick())
        if gig.number in self.active:
            if contract.remaining:
                messages.append(f"{contract.workload(self.templates)} of work still due.")
            else:
                messages.append(f"Draft ready. Use deliver {gig.number:02} to send it "
                                f"or polish {gig.number:02} for a final pass.")
        return messages

    def _handoff(self, contract: Contract, polished: bool) -> list[str]:
        if contract.remaining:
            raise RuleError(f"The draft needs {contract.workload(self.templates)} of work first.")
        if polished:
            return self._tick(polishing=contract)
        return self._settle(contract)

    def _tick(self, polishing: Contract | None = None) -> list[str]:
        # Settle the last block on the day it was worked before opening the next day.
        finish = self.clock + 1
        messages = []
        if polishing is not None:
            messages.extend(self._settle(polishing, polished=True))
        for contract in list(self.active.values()):
            if contract.due <= finish:
                if contract.remaining == 0:
                    messages.append(f"Deadline handoff for {contract.gig.number:02}.")
                messages.extend(self._settle(contract))
        self.board = {n: g for n, g in self.board.items() if self.file_cutoff(g) > finish}
        self.clock = finish
        if self.clock % BLOCKS_PER_DAY == 0:
            if self.complete:
                messages.append("Friday close. The week's books are in.")
            else:
                day = self.clock // BLOCKS_PER_DAY
                self.board.update((g.number, g) for g in self.week[day])
                self.checks_left = DAILY_CHECKS
                messages.append(f"{DAYS[day]} opening. Three fresh notices and two client checks.")
                if self.incoming:
                    self.board.update((g.number, g) for g in self.incoming)
                    messages.append("Return briefs arrived. Type inbox to read the offers.")
                    self.incoming.clear()
        return messages

    def _settle(self, contract: Contract, polished: bool = False) -> list[str]:
        gig = contract.gig
        del self.active[gig.number]
        entry, headline = handoff_receipt(contract, polished)
        self.ledger.append(entry)
        detail = entry.attributed_note
        if entry.stars is not None:
            detail += f", {entry.stars}/5"
        messages = [headline, detail]
        field = gig.brief.field
        if entry.kind == "Polished" and field not in self.templates:
            self.templates[field] = gig
            messages.append(f"{field} template filed. Type portfolio to see where it fits.")
        next_open = day_close(self.clock)
        if entry.amount and gig.repeat_of is None and next_open < WEEK:
            offer = return_brief(gig, next_open + BLOCKS_PER_DAY)
            self.incoming.append(offer)
            messages.append(f"{gig.client} requested a follow-up for {clock_label(next_open)}. See inbox.")
        if entry.kind == "Unpaid" and self.paid_claim is None:
            messages.append("See journal for the invoice and any evidence kept before handoff.")
        return messages
