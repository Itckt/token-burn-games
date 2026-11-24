"""Small tactics positions. The solver checks the goal for each legal answer."""

from dataclasses import dataclass

from ai import plies_to_finish
from games import CONNECT_FOUR, TIC_TAC_TOE, Position


@dataclass(frozen=True)
class Puzzle:
    opening: tuple[int, ...]
    # Use None for a defense against the opponent's next reply.
    win_in: int | None = None

    def __post_init__(self) -> None:
        if self.win_in is not None and (type(self.win_in) is not int or self.win_in < 1):
            raise ValueError("A win goal must allow a positive whole number of turns.")

    @property
    def plies(self) -> int:
        return 2 if self.win_in is None else 2 * self.win_in - 1

    @property
    def goal(self) -> str:
        if self.win_in is None:
            return "Prevent a win on the opponent's next reply."
        if self.win_in == 1:
            return "Win on this move."
        return f"Force a win within {self.win_in} of your turns."

    def accepts(self, board: Position, score: int) -> bool:
        """Grade a mover-relative minimax score searched through the goal's horizon."""
        distance = plies_to_finish(board, score)
        if distance is None or distance > self.plies:
            return self.win_in is None
        return score > 0


PUZZLES = {
    TIC_TAC_TOE: {
        "first-finish": Puzzle((1, 2, 5, 3), win_in=1),
        "one-reply": Puzzle((1, 2, 3, 5)),
        "crossroads": Puzzle((2, 1, 4, 3, 8), win_in=2),
    },
    CONNECT_FOUR: {
        "fourth-disc": Puzzle((1, 4, 2, 4, 7, 4, 7), win_in=1),
        "platform-gap": Puzzle((1, 7, 2, 7, 3)),
        "two-exits": Puzzle((3, 7, 4, 7), win_in=2),
    },
}
