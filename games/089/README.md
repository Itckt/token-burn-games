# Impulse Court

Impulse Court simulates bouncing balls on a top-down court with walls, fixed posts, and rounded rails. Watch an ASCII animation, save a repeatable experiment as JSON, or record positions and velocities as CSV. An optional offline canvas view lets you launch balls and draw your own rails.

## Run in the terminal

Run these commands from this folder with Node.js. The project uses only the standard library and was verified with Node.js 22.22.3.

```sh
node simulate.js
```

The default run prints the court after three simulated seconds. Each numbered ball has the same ID in the terminal, canvas, and JSON views. The measurements below the court show elapsed simulation time, impact counts, and total kinetic energy.

To watch six seconds of motion in your terminal, run the following. Playback ends after the requested ticks. Ctrl+C stops it early.

```sh
node simulate.js --animate --steps 720
```

To inspect the outcome of a partially elastic collision, run this experiment.

```sh
node simulate.js --scene mass-mismatch --elasticity 0.65 --steps 240 --format json
```

The JSON includes every ball’s center, velocity, radius, and mass, along with the court dimensions and measurements. Use `--steps 0` to see the starting conditions. The same options reproduce the same trajectory.

| Scene | What to watch |
| --- | --- |
| `kowloon-six` (default) | Two trios cross paths after class at HKBU in Kowloon Tong. Follow one ball through successive impacts. |
| `mass-mismatch` | A small ball meets a ball with twice its radius and four times its mass. Compare their velocities before and after contact. |
| `opening-break` | A moving ball strikes a triangular rack of six stationary balls. Follow the transfer of kinetic energy. |
| `turnstile-slalom` | Three balls weave between fixed circular posts. |
| `bank-shot` | Compare rebounds off a sloping rail and a rounded end. |
| `return-lanes` | Time two equal shots as they return from rails with different elasticity. |
| `practice-draw` | Replay a seeded layout with six balls and three posts. |

`--steps` accepts a nonnegative integer and defaults to 360. Each tick lasts 1/120 second. `--elasticity` ranges from 0 to 1 and defaults to 1. `--format` accepts `ascii`, `json`, or `csv`. Run `node simulate.js --help` for the option list.

## Interactive court

On a machine with a graphical display, open `index.html` as a local file. It reads the scripts and stylesheet directly from this folder and uses the same physics engine as the terminal.

| Control | Action |
| --- | --- |
| Play / Pause or Space | Toggle playback. The court starts paused when reduced motion is enabled. |
| Step or the period key | Pause and advance exactly one physics tick. |
| Reset | Restore the selected scene with the current settings and clear its clock and impact counters. |
| Click or drag | Click an empty spot to place a stationary ball. Drag from a clear spot to launch in the drag direction. Longer drags increase speed up to 480 units per second. |
| Add a ball | Place a moving ball in a free spot using the button. |
| Elasticity / Playback speed | Adjust how much normal speed survives an impact, or change how fast simulated time passes. |
| Motion trails / Velocity arrows | See recent paths or current velocity. Each arrow extends a quarter second of travel from the ball’s rim. |

## Physics

The default court measures 840 × 480 distance units, with the origin at the top left and positive y pointing down. With drag set to zero, balls move at constant velocity between impacts. Mass scales with area, so a ball of radius `r` has mass `(r / 20)²` by default. Total kinetic energy is the sum of `½ × mass × speed²` over all balls.

Within each tick, the engine calculates when each ball would reach a wall and solves the relative-motion quadratic for every approaching pair. It advances to the earliest contact, applies the impulse, and continues through the rest of the tick. A fast ball can hit several objects during a single tick.

The collision impulse acts along the line between the centers. Tangential velocity is preserved. At elasticity 1, an isolated pair conserves momentum and kinetic energy. At 0, the balls leave contact with equal normal velocities. Fixed surfaces reflect the normal component using the court elasticity unless the surface has its own setting.

An impact at a corner counts once per wall. Simultaneous contacts are processed in stable ball order, and each contacting pair or wall face counts once at that instant. If a jammed group keeps exchanging impulses at the same instant, it settles using its center-of-mass velocity subject to the walls. Balls in a straight jam can still slide along their common tangent. New balls need a clear position inside the walls.

## Run the tests

```sh
node run-tests.js
```

The suite uses Node’s built-in test runner in a single process. It checks analytical collision outcomes, high-speed crossings, corner and simultaneous contacts, unequal masses, conservation laws, and long seeded runs. It also exercises all presets, CLI formats, argument errors, and terminal playback.

Interface tests execute the page scripts against a recording canvas and a manually advanced clock. They compare drawn ball positions and measurements against an independent engine run, and exercise pointer launches, keyboard controls, display settings, and pause/resume behavior entirely from the command line.

## Round 2

### Fixed bumpers

`turnstile-slalom` sends three balls through a set of gates on the walk from HKBU to Kowloon Tong station. The posts are marked B1, B2, and B3 in both views. Each stays fixed during a collision. A ball keeps its speed along the tangent, and elasticity controls its rebound perpendicular to the post. Bumper impacts have their own counter.

```sh
node simulate.js --scene turnstile-slalom --steps 120 --trace
```

Ball 3 reaches B2 first, about 0.284183 seconds into the run. To build another layout in Node, call `world.addBumper({ x, y, radius })` on a `World`. Launches and automatic placement both check for clearance around the posts.

### Inspect an impact

On the canvas, **Next impact** pauses playback and advances every ball to the next contact, even between ticks. At a corner it resolves both wall hits. **Recent impacts** shows the last six contacts, newest first.

In the terminal, `--trace` adds a chronological list below the ASCII court. With `--format json`, each entry in `impacts` gives the absolute simulation time in seconds, the contact point `x, y`, the `ballId`, and one of `wall`, `bumperId`, or `otherBallId`. Each contact is listed once at that instant, even when the solver applies several impulses.

### Save and resume a court

```sh
node simulate.js --scene turnstile-slalom --elasticity 0.7 --steps 117 --format json > court.json
node simulate.js --load court.json --steps 243 --trace
```

These commands continue the same experiment to tick 360. A checkpoint preserves the clock, impact counters, numbered bodies, and elasticity. `--steps` counts additional ticks, and the trace covers those ticks. Use `--load -` to read a pipeline or pass `--elasticity` on the second run to try a different rebound from the saved positions. JSON exports from the original three presets also work.

The canvas shares this format. Under **Checkpoint JSON**, **Capture** fills the text box with a snapshot you can copy. Paste a snapshot and choose **Restore** to pause at its saved instant. Reset returns a named scene to its preset. For a checkpoint without a recognized scene name, Reset uses the imported positions and velocities with a fresh clock and counters.

### Regression coverage

Fixed ticks and next-impact stepping now share the same contact resolver. New tests cover oblique rebounds, balls wedged against posts, corner hits at fractional timestamps, and exact continuation across checkpoint boundaries. They also cover slow collisions that previously lost precision, multi-character IDs at the ASCII border, rendering very small balls, and releasing a drag after the canvas collapses.

## Round 3

### Build a bank shot

```sh
node simulate.js --scene bank-shot --until ball:1 --steps 240 --trace
```

Two balls clip rounded ends before ball 1 reaches the flat face of R1 at **0.895833 s**. Its incoming velocity is `(240, 0)` and its rebound is `(67.2, -230.4)`. A rail reflects the velocity perpendicular to its surface and preserves the component along it. The contact point on a round end determines the rebound direction.

On the canvas, select **Draw a rail** under **Canvas tool** and drag between its endpoints. The full rail needs clearance from balls, posts, other rails, and the court edge. In Node, call `world.addRail({ x1, y1, x2, y2, radius })`. The radius is half the thickness and defaults to 8. Checkpoints preserve the rails and their impact counter. Traces identify each struck rail by `railId`.

### Pause on a chosen collision

Open **Recent impacts** and choose a target under **Pause playback on**. Play pauses at the first match, including between ticks. At a corner the simulation resolves both wall contacts before pausing. Play continues from the rebound, and Step still advances a full tick.

In the terminal, `--until` accepts `any`, `pair` for any ball-to-ball hit, `ball:ID` for either participant, `bumper:ID`, `rail:ID`, or a wall such as `wall:left`. The other sides are `right`, `top`, and `bottom`. The run ends at the match or at the `--steps` limit. With JSON output, `stop.impact` holds the matching event, or `null` when the tick budget expires. The result can go straight into `--load -` to continue.

### Record trajectories as CSV

```sh
node simulate.js --scene bank-shot --steps 240 --format csv --sample-every 30 > bank-shot.csv
```

This records all three balls every quarter second. Each row gives the sample number, absolute time in seconds, ball ID, center coordinates, velocity components, speed, and that ball’s kinetic energy. Filter by `ballId` and plot `x` against `y` to see the banks.

`--sample-every` takes a positive tick count and defaults to 120. Sample 0 records the starting state. The final sample captures the exact end, including a partial interval or an early collision stop. An immediate collision produces two samples at the same time with the incoming and outgoing velocities. An empty court produces the column headings alone.

### Replay a practice draw

```sh
node simulate.js --seed 852 --drag 0.4 --steps 120 --forecast 2 --format json
```

Share a practice seed between classes at HKBU to give both trios the same starting spots and posts. Seeds range from 0 to 4294967295. The canvas **Deal court** button uses the seed shown, and Reset replays that deal. A checkpoint carries both the seed and the drag setting.

Linear drag of `k` per second multiplies free-flight speed by `exp(-k × seconds)`. A slowing ball can run out of range before reaching another surface. **Trajectory forecast** and `--forecast ID` follow the selected ball for up to two seconds on a copy of the court. Forecast points mark impacts and the end of the path. If the court reaches 128 collision instants first, the forecast reports the shorter interval.

The tests now cover rail faces, rounded ends and their joins, stopping during a multi-contact collision, and CSV sampling across checkpoints. Regression tests also check slow drift below the precision of a position coordinate and automatic placement on very wide courts.

## Round 3 — Timing and rebound experiments

### Time a return trip

```sh
node simulate.js --scene return-lanes --steps 480 --trace
```

Both balls pass gate G1 at **1.000 s** and reach their rails at **2.000 s**. The upper ball returns through G1 at **3.000 s** at 240 units/s. The lower rail returns half the incoming speed, so the lower ball crosses at **4.000 s** at 120 units/s.

Choose **Draw a timing gate** on the canvas, or add one to any CLI run with `--gate X1,Y1,X2,Y2`. You can draw through balls and obstacles. A gate times the ball's center anywhere along the segment, including either endpoint. The arrow points forward. For a gate drawn from top to bottom, forward is rightward. Arrival at the line counts once, even at a rebound. Starting on the line or traveling along it adds no crossing.

The **Timing gates** panel shows both directional totals and the latest six readings. ASCII traces show crossing times and speeds alongside impacts. JSON with `--trace` puts the new readings in `crossings`, with absolute time, gate and ball IDs, direction, position and incoming velocity. The engine measures each straight flight between collisions, including several crossings in one tick. With drag, it computes the elapsed time and velocity at the gate.

### Tune a single surface

```sh
node simulate.js --scene return-lanes --surface rail:2=0.75 --steps 480 --trace
```

The lower ball now returns at **3.333333 s** at 180 units/s. Under **Surface elasticity**, choose a wall, post or rail and enter a value from 0 to 1. A blank field restores the court setting. The CLI accepts `wall:SIDE`, `bumper:ID` and `rail:ID`. For example, `--surface rail:2=default` makes R2 follow the global elasticity again. Each face at a corner uses its own value.

### Give a ball a measured push

For a study break at HKBU, give a classmate the lower lane and one push to tie the return trip. This run stops at the rail, adds momentum to ball 2, then records both balls crossing G1 together at **3.000 s**.

```sh
node simulate.js --scene return-lanes --until rail:2 --format json | node simulate.js --load - --impulse 2,-97.2,0 --steps 120 --trace
```

`--impulse ID,JX,JY` adds horizontal and vertical momentum at the starting clock time. Ball 2 has mass 0.81. The horizontal impulse of −97.2 changes its velocity from −120 to −240 units/s. The **Ball impulse** panel applies the same operation to the live court and pauses at that instant. A push into a touching surface resolves on the next physics step.

The three CLI edits can be repeated. Checkpoints preserve the resulting velocities, surface settings and cumulative gate counts. On the canvas, Reset restores the preset or imported layout and clears its measurements.

In Node, use `world.addGate({ x1, y1, x2, y2 })`, `world.setSurfaceRestitution('rail:2', 0.75)` and `world.applyImpulse(2, -97.2, 0)`. Pass `null` as the surface value to restore inheritance. Collect individual readings in a `crossings` array with `world.step(seconds, { crossings })` or `world.nextImpact(crossings)`.

Headless regression tests cover gate endpoints, high-speed repeat crossings, drag-limited travel, mixed-elasticity corners and checkpoint continuation. They also check that very soft collisions retain small, representable rebound speeds for ball pairs, posts and rails.
