# Terminal Snake

A real-time Snake game for a break between lectures at HKBU. Steer the head (`@`) toward the next pineapple bun (`*`). Each bite earns a point and adds one body segment (`o`). In the default Classic round, the snake starts at five moves per second and speeds up with each bite, up to about eleven moves per second. Hitting a wall or your body ends the round. Fill the 28-by-14 board to win.

## Play

The game and tests use only the Node.js standard library and have been tested with Node.js 22.22.3. From this folder, run the game in an interactive terminal.

```sh
node snake.js
```

Use a terminal at least **58 columns wide and 19 rows tall**. If the window becomes too small during play, the game pauses. Enlarge it and press Space to resume.

| Key | Action |
| --- | --- |
| Arrow keys or W, A, S, D | Steer up, left, down, or right. A valid move also starts the round |
| Space | Start, pause, or resume |
| P | Pause or resume |
| R | Reset the round and return to the ready screen |
| M | Choose the next arena on the ready or result screen |
| G | Choose the next game mode on the ready or result screen |
| H | Show or hide a route to the current bun in Practice |
| U | Take back one Practice move, even after a crash or win |
| V | Review moves while paused or after a round. Press V again to return |
| Q or Ctrl+C | Quit and return to the terminal |

The snake starts facing right and ignores direct reversals. For a quick U-turn while heading right, press Up and then Left. The snake takes the two corners on successive moves. Each arena and mode keeps its own best score until you quit.

Run `node snake.js --help` for a quick controls reference. Set the `NO_COLOR` environment variable for a monochrome board.

## Run the tests

```sh
node run-tests.js
```

The suite uses repeatable snack positions and a manual clock to exercise movement, scoring, collisions, and full-board wins. It also feeds keystrokes through the terminal input decoder and checks resizing, replay, and restoration of the keyboard and cursor on exit.

## Round 2

**Delivery.** Bring in five buns within 84 moves. The counter below the board shows how many buns you have and how many moves remain. A fifth bun on the last move wins. Chests add to your score, and only buns fill the order. Share this Kowloon Tong lunch run with a classmate. A 51-move route clears it.

```sh
node snake.js --mode delivery --arena courtyard --seed 852
```

**Practice.** Run `node snake.js --mode practice` and press an arrow or WASD key to move one square. Take as long as you like to plan the next corner. Growth, collisions and chests follow the usual arena rules. Practice has its own best score.

**Move review.** Press **V** while paused or on the result screen to see the latest board. Step backward and forward with **Left/Right** or **A/D**. **Home** jumps to the oldest available board and **End** returns to the latest. The game keeps the last 64 moves, including the move that ended the round. Press **V** to return, then **Space** to resume a paused game.

All three modes work in Classic, Loop and Courtyard. Loop connects opposite edges. Courtyard adds solid market stalls (`#`). In both of these arenas, every third bun can reveal a chest (`C`) worth three points. Its counter drops once per move. Choose an arena with **M** and a mode with **G** before starting, or set them with `--arena` and `--mode`. Restarting a seeded round repeats its food draws for the same route.

The terminal now pauses as soon as a steering key detects a too-small window, even if the resize event arrives late. The score display reserves enough space for the whole round. Keyboard input and timing now live in `session.js`. The expanded tests cover the resize race, last-move deliveries, practice input, review navigation and chest placement near a full board.

## Round 3

**Junction.** Step off the board through an **A** to emerge at the other **A**. The two **B** gates link the top and bottom edges the same way. Crossing takes one move and preserves your heading. Check the landing square before committing. You can eat a bun there, open a chest or hit your own body. The rest of the border is solid. Choose Junction with **M** or `--arena junction` in any mode.

**Practice hints.** Press **H** to mark a route to the bun with dots. The line below the board gives the first direction and the distance in moves. The route updates as you steer and accounts for stalls, wrapping and gates. It can use the square your tail vacates and treats the rest of your body as blocked. If the hint says there's no clear path, try a step to open one.

**Practice undo.** Press **U** to take back one move. You can undo up to the last 64 moves, including a collision or the winning bite. Undo restores your heading, score, bun and chest countdown. Retrying the same move gives the same draws, even in an unseeded round. Take a different turn to try another route. A paused game stays paused, and your session best keeps the highest score you reached.

Try this Kowloon Tong shortcut between lectures. Press **H** at the start. Six steps down, four right and one more down take you through **B** to the first bun.

```sh
node snake.js --mode practice --arena junction --seed 2031
```

Movement and hints now share the same arena rules, and Practice undo uses the boards kept for move review. A disconnected keyboard or terminal output ends the session and stops the clock. Restoring the window size clears the resize message even if you resume before the resize event arrives.

