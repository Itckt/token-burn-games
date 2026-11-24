# Half Past Tea · 半刻茶餐廳

Explore a miniature Kowloon Tong cha chaan teng at half past three. Steam curls from the milk tea, red stools line the counter, and a ginger shop cat has claimed the front mat. Click one of eight objects to open its illustrated order slip, or take the window seat and tune the little wooden radio beside the pineapple bun.

## Open the café

Double-click **index.html** in a desktop browser with WebGL enabled. Keep **style.css** and the **js** folder beside it. The page runs directly from disk and works offline. All geometry, artwork, signs and shaders are generated from the included source.

The camera starts with a slow sweep across the open side of the cutaway. Dragging takes over the camera and allows a full revolution. The **Auto-orbit** button resumes the sweep from your current angle.

## Controls

| Action | Mouse or touch | Keyboard with the scene focused |
| --- | --- | --- |
| Orbit and tilt | Drag across the scene | Arrow keys |
| Zoom | Scroll, pinch, or use the − and + buttons | − or + |
| Inspect an object | Click or tap the model, its pin, or its index entry | 1 through 8 |
| Browse order slips | Use the arrows on the slip | Tab to an arrow and press Enter |
| Pause or resume the camera | Select Auto-orbit | Space |
| Return to the original view | Select the circular reset arrow | R or Home |
| Expand or restore the view | Select the corner-bracket button | F, or Escape to return |
| Take a seat | Choose a place from **Take a seat**, then drag to look around | V cycles seats, arrow keys look around, Space stands up |
| Inspect up close | Select **Close-up** or **Wide view** | C |
| Change the weather or fan | Choose a window setting or press **Fan** | W for weather, B for fan speed |
| Make a postcard | Select **Postcard**, then **Save PNG** | P opens the preview |

Use the pin button to see every object label visible from your side of the café. Click the scene or Tab to it to give it keyboard focus. **How to explore** opens the control guide. Small screens and expanded views show the chosen caption inside the scene as well.

**Tea bench** opens a four-measure recipe. Add tea and milk, use **Undo** to adjust the mix, then **Serve cup**. **Take a ticket** starts the counter shift.

With reduced motion enabled, the camera starts paused, the steam and fan hold a still pose, and the cat goes directly to the spot you choose. If WebGL is unavailable, the illustrated index, tea bench, counter tickets, radio controls and postcard prints remain usable. Audio starts when you choose **Listen** on a browser with Web Audio support.

## Run the tests

From this folder, run the following command with Node.js. The project was verified with Node **22.22.3**.

```sh
node tests/run.js
```

The runner uses Node's built-in test framework in a single process. It prints a TAP summary and returns a nonzero exit code on failure. Tests cover the following behavior.

- Matrix conventions, mesh winding and normals, 16-bit batching, texture coordinates, and scene framing.
- Time-based orbit and zoom, three steam emitters, touch gestures, picking coordinates, and animation suspension.
- Depth-tested selection of all eight objects using an independent CPU triangle rasterizer, including checks from inside the café and behind the back wall.
- Startup through the actual HTML script sequence, illustrated slips, keyboard and pointer controls, resizing, expanded view, and recovery from graphics failures.
- GLSL structure and stage interfaces, buffer bounds, texture bindings, render-pass order, and graphics resource cleanup.

The entire suite runs from the command line. GPU-driver shader compilation and frame timing take place on the viewing device.

## Inside the miniature

| File | Responsibility |
| --- | --- |
| `index.html`, `style.css` | Scene viewer, control guide, order slips and responsive object index |
| `js/math.js`, `js/mesh.js` | Vector and matrix operations, rounded furniture, turned vessels, curved tubes and indexed mesh batches |
| `js/world.js` | Café layout, props, steam sources, pick IDs and captions |
| `js/art.js`, `js/prints.js` | Locally painted signs, window views, radio dial, clock face and eight original illustrations |
| `js/simulation.js` | Camera movement, orthographic framing, pin visibility and steam ribbons |
| `js/seating.js`, `js/sightlines.js` | Eye-level perspective views and checks for furniture between a seat and a pin |
| `js/shop-cat.js`, `js/cat-visit.js` | Cat model, aisle route, walking poses and calls from the object slip |
| `js/radio.js`, `js/radio-player.js` | Radio model, three original scores, local synthesis and playback controls |
| `js/shaders.js`, `js/renderer.js` | Raw WebGL 1 lighting, shadow, steam and picking passes |
| `js/app.js` | Input, object selection, animation and graphics-context recovery |

To target 60 fps, the renderer uploads the stationary café once and bakes its directional shadows at startup. Each ordinary frame draws the ground shadow, the batched café and the feathered steam ribbons. Only the steam vertex buffer changes. Object picking uses a one-pixel depth-tested render target, and the display buffer has a 2.4-megapixel cap.

## Round 2

- Choose **Afternoon**, **Shower** or **Evening** above the scene, or press **W** with the scene focused. A red-roof minibus passes behind all three window frames. Rain runs down the glass during a shower. In the evening, apartment windows light up and the booth lamps and serving hatch cast warm pools of light.
- Select an object and choose **Close-up** or press **C**. Each of the six objects has its own framing. Drag to turn around it, use the arrows beside **Wide view** to visit the next object, or choose **Wide view** to return to your previous angle and zoom.
- Choose **Take a ticket** to work a three-order counter shift. Pick a model, pin or index entry for each clue, or use **1–6** with the scene focused. **Show hint** gives a more direct clue. Correct choices earn stamps. **Put ticket down** pauses the order so you can explore. Progress survives a reload when the browser provides local storage for files. The illustrated index can serve every order if WebGL is unavailable.

The day and evening panoramas and the minibus share the original texture atlas. Weather and traffic use the existing surface draw pass. Reduced motion holds the rain, traffic and steam still and switches close-ups immediately. A stationary reduced-motion view sleeps between inputs.

Pointer and wheel handling now live in `js/gestures.js`. Slow drags include the distance travelled before crossing the tap threshold, and switching windows or hiding the tab releases captured pointers. The urn and cat pins land on their models in close-up. Losing the graphics context moves focus from unavailable scene controls to the illustrated index.

`node tests/run.js` passes **74 tests**, including 19 added this round. They cover the street simulation in `js/street.js`, ticket rules and save recovery in `js/orders.js`, interrupted camera moves, and depth-tested picks in portrait and landscape close-ups.

## Round 3

- **Sit inside the miniature.** The picker beside the compass offers a window booth, counter stool and tea table. Each has a fixed eye position and a perspective lens. Look around, zoom, pick the objects you can see, or make a postcard with the seat name on it. **Stand up** returns to your previous wide angle and zoom.
- **Call the shop cat.** Open slip **06** and choose **Front mat**, **Counter end** or **Booth aisle**. The cat turns, pads around the stools and settles facing the room. You can change its destination mid-walk. Switch to **Close-up** to follow at paw level, or watch its pin move across the wide view.
- **Tune the booth radio.** Open slip **08** and use the station arrows to choose *Cup Rim Waltz*, *Tin Roof Two-Step* or *Last Minibus*. The dial needle moves on the model. **Listen** lights the pilot lamp and plays the tune. Volume is adjustable, and **Silence radio** stays within reach while you browse other slips. A hidden tab silences the radio until you return.

The cat and radio share the café’s existing geometry batch. The lighting and picking shaders use the same positions for moving paws and the tuning needle. The cat’s contact shadow follows it across the tiles, and both mirrored ears now catch light on their outer faces. Seated pins check the furniture along their line of sight. Opening the guide or a postcard releases an active drag so lifting a finger over the dialog cannot stamp a ticket underneath.

**118 tests pass**, including 23 added in Round 3. The Node suite checks near-plane clipping, restoration of a parked view, picks on a walking cat, interrupted calls, reduced motion, graphics recovery, synthesized notes and delayed audio permissions. Run it with `node tests/run.js`.
