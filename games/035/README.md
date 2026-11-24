# Pinchline Six

Pick three heroes and watch them fight for the last safe tile on a folding print table. Copper and Indigo move, cast, and dodge the shrinking fringe on a 17-by-11 ASCII court. At the fictional Tong Loop print club near HKBU in Kowloon Tong, the losing team makes the milk-tea run.

## Run a match

From this folder, run the following command with Python 3.10 or newer. The game and tests use only the Python standard library.

```sh
python -m pinchline --seed 852
```

In a supported terminal, the court redraws every 0.4 seconds until a team wins or the match ends in a draw. Press Ctrl+C to stop early. Omit `--seed` for a fresh deal. The header prints the seed so you can replay the same opening pads, decisions, and tie-breaks with the same drafts and beat limit.

| Option | What it does |
| --- | --- |
| `--view auto` | Animates a terminal with cursor support. Prints the final board immediately when piped or redirected. This is the default. |
| `--view frames` | Prints the opening board and every subsequent beat as a plain ASCII transcript, at full speed. |
| `--view final` | Plays the whole match immediately and prints the final board, verdict, and team scores. |
| `--delay 0.2` | Sets the seconds between live frames. Accepts 0 through 10. |
| `--limit 20` | Rings the final bell after 20 beats if both teams still have survivors. The default is 60. |

## Draft a trio

```sh
python -m pinchline --roster
python -m pinchline --seed 852 --copper Tucklark Darnlet Inkrill --indigo Pleatram Vellumoth Hushspool --view final
```

Draft order assigns Copper's `A B C` and Indigo's `x y z`. The seed deals each team onto its three starting pads. Names are case-insensitive. Pick three different heroes per team. Both teams can draft the same hero.

| Hero | Signature | Effect |
| --- | --- | --- |
| Pleatram | Awning Fold | Tops up its own ward and nearby allies' wards to 5. Ward persists until a hit spends it. |
| Inkrill | Carbon Chorus | Hits one foe for 5 and echoes 3 damage to a second foe near the first. |
| Darnlet | Pocket Seam | Restores up to 7 HP to the nearby ally missing the most health, including itself. |
| Tucklark | Margin Hop | Jumps up to two steps to a free safe tile beside a foe and hits for 6. Can strike from its own tile when adjacent. |
| Vellumoth | Ghost Serif | Deals 6 damage through ward and leaves that ward intact. |
| Hushspool | Slack Note | Hits for 4 and drains up to 3 charge after both sides have acted. |

The house draft gives Copper the first three heroes and Indigo the last three. Use `--roster` for their HP, pulse damage, and ranges, or `--help` for the command reference.

## Read the court

`.` is safe floor, `#` is a baffle, and `!` is exposed floor. A letter on the court identifies a hero in the side panel. A `!` next to that hero's letter in the panel means they are exposed. The panel shows current/max HP, charge (`[++...]` means two of five), and ward. The feed under the court names the caster, targets, and strength of each hit or effect.

**Each beat plays out in three steps.**

1. The zone updates and each living hero gains one charge, up to five. Everyone starts with one. Exposed heroes seek a route back to safety first. On safe ground, a hero uses a ready signature, pulses a foe in range, or walks toward a firing position. A hero holds full charge until its signature has a valid use.
2. All six plan from the same board. Range counts the shortest orthogonal path around baffles. Pulses pass through occupied tiles. Walkers take one free tile per beat. Offensive actions favor the foe with the lowest HP in range, then the nearest. The seed settles remaining ties. When two heroes claim a destination, one gets it and the other stays put. A blocked hop keeps its charge.
3. Hits lock onto their targets for that beat, even if the target moves. Ward and healing apply first, then all damage lands together. Ward absorbs ordinary damage point for point. A hero at zero HP leaves the court. Two last heroes can knock each other out for a draw.

Every fifth beat the safe rectangle loses one tile from each edge until that axis is one tile wide. Anyone still outside at the end of the beat loses HP through ward. The first fold costs 3 HP per beat, and each later fold adds one. From beat 40 the center tile is the entire safe zone.

Eliminating the opposing trio wins immediately after the beat resolves. If both teams reach the final bell, the team with more survivors wins. Remaining team HP breaks a tie in survivors. Equal survivors and HP produce a draw.

## Run the tests

```sh
python -m unittest discover -v
```

The suite checks each signature, simultaneous knockouts, contested movement, fold timing, seeded replays, ASCII output, and command-line behavior. It also plays all 400 pairings of the 20 possible trios and checks positions, health, charge, eliminations, and the verdict throughout those matches.

## Round 2

### Courier Run

The Tong Loop club has one print proof to get back to HKBU before the assignment deadline. Try the short return trip on Galley Steps.

```sh
python -m pinchline --seed 852 --court galley --mode courier --copper-deck prime patch --indigo-deck screen --view final --report
```

Both crews race for the proof (`*`) at center. A hero who survives the beat on its tile picks it up. Starting next beat, the carrier spends its action hauling the proof toward its own gate. Enemies prioritize the carrier when in range, and allies standing on the return gate step aside when an exit is free.

Copper returns to `<` and Indigo to `>`. The gates sit at the two outermost open tiles on the safe middle row and slide inward with the folds. Even at a shared gate (`=`), a pickup and a delivery take separate beats. A carrier must survive the arrival beat to win. A knockout drops the proof where the carrier fell. A loose proof in the fringe returns to center.

Elimination takes precedence over delivery. At the bell, possession wins. If the proof is loose, survivors and HP settle the match. The `Carry` column in `--report` counts the beats each hero ended with the proof, including pickup and delivery.

### Sideline decks

Give either crew up to three different cards with `--copper-deck` or `--indigo-deck`. Each deck starts with zero ink. While cards remain, the crew gains one ink per beat up to three. After normal charge gain and before heroes plan, the front card plays if the crew can pay and a living ally can use it. Otherwise the card waits and the crew keeps its ink. Ties go to the earliest eligible hero in draft order.

| Card | Ink | Effect |
| --- | ---: | --- |
| `prime` | 2 | Gives up to 2 charge to the ally closest to full who still has room. This can bring a signature online that beat. |
| `patch` | 3 | Restores up to 6 HP to the ally missing the most health. |
| `screen` | 2 | Tops up ward to 4 on the lowest-HP ally with less than 4 ward. |

Each card plays once, with at most one play per crew per beat. Lead with `prime patch` for an early signature. Reverse the order to hold the ink for the first injury. The board shows ink and remaining cards, the feed names each play, and `python -m pinchline --cards` prints the pocket reference.

### Paired scrimmages

```sh
python -m pinchline --pairs 3 --seed 852 --mode press --court tramline --copper-deck prime patch --indigo-deck screen
```

This plays six matches. Both legs of the first pair use seed 852. In the return leg the drafts swap sides, taking their decks with them. The next pairs use 853 and 854. The table credits wins to the original draft and counts drawn legs separately. Equal win totals tie the series.

The default series view prints a result per leg. Use `--view final` for each final board, `--view frames` for every beat, or `--report` for per-leg hero totals. Single matches still default to Knockout on Tong Loop Court with empty decks.

All three modes work on `loop` (17 by 11), `galley` (13 by 9), and `tramline` (19 by 11). In Press Run, end a beat with more survivors on the safe `=` tiles to earn one stamp. Five stamps win. At the bell, compare stamps first, then survivors, then HP.

### Engine fixes and regression coverage

The opening zone now reports zero fringe damage, even-sized practice courts keep a final safe tile, and each court owns its cached routes. Closing a piped transcript early exits cleanly. The expanded suite checks contested pickups, gate knockouts, held cards, side-swapped results, Press Run scoring, and frame-by-frame replays with decks on every court.

## Round 3

### Rail Run

Escort the print roller across the court. Galley Steps has the shortest track. Try this fixture before the last train out of Kowloon Tong.

```sh
python -m pinchline --mode rail --court galley --seed 852 --copper-order charged --indigo-order nearest --copper-deck prime patch --view final --record last-train.json
```

The roller (`@`) starts at the middle of the rail (`:`). Copper pushes east to `>` and Indigo pushes west to `<`. Heroes seek escort positions after checking for a ready signature. After movement, hits, and fringe damage, count the surviving heroes on the roller or one orthogonal step from it. Only safe floor counts. A majority pushes one column, a tie holds position, and a crew can push the roller back across center. Each member of the winning escort earns one `Push` in the report.

A fold can shorten the track and draw the roller inward. Reaching a stop by a fold alone leaves the match open. A crew must win a push at or into its far stop, even when both stops share the last tile. Elimination takes precedence. At the bell a positive roller offset favors Copper and a negative offset favors Indigo. At zero, survivors and then HP settle the match.

### Crew targeting orders

Set `--copper-order` and `--indigo-order` independently in any mode. The order ranks available enemies for pulses and offensive signatures. The seed breaks exact ties.

| Order | Who gets targeted |
| --- | --- |
| `weakest` (default) | Lowest HP, then shortest open lane. |
| `nearest` | Shortest open lane, then lowest HP. Distance follows paths around baffles. |
| `charged` | Most charge after this beat's gains and cards, then lowest HP and shortest lane. With no shot or objective move available, pursue the top-ranked foe. |

An enemy proof carrier keeps first priority. Healing, warding, and escaping the fringe keep their usual timing. In paired scrimmages the return leg swaps the order along with the heroes and deck.

### Watch a recorded match

```sh
python -m pinchline replay last-train.json --beat 7 --report
python -m pinchline replay last-train.json --view frames
```

In the fixture above, beat 7 shows Inkrill and Darnlet taking the roller back to center. The report shows their contributions through that beat. Beat 0 is the opening deal.

`--record FILE` saves every ASCII board and its hero report from a single match, including the verdict, even when you watch only the final board. Playback reads those snapshots directly, so you can share the JSON file without reconstructing a draft or rerunning the match. Replay supports the usual views and live delay. A completed recording replaces the destination file atomically.

Combat resolution now lives in its own module. Press and Rail share the count of surviving holders after damage. Long seeds and beat limits wrap within the 80-column board. The test suite covers contested and reversed pushes, a one-tile rail, targeting after a card play, side swaps, exact replay seeking, and interrupted recording writes.
