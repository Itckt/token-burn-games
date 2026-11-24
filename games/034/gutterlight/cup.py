"""Seeded round-robin fixtures for comparing decks in both seats."""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations

from .battle import Battle, DEFAULT_LIMIT, Mode, Outcome, Setup, check_seed
from .cards import DECKS, resolve_deck
from .display import clock_text
from .pilot import simulate


@dataclass(frozen=True, slots=True)
class Fixture:
    seed: int
    amber: int
    indigo: int
    tick: int
    outcome: Outcome


@dataclass(slots=True)
class Standing:
    entry: int
    wins: int = 0
    draws: int = 0
    losses: int = 0

    @property
    def points(self) -> int:
        return 3 * self.wins + self.draws


@dataclass(frozen=True, slots=True)
class Cup:
    decks: tuple[tuple[str, ...], ...]
    mode: Mode
    limit_ticks: int
    fixtures: tuple[Fixture, ...]
    selected_game: Battle | None

    def standings(self) -> list[Standing]:
        rows = [Standing(i) for i in range(len(self.decks))]
        for fixture in self.fixtures:
            seats = (rows[fixture.amber], rows[fixture.indigo])
            winner = fixture.outcome.winner
            if winner is None:
                for row in seats:
                    row.draws += 1
            else:
                seats[winner].wins += 1
                seats[winner.other].losses += 1
        return sorted(rows, key=lambda row: row.points, reverse=True)


def run_cup(decks: Sequence[str | Sequence[str]], seed: int, *, rounds: int = 1,
            mode: Mode = Mode.CLASSIC, limit_ticks: int = DEFAULT_LIMIT,
            keep_game: int | None = None) -> Cup:
    check_seed(seed)
    mode = Mode(mode)
    entries = tuple(resolve_deck(deck) for deck in decks)
    if len(entries) < 2:
        raise ValueError("A cup needs at least two deck entries.")
    if type(rounds) is not int or rounds < 1:
        raise ValueError("Choose a positive number of rounds.")
    game_count = rounds * len(entries) * (len(entries) - 1)
    if keep_game is not None and (type(keep_game) is not int or not 1 <= keep_game <= game_count):
        raise ValueError(f"Choose a fixture number from 1 to {game_count}.")

    fixtures = []
    selected = None
    for offset in range(rounds):
        round_seed = (seed + offset) % 2**32
        for first, second in combinations(range(len(entries)), 2):
            for amber, indigo in ((first, second), (second, first)):
                setup = Setup.deal(round_seed, limit_ticks, entries[amber], entries[indigo], mode=mode)
                battle = simulate(setup)
                assert battle.outcome is not None
                fixtures.append(Fixture(round_seed, amber, indigo, battle.tick, battle.outcome))
                if len(fixtures) == keep_game:
                    selected = battle
    return Cup(entries, mode, limit_ticks, tuple(fixtures), selected)


def cup_table(cup: Cup) -> str:
    presets = {deck: name.title() for name, deck in DECKS.items()}
    names = [f"{i}. {presets.get(deck, 'Custom')}" for i, deck in enumerate(cup.decks, start=1)]
    lines = ["GUTTERLIGHT RELAY  /  KOWLOON TONG CUP",
             f"{cup.mode.value.title()}    Clock {clock_text(cup.limit_ticks)}    "
             f"{len(cup.fixtures)} fixtures    Starting seed {cup.fixtures[0].seed}"]
    for name, deck in zip(names, cup.decks):
        if deck not in presets:
            lines.append(f"{name}    {','.join(deck)}")
    lines.extend(["", "GAME        SEED  AMBER         INDIGO        FINISH  WINNER"])
    for index, fixture in enumerate(cup.fixtures, start=1):
        seats = (names[fixture.amber], names[fixture.indigo])
        winner = fixture.outcome.winner
        result = "Draw" if winner is None else seats[winner]
        lines.append(f"{index:>4}  {fixture.seed:>10}  {seats[0]:<12}  {seats[1]:<12}  "
                     f"{clock_text(fixture.tick):>6}  {result} ({fixture.outcome.reason})")

    lines.extend(["", "PLACE  DECK              W    D    L   PTS"])
    previous_points = None
    place = 0
    for index, row in enumerate(cup.standings(), start=1):
        if row.points != previous_points:
            place = index
            previous_points = row.points
        lines.append(f"{place:>5}  {names[row.entry]:<14} {row.wins:>4} {row.draws:>4} "
                     f"{row.losses:>4} {row.points:>5}")
    return "\n".join(lines)
