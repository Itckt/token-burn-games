# Gutterlight Relay

Command a night crew on two narrow routes above Kowloon Tong. Send a courier down the Roof lane, screen a long-range crew on the Canal, or spend your last two energy repairing a tower. In this fictional HKBU night league, the losing crew makes the milk-tea run.

Gutterlight Relay is a real-time terminal card battler with a seeded AI opponent, two eight-card decks, and a replay viewer. It runs offline with Python 3.10 or later and uses only the standard library. Run the commands below from this folder.

## Play against the pilot

```text
python -m gutterlight play --seed 27 --save my-match.json
```

You command Amber on the left. **Press a number from 1 to 4, then R for Roof or C for Canal.** For example, pressing `2` then `C` sends the second card in your hand to Canal on the next half-second beat. Keys act immediately. The clock keeps moving while you choose.

| Live key | Action |
| --- | --- |
| `1`–`4` | Select a card, show its ability, and clear any pending order |
| `R` / `C` | Queue the selected card for Roof / Canal. Press the other lane key to retarget before the beat |
| `X` | Clear the selection and pending order |
| `Q` | Leave the match. With `--save`, keep a replay through the last completed beat |

### Read the board

- Each lane runs from an Amber tower on the left to an Indigo tower on the right. The numbers at either end are tower hull. Each `#` in an energy bar pays for one point of card cost.
- Uppercase unit marks belong to Amber and lowercase marks to Indigo. For example, `C3` means three Amber Clip Crew units in one cell. A `+` marks a mixed group or a stack of ten or more. A `><` marks a cell occupied by both sides.
- The signal starts on Roof and switches lanes every eight seconds. A crew sent to the lit lane starts two cells from its tower instead of one. An approaching enemy can shorten the launch.

### Win the match

Both towers on each side start with 150 hull. Breaking either enemy tower wins immediately. If both sides lose a tower on the same beat, the match is a draw. At the 90-second time limit, the side with more combined tower hull wins. Equal totals draw.

Each side starts with **5 energy**, gains **1 every 2 seconds**, and can hold **10**. Four of your eight cards are in hand. Playing a card sends it to the back of the four-card reserve and refills just its slot from the front. Each side can play one card per beat.

Crews advance and fight automatically in their own lane. They target an enemy within reach before attacking its tower. Towers fire at the nearest intruder within three cells. Combat damage resolves simultaneously, so two crews can take each other out. Squall Lens hits the enemy closest to your tower and nearby enemies in that lane. Patch Reel restores up to 24 hull to a damaged friendly tower. The game checks both orders before charging energy or resolving either card.

## Decks and unattended matches

**Awning** fields the sturdy Ballast Mule and the splash-damage Drum Roller. **Trestle** trades those two slots for the quick Foil Fencer and long-range Loom Tender. The dispatch manual lists every card, its energy cost, and the cards in each deck.

```text
python -m gutterlight cards
python -m gutterlight simulate --seed 27 --save night-shift.json
python -m gutterlight play --deck trestle --opponent-deck awning --seconds 60
```

`simulate` runs two pilots at full speed and prints the outcome. The pilots consider nearby threats, existing defenders, tower damage, and energy reserves. Both match commands accept `--deck`, `--opponent-deck`, `--seconds` (1–300), and `--seed` (0–4294967295). Omit the seed for a fresh deal. The board displays the chosen seed.

## Watch a replay

```text
python -m gutterlight replay night-shift.json
```

The viewer shows both hands and starts at normal speed. It pauses on the last recorded beat so you can inspect the finish.

| Replay key | Action |
| --- | --- |
| Space | Pause or resume. At the end, restart from the opening |
| `B` / `N` or left / right arrow | Step backward / forward one beat and pause |
| `H` / `E` | Jump to the first / last recorded beat and pause |
| `-` / `+` | Change speed through 0.5×, 1×, 2×, and 4× |
| `Q` | Close the viewer |

For a terminal transcript, select a beat, read the event log, or print every frame. Beat 0 is the opening deal. With redirected input or output, the default replay command prints the last frame.

```text
python -m gutterlight replay night-shift.json --tick 32
python -m gutterlight replay night-shift.json --events
python -m gutterlight replay night-shift.json --frames
```

`--save FILE` writes a versioned UTF-8 JSON recording and replaces that file on a successful save. A tape stores the opening decks in order, the clock limit, the accepted orders, and the last completed beat. The viewer replays those orders using the battle rules and checks the final state against the stored SHA-256 fingerprint. This also works for a match you left partway through.

## Run the tests

```text
python -m unittest discover -s tests -v
```

The suite exercises card rotation, energy timing, lane targeting, simultaneous combat, all victory conditions, and AI decisions across seeded matches. It compares recorded frames with the original match, checks damaged tapes and failed saves, drives the live and replay controls with a simulated clock, and runs the command-line programs end to end. Test recordings use temporary folders inside the project.

## Round 2

### Escort a cart

In **Convoy**, a handcart starts at cell 6 in each lane. Every full second, after crews move and casualties leave the board, each cart checks its own cell and the cell on either side. If only Amber or only Indigo has survivors there, the cart rolls one cell toward the opposing tower. Empty and contested carts stay put. A fast runner can overshoot its cart and leave it open for the other side.

```text
python -m gutterlight play --mode convoy --deck viaduct --seed 27
```

Follow the `@` below each lane. Amber delivers at cell 12 and Indigo at cell 0. A broken tower takes priority. Otherwise a delivery wins immediately, and opposing deliveries on the same beat draw. At the whistle, add both carts’ displacement from midfield. Roof at 9 and Canal at 4 gives Amber a one-cell lead. Level progress goes to combined tower hull, then a draw.

### Run the Kowloon Tong Cup

Give each pair of decks a turn in both seats. Each round uses the same seed for every fixture, then advances the seed by one for the next round. Pilots play at full simulation speed. A win earns three points, a draw earns one per deck, and tied decks share a place. At the HKBU canteen, first place gets the last egg tart.

```text
python -m gutterlight cup awning trestle viaduct --mode convoy --seed 27 --rounds 2 --save-game 2 canteen-cup.json
```

This runs twelve fixtures and saves the second, with Trestle playing Amber against Awning. Omit the deck names to enter all presets, or use eight comma-separated card keys for a custom entry. The cup accepts the same clocks and modes as `simulate`.

### Scout a replay

Press **S** in the viewer to pause and switch between the board and the scouting report. Step with `B` or `N`, or jump between highlights with `[` and `]`. The report counts only the beats you have reached. Home and End also work on terminals that send numbered key sequences.

```text
python -m gutterlight replay canteen-cup.json --stats
python -m gutterlight replay canteen-cup.json --stats --tick 12
python -m gutterlight replay canteen-cup.json --highlights
python -m gutterlight practice canteen-cup.json --tick 12
```

Use the lane rows to see where each side spent energy, how many individual units it fielded and lost, and how much enemy hull it hit or friendly hull it patched. A repair and a hit on the same beat both count. The card tally shows repeat dispatches, and the energy tally counts regeneration lost at the cap. Pick a beat before a turning point and use `practice` to try another play.

Cart positions now participate in replay verification. The report also works on older recordings and unfinished matches. The expanded suite checks delivery timing, mirrored fixtures, saved replays, repair accounting, and navigation at the opening and finishing beats.

## Round 3

### Draft both decks

Eight pairs divide the sixteen-card catalog between the two sides. Press **1** or **2** to keep a card for Amber. Indigo gets its partner. The pairs are grouped by role, so each side comes away with seven crews and one field or tower order. On seed 27 the first choice is Ink Glider or Hem Weaver. Taking the Glider gives the opposing pilot a healer.

```text
python -m gutterlight draft --seed 27
python -m gutterlight play --seed 27 --draft
python -m gutterlight simulate --seed 27 --draft 12121212 --mode convoy --save pair-night.json
```

The live clock starts after the eighth pick. Press **Q** during the draft to leave before the deal. A seed and eight digits reproduce both decks. Use `draft --seed 27 --picks 12121212` to print their comma-separated lists for a cup.

### Field the new crews

| Card key | Crew | Energy | Ability |
| --- | --- | ---: | --- |
| `shale` | Shale Porter | 4 | Armor absorbs 3 from each crew or tower hit, including splash. Each hit deals at least 1. Squall Lens deals its full 16. |
| `hem` | Hem Weaver | 3 | Uses its attack beat to mend up to 8 hull on another wounded crew within two cells in its lane. With no patient it fights or advances. |
| `awl` | Twin Awls | 3 | Two riggers share a dispatch. Each adds 5 damage to its own tower strikes. |
| `chit` | Chit Skater | 1 | A runner who covers a cell every beat and cycles a hand slot for one energy. Someone has to get the HKBU tea order back before tutorial. |

The Weaver chooses the ally missing the most hull. Ties go to the nearest, then the earliest deployed. Squall casualties leave before it picks a patient. Combined mends stop at the patient's maximum hull, then ordinary combat hits land together. A Weaver can save its partner on the beat it falls.

### Study a replay decision

Press **D** in the viewer to pause and play out every legal next order, including **PASS**. **Tab** switches seats, **B/N** changes the beat, and **D** returns to the board. Each trial faces the same opposing pilot order. Both seeded pilots play from the following beat. You can also study the last position in an unfinished recording.

```text
python -m gutterlight study tests/round1-seed27.json --tick 118 --side indigo --save-pick 4C canal-line.json
python -m gutterlight replay canal-line.json --stats
```

On that tape, Indigo's recorded order for beat 119 was `2R`, Foil Fencer to Roof. It won on time by 64 combined hull. In the saved `4C` branch, Ink Glider goes to Canal and the margin reaches 123. The table ranks wins, draws and losses, then breaks ties by objective margin and combined hull. Positive numbers favour the seat under study. Each saved branch includes the shared opening and the complete alternative finish.

Practice and study now share the code that restores the board and both pilots. Malformed orders raise the usual move error before either side spends energy. Ctrl+C during replay input closes the viewer at the current beat, and long card descriptions wrap on an 80-column terminal. The expanded tests cover every draft code, simultaneous mends and hits, and replay branches from both seats.
