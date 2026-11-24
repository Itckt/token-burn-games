# Slipwake · Relay Yard

An original, offline 3v3 arena brawler built with plain JavaScript and raw WebGL. You pilot Coilrunner, the teal runner with the amber ring. Two bot crewmates fight alongside you against three coral rivals on a floating freight deck. The Kowloon Tong campus crew has the yard for one lunchtime scrim.

## Play

Keep `index.html`, `styles.css`, and the `src` folder together. **Double-click `index.html`** in a desktop browser with WebGL enabled. All code, geometry, shaders, and sounds come from local files. The game runs directly from disk with a keyboard and mouse.

Pick a mode, then choose **Deploy**, press **Enter**, move with **WASD**, or left-click the deck to start. **Team skirmish** is the default and plays to **12 knockouts**. **Relay run** plays to **3 core deliveries**. In **Signal shift**, hold a rotating station to earn **30 signal points**. In **Freight tug**, escort a rail cart to score **2 hauls**. After **three minutes**, the higher score wins and equal scores draw.

From the result screen, **Tactical replay** shows the round on a map with a time slider. **Play again** starts a fresh round in the same mode. **Choose mode** returns to deployment, where **Edit deck** lets you equip three tactics.

| Control | Action |
| --- | --- |
| W A S D | Move up, left, down, and right relative to the screen. |
| Mouse | Aim at the deck or directly at a rival. |
| Left mouse button | Click for one pulse-driver shot. Hold for repeated fire. |
| Right mouse button | Mark a rival for both crewmates to focus. Right-click away from rivals to cancel. |
| Space | Slip dash in your movement direction. Standing still sends you along your aim. |
| E | Release an arc pulse that damages and pushes nearby rivals. |
| F | Raise the return vane just before a bolt hits. You can also click its tile beneath your health. |
| 1 or 2 | Play the card in that hand slot. You can also click its tile. |
| R | Mark open deck under the cursor for your crewmates to rally. Move the pointer off the arena to call them to you. |
| Q | Pass the relay core toward the pointer. The dashed line previews the first catch or obstacle. |
| C | Open or close the six-runner crew sheet. A live round pauses while you read it. |
| Esc | Pause or return to the yard. The pause menu also offers a restart. |
| ? or / | Open or close the field guide. |
| M | Toggle sound. Sound starts muted. |

Cargo, vents, and barriers block shots and pulses. A slip dash can dodge an incoming bolt, but stops at cover. The ability tiles count down until each skill is ready again. A knocked-out runner returns to their team's bay after **3.2 seconds** with full health and a **1.25-second shield**. On the radar, circles mark teammates, diamonds mark rivals, and the amber ring marks you.

Switching away pauses a live match. If the graphics context reconnects, the same round waits in the pause menu. If WebGL is unavailable, the page displays recovery instructions.

## Run the tests

From this folder, run the following command with Node.js. The suite was verified with the already-installed Node **22.22.3**.

```sh
node tests/run.js
```

The runner uses Node's built-in test library in a single process. It needs no packages, server, browser, display, or network connection. The tests cover projection and picking, mesh winding and normals, navigation routes, swept collisions, damage, cooldowns, respawns, win conditions, particle lifetimes, and complete seeded bot matches.

Integration tests load the real HTML and scripts into a Node VM. They drive keyboard and pointer events, advance an animation clock, and check the HUD, sound controls, pause, rematches, and graphics recovery. A recording WebGL test double checks shader structure, matching varyings, uniforms, vertex-buffer bounds, and draw calls. GPU shader compilation, rendered appearance, and hardware frame rate require a WebGL device.

## How it works

- `src/math.js` handles column-major matrices, ray projection, vector operations, and swept intersection tests.
- `src/arena.js` supplies the layout shared by the meshes, collision rules, radar, and bot navigation grid.
- `src/game.js`, `src/controls.js`, and `src/effects.js` implement the fixed 60 Hz simulation, buffered inputs, and bounded particle effects. A seeded random generator makes matches reproducible for tests.
- `src/mesh.js` and `src/art.js` build the runners, cargo court, crane, and harbour scenery from triangles.
- `src/renderer.js` draws the lit arena, animated water, and particles through a damped overhead camera. Static meshes and the sun shadow map are built once per graphics context. Particle effects share one draw batch, and the render resolution is capped.
- `src/pickup.js` checks which runners can claim an objective. `src/relay.js`, `src/signal.js`, and `src/supply.js` apply the rules for cores, stations, and crane drops.
- `src/hud.js` and `src/hud-art.js` draw the live displays. `src/menus.js` builds the field guide, deck editor, crew sheet, and results. `src/client.js` handles input, optional synthesized audio, and the animation loop.

The pure logic files expose CommonJS exports to Node and share a small namespace when loaded as classic scripts by the local HTML page.

## Round 2

### Relay run

Pick up the gold core at midfield and carry it through the opposing gate. Your crew attacks east. The gold hexagon on the radar follows the core, and chevrons on the deck point a player carrier toward the gate. Bots escort their carrier and intercept the other crew’s.

Both crews in pickup range contest the core. Shielded and dashing runners sit out the pickup. A carrier can fire and play cards, moves at 82% speed, and regains the dash after releasing the core. A knockout drops it on the spot. Either crew can recover it after half a second, and an unattended core returns to midfield after eight seconds. Make a personal delivery in the final five seconds for the campus crew’s **Deadline delivery** callout.

### Tactic deck

Both modes start you with two cards in hand, one in reserve, and four energy. One energy returns every three seconds up to a total of six. A successful play draws the reserve into the slot you used and sends the played card to the back.

| Card | Energy | Effect |
| --- | --- | --- |
| Fork coil | 3 | Fire three 18-damage bolts in a fan along your aim. Your pulse driver keeps its own firing rhythm. |
| Patch reel | 2 | Restore up to 32 health to yourself and each nearby crewmate in sight. If nobody needs a repair, you keep the card and energy. |
| Catch net | 3 | Anchor a field at your feet for 3.2 seconds. It catches hostile bolts at the rim, lets friendly shots through, and leaves arc pulses in play. |

### Crew rallies

Press **R** to send both crewmates to the mint pennant for six seconds. They route around cargo and keep firing on the way. A new valid order moves the flag. A teammate carrying the core keeps heading for the goal. The flag appears on the radar and the control hint counts down its lifetime.

### Simulation and verification

Bot targeting and steering now live in `src/bots.js`. The core and card rules live in `src/relay.js` and `src/deck.js`. Fork coil and the pulse driver share swept projectile collisions. The core and gates use cached meshes, while the rally flag, catch net, and new particle effects share the existing draw batch.

The Node suite grew from **50 to 82 tests**. It covers contested pickups, goal-line knockouts, card exchanges, repairs behind cover, net expiry during a bolt crossing, and both crewmates reaching a rally around cargo. Regression tests cover a bot pinned at a corner, unequal shield and respawn timing, and a quick click losing its original aim. The page tests also exercise mode selection, the hand and energy display, rematches, and context recovery with a live core and net.

## Round 3

### Crane supplies

In all three modes, watch for a boxed cross on the radar. The first crane signals 15 seconds into play and lowers a blue crate over the next three seconds. Walk into its ring to restore up to **35 health** and gain **28% movement speed for five seconds**. The boost works while carrying the core. A knockout ends it.

A crate stays on deck for ten seconds. Both crews in range contest it. Once the ring clears, the closest eligible runner collects it. The hoists alternate every 28 seconds, even if somebody collects early. One nearby wounded bot from each crew can break off for supplies. A rally takes priority and a core carrier keeps running for the gate.

### Focus fire and the crew sheet

Right-click a rival to call the target for **five seconds**. Amber brackets on the radar and a tag over the runner identify the mark. Both crewmates aim at that rival while following their movement orders. Right-click a different rival to change targets, or right-click clear space to cancel. Cover still blocks their shots.

Press **C** or choose **Crew sheet** below the radar to see both teams' knockouts, assists, deaths, damage, and repairs. The last column tracks crates in skirmish, deliveries in relay, and points each runner helped secure in Signal shift. The result menu keeps the final sheet available.

You earn an assist when a crewmate knocks out a rival you damaged in the past six seconds or finishes your active focus target. Each helper gets one assist per knockout. Three assists in a skirmish earn a small nod to campus group projects.

### Stations, passes, and custom decks

- **Signal shift** moves between Midships, North slip, and South slip every 18 seconds. One uncontested second earns one team point. An empty or contested ring clears partial progress. The next site lights up four seconds before the change. Both outer circles now fit entirely on walkable deck.
- **Relay passing** gives the carrier an eight-unit throw on **Q**. Teammates can catch it, rivals can intercept, and a missed throw leaves a loose core. Bots look for a clear forward pass under pressure. A catch inside the opposing gate counts at the horn.
- **Edit deck** sets both hand slots and the reserve from five original cards. **Bank lens** costs three energy and sends a 34-damage bolt off one wall. **Haul line** costs two and pulls the first exposed rival toward you. A failed pull keeps the card and energy. Equipped decks carry across modes and rematches for the current session.

### Fixes and verification

Core pickups, station control, and supplies now share eligibility and contest checks. Swept bolts and passes respect the instant a shield or dodge ends within a tick. The renderer reuses one crate mesh and draws the crane cables, landing marks, orders, and particles in the existing effects batch.

Run `node tests/run.js` for all **130 tests**. The Node suite covers crate timing and bot detours, focus calls while firing, assist windows, crew-sheet navigation, deck editing, ricochets, interceptions, and last-tick deliveries. The offline page tests also check that the supply mesh stays cached and that graphics recovery preserves an active speed boost.

## Round 4

### Freight tug

Walk into the ring around the rail cart to push it toward the **east depot**. A second and third escort each add speed. One rival in the ring can stop the whole crew. An empty cart stays put, and rivals with sole control take it west. The freight gauge shows direction, distance to the depot and escort count. Twin rails mark the route on the radar.

Each docking scores one haul. Every eligible crewmate in the ring at docking gets credit on the crew sheet. After two seconds the cart returns to midfield for the next run. First to **two hauls** wins. Bots take separate escort positions around the cart, which carries a pair of insulated lunch tins for the Kowloon Tong canteen run.

### Return vane

Press **F** for a **0.3-second** window. Any hostile bolt that hits Coilrunner during that window reverses along its incoming path. It keeps its damage and remaining flight time, so a close-range return can knock out the shooter. The violet trail identifies a returned bolt, and its damage counts toward your stats.

The vane recharges in **four seconds**. You can move, fire and play cards while it is raised. A dash folds it immediately. Arc pulses still reach you, and a spawn shield absorbs incoming bolts until it expires.

### Tactical replay

Choose **Tactical replay** on the result screen to review the whole round. The map shows six numbered runners, their health, the objective, the score and two seconds of movement trails. **Play** runs the tape. Drag the time slider or focus it and use the arrow keys to move one second at a time. **Previous play** and **Next play** jump to knockouts, returns, catches, deliveries, station scores and shifts, or freight dockings. Plays on the same tick share one stop.

The recording stays in memory for the current round. Switching away pauses playback. **Esc** or **Back to result** returns to the final score, and a rematch starts a fresh recording.

### Timing and verification

Freight and signal control now credit only the portion of a tick during which each escort is eligible. A shield expiring exactly at the horn can change who occupies the ring without adding hold time or cart travel. The live HUD and replay share the radar drawing code and the same ordered stream of match events. The renderer uploads the trolley and rails once per graphics context.

Run `node tests/run.js` for **163 tests**, including **33 added in Round 4**. They cover partial-tick contests, docking at the horn, bolt returns after a ricochet, replay seeking across knockouts and respawns, keyboard navigation, and recovery of a finished tape after graphics interruption.
