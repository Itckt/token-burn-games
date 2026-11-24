import subprocess
import sys
from pathlib import Path

from pinchline.battle import Battle

ROOT = Path(__file__).resolve().parents[1]


def cli(*args):
    return subprocess.run(
        [sys.executable, "-B", "-m", "pinchline", *args],
        cwd=ROOT, stdin=subprocess.DEVNULL, capture_output=True,
        encoding="ascii", timeout=15, check=False,
    )


def grid(picture):
    return [line.split("|")[1].split() for line in picture.splitlines() if line.startswith("|")]


def arrange(positions, *, seed=852, beat=0, **options):
    """Set up one beat on the real engine. An unplaced fighter starts out."""
    game = Battle(seed, **options)
    game.beat = beat
    game.zone = game.court.zone_at(beat)
    moving_objective = game.courier or game.rail
    if moving_objective is not None:
        moving_objective.fold(game.zone)
    units = {fighter.token: fighter for fighter in game.fighters}
    for token, unit in units.items():
        unit.charge = 0
        if token in positions:
            unit.pos = positions[token]
        else:
            unit.hp = 0
    return game, units
