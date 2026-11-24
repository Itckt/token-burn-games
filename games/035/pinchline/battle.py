"""Simultaneous, beat-by-beat resolution for a seeded match."""

from collections.abc import Sequence
from dataclasses import dataclass
from random import Random

from .arena import COURTS, Position
from .combat import Impact as Impact, resolve
from .courier import CourierRun
from .fighters import Fighter, FighterStats as FighterStats, Intent, deal_team, tags
from .rail import RailRun
from .roster import (
    CHARGE_CAP, COPPER, COPPER_DRAFT, ECHO_REACH, HOP_STEPS, INDIGO, INDIGO_DRAFT, Art,
)
from .tactics import DEFAULT_ORDER, ORDERS, Deck, ranked_foes

BEAT_LIMIT = 60
MODES = ("knockout", "press", "courier", "rail")
STAMP_TARGET = 5


@dataclass(frozen=True)
class Outcome:
    winner: str | None
    reason: str


class Battle:
    def __init__(
        self,
        seed: int,
        copper: Sequence[str] = COPPER_DRAFT,
        indigo: Sequence[str] = INDIGO_DRAFT,
        limit: int = BEAT_LIMIT,
        *,
        court: str = "loop",
        mode: str = "knockout",
        copper_deck: Sequence[str] = (),
        indigo_deck: Sequence[str] = (),
        copper_order: str = DEFAULT_ORDER,
        indigo_order: str = DEFAULT_ORDER,
    ):
        if limit < 1:
            raise ValueError("the beat limit must be positive")
        if court not in COURTS:
            raise ValueError(f"unknown court '{court}'. Choose from {', '.join(COURTS)}")
        if mode not in MODES:
            raise ValueError(f"unknown mode '{mode}'. Choose from {', '.join(MODES)}")
        self.orders = {COPPER: copper_order.lower(), INDIGO: indigo_order.lower()}
        for order in self.orders.values():
            if order not in ORDERS:
                raise ValueError(f"unknown targeting order '{order}'. Choose from {', '.join(ORDERS)}")
        self.seed = seed
        self.rng = Random(seed)
        self.limit = limit
        self.beat = 0
        self.court = COURTS[court]
        self.mode = mode
        self.stamps = {COPPER: 0, INDIGO: 0}
        self.zone = self.court.zone_at(0)
        self.courier = CourierRun(self.court, self.zone) if mode == "courier" else None
        self.rail = RailRun(self.court, self.zone) if mode == "rail" else None
        self.decks = {
            team: Deck(cards) for team, cards in ((COPPER, copper_deck), (INDIGO, indigo_deck))
            if cards
        }
        self.fighters = deal_team(COPPER, copper, "ABC", self.court.west_marks, self.rng)
        self.fighters.extend(deal_team(INDIGO, indigo, "xyz", self.court.east_marks, self.rng))
        self.notes = ["Six on their marks. The court is open."]
        self.result: Outcome | None = None

    def on_press(self, pos: Position) -> bool:
        return self.mode == "press" and pos in self.court.press_tiles and self.zone.contains(pos)

    def _art(
        self, actor: Fighter, friends: list[Fighter], foes: list[Fighter], occupied: set[Position]
    ) -> Intent | None:
        hero = actor.hero
        lane_distance = self.court.lane_distance
        if hero.art in (Art.SHELTER, Art.MEND):
            nearby = tuple(
                friend for friend in friends if lane_distance(actor.pos, friend.pos) <= hero.art_range
            )
            if hero.art is Art.SHELTER:
                if any(friend.ward < hero.art_power for friend in nearby):
                    return Intent(actor, "art", nearby)
            else:
                patient = max(nearby, key=lambda f: (f.hero.hp - f.hp, -lane_distance(actor.pos, f.pos)))
                if patient.hp < patient.hero.hp:
                    return Intent(actor, "art", (patient,))
            return None

        # Targets arrive in priority order, including the opposing courier.
        for target in foes:
            distance = lane_distance(actor.pos, target.pos)
            if distance > hero.art_range:
                continue
            if hero.art is Art.HOP:
                if distance == 1 and self.zone.contains(actor.pos):
                    return Intent(actor, "art", (target,))
                landings = [
                    tile for tile in self.court.neighbors[target.pos]
                    if tile not in occupied and self.zone.contains(tile)
                    and lane_distance(actor.pos, tile) <= HOP_STEPS
                ]
                if landings:
                    return Intent(actor, "art", (target,), self.rng.choice(landings))
                continue
            if hero.art is Art.ECHO:
                partners = [
                    foe for foe in foes if foe is not target
                    and lane_distance(target.pos, foe.pos) <= ECHO_REACH
                ]
                return Intent(actor, "art", (target, *partners[:1]))
            return Intent(actor, "art", (target,))
        return None

    def _plan(self, actor: Fighter, initiative: list[Fighter], occupied: set[Position],
              control_tiles: frozenset[Position]) -> Intent:
        lane_distance = self.court.lane_distance
        next_step = self.court.next_step
        inside = self.zone.contains(actor.pos)
        if not inside:
            step = next_step(actor.pos, occupied, lambda tile: True, self.zone.gap, self.rng)
            if step is not None:
                return Intent(actor, "step", destination=step)

        carrier = None
        if self.courier is not None:
            route = self.courier.plan(actor, occupied, self.zone, self.rng)
            if route is not None:
                return route
            carrier = self.courier.carrier

        target_order = self.orders[actor.team]
        foes = ranked_foes(actor, initiative, self.court, target_order, carrier)
        if actor.charge == CHARGE_CAP:
            friends = [fighter for fighter in initiative if fighter.team == actor.team]
            art = self._art(actor, friends, foes, occupied)
            if art is not None:
                return art
        holding = inside and actor.pos in control_tiles
        if control_tiles and inside and not holding:
            # Only a reachable control tile takes priority over a pulse.
            step = next_step(actor.pos, occupied, self.zone.contains,
                             lambda pos: int(pos not in control_tiles), self.rng)
            if step is not None:
                return Intent(actor, "step", destination=step)
        for foe in foes:
            if lane_distance(actor.pos, foe.pos) <= actor.hero.reach:
                return Intent(actor, "pulse", (foe,))

        if inside and not holding:
            focus = target_order == "charged" or (carrier is not None and carrier.team != actor.team)
            pursued = foes[:1] if focus else foes

            def attack_gap(tile: Position) -> int:
                nearest = min(lane_distance(tile, foe.pos) for foe in pursued)
                return max(0, nearest - actor.hero.reach)

            step = next_step(actor.pos, occupied, self.zone.contains, attack_gap, self.rng)
            if step is not None:
                return Intent(actor, "step", destination=step)
        return Intent(actor, "hold")

    def _control_tiles(self) -> frozenset[Position]:
        if self.rail is not None:
            return self.rail.escort_tiles
        if self.mode == "press":
            return self.court.press_tiles
        return frozenset()

    def _score_control(self, tiles: frozenset[Position]) -> None:
        holders = [f for f in self.fighters
                   if f.alive and f.pos in tiles and self.zone.contains(f.pos)]
        copper = [f for f in holders if f.team == COPPER]
        indigo = [f for f in holders if f.team == INDIGO]
        if len(copper) == len(indigo):
            if copper:
                name = "Roller" if self.rail is not None else "Press"
                self.notes.append(f"{name} contested   {len(copper)} each.")
            return
        majority = copper if len(copper) > len(indigo) else indigo
        team = majority[0].team
        if self.rail is not None:
            note = self.rail.push(team)
            for fighter in majority:
                fighter.stats.pushes += 1
        else:
            self.stamps[team] += 1
            for fighter in majority:
                fighter.stats.scoring_beats += 1
            note = f"{team} stamps {self.stamps[team]}/{STAMP_TARGET}"
        self.notes.append(f"{note}   {tags(majority)}")

    def crew(self, team: str) -> list[Fighter]:
        """All three fighters in draft order, including anyone knocked out."""
        return [fighter for fighter in self.fighters if fighter.team == team]

    def score(self, team: str) -> tuple[int, int]:
        crew = self.crew(team)
        return sum(f.alive for f in crew), sum(f.hp for f in crew)

    def _objective_outcome(self, bell: bool) -> Outcome | None:
        if self.rail is not None:
            if self.rail.finished_by:
                return Outcome(self.rail.finished_by, "pushed the roller to the far stop")
            if bell and self.rail.leader:
                return Outcome(self.rail.leader, "ahead on the rail at the bell")
        if self.courier is not None:
            if self.courier.delivered_by is not None:
                return Outcome(self.courier.delivered_by.team, "delivered the proof")
            if bell and self.courier.carrier is not None:
                return Outcome(self.courier.carrier.team, "holding the proof at the bell")
        if self.mode == "press":
            for team, stamps in self.stamps.items():
                if stamps >= STAMP_TARGET:
                    return Outcome(team, f"earned {STAMP_TARGET} stamps")
            if bell and self.stamps[COPPER] != self.stamps[INDIGO]:
                leader = max(self.stamps, key=self.stamps.__getitem__)
                return Outcome(leader, "more stamps at the bell")
        return None

    def _outcome(self) -> Outcome | None:
        copper, indigo = self.score(COPPER), self.score(INDIGO)
        if copper[0] == indigo[0] == 0:
            return Outcome(None, "double knockout")
        winner = COPPER if copper > indigo else INDIGO
        if min(copper[0], indigo[0]) == 0:
            return Outcome(winner, "elimination")
        bell = self.beat >= self.limit
        objective = self._objective_outcome(bell)
        if objective is not None:
            return objective
        if not bell:
            return None
        if copper[0] != indigo[0]:
            return Outcome(winner, "more survivors at the bell")
        if copper[1] != indigo[1]:
            return Outcome(winner, "more HP at the bell")
        tied = "stamps, survivors and HP" if self.mode == "press" else "survivors and HP"
        return Outcome(None, f"level on {tied} at the bell")

    def step(self) -> None:
        if self.result is not None:
            return
        initiative = [fighter for fighter in self.fighters if fighter.alive]
        if len({fighter.team for fighter in initiative}) < 2:
            self.result = self._outcome()
            return
        self.beat += 1
        self.notes = []
        next_zone = self.court.zone_at(self.beat)
        if next_zone.level != self.zone.level:
            self.notes.append(f"Fold {next_zone.level} closes in.")
            moving_objective = self.courier or self.rail
            if moving_objective is not None:
                note = moving_objective.fold(next_zone)
                if note:
                    self.notes.append(note)
        self.zone = next_zone
        self.rng.shuffle(initiative)
        for fighter in initiative:
            fighter.charge = min(CHARGE_CAP, fighter.charge + 1)
        for team, deck in self.decks.items():
            note = deck.advance(self.crew(team))
            if note:
                self.notes.append(f"{team} {note}")
        occupied = {fighter.pos for fighter in initiative}
        tiles = self._control_tiles()
        intents = [self._plan(fighter, initiative, occupied, tiles) for fighter in initiative]
        self.notes.extend(resolve(intents, self.zone))
        if tiles:
            self._score_control(tiles)
        if self.courier is not None:
            self.notes.extend(self.courier.settle(self.fighters, self.zone))
        if not self.notes:
            self.notes.append("Both crews hold position.")
        self.result = self._outcome()

    def run(self) -> Outcome:
        while self.result is None:
            self.step()
        return self.result
