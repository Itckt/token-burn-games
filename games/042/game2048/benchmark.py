"""Compare expectimax searches on repeatable, equally long trials."""

from dataclasses import dataclass
from random import Random
from statistics import mean

from .ai import choose_move
from .engine import TARGET, Game, has_moves


@dataclass(frozen=True)
class Trial:
    score: int
    moves: int
    largest: int
    game_over: bool


def run_trial(seed: int, depth: int, move_limit: int) -> Trial:
    rng = Random(seed)
    game = Game.new(rng)
    while game.moves < move_limit:
        direction = choose_move(game.board, depth)
        if direction is None:
            break
        game.move(direction, rng)
    return Trial(game.score, game.moves, game.largest, not has_moves(game.board))


def print_benchmark(seed: int, games: int, depths: list[int], move_limit: int) -> None:
    print(f"Expectimax benchmark | seeds {seed} through {seed + games - 1}"
          f" | up to {move_limit} slides per game")
    print("Seed  Depth    Score  Moves  Best tile  Finish")
    by_depth: dict[int, list[Trial]] = {depth: [] for depth in depths}
    for trial_seed in range(seed, seed + games):
        for depth in depths:
            trial = run_trial(trial_seed, depth, move_limit)
            by_depth[depth].append(trial)
            finish = "game over" if trial.game_over else "move cap"
            print(f"{trial_seed:>4}  {depth:>5}  {trial.score:>7}  {trial.moves:>5}"
                  f"  {trial.largest:>9}  {finish}", flush=True)
    print("\nDepth  Games  Mean score  Mean moves  Best tile  Reached 2048")
    for depth, runs in by_depth.items():
        score = mean(run.score for run in runs)
        moves = mean(run.moves for run in runs)
        largest = max(run.largest for run in runs)
        wins = sum(run.largest >= TARGET for run in runs)
        print(f"{depth:>5}  {len(runs):>5}  {score:>10.1f}  {moves:>10.1f}"
              f"  {largest:>9}  {wins}/{len(runs)}")
