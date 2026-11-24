"""Resolve simultaneous movements, signatures, hits, and fringe damage."""

from dataclasses import dataclass

from .arena import Position, Zone
from .fighters import Intent, tags
from .roster import DRAIN_AMOUNT, ECHO_POWER, Art


@dataclass
class Impact:
    ward: int = 0
    heal: int = 0
    pulse: int = 0
    direct: int = 0
    drain: int = 0


def _cast(intent: Intent, impacts: dict[str, Impact]) -> str:
    actor, targets = intent.actor, intent.targets
    art, power = actor.hero.art, actor.hero.art_power
    target = targets[0]
    first = impacts[target.token]
    actor.stats.arts += 1
    if art is Art.SHELTER:
        for friend in targets:
            effect = impacts[friend.token]
            effect.ward = max(effect.ward, power)
        detail = f"ward {power}"
    elif art is Art.MEND:
        restored = min(power, target.hero.hp - target.hp - first.heal)
        first.heal += restored
        actor.stats.healing += restored
        detail = f"heal {restored}"
    else:
        actor.stats.power_sent += power
        detail = str(power)
        if art is Art.PIERCE:
            first.direct += power
            detail += " through ward"
        else:
            first.pulse += power
            if art is Art.ECHO and len(targets) > 1:
                impacts[targets[1].token].pulse += ECHO_POWER
                actor.stats.power_sent += ECHO_POWER
                detail += f" + {ECHO_POWER} echo"
            if art is Art.DRAIN:
                drained = min(DRAIN_AMOUNT, target.charge - first.drain)
                first.drain += drained
                detail += f", drained {drained} charge"
    return f"{actor.token} {art.value} -> {tags(targets)} ({detail})"


def _commit(intents: list[Intent]) -> set[str]:
    """Reserve destinations and pay for successful casts before charge drains."""
    claimed: set[Position] = set()
    blocked: set[str] = set()
    for intent in intents:
        actor = intent.actor
        if intent.destination is not None:
            if intent.destination in claimed:
                blocked.add(actor.token)
                continue
            claimed.add(intent.destination)
            actor.pos = intent.destination
        if intent.kind == "art":
            actor.charge = 0
    return blocked


def resolve(intents: list[Intent], zone: Zone) -> list[str]:
    """Commit moves and costs, then apply all locked effects to final positions."""
    notes = []
    blocked = _commit(intents)
    impacts = {intent.actor.token: Impact() for intent in intents}
    walkers = []
    for intent in intents:
        actor = intent.actor
        if actor.token in blocked:
            notes.append(f"{actor.token} yields a contested tile.")
        elif intent.kind == "step":
            walkers.append(actor)
        elif intent.kind == "pulse":
            target = intent.targets[0]
            impacts[target.token].pulse += actor.hero.power
            actor.stats.pulses += 1
            actor.stats.power_sent += actor.hero.power
            notes.append(f"{actor.token} pulse -> {target.token} ({actor.hero.power})")
        elif intent.kind == "art":
            notes.append(_cast(intent, impacts))
    if walkers:
        notes.append(f"Advance   {tags(walkers)}")

    notes.extend(_apply_impacts(intents, impacts, zone))
    return notes


def _apply_impacts(intents: list[Intent], impacts: dict[str, Impact], zone: Zone) -> list[str]:
    notes = []
    exposed = []
    knocked_out = []
    for intent in intents:
        actor = intent.actor
        effect = impacts[actor.token]
        actor.ward = max(actor.ward, effect.ward)
        actor.hp += effect.heal
        absorbed = min(actor.ward, effect.pulse)
        actor.ward -= absorbed
        actor.stats.blocked += absorbed
        damage = effect.pulse - absorbed + effect.direct
        if not zone.contains(actor.pos):
            damage += zone.damage
            actor.stats.fringe_beats += 1
            exposed.append(actor)
        actor.hp = max(0, actor.hp - damage)
        actor.charge -= effect.drain
        if not actor.alive:
            actor.ward = actor.charge = 0
            knocked_out.append(actor)
    if exposed:
        notes.append(f"Fringe -{zone.damage} HP   {tags(exposed)}")
    if knocked_out:
        notes.append(f"Knocked out   {tags(knocked_out)}")
    return notes
