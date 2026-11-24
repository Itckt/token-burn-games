"""Depth-limited minimax with alpha-beta pruning, shared by both games."""

from collections.abc import Iterator
from dataclasses import dataclass

from games import DRAW, GameHistory, Position, Rules


# Even 69 three-piece Connect Four windows would be worth only 69 * 64.
WIN_SCORE = 10_000
_WINDOW_WEIGHTS = (0, 1, 8, 64)
# Keep a deep Connect Four search from retaining its entire tree.
_TABLE_LIMIT = 100_000


@dataclass(frozen=True, slots=True)
class SearchResult:
    """A score for the mover at the reported depth, with work for the whole decision."""

    move: int | None
    score: int
    depth: int
    nodes: int
    cutoffs: int
    cache_hits: int = 0


@dataclass(frozen=True, slots=True)
class ScoredMove:
    move: int
    score: int


@dataclass(frozen=True, slots=True)
class Analysis:
    """Moves ranked for the side to play, plus one optimal line at this depth."""

    best: SearchResult
    ranked_moves: tuple[ScoredMove, ...]
    line: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class ReviewedMove:
    """The played move and the best alternative, scored for the same player."""

    position: Position
    played: ScoredMove
    best: SearchResult

    @property
    def loss(self) -> int:
        return self.best.score - self.played.score


def plies_to_finish(position: Position, score: int) -> int | None:
    """Decode the distance of a proven win or loss from this position."""
    if abs(score) < WIN_SCORE:
        return None
    return position.remaining + WIN_SCORE - abs(score)


def _evaluate(position: Position) -> int:
    """Score open winning lines on a nonterminal board, from the mover's side."""
    score = 0
    for line in position.rules.winning_masks:
        xs = position.x_bits & line
        os = position.o_bits & line
        if not os:
            score += _WINDOW_WEIGHTS[xs.bit_count()]
        elif not xs:
            score -= _WINDOW_WEIGHTS[os.bit_count()]
    return score if position.turn == "X" else -score


@dataclass(frozen=True, slots=True)
class _Entry:
    score: int
    move: int | None = None
    bound: str = "exact"

    def answers(self, alpha: int, beta: int) -> bool:
        # A cutoff proves only a bound. Reuse it when it proves a cutoff
        # in the new window too. A wider window may need another search.
        return (self.bound == "exact"
                or (self.bound == "lower" and self.score >= beta)
                or (self.bound == "upper" and self.score <= alpha))


def resolve_depth(rules: Rules, depth: int | None) -> int:
    """Return a positive search depth, using the game's default when omitted."""
    depth = rules.default_depth if depth is None else depth
    if type(depth) is not int or depth < 1:
        raise ValueError("Search depth must be a positive integer.")
    return depth


class _NodeBudgetReached(Exception):
    """Unwind an incomplete iteration without using its bounds as a root result."""


class _Search:
    """One decision's alpha-beta search and depth-specific transposition table."""

    def __init__(self, position: Position, depth: int, node_budget: int | None = None):
        self.depth = min(depth, position.remaining)
        self.limit = WIN_SCORE + position.rules.rows * position.rules.columns + 1
        self.table: dict[tuple[int, int, int], _Entry] = {}
        self.node_budget = node_budget
        self.nodes = 0
        self.cutoffs = 0
        self.cache_hits = 0

    def result(self, move: int | None, score: int, *, depth: int | None = None) -> SearchResult:
        return SearchResult(move, score, self.depth if depth is None else depth,
                            self.nodes, self.cutoffs, self.cache_hits)

    def exact(self, board: Position, left: int) -> _Entry:
        return self.minimax(board, left, -self.limit, self.limit)

    def minimax(self, board: Position, left: int, alpha: int, beta: int) -> _Entry:
        if self.node_budget is not None and self.nodes >= self.node_budget:
            raise _NodeBudgetReached
        self.nodes += 1
        key = (board.x_bits, board.o_bits, left)
        cached = self.table.get(key)
        if cached is not None and cached.answers(alpha, beta):
            self.cache_hits += 1
            return cached

        if board.outcome is not None:
            # The previous mover won. More empty cells means an earlier finish.
            entry = _Entry(0 if board.outcome == DRAW else -(WIN_SCORE + board.remaining))
        elif left == 0:
            entry = _Entry(_evaluate(board))
        else:
            original_alpha = alpha
            best_score = -self.limit
            best_move = None
            for move, child in board.successors():
                score = -self.minimax(child, left - 1, -beta, -alpha).score
                if score > best_score:
                    best_score, best_move = score, move
                alpha = max(alpha, best_score)
                if alpha >= beta:
                    self.cutoffs += 1
                    break

            bound = "exact"
            if best_score >= beta:
                bound = "lower"
            elif best_score <= original_alpha:
                bound = "upper"
            entry = _Entry(best_score, best_move, bound)

        if cached is not None or len(self.table) < _TABLE_LIMIT:
            self.table[key] = entry
        return entry


def choose_move(position: Position, depth: int | None = None, *,
                node_budget: int | None = None) -> SearchResult:
    """Choose at fixed depth, or return the last complete depth within a node budget.

    If even one ply does not fit, use the first legal move and the static score of
    the current position (depth zero). All node visits count, including cache hits.
    """
    if node_budget is not None and (type(node_budget) is not int or node_budget < 1):
        raise ValueError("Node budget must be a positive integer.")
    search = _Search(position, resolve_depth(position.rules, depth), node_budget)
    if node_budget is None or position.outcome is not None:
        depth_limit = search.depth if node_budget is None else 0
        best = search.exact(position, depth_limit)
        return search.result(best.move, best.score, depth=depth_limit)

    best = None
    completed = 0
    for left in range(1, search.depth + 1):
        # Each board has a fixed distance from this root. At a new depth all
        # its depth-specific table keys change, so reclaim the space.
        search.table.clear()
        try:
            best = search.exact(position, left)
        except _NodeBudgetReached:
            break
        completed = left
    if best is None:
        return search.result(position.legal_moves()[0], _evaluate(position), depth=0)
    return search.result(best.move, best.score, depth=completed)


def analyze_position(position: Position, depth: int | None = None) -> Analysis:
    """Score every legal move exactly at the requested depth and trace the best replies."""
    search = _Search(position, resolve_depth(position.rules, depth))
    if position.outcome is not None:
        end = search.exact(position, search.depth)
        return Analysis(search.result(None, end.score), (), ())

    search.nodes += 1  # The root visits every option with a full window.
    ranked = [
        ScoredMove(move, -search.exact(child, search.depth - 1).score)
        for move, child in position.successors()
    ]
    # Stable sorting preserves the board's move order on equal scores.
    ranked.sort(key=lambda choice: choice.score, reverse=True)
    best = ranked[0]
    line = [best.move]
    board = position.play(best.move)
    while len(line) < search.depth and board.outcome is None:
        reply = search.exact(board, search.depth - len(line))
        assert reply.move is not None
        line.append(reply.move)
        board = board.play(reply.move)
    return Analysis(search.result(best.move, best.score), tuple(ranked), tuple(line))


def review_game(game: GameHistory, depth: int | None = None) -> Iterator[ReviewedMove]:
    """Compare each recorded move with best play at that turn's depth limit."""
    limit = resolve_depth(game.position.rules, depth)
    for board, move in game.turns():
        search = _Search(board, limit)
        best = search.exact(board, search.depth)
        played_score = best.score
        if move != best.move:
            # A sibling may have been pruned. Use a full window to measure the
            # actual loss, including when a different move ties for best.
            played_score = -search.exact(board.play(move), search.depth - 1).score
        yield ReviewedMove(board, ScoredMove(move, played_score),
                           search.result(best.move, best.score))
