"""Restore a decision point and play out independent alternatives."""

from copy import deepcopy
from dataclasses import dataclass

from .battle import Battle, Frame, Mode, Move, Outcome, Side, objective_margin
from .cards import CARDS
from .pilot import Pilot, finish
from .recording import Replay


def practice_start(replay: Replay, tick: int) -> tuple[Battle, Pilot, Pilot]:
    """Restore the board and both pilots' decision histories at a completed beat."""
    if replay.frame_at(tick).outcome is not None:
        raise ValueError(f"Beat {tick} is the result. Choose an earlier beat for practice.")
    battle = Battle(replay.setup)
    amber, indigo = (Pilot(replay.setup.seed, side) for side in Side)
    for orders in replay.orders[:tick]:
        # The historical board determines which random decisions each pilot
        # consumed. The actual orders may have come from a human.
        amber.choose(battle)
        indigo.choose(battle)
        battle.step(*orders)
    return battle, amber, indigo


def pick_code(move: Move | None) -> str:
    return "PASS" if move is None else f"{move.slot + 1}{move.lane.label[0]}"


def _order_name(frame: Frame, side: Side, move: Move | None) -> str:
    if move is None:
        return "Hold energy"
    return f"{CARDS[frame.hands[side][move.slot]].name} / {move.lane.label}"


@dataclass(frozen=True, slots=True)
class Trial:
    move: Move | None
    outcome: Outcome
    end: int
    objective_margin: int
    hull_margin: int

    def result_for(self, side: Side) -> str:
        if self.outcome.winner is None:
            return "DRAW"
        return "WIN" if self.outcome.winner is side else "LOSS"


@dataclass(frozen=True, slots=True)
class Study:
    position: Frame
    side: Side
    opponent_move: Move | None
    recorded_pick: str | None
    trials: tuple[Trial, ...]
    selected_game: Battle | None


def study_orders(replay: Replay, tick: int, side: Side = Side.AMBER, *,
                 keep_pick: str | None = None) -> Study:
    if not isinstance(side, Side):
        raise ValueError("Choose Amber or Indigo for the study.")
    battle, amber, indigo = practice_start(replay, tick)
    choices = [None, *battle.legal_moves(side)]
    if keep_pick is not None:
        if isinstance(keep_pick, str):
            keep_pick = keep_pick.strip().upper()
        codes = [pick_code(move) for move in choices]
        if keep_pick not in codes:
            raise ValueError(f"Choose a legal pick for {side.label} on beat {tick + 1} "
                             f"({', '.join(codes)}).")

    # Both pilots read the same unmodified board. Even the overridden pilot
    # consumes its normal decision before the copies resume on the next beat.
    replies = (amber.choose(battle), indigo.choose(battle))
    trials = []
    selected = None
    for move in choices:
        branch, left, right = deepcopy((battle, amber, indigo))
        orders = list(replies)
        orders[side] = move
        branch.step(*orders)
        finish(branch, left, right)
        frame = branch.frame()
        assert frame.outcome is not None
        objective = objective_margin(frame.mode, frame.charge, frame.carts) * side.direction
        hull = sum(frame.hull[side]) - sum(frame.hull[side.other])
        trials.append(Trial(move, frame.outcome, frame.tick, objective, hull))
        if keep_pick == pick_code(move):
            selected = branch

    def rank(trial: Trial) -> tuple[int, int, int]:
        winner = trial.outcome.winner
        result = 0 if winner is None else (1 if winner is side else -1)
        return result, trial.objective_margin, trial.hull_margin

    trials.sort(key=rank, reverse=True)
    recorded = pick_code(replay.orders[tick][side]) if tick < replay.end else None
    return Study(battle.frame(), side, replies[side.other], recorded, tuple(trials), selected)


def study_table(study: Study, title: str = "DECISION STUDY") -> str:
    frame, side = study.position, study.side
    label = {Mode.CLASSIC: "", Mode.BEACON: "CHARGE", Mode.CONVOY: "CART"}[frame.mode]
    goal_title = f" {label:>6}" if label else ""
    lines = [f"GUTTERLIGHT RELAY  /  {title}",
             f"{side.label} to order on beat {frame.tick + 1}    {frame.mode.value.title()}    Seed {frame.seed}",
             (f"Recorded {side.label} pick    {study.recorded_pick}" if study.recorded_pick is not None
              else f"The recording ends at beat {frame.tick}, before this order."),
             f"{side.other.label} pilot order    {_order_name(frame, side.other, study.opponent_move)}",
             f"Both pilots play from the following beat. Positive margins favour {side.label}.",
             "", f"PICK  DISPATCH                   RESULT  END{goal_title}   HULL  FINISH"]
    for trial in study.trials:
        goal = f" {trial.objective_margin:>+6}" if label else ""
        name = _order_name(frame, side, trial.move)
        lines.append(f"{pick_code(trial.move):<5} {name:<26} {trial.result_for(side):<6} "
                     f"{trial.end:>3}{goal} {trial.hull_margin:>+6}  {trial.outcome.reason}")
    return "\n".join(lines)
