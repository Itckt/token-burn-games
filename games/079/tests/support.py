from contextlib import contextmanager
import copy
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
from uuid import uuid4

from desk.catalog import Brief, CLEAR_TRAILS, RISK_TRAILS
from desk.game import Game, Gig, RuleError, make_week


ROOT = Path(__file__).resolve().parents[1]


def gig(number, effort=1, due=4, fee=200, breach="", field="Design"):
    brief = Brief(f"Brief {number}", field, "Set a proof.",
                  tuple(f"Proof pass {i + 1}." for i in range(effort)), "Beautiful proof.")
    trail = (next(t for t in RISK_TRAILS if t.breach == breach)
             if breach else CLEAR_TRAILS[0])
    return Gig(number, f"Client {number}", brief, fee, due, trail)


def desk_with(*custom_gigs):
    """Keep real day turnover but choose specific deadlines and evidence for a case."""
    week = [list(day) for day in make_week(0)]
    for item in custom_gigs:
        day, slot = divmod(item.number - 1, 3)
        week[day][slot] = item
    with patch("desk.game.make_week", return_value=tuple(tuple(day) for day in week)):
        return Game(0)


def moves(game, *commands):
    messages = []
    for command in commands:
        messages.extend(game.act(command))
    return "\n".join(messages)


class DeskCase(unittest.TestCase):
    def assert_rejected(self, game, command, reason):
        before = copy.deepcopy(vars(game))
        with self.assertRaisesRegex(RuleError, reason):
            game.act(command)
        self.assertEqual(vars(game), before, f"Rejected move changed the desk: {command}")


@contextmanager
def scratch_dir():
    # Use the game folder's inherited permissions, including on managed Windows.
    folder = ROOT / (".friday-test-" + uuid4().hex[:12])
    folder.mkdir()
    try:
        yield folder
    finally:
        if folder.resolve().parent != ROOT:
            raise RuntimeError("Test folder moved outside the project.")
        shutil.rmtree(folder)
