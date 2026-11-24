"""Handoff receipts and the board's protection payment on a documented loss."""

from dataclasses import dataclass, replace

from .schedule import Contract, Gig


CLAIM_CAP = 150
STANDARD_REVIEWS = (
    "The agreed piece arrived on time and matched the brief.",
    "We put the delivery straight into production. Good work.",
    "A tidy handoff, with everything on our list accounted for.",
)


def money(amount: int) -> str:
    return f"HK${amount:,}"


@dataclass(frozen=True)
class Entry:
    gig: Gig
    kind: str
    amount: int
    stars: int | None
    note: str
    unpaid_fee: int = 0

    @property
    def attributed_note(self) -> str:
        if self.stars is None:
            return self.note
        return f'"{self.note}" - {self.gig.client}'

    @property
    def claim_value(self) -> int:
        return min(CLAIM_CAP, self.unpaid_fee // 2)

    def recover(self, source: str) -> "Entry":
        note = (f"Unpaid handoff. {self.note} The {source} slip substantiated the claim "
                f"against the locked fee of {money(self.unpaid_fee)}.")
        return replace(self, kind="Recovered", amount=self.claim_value, note=note)


def handoff_receipt(contract: Contract, polished: bool) -> tuple[Entry, str]:
    gig = contract.gig
    if contract.remaining:
        stars = None if gig.trail.breach else 1
        note = ("Our booking window passed before the finished piece arrived."
                if stars else "The booking expired without a delivery or a public review.")
        return (Entry(gig, "Missed", 0, stars, note),
                f"Missed deadline on {gig.number:02} / {gig.brief.title}.")
    if gig.trail.breach:
        return (Entry(gig, "Unpaid", 0, None, gig.trail.finding, unpaid_fee=contract.fee),
                f"Unpaid handoff on {gig.number:02}. The advertised fee fell through.")
    note = gig.brief.praise if polished else STANDARD_REVIEWS[gig.number % len(STANDARD_REVIEWS)]
    return (Entry(gig, "Polished" if polished else "Delivered", contract.fee, 5 if polished else 4, note),
            f"Paid {money(contract.fee)} for {gig.number:02} / {gig.brief.title}.")
