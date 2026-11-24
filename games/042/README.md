# 2048 | Kowloon Tong study break

Play 2048 in the terminal, ask for a hint, or give the board to an expectimax AI. The game uses only the Python standard library and runs offline.

## Play

From this folder, run with Python 3.10 or newer.

```sh
python -m game2048
```

Type a command and press Enter. The board shows the score, the number of successful moves, and the largest tile.

| Command | Action |
| --- | --- |
| `w` / `a` / `s` / `d` | Slide up / left / down / right |
| `up`, `left`, `down`, `right` | Slide in the named direction |
| `h` or `hint` | Ask which move the AI would play |
| `p` or `ai` | Let the AI play one turn |
| `q` or `quit` | End the session |

## Watch the AI

Watch 20 moves from a fixed opening.

```sh
python -m game2048 --ai --seed 17 --moves 20
```

For an HKBU lunch-break challenge, try seed 2048. The AI built a **4096** tile and scored **56,316** from this opening on Python 3.11. Play the same opening to see how you do.

```sh
python -m game2048 --ai --seed 2048 --quiet
python -m game2048 --seed 2048
```

With the same seed and moves, the tile spawns repeat. `--quiet` shows the final AI board and result. `--moves N` caps successful moves in either mode, and `--moves 0` shows the opening. Use `--depth 1`, `2`, or `3` to change the search horizon for both hints and autoplay. The default is 2. Each extra turn expands more possible boards. Run `python -m game2048 --help` for all options.

## Rules

Two tiles start on a 4×4 board. A slide pushes every tile toward the chosen edge. Equal tiles merge in pairs, starting at that edge. Each merge adds the combined tile's face value to the score. For example, sliding `[2, 2, 4, 0]` left produces `[4, 4, 0, 0]` and earns four points. The two fours can merge on a later turn.

After a successful slide, a uniformly chosen empty square receives a **2** with 90% probability or a **4** with 10% probability. A blocked slide leaves the board and move count intact. Reach 2048 to earn the trophy, then keep playing for larger tiles. The game ends when every direction is blocked.

## How expectimax chooses a move

Each player node considers every legal slide and adds its merge points to the expected value of the resulting board. Each chance node averages over both possible tile values in every empty square, weighted by their spawn probabilities. At depth 2 the AI considers its first slide, the spawn, its best reply to each possible spawn, and the next spawn.

At the search horizon, the heuristic rewards empty squares and tiles that can merge. It penalizes large jumps in tile rank and favors rows and columns ordered from small to large in either direction. A terminal board receives a large penalty. Bounded caches reuse row evaluations and search results. Equal move values resolve in the order up, left, right, down.

## Run the tests

```sh
python -m unittest discover -v
```

The suite checks all 256 four-cell lines made from 0, 2, 4, and 8 in every direction. It also checks scoring, spawn odds, terminal boards, and expectimax values against an independent search using exact fractions. Command-line tests replay an AI game through the manual controls and play a full unattended game to its end.

## Round 2

### Play a puzzle

Each puzzle starts from a fixed board with a repeatable tile generator. Reach the target within the slide budget. A blocked slide costs no turns, and reaching the target on the last slide counts as a win.

| Puzzle | Target tile | Slides |
| --- | ---: | ---: |
| `double-merge` | 32 | 2 |
| `switchback` | 64 | 3 |
| `last-train` | 128 | 5 |

Try **Last Train at Kowloon Tong** between classes, or list the deck first.

```sh
python -m game2048 --list-puzzles
python -m game2048 --puzzle last-train
```

The usual `hint`, `coach`, `undo`, and `redo` commands work during a puzzle. The coach ranks legal slides and shows each slide's immediate points and chance of losing on the next spawn. Type `save lunch.json` at the move prompt, then use `python -m game2048 --load lunch.json` to resume with the same goal, remaining turns, and spawn stream. Earlier checkpoints still load.

### Record and review a game

```sh
python -m game2048 --ai --seed 17 --depth 1 --moves 20 --record practice.json
python -m game2048 replay practice.json
python -m game2048 replay practice.json --turn 8
```

`--record FILE` writes a local replay on normal exit in manual or AI play, including puzzles and daily sprints. Playback shows each slide, its merge points, and the resulting board. Turn 0 is the recorded opening, which can also be a loaded checkpoint. Undoing a slide removes it from the exported line of play unless you redo it. Playback checks every move and verifies the final board, score, and move count, even when you request a single turn.

### Compare AI depths

```sh
python -m game2048 benchmark --seed 17 --games 2 --depths 1 2 --moves 12
```

This plays four games. Each depth gets seeds 17 and 18 and the same 12-slide cap. The report shows each game's score, moves, best tile, and finish, followed by the mean score, mean moves, largest tile, and number of games that reached 2048 at each depth. Use `--moves 0` to compare the openings. A game that runs out of legal slides finishes early.

### Fixes and tests

Checkpoints and replays share atomic file writes. A denied write reports an error immediately and preserves the previous file. A terminal slide at the move cap ends the session without another input prompt. Autoplay and hints select the best expectimax value directly. Custom positions with merge scores beyond floating-point range use exact arithmetic.

The expanded suite solves every puzzle, checks replay branches and resumed games, reads version-1 checkpoints, exercises failed saves, and compares benchmark rows with standalone AI runs. Run it with `python -m unittest discover -v`.

## Round 3

### Preview a slide

At the move prompt, type `preview left` (or `preview a`) to see the board after the merge and before the spawn. The forecast shows the chance of each possible point total if you take the highest-scoring slide on the following turn, including the chance of having no legal reply. A slide that reaches the puzzle target or turn limit shows the finish condition. Previewing keeps your turn, undo history, and next random draw available for play.

For example, start with just two twos in the top row. Sliding left makes a four in the corner. Six of the fifteen empty squares share its row or column. A four spawning on one of those squares gives you an eight-point reply, a **4%** chance overall.

### Find a shortest puzzle solution

```sh
python -m game2048 solve switchback
```

Type `solve` during a puzzle to search from your current board, including after an undo or a checkpoint load. The solver tries routes in order of length using the puzzle's actual spawn stream. It returns a shortest winning sequence or tells you when the remaining budget is too small. The usual `hint` still uses expectimax.

### Review a decision and play it again

For a six-slide rematch in the HKBU canteen queue, start this recording and enter `right`, `down`, `right`, `down`, `left`, `right`. A classmate can try the same decision from your replay.

```sh
python -m game2048 --seed 17 --moves 6 --record canteen.json
python -m game2048 review canteen.json --depth 1 --top 3
```

The review scores each choice on the board **before** its slide. It counts tied best moves and lists the largest gaps between the played move's expectimax value and the best value at the chosen depth. Use `--top 0` for the summary. In this drill the largest gap is on slide 5, where expectimax prefers up. The report lists fork turn 4 so you can try it yourself.

```sh
python -m game2048 --fork canteen.json --turn 4 --record rematch.json
```

A fork opens the position **after** the selected number of recorded slides. Turn 0 is the recorded opening, even for a recording that began at a checkpoint. The new session inherits the score, move count, random generator state, and any challenge objective. Its undo history and new recording begin at the fork. Review and fork both verify the entire source replay.

### Search accuracy and tests

On large imported boards, floating-point rounding could make distinct slides look tied. Expectimax now switches to exact arithmetic before large merge scores lose that distinction. Regression tests cover a 23.9-point search-value gap that previously rounded away, exact forecast odds, shortest puzzle routes, replay integrity, and the full review-to-fork example above.
