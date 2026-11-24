"""Automated tests for the game, the search and the terminal interface."""

import unittest
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
STUCK = ((2, 4, 2, 4), (4, 2, 4, 2)) * 2


class FileTestCase(unittest.TestCase):
    def setUp(self):
        self.folder = ROOT / f".2048-test-{uuid4().hex}"
        self.folder.mkdir()
        self.addCleanup(self.remove_files)

    def remove_files(self):
        for path in self.folder.iterdir():
            path.unlink()
        self.folder.rmdir()
