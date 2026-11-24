# Field Atlas

Field Atlas is an offline 3D terrain generator built with plain JavaScript and WebGL. Fly along a winding inlet, climb past the tree line, and watch the peaks change color as the sun sets. The contour map tracks your position, altitude and heading throughout the flight.

## Open the studio

Double-click **index.html** in this folder. Keep **style.css** and the **js** directory beside it. A modern browser with JavaScript and WebGL 1 support runs the project directly from disk. All geometry, artwork, textures and shaders are generated locally. There is no installation, server or build step.

The first view overlooks **Alder Basin** at 16:30 with the seed `KT-0427`. Choose **Fly** and hold **W** to approach the lake. The **Field guide** button lists the controls in the app.

## Generate a landscape

| Preset | Landscape |
| --- | --- |
| Alder Basin | An alpine lake, grassy banks, conifer groves and snow-capped peaks |
| Ember Canyon | Terraced sandstone, a narrow river and sparse, low trees |
| Frostmere | A broad glacial inlet, steep slopes and a lower snowline |
| Lantern Caldera | A flooded volcanic crater, a breached basalt rim and a cinder-cone island |

Type a seed and press **Enter** or **Generate terrain**. The dice button generates a new seed and immediately opens its landscape. Selecting a preset uses the seed in the field. The same preset and seed reproduce the terrain, vegetation and rocks. Generating returns the camera to its starting overlook and keeps the chosen lighting and layer settings.

For a short survey between HKBU classes, try **Frostmere** with `Kowloon-Tong` at 06:15. Share the preset and seed with a classmate to explore the same inlet.

## Camera controls

| Action | Control |
| --- | --- |
| Look around | Drag the scene or use the arrow keys |
| Change orbit distance | Scroll, pinch, or use **+ / −** |
| Fly forward, left, back, right | **W / A / S / D** |
| Climb / descend | **E** or **Space** to climb, **Q** to descend |
| Fly faster | Hold **Shift** |
| Switch between orbit and fly | **F** or the camera buttons |
| Return to the preset overlook | **R** |
| Open or close the field guide | **?**, or **Esc** to close |
| Expand the view | Use the fullscreen button at the right of the camera bar |

Touch devices also get a directional pad and climb/descend buttons in Fly mode. Drag with one finger to look while holding a flight button with another. The camera stays inside the 528 m survey area and clears the ground and visible water by at least 2 m.

## Time, water and trees

A full day takes 12 minutes while the page is visible and the **Day/night cycle** switch is on. Move **Time of day** to hold a particular minute. Turn the cycle on again to resume. The sky, sunlight, haze, water reflections, moon and stars follow the clock.

Switch **Water** off to inspect the lakebed. **Trees** controls both the conifers and their ground shading. The survey map shows the terrain contours at every hour. North corresponds to decreasing Z, east to increasing X, and altitude is measured from water level.

## How it works

- **World generation.** A text hash seeds a custom gradient-noise lattice and deterministic random stream. Rotated noise octaves warp summit positions and riverbanks. Each preset changes the channel width, relief, surface palette, snowline and tree distribution.
- **Surface and collision.** A 145 × 145 height grid forms 41,472 terrain triangles. Each cell has a seeded diagonal. The camera and scatter sampler interpolate the same triangles the renderer draws, including steep canyon steps.
- **Meshes and lighting.** Faceted slopes blend face and vertex normals. Tree and rock geometry is batched into static buffers. A generated texture stores shallow-water depth and canopy shading. Animated ripples distort a lower-resolution reflected view of the sky and landscape.
- **Frame budget.** The renderer reuses uploaded geometry and cached reflection buffers. It caps the pixel count and adjusts drawing resolution based on measured frame times to target 60 fps. The footer reports the actual frame rate on the current device.
- **Survey map.** Contours follow the elevation cuts across each seeded triangle and are cached on a local canvas. The map follows the camera and rotates its bearing marker as you turn.

## Run the tests

From this folder, run the following command. The suite uses Node's built-in test runner and standard library. It was verified with Node 22.22.3.

```sh
node tests/run.js
```

The command discovers every `*.test.js` suite and runs it in a single process. It exits with a nonzero status on failure. The tests cover seed replay, noise continuity, projection math, mesh winding, triangle-accurate collision, water depth, tree placement, camera damping, clock transitions and contour topology.

Integration tests execute the scripts in the order declared by **index.html**. In-memory DOM, canvas and WebGL interfaces exercise controls and inspect draw commands, shader interfaces, reflection passes, GPU resource replacement, graphics-context recovery and the unavailable-WebGL message. All checks run from the terminal. Actual shader compilation and display frame timing take place on the user's graphics hardware when the page opens.

## Source layout

| File | Responsibility |
| --- | --- |
| `index.html`, `style.css` | Local entry point, responsive field atlas, controls and field guide |
| `js/noise.js`, `js/terrain.js` | Seeded noise, terrain presets, height sampling and scatter |
| `js/math.js`, `js/simulation.js` | Camera transforms, flight motion, time and lighting |
| `js/meshes.js` | Terrain, trees, rocks, water, distant ridges and texture generation |
| `js/shaders.js`, `js/renderer.js` | GLSL programs, WebGL buffers, reflection and main draw passes |
| `js/cartography.js` | Contours, map marker and illustrated preset cards |
| `js/navigation.js`, `js/app.js` | Keyboard and pointer input, scene lifecycle and UI |
| `js/probe.js`, `js/relay.js`, `js/flight-panel.js` | Surface soundings, gate placement and timing, flight instruments |
| `tests/` | Automated tests and recording interfaces |

If the browser cannot create a WebGL context, the viewer displays a diagnostic. Enable graphics acceleration in the browser settings and reload the file. A temporary context loss pauses the renderer and rebuilds the scene when graphics return.

## Round 2

### Weather

Choose **Clear**, **Sea mist**, or **Squall** in World settings. Sea mist softens the sunlight and obscures distant ridges. A squall brings darker clouds, slanting rain and expanding rings on the lake. The sky and its reflection share the same 2.4-second transition. You can change the weather midway through a transition or hold the clock at sunset while the rain moves.

### Plot and measure a route

Each seed opens with an **Inlet traverse** from the near bank through the channel and up to the far ridge. Select **Plot route** to see the entire survey area. Click or tap A and B at least 5 m apart to plot your own straight transect. With the keyboard, move the crosshair with the arrows, hold Shift for 1 m steps, and press Enter at each endpoint. Esc cancels an unfinished plot.

The elevation profile shows ground height along the path. Blue fills the space between the lakebed and the 0 m waterline. Drag across the profile or focus it and use the arrow keys to inspect a distance, elevation and corresponding map position. Inspection shows the full map. **Follow camera** returns to the moving map. **Length** measures horizontal travel, **Ascent** sums uphill sections, and **Over water** measures the horizontal distance above submerged ground. **Restore inlet route** brings back the seed's traverse.

### Fly the survey

Choose **Tour** in the camera bar or **Fly route** beside the profile. The camera starts at the selected distance, travels at 17 m/s and anticipates crests to keep at least 16 m above terrain and water. **Space** or the playback button pauses and resumes. Scrubbing pauses at the chosen station. At the end, **Replay** starts another pass. Press **F** to take the controls at the current position and heading, or **R** to return to the overlook.

For a break between HKBU tutorials, try **Ember Canyon** with seed `Milk-Tea-Relay` at 17:45. Its 392 m traverse takes about 23 seconds, with 184 m over water.

### Implementation and tests

`js/survey.js` intersects the path with grid edges and each cell's seeded diagonal. The chart, measurements and flight camera share that profile. `js/survey-panel.js` handles map plotting and profile inspection. `js/weather.js` blends weather independently of the day clock. The renderer uploads one rain mesh on the first squall and reuses it on subsequent frames.

Round 2 also fixes camera drift after focus loss, blank map areas on tall displays, degenerate contour strokes and truncation of seeds containing supplementary Unicode characters. Failed geometry uploads release their partial allocations. Run `node tests/run.js` to exercise the route geometry, weather transitions, playback controls, GPU draw commands and recovery paths through the local entry point.

## Round 3

### Weather a slope

In **Basin study**, **Fresh** opens the original seeded terrain. **Talus** moves loose material down steep faces in 24 passes. **Worn** uses a gentler limiting slope and 64 passes, rounding summits and building up their footslopes. Switch settings while paused on a tour to compare the same station. Trees, rocks, contours and the route profile all follow the reshaped ground. Returning to **Fresh** reproduces the original bed.

### Raise or lower the lake

Move **Lake level** from −6 m to +8 m. Follow the shoreline on the shaded relief map and read the **Flooded area** in hectares and **Stored water** in cubic metres. The calculation includes every depression below the selected elevation. Depth shading, reflections, the blue profile fill, over-water distance and camera clearance follow that level. All reported elevations use the original 0 m survey datum.

The **Water** switch lets you fly down to inspect the exposed bed while keeping the survey measurements. **0 m datum** restores the original waterline. Weathering and lake level carry over when you generate another seed.

### Trace and fly runoff

Choose **Trace runoff**, then click or tap high ground on the survey map. With the keyboard, use the arrows to move, Shift for fine steps and Enter to trace. Esc cancels. From the nearest flyable terrain vertex, the trace follows the steepest descending mesh edge. It crosses flat terraces when they have an outlet and ends at the lake, a closed hollow or the survey boundary.

A blue line marks the course on the map. Animated chevrons show its direction on the 3D ground. The elevation profile reports its length and drop. **Fly route** follows the trace. Changing the lake level or weathering traces it again from the same source. If that source becomes submerged or loses its path, the inlet traverse returns.

For a short survey between HKBU tutorials, open Alder Basin with the seed `Canteen-Relay` at **Fresh**, 0 m. Pick X −80, Z +100 to trace a 65 m run with a 29 m drop to the lake. At +4 m, the water covers 2.47 ha.

### Implementation and tests

`js/erosion.js` balances sediment transfer by each vertex’s share of the triangulated bed, conserving ground volume even at the edges. `js/hydrology.js` clips those same triangles at the selected waterline and integrates their submerged depth. The map paints the resulting polygons over cached contours. The runoff renderer reuses one terrain-following mesh while the chevrons move.

This round also fixes an invalid tour pose caused by a final leg too small to advance the cumulative distance, and a blank view when a pending preset switch was reversed during graphics recovery. Run `node tests/run.js` for the volume and shoreline checks, flat-terrain drainage, elevated reflections, camera clearance, keyboard and pointer controls, and graphics recovery.

## Round 4

### Lantern Caldera

The fourth preset opens above a breach in a volcanic rim. A turquoise lake fills the crater around a small cinder cone. The seed sets the shape of the rim, its bands of exposed basalt, and the position of the island. Choose **Tour** for the **Crater crossing**, or raise the lake in **Basin study** to see how much of the cone stays dry.

For a relay between HKBU tutorials, try `Last-Minibus` at **18:10**, **Fresh**, and **0 m**. The crossing runs 365 m through seven gates, with 191 m over water.

### Measure with the surface probe

Select **Probe** in the camera bar and aim the centre crosshair. On land it reads elevation, slope in degrees and the downhill compass direction. Over the lake it reports water depth and bed elevation. Both readings include the distance from the camera. The diamond on the survey map marks the measured point. Switch **Water** off to inspect the exposed bed, or aim above the survey to clear the reading.

The probe inks the 3D slopes at 2 m intervals, with heavier lines every 10 m. It measures the triangulated bed beneath the vegetation. A ray visits each crossed face in order, so even a narrow ridge in front of the lake registers as land.

### Fly a gate relay

Choose **Start relay** below the elevation profile. The camera lines up with the first ring on the current route. Hold **W** or the forward touch button to start the clock. Fly through the gold rings in order, using the viewer for steering and altitude cues. Each gate records a split. **Retry** lines up another attempt and compares your splits with your fastest completed flight.

The preset crossing, plotted transects and runoff traces can all host a relay of at least 5 m. Gate size and spacing adjust to the route. The field guide, an unfocused or hidden page, and a graphics interruption pause the race. **End relay** leaves you in Fly at your current position. Your best stays with this course until you replace the route, terrain or lake level, or close the page.

### Geometry fixes and tests

The relief map now follows the mesh diagonal through saddles and bends at the same elevation cuts as the 3D ground. This fixes contours that previously joined the wrong slopes. Route profiles, probe rays and gate clearance share one mesh-intersection routine. Near the survey boundary, a gate checks the portion of its rim above the bed. Each relay draws all its rings from one GPU buffer.

Run `node tests/run.js` to check crater seed replay, probe readings against independent ray–triangle intersections, gate clearance, split timing and the local entry point. The page tests fly a full relay with the controls, retry it, and exercise graphics loss and recovery.

## Round 4 — Ridge observatory

### Watch a ridge cast a shadow

**Ridge shadows** is on in World settings. Scrub the clock near sunset to watch a slope shade the opposite bank, its trees and the lake. Sea mist and squalls soften the effect. The reflected landscape uses the same shadows as the main view.

The renderer draws the terrain into a 512 × 512 depth map from the sun’s direction. Moving the camera reuses that map. A change in sun angle or terrain refreshes it. Devices that cannot allocate the shadow target keep the regular lighting and show the switch as unavailable.

### Read the skyline and fly to a station

Open **Ridge observatory** beneath the clock. **Camera position** measures the skyline from your current eye height. **Route station** takes the distance selected on the elevation profile. **Summit** finds the highest terrain inside the flight boundary, including peaks on its clipped edges. The route and summit stations place the eye 3 m above the bed or visible water.

Drag the skyline cursor, or focus it and use the arrow keys. The chart samples one bearing per degree. Each reading gives the elevation angle, ground elevation and horizontal distance to the point that makes the skyline. **Face this bearing** places you at the station in Fly mode, looking straight at that point. Closing the observatory returns you to your current flight.

### Find a sunlit minute

The gold strip marks each minute when the sun’s centre is above the horizon and clears every intervening face of the mapped terrain. A peak can divide the day into several sunlit windows. The calculation uses clear skies and covers the 528 m survey. Trees, cloud cover and the distant backdrop ridges sit outside the measurement.

Scrub the strip or choose **First sun** or **Last sun** to hold the world clock. **Face the sun** aims the camera from the selected station at the displayed minute. The day/night switch resumes the clock.

For an HKBU study break, open **Alder Basin** with `Kowloon-Study-Break`, **Fresh** and lake level **0 m**. The opening overlook gets 8 h 50 min of direct sun, from **07:38** through **16:27**. Choose **Last sun**, then **Face the sun**, to find the ridge that ends the afternoon there.

### Implementation and verification

`js/observatory.js` measures each bearing where it crosses a terrain edge or seeded diagonal. It traces the actual sun direction separately for each daylight minute. `js/observatory-panel.js` caches the measurements while you inspect bearings and times. The sky, depth pass and planner share one sun-direction function. The reflection and shadow passes share render-target allocation and cleanup.

This pass also fixes tours advancing by the time spent in a dialog when frames were delayed. Run `node tests/run.js` to check the skyline and sunlight against independent ray–triangle intersections, fully shaded stations, clipped summits, the north seam, camera handoff, shadow caching and graphics recovery. All checks run in Node.
