# Nightline — Kowloon Loop

Drive a Hong Kong–inspired metro from inside its front carriage. The fictional 2.352 km loop runs from Kowloon Tong through Campus Gate, Junction Road, Lok Fu and Lion Rock, then returns to Kowloon Tong. Each station has its own mosaic colour, bilingual signs and a platform lined with working screen doors. Look through the side window at Campus Gate for the late-night toast and after-class 3-on-3 posters.

## Run the ride

Double-click **index.html** in this folder. Keep **styles.css** and the **js** directory beside it. A modern browser with JavaScript and WebGL enabled can run the whole ride offline. All geometry, artwork and sound are generated locally.

You start at Kowloon Tong with the doors closed. Press **↑** to set a target speed and depart. Each press adds 10 km/h, up to 80 km/h. At the maximum target, the 432 m trip to Campus Gate takes about 38 seconds. Press **V** as you arrive to face the platform doors.

With assisted stops, the train brakes to a marked stopping point, opens its right-side doors in sync with the screen doors, boards for five seconds, and closes both sets before moving. Your target carries over to the next leg. Select zero during boarding to stay at the platform.

## Controls

| Input | Action |
| --- | --- |
| **↑** or **W** | Raise the target by 10 km/h. Hold to repeat. |
| **↓** or **S** | Lower the target by 10 km/h. |
| **Space** | Apply the brake and set the target to zero. |
| **C** | Coast in motion. Press again to resume the selected target. |
| **D** | Open, close or reverse the doors while berthed. |
| **M** | Switch between assisted and manual stops while berthed. |
| **G** / **Z** | At a berth, toggle signal working / posted curve speed limits. |
| **J** / **B** | Enable guard working at a berth / ring the departure bell after the doors are proved closed. |
| **N** | Cycle the timetable and sky through evening, last train and first train. |
| **P** | Pause or resume. |
| **T** | Switch evening rain on or off. |
| **X** | Sweep the front windscreen once. |
| **←** and **→** | Hold to turn your head. |
| **Drag the view** | Look around the carriage with a mouse, pen or touch. |
| **V** | Switch between the front windscreen and the right-side platform view. |
| **L** | Look out of the left window for a passing campus shuttle. |
| **I** | Take a passenger seat in the saloon. Drag or use the look keys from that seat. |
| **R** | Recenter the view down the track. |
| **H** or **?** | Open or close the key guide. **Esc** also closes it. |

The dashboard buttons offer the same driving controls. The route monitor marks the current or upcoming stop and shows the remaining distance. Use **Sound off** in the header to enable traction sound, rail noise and door chimes. The adjacent button toggles fullscreen where the browser supports it.

Opening the key guide or switching to a background tab freezes simulation time. If the browser loses its graphics context, the ride keeps your position and speed and resumes when the context returns. A message in the viewport explains how to enable WebGL if it is unavailable.

## Run the tests

From this folder, run the following command with Node.js. The project was verified with Node 22.22.3.

```sh
node tests/run.js
```

The runner uses the built-in `node:test` module in a single process. It checks the route over multiple laps, frame-rate independence, braking distances, door alignment and interlocks, camera movement, and all 147 generated track sections. It also loads the scripts in HTML order in a Node VM, exercises the controls, and records the WebGL and audio calls. Ray tests through the actual mesh triangles check the cab, platform, left-window and saloon views.

The command-line graphics checks cover shader structure, matching shader interfaces, vertex layouts, texture allocation, draw order and buffer reuse. Actual GPU compilation and displayed frame rate depend on the browser and graphics hardware.

## Project layout

| Files | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Cab viewport, live instruments, route monitor, responsive controls and key guide. |
| `js/math.js`, `js/camera.js` | Vector and matrix math, seeded randomness and smooth camera movement. |
| `js/route.js`, `js/ride.js` | Loop geography, track shape, 60 Hz train physics, stopping modes and door interlocks. |
| `js/service.js`, `js/instruments.js` | Run timing, stopping results, route monitor and live instrument readouts. |
| `js/traction.js`, `js/weather.js` | Rolling resistance, traction energy, water on the glass and wiper motion. |
| `js/comfort.js`, `js/duties.js`, `js/saloon.js` | Handstrap dynamics, per-leg measurements, duty scoring and bilingual passenger information. |
| `js/passengers.js`, `js/commuters.js` | Passenger destinations, doorway crossings, queue positions and figure geometry. |
| `js/mesh.js`, `js/world.js`, `js/viaduct.js` | Indexed geometry for the track, tunnels, viaducts, city, stations and carriage. |
| `js/surfaces.js`, `js/shaders.js`, `js/renderer.js` | Procedural texture atlas, GLSL materials and lighting, and raw WebGL drawing. |
| `js/app.js`, `js/icons.js`, `js/audio.js` | Input, frame scheduling, local pictograms and synthesized audio. |
| `tests/` | Automated tests and in-memory hosts for the page and graphics calls. |

The renderer streams 16 m sections around the train, reuses their GPU buffers between frames and releases them as they leave view. It can prepare the next section during idle time. Opaque geometry draws before glass, and the drawing buffer has a pixel budget for high-density displays. Rendering follows the display refresh and rests once the train, camera, passengers and weather are still.

## Round 2

**Two windows onto Kowloon.** College Viaduct starts 80 m out of Kowloon Tong. Apartment windows light up against the dusk sky, and a rooftop three-a-side court comes into view on the right on the way to Campus Gate. Foothill Viaduct opens onto a sparser skyline between Lok Fu and Lion Rock. At each tunnel mouth the cab lighting changes gradually and, with sound enabled, the wheel noise softens in open air.

**Manual stops.** Press **M** at a station or click **Manual stops** to take over braking. Approach the black-and-amber **S** board on the left. The cab shows how far you can travel before applying **Space**. On the final approach, the gauge predicts where the train would stop if you braked now. Aim for the green band, within 1 m either side of the board.

A standstill within 8 m of the mark starts automatic levelling with the doors locked. If you stop further short, press **↑** to move up and **Space** to try again. Overrun protection stops the train at most 8 m past the board. Once aligned, both sets of doors open and your original stopping error goes on the run sheet. Select a target to depart again, or press **M** while berthed to return to assisted stops.

**Run sheet.** The route monitor pairs your elapsed time with the booked time for the leg. The clock starts at departure and stops when the next platform doors unlock. It includes stops between stations and levelling time. Platform waits, pauses, time in the key guide and graphics interruptions are excluded. Open **Run sheet** below the controls for the latest five arrivals and the total stop count for this session. Runs within five seconds of their allowance, to the nearest second, count as on time.

**Live cab screen.** The display on the sloping desk shows your speed in illuminated digits, the bilingual station sign and its position on the line. It shows the current station at a berth and the upcoming station in motion. The screen uses the local texture atlas and updates without rebuilding geometry.

**Repairs and verification.** Releasing a drag now preserves held keyboard controls. An assisted stop a fraction of a millimetre short of the mark can finish berthing at zero target. The Node suite drives both modes, checks early stops and overruns, times multi-lap services and traces sight lines through the cab glass. Across all 147 streaming boundaries, the recording WebGL host measured at most 24 draws and 40,854 triangles in a frame.

## Round 3

**Watch the platform exchange.** At Kowloon Tong, press **V** to look through the right-hand doors and **D** to let the queue aboard. Six people are already in the 18-place front carriage. The route monitor shows the load and how many riders want the next stop. At Campus Gate, look for three teammates travelling to Lok Fu for their evening three-a-side game.

Passengers alight at their destination before anyone boards. Each person takes 0.6 seconds to cross. If you close early, the person in the doorway clears it while the leaves are still wide apart. Reopen at the same berth to pick up where you left off. Once the carriage is full, the remaining riders wait on the platform.

**Drive a leg on momentum.** Press **C** to cut traction and roll against air and wheel resistance. Press **C** again to return to your target speed, or use a speed or brake key to take over. Assisted stops and manual overrun protection can still apply the brakes. The signed line-power meter shows energy drawn from the supply in amber and regenerative braking in green. The two kWh totals measure front-carriage traction, include the passenger load, and stay on the instruments until the next departure. The run sheet keeps both figures for each arrival.

Try an assisted departure at 80 km/h and press **C** with 332 m left to Campus Gate. In the Node simulation, that coast took 43 seconds and used 0.93 kWh net. Holding the target took 38 seconds and used 1.90 kWh net with the same starting load.

**Take the viaduct in the rain.** Press **T** or the rain button before departing. As you leave the tunnel, the ridge fades into cloud, light catches the wet deck and drops run down the windscreen. With sound enabled you can hear the rain on the exposed spans. The wiper sweeps automatically when the glass wets. Press **X** for a single sweep at any time during service. Water collects again inside the cleared arc in rain and dries gradually under cover.

**Repairs and verification.** Releasing **W** while **↑** is still held keeps the accelerator highlighted. Releasing one of two opposing look keys resumes the turn even from a parked cab. Passenger exchange, energy accounting and weather now have independent simulation modules. Node tests exercise full loads, interrupted crossings, coasting to rest, regenerative braking, wet portals, wiper parking and graphics restoration. Rays through the uploaded triangles check the rider passing between both doors and the blade behind the glass. The recording WebGL host measured at most 25 draws, 41,922 triangles and 50 resident buffers across all 147 track sections.

## Round 4

**Take a passenger seat.** Press **I** or click **Saloon** to move from the desk to the left rear bench. Look across the aisle, through the doors or forward to the illuminated bilingual display. Dragging turns your head from the seat. **R** takes you back to the controls.

**Read the carriage announcements.** The overhead display and a text caption show the next station, a red-signal wait, the approach and each door movement. With sound enabled, a three-note chime marks the last 80 m once per leg. When the doors open at Campus Gate, the display points the way to the HKBU exit.

**Feel the bend.** All ten handstraps hang from fixed pivots. They swing aft under traction, forward under braking and towards the outside of a curve. The run sheet records the peak braking and sideways acceleration for each leg. On the first run to Campus Gate, holding a 40 km/h target produced a sideways peak of 0.61 m/s². An 80 km/h target produced 2.28 m/s² on the same track.

**Pick a duty card.** Choose a card below the driving controls while berthed. It stays selected for successive legs. The card shows progress in motion and the result at arrival. Open **Run sheet** and select a recorded leg to review its result later.

| Duty | How to complete it |
| --- | --- |
| Coasting | Roll freely for at least a quarter of the leg and arrive no more than ten seconds late, using the run sheet's rounded time. On the first leg, press **C** with 332 m to go at an 80 km/h target. The reference run coasted 274 m and arrived in 43 seconds. |
| Steady carriage | Keep peak braking at or below 1.60 m/s² and peak sideways acceleration at or below 0.85 m/s², measured to the nearest hundredth. Try the posted curve limits with **Z**. |
| Precision stop | Select manual stops with **M** and stop within 1 m of the board. The card uses your first stopping position, before levelling. |

**Repairs and verification.** Holding a look key at the end of head travel now lets a parked renderer sleep. Stop errors just beyond 1 m have a distinct readout. The headlight beams stay on the train as you change seats. The carriage display uses a small static lettering atlas and the handstraps reuse the carriage mesh. The Node suite traces sight lines to the sign and swinging grips, checks successful and missed duties, and exercises muted announcements, reverse levelling, pause and context restoration. Run `node tests/ride-check.js` for a complete guarded trip through the page and recording WebGL host.

All 149 tests passed on Node 22.22.3. Across the 147 streaming boundaries, the recording host measured peaks of 27 draws per frame, 42,130 triangles and 54 resident mesh buffers.
