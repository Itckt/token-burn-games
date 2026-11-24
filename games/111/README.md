# Weirlight

Take the night shift at a fictional Kowloon Tong spillway. Build towers along its bends and time discharges as the tide moves toward the lamp. Hold 20 waves to see dawn. You can then clock off for milk tea before the first lecture or keep the same defense running in overtime. A **Crownwake boss arrives every tenth wave**, including in overtime.

## Start a watch

From this folder, run the game with Python 3.10 or newer. It uses only the standard library. An 80-column by 24-row terminal fits the watch board.

```console
python weirlight.py
```

You start in the workshop with **42 brass** and **12 gate strength**. Enter these three orders, one per line, for a working first defense. The Pinrail fires at the first bend and the Washbell catches survivors on the return stretch.

```text
build C pin
build F bell
go
```

Follow the arrows from **1 Inlet** through **2 Basin** and **3 Sill** to the lamp marked **O**. A tile such as `CP2` means pad C holds a tier-two Pinrail. Parentheses mark one enemy. Braces mark a stack. The panel beside the road counts every enemy in each reach.

## During a wave

The clock runs in real time. Press a key during combat to act immediately.

| Key | Action |
| --- | --- |
| `1`, `2`, `3` | Discharge the corresponding reach. Hit every enemy there for 3 charge total. |
| `J`, `K` | Play the signal card in that slot. Type `deck` in the workshop to inspect or change the pair. |
| `V` | Open the sluice armed in the workshop. Push enemies back into tower range once per wave. |
| `Space` or `P` | Pause or resume. You can discharge while paused. |
| `.` | Advance one beat while paused. |
| `F` | Switch between normal and triple speed for this wave. |
| `Q` | Clock off and print your record. |

Charge starts at 3, refills by one every five beats and caps at 6. An empty reach costs nothing to target. A Crownwake grows a fresh shell as it enters each reach. Its shell absorbs tower hits. A discharge strips the whole shell and deals its usual damage, so catching the boss just after a crossing buys your towers more time to hit its exposed hull.

## Between waves

Dispersed enemies earn brass, and holding a wave pays a bonus. Ripples and speedy Glasskates take 1 gate strength if they get through. Slow Ballasts take 2. A single Crownwake reaching the lamp ends the watch.

| Design | Build / tier 2 / tier 3 | Role |
| --- | --- | --- |
| `pin` · Pinrail | 18 / 20 / 32 brass | Focused hits on the frontmost enemy in range by default. Fires every beat at tier three. |
| `bell` · Washbell | 24 / 24 / 36 brass | Hits the target and every enemy within two road cells of it. |
| `loom` · Silt Loom | 20 / 18 / 30 brass | Slows its target for three beats. Pair it with another tower at a bend. |
| `coil` · Wickcoil | 22 / 22 / 34 brass | Links a shot through up to two, three or four enemies as it gains tiers. |

Each tower acquires its first target by horizontal plus vertical distance from its pad. Try a range survey to see which stretches it can cover.

| Workshop order | Effect |
| --- | --- |
| `look D loom` | Mark the proposed tower's coverage with stars. Use `look D` for an installed tower and its next upgrade price. |
| `build D loom` | Install the chosen design on an empty pad from A through H. |
| `up D` | Buy the next tier on D. |
| `sell D` | Salvage three quarters of all brass spent on D, rounded down. |
| `mend` | Spend 12 brass to restore up to 3 gate strength. |
| `sluice 2` | Arm the Basin crank for combat. Type `sluice` to inspect the setting and rules. |
| `drill` or `drill 7` | Compare the next standard and rush waves with this loadout. A beat number schedules a practice sluice release. |
| `save` | Write a checkpoint for `python weirlight.py --resume`. |
| `go` | Launch the forecast wave. |
| `help` | Open the field guide with damage, range and firing intervals for every tier. |
| `quit` | End the session and print your record. |

## Play at your own pace

```console
python weirlight.py --step
```

Step mode uses the same rules and waits for each order. During a wave, press Enter for one beat, type `step 5` for five beats, or type `run` to let your towers finish the wave. Type `1`, `2` or `3` and press Enter to discharge between beats. Both `step` and `run` stop when the wave ends. Redirecting input or output also selects step mode, as does a terminal reporting `TERM=dumb`. Set `NO_COLOR` to keep a live watch monochrome.

## Run the tests

From the same folder, run the standard-library test suite.

```console
python -B -m unittest discover -v
```

The tests exercise targeting, movement, upgrades, refunds, discharges, boss shells and terminal controls. A command-line playthrough buys towers with earned brass, holds all 20 campaign waves and defeats the wave-30 boss in overtime.

## Round 2

**Signal deck.** Equip two different cards between waves with an order such as `deck echo brace`. The first card goes on **J**, the second on **K**. A new watch starts with Net and Echo. Each slot draws from the same charge meter as discharges and refreshes at the next launch. Play either card once per wave, even while paused. In step mode, enter `j` or `k` between beats.

| Card | Charge | Effect |
| --- | --- | --- |
| `net` · Slackwater Net | 2 | Slows every enemy currently on the road for five beats. Later arrivals enter at full speed. |
| `echo` · Echo Reel | 3 | Every tower with a target fires immediately using its aim order. Its normal reload continues on schedule. |
| `brace` · Cork Brace | 2 | Absorbs up to three points of gate damage across this wave's leaks. A Crownwake pierces it. |

Trying a Net on an empty road or an Echo with nothing in tower range keeps both the card and its charge.

**Tower aim.** Use `aim C heavy` to make C prioritize the most remaining hull and shell combined. `front` is the default. A Washbell can also use `pack` to catch the most enemies in one splash, including neighbors just outside its range. Ties go to the enemy closest to the lamp, then the earliest arrival. `look C` shows C's current order.

**Rush contracts.** Compare `forecast` and `forecast rush` to see the exact entry beats. Launch with `rush` to bring in the same roster two at a time. An odd final arrival enters alone. Hold a rush without a leak to earn twice the usual wave bonus, plus bounties. Even a fully braced leak forfeits the extra brass. Choose `go` at any workshop for a standard wave.

**Firing report.** Type `report` to see shots, enemies hit, and kills for each pad in the latest wave. Echo shots count for the firing tower, and discharges have their own kill total. The report keeps the tier and aim used for that wave while you rebuild. You can also inspect it between beats in step mode. A breach prints it automatically.

### Last-train drill

The HKBU night crew keeps this opener on the back of a milk-tea receipt. Try it in a fresh `--step` watch.

```text
build C pin
build F bell
aim F pack
deck echo net
forecast rush
rush
step 4
j
run
report
```

At beat four the first pair is inside C's range. The extra shot helps hold the gate at 12, and the clean rush leaves 16 brass for wave two.

Regular and Echo shots now share their targeting, splash, and kill accounting. The Unix live controls consume whole function-key sequences so pressing Delete or a function key cannot accidentally spend charge or pause the wave. The expanded tests cover both input modes, paired boss escorts, braced leaks, and kills that end a wave between beats.

## Round 3

**Wickcoil.** Try `look B coil` to survey its first shot. Once it hits, the current jumps to the nearest unhit enemy within three road cells of the last one, even around a bend or beyond the pad's range. Each link deals full damage. The three tiers can hit two, three and four distinct enemies per shot. Aim sets the first target. For later links, equal distances favor the enemy farther downstream, then the earlier arrival.

**Spillback sluice.** Use `sluice 1`, `sluice 2` or `sluice 3` in the workshop to arm the Inlet, Basin or Sill. The setting lasts until you change it or enter `sluice off`. During the wave, press **V** (or enter `v` in step mode) for one free release. Ripples and Glasskates slide upstream up to three cells. Ballasts and exposed Crownwakes move one. The reach entrance stops the push, and a boss with any shell left holds its ground. If nobody moves, the crank stays ready. You can pause, strip a shell with a discharge, then open the sluice on the same beat.

**Tide drill.** Type `drill` to run your towers through both versions of the next wave on practice boards. Compare the first leak beat, gate strength, brass earned and kills per pad. Your watch stays in the workshop. The crew holds its cards and discharges during drills. With a sluice armed, `drill 7` also tests what happens if you open it just after beat seven.

**Shift checkpoint.** At the workshop or the dawn prompt, type `save` and then `quit` to take a break. Resume with `python weirlight.py --resume`, adding `--step` for untimed play. Each save replaces `weirlight-watch.json` beside the game script. It carries your gate, brass, charge, towers, deck, sluice, record and last firing report into the next session, including overtime.

### Seven beats before class

The HKBU night crew can squeeze this crank drill in before the first lecture. Start a fresh `--step` watch and enter one order per line.

```text
build B coil
build A pin
sluice 1
drill
drill 7
rush
step 7
v
run
report
```

Left alone, this rush costs two gate strength. On beat seven the crank catches three enemies and gives the towers time to disperse all four. The gate holds at 12, and the clean rush earns 16 brass, leaving 18 for the next shift.

A 30-wave test picks each launch from the tide drill, checks the outcome against the forecast and resumes from a checkpoint after each boss. Other tests cover interrupted saves, Wickcoil links and sluice timing. Holding the speed key now keeps the wave clock moving. Unix combat consumes Alt-key sequences and bracketed pastes, and discharge orders validate the reach before spending charge.
