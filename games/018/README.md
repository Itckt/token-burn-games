# The Eleventh Morning

An HKBU student in Kowloon Tong receives **10,000,000,000 AI tokens** from a departing lab. The grant expires at midnight on day 10. Yan needs a rain map that gets people around a locked gate. Bo has a biscuit tin of old student printwork, and she remembers the story behind every scrap. You decide what to make and who can keep it going on the eleventh morning.

This is a terminal text adventure with six places, thirteen daytime jobs, two overnight batches and nine endings. The underlying engine reads its rooms, rules and story text from JSON. The game and its tests run offline using the Python standard library.

## Play

Use Python 3.11 or newer. From this folder, run

```sh
python game.py
```

You start at the station. Try this opening to see how a field visit changes the choices at your desk.

```text
do walk
go desk
look
```

The pocket edition takes two days and 1.5 billion tokens. The wall edition takes one day and 5 billion. You have one print booking, so choosing an edition closes the other. You can also put the notes aside and visit the print room.

| Command | What it does |
| --- | --- |
| `look` | Shows the room, people, exits, numbered work choices, costs and requirements. |
| `map` | Lists rooms, exits, missing keys or milestones, people, work and batch IDs. |
| `route booth` | Finds the shortest open path. If every path is locked, it names the first gate on a possible route. |
| `go desk` | Travels through the exit with that ID. |
| `do fold` or `1` | Performs the named action or the numbered action on the current room's menu. |
| `talk` or `talk yan` | Lists people here or opens one person's topic menu. |
| `talk yan crossing` | Chooses a topic. Check its item exchanges in the menu before committing. |
| `inventory` or `bag` | Shows the quantity of each item you're carrying. |
| `calendar` | Lists booked work by opening day, with directions, costs and the last day each job can start. |
| `queue` or `queue proof` | Lists terminals and the current run, or submits a named batch at its terminal. |
| `plan do walk / go desk / 1` | Rehearses moves from your current position and shows the projected day, balance and bag. |
| `status` | Shows the day, balance, spending, running batch and project milestones. |
| `journal` | Reads back work, conversations, submissions and deliveries with their dates, costs and items. |
| `wait` | Lets one day pass for free. |
| `save` and `load` | Writes or restores the adventure's save slot. |
| `help` or `?` | Shows the command list. |
| `quit` | Leaves the game. Save first to keep your place. |

Travel and inspection are free. Successful work takes its advertised number of whole days. A blocked action explains what it needs and costs nothing. Day 10 is available for one last day of work. A player who spends the entire balance early can still travel, do free work or wait. At the deadline the game applies the final action, expires the unused tokens, prints the ending and balances the ledger. The ending depends on what you finished.

The sample writes `eleventh-morning.save.json` in the current working directory when you type `save`. Run the game from the same directory and type `load` to resume. Starting a new session preserves the slot until you save again.

## Run the tests

```sh
python -B -m unittest discover -s tests -v
```

The suite plays all nine endings through the command-line program and checks their final balances. It also compares a rehearsal with the same moves played live and resumes a running batch in a new process. Boundary cases include overnight deliveries during longer jobs, the final midnight, one-way gates, failed exchanges, invalid saves and custom story files. Tests use temporary directories inside the project.

## Write an adventure

To write another adventure, copy the sample to `stories/my_story.json` and give it a new `id` so it gets its own save slot. [Sample story](stories/eleventh_morning.json)

Launch the copy with

```sh
python game.py --story stories/my_story.json
```

| Story field | Meaning |
| --- | --- |
| `id`, `title`, `intro` | The save-slot ID, display title and opening scene. IDs start with a lowercase letter and use lowercase letters, digits and hyphens. |
| `days`, `resource`, `budget` | A positive whole-day limit, resource name and nonnegative integer allocation. |
| `start`, `rooms` | Starting room ID and a dictionary of rooms. Each room has a `name` and `description`. Its optional `exits` list names directly reachable rooms. Include the return exit for two-way travel. |
| `flags` | An optional dictionary of milestone IDs and human-readable names. A player keeps each milestone they earn. |
| `items`, `starting_items` | An optional dictionary of item IDs to display names and an optional dictionary of initial quantities. An omitted item starts at zero. |
| `notices` | Optional day-number strings mapped to messages shown when those days arrive, including days crossed during longer jobs. |
| `endings` | An ordered list of records with `id`, `title`, `text` and optional `requires`. The first ending with all required flags wins. The last entry supplies an unconditional ending. |

A room's optional `actions` dictionary uses a unique ID for each job. An action needs a `name` and a `result` passage. It can set `days` (default 1) and `cost` (default 0). It can also list flags under `requires` (all needed), `unless` (any one blocks it) and `gives` (awarded on completion). Each action can be completed once. To make two jobs mutually exclusive, have both give and exclude the same flag. A room's optional `details` dictionary maps a flag to a line that becomes visible during inspection.

Add `"window": [4, 7]` to book a job between days 4 and 7 inclusive. The whole job must fit inside the booking. A two-day job can start as late as day 6. The calendar and room menu derive that date from the job's duration.

A room's optional `people` dictionary gives each person a globally unique ID, a `name`, a `greeting` and a nonempty `topics` dictionary. Topic IDs are local to the speaker. Each topic takes a `name` and `result`, and can use the same `requires`, `unless` and `gives` flags as a job. Choosing a topic records it once in the journal. Conversations take no time and spend none of the story's allocation.

Jobs and topics can use `consumes` and `produces` dictionaries. For example, `"consumes": {"blank": 1}, "produces": {"turn-take": 1}` exchanges one blank tape for a field recording. Every quantity in these dictionaries and in `starting_items` must be a positive integer for a declared item. The player must hold all inputs before the exchange can go ahead.

A room can put conditions on its outgoing exits. For example, the print room has `"exit_requires": {"hatch": ["hatch-key"]}`. Each key must name a destination in that room's `exits`. The player needs every listed flag to use that exit. Set a return condition separately if the door should lock in both directions.

A room's optional `batches` dictionary gives each batch a globally unique batch ID, a `name`, a delivery `result` and a positive integer `nights`. It accepts the same `cost`, item exchanges and flag lists as a job. The engine checks requirements and deducts the cost and inputs at submission. It awards `gives` and `produces` at the end of the last night, wherever the player is. Each batch can run once, and all terminals share one active slot. A batch must finish by the deadline. One submitted on the last day can finish that night and count toward the ending.

`story.py` loads and validates the adventure. `engine.py` owns time, spending, movement and outcomes. `game.py` provides the terminal interface. `saves.py` replaces each save atomically and restores the session by replaying accepted moves. Saves include a story fingerprint so a changed edition can be detected before replay. If the story file itself occupies the usual save path, the game writes to `<id>.slot.save.json`.

## Round 2

Wai-lam has repaired the listening button on the campus landing. There's one blank loop tape. Yan wants to record the sound of the turn at the chained gate. Bo wants the old printers to tap out the last dance on their ticket. Handing over the tape commits it to that recording. Each recording has its own ending and its own editing schedule.

Use `talk <person>` to see which conversations your work has opened and what a trade will cost. The `bag` command tracks the tape as it changes hands. The new `calendar` shows how late you can start each edit, and `route <room>` finds a path through the listed exits.

From the station, this route uses the days before the bench opens to make a pocket map as well.

```text
do walk
go desk
do fold
go booth
talk wai tape
route station
go desk
go station
talk yan crossing
bag
go desk
go booth
calendar
do air-turn
```

The crossing plays on the landing by the end of day 5. You have 7.9 billion tokens and five days left to decide what else to finish. For Bo's version, visit the print room, record the printers' permissions with `do listen` and bring her the blank. Her mix can start on day 7, a day later than Yan's.

Round 1 sample saves resume with their original moves, milestones and balances. The next `save` writes the new edition's fingerprint. The loaders now report duplicate JSON fields and excessive nesting as file errors. A failed load leaves the current session playable.

## Round 3

Siu can serve supper or call out what's left to the queue. She has a pencil sketch for a tile she could flip with one hand. Ask Bo for the service-door key, take Siu's slip to the study desk and choose how to proof the tiles. Two nights cost 800 million tokens. The overnight rush costs 2 billion. Either leaves your days free for fieldwork.

Try this from the station. The first directions identify the locked door. The last line previews a pocket map and a set of supper tiles in the same four days.

```text
route hatch
go press
talk bo hatch
go hatch
talk siu slip
go press
go station
do walk
go desk
queue
plan queue proof / do fold / go station / go press / go hatch / do hang
```

The rehearsal leaves you at the desk on day 2 with Siu's slip. Enter the six moves from the plan individually to play them. The proof arrives at the end of day 3 during the folding trials. Hanging the tiles on day 4 leaves 7.7 billion tokens and six days for other work.

`plan` also accepts conversations, waits and room-menu numbers. It reports the first blocked step, and a rehearsal that reaches the deadline shows the projected ending and ledger. Live play, rehearsals and save replay use the same move rules. Round 1 and Round 2 sample saves resume in this edition, and the next save records the upgrade.

The terminal now accepts full-width menu digits such as `１`. Authors can traverse an explicitly listed exit back to the same room. File errors identify invalid JSON numbers and story text containing unpaired Unicode surrogates before play begins.
