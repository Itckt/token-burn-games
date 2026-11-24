# Nightferry 夜渡

Fly across an imagined stretch of Victoria Harbour after dark. A red-sailed junk crosses the foreground, two ferries pass the quay, and coloured reflections break across their wakes. Behind them, five rows of seeded city blocks climb towards a folded-glass tower and three mountain ridges.

## Open the harbour

Double-click **index.html** in this folder. Keep the `js` directory and `style.css` beside it. A browser with WebGL and hardware acceleration draws the scene directly from the local files. All artwork, textures and lighting are generated on the device. The project runs offline with no installation or build step.

The flight starts on **Harbour drift**, a two-minute circuit over open water. **Neon passage** takes 96 seconds and passes closer to the shop signs. **Rooftop glide** takes two and a half minutes and looks down across the roofs. **Ferry deck** joins the larger ferry on its four-minute crossing. If your system prefers reduced motion, the first view opens paused.

## Controls

| Action | Control |
| --- | --- |
| Look around | Drag with the mouse or a finger, or hold the arrow keys |
| Recenter the view | **R** or double-click the scene |
| Pause or resume the camera, water and boats | **Space** or the playback button |
| Select a route | **1–4** or a route button |
| Change speed | **S** cycles through ½×, 1× and 2×, or select a speed directly |
| Jump along the route | Drag the timeline, or focus it and use the arrow keys. On **Ferry deck**, this also sets the harbour clock. |
| Change the light or weather | **T** cycles the light, **W** cycles the weather, or use either menu |
| Track a harbour subject | Tap a lookout on the chart, press **L** or use the **Look at** menu |
| Magnify the view | **B** or **Spotting glass** cycles through 1×, 2× and 4× |
| Jump to the next lookout event | **N** or the named action beneath the selected lookout |
| Take a postcard | **P** or **Postcard**, then **Save PNG**. **Esc** closes the preview. |
| Generate another skyline | **G** or **New skyline** |
| Toggle fullscreen where supported | **F** or the corner icon |

**New skyline** advances the seed and keeps your camera position. To revisit a layout, keep the seed in the file address, for example `index.html#seed=852`. A seed can be any whole number from 0 to 4,294,967,295. The original `?seed=852` form also works.

Along the waterfront, look for the Kowloon Tong study room and *Table for Three*. One is for an HKBU assignment deadline, the other for the 3v3 team waiting for you afterwards.

## How the scene is drawn

The JavaScript modules build the city, boat meshes, camera splines and matrices. Canvas 2D paints window patterns and bilingual neon lettering into texture atlases. The WebGL renderer draws a mirrored copy of the skyline and boats into a smaller texture. The water shader samples it through moving ripples, so each light follows its source. A low-resolution bloom pass softens bright windows and neon tubes.

Static geometry shares indexed buffers. The renderer targets 60 fps by adapting resolution to sustained frame times. A settled, paused view sleeps until the next interaction. If a graphics context is lost, the page displays its status and rebuilds the scene when the browser restores it.

## Run the tests

From the project folder, run the suite with Node.js. It was verified with Node 22.

```sh
node tests/run.js
```

The suite uses Node’s built-in test runner in a single process. It checks seeded layouts, sign placement, window patterns, mesh winding and index limits, route continuity, boat headings and opening-shot framing. It also loads the scripts in HTML order and exercises playback, keyboard and pointer input, resizing, regeneration and graphics failures.

A recording WebGL test double checks shader interfaces, buffer bounds, reflection and bloom pass order, and texture use. These command-line tests open no windows. GPU shader compilation, rendered pixels and actual frame rate depend on the browser and graphics device.

## Round 2

A jade-lit **pier wheel** turns once every 84 simulation seconds. Its twelve cabins hang level as they cross the rim, and their amber windows reflect between the pier pilings.

The **quay tram** runs from Salt Steps through Study Pier to Lantern Market. Watch it brake, wait five seconds at the platform and switch its headlamps and red tail lights at the terminus. Study Pier is a small nod to the HKBU trio catching the tram after their group assignment.

| Control | What to try |
| --- | --- |
| **Weather** menu or **W** | Switch from moonlight to low sea mist, then to a rain squall. Wind breaks up the neon reflections, diagonal rain crosses the view and droplets make rings on the water. Weather blends during flight and changes immediately when selected while paused or using reduced motion. |
| **Look at** menu on the chart or **L** | Follow the wheel, tram or red-sailed junk from any camera route. The chart marks the subject and shows the tram’s current or next stop. Select **Route view** to return to the usual framing. |

The tram, wheel and rain follow the harbour clock. **Space** freezes them together, so you can change the weather or inspect a cabin at the top of its orbit. The smaller ferry now leaves its own hull-sized wake.

The wheel uses two indexed draws per scene pass, one for the rim and spokes and one for all the cabins. The tram uses one more. Changing weather reuses the same meshes and textures. The chart artwork and quay simulation now live in separate modules.

Run `node tests/run.js` for the expanded suite. It checks tram clearances across skyline seeds, station stops, cabin suspension, camera tracking through overhead passes, weather transitions, partial framebuffer allocation failures and graphics restoration.

## Round 3

**Harbour light.** Press **T** to move from midnight into blue hour, then first light. Blue hour leaves a rose glow in the west. At first light the eastern sky brightens, the stars fade and the sun warms the glass and water. Each light setting works with clear skies, mist or rain.

**Lantern show.** In **Look at**, choose **Lantern show** to watch 72 lights trace *Twin Sails*, *Three Currents* and *Night Bloom*. Each picture holds for ten harbour seconds and takes six to form the next. The chart names the current cue. Press **N** to see the next complete picture, even while paused.

**Floating pier.** A three-minute tide lifts the boats and landing through a 1.72-metre range. Choose **Floating pier** and compare the brass collars with the quarter-metre marks on the fixed piles. The gangway tilts at its shore hinge, and the reflections meet the new waterline. **N** jumps between high and low water. Three cups of milk tea wait under the canopy for a Kowloon Tong study group.

**Postcards.** Press **P** to frame the current view with its route, route time and skyline seed. **Save PNG** downloads the card locally. Closing the preview returns to the same instant and restores your playback state.

The lanterns share one indexed draw per scene pass. The pier moves within the existing waterfront mesh. The page now loads its local dependencies in order and releases partially allocated graphics resources on failure. The Node suite checks the main and reflected views, portrait framing, event boundaries, interrupted lighting blends, graphics restoration and late postcard encodes.

## Round 4

**Ferry deck.** Press **4** to watch the waterfront from behind the brass rail on the larger ferry. You board wherever it is on its crossing, and your eye rises with the deck as the tide changes. Drag the ferry timeline to carry the whole harbour to that instant. The three flight routes still let you move the camera independently.

**Harbour beacon.** A striped masonry tower sweeps an amber beam around the channel every 32 harbour seconds. It catches the side of a passing hull and leaves a broken patch of light on the water. Try **Sea mist** to see the shaft, then choose **Harbour beacon** under **Look at**. The chart shows where the lens points. **N** advances it to the next cardinal bearing.

**Cargo crane.** Follow the trolley as four cables lower a container onto a tidal barge. The crane releases it, then makes the return lift to the quay. Under **Look at**, choose **Cargo crane** and press **N** to catch the next landing. The three tea cups stencilled on the doors mark a delivery for the Kowloon Tong canteen.

The page now loads the vessel module before the city, fixing a startup failure when opening the local file. The camera and chart share the same lookout positions and event times. The crane rig and beacon each add one indexed draw per scene pass. Their motion reuses the uploaded geometry.

Run `node tests/run.js` for the full suite. It checks hull and crane clearances, cable attachment, portrait framing, ferry timeline boundaries and lighting in both the direct and reflected views. For a short Node-only run check, the following command starts the page at seed 852, boards the ferry, watches a delivery, takes a beacon postcard and exits after graphics restoration.

```sh
node tests/harbour-session.test.js
```

## Round 4 — Clock Quay and the hillside line

**Hill cableway.** A jade car climbs from Eave Street to Porcelain Rise as its vermilion partner descends. Both hang level from sagging ropes. The brass wheels beneath the station roofs turn as the cars draw cable. Each crossing takes 38 harbour seconds, followed by six at the platform for the doors to open and close. Choose **Hill cableway** under **Look at** and press **N** to catch the next arrival. The little open book on each car is for the students on their way home to Kowloon Tong.

**Time ball tower.** The four backlit dials on the clock pier read 23:58 when the flight opens. Each harbour second moves the hands through fifteen dial seconds. Watch the red ball rise up the mast, hold, then drop at midnight. It repeats the signal every quarter hour. Choose **Time ball tower** and press **N** to see the start of a drop, or board the ferry and scrub the timeline to wind the clock by hand.

**Spotting glass and chart.** Point at a chart marker to read its name, then click or tap to follow it. Press **B** or use **Spotting glass** to cycle through 1×, 2× and 4×. At high power, small drags let you inspect a clock hand or a cable-car door. The chart shows the narrower field of view. **P** takes a postcard through the selected lens.

The terminals and seeded roofs leave clearance for both cars. The cars share one mesh and add two indexed draws per scene pass. The clock hands and time ball move within the existing city draw. Each chart rebuild paints the coastline and city blocks once for all four routes.

Run `node tests/run.js` for the full suite. It now covers the last instant before a station arrival or midnight, open doorways, cable and vessel clearances, lookout framing from all four routes, chart taps on small screens and magnified reflections and postcards. A station timing fix keeps the tram’s destination on the chart until it actually arrives.
