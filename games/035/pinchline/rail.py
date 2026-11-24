"""A letterpress roller that both crews can escort along the middle row."""

from .arena import Court, Position, Zone
from .roster import COPPER, INDIGO


class RailRun:
    def __init__(self, court: Court, zone: Zone):
        self.court = court
        cx, cy = court.center
        self.radius = 0
        for reach in range(1, 5):
            if (cx - reach, cy) not in court.floor or (cx + reach, cy) not in court.floor:
                break
            self.radius = reach
        self.pos = court.center
        self.finished_by: str | None = None
        self.fold(zone)

    @property
    def offset(self) -> int:
        """Columns east of center. Copper pushes east and Indigo pushes west."""
        return self.pos[0] - self.court.center[0]

    def fold(self, zone: Zone) -> str | None:
        cx, cy = self.court.center
        self.west = max(zone.left, cx - self.radius)
        self.east = min(zone.right, cx + self.radius)
        x = min(self.east, max(self.west, self.pos[0]))
        if x != self.pos[0]:
            self.pos = (x, cy)
            return f"The fold pulls the roller back to {self.offset:+d}."
        return None

    @property
    def escort_tiles(self) -> frozenset[Position]:
        return frozenset((self.pos, *self.court.neighbors[self.pos]))

    def push(self, team: str) -> str:
        x, y = self.pos
        stop = self.east if team == COPPER else self.west
        x = min(x + 1, stop) if team == COPPER else max(x - 1, stop)
        self.pos = (x, y)
        if x == stop:
            self.finished_by = team
            return f"{team} pushes the roller to the far stop."
        return f"{team} pushes the roller to {self.offset:+d}."

    @property
    def leader(self) -> str | None:
        if self.offset > 0:
            return COPPER
        if self.offset < 0:
            return INDIGO
        return None

    def markers(self) -> dict[Position, str]:
        y = self.pos[1]
        marks = {(x, y): ":" for x in range(self.west, self.east + 1)}
        marks[self.west, y] = "<"
        marks[self.east, y] = ">"
        marks[self.pos] = "@"
        return marks
