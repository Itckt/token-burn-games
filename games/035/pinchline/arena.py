"""Court layouts, pulse distances, and movement through the folding play area."""

from collections import deque
from collections.abc import Callable, Collection
from dataclasses import dataclass
from random import Random

Position = tuple[int, int]

DIRECTIONS = ((0, -1), (1, 0), (0, 1), (-1, 0))
FOLD_INTERVAL = 5


@dataclass(frozen=True)
class Zone:
    level: int
    left: int
    top: int
    right: int
    bottom: int

    def gap(self, tile: Position) -> int:
        """Number of grid steps outside the rectangle, zero for safe tiles."""
        x, y = tile
        return max(self.left - x, 0, x - self.right) + max(self.top - y, 0, y - self.bottom)

    def contains(self, tile: Position) -> bool:
        x, y = tile
        return self.left <= x <= self.right and self.top <= y <= self.bottom

    @property
    def damage(self) -> int:
        return 2 + self.level if self.level else 0


class Court:
    def __init__(self, name: str, tiles: tuple[str, ...], west_marks: tuple[Position, ...]):
        self.name = name
        self.tiles = tiles
        self.width, self.height = len(tiles[0]), len(tiles)
        self.west_marks = west_marks
        self.east_marks = tuple((self.width - 1 - x, self.height - 1 - y) for x, y in west_marks)
        self.floor = frozenset(
            (x, y) for y, row in enumerate(tiles) for x, tile in enumerate(row) if tile == "."
        )
        self.neighbors = {
            (x, y): tuple(
                (x + dx, y + dy) for dx, dy in DIRECTIONS if (x + dx, y + dy) in self.floor
            )
            for x, y in self.floor
        }
        self.center = self.width // 2, self.height // 2
        self.press_tiles = frozenset((self.center, *self.neighbors[self.center]))
        self.last_fold = max(self.center)
        self._lanes: dict[Position, dict[Position, int]] = {}

    def _lane_map(self, origin: Position) -> dict[Position, int]:
        distances = {origin: 0}
        queue = deque([origin])
        while queue:
            tile = queue.popleft()
            for neighbor in self.neighbors[tile]:
                if neighbor not in distances:
                    distances[neighbor] = distances[tile] + 1
                    queue.append(neighbor)
        return distances

    def lane_distance(self, start: Position, end: Position) -> int:
        """Pulses can bend around a baffle and travel through occupied tiles."""
        if start not in self._lanes:
            self._lanes[start] = self._lane_map(start)
        return self._lanes[start][end]

    def zone_at(self, beat: int) -> Zone:
        if beat < 0:
            raise ValueError("a beat cannot be negative")
        level = min(beat // FOLD_INTERVAL, self.last_fold)
        cx, cy = self.center
        return Zone(level, min(level, cx), min(level, cy),
                    max(cx, self.width - 1 - level), max(cy, self.height - 1 - level))

    def next_step(
        self,
        start: Position,
        blocked: Collection[Position],
        allowed: Callable[[Position], bool],
        gap: Callable[[Position], int],
        rng: Random,
    ) -> Position | None:
        """Take a shortest free route to a zero-gap tile, or improve the gap.

        Breadth-first order also breaks equal gaps by least walking. Shuffling
        the first neighbors gives equally short first steps a seeded tie-break.
        """
        best_gap = gap(start)
        if best_gap == 0:
            return None
        best_step = None
        visited = set(blocked)
        visited.add(start)
        starts = list(self.neighbors[start])
        rng.shuffle(starts)
        queue = deque()
        for tile in starts:
            if tile not in visited and allowed(tile):
                queue.append((tile, tile))
                visited.add(tile)

        while queue:
            tile, first = queue.popleft()
            score = gap(tile)
            if score == 0:
                return first
            if score < best_gap:
                best_step, best_gap = first, score
            for neighbor in self.neighbors[tile]:
                if neighbor not in visited and allowed(neighbor):
                    visited.add(neighbor)
                    queue.append((neighbor, first))
        return best_step


LOOP = Court("Tong Loop Court", (
    ".................",
    ".................",
    ".....#.....#.....",
    ".....#.....#.....",
    ".......#.#.......",
    ".................",
    ".......#.#.......",
    ".....#.....#.....",
    ".....#.....#.....",
    ".................",
    ".................",
), ((2, 2), (1, 5), (2, 7)))

GALLEY = Court("Galley Steps", (
    ".............",
    "...##........",
    "....##..##...",
    ".....#...#...",
    "..##.....##..",
    "...#...#.....",
    "...##..##....",
    "........##...",
    ".............",
), ((1, 2), (1, 4), (2, 6)))

TRAMLINE = Court("Tramline Press", (
    "...................",
    "......#.....#......",
    "......#.....#......",
    "......#..#..#......",
    ".........#..#......",
    "..###.........###..",
    "......#..#.........",
    "......#..#..#......",
    "......#.....#......",
    "......#.....#......",
    "...................",
), ((2, 2), (1, 5), (2, 8)))

COURTS = {"loop": LOOP, "galley": GALLEY, "tramline": TRAMLINE}

# The original arena API describes Tong Loop Court.
TILES, WIDTH, HEIGHT = LOOP.tiles, LOOP.width, LOOP.height
WEST_MARKS, EAST_MARKS = LOOP.west_marks, LOOP.east_marks
FLOOR, NEIGHBORS, LAST_FOLD = LOOP.floor, LOOP.neighbors, LOOP.last_fold
lane_distance, next_step, zone_at = LOOP.lane_distance, LOOP.next_step, LOOP.zone_at
