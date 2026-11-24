"""Plain ASCII views shared by live matches, transcripts, and final frames."""

from itertools import zip_longest
from textwrap import wrap

from .arena import FOLD_INTERVAL
from .battle import STAMP_TARGET, Battle
from .fighters import Fighter
from .roster import CHARGE_CAP, COPPER, INDIGO, ROSTER
from .tactics import CARDS, DEFAULT_ORDER, INK_CAP


def _status(fighter: Fighter, exposed: bool) -> str:
    marker = "!" if exposed else " "
    hp = f"{fighter.hp:>2}/{fighter.hero.hp:<2}"
    if not fighter.alive:
        return f"{fighter.token}  {fighter.hero.name:<9} {hp}  OUT"
    charge = "[" + "+" * fighter.charge + "." * (CHARGE_CAP - fighter.charge) + "]"
    return f"{fighter.token}{marker} {fighter.hero.name:<9} {hp}  {charge}  {fighter.ward:>3}"


def _court(battle: Battle) -> list[str]:
    occupants = {f.pos: f.token for f in battle.fighters if f.alive}
    moving_objective = battle.courier or battle.rail
    marks = moving_objective.markers() if moving_objective is not None else {}
    if battle.mode == "press":
        marks = {p: "=" for p in battle.court.press_tiles if battle.on_press(p)}
    edge = "+" + "-" * (2 * battle.court.width + 1) + "+"
    rows = [edge]
    for y, terrain in enumerate(battle.court.tiles):
        cells = []
        for x, tile in enumerate(terrain):
            pos = (x, y)
            if pos in occupants:
                tile = occupants[pos]
            elif tile == "." and not battle.zone.contains(pos):
                tile = "!"
            elif pos in marks:
                tile = marks[pos]
            cells.append(tile)
        rows.append("| " + " ".join(cells) + " |")
    return [*rows, edge]


def _feed(notes: list[str]) -> list[str]:
    lines = []
    line = ""
    for note in notes:
        joined = f"{line}  |  {note}" if line else note
        if line and len(joined) > 76:
            lines.append("  " + line)
            line = note
        else:
            line = joined
    if line:
        lines.append("  " + line)
    return lines


def frame(battle: Battle) -> str:
    zone = battle.zone
    last_fold = battle.court.last_fold
    clock = f"Beat {battle.beat:02}/{battle.limit}   Fold {zone.level}/{last_fold}"
    next_fold = (zone.level + 1) * FOLD_INTERVAL
    if zone.level < last_fold and next_fold <= battle.limit and battle.result is None:
        clock += f"   Next fold {next_fold:02}"
    clock += f"   Fringe -{zone.damage} HP" if zone.level else "   Fringe off"
    title = f"PINCHLINE SIX   /   {battle.court.name}   /   seed {battle.seed}"
    lines = wrap(title, 80, break_on_hyphens=False) + wrap(clock, 80, break_on_hyphens=False)
    if battle.mode == "press":
        scores = "   ".join(f"{team} {total}/{STAMP_TARGET}" for team, total in battle.stamps.items())
        lines.append(f"Press Run   {scores}   = scoring tile")
    if battle.courier is not None:
        run = battle.courier
        if run.delivered_by is not None:
            status = f"{run.delivered_by.token} delivered for {run.delivered_by.team}"
        elif run.carrier is not None:
            status = f"{run.carrier.token} carries for {run.carrier.team}"
        else:
            status = f"Proof loose at {run.loose_at}"
        lines.extend([f"Courier Run   {status}",
                      "* proof   < Copper gate   > Indigo gate   = shared gate"])
    if battle.rail is not None:
        rail = battle.rail
        cx = battle.court.center[0]
        lines.extend([f"Rail Run   Roller {rail.offset:+d}   Stops {rail.west - cx:+d}/{rail.east - cx:+d}",
                      "@ roller   : rail   < Indigo finish   > Copper finish"])
    if any(order != DEFAULT_ORDER for order in battle.orders.values()):
        lines.append(f"Orders   Copper {battle.orders[COPPER]}   Indigo {battle.orders[INDIGO]}")
    for team, deck in battle.decks.items():
        hand = " > ".join(deck.remaining) or "spent"
        lines.append(f"{team} deck   Ink {deck.ink}/{INK_CAP}   {hand}")
    lines.append("")

    panel = []
    for team in (COPPER, INDIGO):
        panel.append(f"{team.upper():<15} HP   CHARGE   WARD")
        for fighter in battle.crew(team):
            exposed = fighter.alive and not zone.contains(fighter.pos)
            panel.append(_status(fighter, exposed))
        panel.append("")
    panel.extend([". floor    # baffle    ! fringe", "! beside a hero means exposed"])
    rows = _court(battle)
    for row, side in zip_longest(rows, panel, fillvalue=""):
        lines.append(f"{row:<{len(rows[0])}}   {side}".rstrip())
    lines.extend(["", *_feed(battle.notes)])
    if battle.result is not None:
        result = battle.result
        verdict = f"{result.winner} wins" if result.winner else "Draw"
        lines.extend(["", f"RESULT   {verdict} ({result.reason})."])
        scores = []
        for team in (COPPER, INDIGO):
            alive, hp = battle.score(team)
            scores.append(f"{team} {alive} up / {hp} HP")
        lines.append("         " + "    ".join(scores))
    return "\n".join(lines)


_OBJECTIVE_COLUMNS = {
    "press": ("Stamp", lambda s: s.scoring_beats, "Stamp counts scoring beats this hero spent on the press."),
    "courier": ("Carry", lambda s: s.carry_beats, "Carry counts beats this hero ended holding the proof."),
    "rail": ("Push", lambda s: s.pushes, "Push counts roller pushes this hero helped make."),
}


def match_report(battle: Battle) -> str:
    lines = ["MATCH REPORT"]
    header = "Hero          Pulse  Art  Power  Heal  Block  Edge"
    extra = _OBJECTIVE_COLUMNS.get(battle.mode)
    if extra:
        label, value, legend = extra
        header += f"  {label:>5}"
    for team in (COPPER, INDIGO):
        lines.extend(["", team.upper(), header])
        for fighter in battle.crew(team):
            stats = fighter.stats
            row = (f"{fighter.token} {fighter.hero.name:<10}  {stats.pulses:>5}  {stats.arts:>3}"
                   f"  {stats.power_sent:>5}  {stats.healing:>4}  {stats.blocked:>5}"
                   f"  {stats.fringe_beats:>4}")
            if extra:
                row += f"  {value(stats):>5}"
            lines.append(row)
    lines.extend(["", "Power counts outgoing damage before ward and HP limits.",
                  "Heal counts HP restored. Block counts damage caught by the hero's ward.",
                  "Edge counts beats spent in the fringe."])
    if extra:
        lines.append(legend)
    return "\n".join(lines)


def roster_view() -> str:
    lines = ["PINCHLINE SIX   /   Hero cards"]
    for hero in ROSTER.values():
        lines.extend([
            "",
            f"{hero.name:<10} {hero.role:<9} {hero.hp} HP   Pulse {hero.power} / range {hero.reach}",
            f"  {hero.art.value}   {hero.describe_art()}",
        ])
    return "\n".join(lines)


def card_view() -> str:
    lines = ["PINCHLINE SIX   /   Sideline cards",
             "Choose up to three different cards per crew, in play order.", ""]
    for name, card in CARDS.items():
        lines.append(f"{name:<7} {card.cost} ink   {card.description}")
    lines.extend(["", f"A deck with cards gains one ink per beat, up to {INK_CAP}.",
                  "The front card waits until it has the ink and a living target.",
                  "Ties follow draft order. Each card plays once."])
    return "\n".join(lines)
