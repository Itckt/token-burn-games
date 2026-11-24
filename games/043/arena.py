"""Compare two minimax depths by giving each engine both seats in the same opening."""

from collections.abc import Iterator
from dataclasses import dataclass

from ai import SearchResult, choose_move, resolve_depth
from games import CONNECT_FOUR, DRAW, TIC_TAC_TOE, GameHistory, InvalidHistory, Rules


OPENINGS = {
    TIC_TAC_TOE: ((), (2, 5), (1, 5, 9)),
    CONNECT_FOUR: ((), (2,), (3, 4, 3, 4)),
}


@dataclass(frozen=True, slots=True)
class ArenaGame:
    x_engine: str
    o_engine: str
    moves: tuple[int, ...]
    outcome: str
    # Searches start after the supplied opening. Each belongs to the engine on move.
    searches: tuple[tuple[str, SearchResult], ...]

    @property
    def winner(self) -> str | None:
        if self.outcome == DRAW:
            return None
        return self.x_engine if self.outcome == "X" else self.o_engine


def _play_game(rules: Rules, opening: tuple[int, ...], x_engine: str, o_engine: str,
               depths: dict[str, int], node_budget: int | None) -> ArenaGame:
    game = GameHistory(rules, opening)
    searches = []
    while game.position.outcome is None:
        board = game.position
        engine = x_engine if board.turn == "X" else o_engine
        choice = choose_move(board, depths[engine], node_budget=node_budget)
        assert choice.move is not None
        game.play(choice.move)
        searches.append((engine, choice))
    return ArenaGame(x_engine, o_engine, game.moves, game.position.outcome, tuple(searches))


def play_pair(opening: GameHistory, depth_a: int, depth_b: int, *,
              node_budget: int | None = None) -> Iterator[ArenaGame]:
    """Snapshot a live opening and play it twice, swapping A and B for game two."""
    board = opening.position
    if board.outcome is not None:
        raise InvalidHistory("The arena needs an unfinished opening.")
    depths = {"A": resolve_depth(board.rules, depth_a), "B": resolve_depth(board.rules, depth_b)}
    moves = opening.moves
    return (_play_game(board.rules, moves, x, o, depths, node_budget)
            for x, o in (("A", "B"), ("B", "A")))
