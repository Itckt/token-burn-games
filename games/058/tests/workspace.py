"""Test files live in a fresh directory beneath the project."""

import shutil
import unittest
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]


class WorkspaceCase(unittest.TestCase):
    def setUp(self):
        self.folder = ROOT / (".steamfold-test-" + uuid4().hex)
        # Inherit the project's permissions, including its Windows sandbox ACL.
        self.folder.mkdir()
        self.addCleanup(self.remove_test_folder)

    def remove_test_folder(self):
        resolved = self.folder.resolve()
        if resolved.parent != ROOT or not resolved.name.startswith(".steamfold-test-"):
            raise RuntimeError("Unexpected test directory")
        shutil.rmtree(resolved)
