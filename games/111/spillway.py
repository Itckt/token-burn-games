"""Rules for Weirlight. One call to Game.tick advances one beat of the flood."""

from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from functools import lru_cache


GATE_MAX = 12
CHARGE_MAX = 6
PULSE_COST = 3
RECHARGE_BEATS = 5
MEND_COST = 12
MEND_AMOUNT = 3
FINAL_WAVE = 20
SPLASH_RADIUS = 2
SLOW_BEATS = 3
NET_BEATS = 5
BRACE_STRENGTH = 3
COIL_GAP = 3  # Road cells between consecutive links
REACH_NAMES = ("Inlet", "Basin", "Sill")
SIGNAL_KEYS = ("j", "k")


def make_track() -> tuple[tuple[int, int], ...]:
    corners = ((0, 1), (4, 1), (4, 5), (8, 5), (8, 1), (12, 1), (12, 4), (14, 4))
    cells = [corners[0]]
    for end_x, end_y in corners[1:]:
        x, y = cells[-1]
        dx = (end_x > x) - (end_x < x)
        dy = (end_y > y) - (end_y < y)
        while (x, y) != (end_x, end_y):
            x, y = x + dx, y + dy
            cells.append((x, y))
    return tuple(cells)


TRACK = make_track()
PADS = {
    "A": (2, 0), "B": (3, 3), "C": (5, 2), "D": (6, 4),
    "E": (7, 3), "F": (9, 2), "G": (11, 0), "H": (13, 3),
}


def reach_at(cell: int) -> int:
    """Split the road, in travel order, into the three discharge reaches."""
    return 1 + cell * 3 // len(TRACK)


REACH_STARTS = tuple(i for i in range(len(TRACK)) if i == 0 or reach_at(i) != reach_at(i - 1))


@lru_cache(maxsize=32)
def footprint(pad: str, radius: int) -> tuple[int, ...]:
    x, y = PADS[pad]
    return tuple(i for i, (cx, cy) in enumerate(TRACK)
                 if abs(x - cx) + abs(y - cy) <= radius)


@dataclass(frozen=True)
class Tier:
    price: int
    power: int
    radius: int
    interval: int
    chain_limit: int = 1


@dataclass(frozen=True)
class Design:
    name: str
    mark: str
    tiers: tuple[Tier, ...]
    effect: str


DESIGNS = {
    "pin": Design("Pinrail", "P", (
        Tier(18, 4, 2, 2), Tier(20, 6, 3, 2), Tier(32, 8, 3, 1),
    ), "One precise hit on the selected target."),
    "bell": Design("Washbell", "B", (
        Tier(24, 4, 2, 4), Tier(24, 7, 3, 4), Tier(36, 10, 3, 3),
    ), "Hits every unit within two road cells of its target."),
    "loom": Design("Silt Loom", "L", (
        Tier(20, 2, 3, 2), Tier(18, 4, 3, 2), Tier(30, 6, 4, 2),
    ), "Slows its target for three beats, even through a shell."),
    "coil": Design("Wickcoil", "W", (
        Tier(22, 3, 2, 3, 2), Tier(22, 5, 3, 3, 3), Tier(34, 7, 3, 2, 4),
    ), f"Links to the nearest unhit enemy within {COIL_GAP} road cells of the last hit."),
}


@dataclass
class Tower:
    kind: str
    level: int = 1
    cooldown: int = 0
    aim: str = "front"

    @property
    def tier(self) -> Tier:
        return DESIGNS[self.kind].tiers[self.level - 1]

    @property
    def next_tier(self) -> Tier | None:
        tiers = DESIGNS[self.kind].tiers
        return tiers[self.level] if self.level < len(tiers) else None

    @property
    def refund(self) -> int:
        spent = sum(t.price for t in DESIGNS[self.kind].tiers[:self.level])
        return spent * 3 // 4

    def choose_target(self, pad: str, enemies: list[Enemy]) -> Enemy | None:
        cells = footprint(pad, self.tier.radius)
        candidates = (e for e in enemies if e.hp > 0 and e.cell in cells)
        # max keeps the first arrival on an exact tie.
        if self.aim == "heavy":
            return max(candidates, key=lambda e: (e.hp + e.shell, e.distance), default=None)
        if self.aim == "pack":
            return max(candidates, key=lambda e: (len(e.splash_targets(enemies)), e.distance),
                       default=None)
        return max(candidates, key=lambda e: e.distance, default=None)

    def fire(self, pad: str, enemies: list[Enemy]) -> list[Enemy]:
        target = self.choose_target(pad, enemies)
        if target is None:
            return []
        if self.kind == "coil":
            hits = target.chain_targets(enemies, self.tier.chain_limit)
        elif self.kind == "bell":
            hits = target.splash_targets(enemies)
        else:
            hits = [target]
        for enemy in hits:
            enemy.hit(self.tier.power)
        if self.kind == "loom":
            target.slow_for(SLOW_BEATS)
        return hits


@dataclass
class PadReport:
    kind: str
    level: int
    aim: str
    shots: int = 0
    hits: int = 0
    kills: int = 0

    def record(self, hits: list[Enemy]) -> None:
        self.shots += 1
        self.hits += len(hits)
        self.kills += sum(e.hp <= 0 for e in hits)


@dataclass(frozen=True)
class Signal:
    name: str
    cost: int
    effect: str


SIGNALS = {
    "net": Signal("Slackwater Net", 2, f"Slow every enemy now on the road for {NET_BEATS} beats."),
    "echo": Signal("Echo Reel", 3, "Each tower with a target fires an extra shot, even during reload."),
    "brace": Signal("Cork Brace", 2, f"Absorb the next {BRACE_STRENGTH} gate damage. A Crownwake pierces the brace."),
}


@dataclass(frozen=True)
class Brood:
    name: str
    mark: str
    base_hp: int
    growth: int
    speed: int  # Half-cells per beat
    leak: int
    bounty: int

    def health(self, wave: int) -> int:
        return self.base_hp + self.growth * wave


BROODS = {
    "ripple": Brood("Ripple", "r", 5, 2, 2, 1, 1),
    "skate": Brood("Glasskate", "s", 3, 2, 3, 1, 1),
    "ballast": Brood("Ballast", "b", 10, 4, 1, 2, 3),
    "crown": Brood("Crownwake", "@", 55, 11, 1, GATE_MAX, 10),
}


def shell_strength(wave: int) -> int:
    return 6 + wave // 2


def pulse_power(wave: int) -> int:
    return 8 + wave // 3


@dataclass
class Enemy:
    kind: str
    hp: int
    distance: int = 0  # Half-cells from the inlet
    slow: int = 0
    shell: int = 0

    @classmethod
    def arrive(cls, kind: str, wave: int) -> Enemy:
        return cls(kind, BROODS[kind].health(wave),
                   shell=shell_strength(wave) if kind == "crown" else 0)

    @property
    def cell(self) -> int:
        return self.distance // 2

    @property
    def reach(self) -> int:
        return reach_at(self.cell)

    def hit(self, power: int) -> None:
        absorbed = min(self.shell, power)
        self.shell -= absorbed
        self.hp -= power - absorbed

    def slow_for(self, beats: int) -> None:
        self.slow = max(self.slow, beats)

    def advance(self, beat: int) -> None:
        speed = BROODS[self.kind].speed
        if self.slow:
            # Slowed heavies still gain half a cell on alternate beats.
            speed = speed - 1 if speed > 1 else beat % 2
            self.slow -= 1
        self.distance += speed

    def splash_targets(self, enemies: list[Enemy]) -> list[Enemy]:
        return [e for e in enemies if e.hp > 0 and abs(e.cell - self.cell) <= SPLASH_RADIUS]

    def chain_targets(self, enemies: list[Enemy], limit: int) -> list[Enemy]:
        hits = [self]
        remaining = [e for e in enemies if e is not self and e.hp > 0]
        while remaining and len(hits) < limit:
            last = hits[-1].distance
            # Pop by index so identical arrivals can each conduct exactly once.
            i = min(range(len(remaining)), key=lambda i: (
                abs(remaining[i].distance - last), -remaining[i].distance))
            if abs(remaining[i].distance - last) > 2 * COIL_GAP:
                break
            hits.append(remaining.pop(i))
        return hits

    def push_upstream(self) -> bool:
        if self.kind == "crown" and self.shell:
            return False
        cells = 1 if self.kind in ("ballast", "crown") else 3
        start = 2 * REACH_STARTS[self.reach - 1]
        old = self.distance
        self.distance = max(start, old - 2 * cells)
        return self.distance < old


@dataclass(frozen=True)
class Arrival:
    beat: int
    kind: str


def wave_bonus(wave: int) -> int:
    return 6 + wave // 3


def wave_plan(wave: int, *, rush: bool = False) -> tuple[Arrival, ...]:
    if wave < 1:
        raise ValueError("Wave numbers start at one.")
    count = min(18, 4 + (wave - 1) // 2)
    gap = max(2, 5 - wave // 4)
    kinds = []
    for i in range(count):
        if wave >= 4 and (i + wave) % 5 == 0:
            kinds.append("ballast")
        elif wave >= 2 and (i + wave) % 3 == 0:
            kinds.append("skate")
        else:
            kinds.append("ripple")
    if wave % 10 == 0:
        kinds.insert(count // 2, "crown")
    group_size = 2 if rush else 1
    return tuple(Arrival(1 + (i // group_size) * gap, kind) for i, kind in enumerate(kinds))


class Phase(Enum):
    BUILD = "Build"
    WAVE = "Wave"
    WON = "Watch complete"
    LOST = "Gate breached"


class RuleError(ValueError):
    """A player order that cannot be carried out in the current position."""


def check_pad(pad: str) -> None:
    if pad not in PADS:
        raise RuleError("Choose a lettered pad, A through H.")


def check_design(kind: str) -> None:
    if kind not in DESIGNS:
        raise RuleError("Choose a tower design from " + ", ".join(DESIGNS) + ".")


def check_reach(reach: int) -> None:
    if type(reach) is not int or reach not in (1, 2, 3):
        raise RuleError("Choose reach 1, 2 or 3.")


def check_aim(kind: str, mode: str) -> None:
    if mode not in ("front", "heavy", "pack"):
        raise RuleError("Choose front, heavy or pack (Washbells only).")
    if mode == "pack" and kind != "bell":
        raise RuleError("Only Washbells can aim for a pack.")


@dataclass
class Game:
    phase: Phase = Phase.BUILD
    wave: int = 0
    cleared: int = 0
    gate: int = GATE_MAX
    brass: int = 42
    charge: int = PULSE_COST
    beat: int = 0
    towers: dict[str, Tower] = field(default_factory=dict)
    fired: list[str] = field(default_factory=list)
    enemies: list[Enemy] = field(default_factory=list)
    arrivals: deque[Arrival] = field(default_factory=deque)
    kills: int = 0
    crowns: int = 0
    leaked: int = 0
    overtime: bool = False
    notice: str = "First watch? Try 'build C pin' and 'build F bell', then 'go'."
    deck: tuple[str, str] = ("net", "echo")
    spent_signals: set[str] = field(default_factory=set)
    brace: int = 0
    rush: bool = False
    pad_reports: dict[str, PadReport] = field(default_factory=dict)
    pulse_kills: int = 0
    sluice: int | None = None
    vented: int = 0  # Enemies moved by this wave's single release

    def __post_init__(self) -> None:
        if self.phase is Phase.WAVE:
            for pad in self.towers:
                self._report_for(pad)

    def _report_for(self, pad: str) -> PadReport:
        if pad not in self.pad_reports:
            tower = self.towers[pad]
            self.pad_reports[pad] = PadReport(tower.kind, tower.level, tower.aim)
        return self.pad_reports[pad]

    def require_build(self) -> None:
        if self.phase is not Phase.BUILD:
            raise RuleError("The workshop opens between waves.")

    def pay(self, amount: int) -> None:
        if self.brass < amount:
            raise RuleError(f"Need {amount} brass. You have {self.brass}.")
        self.brass -= amount

    def build(self, pad: str, kind: str) -> None:
        self.require_build()
        check_pad(pad)
        check_design(kind)
        if pad in self.towers:
            raise RuleError(f"Pad {pad} is occupied. Upgrade or sell its tower.")
        self.pay(DESIGNS[kind].tiers[0].price)
        self.towers[pad] = Tower(kind)
        self.notice = f"{pad} / {DESIGNS[kind].name} built and ready."

    def installed(self, pad: str) -> Tower:
        check_pad(pad)
        if pad not in self.towers:
            raise RuleError(f"Pad {pad} is empty.")
        return self.towers[pad]

    def upgrade(self, pad: str) -> None:
        self.require_build()
        tower = self.installed(pad)
        next_tier = tower.next_tier
        if next_tier is None:
            raise RuleError(f"{pad} already has the highest tier.")
        self.pay(next_tier.price)
        tower.level += 1
        self.notice = f"{pad} / {DESIGNS[tower.kind].name} upgraded to tier {tower.level}."

    def set_aim(self, pad: str, mode: str) -> None:
        self.require_build()
        tower = self.installed(pad)
        check_aim(tower.kind, mode)
        tower.aim = mode
        self.notice = f"{pad} / {DESIGNS[tower.kind].name} set to {mode} aim."

    def set_deck(self, first: str, second: str) -> None:
        self.require_build()
        if first not in SIGNALS or second not in SIGNALS or first == second:
            raise RuleError("Equip two different signals from net, echo and brace.")
        self.deck = (first, second)
        self.notice = f"Deck ready. J {SIGNALS[first].name} / K {SIGNALS[second].name}."

    def set_sluice(self, reach: int | None) -> None:
        self.require_build()
        if reach is not None:
            check_reach(reach)
        self.sluice = reach
        self.notice = ("Sluice disengaged." if reach is None else
                       f"{REACH_NAMES[reach - 1]} sluice armed. Use V during a wave.")

    def vent(self) -> None:
        if self.phase is not Phase.WAVE:
            raise RuleError("Open the sluice during a wave.")
        if self.sluice is None:
            raise RuleError("Set a sluice in the workshop first.")
        if self.vented:
            raise RuleError("The sluice has opened this wave. It resets at the next launch.")
        moved = sum(e.push_upstream() for e in self.enemies if e.hp > 0 and e.reach == self.sluice)
        if not moved:
            raise RuleError("Nothing can move upstream here. Sluice held.")
        self.vented = moved
        self.notice = f"{REACH_NAMES[self.sluice - 1]} sluice sent {moved} upstream."

    def sell(self, pad: str) -> None:
        self.require_build()
        tower = self.installed(pad)
        self.brass += tower.refund
        del self.towers[pad]
        self.notice = f"Pad {pad} cleared. Salvaged {tower.refund} brass."

    def mend(self) -> None:
        self.require_build()
        if self.gate == GATE_MAX:
            raise RuleError("The gate is already at full strength.")
        self.pay(MEND_COST)
        old = self.gate
        self.gate = min(GATE_MAX, self.gate + MEND_AMOUNT)
        self.notice = f"Mended {self.gate - old} gate for {MEND_COST} brass."

    def start_wave(self, *, rush: bool = False) -> None:
        self.require_build()
        self.wave += 1
        self.rush = rush
        self.beat = self.leaked = self.brace = self.vented = 0
        self.spent_signals.clear()
        self.fired.clear()
        self.arrivals = deque(wave_plan(self.wave, rush=rush))
        self.pad_reports.clear()
        self.pulse_kills = 0
        for pad, tower in self.towers.items():
            tower.cooldown = 0
            self._report_for(pad)
        self.phase = Phase.WAVE
        entry = "in pairs" if rush else "the spillway"
        self.notice = (f"Boss wave {self.wave}. Save a discharge for the Crownwake."
                       if self.wave % 10 == 0 else f"Wave {self.wave} entering {entry}.")

    def continue_watch(self) -> None:
        if self.phase is not Phase.WON:
            raise RuleError("Overtime opens after wave 20.")
        self.overtime = True
        self.phase = Phase.BUILD
        self.notice = "Overtime. Your crew stays on for the next tide."

    def _collect(self) -> None:
        survivors = []
        for enemy in self.enemies:
            if enemy.hp > 0:
                survivors.append(enemy)
            else:
                self.kills += 1
                self.brass += BROODS[enemy.kind].bounty
                if enemy.kind == "crown":
                    self.crowns += 1
                    self.notice = "Crownwake dispersed. The shell bells fall quiet."
        self.enemies = survivors

    def _volley(self, *, extra: bool = False) -> list[str]:
        # Pad order breaks firing ties even after selling and rebuilding.
        fired = []
        for pad, tower in sorted(self.towers.items()):
            if not extra and tower.cooldown:
                tower.cooldown -= 1
                continue
            hits = tower.fire(pad, self.enemies)
            if hits:
                fired.append(pad)
                if not extra:
                    tower.cooldown = tower.tier.interval - 1
                self._report_for(pad).record(hits)
        return fired

    def _leak(self, enemy: Enemy) -> None:
        brood = BROODS[enemy.kind]
        absorbed = 0 if enemy.kind == "crown" else min(self.brace, brood.leak)
        self.brace -= absorbed
        loss = min(self.gate, brood.leak - absorbed)
        self.gate -= loss
        self.leaked += 1
        self.notice = f"{brood.name} at the lamp! Gate lost {loss}."
        if absorbed:
            self.notice += f" Brace absorbed {absorbed}."

    def _flow(self) -> None:
        survivors = []
        for enemy in self.enemies:
            previous = enemy.reach
            enemy.advance(self.beat)
            if enemy.cell >= len(TRACK):
                self._leak(enemy)
            else:
                if enemy.kind == "crown" and enemy.reach != previous:
                    enemy.shell = shell_strength(self.wave)
                    self.notice = f"Crownwake raised a fresh shell in the {REACH_NAMES[enemy.reach - 1]}."
                survivors.append(enemy)
        self.enemies = survivors

    def _settle(self) -> None:
        if self.gate == 0:
            self.phase = Phase.LOST
            self.notice = f"The gate gave way on wave {self.wave}. The watch is over."
        elif self.enemies or self.arrivals:
            return
        else:
            bonus = wave_bonus(self.wave)
            premium = bonus if self.rush and self.leaked == 0 else 0
            self.brass += bonus + premium
            self.cleared = self.wave
            self.phase = Phase.WON if self.wave == FINAL_WAVE and not self.overtime else Phase.BUILD
            report = "clean water" if not self.leaked else f"{self.leaked} slipped through"
            payout = f"+{bonus} brass"
            if self.rush:
                payout += f" / rush +{premium}"
            self.notice = f"Wave {self.wave} held / {report} / {payout}."
        self.brace = 0

    def tick(self) -> None:
        if self.phase is not Phase.WAVE:
            raise RuleError("Start a wave with 'go' first.")
        self.beat += 1
        while self.arrivals and self.arrivals[0].beat <= self.beat:
            arrival = self.arrivals.popleft()
            self.enemies.append(Enemy.arrive(arrival.kind, self.wave))
            if arrival.kind == "crown":
                self.notice = "Crownwake at the inlet. Discharge its reach to strip the shell."
        self.fired = self._volley()
        self._collect()
        self._flow()
        if self.beat % RECHARGE_BEATS == 0:
            self.charge = min(CHARGE_MAX, self.charge + 1)
        self._settle()

    def pulse(self, reach: int) -> None:
        if self.phase is not Phase.WAVE:
            raise RuleError("Discharges are available during a wave.")
        check_reach(reach)
        targets = [e for e in self.enemies if e.reach == reach]
        if not targets:
            raise RuleError(f"The {REACH_NAMES[reach - 1]} is empty. Charge held.")
        if self.charge < PULSE_COST:
            raise RuleError(f"A discharge needs {PULSE_COST} charge. You have {self.charge}.")
        self.charge -= PULSE_COST
        power = pulse_power(self.wave)
        for enemy in targets:
            enemy.shell = 0
            enemy.hit(power)
        self.pulse_kills += sum(e.hp <= 0 for e in targets)
        self.notice = f"Discharged the {REACH_NAMES[reach - 1]} / {len(targets)} hit for {power}."
        self._collect()
        self._settle()

    def play_signal(self, key: str) -> None:
        if self.phase is not Phase.WAVE:
            raise RuleError("Signal cards can be played during a wave.")
        if key not in SIGNAL_KEYS:
            raise RuleError("Play the signal in slot J or K.")
        kind = self.deck[SIGNAL_KEYS.index(key)]
        signal = SIGNALS[kind]
        if kind in self.spent_signals:
            raise RuleError(f"{signal.name} was played this wave. It returns at the next launch.")
        if self.charge < signal.cost:
            raise RuleError(f"{signal.name} needs {signal.cost} charge. You have {self.charge}.")

        if kind == "net":
            if not self.enemies:
                raise RuleError("The road is empty. Net held.")
            for enemy in self.enemies:
                enemy.slow_for(NET_BEATS)
            effect = f"slowed {len(self.enemies)} for {NET_BEATS} beats."
        elif kind == "echo":
            fired = self._volley(extra=True)
            if not fired:
                raise RuleError("No tower has a target in range. Echo held.")
            self.fired = fired
            effect = "extra shot from " + ", ".join(fired) + "."
        else:
            self.brace = BRACE_STRENGTH
            effect = f"the gate can absorb {self.brace} damage this wave."

        self.charge -= signal.cost
        self.spent_signals.add(kind)
        self.notice = f"{signal.name} / {effect}"
        if kind == "echo":
            self._collect()
            self._settle()


@dataclass
class DrillResult:
    watch: Game
    first_leak: int | None
    vent_result: str


def rehearse(game: Game, *, rush: bool, vent_beat: int | None = None) -> DrillResult:
    """Play the next tide on a private watch, with at most one timed order."""
    game.require_build()
    if vent_beat is not None:
        if type(vent_beat) is not int or not 1 <= vent_beat <= 999:
            raise RuleError("Choose a sluice beat from 1 to 999.")
        if game.sluice is None:
            raise RuleError("Set a sluice in the workshop before scheduling a release.")
    trial = deepcopy(game)
    trial.start_wave(rush=rush)
    first_leak = None
    vent_result = "Wave already over" if vent_beat is not None else "Held"
    while trial.phase is Phase.WAVE:
        trial.tick()
        if first_leak is None and trial.leaked:
            first_leak = trial.beat
        if trial.beat == vent_beat and trial.phase is Phase.WAVE:
            try:
                trial.vent()
            except RuleError:
                vent_result = "Nobody moved"
            else:
                vent_result = f"{trial.vented} moved"
    return DrillResult(trial, first_leak, vent_result)
