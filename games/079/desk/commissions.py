"""The seeded public notices and funded return briefs issued by paying clients."""

from random import Random

from .catalog import BRIEFS, CLIENTS, CLEAR_TRAILS, RETURN_BRIEFS, RETURN_TRAIL, RISK_TRAILS
from .schedule import BLOCKS_PER_DAY, DAYS, WEEK, Gig


NOTICES_PER_DAY = 3
PUBLIC_NOTICES = NOTICES_PER_DAY * len(DAYS)
RETURN_FEE = 300


def make_week(seed: int) -> tuple[tuple[Gig, ...], ...]:
    rng = Random(seed)
    briefs_by_size = [
        rng.sample([b for b in BRIEFS if b.blocks == size], len(DAYS))
        for size in (1, 2, 3)
    ]
    clients = iter(rng.sample(CLIENTS, PUBLIC_NOTICES))
    risk_counts = [0, 1, 1, rng.choice((0, 1)), rng.choice((1, 2))]
    rng.shuffle(risk_counts)
    risk_files = iter(rng.sample(RISK_TRAILS, len(RISK_TRAILS)))
    clear_files = []
    week = []
    for day, risk_count in enumerate(risk_counts):
        briefs = [pool[day] for pool in briefs_by_size]
        rng.shuffle(briefs)
        risky_slots = rng.sample(range(len(briefs)), risk_count)
        board = []
        for slot, brief in enumerate(briefs):
            if slot in risky_slots:
                trail = next(risk_files)
            else:
                if not clear_files:
                    clear_files = rng.sample(CLEAR_TRAILS, len(CLEAR_TRAILS))
                trail = clear_files.pop()
            earliest = day * BLOCKS_PER_DAY + brief.blocks
            due = min(WEEK, earliest + rng.randint(0, 4))
            rush = 40 if due - earliest <= 1 else 0
            fee = brief.blocks * 10 * rng.randint(15, 21) + rush
            number = day * NOTICES_PER_DAY + slot + 1
            board.append(Gig(number, next(clients), brief, fee, due, trail))
        week.append(tuple(board))
    return tuple(week)


def return_brief(original: Gig, next_close: int) -> Gig:
    return Gig(PUBLIC_NOTICES + original.number, original.client, RETURN_BRIEFS[original.brief.field],
               RETURN_FEE, next_close, RETURN_TRAIL, repeat_of=original.number)
