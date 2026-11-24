# Rule Atlas

Explore all 256 elementary cellular automata in a terminal or an offline visual workbench. Change the starting cells, switch the boundary, or flip a single entry in the rule table and watch the pattern change. The project uses standard JavaScript and the Node.js standard library. The terminal and test suite were verified with Node.js 22.22.3.

## Run in a terminal

From this folder, try a small Rule 90 triangle.

```sh
node explore.js --rule 90 --width 15 --rows 8
```

```text
.......#.......
......#.#......
.....#...#.....
....#.#.#.#....
...#.......#...
..#.#.....#.#..
.#...#...#...#.
#.#.#.#.#.#.#.#
```

Each line is one generation. The first line is generation zero, the seed. A `#` is on and a `.` is off.

For an interactive session, start with a single row.

```sh
node explore.js -i --rule 30 --width 31 --rows 1
```

At the `atlas>` prompt, try `step 7`, `table`, then `flip 000`. The last command changes Rule 30 to Rule 31 by turning on the output for three consecutive off cells. Use `reset` to return to the seed, `show` to print the whole diagram, and `quit` to leave. The session also accepts `rule N`, `width N`, `rows N`, `seed SEED`, `key N` and `boundary MODE`. Type `help` for the command list.

### Settings

| Option | Values | Terminal default |
| --- | --- | --- |
| `--rule` | Integer from 0 to 255 | `90` |
| `--width` | 1 to 512 cells, or 1 to 12 for a basin map | `63` (`8` for basins) |
| `--rows` | 1 to 512 rows, including the seed | `32` |
| `--seed` | `single`, `alternating`, `campus`, `random`, or a binary string such as `10001` | `single` |
| `--key` | Random seed key from 0 to 4294967295 | `42` |
| `--boundary` | `fixed` supplies zero beyond each edge, `fixed-on` supplies one, and `wrap` joins the ends into a ring. | `fixed` |
| `--transform` | `mirror`, `invert` or `both` transforms the entire configured run. | None |
| `--format` | `text`, `svg`, `table`, `family`, `stats`, `csv`, `parents`, `damage`, `infer` or `basins` | `text` |
| `--cell` | Seed column for `--format damage`, numbered from 0 at the left | Middle cell |
| `--observe` | Consecutive binary rows separated by `/` for `--format infer` | Configured history |

A custom pattern must fit the width. Its middle cell aligns with the middle cell of the row, choosing the right-hand middle for even lengths. Surrounding cells start off. The `alternating` seed begins with an on cell at the left. Reuse a random key and width to replay the same starting row.

For a study break at HKBU in Kowloon Tong, try the campus trio. Three relay teams start at the quarter, half and three-quarter marks. On a ring, their patterns can meet again across the edge.

```sh
node explore.js --rule 110 --seed campus --boundary wrap --width 41 --rows 16
```

One-shot commands write to standard output. To save a vector diagram in this folder with PowerShell, use the following command.

```powershell
node explore.js --rule 90 --width 127 --rows 64 --format svg | Set-Content -Encoding ascii rule-90.svg
```

## Visual workbench

[index.html](index.html) is the standalone visual entry point. It loads its scripts and styles directly from this folder and works offline. The opening view shows Rule 90 at 127 cells by 64 rows.

- Choose a rule, seed, boundary and dimensions, then select **Apply settings**. The rule shortcuts and neighbourhood buttons apply the current settings immediately.
- **Play** resumes from the selected generation. At the final row, it restarts from the seed. Pause, move the generation slider, or use **Go to seed** and **Next generation** to inspect individual rows. The live-cell count follows the selected generation.
- **Save SVG** exports the seed through the visible generation. The filename includes the rule and generation.

## Reading a rule

All cells update simultaneously. Read the previous row's left, centre and right cells as a three-bit number. That number selects the bit of the rule that becomes the new centre cell. For Rule 90, the eight outputs form the binary number `01011010`.

| Neighbourhood | 111 | 110 | 101 | 100 | 011 | 010 | 001 | 000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rule 90 output | 0 | 1 | 0 | 1 | 1 | 0 | 1 | 0 |

## Run the tests

```sh
node --test --experimental-test-isolation=none
```

This runs the full suite in one process from the command line. An independent string-based calculation checks every rule against every starting state of widths 1 through 5 under all three boundaries. Other tests cover known patterns, repeatable seeds, input limits, interactive commands and SVG geometry. The visual tests load the page scripts in Node with a simulated DOM, canvas and clock to check pixel data, playback, rule editing and downloads.

## Round 2

### Find the first repeat

For a lunch-break arena drill in Kowloon Tong, put three teammates on a nine-space ring. Rule 170 moves every player one space left per turn. After three turns a teammate occupies each starting spot, so the row has period 3.

```sh
node explore.js --rule 170 --width 9 --rows 4 --seed 100100100 --boundary wrap --format stats
```

The workbench shows how many cells changed at the selected generation. **Go to first repeat** jumps to the earliest row that exactly matches an earlier row in the configured run. The distance between them is the period. A period of 1 is a fixed point. Increasing the row count lets you look for a later return.

In a terminal session, `stats G` considers generations 0 through G. With `stats` alone, G is the final generation. Use `--format csv` or the `csv` command for a row-by-row record of generation, live cells and cells changed. Generation zero has an empty change field.

### Explore equivalent rules

```sh
node explore.js --rule 30 --format family
node explore.js --rule 30 --seed 10001 --width 12 --rows 6 --transform mirror
```

Rule 30 mirrors to Rule 86, swapping on/off gives Rule 135, and doing both gives Rule 149. The **Equivalent runs** buttons let you see each transformation at the same timeline position. The new seed is the full transformed starting row, including any padding or keyed random cells. Swapping on/off also exchanges the two fixed boundaries. A ring stays a ring. The session commands are `family` and `transform mirror|invert|both`.

### Work backward one generation

```sh
node explore.js --rule 90 --width 4 --rows 1 --seed 0000 --boundary wrap --format parents
```

Four different seeds produce this target in one step. The report gives the exact count and prints the first three seeds in binary order (`0000`, `0101`, `1010`). The search counts paths through overlapping pairs of cells, so even a 512-cell row with 2⁵¹² predecessors has an exact answer.

In the workbench, open **Predecessors** at any generation and choose a sample. The new run opens at generation 1 so you can check that it recreates your target. A one-row run grows to two rows for this check. In a terminal session, `parents G` inspects generation G and `parents` inspects the last row. Use `seed BITS` to try a sample.

Interactive `step` now extends the existing history. The workbench also keeps the rule stepper in sync when a preset is selected while another field is invalid. The tests check reverse results against exhaustive forward evolution, verify transformed histories cell by cell, and exercise all three tools through the terminal and simulated workbench.

## Round 3

### Follow a one-cell change

```sh
node explore.js --rule 90 --width 7 --rows 5 --format damage --cell 3
```

Flip one cell in a copy of the seed and evolve both rows with the same rule and boundary. Each `#` marks a difference. The Hamming distance counts those marks in each generation. In this example the distances are **1, 2, 2, 4, 0**. Once the rows agree at generation 4, their futures coincide.

The session command is `damage [X]`. Omitting X flips the middle cell, choosing the right-hand middle for even widths. In the workbench, open **What changes if one seed cell flips?** and scrub the timeline to see the differences in copper. **Use flipped seed** opens the second run at the same generation.

### Recover a rule from observations

Between classes at HKBU, you sketch an eight-slot energy bar for a 3v3 arena prototype. It shifts one place per tick. Two frames contain enough evidence to recover the rule.

```sh
node explore.js --format infer --boundary wrap --observe 00010111/00101110
```

All eight neighbourhoods occur in the first frame. Their observed outputs, in order from 111 to 000, are `10101010`. Only Rule 170 fits. A `?` marks an unseen neighbourhood. A `!` means the same neighbourhood produced both 0 and 1, so no elementary rule fits under the chosen boundary. A single frame leaves all 256 rules possible.

Use `--format infer` on a configured run, or enter `infer [G]` in a session to use the seed through generation G. The session also accepts `infer ROW/ROW/...`. In **Which rules fit the observations?**, follow the timeline or enter one row per line and select **Find matching rules**. Entered rows supply their own width and use the applied boundary. **Explore rule** replays a candidate from the first observation.

### Map the basins of attraction

```sh
node explore.js --rule 170 --width 3 --boundary wrap --format basins
```

A basin contains all seeds that eventually reach the same cycle. On this three-cell ring, `000` and `111` are fixed points. The other six seeds split between two period-three cycles, one with one live cell and one with two. The report lists basins by decreasing size, breaking ties by the smallest binary seed on the cycle. Each example seed takes the maximum number of steps to reach its cycle.

A map covers widths 1–12, up to 4,096 seeds. In a session, `basins [WIDTH]` inspects a width independently of the diagram. The workbench starts with the diagram width when it fits and eight cells otherwise. Open **Map all seeds to their cycles** and move **Basin by size** to inspect each cycle. **Run example seed** starts at generation zero and includes the first repeat when it fits within 512 rows.

Simulation and inference now share the same neighbourhood traversal, and both plots use the same timeline renderer. Loading a run also restores its applied random key, including after a pending edit in the form. The added tests check inference by replaying candidate rules, verify basin counts and distances by following every seed on small grids, and exercise the terminal and simulated workbench.
