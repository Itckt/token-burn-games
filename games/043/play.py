"""Play either game in a plain text terminal."""

import argparse
from collections.abc import Iterable, Iterator

from ai import analyze_position, choose_move, resolve_depth
from games import CONNECT_FOUR, TIC_TAC_TOE, GameHistory, InvalidHistory, Position, Rules
from puzzles import PUZZLES, Puzzle
from reports import describe_score as describe_score  # Preserve the original import from play.
from reports import (format_line, print_analysis, print_arena, print_history, print_review,
                     print_stats, print_status, print_tactics, render)


GAMES = {"tic-tac-toe": TIC_TAC_TOE, "connect-four": CONNECT_FOUR}


def read_move(position: Position, commands: tuple[str, ...]) -> int | str:
    rules = position.rules
    target = "column" if rules.gravity else "square"
    options = ", ".join(commands)
    prompt = (f"{position.turn}, choose a {target} "
              f"(1-{len(rules.target_masks)}, {options}, q to quit) > ")
    while True:
        try:
            entry = input(prompt).strip().lower()
        except EOFError:
            print()
            return "q"
        if entry in ("q", "quit"):
            return "q"
        if entry in commands:
            return entry
        try:
            return int(entry)
        except ValueError:
            print(f"Enter a whole number, {options}, or q to quit.")


def human_turn(game: GameHistory, depth: int | None, stats: bool, *, two_player: bool = False) -> bool:
    """Handle commands until the board changes or the player leaves."""
    while True:
        entry = read_move(game.position, ("hint", "tactics", "undo", "history", "review"))
        if isinstance(entry, int):
            try:
                game.play(entry)
                return True
            except ValueError as error:
                print(error)
        elif entry == "hint":
            print_analysis(game.position, depth, stats)
        elif entry == "tactics":
            print_tactics(game.position)
        elif entry == "history":
            print_history(game)
        elif entry == "review":
            print_review(game, depth, stats)
        elif entry == "undo":
            if game.undo_turn(1 if two_player else 2):
                print("Rewound one move." if two_player else "Rewound your move and the computer's reply.")
                return True
            print("No moves to undo." if two_player else "No move of yours to undo.")
        else:
            return False


def run_puzzle(rules: Rules, name: str, puzzle: Puzzle, depth: int | None, stats: bool) -> None:
    board = GameHistory(rules, puzzle.opening).position
    limit = puzzle.plies if depth is None else max(puzzle.plies, resolve_depth(rules, depth))
    print(f"{rules.title} | Puzzle {name}")
    print(render(board))
    if board.outcome is not None:
        print_analysis(board, limit, stats)
        return
    print(f"{board.turn} to move. {puzzle.goal}")
    analysis = analyze_position(board, limit)
    scores = {choice.move: choice.score for choice in analysis.ranked_moves}
    if stats:
        print_stats(analysis.best)
    if not any(puzzle.accepts(board, score) for score in scores.values()):
        print("No legal move meets this goal.")
        return
    while True:
        entry = read_move(board, ("hint", "tactics"))
        if entry == "q":
            print("Puzzle ended.")
            return
        if entry == "tactics":
            print_tactics(board)
            continue
        if entry == "hint":
            print("One solution line  " + format_line(board, analysis.line[:puzzle.plies]))
            continue
        assert isinstance(entry, int)
        try:
            child = board.play(entry)
        except ValueError as error:
            print(error)
            continue
        if puzzle.accepts(board, scores[entry]):
            print(render(child))
            if puzzle.win_in is not None and child.outcome is None:
                if entry == analysis.best.move:
                    line = analysis.line[:puzzle.plies]
                else:
                    replies = analyze_position(child, puzzle.plies - 1)
                    line = (entry,) + replies.line
                    if stats:
                        print("Continuation search")
                        print_stats(replies.best)
                print("One winning line  " + format_line(board, line))
            print(f"Solved. {board.turn}{entry} meets the goal.")
            return
        reply = next(child.winning_moves(), None)
        if reply is not None:
            print(f"{child.turn} can win with {reply}. Try again.")
        else:
            print("That move misses the goal. Try again.")


def run_game(rules: Rules, human: str | None, depth: int | None, stats: bool, *,
             moves: Iterable[int] = (), analyze: bool = False, two_player: bool = False,
             node_budget: int | None = None) -> None:
    game = GameHistory(rules, moves)
    print(f"Kowloon Tong common room | {rules.title}")
    if two_player:
        print("Two players share this board. X moves first.")
    elif not analyze:
        print("Computer vs computer." if human is None else f"You play {human}. X moves first.")
    if analyze:
        print()
        print(render(game.position))
        if game.position.outcome is not None:
            print_history(game)
        print_analysis(game.position, depth, stats)
        return
    while True:
        position = game.position
        print()
        print(render(position))
        if position.outcome is not None:
            print_history(game)
            print_status(position)
            return
        if two_player or position.turn == human:
            if not human_turn(game, depth, stats, two_player=two_player):
                print("Game ended.")
                return
        else:
            result = choose_move(position, depth, node_budget=node_budget)
            assert result.move is not None
            print(f"Computer {position.turn} plays {result.move}.")
            if stats:
                print_stats(result)
            game.play(result.move)


def positive_integer(value: str, label: str = "value") -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{label} must be a positive integer") from None
    if number < 1:
        raise argparse.ArgumentTypeError(f"{label} must be a positive integer")
    return number


def positive_depth(value: str) -> int:
    return positive_integer(value, "depth")


def parse_moves(value: str) -> Iterator[int]:
    for ply, field in enumerate(value.split(","), 1):
        try:
            move = int(field)
        except ValueError:
            raise InvalidHistory(f"Move {ply} must be a whole number (got {field.strip()!r}).") from None
        yield move


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Play, review, or practice tic-tac-toe and Connect Four.")
    parser.add_argument("game", choices=GAMES, nargs="?", default="tic-tac-toe",
                        help="board to play (default: tic-tac-toe)")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--second", action="store_true", help="play O and let the computer open as X")
    modes.add_argument("--self-play", action="store_true", help="let the computer play both sides")
    modes.add_argument("--two-player", action="store_true", help="share the terminal with a second player")
    modes.add_argument("--analyze", action="store_true",
                       help="show ranked moves and best replies for this position, then exit")
    modes.add_argument("--review", action="store_true", help="compare each recorded move with best play")
    modes.add_argument("--tactics", action="store_true",
                       help="show immediate wins, losing replies and forced wins on the next turn")
    modes.add_argument("--arena", nargs=2, type=positive_depth, metavar=("A", "B"),
                       help="compare search depths A and B from paired openings, swapping seats")
    modes.add_argument("--puzzle", metavar="NAME", help="solve a tactics position (use 'list' to see names)")
    parser.add_argument("--moves", metavar="M1,M2,...", help="start after these moves, with X first")
    parser.add_argument("--depth", type=positive_depth, metavar="N",
                        help="search plies (default 9 for tic-tac-toe, 6 for Connect Four, "
                             "or the puzzle's goal horizon, which is also its minimum)")
    parser.add_argument("--stats", action="store_true", help="show search counts, including cache hits")
    parser.add_argument("--node-budget", type=positive_integer, metavar="N",
                        help="cap node visits per computer move using iterative deepening "
                             "(also applies in the arena)")
    return parser


def select_puzzle(parser: argparse.ArgumentParser, rules: Rules, args: argparse.Namespace) -> None:
    if args.moves is not None:
        parser.error("--puzzle supplies its own opening and cannot be combined with --moves")
    puzzles = PUZZLES[rules]
    if args.puzzle == "list":
        print(f"{rules.title} puzzles")
        for name, puzzle in puzzles.items():
            print(f"{name:<14}  {puzzle.goal}")
    elif args.puzzle in puzzles:
        run_puzzle(rules, args.puzzle, puzzles[args.puzzle], args.depth, args.stats)
    else:
        parser.error(f"unknown puzzle {args.puzzle!r} for {rules.title}. Use --puzzle list.")


def main() -> None:
    parser = argument_parser()
    args = parser.parse_args()
    rules = GAMES[args.game]
    if args.node_budget is not None and (args.tactics or args.review or args.analyze
                                         or args.two_player or args.puzzle is not None):
        parser.error("--node-budget applies to computer moves in a game or arena")
    if args.arena is not None and args.depth is not None:
        parser.error("--arena takes both search depths as arguments")
    if args.tactics and (args.depth is not None or args.stats):
        parser.error("--tactics checks three plies directly. Use --analyze for minimax depth and statistics.")
    try:
        if args.puzzle is not None:
            select_puzzle(parser, rules, args)
            return
        moves = None if args.moves is None else parse_moves(args.moves)
        if args.arena is not None:
            print_arena(rules, *args.arena, moves=moves, node_budget=args.node_budget, stats=args.stats)
        elif args.tactics:
            game = GameHistory(rules, moves or ())
            print(render(game.position))
            print_tactics(game.position)
        elif args.review:
            game = GameHistory(rules, moves or ())
            print(f"{rules.title} | Move review")
            print(render(game.position))
            print_review(game, args.depth, args.stats)
            print_status(game.position)
        else:
            human = "O" if args.second else "X"
            run_game(rules, None if args.self_play else human, args.depth, args.stats,
                     moves=moves or (), analyze=args.analyze, two_player=args.two_player,
                     node_budget=args.node_budget)
    except InvalidHistory as error:
        parser.error(str(error))
    except KeyboardInterrupt:
        print("\nGame ended.")


if __name__ == "__main__":
    main()
