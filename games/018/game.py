"""Play a JSON adventure in an interactive terminal or with piped commands."""

from __future__ import annotations

import argparse
import sys
import textwrap
from collections.abc import Iterable
from pathlib import Path
from typing import TextIO

from engine import BatchRun, Entry, Game, RuleError
from saves import SaveError, load_game, save_game
from story import Action, Person, Room, Story, StoryError, load_story


DEFAULT_STORY = Path(__file__).resolve().parent / "stories" / "eleventh_morning.json"
HELP = """Commands
  look                   Inspect the room, people, work, costs and exits.
  map                    List rooms, exits, gates, people, jobs and batches.
  route <room>           Find the shortest open path or see what locks the way.
  go <exit>              Travel through a listed exit.
  do <id>                Do local work. Its menu number also works on its own.
  talk                   See who's here. Use talk <person> to see their topics.
  talk <person> <topic>  Choose a topic. Conversations take no time.
  inventory / bag        See what you're carrying.
  calendar               Check bookings, locations and the last day to start.
  queue / queue <id>     Inspect the terminals or submit a local overnight batch.
  plan <move> / <move>   Preview an itinerary from here. Your game stays put.
  wait                   Spend one day without using any of the allocation.
  status                 Check the time, account and things you have made.
  journal                Read back your work, conversations and exchanges.
  save / load            Write or restore this adventure's single save slot.
  quit                   Leave the session. Use save first to keep your place.
  help / ?               Read these commands.

Travel, inspection and saving take no time. The last day is playable."""


def paragraph(text: str, *, indent: str = "", continuation: str | None = None) -> str:
    return textwrap.fill(
        text, width=78, initial_indent=indent, subsequent_indent=indent if continuation is None else continuation,
        break_long_words=False, break_on_hyphens=False,
    )


def duration(count: int, unit: str = "day") -> str:
    return f"{count} {unit}" if count == 1 else f"{count} {unit}s"


def price(game: Game, amount: int) -> str:
    return f"{amount:,} {game.story.resource}" if amount else "free"


def day_span(first: int, last: int) -> str:
    return f"Day {first}" if first == last else f"Days {first}-{last}"


def item_list(game: Game, items: Iterable[tuple[str, int]]) -> str:
    return ", ".join(f"{count:,} x {game.story.items[key]}" for key, count in items)


def inventory_text(game: Game) -> str:
    held = game.inventory
    if not held:
        return "Your bag is empty."
    lines = [f"  {held[key]:,} x {label}" for key, label in game.story.items.items() if key in held]
    return "\n".join(["In your bag", *lines])


def people_text(game: Game) -> str:
    if not game.room.people:
        return "There's no one to talk to here."
    people = (f"{person.name} (talk {person.id})" for person in game.room.people.values())
    return "People here   " + "  |  ".join(people)


def choice_lines(game: Game, action: Action, *, number: int | None = None,
                 speaker: Person | None = None, show_ready: bool = False) -> list[str]:
    prefix = f"{number}. " if number is not None else ""
    title = f"{prefix}[{action.id}] {action.name}"
    if speaker is None:
        time = duration(action.nights, "night") if action.nights else duration(action.days)
        title += f"  ({time}, {price(game, action.cost)})"
    lines = [paragraph(title, indent="  ", continuation="       ")]
    notes = []
    if action.window:
        window = action.window
        notes.append(f"{day_span(window.first, window.last)} | Start by day {window.latest_start(action.days)}")
    if action.consumes:
        notes.append(f"Uses {item_list(game, action.consumes)}")
    if action.produces:
        verb = "Delivers" if action.nights else "Adds"
        notes.append(f"{verb} {item_list(game, action.produces)}")
    if action.nights and action.gives:
        notes.append("On delivery | " + ", ".join(game.story.flags[key] for key in action.gives))
    reason = game.block_reason(action, speaker)
    if reason:
        notes.append(reason)
    elif show_ready:
        notes.append("Ready to start.")
    lines.extend(paragraph(note, indent="       ") for note in notes)
    return lines


def conversation_text(game: Game, person_id: str) -> str:
    speaker = game.person(person_id)
    lines = [speaker.name, paragraph(speaker.greeting), "", f"Topics | talk {speaker.id} <topic>"]
    for topic in speaker.topics.values():
        lines.extend(choice_lines(game, topic, speaker=speaker))
    return "\n".join(lines)


def route_text(game: Game, destination: str) -> str:
    steps = game.route(destination)
    room = game.story.rooms[destination]
    if steps is None:
        directions = f"No route from {game.room.name}."
        here = game.room
        for step in game.route(destination, include_locked=True) or ():
            needs = game.exit_needs(here, step)
            if needs:
                directions = f"Locked at {here.name} [{here.id}]. The exit to {step} needs {', '.join(needs)}."
                break
            here = game.story.rooms[step]
    elif steps:
        directions = " -> ".join(f"go {step}" for step in steps)
    else:
        directions = "You are here."
    return f"{room.name} [{room.id}] | {directions}"


def running_text(run: BatchRun) -> str:
    return f"Running | {run.job.name} | Due at the end of day {run.due_day}."


def queue_text(game: Game) -> str:
    terminals = [room for room in game.story.rooms.values() if room.batches]
    if not terminals:
        return "There are no batch terminals in this adventure."
    activity = running_text(game.pending) if game.pending else "The queue is idle."
    lines = ["Compute queue | one batch at a time", clock_line(game), activity]
    for room in terminals:
        lines.extend(["", route_text(game, room.id)])
        for job in room.batches.values():
            lines.extend(choice_lines(game, job, show_ready=room.id == game.room.id))
    return "\n".join(lines)


def calendar_text(game: Game) -> str:
    bookings = [(action.window.first, room, action) for room in game.story.rooms.values()
                for action in room.actions.values() if action.window]
    if not bookings:
        return "There are no scheduled bookings in this adventure."
    lines = ["Work calendar", clock_line(game)]
    last_room = None
    for _, room, action in sorted(bookings, key=lambda booking: booking[0]):
        if room.id != last_room:
            lines.extend(["", route_text(game, room.id)])
            last_room = room.id
        lines.extend(choice_lines(game, action, show_ready=room.id == game.room.id))
    return "\n".join(lines)


def clock_line(game: Game) -> str:
    if game.finished:
        return f"After day {game.story.days} | Allocation closed"
    return f"Day {game.day} of {game.story.days} | {game.balance:,} {game.story.resource} available"


def exit_label(game: Game, room: Room, destination: str, *, with_name: bool = False) -> str:
    label = f"{destination} ({game.story.rooms[destination].name})" if with_name else destination
    needs = game.exit_needs(room, destination)
    return f"{label} [needs {', '.join(needs)}]" if needs else label


def look(game: Game) -> str:
    room = game.room
    lines = [clock_line(game), f"{room.name} [{room.id}]", paragraph(room.description)]
    flags = game.flags
    lines.extend(paragraph(detail) for flag, detail in room.details.items() if flag in flags)
    if room.people:
        lines.extend(["", people_text(game)])
    if room.actions:
        lines.extend(["", "Work here"])
        for number, action in enumerate(room.actions.values(), start=1):
            lines.extend(choice_lines(game, action, number=number))
    if room.batches:
        lines.extend(["", "Batch terminal | queue <id>"])
        for job in room.batches.values():
            lines.extend(choice_lines(game, job))
    exits = "  |  ".join(exit_label(game, room, key, with_name=True) for key in room.exits)
    lines.append(f"\nExits   {exits or 'none'}")
    return "\n".join(lines)


def map_text(game: Game) -> str:
    lines = ["Rooms and exits"]
    for room in game.story.rooms.values():
        marker = " (you are here)" if room.id == game.room.id else ""
        exits = ", ".join(exit_label(game, room, key) for key in room.exits)
        lines.append(f"  [{room.id}] {room.name}{marker}  ->  {exits or 'no exits'}")
        if room.actions:
            lines.append(f"      Work   {', '.join(room.actions)}")
        if room.people:
            lines.append(f"      People   {', '.join(room.people)}")
        if room.batches:
            lines.append(f"      Batches   {', '.join(room.batches)}")
    return "\n".join(lines)


def ledger(game: Game) -> str:
    rows = [
        ("Allocated", game.story.budget), ("Spent", game.spent),
        ("Available", game.balance), ("Expired", game.expired),
    ]
    return "\n".join(f"  {label:<10} {amount:>14,} {game.story.resource}" for label, amount in rows)


def status(game: Game) -> str:
    flags = game.flags
    found = [name for key, name in game.story.flags.items() if key in flags]
    progress = "\n".join(f"  {name}" for name in found) or "  Your project ledger is empty."
    batch = "\n" + running_text(game.pending) if game.pending else ""
    return (
        f"{clock_line(game)}\n{duration(game.days_left)} left | {game.room.name}{batch}\n\n"
        f"{ledger(game)}\n\nProject ledger\n{progress}"
    )


def entry_heading(game: Game, entry: Entry) -> str:
    return f"{day_span(entry.first_day, entry.last_day)} | {entry.name} | {price(game, entry.cost)}"


def delivery_heading(run: BatchRun) -> str:
    return f"End of day {run.due_day} | Batch delivered | {run.job.name}"


def entry_text(game: Game, entry: Entry, *, notices: bool = False) -> str:
    lines = [entry_heading(game, entry), paragraph(entry.text)]
    if entry.consumed:
        lines.append(paragraph(f"Used {item_list(game, entry.consumed)}"))
    if entry.produced:
        lines.append(paragraph(f"Received {item_list(game, entry.produced)}"))
    updates = []
    if notices:
        for day, notice in game.story.notices.items():
            if entry.first_day < day <= min(game.day, game.story.days):
                updates.append((day, paragraph(f"Day {day} notice | {notice}")))
    if run := entry.delivery:
        receipt = [delivery_heading(run), paragraph(run.job.result)]
        if run.job.produces:
            receipt.append(paragraph(f"Received {item_list(game, run.job.produces)}"))
        if run.job.gives:
            receipt.append(paragraph("Earned " + ", ".join(game.story.flags[key] for key in run.job.gives)))
        updates.append((run.due_day, "\n".join(receipt)))
    # A notice is read at the start of its day, before that night's delivery.
    sections = ["\n".join(lines)]
    for _, text in sorted(updates, key=lambda update: update[0]):
        sections.append(text)
    return "\n\n".join(sections)


def journal_text(game: Game) -> str:
    if not game.journal:
        return "Your journal is empty."
    return "Journal\n\n" + "\n\n".join(entry_text(game, entry) for entry in game.journal)


def after_turn(game: Game, entry: Entry) -> str:
    lines = [entry_text(game, entry, notices=True)]
    if not game.finished:
        lines.append(f"{clock_line(game)} | {game.room.name}")
    return "\n\n".join(lines)


def epilogue(game: Game) -> str:
    ending = game.ending
    assert ending is not None
    return (
        f"The allocation closed at midnight on day {game.story.days}.\n"
        f"Ending | {ending.title}\n\n{paragraph(ending.text)}\n\n{ledger(game)}"
    )


def local_id(game: Game, choice: str) -> str:
    if not choice.isdecimal():
        return choice
    try:
        number = int(choice)
    except ValueError:  # Python's integer digit limit also applies to pasted input.
        raise RuleError("Choose a work number shown by look.") from None
    actions = list(game.room.actions)
    if 1 <= number <= len(actions):
        return actions[number - 1]
    raise RuleError("Choose a work number shown by look.")


def named_move(game: Game, words: list[str]) -> list[str]:
    if len(words) == 1 and words[0].isdecimal():
        words = ["do", words[0]]
    if len(words) == 2 and words[0] == "do":
        return ["do", local_id(game, words[1])]
    return words


PLAN_USAGE = "Use plan <move> / <move> with go, do, talk <person> <topic>, queue <id>, wait or a work number."


def plan_text(game: Game, words: list[str]) -> str:
    steps = [part.strip() for part in " ".join(words).split("/")]
    if not all(steps):
        return PLAN_USAGE
    trial = game.fork()
    lines = [f"Plan preview | {clock_line(game)} | {game.room.name}"]
    for index, step in enumerate(steps, 1):
        try:
            result = trial.apply(named_move(trial, step.split()))
        except RuleError as error:
            lines.append(f"  {index}. {step} | Blocked | {error}")
            break
        summary = entry_heading(trial, result) if isinstance(result, Entry) else f"Day {trial.day} | {result.name}"
        lines.append(f"  {index}. {step} | {summary}")
        if isinstance(result, Entry) and result.delivery:
            lines.append(f"       {delivery_heading(result.delivery)}")
        if trial.finished:
            if index < len(steps):
                lines.append(f"  The adventure ends at step {index}.")
            break
    lines.extend(["", f"Projected | {clock_line(trial)} | {trial.room.name}"])
    if trial.pending:
        lines.append(running_text(trial.pending))
    if trial.story.items:
        lines.append("Projected bag | " + (item_list(trial, trial.inventory.items()) or "empty"))
    gained = trial.flags - game.flags
    if gained:
        names = (name for key, name in trial.story.flags.items() if key in gained)
        lines.append("New milestones | " + ", ".join(names))
    if ending := trial.ending:
        lines.extend([f"Projected ending | {ending.title}", ledger(trial)])
    return "\n".join(lines)


def command(game: Game, words: list[str]) -> str:
    words = named_move(game, words)
    match words:
        case ["help" | "?"]:
            return HELP
        case ["look"]:
            return look(game)
        case ["map"]:
            return map_text(game)
        case ["route", destination]:
            return route_text(game, destination)
        case ["route", *_]:
            return "Use route <room> with a room ID shown by map."
        case ["status"]:
            return status(game)
        case ["journal"]:
            return journal_text(game)
        case ["inventory" | "bag"]:
            return inventory_text(game)
        case ["calendar"]:
            return calendar_text(game)
        case ["queue"]:
            return queue_text(game)
        case ["plan", *steps]:
            return plan_text(game, steps)
        case ["go", _] | ["do", _] | ["talk", _, _] | ["queue", _] | ["wait"]:
            result = game.apply(words)
            return after_turn(game, result) if isinstance(result, Entry) else look(game)
        case ["talk"]:
            return people_text(game)
        case ["talk", person]:
            return conversation_text(game, person)
        case ["talk", *_]:
            return "Use talk <person> to browse or talk <person> <topic> to speak."
        case ["queue", *_]:
            return "Use queue to browse or queue <id> at a batch terminal."
        case ["go", *_]:
            return "Use go <exit> with an exit ID shown by look."
        case ["do", *_]:
            return "Use do <id> with a work ID shown by look, or enter its number."
        case _:
            return "Unrecognized command. Type help for the command list."


def play(story: Story, slot: Path, source: TextIO, output: TextIO) -> None:
    game = Game(story)
    opening = [story.title, paragraph(story.intro)]
    if 1 in story.notices:
        opening.append(paragraph(f"Day 1 notice | {story.notices[1]}"))
    opening.extend([look(game), 'Enter a work number, "go <exit>" to travel, or "help" for commands.'])
    print("\n\n".join(opening), file=output)
    while not game.finished:
        if source.isatty():
            print("\n> ", end="", flush=True, file=output)
        line = source.readline()
        if not line:
            return
        words = line.casefold().split()
        try:
            match words:
                case []:
                    continue
                case ["quit" | "q"]:
                    print("\nSession closed.", file=output)
                    return
                case ["save"]:
                    save_game(game, slot)
                    reply = f"Saved to {slot.name}."
                case ["load"]:
                    game = load_game(story, slot)
                    reply = f"Loaded {slot.name}."
                    if not game.finished:
                        reply += "\n\n" + look(game)
                case _:
                    reply = command(game, words)
        except (RuleError, SaveError) as error:
            reply = str(error)
        print(f"\n{reply}", file=output)
    print(f"\n{epilogue(game)}", file=output)


def main() -> int:
    parser = argparse.ArgumentParser(description="Play a time-limited text adventure.")
    parser.add_argument("--story", type=Path, default=DEFAULT_STORY, help="path to an adventure JSON file")
    args = parser.parse_args()
    try:
        story = load_story(args.story)
    except StoryError as error:
        print(error, file=sys.stderr)
        return 2
    slot = Path.cwd() / f"{story.id}.save.json"
    if slot.resolve() == args.story.resolve():
        slot = slot.with_name(f"{story.id}.slot.save.json")
    try:
        play(story, slot, sys.stdin, sys.stdout)
    except KeyboardInterrupt:
        print("\nSession closed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
