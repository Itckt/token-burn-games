# Kowloon Stack

Fit falling four-block pieces into a 10-by-20 well. A complete horizontal row disappears and the blocks above it settle down. The dotted outline shows where a hard drop will land.

## Play

From this folder, start a round in an interactive terminal with Node.js. The game uses only the standard library and was tested with Node.js 22.22.3.

```sh
node game.js
```

Use a terminal at least **52 columns wide and 22 rows tall**. If you shrink it below that size, the game clock stops until the board fits again. Keys take effect immediately.

| Action | Keys |
| --- | --- |
| Move left or right | Left / Right arrows or A / D |
| Turn clockwise | Up arrow, W, or X |
| Turn counterclockwise | Z |
| Soft drop one row | Down arrow or S |
| Hard drop and lock | Space |
| Hold or swap | C |
| Undo one turn in Practice | U |
| Pause for round stats or resume | P |
| Start another round after a win or game over | R |
| Quit | Q or Ctrl+C |

For a study break at HKBU, challenge a classmate to the same deal between lectures in Kowloon Tong. Share the mode and seed to repeat the piece sequence.

```sh
node game.js --seed 852
```

Endless starts by default. Use `--mode` to choose `sprint`, `dig`, `surge`, or `practice`. Add `--no-color` for monochrome play, or set a nonempty `NO_COLOR` environment variable. Run `node game.js --help` for the command-line options.

## Playing a round

- **Read the well.** `[]` marks the falling piece, `..` marks its landing position, and `##` marks settled blocks. The sidebar previews the next three pieces. Each shuffled bag contains all seven shapes exactly once.
- **Use hold.** On the first use, you set a piece aside and take the next one. Later uses swap the falling piece with the held piece. Hold becomes available again when you lock a piece.
- **Adjust a landing.** You have half a second to slide or turn a grounded piece. Up to 15 successful grounded adjustments renew that time. A hard drop locks immediately.
- **Score and level up.** Clearing one, two, three, or four rows at once earns 100, 300, 500, or 800 points times your level before the clear. Soft drops earn one point per row and hard drops earn two. Every ten cleared rows raise the level. Gravity starts at one row every 800 ms and speeds up to one every 80 ms.
- **Leave room at the top.** The round ends when an incoming piece overlaps the pile or a piece locks partly above the ceiling.

## Run the tests

Run the full suite from this folder with Node's built-in test runner. The isolation option runs all test files in one process, including in workspaces that restrict child processes.

```sh
node --test --experimental-test-isolation=none
```

The tests exercise seeded rounds, rotations at walls and floors, collisions, lock timing, row clears, scoring, and top-outs. Terminal tests feed raw key sequences through the same decoder used during play and check rendering, resize behavior, restart, and terminal cleanup.

## Round 2

**Sprint** is a race to clear 40 rows. If the last piece takes you past 40, every row still scores. **Dig** starts you above eight stone rows marked `==`. Each pair shares a one-cell opening. Clear all eight to finish. Ordinary rows still score while you dig.

```sh
node game.js --mode sprint
node game.js --mode dig --seed 852
```

Both races show your progress and time to the tenth of a second. Pausing or shrinking the terminal below 52 by 22 stops the clock. Press **R** after the finish to race again. With a seed, the retry has the same board and piece order. Running `node game.js` starts Endless as usual.

**Plan three pieces ahead.** Read `NEXT`, `2ND`, and `3RD` in order. Filling an empty hold advances the preview by one. Swapping with a held piece keeps the whole queue in place.

**Chain your clears.** When consecutive pieces clear rows, the second earns 50 bonus points, the third earns 100, and each further clear adds 50 to its bonus. A lock without a clear resets the combo.

If your previous line clear and your current one both remove four rows, add another 400 points. Locks without clears preserve this back-to-back bonus. Multiply both bonuses by the level before the clear. At level one, two consecutive four-row clears earn 800 and 1,250 points, plus any drop points.

Long line and level totals now use separate sidebar rows when needed. Quitting also restores input for programs that were already reading from the terminal. The expanded tests include a complete seed-852 Dig victory and restart played through the keyboard decoder.

## Round 3

### Surge

Survive six waves of rising stone. A wave arrives every four locked pieces. The six waves bring 1, 1, 2, 2, 3, and 3 rows. Every row you clear cancels one incoming row, including clears on the fourth lock. Extra clears still score. Each new wave starts at its listed strength.

```sh
node game.js --mode surge --seed 852
```

The forecast `In 4 locks  +1 row  gap 6` gives you four placements before one row rises. Count columns from the left, or look for `^^` under the opening. If a rise would push a block past the ceiling, the round ends. For a canteen-table challenge at HKBU, share a seed and compare scores after the sixth wave.

### Practice

```sh
node game.js --mode practice --seed 852
```

Take as long as you like to move, turn, hold, or soft drop. The piece stays where you put it until **Space** drops and locks it. Press **U** to take back a placement and return to the start of that turn. You can rewind up to 20 turns, even after a top-out. The well, score, combo, hold, and all three previews return together. Try a different placement against the same upcoming pieces.

### Round recap

Press **P** to see how many pieces you locked, your longest combo, and how many singles, doubles, triples, and four-row clears you made. The same recap appears when you finish. Practice shows how many turns you can undo. In the other modes, the clock shows active play time and excludes pauses and resize waits.

The tests now play a full Surge win through the keyboard and rewind across multiple seven-piece bags. Terminal disconnects release the game's input and stop its frame timer. Quitting also pauses the game's input before restoring normal terminal mode, fixing a Windows bug that could interrupt the calling shell.
