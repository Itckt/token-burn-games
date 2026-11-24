# Orbit Atlas

Explore the Sun and all eight planets in an interactive, offline 3D solar system. Watch planets accelerate through perihelion, change the rate of time, or follow a planet as it moves. The planet index opens a profile with a globe, diameter, orbital period, and current distance from the Sun.

## Run the atlas

Double-click **index.html** in this folder. Keep **styles.css** and the **js** directory beside it. A browser with JavaScript and WebGL 1 support can open the project directly from disk. All meshes, surface maps, stars, and shaders are included as local code.

The atlas opens on **1 January 2026 at 00:00 UTC**, with Earth selected and time running at **one simulated day per real second**. The time slider offers 0.1, 0.25, 1, 3, 10, 30, and 100 days per second. Pausing freezes orbital motion and planetary rotation while keeping the camera active. Time also pauses while the page is hidden.

## Controls

The **Controls** button in the header opens the in-app reference.

| Action | Mouse or touch | Keyboard |
| --- | --- | --- |
| Inspect a planet | Select its globe, map label, or index card | **1–8**, in order from Mercury to Neptune |
| Follow the selected body | Choose **Follow**, or double-click a globe, label, or card | **F** |
| Inspect the Moon | Follow Earth, then select the Moon or its label | Open **Observatory** with **H** while Earth is selected |
| Return to the saved overview | Choose **Return to overview** | **F** or **Esc** while following |
| Reset the camera to its opening view | Use the target between the zoom buttons | **0** |
| Orbit the camera | Drag the map | **Arrow keys** |
| Zoom | Scroll, pinch, or use the **− / +** buttons | **− / +** |
| Pause or resume | Use the playback button | **Space** |
| Change time speed | Move the slider | **[ / ]** |
| Reverse playback | Use the double-arrow beside the playback button | **R** |
| Jump to a UTC minute | Click the simulation date, enter a time, then choose **Jump and pause** | **T** opens the navigator |
| Step back or forward one day | Use **−1 day / +1 day** in the time navigator | **, / .** |
| Frame the selected planet's entire orbit | Choose **Frame orbit** in Orbit study | **V** toggles, **Esc** exits |
| Visit perihelion or aphelion | Choose an event in Orbit study | Tab to the event and press **Enter** |
| Show equal-time sectors or the signal link | Use **Area sweeps** or **Map link** below the index | **S / M** |
| Track both signal endpoints | Choose **Frame pair** in Signal range | **P** toggles, **Esc** exits |
| Compare recent orbital motion | Set **Motion trails** in Signal range | Use the arrow keys on the focused menu |
| Preview or save an encounter | Open **Encounter planner** in Signal range | **E** opens, arrow keys scrub the focused chart, **Esc** closes |
| Show or hide orbit paths and labels | Use **Orbits** or **Labels** | **O / L** |
| Expand the map | Use the corner button at the upper right | **Esc** exits |
| Open or close help | Use **Controls** or the close button | **?** |
| Preview a station's sky | Choose **Observatory**, then a station, target and time | **H** opens, arrow keys adjust the focused time slider, **Esc** closes |

While following, select another planet to transfer the camera to it. The Sun is selectable from the map as well. Sliders and buttons retain their usual keyboard behavior when focused.

For a quick three-planet relay between classes at HKBU in Kowloon Tong, follow Mercury at **10 d/s**. Its lap takes about nine seconds. Press **3**, then **8**, to pass the camera to Earth and Neptune and see how differently the same clock moves each world.

## Orbital model and scale

Each planet follows a separate two-body orbit around a fixed Sun. The simulation uses approximate J2000 mean orbital elements and advances mean anomaly with elapsed simulated time. With semimajor axis *a* in astronomical units, the orbital period in Earth days is `P = 365.2568983 × a^(3/2)`. A bracketed Newton solver finds the eccentric anomaly from **E − e sin(E) = M**. The resulting position and velocity preserve the ellipse's orientation, eccentricity, and changing orbital speed independently of the animation frame rate.

The **Sun distance** readout shows the current physical separation in AU. The **planet index** shows each orbit's semimajor axis. One AU is approximately 149.6 million kilometres.

Body radii are enlarged and orbit spacing is compressed for legibility. Each planet's display ellipse retains its physical shape and has the Sun at one focus. The planetary orbital elements stay fixed throughout a run. The surface maps, ring bands, axial orientations, and static asteroid belt are illustrations.

## Rendering

Plain JavaScript builds the sphere and ring meshes, a seeded star field, and the procedural textures. Raw WebGL draws day and night lighting, Earth's atmospheric rim, Saturn's ring shadows, and the solar corona. The main view reuses GPU buffers and textures across frames, caps the drawing-buffer resolution on dense displays, and animates with the display's refresh cycle. The profile and index use the same planet materials as the map.

If WebGL is unavailable, the map displays recovery instructions. The planet profiles and controls reference remain accessible. If a graphics context is interrupted, the atlas can rebuild the view while retaining the simulation date and selected body.

## Run the tests

Run the suite from this folder using **Node.js 22.22.3**, the verified runtime.

```sh
node --test --experimental-test-isolation=none
```

The built-in Node test runner executes the suite in a single process, including in sandboxes that restrict child processes. It checks the following behaviors.

- Kepler solver residuals, orbital periods, conservation of energy and angular momentum, analytical velocities, and elapsed time at different frame rates.
- Vector and matrix conventions, projection and clipping, mesh winding, UV seams, orbit paths, geographic masks, and reproducible textures.
- Smooth camera transitions, following every planet at maximum speed, picking, label placement, and responsive overview framing.
- The actual HTML script order and startup, pointer and keyboard controls, pause and speed changes, camera handoffs, hidden-page behavior, and graphics recovery.
- Shader source structure and vertex/fragment interfaces. A recording WebGL test double checks uniforms, texture completeness, buffer bounds, and draw calls.

Verification runs entirely in Node. Actual GPU shader compilation, visual appearance, and device frame rates require a graphical runtime and are outside the command-line test measurements.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Atlas, planet index, responsive layout, and controls reference |
| `js/catalog.js`, `js/physics.js` | Planet data and physical and display coordinates for each orbit |
| `js/time.js`, `js/observations.js` | UTC clock, apsis predictions, and signal measurements |
| `js/encounters.js`, `js/fieldlog.js` | Pairwise separation forecasts, trail durations, and local observation storage |
| `js/lunar.js`, `js/sky.js` | Geocentric lunar orbit, station coordinates, disk illumination, and daily horizon events |
| `js/math.js`, `js/camera.js` | 3D transforms, camera, picking, and label placement |
| `js/geometry.js`, `js/surfaces.js` | Mesh builders and original procedural artwork |
| `js/shaders.js`, `js/renderer.js` | GLSL programs and WebGL rendering |
| `js/controls.js`, `js/instruments.js` | Map gestures, dialogs, orbit study, and signal range controls |
| `js/observatory.js` | Station and target selection, local-time previews, sky finder, and eyepiece |
| `js/planner.js` | Encounter chart, exact event visits, and field note controls |
| `js/app.js` | Playback, profiles, keyboard controls, and application lifecycle |
| `tests/` | Node unit and integration tests |

The JavaScript files expose CommonJS exports for Node and an ordered set of classic scripts for local-file browser loading.

## Round 2

- **Time navigation.** Click the date to jump to a UTC minute or step a day at a time. Jumps pause on arrival and keep the camera, speed, and playback direction. Reverse runs at any of the seven speeds. The calendar accepts years 0001–9999 and pauses at either end.
- **Apsis forecasts.** Orbit study shows the selected planet's speed and the distance and UTC time of its next closest and farthest approaches to the Sun. Choose an event to land at the exact turning point. Reverse time to see earlier events. Forecasts use the atlas's fixed J2000 orbital elements.
- **Equal-time orbit study.** Select Mercury and press **V** to fit its ellipse in the map. The amber sector at perihelion and the blue sector at aphelion each cover one twelfth of Mercury's orbital period, about 7.33 days. Mercury travels through a wider angle near the Sun and sweeps the same area. Select another planet to transfer this view, or press **V** again to restore your overview.
- **Signal ranging.** Choose a destination in Signal range. The atlas measures center-to-center separation in AU, one-way light time at the current positions, and the rate at which the distance changes in km/s. **Map link** draws a dashed line between the two globes. Selecting the destination exchanges the endpoints.

For an HKBU three-player squad with a teammate on Mars, the opening call from Earth would arrive **20m 03s** late on 1 January 2026 at 00:00 UTC in this model. Step the clock forward a few days to see how the delay changes.

The clock now carries fractional time across frames, so sixty equal updates reach the same midnight as one full step. Pausing refreshes the readouts immediately. Interrupted drags clear when the page hides or WebGL drops, and a fully hidden planet can no longer intercept taps near a visible globe.

The expanded Node suite checks UTC and leap-year limits, forward and reverse event visits, numerical sector areas, range rates against finite differences, camera handoffs, and the new controls through graphics loss and recovery. The recording WebGL tests also check that switching planets and drawing the overlays reuse the uploaded geometry.

## Round 3

- **Earth and Moon in 3D.** Follow Earth to see its Moon travel around an inclined ellipse. The same lunar hemisphere faces Earth as the lighting changes. **Orbits** switches the lunar track along with the planetary paths. Selecting the lunar globe or its label opens the eyepiece.
- **Local sky finder.** Press **H** or choose **Observatory** for the sky above Kowloon Tong, Cape Town or Dome A in Antarctica. The center is overhead, the rim is the horizon, and east is on the left as you look up. Select a dot or use the target menu to inspect the Sun, Moon or any of the seven other planets. The menu also includes targets below the horizon.
- **Rise, transit and set planner.** The altitude chart covers one local observing day. Drag across it, use the arrow keys on the slider, or select an event to preview the sky at that instant. The planner can show two meridian crossings in a day, a day without a moonrise, or continuous polar daylight. **Use time in atlas** applies the exact preview instant and pauses. Closing the observatory lets the atlas continue with its existing playback and camera settings.
- **Phase eyepiece.** A textured WebGL globe shows the illuminated face from the station, with celestial north up. Read the lit fraction, angular diameter, angle from the Sun, altitude and bearing. Try Venus at two dates to see its crescent grow in apparent size. The Moon also has a waxing or waning phase label. The chart, numbers and event controls work when WebGL is unavailable.

For an evening study break at HKBU, start on **1 January 2026**, press **H** and select the Moon's **22:42** transit. In this model it reaches **84.3°** above Kowloon Tong. Choose **Use time in atlas**, then follow Earth to see the same moment from space.

The finder uses physical AU positions and a rotating spherical Earth. The Moon's mean orbit has a 384,400 km semimajor axis, a regressing line of nodes and an advancing perigee. Its separation is compressed in the follow view. Station clocks use fixed offsets of UTC+8, UTC+2 and UTC respectively. Events use the center of the disk crossing a level geometric horizon. Terrain, refraction, eclipses and short-period lunar perturbations are outside the model.

The scene and eyepiece share globe lighting and orientation code. A single lunar path buffer follows Earth's position and the Moon's orbital plane. Resizing the map now clears stale hit positions, and focused inputs keep their native question-mark handling. New Node tests exercise lunar parallax, disk phases, grazing rises between chart samples, polar nights, calendar limits, preview isolation and graphics-context recovery.

## Round 4

- **Encounter planner.** Press **E** to plot the physical separation of any two planets, or a planet and the Sun. Drag the chart, use its arrow keys, or choose **Closest** or **Farthest** to inspect a local turning point. **Earlier** and **Later** move by one mean encounter cycle. Reverse playback starts the chart in the past. **Visit in atlas** selects the pair and pauses at the exact preview time. Closing the planner discards the preview.
- **Two-body camera.** Press **P** to track the midpoint of the pair in Signal range. The camera opens broadside and adjusts its distance as the bodies move or the map resizes, with room for Saturn’s rings. Drag to orbit or zoom for a closer look. Changing either endpoint transfers the view. Press **P** again to recover your saved overview.
- **Motion trails.** In Signal range, choose **7 days**, **30 days**, or **¼ inner orbit**. Amber traces the selected planet and mint traces its partner. Six dots mark equal intervals into the past, so wider gaps show where a planet covered more of its orbit in the same time. The adaptive option uses a quarter of the shorter orbital period. Trails shorten at the start of the calendar and follow time jumps and rewinds.
- **Field notes.** Open **Field notes** in the planner to name and save a pair and its exact instant. Select a note to preview it again. Saving the same pair and instant updates its name. Notes stay in the browser’s local storage when the browser permits it for this file. The log works in memory for the session when storage is unavailable.

For an HKBU observing group, start on **1 January 2026**, press **E** and choose the Earth–Mars **Closest** event. The atlas puts it at **0.678 AU on 19 February 2027 at 22:13 UTC**. Save it as *Kowloon Tong after class*, then choose **Visit in atlas** and press **P** to frame both worlds.

The chart uses center-to-center distances in AU and locates turning points where the calculated range rate changes sign. A planet pair’s mean cycle is the reciprocal of the difference between its orbital frequencies in absolute value. A Sun–planet window spans one orbital period. Individual encounters can arrive earlier or later in the eccentric, inclined orbits. The planner and field notes also work when WebGL is unavailable.

The expanded Node suite independently checks the extrema of all 36 pairs, narrow date windows, trail positions, camera framing and field notes across reloads. Recording WebGL tests check that motion trails reuse their buffers while the clock advances and keep their existing data while paused. Time jumps and resizes now clear stale map labels immediately, and closing a dialog after graphics loss restores focus to an available control.
