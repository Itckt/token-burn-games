"""A single loose proof and two return gates on the folding court."""

from collections.abc import Sequence
from random import Random

from .arena import Court, Position, Zone
from .fighters import Fighter, Intent
from .roster import COPPER, INDIGO


class CourierRun:
    def __init__(self, court: Court, zone: Zone):
        self.court = court
        self.loose_at: Position | None = court.center
        self.carrier: Fighter | None = None
        self.delivered_by: Fighter | None = None
        self.gates: dict[str, Position] = {}
        self.fold(zone)

    def fold(self, zone: Zone) -> str | None:
        y = self.court.center[1]
        row = [(x, y) for x in range(zone.left, zone.right + 1) if (x, y) in self.court.floor]
        self.gates = {COPPER: row[0], INDIGO: row[-1]}
        if self.loose_at is not None and not zone.contains(self.loose_at):
            self.loose_at = self.court.center
            return "The fold returns the loose proof to center."
        return None

    def plan(self, actor: Fighter, occupied: set[Position], zone: Zone, rng: Random) -> Intent | None:
        """Couriers haul or wait. Other fighters can fall back to normal combat."""
        if self.carrier is actor:
            gate = self.gates[actor.team]
            step = self.court.next_step(actor.pos, occupied, zone.contains,
                                        lambda p: self.court.lane_distance(p, gate), rng)
            if step is None:
                return Intent(actor, "hold")
            return Intent(actor, "step", destination=step)

        if self.loose_at is not None and zone.contains(actor.pos):
            if actor.pos == self.loose_at:
                return Intent(actor, "hold")
            step = self.court.next_step(actor.pos, occupied, zone.contains,
                                        lambda p: int(p != self.loose_at), rng)
            if step is not None:
                return Intent(actor, "step", destination=step)

        if (self.carrier is not None and self.carrier.team == actor.team
                and actor.pos == self.gates[actor.team]):
            exits = [p for p in self.court.neighbors[actor.pos]
                     if p not in occupied and zone.contains(p)]
            if exits:
                return Intent(actor, "step", destination=rng.choice(exits))
        return None

    def settle(self, fighters: Sequence[Fighter], zone: Zone) -> list[str]:
        """Resolve survival, delivery, drops and pickups on final positions."""
        notes = []
        carrier = self.carrier
        if carrier is not None:
            if carrier.alive:
                carrier.stats.carry_beats += 1
                if carrier.pos == self.gates[carrier.team]:
                    self.delivered_by = carrier
                    notes.append(f"{carrier.token} delivers the proof for {carrier.team}.")
                return notes
            self.carrier = None
            if zone.contains(carrier.pos):
                self.loose_at = carrier.pos
                notes.append(f"{carrier.token} drops the proof.")
            else:
                self.loose_at = self.court.center
                notes.append(f"{carrier.token} drops the proof in the fringe. It returns to center.")

        for fighter in fighters:
            if fighter.alive and fighter.pos == self.loose_at:
                self.carrier = fighter
                self.loose_at = None
                fighter.stats.carry_beats += 1
                notes.append(f"{fighter.token} picks up the proof for {fighter.team}.")
                break
        return notes

    def markers(self) -> dict[Position, str]:
        west, east = self.gates[COPPER], self.gates[INDIGO]
        marks = {west: "="} if west == east else {west: "<", east: ">"}
        if self.loose_at is not None:
            marks[self.loose_at] = "*"
        return marks
