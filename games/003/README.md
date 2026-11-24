# Rift Relay

**Neon Causeway** is a three-minute, two-lane card battle on a pair of illuminated bridges above Kowloon Tong. Command the cyan relays on the left against Vanta AI’s pink relays on the right. It’s a rooftop scrimmage you can finish between HKBU classes.

## Play

Double-click **index.html** in a current browser with WebGL enabled. Keep **style.css** and the **js** folder alongside it. The game opens directly from disk. Models, card portraits, lighting, scenery and sound are generated locally.

1. Select a unit from the command deck. To change your four cards, race freight carts or play a short drill, open **Match setup** before the first deployment.
2. Click or tap a lane on the board, or use its **Lane A** or **Lane B** button. Your card deploys at your end of that lane. The clock starts and the opening patrols advance.
3. Spend your next energy on a reinforcement or defend the other bridge. Try a Kiln Ram followed by a Prism Wasp in the same lane. The ram absorbs incoming fire while the wasp shoots from behind it.

In a standard relay battle, destroy both rival relays to win immediately. Each relay starts with 620 health and fires on enemy units in its own lane. At the time limit, the side with more surviving relays wins. Total remaining relay health breaks a tie. Equal totals, or simultaneous destruction of both sides’ final relays, produce a draw.

## Command deck

Both sides start with 7 energy, can store 10, and regenerate 0.46 per second. A played card recharges for 0.78 seconds across both lanes. Each card remains in your hand for the whole match.

In relay battles and field drills, the gold signal cache alternates between bridge centers. Hold the marked center alone for two continuous seconds to earn two energy. Lane guard halves incoming damage to your machines and relay on one lane for five seconds.

| Card | Energy | Health | Attack |
| --- | ---: | ---: | --- |
| Arc Strider | 2 | 108 | Quick twin blades hit for 18 at close range. |
| Kiln Ram | 3 | 248 | The armored vanguard hits for 31 with a short lunge. |
| Prism Wasp | 3 | 88 | A hovering marksman tracks a target with a 21-damage pulse. |
| Coil Mortar | 5 | 156 | A lobbed shell hits for 46 and splashes nearby enemies for 25. |
| Loom Tender | 3 | 102 | Repairs 24 HP on the nearby friendly unit with the lowest health percentage in its lane. Fires a 9-damage pulse when free. |
| Splitpin Pair | 3 | 62 each | Two scouts deploy side by side. Each hits for 11 and can engage a different target. |

Vanta draws from the same four-card hand and pays the same costs and cooldowns. The opening patrols and the scheduled Night Watch waves have fixed lineups. Vanta weighs pressure in each lane and can add a ranged attacker behind an existing vanguard.

## Controls

| Action | Input |
| --- | --- |
| Select a card | Click or tap it, or press **1–4** in deck order |
| Change your hand or match format | **Match setup** before deploying |
| Deploy the selected card | Click or tap the board or a lane button. **Q** deploys to A, **E** to B |
| Guard a lane for five seconds | **Z** for A, **X** for B, or the guard buttons. Both lanes share a 22-second recharge |
| Set a snare coil | Press **F** or choose **Snare coil**, then tap a spot on a bridge. For keyboard placement, choose a socket with **← / →** and place it with **Q / E**. **F**, **Esc** or a card selection cancels aim |
| Pause or resume | **P** or the pause button |
| Switch between oblique and tactical cameras | **V** or the camera button |
| Toggle synthesized sound | **M** or the sound button. Sound starts muted |
| Show the field manual | **?** or **Controls** |
| Read recent deployments and relay losses | **History** |
| Revisit a play | **Watch replay** at the result. Drag the timeline to pause at a tick, or switch between **1×**, **2×** and **4×** |
| Revisit a turning point | Choose an event in **Key plays**. **2s before** pauses at its lead-in |
| Try a different move | **Take command** during a replay. **Original replay** returns to the branching point |
| Expand the console | Fullscreen button in the arena, where the browser supports it |
| Start a fresh match | **Restart match** while paused, or **Play again** after a result |

Controls and History pause live play while open. Switching to another tab pauses the match until you resume. The page respects the system’s reduced-motion preference for ambient motion and camera transitions. If WebGL is unavailable, the arena displays recovery instructions and a retry button.

## Run the tests

From this folder with Node.js installed, run

```sh
node tests/run.js
```

The suite uses Node’s built-in test runner in one process. It was verified with Node 22.22.3. The command reports every test and exits with a nonzero status on failure.

- Simulation tests cover deployment, energy, lane targeting, movement, melee, projectile travel, splash, tower fire, AI decisions, pause, simultaneous kills, time-limit tiebreaks and full seeded matches.
- Geometry tests check matrix conventions, inverse projection, pointer picking, mesh winding, normals, portrait framing and board visibility across camera angles and screen sizes.
- Entry-point tests load the actual scripts in HTML order. A small DOM event harness exercises the controls, audio toggle, dialogs, match results, context recovery and WebGL-unavailable screen.
- A recording WebGL interface checks shader source structure, matching varyings, uniforms, vertex buffer bounds, framebuffer lifetimes and render passes. Hardware shader compilation and display frame rate depend on the browser and graphics driver.

## Implementation

The project uses plain JavaScript and raw WebGL 1. The simulation advances at a fixed 30 ticks per second. The renderer interpolates movement on each animation frame, targets 60 fps, batches the city and board into static meshes and adjusts render resolution under sustained frame pressure.

| File | Responsibility |
| --- | --- |
| `js/math.js` | Vector and matrix math, picking rays and seeded randomness |
| `js/mesh.js` | Flat-shaded triangle meshes, bevels, tubes and extruded polygons |
| `js/models.js` | Original machines, relays, freight tracks, carts and coil geometry |
| `js/arena.js` | Procedural skyline, bridges, battlefield and camera framing |
| `js/roster.js` | Machine definitions, four-slot hands and card swaps |
| `js/drills.js` | Drill openings, waves, objective progress and victory conditions |
| `js/battle.js` | Deterministic simulation, combat, AI and match rules |
| `js/signal.js` | Timed center objectives and capture rules |
| `js/coils.js` | Socket placement, arming, snare effects and AI coil selection |
| `js/freight.js` | Escort counts, cart movement, deliveries and freight scoring |
| `js/replay.js` | Command recording, key plays, checkpoint seeking and practice matches |
| `js/workshop.js` | Match setup and deck editing controls |
| `js/instruments.js` | Scoreboard, cart tracks, objectives, cache and guard displays |
| `js/renderer.js` | Shaders, procedural portraits, lighting, bloom and combat animation |
| `js/app.js` | Input, HUD, sound, match lifecycle and animation loop |

The pure modules expose the same logic to classic browser scripts and Node’s CommonJS loader, so double-click play and command-line tests share one implementation.

## Round 2

**Deck workshop.** Choose a numbered slot in **Match setup**, pick a machine, then **Apply setup**. Choosing an equipped machine swaps the two hotkeys. The four starter cards are joined by the Loom Tender, with a visible repair tether, and the Splitpin Pair, which buys two independent scouts for one cost and cooldown. The browser remembers your hand when local storage is available. The hand also works for the current session when file storage is restricted.

**Deployment preview.** Hover over a bridge or focus a lane button to see a cyan hologram where the selected card will land. The Splitpin Pair shows both positions. The preview follows card recharge and available energy.

**Field drills.** Each drill has a repeatable opening, an objective display and a clock that starts on your first card.

| Drill | Objective | Opening play |
| --- | --- | --- |
| **Parcel Run** · 55 seconds | Escort an HKBU studio model through the green delivery arch on Lane A. The unarmed carrier must survive the tick it arrives. | A ram and a wasp can clear a path together. Save guard for when the carrier comes under fire. |
| **Night Watch** · 45 seconds | Keep the marked Lane B relay online. It starts with 270 HP. Reinforcements arrive 5, 16 and 28 seconds into the watch. | Meet the first attackers on B. The wave countdown gives you time to save energy for the next group. |

**Replay practice.** After any match, drag its replay to a moment before the finish and choose **Take command**. The practice run inherits the machines, projectiles in flight, energy, cooldowns, objective and AI state at that tick. **Retry position** repeats the same opening. **Original replay** returns to that moment with the original result intact.

**Fixes and verification.** Guard credit now measures the HP saved across simultaneous hits. Repair credit counts surviving machines and caps at their missing health. Short drills close the last cache at the buzzer, and switching timelines refreshes the health bars. The Node suite plays and replays all 15 deck combinations across all three formats. It also checks full drill wins and losses, same-tick orders at replay checkpoints, practice isolation, optional storage, 3D models and render passes through the local HTML entry point.

## Round 3

**Freight Shift.** Open **Match setup**, choose **Freight Shift** and deploy your first card to start the 75-second shift. The Kowloon Tong night canteen has a cart on each bridge. Push either cart into the rival dock to score, then its replacement arrives at center four seconds later. The scoreboard counts deliveries. The small rail displays show each cart’s position and who is pushing it.

Up to three machines per side can escort a cart within 1.8 board units along its lane. The side with more escorts pushes, a larger advantage moves the cart faster, and equal numbers hold it in place. Try covering the second bridge while the first cart reloads. Two deliveries win. At the horn the higher score wins and a tie draws. Both lanes settle on the final tick, so simultaneous second deliveries can produce a draw.

**Snare coil.** Once play starts, spend two energy to set a coil at the **Home**, **Center** or **Away** socket on either lane. The glowing frame previews its reach. A board tap chooses the nearest socket, or you can use the socket and lane buttons. After 0.6 seconds the coil arms and watches for six seconds. The first enemy in its field triggers an 18-damage discharge against every enemy machine there. Caught machines hold position for two seconds. They can still attack and repair, and can escort freight again on release. Lane guard reduces the hit. After placing a coil, that side waits 14 seconds before it can use any socket again.

Vanta can spend energy on coils against groups in relay battles and Freight Shift. Parcel Run and Night Watch retain their earlier opponent tactics. **History** reports how many machines each side caught.

**Replay key plays.** In **Watch replay**, select a guard, coil catch, cache capture, wave, relay loss, delivery or result to pause on the tick it happened. The list keeps early events after they scroll out of History. Choose **2s before**, then **Take command**, to try changing the outcome. A practice run gets its own list and clock. **Original replay** restores the selected event and timeline position.

**Fixes and verification.** A stationary pointer now tracks its target as the camera moves. Projectiles and their trails interpolate together between simulation ticks. Malformed card IDs return a deployment error, and playback picks up orders added at its current tick. The battle loop separates combat, objectives and opponent decisions. The scoreboard and tactical indicators share one HUD module.

Run `node tests/run.js` to check the game entirely in Node. The suite plays and replays all 15 hands in all four formats. It also exercises coil expiry and release, contested carts, last-tick deliveries, replay lead-ins, keyboard and touch placement, both cameras and WebGL recovery through the local HTML entry point.
