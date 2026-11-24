"""Text views of a position and the available practice tools."""

from fractions import Fraction

from .ai import Score, forecast_move, rank_moves
from .engine import SIZE, Board, Game
from .session import Session


def render_board(board: Board) -> str:
    width = max(4, len(str(max(map(max, board)))))
    border = "+" + "+".join(["-" * (width + 2)] * SIZE) + "+"
    lines = [border]
    for row in board:
        cells = [f" {tile or '':>{width}} " for tile in row]
        lines.extend(("|" + "|".join(cells) + "|", border))
    return "\n".join(lines)


def render(game: Game) -> str:
    status = f"Score {game.score}    Moves {game.moves}    Best tile {game.largest}"
    return f"{status}\n{render_board(game.board)}"


def format_value(value: Score) -> str:
    return str(value) if isinstance(value, Fraction) else f"{value:.2f}"


def render_coach(board: Board, depth: int) -> str:
    options = rank_moves(board, depth)
    if not options:
        return "No legal slides remain."
    lines = [f"Coach | depth {depth} | best first",
             "Slide    Merge   Loss on next spawn   Search value"]
    for option in options:
        lines.append(f"{option.direction:<5} {option.merge_points:+8d}"
                     f" {option.loss_probability:>20.0%} {format_value(option.expected_value):>14}")
    return "\n".join(lines)


def challenge_ending(session: Session) -> str | None:
    game = session.game
    outcome = session.challenge_outcome(game)
    if outcome is None:
        return None
    if session.puzzle is None:
        return f"Daily sprint complete: {game.score} points in {game.moves} slides."
    if outcome == "solved":
        return f"Puzzle solved! Reached {session.puzzle.target} in {game.moves} slides."
    return f"Puzzle ended ({outcome}). Best tile {game.largest} of {session.puzzle.target}."


def render_preview(session: Session, direction: str, move_limit: int | None = None) -> str:
    game = session.game
    forecast = forecast_move(game.board, direction)
    if forecast is None:
        return f"Preview {direction} | That slide is blocked."
    lines = [f"Preview {direction} | {forecast.merge_points:+d} points before the spawn",
             render_board(forecast.board)]
    projected = Game(forecast.board, game.score + forecast.merge_points, game.moves + 1)
    outcome = session.challenge_outcome(projected)
    if outcome is not None:
        return "\n".join([*lines, f"This slide finishes the challenge ({outcome})."])
    if move_limit is not None and projected.moves >= move_limit:
        return "\n".join([*lines, "This slide reaches the move limit."])
    lines.append("Best total merge points on the following slide | Chance")
    for points in sorted((p for p in forecast.replies if p is not None), reverse=True):
        lines.append(f"{points:+d} points   {float(forecast.replies[points]):.1%}")
    if None in forecast.replies:
        lines.append(f"No legal slide   {float(forecast.replies[None]):.1%}")
    return "\n".join(lines)


def _slide_count(count: int) -> str:
    return f"{count} slide" if count == 1 else f"{count} slides"


def render_solution(session: Session, move_limit: int | None = None) -> str:
    puzzle = session.puzzle
    if puzzle is None:
        return "Solve is available during a puzzle. Use --list-puzzles to see the openings."
    route = puzzle.shortest_solution(session.game, session.rng)
    if route is None:
        remaining = max(0, puzzle.limit - session.game.moves)
        return f"No solution in the remaining {_slide_count(remaining)}."
    if not route:
        return f"Puzzle already solved. The board has reached {puzzle.target}."
    lines = [f"Shortest solution | {_slide_count(len(route))}", " -> ".join(route)]
    if move_limit is not None and session.game.moves + len(route) > move_limit:
        available = max(0, move_limit - session.game.moves)
        lines.append(f"Move limit | {_slide_count(available)} remaining in this session")
    return "\n".join(lines)
