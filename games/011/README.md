# Isobar Storm Lab

An offline, interactive 3D typhoon visualizer set in Kowloon Tong. Raise the warning signal from **1** to **10**: three spiral cloud bands tighten around an open eye, rotation accelerates, and rain becomes denser, faster and more slanted. Wind speed, rainfall rate and central pressure track the simulated storm. The ten levels are a teaching scale, **not official warnings or live weather data**.

## Run it

Double-click **`index.html`** in a modern browser with JavaScript and WebGL enabled. Keep `styles.css` and the `js/` folder alongside it. No installation, server, build step or internet connection is needed; Node is only for the tests.

The storm starts at signal 5 in Orbit view. If your device requests reduced motion, it starts paused; select **Resume simulation** to animate it. If WebGL cannot start, the viewport explains the problem instead of leaving a blank canvas. The controls guide and signal readouts remain available.

## Controls

| To… | Use… |
| --- | --- |
| Raise or lower the signal | The slider, its − / + buttons, or ↑ / ↓. A slider also stays within reach in expanded view. |
| Orbit or tilt the camera | Drag with a mouse or one finger; use A / D to orbit and W / S to tilt. |
| Zoom toward or away from the eye | Scroll, pinch, or press + / −. |
| Compare camera angles | Select **Top-down** (T) or **Orbit** (O). **Reset view** (R) restores the starting camera without resetting the storm. |
| Freeze or slow the storm | Use the pause button or Space. Select 0.5×, 1× or 2× for playback. You can still change the signal and camera while paused. |
| Isolate a layer | Toggle **Cloud bands**, **Rain streaks** or **Reference grid** independently. Hiding a layer does not change the readings. |
| Expand or leave the viewport | Use the expand button or F; Esc also exits. If native fullscreen is unavailable, the viewport expands within the page instead. |
| See the shortcuts | Select **Controls** or press **?**; dismiss with Esc. |

**HKBU study-break drill:** Try a three-card “deck” of signal settings: 1, 5 and 10. Pause in Top-down view and compare them at the same instant. Then switch to Orbit, hide the clouds and resume at 0.5× to see how the wind bends each rain streak.

## How the scene works

- `js/storm.js` generates two seeded particle populations. Changing the signal brings more particles into view without reshuffling the existing bands. From the lowest to the highest level, the cloud count rises from 740 to 1,800 and the rain count from 140 to 2,800. During playback, strength eases toward the new level; while paused it changes immediately for comparison.
- `js/math.js` and `js/geometry.js` implement the camera, projection and meshes. `js/textures.js` generates the water noise and four cloud sprites. Each sprite encodes surface normals and translucent edges so the billows catch light as the camera orbits.
- `js/shaders.js` and `js/renderer.js` draw the sea, rain lines, lower cloud sheet and depth-sorted cloud billboards with raw WebGL 1. Four batched draws, reused buffers and a roughly 1.5-megapixel render cap target smooth 60 fps playback; actual frame rate depends on the device.
- `js/app.js` handles input and animation; `js/ui.js` draws the compass, icons and telemetry traces. Animation stops in hidden tabs, so returning to the page does not fast-forward the storm. Classic scripts work directly from a local file; the logic modules also export to Node for testing.

## Run the tests

With Node.js 22 installed, run this from the project folder:

```sh
node tests/run.cjs
```

The runner discovers every `tests/*.test.js` suite and uses only Node's built-in test runner, assertions and standard library. It prints a TAP summary and exits nonzero on failure. To run just the storm-model tests, use `node tests/storm.test.js`.

Tests cover all ten signal levels, seeded geometry, rotation and rain motion, frame-rate independence, camera projection, procedural textures, shader interfaces and local script loading. DOM and WebGL test doubles exercise the real entry point, draw calls and buffer bounds, keyboard and touch controls, fullscreen, reduced motion, pause/resume and context loss/restoration. They do **not** open a browser, compile shaders on a GPU or measure GPU frame rate.

## Round 2

| Instrument | How to use it |
| --- | --- |
| **Wind field** | Select **Wind field** or press **G**. Colour gives surface wind speed in km/h. Arrows trace counterclockwise flow angled toward the eye, with beads travelling toward each arrowhead during playback. The probe reports the flow bearing clockwise from north. At the exact centre the bearing is undefined and displays as a dash. Press **G** again for clouds, or **V** for rain radar. |
| **Eyewall section** | Select **Section** or press **X**. In Cloud view the cut removes the half of the clouds and rain facing the camera. An amber line marks the same diameter on the sea, wind map and radar. Rotate **Axis bearing** and choose wind, rain or pressure to plot the surface reading every 2 km, from 120 km on one side of the eye to 120 km on the other. Drag the graph or focus it and use the arrow keys. **Place probe here** moves the probe to the ring on the line. |
| **Field notebook** | **Capture A** and **Capture B** save the current storm instant and probe location. Closing the probe selects the eye for capture. The table shows both local readings and the signed difference, B minus A, at the displayed precision. **Inspect** pauses at the saved instant and places the probe there. Life-cycle observations reopen at their stage. Manual observations preserve their actual strength, even partway through a signal change. |

Each notebook slot can be replaced or cleared independently. Observations survive reopening the file when the browser allows local storage. If storage is blocked or full, the status line identifies the save as temporary and both slots work until the page closes.

**Kowloon Tong field practical.** Jump to **Peak** on the life-cycle curve and open **Section**. Capture the eye in A, then drag the wind profile to either crest and choose **Place probe here**. Capture B. The two wind readings now compare locations at exactly the same storm time.

The wind map uses one WebGL draw. It shares the probe's eyewall radius, wind falloff and inflow angle. The cut clips the existing particle geometry in the shaders. Moving its cursor or orbiting a paused storm reuses the profile samples. Context restoration also reuses the procedural cloud and sea pixels.

The Node suite now checks wind direction and speed, the cut from opposite camera angles, all 121 profile samples against the probe, and exact notebook replay after reload or context loss. Regression cases cover damaged notebook entries, blocked storage, degenerate camera up vectors, interrupted fullscreen exits and invalid life-cycle times. Renderer cleanup releases its vertex attribute bindings before another renderer uses the canvas. Run the full suite with `node tests/run.cjs`.

## Round 3

### Pressure relief

Select **Pressure** or press **I** to see the storm’s pressure field as a shaded 3D bowl. Its depth represents the pressure drop below 1012 hPa. Pale contour lines are 10 hPa apart. Raise the signal, then tilt the camera to see the eye deepen. With **Probe** open, tapping samples the visible surface, including the near rim when it hides the eye. The section line and its cursor follow the terrain. Press **I** again to return to clouds.

### Parcel drift

Open **Probe**, choose **15**, **30** or **60 min**, then **Trace from probe**. The coral ring marks release and the diamond marks arrival. The trail follows the local wind speed and inward flow angle, holding the storm at its release conditions for the projected journey. If the parcel comes within 1 km of the centre, the trace ends there. The readout gives elapsed travel time and distance travelled.

Tracing from Cloud view opens the wind map. Change the travel time to compare journeys from the same release. **Probe arrival** samples the destination in the current storm. **Clear trail** or closing the probe removes the trace.

### Station recorder

Start a recording at the open probe or at the current eyewall with the probe closed. The station stays at those coordinates as the storm rotates. It samples immediately and once per model second, plots local rainfall, and tracks peak wind, lowest pressure and accumulated rain. Rain depth in mm integrates successive rates in mm/h over their actual time interval.

**Stop recording** includes the final partial second. A two-minute limit, the end of the life cycle, a timeline seek or inspecting a notebook entry also finishes the log. Pausing, hiding the page or losing the graphics context suspends sampling. **Save CSV** downloads timestamps, signed east/north coordinates in km, signal, all three local readings and accumulated rain. A new recording replaces the previous log on the page.

**Between classes at HKBU.** Pause at Peak, place the probe in an outer band and start a recording. Trace a 30-minute journey, choose **Probe arrival**, then resume. Compare the rain passing the fixed station with the reading at the parcel’s destination.

The relief mesh uses one depth-tested WebGL draw and reuses its buffers. The parcel trail shares the existing surface draw. Picking and rendering use the same mesh triangles, and the maps share their colour scales with their legends. Stationary pointer events now preserve Top-down view, and the life-cycle curve, chapter marks and cursor align with the slider thumb at both ends.

Run `node tests/run.cjs` for the complete offline suite. Round 3 checks terrain occlusion and picking, drift against an independent integration of the wind vectors, and station timestamps and CSV totals through signal changes, pauses, seeks and graphics interruptions.

## Round 4

### Doppler wind

Choose **Radar → Doppler wind**, or press **B**. The map shows how fast the surface wind moves along the line from a simulated antenna. Teal indicates motion toward the antenna and amber indicates motion away. Wind blowing across the beam gives a reading near zero even when the wind itself is strong.

Choose **Campus roof**, **Ferry pier**, or open the surface probe and select **Use probe** to put the antenna there. The white ring marks the antenna. The 30 km grid rings are centred on it. Move the probe again to read radial wind at another point. A dash marks an undefined direction within ten metres of the antenna or storm centre. **Rain rate** returns to the rainfall map.

### Compare clouds with a map

Select **Compare** or press **C**. Clouds appear on the left and the selected map on the right. Starting from Cloud view opens rain radar. Drag the handle, use the arrow keys for 1% steps, or press Home or End to see either view at full width. Orbit, zoom, change signal or scrub the life cycle to inspect both views at the same instant.

The probe samples the visible surface on the side you tap, including the sloping terrain in Pressure. Each side places its eye and probe markers at its own surface height. Turning Compare off fills the viewport with the selected map. Choosing **Cloud view** closes the comparison and returns to the clouds.

### Sky lighting

Use **Sky lighting** under Display layers to set an idealized local solar time in 15-minute steps. Light rises in the east, warms at the horizon and gives way to cool moonlight. Turn the camera to see the glint move across the water and the highlights shift over the cloud billows. The dial also works with playback paused. Instrument colours and measured values keep their calibrated scales throughout the day.

**HKBU rooftop practical.** Choose **Peak**, open **Doppler wind** and place the probe on **Eyewall**. The campus roof measures 169 km/h away. Switch to the ferry pier and the same air moves 62 km/h toward the antenna. The local wind speed beside the radial reading stays the same.

Both halves share one camera and one simulation clock. WebGL clips draws and depth clears at the divider and skips a fully covered side. Lighting changes reuse the particle buffers. The two wind maps share a shader implementation of the surface flow. Repeated expand commands now share one pending fullscreen transition, so leaving native fullscreen restores the page layout.

Run `node tests/run.cjs` for the complete suite. The new Node tests check radial speed against changes in antenna range, sunlight through midnight and both horizons, the drawing-buffer split at different pixel densities, probe placement on either side, keyboard controls and graphics restoration.
