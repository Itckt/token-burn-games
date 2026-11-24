# Loop Foundry

Loop Foundry is an offline 3D marble-run workshop. Snap together ramps, banked corners, gap jumps, powered strips and full vertical loops. Choose a striped marble, set its launch speed and race your best time to the chequered flag.

## Open the workshop

Keep `index.html`, `style.css`, and the `js` directory together. **Double-click `index.html`** in a modern browser with WebGL enabled. All geometry, shaders, interface icons, and piece previews are generated locally. The page runs directly from disk.

1. Open **Kowloon Switchback**, the starting layout. Leave **Launch speed** at **10 m/s** and click **Drop marble**. The marble drops from the gate, descends two ramps, and rolls upside down through the loop.
2. Try **5 m/s** on the same course and watch where the marble loses contact. Drag the scene to see the gap between the loop entrance and exit.
3. Choose **Layouts → New blank track** to build your own. Each library piece snaps in at **Build at**, which starts at the finish. **Undo** restores the previous layout, including after a preset change.

Between lectures at HKBU, try sending three different finishes down the Kowloon course about two seconds apart. A clean trio earns a milk tea break.

## Controls

Open **Controls** in the top bar for the in-page guide. Click or tab to the 3D view for shortcuts. Focused buttons support Enter and Space, and the speed slider supports the arrow keys.

| Action | Control |
| --- | --- |
| Drop the selected marble | **Drop marble** or **Space** |
| Pause or resume | Pause/play button or **P** |
| Play at quarter, half or normal speed | **Playback** in **Marble setup** |
| Advance a paused run by 1/60 s | **Step** or **.** |
| Start a three-marble pace heat | **Time trials → Start heat** or **H** |
| Clear marbles and scores | Circular arrow beside pause or **C** |
| Add straight, ramp, left bend, right bend, loop, S-bend | Click a card or press **1–6**, respectively |
| Add a drive strip / brake strip | Click a card or press **7 / 8** |
| Add a gap jump | **Gap jump** card or **9** |
| Change the release height | Enter **Gate height** under **Build**, then **Apply** or **Enter** |
| Review the last completed attempt | **Time trials → Replay last run** or **R** |
| Inspect a replay | Drag its timeline, use **P** to play or pause, or **.** to step while paused |
| Return to the live run | **Back to live**, **R** or **Escape** |
| Show or hide the best-run ghost | **Race best ghost** in **Time trials**, or **G** |
| Copy or open a portable track code | **Layouts → Track blueprints…** |
| Force an uphill ramp | **Shift-click Ramp** or **Shift+2** |
| Select an insertion point | Tap a piece in the scene, click the **Course profile**, or choose a section under **Build at** |
| Reorder the selected piece | **Earlier** or **Later** beneath the profile |
| Remove the selected piece, or the last piece when appending | Remove button or **Backspace** |
| Undo / redo a track edit | History buttons, **Ctrl/Cmd+Z**, **Ctrl/Cmd+Shift+Z** |
| Orbit | Drag with one pointer or use the **arrow keys** |
| Zoom | Mouse wheel, two-finger pinch, or **+ / −** |
| Fit the entire course | Fit button or **F** |
| Switch viewpoint | Camera menu at lower left |
| Follow a marble or return to the full course | **Follow marble** in the camera menu, or **V** to toggle |
| Open / close keyboard help | **? / Escape** |

The blank layout includes a release gate and a finish bay. Add up to **48 pieces** between them. A downhill ramp stops at the minimum track height of 0.9 m. Placing another ramp there makes it climb. The length readout measures the full centreline, including the gate and finish bay.

The marble at the release gate previews the next queued heat entrant or the selected finish for a solo drop. Up to **24** released marbles can share a run. An occupied gate holds the next drop. Cross the blue halfway gate and the chequered line going forward to finish. The counter records each finish once, and the bay collects the marble shortly afterwards. A track edit starts a fresh run and clears its score. The layout and its undo history live in the current page session. A blueprint code lets you keep the layout for another session.

## Physics and rendering

Each marble is a solid sphere with position, linear velocity, angular velocity, and quaternion orientation. Gravity acts at **9.81 m/s²**. The solver advances velocities and positions in fixed **1/180-second** steps. Normal impulses resolve impacts. Friction impulses at the point of contact turn sliding into rolling, visible in the painted stripe.

The collision surface uses the same sampled channel profile as the visible track. A spatial grid narrows each sphere query to nearby triangles. The solver finds the closest point on each candidate face, edge, or corner and also handles sphere-to-sphere impacts, end stops, and the tabletop. An underpowered marble can stall or fall out of a loop. A fast one can overshoot a ramp or escape a bend.

The raw WebGL renderer draws indexed meshes with directional lighting, filtered shadows, and procedural marble finishes. Piece previews use the same track geometry. The animation loop targets 60 fps with interpolated marble poses, an eased orbit camera, a bounded drawing resolution, and cached shadows. Frames stop when the camera settles and both the simulation and replay are idle. The page holds their clocks while hidden and restores the scene after a recoverable WebGL context loss.

## Run the tests

From this folder, use Node.js 22 or newer and run

```sh
node tests/run.js
```

The suite uses Node's built-in test runner, assertions, filesystem, and VM in a single process. It checks vector and matrix conventions, mesh indices and normals, piece joins, camera framing, edit history, collision impulses, rolling, fixed-step timing, marble collection, and complete runs through all four named layouts.

The integration tests load the scripts in the order declared by `index.html` and drive the actual workshop handlers with a small in-memory DOM and a recording WebGL context. They verify draw calls, buffer ownership, shader source structure, keyboard and pointer controls, scoring, and graphics recovery. GPU rasterization and display frame rate require a real graphics driver to measure.

## Source map

| File | Responsibility |
| --- | --- |
| `index.html`, `style.css` | Workshop layout, responsive controls, and help |
| `js/math.js`, `js/camera.js` | Vector, matrix, quaternion, framing, orbit and follow calculations |
| `js/track.js` | Parametric pieces, cross sections, layouts, and undo/redo |
| `js/mesh.js` | Indexed channels, track hardware, flag, and spheres |
| `js/physics.js` | Spatial indexing, rigid-body contacts, fixed stepping, and scoring |
| `js/trials.js` | Swept timing gates, recent finishes and best-run records |
| `js/replay.js`, `js/replay-panel.js` | Pose recording, ghost interpolation, replay transport and speed plot |
| `js/heat.js` | Pace lineups, staggered releases and heat standings |
| `js/blueprint.js` | Portable track codes and layout validation |
| `js/render.js`, `js/icons.js` | WebGL programs, shadows, previews, and canvas-drawn interface icons |
| `js/picking.js`, `js/scene-input.js` | Ray intersections with track meshes, tap selection, orbit and pinch gestures |
| `js/build-panel.js` | Course profile, piece selection and library controls |
| `js/panels.js` | Timing board, heat standings, bench tabs and blueprint controls |
| `js/app.js` | Workshop controls, simulation clock, and graphics lifecycle |
| `tests/` | Command-line test suites and their test doubles |

## Time trials and blueprints

**Try Lion Rock Relay.** Open it from **Layouts**, select **Time trials**, set **5 m/s** and drop a marble. The drive strip carries it through the loop. The brake strip slows it for the bend. A solo run takes about **10.15 s**. After it finishes, try **8 m/s**. Watch the stippled mint ghost and check how much of your lead at halfway survives the last two corners.

- **Active track pieces.** The chevrons on a drive strip mark a powered bed that builds forward speed toward 12 m/s. The paired bars on a brake strip slow a fast marble toward 4 m/s in either direction. Both act through contact with the centre bed. Their impulses change forward velocity and rolling spin together. An airborne marble coasts over them.
- **Time trials.** Every course gets a blue split gate halfway along the centreline from release to flag. Each marble has its own clock. The board shows the newest drop, its split, the course best and the three most recent finishes. A table landing or a 90-second timeout ends an attempt. Crossing times are interpolated within the physics step.
- **Best-run ghost.** Each new drop can race the fastest completed run available at launch. The ghost follows a path sampled 30 times per simulation second, including the exact finish position. It shares the pause control and takes up zero marble slots. **G** toggles its visibility. Clearing marbles or editing the layout resets the timing board and ghost.
- **Portable blueprints.** In **Layouts → Track blueprints…**, choose a name for the exported copy and use **Copy code**. Paste a code into **Open a track code** to load the whole layout as one undoable edit. The code preserves piece order, forced uphill ramps and release height. If clipboard access is restricted, the page selects the code for your device’s Copy command. The relay’s complete code is `LF1/4/DPOBLSR/Lion Rock Relay`.

The physics step now handles motion and contacts before reading the timing gates. A marble parked in the finish bay or crossing the line backwards can no longer earn a finish. Resuming uses the held pose for both the marble and its ghost. Failed shader and program allocations are released before a graphics retry.

The expanded Node suite covers powered contact on rotated tracks, gate direction and order, sub-step finishes, overlapping attempts, ghost playback at different refresh rates, and blueprint round trips and rejection. The workshop tests also exercise clipboard fallback, undo after import and a race that survives graphics recovery.

## Round 2

For a quick race between classes in Kowloon Tong, open **Lion Rock Relay**, set **7 m/s**, focus the scene and press **H**. The 5, 7 and 9 m/s marbles all clear the loop. The last marble to leave the gate wins on elapsed time in about **9.70 s**.

- **Edit the middle of a course.** The elevation profile plots channel height against distance travelled, so a loop shows its full climb and descent. Click a section or choose it under **Build at** to highlight the matching piece in 3D. Cards insert before the highlight, in the order you add them. Move it with **Earlier / Later**, remove it with **Backspace**, or choose **Finish** to resume appending. Each layout change is one undoable edit. Selecting a piece keeps the current race running.
- **Run a pace heat.** The three entrants use the chosen speed and the speeds 2 m/s to either side, within the gate’s 0–16 m/s range. The lineup locks when the heat starts. Releases use two seconds of simulation time between entrants. If the gate or all 24 slots are occupied, the next entrant waits up to four extra simulation seconds. A missed start appears as **Gate blocked**. The board ranks finishers by their own elapsed times and shares places for times equal to the millisecond. Clear or edit the course to cancel a heat.
- **Follow the action.** Press **V** for a close-up of the newest marble still racing. The camera eases around bends with a level horizon, and the readout shows the marble’s speed and height above the table. Drag or zoom during the chase. After collection the camera returns to the gate. **F** fits the whole course.
- **Inspect a tumble.** Select **¼×** or **½×** under **Playback** to watch a marble lose contact with the loop. Pause and use **Step** or **.** to advance three physics ticks, exactly **1/60 s**. The marble, ghost, heat queue and timing gates all use that same simulation time.

The solver now updates the timing board once per physics tick, after resolving contacts for every marble. This fixes the crash on the first step after a drop and lets the board order simultaneous finishers by the instant each crossed the flag. Graphics recovery also preserves follow zoom and the held race clock.

The new Node tests cover middle edits at the 48-piece limit, profile picking, blocked and tied heats, releases between runs on an empty track, follow framing on portrait stages, and slow-motion and single-step timing. Page-level tests exercise the controls through real workshop handlers and recorded WebGL draws.

## Round 3

Try **Layouts → Podium Post**, a campus delivery run for an assignment due before lunch. At the original **4 m** gate height, a **7 m/s** drop falls short of the landing. At **10 m/s** the marble clears the gap and reaches the flag in **7.322 s**. Press **R** after either attempt to watch the takeoff again.

- **Build a gap jump.** Card **9** adds a curved takeoff and a sloping landing deck with **2 m of open air** between them. Striped lips mark the edges. A short jump can strike the exposed end of the landing. A halfway gate in the gap stands on its own posts. The preset’s blueprint is `LF1/4/SJSBLS/Podium Post`.
- **Pick a piece in 3D.** Tap the visible surface to highlight the piece and set **Build at**. The nearest track surface wins where pieces overlap. Tap the release bay to build at the start, or the tabletop or finish bay to append. Selection keeps the current run and its scores.
- **Adjust the gate.** Enter a height from **0.9 to 12 m** and choose **Apply**. The profile and downstream ramps rebuild together. The change takes one undo step, and blueprints retain fractional heights.
- **Review a run.** Finishes, table landings and timeouts each leave a replay of the most recently ended attempt. The speed graph marks the halfway crossing in gold. Scrub to see the marble’s stripe, speed and height, or use slow motion and **Step** to inspect a landing. **Back to live** restores the race and its heat queue at the instant you left them.

The live renderer now interpolates rotation and position together, keeping the stripe in step with the rolling marble. Replay and ghost playback share the same 30 Hz position samples and exact endpoint. Node tests cover free flight, impacts against both jump lips, picking an inverted loop, precise seeks, and a heat held through replay. A graphics-recovery test checks the displayed replay pose after restoration.
