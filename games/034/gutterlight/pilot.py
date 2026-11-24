"""Seeded lane decisions for the opposing dispatcher and unattended matches."""

from collections.abc import Iterator
import random

from .battle import (
    BEACON_MIN, MIDFIELD, Battle, Lane, Mode, Move, Setup, Side, TOWER_HP, beacon_occupants,
    repair_amount, signal_at, zone_occupants,
)
from .cards import CARDS, Troop


class Pilot:
    def __init__(self, seed: int, side: Side):
        self.side = side
        self.random = random.Random(seed ^ (8017 if side == Side.AMBER else 6089))
        self.preferred = self.random.choice(tuple(Lane))

    def choose(self, battle: Battle) -> Move | None:
        # Read the board once per second, using only the hand and visible units.
        if battle.outcome or battle.tick % 2:
            return None
        best = None
        best_score = 0.0
        for lane in Lane:
            for move, score in self._options(battle, lane):
                score += self.random.uniform(0, 1.4)
                if score > best_score:
                    best, best_score = move, score
        return best

    def _options(self, battle: Battle, lane: Lane) -> Iterator[tuple[Move, float]]:
        side = self.side
        player = battle.players[side]
        allies = battle.in_lane(side, lane)
        foes = battle.in_lane(side.other, lane)
        nearby = [u for u in foes if abs(u.cell - side.base) <= 6]
        incoming = sum(u.hp + u.stats.hit for u in nearby)
        cover = sum(u.hp + u.stats.hit for u in allies)
        need = max(0.0, min(7.0, (incoming - cover) / 12))
        hull = battle.towers[side][lane].hp
        enemy_hull = battle.towers[side.other][lane].hp
        has_screen = any(u.stats.reach == 1 for u in allies)
        wounded = sum(u.hp < u.stats.hp for u in allies)
        for move in battle.legal_moves(side, lane):
            card = CARDS[player.hand[move.slot]]
            if card.burst:
                targets = battle.burst_targets(side, lane)
                damage = sum(min(u.hp, card.burst) for u in targets)
                kills = sum(u.hp <= card.burst for u in targets)
                score = damage / 8 + kills + need / 2
            elif card.repair:
                healed = repair_amount(hull, card)
                score = healed / 6 + (TOWER_HP - hull) / 45
                if battle.setup.limit_ticks - battle.tick < 12:
                    score += healed / 5
            else:
                troop = card.troop
                assert troop is not None
                objective = self._objective_bonus(battle, lane, troop)
                if player.energy < 4 and not (nearby or objective or (troop.mend and wounded)):
                    continue
                score = 2.5 + need + (TOWER_HP - enemy_hull) / 40
                score += 1.1 * (lane == signal_at(battle.tick))
                score += 0.6 * (lane == self.preferred)
                score += card.cost * 0.32 + objective
                if has_screen and (troop.reach > 1 or troop.tower_bonus):
                    score += 1.8
                if troop.splash:
                    score += min(3, len(foes)) * 0.8
                if troop.armor:
                    score += min(3, len(nearby)) * 0.9
                if troop.mend:
                    score += min(3, wounded) * 1.6
                if not allies and troop.hp > 45:
                    score += 1.0
            yield move, score

    def _objective_bonus(self, battle: Battle, lane: Lane, troop: Troop) -> float:
        if battle.setup.mode is Mode.CLASSIC:
            return 0.0
        launch = 2 if lane == signal_at(battle.tick) else 1
        if battle.setup.mode is Mode.CONVOY:
            cart = battle.carts[lane]
            escorts = zone_occupants(battle.units, lane, cart)
            if escorts == {self.side}:
                return 0.0
            distance = abs(cart - self.side.base)
            danger = max(0, MIDFIELD - distance)
            arrival = max(0, distance - launch - 1) * troop.walk_ticks
            return 3 + danger + 2 * (self.side.other in escorts) + 3 / (1 + arrival)
        travel = (BEACON_MIN - launch) * troop.walk_ticks
        if signal_at(battle.tick + travel) != lane:
            return 0.0
        occupants = beacon_occupants(battle.units, lane)
        return 1.0 if occupants == {self.side} else 4.5


def finish(battle: Battle, amber: Pilot, indigo: Pilot) -> None:
    while battle.outcome is None:
        battle.step(amber.choose(battle), indigo.choose(battle))


def simulate(setup: Setup) -> Battle:
    battle = Battle(setup)
    finish(battle, *(Pilot(setup.seed, s) for s in Side))
    return battle
