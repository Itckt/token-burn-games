"""Deterministic relay rules. Only step() advances the match clock."""

from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from enum import Enum, IntEnum
import random

from .cards import CARDS, DECK_SIZE, Card, Troop, checked_deck, resolve_deck


TICKS_PER_SECOND = 2
DEFAULT_LIMIT = 90 * TICKS_PER_SECOND
MAX_TICKS = 600
FAR_TOWER = 12
MIDFIELD = FAR_TOWER // 2
TOWER_HP = 150
TOWER_HIT = 8
TOWER_REACH = 3
TOWER_RELOAD = 3
MAX_ENERGY = 10
REGEN_TICKS = 4
SIGNAL_TICKS = 16
HAND_SIZE = 4
FEED_SIZE = 3
BEACON_GOAL = 12
BEACON_MIN = MIDFIELD - 1
BEACON_MAX = MIDFIELD + 1


class Mode(str, Enum):
    CLASSIC = "classic"
    BEACON = "beacon"
    CONVOY = "convoy"


class Side(IntEnum):
    AMBER = 0
    INDIGO = 1

    @property
    def label(self) -> str:
        return self.name.title()

    @property
    def other(self) -> "Side":
        return Side(1 - self)

    @property
    def base(self) -> int:
        return 0 if self is Side.AMBER else FAR_TOWER

    @property
    def direction(self) -> int:
        return 1 if self is Side.AMBER else -1


class Lane(IntEnum):
    ROOF = 0
    CANAL = 1

    @property
    def label(self) -> str:
        return self.name.title()


def signal_at(completed_ticks: int) -> Lane:
    """The lit lane for the *next* dispatch at this point in the match."""
    return Lane((completed_ticks // SIGNAL_TICKS) % 2)


def check_seed(seed: int) -> None:
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("Seed must be an integer from 0 through 4294967295.")


@dataclass(frozen=True, slots=True)
class Setup:
    seed: int
    limit_ticks: int
    opening: tuple[tuple[str, ...], tuple[str, ...]]
    mode: Mode = Mode.CLASSIC

    def __post_init__(self) -> None:
        check_seed(self.seed)
        if type(self.limit_ticks) is not int or not 1 <= self.limit_ticks <= MAX_TICKS:
            raise ValueError(f"Match length must be between 1 and {MAX_TICKS} ticks.")
        if not isinstance(self.opening, (list, tuple)) or len(self.opening) != 2:
            raise ValueError("The opening must contain a deck for each side.")
        object.__setattr__(self, "opening", tuple(checked_deck(deck) for deck in self.opening))
        object.__setattr__(self, "mode", Mode(self.mode))

    @classmethod
    def deal(cls, seed: int, limit_ticks: int = DEFAULT_LIMIT,
             amber: str | Sequence[str] = "awning", indigo: str | Sequence[str] = "trestle",
             *, mode: Mode = Mode.CLASSIC) -> "Setup":
        check_seed(seed)

        def shuffled(spec: str | Sequence[str], salt: int) -> tuple[str, ...]:
            cards = list(resolve_deck(spec))
            random.Random(seed ^ salt).shuffle(cards)
            return tuple(cards)

        return cls(seed, limit_ticks, (shuffled(amber, 173), shuffled(indigo, 461)), mode)


@dataclass(frozen=True, slots=True)
class Move:
    slot: int
    lane: Lane


@dataclass(frozen=True, slots=True)
class Dispatch:
    tick: int
    side: Side
    move: Move


@dataclass(slots=True)
class Player:
    hand: list[str]
    reserve: list[str]
    energy: int = 5

    def cycle(self, slot: int) -> None:
        self.reserve.append(self.hand[slot])
        self.hand[slot] = self.reserve.pop(0)


@dataclass(slots=True)
class Tower:
    hp: int = TOWER_HP
    ready_at: int = 1


@dataclass(slots=True)
class Unit:
    uid: int
    side: Side
    lane: Lane
    card: str
    cell: int
    hp: int
    move_at: int
    attack_at: int

    @property
    def stats(self) -> Troop:
        troop = CARDS[self.card].troop
        assert troop is not None
        return troop


@dataclass(frozen=True, slots=True)
class Event:
    tick: int
    text: str


@dataclass(frozen=True, slots=True)
class Outcome:
    winner: Side | None
    reason: str

    @property
    def text(self) -> str:
        if self.winner is None:
            return {
                "double fall": "Draw. Both sides lost a tower on the same beat.",
                "beacon draw": "Draw on time. Beacon charge and tower hull are level.",
                "double delivery": "Draw. Both sides delivered a cart on the same beat.",
                "convoy draw": "Draw on time. Cart progress and tower hull are level.",
            }.get(self.reason, "Draw on time. Both sides have equal tower hull.")
        result = {
            "beacon": f"by banking {BEACON_GOAL} beacon charge",
            "beacon clock": "on time by beacon charge",
            "tower": "by breaking a tower",
            "delivery": "by delivering a cart to the enemy tower",
            "convoy clock": "on time by combined cart progress",
        }.get(self.reason, "on time by combined tower hull")
        return f"{self.winner.label} wins {result}."


@dataclass(frozen=True, slots=True)
class Piece:
    side: Side
    lane: Lane
    card: str
    cell: int
    hp: int


@dataclass(frozen=True, slots=True)
class Frame:
    """A small immutable view used by both the live board and replay viewer."""
    tick: int
    limit_ticks: int
    seed: int
    hull: tuple[tuple[int, ...], ...]
    energy: tuple[int, ...]
    hands: tuple[tuple[str, ...], ...]
    pieces: tuple[Piece, ...]
    recent: tuple[Event, ...]
    outcome: Outcome | None
    next_draw: tuple[str, ...]
    mode: Mode
    charge: tuple[int, ...]
    carts: tuple[int, ...] = ()


def zone_occupants(pieces: Iterable[Unit | Piece], lane: Lane, center: int) -> set[Side]:
    return {p.side for p in pieces if p.lane == lane and abs(p.cell - center) <= 1}


def beacon_occupants(pieces: Iterable[Unit | Piece], lane: Lane) -> set[Side]:
    return zone_occupants(pieces, lane, MIDFIELD)


def repair_amount(hull: int, card: Card) -> int:
    return min(card.repair, TOWER_HP - hull)


def _target_in_reach(foes: list[Unit], cell: int, reach: int) -> Unit | None:
    target = min(foes, key=lambda u: (abs(u.cell - cell), u.uid), default=None)
    if target is not None and abs(target.cell - cell) <= reach:
        return target
    return None


def _patient(mender: Unit, allies: list[Unit]) -> Unit | None:
    wounded = (u for u in allies if u is not mender and u.hp < u.stats.hp
               and abs(u.cell - mender.cell) <= mender.stats.reach)
    return min(wounded, key=lambda u: (u.hp - u.stats.hp, abs(u.cell - mender.cell), u.uid),
               default=None)


def leading_side(amber: int, indigo: int) -> Side | None:
    if amber == indigo:
        return None
    return Side.AMBER if amber > indigo else Side.INDIGO


def objective_margin(mode: Mode, charge: Sequence[int], carts: Sequence[int]) -> int:
    """Amber's objective lead, measured in banked charge or cells past midfield."""
    if mode is Mode.BEACON:
        return charge[Side.AMBER] - charge[Side.INDIGO]
    if mode is Mode.CONVOY:
        return sum(carts) - len(carts) * MIDFIELD
    return 0


def clock_verdict(mode: Mode, charge: Sequence[int], hull_totals: Iterable[int],
                  carts: Sequence[int] = ()) -> Outcome:
    leader = leading_side(objective_margin(mode, charge, carts), 0)
    if leader is not None:
        return Outcome(leader, f"{mode.value} clock")
    hull_leader = leading_side(*hull_totals)
    if hull_leader is None and mode is not Mode.CLASSIC:
        return Outcome(None, f"{mode.value} draw")
    return Outcome(hull_leader, "clock")


class IllegalMove(ValueError):
    pass


class Battle:
    def __init__(self, setup: Setup):
        self.setup = setup
        self.tick = 0
        self.players = [Player(list(d[:HAND_SIZE]), list(d[HAND_SIZE:])) for d in setup.opening]
        self.towers = [[Tower() for _ in Lane] for _ in Side]
        self.units: list[Unit] = []
        self.next_uid = 1
        self.dispatches: list[Dispatch] = []
        self.events = [Event(0, "The Roof signal lights up.")]
        self.charge = [0, 0]
        self.carts = [MIDFIELD for _ in Lane] if setup.mode is Mode.CONVOY else []
        self.outcome: Outcome | None = None

    def frame(self) -> Frame:
        return Frame(
            self.tick, self.setup.limit_ticks, self.setup.seed,
            tuple(tuple(t.hp for t in pair) for pair in self.towers),
            tuple(p.energy for p in self.players),
            tuple(tuple(p.hand) for p in self.players),
            tuple(Piece(u.side, u.lane, u.card, u.cell, u.hp) for u in self.units),
            tuple(self.events[-FEED_SIZE:]), self.outcome, tuple(p.reserve[0] for p in self.players),
            self.setup.mode, tuple(self.charge), tuple(self.carts),
        )

    def _note(self, message: str) -> None:
        self.events.append(Event(self.tick, message))

    def in_lane(self, side: Side, lane: Lane) -> list[Unit]:
        return [u for u in self.units if u.side == side and u.lane == lane]

    def burst_targets(self, side: Side, lane: Lane) -> list[Unit]:
        enemies = self.in_lane(side.other, lane)
        if not enemies:
            return []
        front = min(enemies, key=lambda u: abs(u.cell - side.base))
        return [u for u in enemies if abs(u.cell - front.cell) <= 1]

    def problem(self, side: Side, move: Move) -> str | None:
        if self.outcome is not None:
            return "The match has finished."
        if not isinstance(move, Move):
            return "An order needs a hand slot and a lane."
        if type(move.slot) is not int or not 0 <= move.slot < HAND_SIZE:
            return "Choose a hand slot from 1 to 4."
        if not isinstance(move.lane, Lane):
            return "Choose Roof or Canal."
        player = self.players[side]
        card = CARDS[player.hand[move.slot]]
        if player.energy < card.cost:
            return f"{card.name} needs {card.cost} energy. You have {player.energy}."
        if card.repair and self.towers[side][move.lane].hp == TOWER_HP:
            return f"Your {move.lane.label} tower already has full hull."
        if card.burst and not self.in_lane(side.other, move.lane):
            return f"Squall Lens needs an enemy on {move.lane.label}."
        return None

    def legal_moves(self, side: Side, lane: Lane | None = None) -> Iterator[Move]:
        lanes = tuple(Lane) if lane is None else (lane,)
        for slot in range(HAND_SIZE):
            for route in lanes:
                move = Move(slot, route)
                if self.problem(side, move) is None:
                    yield move

    def _deploy(self, side: Side, lane: Lane, card: Card, lit: Lane) -> None:
        stats = card.troop
        assert stats is not None
        advance = 2 if lane == lit else 1
        # A lit signal cannot put a fresh unit behind an approaching enemy.
        for foe in self.in_lane(side.other, lane):
            advance = min(advance, abs(foe.cell - side.base))
        cell = side.base + side.direction * advance
        for _ in range(stats.count):
            self.units.append(Unit(self.next_uid, side, lane, card.key, cell, stats.hp,
                                   self.tick + stats.walk_ticks, self.tick))
            self.next_uid += 1
        self._note(f"{side.label} sent {card.name} to {lane.label}.")

    def step(self, amber: Move | None = None, indigo: Move | None = None) -> None:
        """Accept both orders atomically, then resolve one half-second of play."""
        if self.outcome is not None:
            raise IllegalMove("The match has finished.")
        orders = []
        for side, move in zip(Side, (amber, indigo)):
            if move is None:
                continue
            error = self.problem(side, move)
            if error:
                raise IllegalMove(error)
            card = CARDS[self.players[side].hand[move.slot]]
            targets = self.burst_targets(side, move.lane) if card.burst else []
            orders.append((side, move, card, targets))

        lit = signal_at(self.tick)
        self.tick += 1
        for side, move, card, targets in orders:
            self.dispatches.append(Dispatch(self.tick, side, move))
            player = self.players[side]
            player.energy -= card.cost
            player.cycle(move.slot)
            if card.troop:
                self._deploy(side, move.lane, card, lit)
            elif card.burst:
                for unit in targets:
                    unit.hp -= card.burst
                self._note(f"{side.label} pulsed {len(targets)} on {move.lane.label} with {card.name}.")
            else:
                tower = self.towers[side][move.lane]
                healed = repair_amount(tower.hp, card)
                tower.hp += healed
                self._note(f"{side.label} patched {healed} hull on {move.lane.label}.")

        self._clear_fallen()
        self._combat()
        if self.tick % TICKS_PER_SECOND == 0:
            if self.setup.mode is Mode.BEACON:
                self._score_beacon(lit)
            elif self.setup.mode is Mode.CONVOY:
                self._move_carts()
        if self.tick % REGEN_TICKS == 0:
            for player in self.players:
                player.energy = min(MAX_ENERGY, player.energy + 1)
        self.outcome = self._verdict()
        if self.outcome:
            self._note(self.outcome.text)
        elif self.tick % SIGNAL_TICKS == 0:
            self._note(f"The signal switches to {signal_at(self.tick).label}.")

    def _combat(self) -> None:
        groups = {(s, lane): self.in_lane(s, lane) for s in Side for lane in Lane}
        wounds: dict[int, int] = defaultdict(int)
        mends: dict[int, int] = defaultdict(int)
        strikes: dict[tuple[Side, Lane], int] = defaultdict(int)
        marches = []

        def hit(target: Unit, damage: int) -> None:
            wounds[target.uid] += max(1, damage - target.stats.armor)

        # Choose actions from a single snapshot, including who needs a mend.
        for unit in self.units:
            stats = unit.stats
            foes = groups[unit.side.other, unit.lane]
            target = _target_in_reach(foes, unit.cell, stats.reach)
            patient = _patient(unit, groups[unit.side, unit.lane]) if stats.mend else None
            tower_in_reach = abs(unit.side.other.base - unit.cell) <= stats.reach
            if patient is None and target is None and not tower_in_reach:
                if self.tick >= unit.move_at:
                    marches.append(unit)
                continue
            if self.tick < unit.attack_at:
                continue
            unit.attack_at = self.tick + stats.attack_ticks
            if patient is not None:
                mends[patient.uid] += stats.mend
            elif target is None:
                strikes[unit.side.other, unit.lane] += stats.hit + stats.tower_bonus
            elif stats.splash:
                for foe in foes:
                    if foe.cell == target.cell:
                        hit(foe, stats.hit)
            else:
                hit(target, stats.hit)

        for side, lane in groups:
            tower = self.towers[side][lane]
            if self.tick < tower.ready_at:
                continue
            target = _target_in_reach(groups[side.other, lane], side.base, TOWER_REACH)
            if target is not None:
                hit(target, TOWER_HIT)
                tower.ready_at = self.tick + TOWER_RELOAD

        for unit in marches:
            unit.cell += unit.side.direction
            unit.move_at = self.tick + unit.stats.walk_ticks
        for unit in self.units:
            if unit.uid in mends:
                gained = min(unit.stats.hp - unit.hp, mends[unit.uid])
                unit.hp += gained
                self._note(f"{unit.side.label} mended {gained} hull on {CARDS[unit.card].name} "
                           f"in {unit.lane.label}.")
            unit.hp -= wounds.get(unit.uid, 0)
        self._clear_fallen()
        for (side, lane), damage in strikes.items():
            tower = self.towers[side][lane]
            lost = min(tower.hp, damage)
            tower.hp -= lost
            self._note(f"{side.label} lost {lost} hull on {lane.label} ({tower.hp} left).")

    def _clear_fallen(self) -> None:
        fallen: dict[tuple[Side, Lane], int] = defaultdict(int)
        for unit in self.units:
            if unit.hp <= 0:
                fallen[unit.side, unit.lane] += 1
        if fallen:
            self.units = [u for u in self.units if u.hp > 0]
            for (side, lane), count in fallen.items():
                noun = "unit" if count == 1 else "units"
                self._note(f"{side.label} lost {count} {noun} on {lane.label}.")

    def _score_beacon(self, lit: Lane) -> None:
        occupants = beacon_occupants(self.units, lit)
        if len(occupants) == 1:
            side, = occupants
            self.charge[side] += 1
            self._note(f"{side.label} banks {lit.label} charge ({self.charge[side]}/{BEACON_GOAL}).")

    def _move_carts(self) -> None:
        for lane in Lane:
            escorts = zone_occupants(self.units, lane, self.carts[lane])
            if len(escorts) == 1:
                side, = escorts
                self.carts[lane] += side.direction
                self._note(f"{side.label} pushed the {lane.label} cart to cell {self.carts[lane]}.")

    def _verdict(self) -> Outcome | None:
        fallen = [s for s in Side if any(t.hp == 0 for t in self.towers[s])]
        if len(fallen) == 2:
            return Outcome(None, "double fall")
        if fallen:
            return Outcome(fallen[0].other, "tower")
        if self.setup.mode is Mode.BEACON and max(self.charge) >= BEACON_GOAL:
            return Outcome(leading_side(*self.charge), "beacon")
        if self.setup.mode is Mode.CONVOY:
            delivered = [s for s in Side if s.other.base in self.carts]
            if len(delivered) == 2:
                return Outcome(None, "double delivery")
            if delivered:
                return Outcome(delivered[0], "delivery")
        if self.tick == self.setup.limit_ticks:
            return clock_verdict(self.setup.mode, self.charge,
                                 (sum(t.hp for t in row) for row in self.towers), self.carts)
        return None
