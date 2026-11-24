"""Plain ASCII scoreboards shared by live matches, saved frames, and playback."""

from collections import Counter, defaultdict

from .battle import (
    BEACON_GOAL, BEACON_MAX, BEACON_MIN, FAR_TOWER, MAX_ENERGY, SIGNAL_TICKS, TICKS_PER_SECOND,
    Event, Frame, Lane, Mode, Piece, Side, beacon_occupants, signal_at, zone_occupants,
)
from .cards import CARDS, DECKS


def clock_text(tick: int) -> str:
    seconds, remainder = divmod(tick, TICKS_PER_SECOND)
    return f"{seconds // 60}:{seconds % 60:02d}.{remainder * 10 // TICKS_PER_SECOND}"


def event_line(event: Event) -> str:
    return f"  {clock_text(event.tick):>6}  {event.text}"


def _cell(pieces: list[Piece]) -> str:
    if not pieces:
        return "."
    first = pieces[0]
    if any(p.side != first.side for p in pieces):
        return "><"
    troop = CARDS[first.card].troop
    assert troop is not None
    mark = troop.mark if first.side == Side.AMBER else troop.mark.lower()
    if len(pieces) == 1:
        return mark
    if len(pieces) <= 9 and all(p.card == first.card for p in pieces):
        return f"{mark}{len(pieces)}"
    return mark + "+"


def _energy(side: Side, value: int) -> str:
    bar = "#" * value + "." * (MAX_ENERGY - value)
    return f"{side.label.upper()} [{bar}] {value:>2}/{MAX_ENERGY}"


def _control(occupants: set[Side]) -> str:
    if len(occupants) == 1:
        holder, = occupants
        return f"{holder.label} holds"
    return "contested" if occupants else "open"


def _cart_track(frame: Frame, lane: Lane) -> str:
    cell = frame.carts[lane]
    marks = ["@ " if i == cell else "  " for i in range(1, FAR_TOWER)]
    left = "@" if cell == Side.AMBER.base else ""
    right = "@" if cell == Side.INDIGO.base else ""
    control = _control(zone_occupants(frame.pieces, lane, cell))
    return f"  Cart   {left:>3} | {' '.join(marks)} | {right:<3} Cell {cell}, {control}"


def _hand(frame: Frame, side: Side, selected: int | None) -> list[str]:
    slots = []
    for index, key in enumerate(frame.hands[side]):
        card = CARDS[key]
        marker = ">" if index == selected else " "
        slots.append(f"{marker}[{index + 1}] {card.name} ({card.cost})")
    upcoming = CARDS[frame.next_draw[side]]
    return [f"{side.label.upper()} HAND   (energy cost)    Next draw  {upcoming.name} ({upcoming.cost})",
            f"{slots[0]:<25} {slots[1]}", f"{slots[2]:<25} {slots[3]}"]


def board(frame: Frame, mode: str, *, selected: int | None = None,
          both_hands: bool = False) -> str:
    lit = signal_at(frame.tick if frame.outcome is None else frame.tick - 1)
    signal_left = (SIGNAL_TICKS - frame.tick % SIGNAL_TICKS) / TICKS_PER_SECOND
    cells: dict[tuple[Lane, int], list[Piece]] = defaultdict(list)
    for piece in frame.pieces:
        cells[piece.lane, piece.cell].append(piece)

    lines = [
        f"GUTTERLIGHT RELAY  /  {mode}     Kowloon Tong night shift",
        f"Beat {frame.tick}/{frame.limit_ticks}    "
        f"{clock_text(frame.tick)} / {clock_text(frame.limit_ticks)}    Seed {frame.seed}",
        _energy(Side.AMBER, frame.energy[Side.AMBER]) + "     "
        + _energy(Side.INDIGO, frame.energy[Side.INDIGO]),
    ]
    if frame.mode is not Mode.CONVOY:
        lines.append("")
    lines.append("        AMBER TOWER >                       < INDIGO TOWER")
    for lane in Lane:
        marks = []
        for cell in range(1, FAR_TOWER):
            mark = _cell(cells[lane, cell])
            if (mark == "." and frame.mode is Mode.BEACON and lane == lit
                    and BEACON_MIN <= cell <= BEACON_MAX):
                mark = "*"
            marks.append(f"{mark:^2}")
        track = " ".join(marks)
        lines.append(
            f"  {lane.label:<5}  {frame.hull[Side.AMBER][lane]:>3} | {track} | "
            f"{frame.hull[Side.INDIGO][lane]:<3}"
        )
        if frame.mode is Mode.CONVOY:
            lines.append(_cart_track(frame, lane))
    legend = "Upper/lower = Amber/Indigo   2-9/+ = group   >< = clash"
    if frame.mode is Mode.CONVOY:
        legend = f"Convoy @ to far tower  {legend}"
    lines.append(f"  {legend}")
    if frame.outcome is None:
        lines.append(f"  Signal {lit.label.upper()}  |  forward launch for {signal_left:g}s")
    if frame.mode is Mode.BEACON:
        hold = _control(beacon_occupants(frame.pieces, lit))
        amber, indigo = frame.charge
        lines.append(f"  Beacon {lit.label.upper()} (*) {hold}  |  "
                     f"Charge  Amber {amber}/{BEACON_GOAL}  Indigo {indigo}/{BEACON_GOAL}")

    lines.extend(["", *_hand(frame, Side.AMBER, selected)])
    if both_hands:
        lines.extend(_hand(frame, Side.INDIGO, None))
    # A finishing frame puts its final event in the result line below.
    wire = frame.recent[:-1] if frame.outcome else frame.recent
    lines.extend(["", "RELAY WIRE", *(event_line(event) for event in wire)])
    if frame.outcome:
        lines.append(f"RESULT  {frame.outcome.text}")
    return "\n".join(lines)


def catalog() -> str:
    lines = ["GUTTERLIGHT RELAY  /  DISPATCH MANUAL", "", "KEY       MARK  COST  CARD"]
    for card in CARDS.values():
        mark = card.troop.mark if card.troop else "-"
        lines.append(f"{card.key:<9}  {mark}     {card.cost}   {card.name}")
        lines.append(f"          {card.description}")
    lines.extend(["", "EIGHT-CARD DECKS"])
    for name, keys in DECKS.items():
        lines.append(name.upper())
        for offset in (0, 4):
            lines.append("  " + ", ".join(CARDS[k].name for k in keys[offset:offset + 4]))
    return "\n".join(lines)


def deck_sheet(keys: tuple[str, ...]) -> str:
    cards = [CARDS[key] for key in keys]
    crews = sum(card.troop is not None for card in cards)
    average = sum(card.cost for card in cards) / len(cards)
    lines = ["GUTTERLIGHT RELAY  /  DECK WORKSHOP", "",
             f"Average cost  {average:.2f} energy    Crews {crews}    Orders {len(cards) - crews}",
             "", "KEY       COST  CARD"]
    for card in cards:
        lines.append(f"{card.key:<9}  {card.cost}    {card.name}")
    lines.extend(["", "ENERGY CURVE"])
    for cost, count in sorted(Counter(card.cost for card in cards).items()):
        lines.append(f"  {cost} energy  {'#' * count}  ({count})")
    return "\n".join(lines)
