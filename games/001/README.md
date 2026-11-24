# Campus Atlas

A first-person, low-poly walk through an imagined university campus in Kowloon Tong, Hong Kong. The original buildings draw on the shaded walkways, hillside views and student life around HKBU. From Banyan Court you can reach Jade Library, Meridian Tower and Lantern Arcade. Climb Kite Terrace, take a seat in Fern Garden or cross the water at Moon Gate Pool. Look for the student tactics club’s three-a-side notice under the arcade.

## Take a walk

Keep `index.html`, `style.css` and the `src` directory together. **Double-click `index.html`** in a modern browser with WebGL enabled. The scene loads directly from disk and works offline. All geometry, lettering, lighting and map graphics are generated locally.

Select **Start walking** to capture the mouse. Follow the terracotta lines toward the clock, or open the field guide and choose **Walk from here** for a different starting point. The live compass, map arrow and location card follow your position.

| Action | Control |
| --- | --- |
| Walk forward, left, backward, right | W, A, S, D |
| Walk faster | Hold Shift while moving |
| Look around | Move the captured mouse, drag the scene, or use the arrow keys |
| Start walking | Enter with the scene focused, or **Start walking** |
| Stop and release the mouse | Esc |
| Switch lighting | N, or **Day** and **Night** in the header |
| Toggle a rain shower | R, or the rain-cloud button in the header |
| Open the field guide | M, **Field guide**, or the small campus map |
| Select a destination | Choose its name or its numbered marker in the guide |
| Follow walking directions | Select **Route to press** in the field guide |
| Start a guided walk | Open **Field guide → Guided walks**, choose an itinerary and select **Start guided walk** |
| Continue after reading a stop | F, **Next stop**, or **Finish walk** at the last lookout |
| End a route | X, or the close button beside the directions |
| Collect a stamp within reach | E, or **Stamp notebook** |
| Open or put away the field camera | C, or the camera button in the footer |
| Find a photo study | Open **Field guide → Photo studies**, or use **Frame a study** at a brass lookout tile |
| Compose a postcard | Drag or use the arrow keys, then use + or − to zoom |
| Take and save a postcard | Space or **Take postcard**, then **Save PNG** in the preview |
| Toggle campus sound | V, or the sound button in the footer |
| Show controls / close a panel | ? for controls, Esc to close |
| Return to the opening viewpoint | **Reset view** |

On a touchscreen, select **Start walking**, hold a direction on the pad and drag the scene with another finger to turn. Mouse dragging and keyboard looking also work when the browser declines mouse capture. The system’s reduced-motion preference gives a steady walking camera and immediate lighting changes.

Daylight casts tree and colonnade shadows across the paving. At night the sky fills with stars, windows light up and twelve lanterns illuminate the paths. Switching the light preserves your position. If graphics are unavailable, the page shows a recovery message. If the browser restores an interrupted graphics context, the walk resumes at the same viewpoint.

## Run the tests

From this folder, run the following command with Node.js. The suite uses the Node standard library and was verified with Node **22.22.3**.

```sh
node tests/run.js
```

The runner executes all `*.test.js` suites in one process, prints each result and returns a failing exit code if an assertion fails. It runs entirely in the terminal.

- Math and mesh tests cover camera transforms, projection, normals, winding, primitive dimensions and deterministic generation.
- Simulation tests cover movement at different refresh rates, mouse smoothing, wall sliding, collision clearance, lighting transitions and reduced motion.
- Campus tests find walkable routes to all seven approaches, through the arcade, into the pavilion, up the terrace ramp and across Moon Gate Pool. Rays through the generated triangles check the water surface, gate opening and views from the photo lookouts.
- Integration tests load the actual HTML’s script sequence in Node, exercise the controls and both maps, and simulate graphics failure, retry and restoration. A recording WebGL interface checks shader interfaces, draw ranges, depth state, texture sizes and uploads. Pixel output, driver compilation and achieved frame rate depend on the browser and GPU.

## How it works

| Files | Responsibility |
| --- | --- |
| `src/math.js`, `src/mesh.js` | Vector and matrix operations, seeded randomness and faceted mesh primitives |
| `src/places.js`, `src/terrain.js` | The landmark catalogue, stamp designs, surface materials and walking elevations |
| `src/architecture.js`, `src/campus.js` | Building facades, clock faces, hills, trees, furniture, signs and collision shapes |
| `src/moon-pool.js` | Moon gate masonry, reed basins, causeway and water geometry |
| `src/simulation.js` | Ground movement, collision substeps, damped camera motion, light transitions and landmark proximity |
| `src/collision.js`, `src/navigation.js` | Player clearance, continuous checks along a walking segment, route planning and live turns |
| `src/notebook.js`, `src/field-guide.js` | Stamp reach and storage, notebook artwork, guide selections and walking directions |
| `src/walks.js`, `src/guide-sections.js` | Guided itineraries, arrival and progression, route previews and the study album |
| `src/weather.js` | Shower transitions, rain geometry and shelter footprints |
| `src/soundscape.js` | Procedural audio samples, environmental mixing and footfall timing |
| `src/postcard.js`, `src/field-camera.js` | Print layout, captions, viewfinder controls and local PNG export |
| `src/photo-studies.js` | Lookout reach, lens framing and exposure conditions |
| `src/map.js` | North-up map projection, cached plan drawing, heading and marker selection |
| `src/renderer.js` | Raw WebGL shaders, a sign texture atlas, shadow baking and adaptive render resolution |
| `src/app.js` | Input, on-screen controls, accessible dialogs and the animation loop |

Classic scripts support direct opening from the filesystem. The geometry and simulation modules also export their functions to Node. The renderer targets 60 fps by uploading static geometry once, baking the daylight shadow map and drawing the sky, campus and signs in three draws per clear frame. Resolution adjusts under sustained load. A stationary view sleeps whenever rain streaks are inactive.

## Round 2

### Walking directions

Choose a place in the field guide to preview the walk from your current position. Select **Route to press** and follow the arrow beside the compass to the next turn. The distance in metres covers the rest of the walk. The line on both maps ends at the stamp tile. Routes allow room around planters, benches and columns. Take a different turn and the directions update. **Walk from here** takes you directly to the selected viewpoint.

### Five campus impressions

Each landmark has a hand press with its own enamel emblem. Look for the brass-edged octagonal tile in front of it. Press **E** or tap **Stamp notebook** within reach to print the matching design in the field guide and reveal a note about the place. The arcade entry includes a tactics sketch on a milk-tea order.

The notebook saves each impression locally when browser storage is available. If storage is blocked or full, the count says **this visit** and collecting continues for the current session. Resetting the viewpoint keeps the notebook.

### Rain and shelter

Press **R** for a shower at either time of day. The ridgeline fades into mist, exposed paving picks up light at shallow angles, and wind slants the rain across the court. Walk under the library eave, arcade, cloister or Fern Garden pavilion to see the **Under cover** indicator and watch the rain beyond the roof edge.

Animated rain adds one depth-tested draw using a reusable mesh. Its motion pauses while a dialog is open or the tab is hidden. Reduced motion gives the wet lighting immediately and keeps the air still.

### Fixes and verification

The camera now settles when only Shift or opposing movement keys are held, and enabling reduced motion mid-stride clears head bob immediately. A repeated animation timestamp no longer stalls walking. The renderer keeps the sign atlas within power-of-two texture limits and releases graphics resources before retrying an interrupted draw.

Run `node tests/run.js` to check the complete walk in Node. The expanded suite steers with the displayed turn arrow to collect all five stamps, reopens the saved notebook, checks thin walls and roof edges, and exercises blocked storage, rain rendering and WebGL recovery.

## Round 3

### Kite Terrace

Follow the south promenade east to the timber ramp. The boards climb 2.55 metres to an open deck where four copper panels fold into a kite. Walk around its base to catch the different colours on each face. Both maps show the deck and its entrance. Choose **Kite Terrace** in the field guide for a route to its stamp press or a starting view of the sculpture. A notebook with the original five impressions opens with one space left for the copper kite.

### Field camera and postcards

Press **C** to stop and frame the view. Drag or use the arrow keys to aim. The **−** and **+** controls switch between 1×, 2× and 3× lenses. Press **Space** or **Take postcard** to see a paper print of the full frame, with the place, lighting, weather, bearing and lens in the margin. **Save PNG** downloads it locally. **Retake** returns to the viewfinder. Press **Esc** there to return to the walk and your directions.

### Campus sound

Press **V** to listen. A pair of bird calls grows clearer near Fern Garden, evening insects take over after dark, and showers sound different under the eaves. Your footfalls change from stone to hollow timber as you climb the ramp. The page synthesizes the sounds on the first use of each voice. Ambient loops follow the audio clock, so a quiet view can sleep while the garden keeps singing. Sound pauses in dialogs, in the background and during graphics recovery.

### Fixes and verification

The camera now stands on the pavilion floor as well as the raised deck. Movement checks the full length of each substep, closing a gap where a short stride could clip the edge of a round post. Clearing a saved notebook in another tab refreshes the open guide and preserves impressions that could only be saved for this visit. An interrupted sign upload or shadow bake now releases its graphics resources before a retry.

`node tests/run.js` exercises the six-stop walk, ascent and descent, old notebooks, lens alignment and local print capture. The recording interfaces also check late PNG callbacks, graphics loss during a retake, sound-device failure and delayed audio permission. These checks run entirely in Node.

## Round 4

### Moon Gate Pool

Follow the green sign west from Banyan Court. A level stone causeway passes through a terracotta ring, with reeds and lily pads on either side. Walk along the bank to see the gate’s reflection move across the water. A shower breaks it into ripples, and amber tiles pick out the crossing at night. The **Water ring** stamp waits on the west bank. A six-stamp notebook opens with its original impressions and one space for the new design.

### Two guided walks

Open **Field guide → Guided walks**. **Water & copper** visits the pool, tower and terrace. **Between lectures** leads from the library to the arcade noticeboard and the garden pavilion. Each preview numbers the stops and gives the walking distance from your current position.

Select **Start guided walk** and follow the compass arrow. At each lookout the arrow points out the subject and a short field note stays on screen while you explore or take a postcard. Press **F** or select **Next stop** when you’re ready. Use **Finish walk** at the final stop, or **X** to leave the itinerary early.

### Three photo studies

Look for a brass viewfinder tile, or choose **Frame from lookout** in the guide to start at one. Photograph the tower hands at 2× in daylight, the upper copper fold at 1× after dark, or the pool’s green keystone at 1× in a shower. The viewfinder helps you centre the subject and choose the lens and conditions. Once it reads **In frame**, take the postcard to print the study title in its margin.

The guide displays a thumbnail of your latest matching exposure at each lookout for this visit. Completion marks carry over when local storage is available. **Save PNG** keeps the full postcard.

### Fixes and verification

Reversing away from a wall now works on the first keypress after the camera goes idle. An unfocused window pauses rain streaks and pool ripples together. Stamp routes and guided walks share the same collision-aware planner, and stamps and photo studies use separate keys in the same local collection code.

`node tests/run.js` runs 112 tests. They steer the walk from its displayed arrows, check the camera’s sightlines against the mesh, take all three prints and exercise full storage, interrupted captures and graphics restoration. The water renders in the existing campus draw, keeping a clear frame at three draws.
