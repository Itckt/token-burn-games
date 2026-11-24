"""String-board reference games and unpruned minimax for cross-checking the AI."""

from functools import cache


TTT_LINES = ("123", "456", "789", "147", "258", "369", "159", "357")
C4_EMPTY = (".......",) * 6

# Two legal histories that last all 42 turns. The first ends in a striped
# draw. In the second, O completes a horizontal line with the very last disc.
C4_DRAW = (
    3, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4,
    4, 4, 4, 7, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7,
)
C4_LAST_WIN = (
    6, 4, 5, 1, 5, 6, 7, 3, 7, 3, 2, 1, 5, 1, 2, 6, 6, 3, 7, 5, 2,
    2, 6, 4, 2, 7, 6, 4, 7, 2, 5, 7, 1, 5, 4, 4, 1, 4, 3, 1, 3, 3,
)


def ttt_outcome(cells):
    for line in TTT_LINES:
        a, b, c = (cells[int(square) - 1] for square in line)
        if a == b == c and a != ".":
            return a
    return None if "." in cells else "draw"


def ttt_children(cells):
    mark = "X" if cells.count("X") == cells.count("O") else "O"
    return {
        index + 1: cells[:index] + mark + cells[index + 1:]
        for index, cell in enumerate(cells) if cell == "."
    }


def ttt_positions():
    """Yield each reachable string board and one legal history leading to it."""
    pending = [("." * 9, ())]
    seen = set()
    while pending:
        cells, history = pending.pop()
        if cells in seen:
            continue
        seen.add(cells)
        yield cells, history
        if ttt_outcome(cells) is None:
            for move, child in ttt_children(cells).items():
                pending.append((child, history + (move,)))


@cache
def ttt_minimax(cells):
    """Return score for X and the size of the full, unpruned game tree."""
    outcome = ttt_outcome(cells)
    if outcome == "draw":
        return 0, 1
    if outcome:
        magnitude = 10_000 + cells.count(".")
        return (magnitude if outcome == "X" else -magnitude), 1
    replies = [ttt_minimax(child) for child in ttt_children(cells).values()]
    select = max if cells.count("X") == cells.count("O") else min
    return select(score for score, _ in replies), 1 + sum(size for _, size in replies)


def c4_children(rows, mark):
    children = {}
    for col in range(7):
        for row in range(5, -1, -1):
            if rows[row][col] == ".":
                updated = rows[row][:col] + mark + rows[row][col + 1:]
                children[col + 1] = rows[:row] + (updated,) + rows[row + 1:]
                break
    return children


def c4_replay(history):
    rows = C4_EMPTY
    for ply, move in enumerate(history):
        rows = c4_children(rows, "XO"[ply % 2])[move]
    return rows


def c4_windows(rows):
    for row in rows:
        for col in range(4):
            yield row[col:col + 4]
    for col in range(7):
        column = "".join(row[col] for row in rows)
        for start in range(3):
            yield column[start:start + 4]
    for row in range(3):
        for col in range(4):
            yield "".join(rows[row + i][col + i] for i in range(4))
            yield "".join(rows[row + 3 - i][col + i] for i in range(4))


def c4_outcome(rows):
    for window in c4_windows(rows):
        if window in ("XXXX", "OOOO"):
            return window[0]
    return None if "." in rows[0] else "draw"


def c4_window_value(window):
    xs, os = window.count("X"), window.count("O")
    if xs and not os:
        return 8 ** (xs - 1)
    if os and not xs:
        return -(8 ** (os - 1))
    return 0


@cache
def c4_minimax(rows, mark, depth):
    """Maximize for X and minimize for O, visiting every legal alternative."""
    outcome = c4_outcome(rows)
    if outcome == "draw":
        return 0, ()
    if outcome:
        magnitude = 10_000 + sum(row.count(".") for row in rows)
        return (magnitude if outcome == "X" else -magnitude), ()
    if depth == 0:
        return sum(c4_window_value(window) for window in c4_windows(rows)), ()
    opponent = "O" if mark == "X" else "X"
    values = {
        move: c4_minimax(child, opponent, depth - 1)[0]
        for move, child in c4_children(rows, mark).items()
    }
    best = (max if mark == "X" else min)(values.values())
    return best, tuple(move for move, score in values.items() if score == best)


def c4_move_scores(rows, mark, depth):
    """Score every candidate for the mover, using the unpruned string-board tree."""
    opponent = "O" if mark == "X" else "X"
    sign = 1 if mark == "X" else -1
    return {
        move: sign * c4_minimax(child, opponent, depth - 1)[0]
        for move, child in c4_children(rows, mark).items()
    }
