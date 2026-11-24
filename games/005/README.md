# Inside the noodle cup

A 45-second interactive 3D lesson about a small packaging decision. A cutaway exposes the dry noodle block, the tapered wall that holds it, and the air beneath it. Follow that pocket through a bump in transit, a pour of hot water, and the loosening of individual strands.

## Run the lesson

Keep `index.html`, `style.css`, and the `js` folder together. Double-click **index.html** in a browser with WebGL enabled, then choose **Play lesson**. The page opens paused so you can inspect the first cutaway. Everything loads from the folder, including the original cup artwork. No installation, server, or build step is required.

If WebGL is unavailable, the page explains the problem and keeps the five captions, labeled cross-section diagrams, timeline, and chapter controls available.

## What to watch

| Start | Chapter | Detail to look for |
| --- | --- | --- |
| 0:00 | The air gap | The bracket spans the space between the floor and the underside of the dry block. |
| 0:08 | The snug fit | The block lifts and settles. Follow the seating line to see where the narrowing walls catch its edges. |
| 0:17 | In transit | The block moves with the cup. A knock flexes the base into the clearance below the brittle strands. |
| 0:25 | The pour | Water trickles through the curls into the lower pocket. The rising level wets the underside before covering the top. |
| 0:36 | The steep | The curls hydrate and spread into the former air gap. Watch the strand label follow the same noodle as it moves. |

The timeline compresses the changes so they are easy to compare. The heights, motions, and water flow illustrate this tapered cup design.

## Controls

| Action | Mouse or touch | Keyboard |
| --- | --- | --- |
| Play, pause, or replay | Playback button | Space |
| Change chapter | Chapter card or previous/next button | Left / Right arrow or 1–5 |
| Seek within a chapter | Drag the progress slider | Focus the slider and use its arrow keys |
| Orbit the model | Drag across the cup | A / D to turn, W / S to tilt |
| Zoom | Scroll or pinch | − / + |
| Inspect the wrapper | Select **Exterior** or **Cutaway** | C |
| Return to the current chapter’s camera angle | Reset button on the model | R |
| Open or close help | **Controls** or the close button | ? to open, Esc to close |

Manual framing carries across chapter changes. Opening help or switching to another tab holds the lesson clock. The camera respects the reduced-motion setting.

## Run the tests

From this folder, run the following command with Node.js. It uses the built-in test runner in a single process and works in shells that restrict child processes.

```sh
node tests/run.cjs
```

The suite exercises the actual page scripts with a small event and graphics-call recorder in Node. It checks the five captions, a complete 60 Hz playback, scrubbing, mouse and touch controls, context loss and restoration, and the illustrated fallback. Geometry tests check strand-to-wall contact, clearance, hydration, camera framing, and a sight line through the opening. Rendering tests check shader source structure, precision agreement, buffer bounds, drawing order, and local asset references. Verification uses Node 22.22.3 and runs entirely from the command line.

## How the model works

- `js/math.js` implements the vector operations, column-major transforms, camera projection, and damping.
- `js/meshes.js` builds the paper shell, curled foil, swept noodle strands, toppings, and water. Each strand has corresponding dry and hydrated positions and normals.
- `js/lesson.js` maps a time to a caption, water level, impact, and hydration state. Scrubbing backward reproduces the same physical pose.
- `js/renderer.js` uploads the meshes once per graphics context, generates the sleeve texture locally, and blends the two strand poses in a WebGL vertex shader. Capped pixel density and on-demand frames support the 60 fps target. Actual frame rate depends on the device.
- `js/diagram.js` draws the chapter cross sections. `js/app.js` handles playback, projected labels, input, and the responsive canvas.

## Round 2

### Try a different block

Choose **Packing bench** or press **B**. The slider changes the diameter of the dry noodle block in a fixed cup. The bench measures the generated strands and lowers the whole block until a curl touches the lining or the floor. The contact line and clearance bracket show where it stops. The model uses a floor-to-rim depth of 100 mm as its reference scale.

| Block diameter | Clearance below | First support |
| --- | --- | --- |
| 72 mm | 0.0 mm | Cup floor |
| 88 mm | 34.0 mm | Sloping wall |
| 94 mm | 51.5 mm | Sloping wall |

Use the slider’s arrow keys for 1 mm changes. **Guided lesson** returns to the same playhead, camera angle, and model view. Playback resumes if it was running when you entered the bench.

### Trace the rising pool

In **The pour** or **The steep**, choose **Trace immersion** or press **T**. Amber strands sit above the mean waterline. Teal strands sit below it. A curl can show both colours along its length. **Underside** and **Top** turn on the trace and pause at the instant the pool reaches the lowest or highest dry curl. This traces immersion in the pooled water. The falling stream can wet the top earlier.

The cross section now follows the playhead through the lift, base flex, pour, and steep. Scrub backward to compare two instants. If WebGL is unavailable or interrupted, the same live drawing moves into the main stage. Both the slider experiment and the waterline stops work there.

### Check an explanation against the model

Below the chapters, **Check your understanding** has three questions about fit, transit, and immersion. Each answer gives specific feedback. Use **Try the narrow block**, **Freeze the bump**, or **Trace the waterline** to inspect the evidence. Answers stay with their questions while you explore. After all three are correct, **Try all three again** clears the answers.

### Implementation and verification

`js/packing.js` derives the seating transform and cross-sectional outline from the dry mesh. Moving the slider reuses the uploaded meshes. `js/callouts.js` handles projected labels, and `js/checks.js` manages the questions. The diagram reuses its canvas between frames, and the player stops scheduling frames when a paused view settles.

The expanded Node suite checks every selectable diameter against the strand vertices, the transition between floor and wall support, and the two waterline stops against the fill curve. It exercises quiz retries, evidence buttons, hidden-tab timing, graphics loss during a drag, and restoration from the enlarged diagram. Mesh builders now reject invalid indices and malformed strand paths before they can produce broken triangles.

Run `node tests/run.cjs` from this folder. The tests exercise the shipped scripts and inspect recorded graphics calls entirely in Node.

## Round 3

### Look through a horizontal slice

Choose **Scan the air gap** in the opening chapter, or open **Packing bench → Slice scanner**. Move the violet sheet from the floor to the rim in 1 mm increments. **Mid-gap** passes underneath the suspended block. **Mid-block** reveals gold contours wherever the plane crosses a dry noodle.

The plan and side views share a 20 mm scale bar. The plan traces intersections with the same triangles you see in 3D. The side view locates the sheet against the fitted block and tapered wall. Try holding the sheet at 51 mm and changing the block diameter from 88 to 94 mm. The section goes from noodles to air as the larger block seats higher.

### Measure how much water fits underneath

Open **Packing bench → Metered pour**. Add water in 1 mL increments, or choose **Fill to underside** to reach the exact first contact, including the last fraction of a millilitre. The meter measures the space from the cup floor to the lowest dry curl. Water can rise between strands beyond that point in the guided pour.

| Dry diameter | Depth at first contact | Water below the lowest curl |
| --- | --- | --- |
| 72 mm | 0.0 mm | 0.0 mL |
| 77 mm | 1.8 mm | 6.9 mL |
| 88 mm | 34.0 mm | 148.9 mL |
| 94 mm | 51.5 mm | 243.1 mL |

For a quick HKBU field note, try the same 50 mL dose with the 88 mm and 94 mm blocks. Both pools reach 12.5 mm because the cup is the same. The wider block leaves more air above the pool. If you narrow the block until the pocket holds less than your dose, the meter stops at its new capacity.

### Replay a movement at study speed

The **Speed** menu offers ¼×, ½×, 1× and 2× playback. **Repeat step** or **L** loops the current chapter. Selecting a different chapter or scrubbing into it moves the loop there. In **In transit**, **Repeat the bump at ¼×** opens the cutaway and replays the movement slowly enough to follow the flexing base. Help, the packing bench and a hidden tab all hold the lesson clock.

### Implementation and checks

`js/slices.js` intersects the seated dry mesh with a horizontal plane. `js/packing.js` computes the volume of the tapered pocket and inverts it to find the water height for a dose. The bench controls now live in `js/bench.js`. The renderer, illustrated instruments and restored graphics context share one measured noodle specimen. Moving either instrument reuses the uploaded geometry.

The diagram now updates its labels as soon as a pour or wall contact changes, and the timeline thumb stays inside the active chapter through its last frame. If Canvas 2D is unavailable, text gives the instrument reading and a striped sleeve keeps the WebGL model usable. If WebGL is interrupted, the enlarged drawing follows the selected instrument.

Run `node tests/run.cjs` for the full suite. It checks slice intersections against transformed noodle triangles, calibrates both diagram views against the ruler, and verifies the meter against an independent volume calculation at all 23 diameters. Playback and interface tests cover repeat boundaries, fractional doses, floor contact, graphics recovery and the text fallback.

## Round 4

### See how the walls carry the weight

In **The snug fit**, choose **See the support forces**, or open **Packing bench → Support forces**. The arrows on the cutaway show the directions of weight and support. The cross section resolves the support into upward and inward forces, measured in newtons. Its two bars share a scale.

This experiment treats the block as rigid and the two opposing walls as smooth, symmetric supports. With the original taper and an 88 mm block on the bench, an 80 g test mass weighs 0.78 N. Each wall pushes with 2.56 N, of which 0.39 N points upward. The inward components cancel and the upward components carry the weight. Straighten the walls and the block settles on the floor, which supplies the full upward reaction.

For an HKBU lunch-break check, halve the test mass to 40 g. Both force bars shrink by half while the seating height stays the same.

### Measure where the softened curls go

In **The steep**, choose **Inspect the steep → Original air gap**. A dashed line on the lining marks the packed underside. Hatching appears on the parts of each curl that descend below it. The bracket measures the deepest reach into the former pocket. The waterline trace can stay on during this comparison.

| Pose | Reach into the original gap | Clearance left above the floor |
| --- | --- | --- |
| Packed | 0.0 mm | 34.3 mm |
| Half the gap | 17.2 mm | 17.2 mm |
| Loosened | 29.7 mm | 4.6 mm |

These are rounded readings from the guided specimen. **Half the gap** pauses at the first instant any strand surface reaches half the original depth. Scrub backward and the same curls cross the mark in reverse.

### Pause at the evidence

Turn on **Observation stops** or press **O**. A diamond on the timeline marks the current chapter’s stop. Playback pauses at the empty pocket, the return to the seating line, a flex of the floor, the pool’s first contact with the underside, and the halfway crossing during the steep. Each stop has a caption with a measurement from the model. **Continue lesson** resumes playback. **Go to stop** jumps there directly. With **Repeat step** on, the stop returns on the next lap.

### Implementation and verification

The playback controls now share one clock for speed, repeat and observation stops. The force diagram and other bench instruments share the seated-block outline. The guided mesh flattens protruding dry curls against the lining, and the flexing floor has interior rings so the surface follows the bracket during a bump. The scanner uses finer increments for sub-millimetre pockets. The wall map and transit test display **<0.1 mm** for a small positive clearance.

Run `node tests/run.cjs` from this folder. The Node tests check force balance across every selectable fit, compare the steep readings with the animated mesh, and exercise slow playback, long frames, repeat boundaries, scrubbing and graphics recovery. The instruments and observations also work in the illustrated and text-only fallbacks.
