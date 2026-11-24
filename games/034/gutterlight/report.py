"""Account for accepted orders through a chosen replay beat."""

from collections import Counter
from dataclasses import dataclass, field
from itertools import zip_longest

from .battle import Lane, Mode, REGEN_TICKS, Side, repair_amount
from .cards import CARDS
from .display import clock_text
from .recording import Replay


@dataclass(slots=True)
class LaneTotals:
    plays: int = 0
    spent: int = 0
    deployed: int = 0
    lost: int = 0
    damage: int = 0
    repaired: int = 0


@dataclass(slots=True)
class SideTotals:
    lanes: tuple[LaneTotals, LaneTotals] = field(default_factory=lambda: (LaneTotals(), LaneTotals()))
    cards: Counter[str] = field(default_factory=Counter)
    missed_regen: int = 0


def totals_at(replay: Replay, tick: int) -> tuple[SideTotals, SideTotals]:
    current = replay.frame_at(tick)
    opening = replay.frames[0]
    totals = (SideTotals(), SideTotals())
    for index in range(tick):
        before = replay.frames[index]
        for side, move in zip(Side, replay.orders[index]):
            if move is None:
                continue
            card = CARDS[before.hands[side][move.slot]]
            lane = totals[side].lanes[move.lane]
            lane.plays += 1
            lane.spent += card.cost
            if card.troop:
                lane.deployed += card.troop.count
            if card.repair:
                lane.repaired += repair_amount(before.hull[side][move.lane], card)
            totals[side].cards[card.key] += 1

    survivors = Counter((piece.side, piece.lane) for piece in current.pieces)
    for side in Side:
        own = totals[side]
        spent = sum(lane.spent for lane in own.lanes)
        own.missed_regen = opening.energy[side] + tick // REGEN_TICKS - spent - current.energy[side]
        enemy = side.other
        for lane in Lane:
            row = own.lanes[lane]
            row.lost = row.deployed - survivors[side, lane]
            # A repair and a tower strike can land on the same beat. The net
            # change in hull alone would undercount damage dealt to that tower.
            row.damage = (opening.hull[enemy][lane] - current.hull[enemy][lane]
                          + totals[enemy].lanes[lane].repaired)
    return totals


def scouting_report(replay: Replay, tick: int, title: str = "REPLAY") -> str:
    totals = totals_at(replay, tick)
    frame = replay.frames[tick]
    lines = [
        f"GUTTERLIGHT RELAY  /  {title}  /  SCOUTING REPORT",
        f"Beat {tick}/{frame.limit_ticks}    {clock_text(tick)}    "
        f"{frame.mode.value.title()}    Seed {frame.seed}",
        "",
        "SIDE / LANE      PLAYS  SPENT  UNITS  LOST  HULL HIT  PATCHED",
    ]
    for side in Side:
        for lane in Lane:
            row = totals[side].lanes[lane]
            label = f"{side.label} / {lane.label}"
            lines.append(f"{label:<16} {row.plays:>5}  {row.spent:>5}  {row.deployed:>5}  "
                         f"{row.lost:>4}  {row.damage:>8}  {row.repaired:>7}")
    lines.extend(["", f"Amber / Indigo    Energy remaining {frame.energy[0]} / {frame.energy[1]}    "
                      f"Regen lost at cap {totals[0].missed_regen} / {totals[1].missed_regen}"])
    if frame.mode is Mode.BEACON:
        lines.append(f"Beacon charge     Amber {frame.charge[0]}   Indigo {frame.charge[1]}")
    if frame.mode is Mode.CONVOY:
        lines.append(f"Cart cells   Roof {frame.carts[Lane.ROOF]}   Canal {frame.carts[Lane.CANAL]}")
    lines.extend(["", "AMBER DISPATCHES  PLAYS    INDIGO DISPATCHES  PLAYS"])
    columns = [[f"{CARDS[key].name:<17} {count:>5}" for key, count in total.cards.most_common()]
               for total in totals]
    for amber, indigo in zip_longest(*columns, fillvalue=""):
        lines.append(f"{amber:<23}    {indigo}".rstrip())
    if not any(total.cards for total in totals):
        lines.append("No cards played yet.")
    if frame.outcome:
        lines.append(f"RESULT  {frame.outcome.text}")
    elif tick == replay.end:
        lines.append("END OF RECORDING  Match left in progress.")
    return "\n".join(lines)
