"""Command-line, rule, and search tests."""

from games import Position


def replay(rules, moves):
    """Build a position through the same one-based moves a player enters."""
    position = Position(rules)
    for move in moves:
        position = position.play(move)
    return position
