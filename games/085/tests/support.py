from collections import deque


class ScriptedShoe:
    """Cards in physical deal order. An unexpected draw fails the test."""

    def __init__(self, draws):
        self.cards = deque(draws)
        self.preparations = 0

    def prepare_round(self):
        self.preparations += 1

    def draw(self):
        if not self.cards:
            raise AssertionError("The round drew an extra card")
        return self.cards.popleft()
