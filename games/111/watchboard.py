"""ASCII map, watch board and field guide. Colour is optional throughout."""

from collections import Counter
from itertools import groupby
from textwrap import wrap

from spillway import (
    BROODS, CHARGE_MAX, DESIGNS, FINAL_WAVE, GATE_MAX, MEND_AMOUNT, MEND_COST,
    PADS, PULSE_COST, REACH_NAMES, REACH_STARTS, SIGNAL_KEYS, SIGNALS, TRACK, Game, Phase,
    RuleError, check_design, check_pad, footprint, pulse_power, reach_at, rehearse,
    wave_bonus, wave_plan,
)


WIDTH = 76
ARROWS = {(1, 0): ">", (-1, 0): "<", (0, 1): "v", (0, -1): "^"}


def ink(value: str, style: str, color: bool) -> str:
    return f"\x1b[{style}m{value}\x1b[0m" if color else value


def title(left: str, right: str, color: bool) -> str:
    gap = " " * max(2, WIDTH - len(left) - len(right))
    return ink(left, "1;36", color) + gap + ink(right, "1;33", color)


def map_rows(game: Game, color: bool = False, lit: tuple[int, ...] = ()) -> list[str]:
    width = max(x for x, _ in TRACK) + 1
    height = max(y for _, y in TRACK) + 1
    tiles = [["   " for _ in range(width)] for _ in range(height)]
    for i, (x, y) in enumerate(TRACK):
        neighbors = TRACK[max(0, i - 1):i] + TRACK[i + 1:i + 2]
        left = "-" if (x - 1, y) in neighbors else " "
        right = "-" if (x + 1, y) in neighbors else " "
        if i == len(TRACK) - 1:
            mark = "O"
        elif i in REACH_STARTS:
            mark = str(reach_at(i))
        else:
            nx, ny = TRACK[i + 1]
            mark = ARROWS[nx - x, ny - y]
        style = "36"
        if i in lit:
            mark, style = "*", "1;33"
        tiles[y][x] = ink(left + mark + right, style, color)

    for pad, (x, y) in PADS.items():
        tower = game.towers.get(pad)
        if tower:
            token = f"{pad}{DESIGNS[tower.kind].mark}{tower.level}"
            flashing = game.phase is Phase.WAVE and pad in game.fired
            tiles[y][x] = ink(token, "1;30;103" if flashing else "1;32", color)
        else:
            tiles[y][x] = ink(f"[{pad}]", "33", color)

    groups = {}
    for enemy in game.enemies:
        groups.setdefault(enemy.cell, []).append(enemy)
    for cell, group in groups.items():
        x, y = TRACK[cell]
        lead = max(group, key=lambda e: (e.kind == "crown", e.distance))
        mark = BROODS[lead.kind].mark
        token = f"({mark})" if len(group) == 1 else "{" + mark + "}"
        tiles[y][x] = ink(token, "1;35" if lead.kind == "crown" else "1;31", color)
    edge = "+" + "-" * (width * 3) + "+"
    return [edge, *("|" + "".join(row) + "|" for row in tiles), edge]


def side_panel(game: Game) -> list[str]:
    if game.phase is Phase.BUILD:
        number = game.wave + 1
        plan = wave_plan(number)
        counts = Counter(a.kind for a in plan)
        gap = plan[1].beat - plan[0].beat
        heading = f"WAVE {number:02} / " + ("BOSS TIDE" if number % 10 == 0 else "FORECAST")
        return [heading, "", *(f" {b.mark}  {b.name:<10} x{counts[k]}" for k, b in BROODS.items()
                                if counts[k]), f"One arrival every {gap} beats.",
                f"Clean rush   +{wave_bonus(number)} brass"]
    if game.phase is Phase.WAVE:
        counts = Counter(e.reach for e in game.enemies)
        heading = f"FLOW / BEAT {game.beat:03}" + (" / RUSH" if game.rush else "")
        panel = [heading, *(
            f" {i}  {name:<7} {counts[i]:>2} in reach" for i, name in enumerate(REACH_NAMES, 1)
        ), f" {len(game.arrivals)} still upstream", " Fired   " + (" ".join(game.fired) or "-")]
        boss = next((e for e in game.enemies if e.kind == "crown"), None)
        if boss:
            panel += [f" @  Crownwake  {boss.hp} HP", f"    Shell {boss.shell} / reach {boss.reach}"]
        else:
            lead = max(game.enemies, key=lambda e: e.distance, default=None)
            if lead:
                panel.append(f" Front   {BROODS[lead.kind].name} {lead.hp} HP")
            panel.append(f" Discharge hits for {pulse_power(game.wave)}.")
        return panel
    return ["SHIFT RECORD", "", f" {game.cleared} waves held", f" {game.kills} dispersed",
            f" {game.crowns} Crownwakes stopped"]


def combined_map(game: Game, panel: list[str], color: bool, lit: tuple[int, ...] = ()) -> list[str]:
    board = map_rows(game, color, lit)
    lines = []
    for i in range(max(len(board), len(panel))):
        left = board[i] if i < len(board) else " " * len(board[0])
        right = panel[i] if i < len(panel) else ""
        if i == 0:
            right = ink(right, "1;33", color)
        lines.append((left + "  " + right).rstrip())
    return lines


def signal_bar(game: Game) -> str:
    slots = []
    for key, kind in zip(SIGNAL_KEYS, game.deck):
        spent = game.phase is Phase.WAVE and kind in game.spent_signals
        cost = "spent" if spent else f"{SIGNALS[kind].cost} charge"
        slots.append(f"{key.upper()} {kind} ({cost})")
    if game.brace:
        slots.append(f"Gate brace {game.brace}")
    slowed = sum(e.slow > 0 for e in game.enemies)
    if slowed:
        slots.append(f"Slowed {slowed}")
    return "SIGNALS   " + "    ".join(slots)


def sluice_status(game: Game) -> str:
    if game.sluice is None:
        return "Sluice off"
    name = REACH_NAMES[game.sluice - 1]
    if game.phase is Phase.WAVE:
        state = "spent" if game.vented else "ready"
        return f"V {name} sluice ({state})"
    return f"{name} sluice armed for the next wave"


def workshop_prices(game: Game) -> list[str]:
    shop = "   ".join(f"{key} {d.tiers[0].price}" for key, d in DESIGNS.items())
    lines = [f"Build brass    {shop}    mend +{MEND_AMOUNT} gate {MEND_COST}"]
    if game.towers:
        prices = []
        for pad, tower in sorted(game.towers.items()):
            next_tier = tower.next_tier
            prices.append(f"{pad} {next_tier.price if next_tier else 'max'}")
        lines.append("Upgrade brass    " + "   ".join(prices))
    elif not game.cleared:
        lines.append("Hold the lamp for 20 waves. A Crownwake comes every tenth wave.")
    return lines


def frame(game: Game, *, live: bool = False, paused: bool = False,
          fast: bool = False, color: bool = False) -> str:
    on_wave = game.phase in (Phase.WAVE, Phase.LOST)
    number = f"{game.wave if on_wave else game.cleared:02}" + (" / OT" if game.overtime else f" / {FINAL_WAVE}")
    state = {
        Phase.BUILD: "WORKSHOP", Phase.WAVE: "PAUSED" if paused else ("ON WATCH" if live else "STEP WATCH"),
        Phase.WON: "WATCH COMPLETE", Phase.LOST: "GATE BREACHED",
    }[game.phase]
    header = title("WEIRLIGHT   /   Kowloon Tong spillway", state, color)
    gate = "|" * game.gate + "." * (GATE_MAX - game.gate)
    charge = "#" * game.charge + "." * (CHARGE_MAX - game.charge)
    counter = "WAVE" if on_wave else "HELD"
    lines = [header, "=" * WIDTH,
             f"GATE [{gate}] {game.gate:>2}/{GATE_MAX}   BRASS {game.brass:<4}   "
             f"CHARGE [{charge}] {game.charge}/{CHARGE_MAX}   {counter} {number}",
             "", *combined_map(game, side_panel(game), color),
             "1 Inlet -> 2 Basin -> 3 Sill -> O lamp       [A] pad / CP2 = C, Pinrail 2"]
    if game.phase is Phase.BUILD:
        lines += ["", *workshop_prices(game), signal_bar(game)]
        controls = ("build A pin | up A | sell A | look A | aim A heavy | deck | sluice | mend\n"
                    "forecast [rush] | drill [BEAT] | go | rush | report | save | help | quit")
    elif game.phase is Phase.WAVE:
        tip = ("A discharge strips the Crownwake's shell." if game.wave % 10 == 0
               else "Charge refills by one every five beats.")
        if game.rush:
            tip = ("Rush premium lost to a leak." if game.leaked else
                   f"Clean rush pays +{wave_bonus(game.wave)} brass.")
        lines += ["(r) Ripple   (s) Glasskate   (b) Ballast   (@) Crownwake   {r} stacked",
                  f"Discharge costs {PULSE_COST} charge. {tip}", signal_bar(game)]
        if live:
            speed = "3x" if fast else "1x"
            controls = f"1/2/3 discharge | J/K card | V vent | Space pause | . beat | F {speed} | Q quit"
        else:
            controls = "1/2/3 discharge | j/k card | v vent | Enter/step N | run | report | ? | quit"
    elif game.phase is Phase.WON:
        lines += ["", "Dawn reaches the lamp. The HKBU breakfast queue is just forming."]
        controls = "report | save | overtime (keep this defense) | quit (clock off)"
    else:
        controls = "End of watch."
    status = sluice_status(game) if game.sluice and game.phase in (Phase.BUILD, Phase.WAVE) else ""
    lines += [status, *wrap(game.notice, WIDTH), ink(controls, "1", color)]
    return "\n".join(lines)


def pad_view(game: Game, pad: str, kind: str | None, color: bool = False) -> str:
    game.require_build()
    check_pad(pad)
    tower = game.towers.get(pad)
    if kind is None:
        kind = tower.kind if tower else "pin"
    check_design(kind)
    if tower and kind != tower.kind:
        raise RuleError(f"{pad} holds a {DESIGNS[tower.kind].name}. Use 'look {pad}'.")
    design = DESIGNS[kind]
    level = tower.level if tower else 1
    tier = design.tiers[level - 1]
    covered = footprint(pad, tier.radius)
    panel = [f"{pad} / {design.name.upper()} {level}", "", f"Hit {tier.power} / range {tier.radius}",
             f"Fires every {tier.interval} beat" + ("s" if tier.interval != 1 else ""),
             f"Covers {len(covered)} road cells."]
    if kind == "coil":
        panel.append(f"Up to {tier.chain_limit} linked targets.")
    if tower:
        panel.append(f"Aim {tower.aim}")
        panel.append(f"Salvage {tower.refund} brass.")
        next_tier = tower.next_tier
        if next_tier:
            panel.append(f"Next tier {next_tier.price} brass.")
    else:
        panel.append(f"Build for {tier.price} brass.")
    return "\n".join([title("WEIRLIGHT   /   range survey", "WORKSHOP", color),
                      "=" * WIDTH, *combined_map(game, panel, color, covered),
                      "* marks first-shot range, counted in horizontal + vertical cells.", design.effect, "",
                      "Enter any workshop order, or press Enter for the watch board."])


def deck_view(game: Game, color: bool = False) -> str:
    lines = [title("WEIRLIGHT   /   signal deck", "TWO SLOTS", color), "=" * WIDTH,
             signal_bar(game), "",
             "Both slots draw from the discharge meter. Each card gets one play per wave.",
             "An empty net or a volley with no target costs nothing. Your cards stay ready.", ""]
    for kind, card in SIGNALS.items():
        lines += [f"{kind:<6}  {card.name:<16} {card.cost} charge", f"        {card.effect}", ""]
    if game.phase is Phase.BUILD:
        lines.append("Refit both slots with 'deck CARD CARD', e.g. 'deck echo brace'.")
    elif game.phase is Phase.WAVE:
        lines.append("Play j or k between beats. Press Enter to advance one beat.")
    return "\n".join(lines)


def sluice_view(game: Game, color: bool = False) -> str:
    return "\n".join([
        title("WEIRLIGHT   /   spillback sluice", "GATE CREW", color), "=" * WIDTH,
        sluice_status(game), "",
        "In the workshop, arm one reach with 'sluice 1', 'sluice 2' or 'sluice 3'.",
        "The setting carries over. Use 'sluice off' to disengage the crank.",
        "Press V once per wave to push enemies in the armed reach upstream.",
        "Ripples and Glasskates travel up to 3 cells. Ballasts and bare bosses move 1.",
        "The reach entrance stops the push. A Crownwake's shell anchors it in place.",
        "Opening costs no charge. An empty or anchored reach keeps the release ready.",
    ])


def drill_view(game: Game, vent_beat: int | None = None, color: bool = False) -> str:
    normal_trial = rehearse(game, rush=False, vent_beat=vent_beat)
    rush_trial = rehearse(game, rush=True, vent_beat=vent_beat)
    normal, rush = normal_trial.watch, rush_trial.watch
    row = "{:<27}{:>18}{:>18}".format
    lines = [title("WEIRLIGHT   /   tide drill", f"WAVE {normal.wave:02}", color), "=" * WIDTH,
             "Your current towers fire on both tides. Cards and discharges stay in hand.",
             row("", "STANDARD", "RUSH"),
             row("Lamp", "HELD" if normal.gate else "BREACHED", "HELD" if rush.gate else "BREACHED"),
             row("Gate remaining", normal.gate, rush.gate),
             row("First leak beat", normal_trial.first_leak or "-", rush_trial.first_leak or "-"),
             row("Slipped through", normal.leaked, rush.leaked),
             row("Brass earned", normal.brass - game.brass, rush.brass - game.brass),
             row("Final beat", normal.beat, rush.beat)]
    if vent_beat is not None:
        lines.append(row(f"Vent after beat {vent_beat}", normal_trial.vent_result, rush_trial.vent_result))
    if game.towers:
        lines.append(row("Pad / design", "KILLS", "KILLS"))
        for pad, tower in sorted(game.towers.items()):
            lines.append(row(f"{pad} / {DESIGNS[tower.kind].name} {tower.level}",
                             normal.pad_reports[pad].kills, rush.pad_reports[pad].kills))
    lines += ["", "'drill N' tests a sluice release after beat N. Launch with 'go' or 'rush'."]
    return "\n".join(lines)


def forecast_view(game: Game, *, rush: bool = False, color: bool = False) -> str:
    game.require_build()
    wave = game.wave + 1
    plan = wave_plan(wave, rush=rush)
    bonus = wave_bonus(wave)
    mode = "RUSH" if rush else "STANDARD"
    lines = [title("WEIRLIGHT   /   arrival sheet", f"WAVE {wave:02} / {mode}", color),
             "=" * WIDTH, f"{len(plan)} inbound. Hold the wave for {bonus} brass, plus kill bounties."]
    if rush:
        lines.append(f"Paired entries. Earn another {bonus} brass if nobody reaches the lamp.")
    else:
        lines.append("Single entries. Use 'forecast rush' to inspect the paired tide.")
    entries = []
    for beat, arrivals in groupby(plan, key=lambda a: a.beat):
        marks = "+".join(BROODS[a.kind].mark for a in arrivals)
        entries.append(f"{beat:02} {marks}")
    lines += ["", "ENTRY BEAT / BROODS"]
    for i in range(0, len(entries), 5):
        lines.append("".join(f"{entry:<13}" for entry in entries[i:i + 5]).rstrip())
    lines += ["", "   ".join(f"{b.mark} {b.name}" for b in BROODS.values())]
    if wave % 10 == 0:
        lines.append("The Crownwake raises a fresh shell each time it enters a reach.")
    command = "rush" if rush else "go"
    lines += ["", f"Launch with '{command}', or press Enter to return to the workshop."]
    return "\n".join(lines)


def report_view(game: Game, color: bool = False) -> str:
    if not game.wave:
        raise RuleError("Launch a wave to open its firing report.")
    mode = "RUSH" if game.rush else "STANDARD"
    columns = "{:<5} {:<18} {:<10} {:>5} {:>8} {:>8}"
    lines = [title("WEIRLIGHT   /   firing report", f"WAVE {game.wave:02} / {mode}", color),
             "=" * WIDTH, f"Through beat {game.beat}    Discharge kills {game.pulse_kills}"
             f"    Slipped through {game.leaked}    Sluice moved {game.vented}", "",
             columns.format("PAD", "DESIGN / TIER", "AIM", "SHOTS", "HITS", "KILLS")]
    for pad, row in sorted(game.pad_reports.items()):
        design = f"{DESIGNS[row.kind].name} {row.level}"
        lines.append(columns.format(pad, design, row.aim, row.shots, row.hits, row.kills))
    if not game.pad_reports:
        lines.append("No towers deployed.")
    lines += ["", "Echo shots count for the firing pad. Splash and links count each enemy hit.",
              "A kill goes to the pad or discharge that landed the final hit."]
    return "\n".join(lines)


def guide(game: Game, color: bool = False) -> str:
    lines = [title("WEIRLIGHT   /   field guide", "WATCH ORDERS", color), "=" * WIDTH,
             "Hold 20 waves. Every tenth brings a Crownwake. One boss leak ends the watch.",
             "Ripples and Glasskates cost 1 gate if they pass. A Ballast costs 2.",
             "WORKSHOP     build PAD TYPE   up PAD   sell PAD   look PAD [TYPE]   save",
             "             aim PAD front|heavy|pack   deck [CARD CARD]   mend (+3 for 12)",
             "             sluice [1|2|3|off]   drill [VENT_BEAT]   forecast [rush]",
             "             go (standard)   rush (pairs)   report   quit",
             "Sell for 3/4 of the brass spent, rounded down. A clean rush doubles the bonus.",
             "DESIGN              PRICE BY TIER    HIT       RANGE     BEAT INTERVAL"]
    for key, design in DESIGNS.items():
        prices, hits, ranges, intervals = (
            "/".join(str(getattr(t, attr)) for t in design.tiers)
            for attr in ("price", "power", "radius", "interval")
        )
        lines.append(f" {key:<4} {design.name:<12} {prices:<16} {hits:<9} {ranges:<9} {intervals}")
    lines += ["Aim at the front, the heaviest hull + shell, or the largest pack (bell only).",
              "Bells splash 2 cells. Looms slow for 3 beats. Coils link 2/3/4 targets.",
              "IN A WAVE    1, 2 or 3 discharges the corresponding reach for 3 charge.",
              "Charge +1 every 5 beats. Discharge strips the shell a boss grows per reach.",
              "J/K play cards. V opens the armed sluice. Type 'deck' or 'sluice' for rules.",
              "Live keys    Space or P pause/resume   . paused beat   F speed   Q quit",
              "Step mode    Enter or step [1-999]   run (finish this wave)   quit",
              "Enter an order, or press Enter to return" +
              (" and advance one beat." if game.phase is Phase.WAVE else " to the board.")]
    return "\n".join(lines)
