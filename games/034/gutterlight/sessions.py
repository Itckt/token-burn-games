"""Paced play and replay controls. The rules engine owns all changes of state."""

from bisect import bisect_left, bisect_right
from collections.abc import Callable
from functools import lru_cache
from textwrap import fill
import time

from .battle import Battle, Lane, Move, Side, TICKS_PER_SECOND
from .cards import CARDS
from .display import board
from .draft import Offers, split_pair
from .pilot import Pilot
from .practice import Study, practice_start, study_orders, study_table
from .recording import Replay
from .report import scouting_report
from .terminal import Terminal


BEAT = 1 / TICKS_PER_SECOND
SPEEDS = (0.5, 1, 2, 4)
QUIT_KEYS = ("q", "\x03", "\x04")
REPLAY_KEYS = "Space toggle  B/N step  [/] marks  H/E ends  -/+ speed  S stats  D study  Q quit"
STUDY_KEYS = "Tab side  D board  B/N step  [/] marks  H/E ends  Space play  S stats  Q quit"


def pick_draft(seed: int, offers: Offers, terminal: Terminal) -> str | None:
    picks = ""
    decks: tuple[list[str], list[str]] = ([], [])
    for number, pair in enumerate(offers, 1):
        lines = [f"GUTTERLIGHT RELAY  /  PAIR DRAFT     Seed {seed}",
                 f"Pair {number}/{len(offers)}    Amber keeps your pick. Indigo takes the other card.", ""]
        for side in Side:
            names = ", ".join(decks[side]) or "(empty)"
            lines.append(fill(f"{side.label} deck   {names}", width=80, subsequent_indent="    "))
        lines.append("")
        for index, key in enumerate(pair, 1):
            card = CARDS[key]
            lines.extend([f"[{index}] {card.name} ({card.cost} energy)", f"    {card.description}"])
        terminal.draw("\n".join([*lines, "", "1/2 choose   Q leave draft"]))
        while True:
            key = terminal.read_key(None)
            if key in QUIT_KEYS:
                return None
            if key in ("1", "2"):
                picks += key
                for deck, card_key in zip(decks, split_pair(pair, key)):
                    deck.append(CARDS[card_key].name)
                break
    return picks


def play_live(battle: Battle, terminal: Terminal,
              now: Callable[[], float] = time.monotonic, *, opponent: Pilot | None = None) -> None:
    if opponent is None:
        opponent = Pilot(battle.setup.seed, Side.INDIGO)
    selected = None
    pending = None
    notice = "Choose a slot, then send the card to Roof or Canal."

    def draw() -> None:
        screen = board(battle.frame(), "LIVE", selected=selected)
        terminal.draw(f"{screen}\n\n{notice}\n1-4 select   R Roof   C Canal   X cancel   Q leave")

    def handle_key(key: str | None) -> bool:
        nonlocal selected, pending, notice
        if key in ("1", "2", "3", "4"):
            selected = int(key) - 1
            pending = None
            card = CARDS[battle.players[Side.AMBER].hand[selected]]
            notice = fill(f"{card.name}  |  {card.description}", width=80)
        elif key in ("r", "c"):
            if selected is None:
                notice = "Select a hand slot with 1-4 first."
            else:
                lane = Lane.ROOF if key == "r" else Lane.CANAL
                move = Move(selected, lane)
                error = battle.problem(Side.AMBER, move)
                pending = None if error else move
                name = CARDS[battle.players[Side.AMBER].hand[selected]].name
                notice = error or f"Queued {name} for {lane.label} on the next beat."
        elif key == "x":
            selected, pending = None, None
            notice = "Order cleared."
        else:
            return False
        return True

    draw()
    next_beat = now() + BEAT
    while battle.outcome is None:
        try:
            key = terminal.read_key(max(0.0, next_beat - now()))
        except KeyboardInterrupt:
            return
        # A slow redraw can span several beats. Settle elapsed time before
        # accepting a new order and poll input even when already overdue.
        cutoff = now()
        advanced = False
        while next_beat <= cutoff and battle.outcome is None:
            battle.step(pending, opponent.choose(battle))
            if pending is not None:
                selected, pending = None, None
                notice = "Choose your next card."
            next_beat += BEAT
            advanced = True
        if battle.outcome is None:
            if key in QUIT_KEYS:
                return
            handled = handle_key(key)
        else:
            handled = False
        if advanced or handled:
            draw()


def replay_board(replay: Replay, tick: int, mode: str = "REPLAY") -> str:
    frame = replay.frame_at(tick)
    screen = board(frame, mode, both_hands=True)
    if tick == replay.end and frame.outcome is None:
        screen += "\nEND OF RECORDING  Match left in progress."
    return screen


def _seek_tick(key: str | None, tick: int, end: int, marks: tuple[int, ...]) -> int | None:
    if key in ("b", "left"):
        return max(0, tick - 1)
    if key in ("n", "right"):
        return min(end, tick + 1)
    if key in ("h", "home"):
        return 0
    if key in ("e", "end"):
        return end
    if key == "[":
        return marks[max(0, bisect_left(marks, tick) - 1)]
    if key == "]":
        return marks[min(len(marks) - 1, bisect_right(marks, tick))]
    return None


def watch(replay: Replay, terminal: Terminal,
          now: Callable[[], float] = time.monotonic) -> int:
    tick = 0
    speed = SPEEDS.index(1)
    playing = tick < replay.end
    marks = {event.tick: event.text for event in replay.highlights()}
    mark_ticks = tuple(marks)
    show_mark = False
    view = "board"
    study_side = Side.AMBER

    @lru_cache(maxsize=8)
    def study_at(beat: int, side: Side) -> Study:
        return study_orders(replay, beat, side)

    def draw() -> None:
        status = "playing" if playing else "paused"
        mode = f"REPLAY {tick}/{replay.end}  {SPEEDS[speed]:g}x {status}"
        if view == "study":
            title = f"{mode}  /  DECISION STUDY"
            outcome = replay.frames[tick].outcome
            if outcome is None:
                screen = study_table(study_at(tick, study_side), title)
            else:
                screen = (f"GUTTERLIGHT RELAY  /  {title}\nRESULT  {outcome.text}\n"
                          "Step back to a beat before the result to study another order.")
        elif view == "report":
            screen = scouting_report(replay, tick, mode)
        else:
            screen = replay_board(replay, tick, mode)
        if show_mark:
            # Use the blank spacer rows for longer highlights on a 24-line console.
            mark = fill(f"HIGHLIGHT  {marks[tick]}", width=80, subsequent_indent="           ")
            screen = screen.replace("\n\n", "\n") + "\n" + mark
        terminal.draw(f"{screen}\n{STUDY_KEYS if view == 'study' else REPLAY_KEYS}")

    draw()
    deadline = now() + BEAT / SPEEDS[speed]
    while True:
        wait = max(0.0, deadline - now()) if playing else None
        key = terminal.read_key(wait)
        cutoff = now()
        advanced = False
        while playing and deadline <= cutoff:
            tick += 1
            playing = tick < replay.end
            deadline += BEAT / SPEEDS[speed]
            advanced = True
            show_mark = False
        if key in QUIT_KEYS:
            return tick
        if key == "s":
            view = "board" if view == "report" else "report"
            playing = False
        elif key == "d":
            view = "board" if view == "study" else "study"
            show_mark = False
            playing = False
        elif key == "\t" and view == "study":
            study_side = study_side.other
        elif key == " ":
            if view == "study":
                view = "board"
            if tick == replay.end:
                tick = 0
            playing = not playing and tick < replay.end
            deadline = cutoff + BEAT / SPEEDS[speed]
            show_mark = False
        elif (destination := _seek_tick(key, tick, replay.end, mark_ticks)) is not None:
            tick = destination
            playing = False
            show_mark = key in ("[", "]")
        elif key in ("+", "=", "-"):
            change = -1 if key == "-" else 1
            old_speed = SPEEDS[speed]
            speed = max(0, min(len(SPEEDS) - 1, speed + change))
            if playing:
                deadline = cutoff + (deadline - cutoff) * old_speed / SPEEDS[speed]
        elif not advanced:
            continue
        draw()
