"""Short tactical proofs obtained by playing legal moves on the actual board."""

from dataclasses import dataclass

from games import Position


@dataclass(frozen=True, slots=True)
class MoveTactics:
    move: int
    outcome: str | None
    # All replies that let the opponent win immediately.
    winning_replies: tuple[int, ...] = ()
    # When the mover can force a win next turn, one finish for every reply.
    winning_answers: tuple[tuple[int, int], ...] = ()


def inspect_tactics(position: Position) -> tuple[MoveTactics, ...]:
    """Inspect each first move, each opposing reply and any one-move finishes."""
    choices = []
    for move, child in position.successors():
        if child.outcome is not None:
            choices.append(MoveTactics(move, child.outcome))
            continue

        losses = []
        answers = []
        replies = tuple(child.successors())
        for reply, after in replies:
            if after.outcome == child.turn:
                losses.append(reply)
                continue
            finish = next(after.winning_moves(), None)
            if finish is not None:
                answers.append((reply, finish))

        proof = tuple(answers) if len(answers) == len(replies) else ()
        choices.append(MoveTactics(move, None, tuple(losses), proof))
    return tuple(choices)
