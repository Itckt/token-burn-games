# Twistlab

Twistlab is an offline 3D simulator for a 3 × 3 × 3 twisty cube. Drag to inspect it, click its faces to turn them, or watch the automatic solver rotate one layer at a time. The move strip highlights the current step so you can follow the notation on the cube.

## Run

Keep `index.html`, `styles.css` and the `js` folder together. **Double-click `index.html`** to open the simulator in a WebGL-enabled browser. All scripts, geometry and shaders load locally. Opening the page requires only a browser.

The first view has an eight-turn starter mix. Choose **Auto-solve** to see a solution immediately. Choose **Pause** at any point, then **Next step** to finish just the current turn. **Resume** plays the remaining moves. The speed slider ranges from 0.5× to 2×.

## Controls

| Action | Mouse, touch or keyboard |
| --- | --- |
| Orbit | Drag across the viewport with the mouse or one finger. With the viewport focused, use the arrow keys. |
| Zoom | Scroll the wheel, pinch with two fingers, or press `+` and `−` in the viewport. |
| Turn a face | Click or tap a visible face, choose a face button, or press `U`, `R`, `F`, `D`, `L` or `B`. |
| Reverse a turn | Hold **Shift** while turning, or toggle **Prime** for subsequent turns. |
| Half turn | Toggle **Half** or press `2`, then turn a face. Toggle it again for quarter turns. |
| Track a piece | Alt-click a 3D corner or edge between turns, or choose its home letters under the face net. |
| Inspect the layers | Toggle **Explode** in the viewport to open gaps between pieces. |
| Practice a cross | Choose **Practice**, pick a target face and select **Show hint** for the next turn. |
| Keep a checkpoint | Pick one of the three slots and choose **Save position**. **Restore** brings back its cube and turn history. |
| Time a solve | Open **Time trials**, enter a challenge code and choose **Start trial**. The first manual turn starts the clock. |
| Scramble | Choose **Scramble** or press `S` for a fresh, animated 20-turn mix. |
| Solve, pause or resume | Use the playback button, or press **Space** with the viewport focused. |
| Undo | Choose **Undo** or press `Z` to reverse the last recorded turn. |
| Reset the puzzle | **Reset cube** clears the history and returns to solved, including during an animation. |
| Reset or expand the view | Use the icons in the viewport. **Home** restores the camera. **Esc** leaves the expanded view. |

The center tiles identify **U**p, **R**ight, **F**ront, **D**own, **L**eft and **B**ack as you orbit. A plain letter means a clockwise quarter turn when looking directly at that face. A prime mark reverses it. A **2** means a half turn and counts as one move. The turn count includes completed scramble, manual and solver moves. Undo removes the most recent entry. Reloading the page starts a new session.

For a quick drill between lectures at HKBU in Kowloon Tong, reset the cube and try `R U R′ U′`. Follow a corner through the four turns. Repeat the sequence six times in total and every sticker returns to its starting place.

## How it works

- **Cube model** (`js/cube.js`, `js/session.js`). Each of the 26 pieces has an integer position and orientation. During a turn, only the nine pieces in that layer rotate. The model commits the new positions when the animation finishes.
- **Solver** (`js/solver.js`). A two-phase search first orients the corners and edges and puts the four middle-layer edges in their slice. It then restores the permutations. A local worker builds and reuses its search tables. If the browser blocks workers, reversing the recorded turns gives an immediate fallback route. Every solution is checked on a copy of the cube before playback.
- **Graphics and input** (`js/math.js`, `js/mesh.js`, `js/renderer.js`, `js/viewport.js`). Hand-built beveled meshes, raised stickers and WebGL shaders provide the lighting and floor shadow. A ray from the camera picks the clicked face. Mesh buffers upload once per graphics context. Animation follows the display refresh rate and rendering sleeps when the cube and camera are still.

If the viewport reports that WebGL could not start, enable graphics acceleration in the browser and reopen the file. The face controls and move history also work while the 3D view is unavailable.

## Run the tests

From this folder, with Node.js 22 installed, run

```sh
node tests/run.js
```

The suite uses Node’s built-in test runner. It checks move conventions and inverses, long scramble invariants, solutions from positions with no recorded history, the actual worker source in a Node worker thread, and animation timing through pause, resume and reset.

It also loads the scripts from `index.html` in order and drives their real event handlers with a simulated clock. Geometry, ray picking, draw calls, shader interfaces, input gestures, local asset references and graphics-context recovery are checked entirely from the command line. GPU shader compilation and display frame rate depend on the browser and graphics driver.

## Round 2

- **Algorithm editor.** Choose **Algorithms**, enter a sequence and select **Play sequence** to animate it from the current position. The editor accepts compact or spaced face turns, straight or typographic primes, half turns and nested repeats such as `(R U R′ U′)6`. It counts expanded turns, points to the character that needs correction and supports up to 256 turns per sequence. **Invert** writes out the return trip one turn at a time. Try **Checkerboard** from a solved cube or **Kowloon shuttle** for a two-handed drill.
- **Playback review.** During a solution or an algorithm, drag **Review position** to inspect any completed turn. A focused slider also accepts arrow keys. Use **Previous step** and **Next step** while paused, or **Replay** after the last turn. **Keep position** lets you make your own next move. The turn count follows the position you are viewing, including any moves made before playback began.
- **Interactive face net.** All 54 stickers appear in an unfolded cross with the front face in the middle. Each cell shows its home letter. The counter tracks how many match their current center. Select any of the six grids to turn that face, including the hidden sides of the 3D cube. Shift and Prime work here too. The net updates when a turn commits and remains playable when WebGL is unavailable.
- **3D sticker letters.** Toggle **Aa** in the viewport to follow individual stickers by letter as their pieces rotate. An original six-letter texture uploads once per graphics context. Toggling the letters uses the existing cube meshes and draw calls.

Solutions and custom algorithms now share the playback clock and move history. Fractional frames that add up to a full turn commit it on time. The renderer and face net share the same face directions. Invalid move batches leave the cube intact, and malformed or unreadable worker replies fall back to a verified route from the current history.

Round 2 ended with 73 tests. It added an independent sticker-grid model to check the net, forward and backward playback checks, notation and timing boundary cases, texture and context-restoration checks, and end-to-end tests of the new controls. Verification runs entirely in Node.

## Round 3

- **Repeatable time trials.** Try `3-HKBU` for a short mix between lectures. The number sets the scramble length from 1 to 20. After the hyphen, use up to 16 letters or digits. Anyone with the same code gets the same cube. **HK daily** selects a 12-turn code that changes at midnight in Hong Kong.
- **Timing and personal bests.** **Start trial** loads the mix. Take as long as you like to inspect it. Timing runs from your first manual turn through the completed turn that solves the cube, including time spent in another tab. Trial animations have a fixed pace. **Your turns** excludes the scramble. Each code keeps its fastest time to the hundredth, with fewer turns breaking a tie. Bests use local storage when available and stay in memory for the session when storage is restricted. **End trial** keeps the last completed position and restores Undo, algorithms and Auto-solve.
- **Piece tracking.** Choose one of the eight corners or twelve edges under the face net, or Alt-click it on the resting 3D cube. The body lights up as it turns, and rings identify its stickers on the net. The readout gives its current slot and the direction each sticker faces. Try tracking **URF** through the **Three corners** preset, then scrub backward. Choose **Off** or Alt-click the same piece to clear it.
- **Algorithm analysis and bracket notation.** As you type, **Effect from solved** counts the corners and edges that move or change orientation, and calculates the first repetition that restores all sticker colors. For example, `[R,U]` expands to `R U R′ U′` and takes six repetitions. The conjugate `[R:U2]` expands to `R U2 R′`. Both forms accept nested sequences and repeat counts within the editor’s 256-turn limit.
- **Manual half turns.** **Half** and the `2` key switch the face buttons, viewport, keyboard and net to 180° turns. Each counts as one move. Choosing **Prime** switches back to reverse quarter turns.

The editor, face net and solver worker now have separate controllers. Trial clocks update while the idle renderer sleeps. A trial stops on the first solved position even when more turns are queued.

Round 3 ended with **101 passing tests**. The new checks compare algorithm orders and piece locations with a separately simulated paper net, exercise the controls with a simulated clock, and cover Hong Kong midnight, blocked storage, interrupted trials and graphics-context recovery.

## Round 4

- **Cross coach.** Choose any face under **Practice**. Each of its four edge cards shows where that piece is. An edge counts as aligned when both stickers match their centers. Select a card to track the piece on the cube and net. **Show hint** gives the next move and the minimum number of face turns to finish the cross. Play the suggested turn or enter it yourself. A half turn counts as one. Hints resume when a time trial ends.
- **Three practice checkpoints.** Save a position with an optional name and a six-face thumbnail. A save made during animation or playback review captures the last completed turn. **Restore** returns to free play with that exact history, ready for Undo or Auto-solve. Slots survive reloads when local storage is available. The save message identifies session-only copies when storage is restricted. Try saving the starter mix as *Kowloon Tong warm-up* and building a different cross on each visit.
- **Exploded 3D view.** Toggle **Explode** to spread the pieces smoothly while keeping the cube in frame. Turn an outward face or Alt-click an exposed edge or corner to follow it. Picking uses the displayed spacing, including during the transition. Reduced-motion preferences switch layouts immediately. The renderer reuses its meshes and goes back to sleep when the motion finishes.

The cross coach and full solver share the same face-turn maps. The picker and renderer share one layout for all 26 pieces. Free scrambles now guard against sequences such as `(R U R U′)5`, whose 20 turns return every sticker to solved. Choosing **Simulator** also focuses the playable face net when WebGL is unavailable.

Run `node tests/run.js` for all **121 tests**. The new tests compare hint lengths with independent paper-sticker distances, including eight-turn crosses on every face. They also check checkpoint persistence, storage failures, interrupted playback, picking through gaps and graphics-context recovery. All verification runs in Node.
