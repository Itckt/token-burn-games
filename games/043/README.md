# Tic-tac-toe and Connect Four

Play either game against a minimax AI, share the terminal with a friend, or let the computer play both sides. Tic-tac-toe plays perfectly at its default depth. Connect Four searches six moves ahead by default and lets you adjust the depth.

## Play

Use Python 3.10 or newer and run these commands from this folder. The project uses only the Python standard library and was tested with Python 3.11.15.

| To play | Command | Your move |
| --- | --- | --- |
| Tic-tac-toe | `python play.py` | Choose a square from 1 to 9. The top row is 1, 2, 3. |
| Connect Four | `python play.py connect-four` | Choose a column from 1 to 7. Your disc falls to its lowest empty cell. |

You start as X. Get three in a row in tic-tac-toe or four in Connect Four, horizontally, vertically, or diagonally. A full board with no winner is a draw. An invalid move lets you try again. Enter `q` to leave a game.

For a study break at HKBU in Kowloon Tong, try holding the tic-tac-toe AI to a draw as O before your milk tea cools.

```sh
python play.py tic-tac-toe --second
```

To watch two Connect Four AIs play with a four-ply search and see the work behind each move, run

```sh
python play.py connect-four --self-play --depth 4 --stats
```

| Option | Effect |
| --- | --- |
| `--second` | You play O. The computer opens as X. |
| `--self-play` | The computer plays both X and O. |
| `--two-player` | Two people alternate moves at one terminal. |
| `--moves 1,5,2` | Replay a comma-separated opening, starting with X. Each move must be legal when played. |
| `--analyze` | Rank the legal moves in the current position, show one sequence of best replies, and exit. |
| `--review` | Compare each recorded move with the best move available at the time. |
| `--puzzle NAME` | Try a tactics puzzle. Use `--puzzle list` to see the names for the selected game. |
| `--tactics` | Show which moves win now, allow an immediate winning reply, or force a win next turn. |
| `--arena A B` | Compare two search depths. Each engine plays both seats from each opening. |
| `--node-budget N` | Limit each computer move to N node visits, including in the arena. |
| `--depth N` | Set the search depth in plies. One ply is one move by one player. N must be a positive integer. Puzzles also have a minimum depth for checking their goal. |
| `--stats` | Show the depth limit, mover's score, nodes visited, alpha-beta cutoffs, and cache hits. |
| `--help` | Show the command-line options. |

## How the AI chooses

Both games use the same negamax form of minimax. For each candidate move, the AI searches the opponent's best reply and negates its score. Alpha-beta pruning skips the rest of a branch once it cannot improve the decision. A fixed, center-first move order breaks ties and helps the search find cutoffs early.

Tic-tac-toe searches up to nine plies, enough to reach a win or draw on every branch. From the empty board, the AI picks the center and scores the game as a draw under perfect play. This decision visits 2,172 nodes, including 853 cache hits. The search can reuse work when different move sequences reach the same board with the same depth left. The full unpruned tree has 549,946 nodes when different move sequences are counted separately.

Connect Four has 42 cells. At the depth limit, the AI estimates the position by examining every possible four-cell line. An unblocked line containing one, two, or three of its discs earns 1, 8, or 64 points respectively. The opponent's lines subtract the same amounts. Deeper searches can see tactics beyond this estimate and take longer.

In both games, a terminal win or loss has a magnitude of 10,000 plus the number of empty cells. This favors quicker wins and delays forced losses. A draw scores zero. Search depth is capped at the number of empty cells.

### Use the AI from Python

In this position X occupies the first three cells of the bottom row. O has to block column 4.

```python
from ai import choose_move
from games import CONNECT_FOUR, Position

board = Position(CONNECT_FOUR)
for column in (1, 7, 2, 7, 3):
    board = board.play(column)

choice = choose_move(board, depth=2)
print(choice.move)  # 4
```

`play` returns a new position. On a finished board, `choose_move` returns a result whose `move` is `None`.

## Run the tests

```sh
python -m unittest discover -v
```

The suite checks the rules and the AI's score and move on all 5,478 reachable tic-tac-toe boards. An independent string-board solver checks Connect Four decisions at several depths and through selected endgames. Other tests cover gravity, wins in every direction, wins on the final cell, pruning in both games, invalid inputs, and complete games through the command-line interface.

## Round 2

### Play someone at the same terminal

Run `python play.py connect-four --two-player` to take turns dropping discs. Use `python play.py --two-player` for tic-tac-toe. Either player can enter `hint` for ranked moves, `history` for a reusable `--moves` argument, or `review` to inspect the game so far. In a two-player game, `undo` takes back one move and hands the turn back to its player. Against the computer, it takes back your last move together with the reply.

### Find the move that changed a game

```sh
python play.py --review --moves 1,2,5,3,9
```

Each row compares the played move with the AI's best move from the same board, at the same depth. **Loss** is the difference between their scores. Equally good alternatives get zero loss. In this game, X's opening corner scores as well as the center. O's reply in square 2 allows a forced loss in six plies. Square 5 would have held the draw.

You can review an unfinished game or add `--stats` for per-move search counts. The recap labels shallow evaluations as estimates. To examine only the final position, use `--analyze`. On a finished board, `--analyze --stats` now reports the single terminal node and the result.

### Solve a tactics puzzle

```sh
python play.py --puzzle list
python play.py connect-four --puzzle list
python play.py connect-four --puzzle two-exits
```

Each game has three puzzles covering an immediate win, a defensive reply, and a forced win on your second turn. For a one-move break between MTR trains at Kowloon Tong, try `platform-gap` in Connect Four. A wrong guess leaves the puzzle ready for another try. Enter `hint` to see one solution line or `q` to leave.

The trainer uses minimax to check every legal answer against the stated goal. It accepts both winning columns in `two-exits` and shows a winning continuation for the column you chose. The goal sets the minimum search depth, so a deeper `--depth` can change the suggested line while the puzzle keeps its original deadline.

New tests check each puzzle against every possible reply, compare replay scores with independent solvers, and exercise both undo rules through the terminal. They also verify the full move ranking and best continuation on all 5,478 reachable tic-tac-toe boards.

## Round 3

### Give the computer a search budget

```sh
python play.py connect-four --second --depth 8 --node-budget 400 --stats
```

With a budget, the AI searches one ply, then two, and continues up to the depth limit. It plays the move from the deepest search it finished. The node count includes earlier depths, cache hits and work spent on an interrupted depth. Each computer turn starts with a fresh budget.

If even one ply cannot finish, the AI plays the first legal move in its usual center-first order. In that case `--stats` reports depth zero and the static score of the current board. Hints and reviews use the selected analysis depth. In Python, use `choose_move(board, depth=8, node_budget=400)`.

### See the reply that proves a tactic

```sh
python play.py connect-four --moves 3,7,4,7 --tactics
```

X can play column 2 and threaten both ends of a line. If O blocks column 5, X wins in column 1. Every other reply lets X win in column 5. The report shows a finish against **every** legal reply for each move that forces a win next turn. It also lists immediate wins, draws and the exact replies that punish a mistake. The verdict `survives the next reply` promises safety for one opposing turn.

Enter `tactics` during a human turn or a puzzle to inspect the board and keep your turn.

### Compare two AIs from the same opening

For a quick HKBU common-room scrimmage before an assignment deadline, give X the opposite corners and O the center.

```sh
python play.py --arena 1 9 --moves 1,5,9 --stats
```

O moves next. The depth-nine engine wins both games here, once from each seat. Each result includes a complete `--moves` history you can pass to `--review` to find where the losing move occurred.

Run `python play.py connect-four --arena 2 4` for six games from three fixed openings. Supplying an unfinished `--moves` history selects one pair. The scoreboard credits wins to engines A and B. With `--stats`, each engine’s totals count the moves it searched. Add `--node-budget` to give both seats the same allowance per move.

Custom puzzles now validate their win deadlines and search depths. Finished boards show the result, and a puzzle with no satisfying move ends before the prompt. The expanded tests check budget boundaries, replay arena games, and verify every tactical reply on all 5,478 reachable tic-tac-toe boards against an independent string-board implementation.
