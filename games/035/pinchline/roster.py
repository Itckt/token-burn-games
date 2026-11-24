"""Hero cards and the two house drafts."""

from dataclasses import dataclass
from enum import Enum


class Art(Enum):
    SHELTER = "Awning Fold"
    ECHO = "Carbon Chorus"
    MEND = "Pocket Seam"
    HOP = "Margin Hop"
    PIERCE = "Ghost Serif"
    DRAIN = "Slack Note"


CHARGE_CAP = 5
START_CHARGE = 1
ECHO_REACH = 2
ECHO_POWER = 3
HOP_STEPS = 2
DRAIN_AMOUNT = 3


@dataclass(frozen=True)
class Hero:
    name: str
    role: str
    hp: int
    power: int
    reach: int
    art: Art
    art_range: int
    art_power: int

    def describe_art(self) -> str:
        power = self.art_power
        reach = self.art_range
        descriptions = {
            Art.SHELTER: f"Set ward to {power} for self and allies within {reach} steps.",
            Art.ECHO: (f"Hit for {power} within {reach} steps. Echo {ECHO_POWER} to one other foe "
                       f"within {ECHO_REACH} of the first."),
            Art.MEND: f"Heal {power} HP to the most injured ally within {reach} steps, including self.",
            Art.HOP: f"Hop up to {HOP_STEPS} steps beside a foe within {reach}, then deal {power}.",
            Art.PIERCE: f"Hit for {power} through ward within {reach} steps.",
            Art.DRAIN: f"Hit for {power} within {reach} steps and drain {DRAIN_AMOUNT} charge.",
        }
        return descriptions[self.art]


_CARDS = (
    Hero("Pleatram", "Anchor", 26, 4, 1, Art.SHELTER, 2, 5),
    Hero("Inkrill", "Linker", 20, 3, 3, Art.ECHO, 4, 5),
    Hero("Darnlet", "Mender", 20, 3, 2, Art.MEND, 3, 7),
    Hero("Tucklark", "Diver", 23, 4, 1, Art.HOP, 3, 6),
    Hero("Vellumoth", "Piercer", 19, 3, 3, Art.PIERCE, 4, 6),
    Hero("Hushspool", "Dampener", 22, 3, 2, Art.DRAIN, 3, 4),
)
ROSTER = {card.name.lower(): card for card in _CARDS}
COPPER = "Copper"
INDIGO = "Indigo"
COPPER_DRAFT = ("pleatram", "inkrill", "darnlet")
INDIGO_DRAFT = ("tucklark", "vellumoth", "hushspool")
