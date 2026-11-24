"""Plain-text boards, move advice and game reports."""

from collections.abc import Iterable

from ai import SearchResult, analyze_position, plies_to_finish, review_game
from arena import OPENINGS, play_pair
from games import DRAW, GameHistory, Position, Rules
from tactics import inspect_tactics


def render(position: Position) -> str:
    rules = position.rules
    rows = []
    for row in range(rules.rows):
        cells = []
        for col in range(rules.columns):
            empty = "." if rules.gravity else str(row * rules.columns + col + 1)
            cells.append(position.cell_at(row, col) or empty)
        if rules.gravity:
            rows.append("| " + " ".join(cells) + " |")
        else:
            rows.append(" " + " | ".join(cells))
    if rules.gravity:
        rows.append("+" + "-" * (2 * rules.columns + 1) + "+")
        rows.append("  " + " ".join(str(col) for col in range(1, rules.columns + 1)))
        return "\n".join(rows)
    divider = "+".join(["---"] * rules.columns)
    return ("\n" + divider + "\n").join(rows)


def print_stats(result: SearchResult) -> None:
    print(f"Depth {result.depth} | score {result.score} | "
          f"nodes {result.nodes} | cutoffs {result.cutoffs}")
    print(f"Cache hits {result.cache_hits}")
    if result.depth == 0 and result.move is not None:
        print("No full ply fit. Using the first legal move and the static board score.")


def print_status(position: Position) -> None:
    if position.outcome == DRAW:
        print("Draw.")
    elif position.outcome is not None:
        print(f"{position.outcome} wins!")
    else:
        print(f"{position.turn} to move.")


def format_line(position: Position, moves: tuple[int, ...]) -> str:
    marks = "XO" if position.turn == "X" else "OX"
    return " ".join(f"{marks[ply % 2]}{move}" for ply, move in enumerate(moves))


def print_analysis(position: Position, depth: int | None, stats: bool) -> None:
    analysis = analyze_position(position, depth)
    best = analysis.best
    if best.move is None:
        if stats:
            print_stats(best)
        print_status(position)
        return
    print(f"Best move for {position.turn} at depth {best.depth} is {best.move}.")
    print("Best line  " + format_line(position, analysis.line))
    print(f"Move  Score for {position.turn}")
    for choice in analysis.ranked_moves:
        print(f"{choice.move:>4}  {choice.score:>7}")
    if stats:
        print_stats(best)


def print_history(game: GameHistory) -> None:
    moves = game.moves
    if moves:
        print("Move history  --moves " + ",".join(map(str, moves)))
    else:
        print("No moves yet.")


def describe_score(board: Position, score: int, depth: int) -> str:
    distance = plies_to_finish(board, score)
    if distance is not None:
        outcome = "win" if score > 0 else "loss"
        unit = "ply" if distance == 1 else "plies"
        return f"a forced {outcome} in {distance} {unit}"
    if depth == board.remaining:
        return "a draw with best play"
    return f"a depth-{depth} estimate of {score:+d}"


def print_review(game: GameHistory, depth: int | None, stats: bool) -> None:
    if not game.moves:
        print("No moves to review.")
        return
    header = "Ply  Side  Depth  Played   Score  Best   Score    Loss"
    print(header + ("    Nodes  Cutoffs  Cache hits" if stats else ""))
    totals = {"X": 0, "O": 0}
    matches = {"X": 0, "O": 0}
    largest_loss = None
    for ply, turn in enumerate(review_game(game, depth), 1):
        mark = turn.position.turn
        best = turn.best
        row = (f"{ply:>3}  {mark:>4}  {best.depth:>5}  {turn.played.move:>6}  "
               f"{turn.played.score:>6}  {best.move:>4}  {best.score:>6}  {turn.loss:>6}")
        if stats:
            row += f"  {best.nodes:>7}  {best.cutoffs:>7}  {best.cache_hits:>10}"
        print(row)
        totals[mark] += 1
        if turn.loss == 0:
            matches[mark] += 1
        elif largest_loss is None or turn.loss > largest_loss[1].loss:
            largest_loss = ply, turn
    print("Moves matching the best score  " + " | ".join(
        f"{mark} {matches[mark]}/{totals[mark]}" for mark in "XO" if totals[mark]
    ))
    if largest_loss is not None:
        ply, turn = largest_loss
        board, best = turn.position, turn.best
        played_value = describe_score(board, turn.played.score, best.depth)
        best_value = describe_score(board, best.score, best.depth)
        print(f"Largest loss at ply {ply}. {board.turn}{turn.played.move} gives {played_value}. "
              f"{board.turn}{best.move} gives {best_value}.")


def print_tactics(board: Position) -> None:
    if board.outcome is not None:
        print_status(board)
        return
    mark = board.turn
    opponent = "O" if mark == "X" else "X"
    print(f"Tactics for {mark} through the next three plies")
    for choice in inspect_tactics(board):
        if choice.outcome == DRAW:
            verdict = "draws now"
        elif choice.outcome == mark:
            verdict = "wins now"
        elif choice.winning_replies:
            replies = ", ".join(f"{opponent}{move}" for move in choice.winning_replies)
            verdict = f"allows an immediate win by {replies}"
        elif choice.winning_answers:
            verdict = "forces a win next turn"
        else:
            verdict = "survives the next reply"
        print(f"  {mark}{choice.move}  {verdict}")
        if choice.winning_answers:
            print("      " + ", ".join(f"{opponent}{reply} -> {mark}{win}"
                                      for reply, win in choice.winning_answers))


def print_arena(rules: Rules, depth_a: int, depth_b: int, *, moves: Iterable[int] | None,
                node_budget: int | None, stats: bool) -> None:
    sequences = OPENINGS[rules] if moves is None else (moves,)
    openings = (GameHistory(rules, seq) for seq in sequences)
    pairs = [(game, play_pair(game, depth_a, depth_b, node_budget=node_budget)) for game in openings]

    print(f"{rules.title} | Paired arena")
    print(f"A depth {depth_a} | B depth {depth_b}")
    if node_budget is not None:
        print(f"Node budget {node_budget} per computer move")
    wins = {"A": 0, "B": 0, None: 0}
    searches: dict[str, list[SearchResult]] = {"A": [], "B": []}
    for index, (opening, games) in enumerate(pairs, 1):
        start = ",".join(map(str, opening.moves)) or "(empty board)"
        print(f"Opening {index}  {start}  | {opening.position.turn} to move")
        for game in games:
            winner = game.winner
            wins[winner] += 1
            result = "Draw." if winner is None else f"{game.outcome} wins for {winner}."
            history = ",".join(map(str, game.moves))
            print(f"  X={game.x_engine} O={game.o_engine} | {result} | --moves {history}")
            if stats:
                for engine, decision in game.searches:
                    searches[engine].append(decision)
    print(f"A wins {wins['A']} | B wins {wins['B']} | Draws {wins[None]}")
    if stats:
        for engine, decisions in searches.items():
            nodes = sum(d.nodes for d in decisions)
            cutoffs = sum(d.cutoffs for d in decisions)
            hits = sum(d.cache_hits for d in decisions)
            print(f"{engine} moves {len(decisions)} | nodes {nodes} | cutoffs {cutoffs} | cache hits {hits}")
