import unittest
from datetime import date, datetime, timezone
from random import Random
from unittest.mock import patch

from game2048.ai import choose_move
from game2048.engine import EMPTY_BOARD, Game
from game2048.session import DAILY_MOVES, HISTORY_LIMIT, Session, hong_kong_today


def position(session):
    game = session.game
    return game.board, game.score, game.moves, session.rng.getstate()


class HistoryTests(unittest.TestCase):
    def test_every_undo_and_redo_restores_the_entire_position(self):
        session = Session.new(73)
        expected = [position(session)]
        for _ in range(8):
            self.assertTrue(session.move(choose_move(session.game.board, 1)))
            expected.append(position(session))
        self.assertGreater(session.game.score, 0)
        for snapshot in reversed(expected[:-1]):
            self.assertTrue(session.undo())
            self.assertEqual(position(session), snapshot)
        self.assertFalse(session.undo())
        self.assertEqual(position(session), expected[0])
        for snapshot in expected[1:]:
            self.assertTrue(session.redo())
            self.assertEqual(position(session), snapshot)
        self.assertFalse(session.redo())
        self.assertEqual(position(session), expected[-1])

    def test_only_a_successful_new_move_discards_the_redo_branch(self):
        board = ((2, 4, 0, 0), *EMPTY_BOARD[1:])
        session = Session(Game(board), Random(27))
        self.assertTrue(session.move("right"))
        original_result = position(session)
        self.assertTrue(session.undo())
        self.assertFalse(session.move("left"))
        with self.assertRaises(ValueError):
            session.move("diagonal")
        self.assertTrue(session.redo())
        self.assertEqual(position(session), original_result)
        self.assertTrue(session.undo())
        self.assertTrue(session.move("down"))
        self.assertFalse(session.redo())
        reference, generator = Game(board), Random(27)
        self.assertTrue(reference.move("down", generator))
        self.assertEqual(session.game, reference)
        self.assertEqual(session.rng.getstate(), generator.getstate())

    def test_history_is_bounded_and_keeps_the_most_recent_turns(self):
        session = Session.new(17)
        for _ in range(HISTORY_LIMIT + 3):
            self.assertTrue(session.move(choose_move(session.game.board, 1)))
        final = position(session)
        for _ in range(HISTORY_LIMIT):
            self.assertTrue(session.undo())
        self.assertEqual(session.game.moves, 3)
        self.assertFalse(session.can_undo)
        self.assertFalse(session.undo())
        for _ in range(HISTORY_LIMIT):
            self.assertTrue(session.redo())
        self.assertEqual(position(session), final)


class DailyTests(unittest.TestCase):
    def test_date_selects_the_same_opening_and_spawn_stream_as_numeric_seed(self):
        day = date(2024, 2, 29)
        sprint = Session.new(day=day)
        seeded = Session.new(20240229)
        for _ in range(12):
            self.assertEqual(position(sprint), position(seeded))
            choice = choose_move(seeded.game.board, 1)
            self.assertTrue(sprint.move(choice))
            self.assertTrue(seeded.move(choice))
        self.assertEqual(position(sprint), position(seeded))
        self.assertNotEqual(Session.new(day=day).rng.getstate(),
                            Session.new(day=date(2024, 3, 1)).rng.getstate())
        with self.assertRaises(ValueError):
            Session.new(10, day=day)

    def test_rollover_is_at_hong_kong_midnight_not_the_host_midnight(self):
        for hour, minute, expected in ((15, 59, date(2026, 12, 31)), (16, 0, date(2027, 1, 1))):
            instant = datetime(2026, 12, 31, hour, minute, tzinfo=timezone.utc)
            with self.subTest(instant=instant), patch("game2048.session.datetime") as clock:
                clock.now.side_effect = instant.astimezone
                self.assertEqual(hong_kong_today(), expected)

    def test_sprint_cannot_advance_past_the_bell(self):
        sprint = Session.new(day=date(2026, 11, 23))
        for _ in range(DAILY_MOVES):
            self.assertFalse(sprint.daily_finished)
            self.assertTrue(sprint.move(choose_move(sprint.game.board, 1)))
        self.assertTrue(sprint.daily_finished)
        final = position(sprint)
        self.assertFalse(sprint.move(choose_move(sprint.game.board, 1)))
        self.assertEqual(position(sprint), final)
        self.assertTrue(sprint.undo())
        self.assertFalse(sprint.daily_finished)
        self.assertTrue(sprint.redo())
        self.assertTrue(sprint.daily_finished)
        self.assertEqual(position(sprint), final)
