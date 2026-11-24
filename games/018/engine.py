"""Deterministic, turn-based adventure rules, independent of the terminal."""

from __future__ import annotations

from dataclasses import dataclass, replace

from story import Action, Ending, ItemCounts, Person, Room, Story, paths_from


class RuleError(ValueError):
    """An attempted move or action leaves the game as it was."""


@dataclass(frozen=True)
class BatchRun:
    job: Action
    due_day: int


@dataclass(frozen=True)
class Entry:
    first_day: int
    last_day: int
    name: str
    text: str
    cost: int
    consumed: ItemCounts = ()
    produced: ItemCounts = ()
    delivery: BatchRun | None = None


class Game:
    def __init__(self, story: Story):
        self.story = story
        self.room = story.rooms[story.start]
        self.elapsed = 0
        self.spent = 0
        self.pending: BatchRun | None = None
        self._flags: set[str] = set()
        self._inventory = story.starting_items.copy()
        self._completed: set[tuple[str, ...]] = set()
        self._events: list[tuple[str, ...]] = []
        self._journal: list[Entry] = []

    @property
    def day(self) -> int:
        """The next day on which work would begin."""
        return self.elapsed + 1

    @property
    def days_left(self) -> int:
        return self.story.days - self.elapsed

    @property
    def finished(self) -> bool:
        return self.days_left == 0

    @property
    def balance(self) -> int:
        return 0 if self.finished else self.story.budget - self.spent

    @property
    def expired(self) -> int:
        return self.story.budget - self.spent if self.finished else 0

    @property
    def flags(self) -> frozenset[str]:
        return frozenset(self._flags)

    @property
    def inventory(self) -> dict[str, int]:
        return self._inventory.copy()

    @property
    def events(self) -> tuple[tuple[str, ...], ...]:
        return tuple(self._events)

    @property
    def journal(self) -> tuple[Entry, ...]:
        return tuple(self._journal)

    @property
    def ending(self) -> Ending | None:
        if self.finished:
            return next(end for end in self.story.endings if self._flags.issuperset(end.requires))
        return None

    def move(self, destination: str) -> Room:
        if self.finished:
            raise RuleError("The deadline has passed.")
        if destination not in self.room.exits:
            if destination == self.room.id:
                raise RuleError("You are already here.")
            raise RuleError(f"There is no exit {destination!r} here. Use map to find a path.")
        needs = self.exit_needs(self.room, destination)
        if needs:
            raise RuleError(f"The exit to {self.story.rooms[destination].name} needs {', '.join(needs)}.")
        self.room = self.story.rooms[destination]
        self._events.append(("go", destination))
        return self.room

    def _missing_flags(self, required: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(self.story.flags[flag] for flag in required if flag not in self._flags)

    def exit_needs(self, room: Room, destination: str) -> tuple[str, ...]:
        return self._missing_flags(room.exit_requires.get(destination, ()))

    def route(self, destination: str, *, include_locked: bool = False) -> tuple[str, ...] | None:
        """Return the exits to follow, or None for a room unreachable from here."""
        if destination not in self.story.rooms:
            raise RuleError(f"Unknown room {destination!r}. Use map to see room IDs.")
        allowed = None if include_locked else lambda room, dest: not self.exit_needs(room, dest)
        previous = paths_from(self.story.rooms, self.room.id, allowed)
        if destination not in previous:
            return None
        steps = []
        here = destination
        while (parent := previous[here]) is not None:
            steps.append(here)
            here = parent
        return tuple(reversed(steps))

    def person(self, person_id: str) -> Person:
        person = self.room.people.get(person_id)
        if person is None:
            raise RuleError(f"No one called {person_id!r} is here. Use talk to see who's here.")
        return person

    @staticmethod
    def _choice_event(action: Action, speaker: Person | None) -> tuple[str, ...]:
        if speaker:
            return ("talk", speaker.id, action.id)
        return ("queue" if action.nights else "do", action.id)

    def block_reason(self, action: Action, speaker: Person | None = None) -> str | None:
        """Explain the first unmet condition, even when inspecting a booking remotely."""
        if self.finished:
            return "The deadline has passed."
        if self._choice_event(action, speaker) in self._completed:
            if action.nights:
                return "Already submitted. See journal."
            return "Already discussed. See journal." if speaker else "Already completed."
        for flag in action.unless:
            if flag in self._flags:
                return f"Closed because you have {self.story.flags[flag]}."
        if action.window:
            if self.day < action.window.first:
                return f"Opens on day {action.window.first}."
            latest = action.window.latest_start(action.days)
            if self.day > latest:
                return f"Last start was day {latest}. The booking ends on day {action.window.last}."
        if action.nights and self.pending:
            return f"The queue is busy until the end of day {self.pending.due_day}."
        missing = self._missing_flags(action.requires)
        if missing:
            return f"Needs {', '.join(missing)}."
        for item, count in action.consumes:
            held = self._inventory.get(item, 0)
            if held < count:
                return f"Needs {count:,} x {self.story.items[item]} (carrying {held:,})."
        if action.days > self.days_left:
            unit = "day" if self.days_left == 1 else "days"
            return f"Only {self.days_left} {unit} left. This takes {action.days}."
        if action.nights > self.days_left:
            due = self.elapsed + action.nights
            return f"This batch would finish on day {due}, after the day {self.story.days} deadline."
        if action.cost > self.balance:
            shortfall = action.cost - self.balance
            return f"You need {shortfall:,} more {self.story.resource}."
        return None

    def work(self, action_id: str) -> Entry:
        action = self.room.actions.get(action_id)
        if action is None:
            raise RuleError(f"There is no work called {action_id!r} here. Use look for local work.")
        return self._take_choice(action)

    def talk(self, person_id: str, topic_id: str) -> Entry:
        speaker = self.person(person_id)
        topic = speaker.topics.get(topic_id)
        if topic is None:
            raise RuleError(f"Use talk {person_id} to see {speaker.name}'s topics.")
        return self._take_choice(topic, speaker)

    def _start_choice(self, action: Action, speaker: Person | None = None) -> tuple[str, ...]:
        reason = self.block_reason(action, speaker)
        if reason:
            raise RuleError(reason)
        for item, count in action.consumes:
            self._inventory[item] -= count
            if self._inventory[item] == 0:
                del self._inventory[item]
        event = self._choice_event(action, speaker)
        self._completed.add(event)
        return event

    def _award(self, action: Action) -> None:
        for item, count in action.produces:
            self._inventory[item] = self._inventory.get(item, 0) + count
        self._flags.update(action.gives)

    def _take_choice(self, action: Action, speaker: Person | None = None) -> Entry:
        event = self._start_choice(action, speaker)
        self._award(action)
        name = f"{speaker.name} | {action.name}" if speaker else action.name
        last_day = self.day if speaker else self.elapsed + action.days
        entry = Entry(self.day, last_day, name, action.result, action.cost, action.consumes, action.produces)
        return self._record(event, action.days, entry)

    def queue(self, batch_id: str) -> Entry:
        job = self.room.batches.get(batch_id)
        if job is None:
            raise RuleError(f"There is no batch called {batch_id!r} here. Use queue to find a terminal.")
        event = self._start_choice(job)
        self.pending = BatchRun(job, self.elapsed + job.nights)
        entry = Entry(self.day, self.day, f"Queued | {job.name}",
                      f"Due at the end of day {self.pending.due_day}. You can use today for other work.",
                      job.cost, job.consumes)
        return self._record(event, 0, entry)

    def wait(self) -> Entry:
        if self.finished:
            raise RuleError("The deadline has passed.")
        entry = Entry(self.day, self.day, "Let a day pass", "You leave the day unbooked.", 0)
        return self._record(("wait",), 1, entry)

    def _record(self, event: tuple[str, ...], days: int, entry: Entry) -> Entry:
        self.elapsed += days
        self.spent += entry.cost
        if self.pending and self.pending.due_day <= self.elapsed:
            self._award(self.pending.job)
            entry = replace(entry, delivery=self.pending)
            self.pending = None
        self._events.append(event)
        self._journal.append(entry)
        return entry

    def apply(self, event: object) -> Room | Entry:
        """Apply one canonical move from the terminal, a rehearsal or a save."""
        match event:
            case ["go", str(destination)]:
                return self.move(destination)
            case ["do", str(action_id)]:
                return self.work(action_id)
            case ["talk", str(person_id), str(topic_id)]:
                return self.talk(person_id, topic_id)
            case ["queue", str(batch_id)]:
                return self.queue(batch_id)
            case ["wait"]:
                return self.wait()
            case _:
                raise RuleError("Unrecognized move.")

    def fork(self) -> Game:
        """Replay the accepted moves into an independent session for a plan."""
        trial = Game(self.story)
        for event in self._events:
            trial.apply(event)
        return trial
