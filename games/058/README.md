# Steamfold Noodle Works

Run an instant-noodle factory from your terminal. Dough passes through a roller, a steam tunnel and a bag sealer. Finished packs sell automatically by default. Spend the proceeds on faster machinery or better seasoning, fill standing orders, and earn the Brass Ladle charter at 5,000 lifetime packs. You can keep playing after earning the charter.

## Play

From this folder, run the game with Python 3.10 or newer. It uses only the Python standard library, including SQLite.

```sh
python noodle.py
```

The live floor refreshes as the machines work. Press a key to act. For a scrolling transcript with commands entered one line at a time, use `python noodle.py --plain`. Piped input and output automatically select this mode. Run `python noodle.py --slot night-shift` to start or resume a separate factory.

### Your first order

1. Press **O**, then **1** to book the corner counter's 18-pack order.
2. Press **B** three times. At the starting speed, each steam charge produces six extra packs. Those 18 packs sell for 54 coins.
3. Press **D** to collect the 30-coin order bonus.
4. Press **1** on the factory floor to upgrade the dough roller for 30 coins. The steam tunnel now sets the line speed at 40 packs per minute. Press **Q** whenever you want to leave.

### Controls

| Live key | Line command | Action |
| --- | --- | --- |
| **1**–**3** on the floor | `buy roller`, `buy steamer`, `buy sealer` | Upgrade a machine. The `*` marks the slowest station. |
| **4** on the floor | `buy spice` | Upgrade the seasoning bench for one more coin per pack. |
| **B** | `batch` | Spend one steam charge on 12 seconds of extra production. |
| **O** | `orders` | See order sizes, bonuses and unlocks. |
| **1**–**3** in the order book | `order counter`, `order canteen`, `order freight` | Book one order. Its count starts with the next pack. |
| **D** | `deliver` | Collect the bonus for a filled order and free the booking slot. |
| **W** | `stock` | Reserve finished packs, sell a bin or buy more shelf space. |
| **C** | `cart` | Check loads and payouts, then send the lunch cart. |
| **P** | `rota` | Queue a repeating sequence of recipes. |
| **X** or **Esc** | `status` | Return to the factory floor. |
| **?** | `help` | Open the shift guide. |
| **S** | `save` | Save the current shift. |
| **Q** | `quit` | Save and exit. |

Line mode also accepts the single-key shortcuts followed by Enter. An empty line refreshes the current view.

## Factory economics

You start with 36 coins, three steam charges and a working line. The three machines handle 30, 40 and 50 packs per minute respectively. The slowest sets the factory's output, so the first roller upgrade raises sales from 30 to 40 packs per minute. A machine upgrade adds 30 to that machine's capacity. Seasoning starts at 3 coins per pack. All four stations have ten levels, with the next price shown on the floor.

The boiler restores one charge every 30 seconds and holds three. A manual batch uses the current line speed and follows the same stockroom and sales rules as regular production.

| Standing order | Unlock at lifetime packs | Packs to fill | Delivery bonus |
| --- | ---: | ---: | ---: |
| Corner counter | 0 | 18 | 30 coins |
| Kowloon Tong canteen | 90 | 72 | 150 coins |
| Night ferry freight | 450 | 240 | 600 coins |

Wholesale sales continue while a filled order waits for delivery. Each customer will book again after you collect their bonus.

## Saves and offline earnings

The game creates `steamfold.sqlite3` beside `noodle.py`. The default slot is `main`. All named factories share the ledger and keep independent balances. Each action saves immediately. The live floor also saves every 15 seconds, and a normal exit, Ctrl+C or end of input saves the shift.

On return, the game credits up to **eight hours** of production since the last save, using the saved machines, recipes and stockroom settings. It carries partial packs forward, refills the boiler and fills booked orders from fresh wholesale shipments. The opening receipt shows packs sold and coins earned. For example, one hour away on the starter line earns **1,800 packs and 5,400 coins**. Collect any completed order bonus with **D**.

The eight-hour limit applies to each gap between saves, including a suspended computer or a plain console left waiting for input. If the clock moves backward, the ledger keeps the latest time already paid and resumes production when the clock catches up.

## Run the tests

```sh
python -B -m unittest discover -s tests -v
```

The suite checks production timing, upgrades, steam recharge, order payouts, offline limits and terminal controls. It also runs complete shifts in child processes, kills a test game after a saved action, reopens its ledger and checks simultaneous deliveries. Disk-based tests create isolated factories inside the project and clean them up afterward.

## Round 2

### Choose what to cook

Press **R** or type `recipes` to compare recipes on your installed machinery. Pick a number or enter `recipe scallion`. Switching is free, carries the partially sealed pack forward and sets the sale price for the next seal. The recipe stays on the line until you change it or start a rota.

| Recipe command | Opens at lifetime packs | Line speed | Sale price | Sales/min on starter machinery |
| --- | ---: | ---: | --- | ---: |
| `recipe house` | 0 | 100% | Bench price | 30 packs / 90 coins |
| `recipe scallion` | 18 | 120% | Bench price − 1 coin | 36 packs / 72 coins |
| `recipe sesame` | 90 | 80% | Bench price + 2 coins | 24 packs / 120 coins |

### Race the pickup bell

Press **T** or type `rushes` to see the tickets. Booking one selects its recipe and starts the clock. Each matching fresh wholesale pack earns its usual sale price and can also fill your standing order. The last seal can land exactly at the deadline. Steam batches land the instant you press **B**.

| Ticket command | Recipe | Packs | Time | Bonus |
| --- | --- | ---: | ---: | ---: |
| `rush platform` | House broth | 18 | 24s | 45 coins |
| `rush relay` | Scallion ribbons | 48 | 45s | 120 coins |
| `rush tasting` | Roast sesame | 72 | 60s | 240 coins |

Try **O → 1**, **T → 1**, then **B** three times and **D** on a fresh shift. Those 18 packs earn 54 coins in sales, 45 for the rush and 30 for the corner counter. They also unlock the common room relay for eight HKBU trios on a break from their 3v3 bracket.

Switching recipes or closing the game keeps the clock running. The board records how many packs made the pickup, pays a finished ticket once and lets you book again after a win or a miss.

### Hire a night dispatcher

After three deliveries, open **A** and press **1**, or enter `dispatch on`, to hire the dispatcher for **600 coins**. Book a standing order and the dispatcher collects and rebooks it each time it fills, including during the eight-hour offline allowance. With the corner counter booked, 40 packs cover two 30-coin bonuses and leave four packs toward the next delivery.

**A → 2** or `dispatch off` pauses service with the partial order intact. Finish it with **D** to change customers. Resuming is free and collects any order already waiting at the desk.

### Saves and controls

Round 1 slots upgrade automatically when opened. The return receipt shows wholesale sales, dispatch bonuses and rush results. Number shortcuts now follow the visible menu, and the live floor keeps the action receipt when a batch also earns a rank. The expanded tests cover timed pickups down to the millisecond, interrupted save upgrades, simultaneous hires and complete shifts in both console modes.

## Round 3

### Send your first lunch cart

On a fresh shift press **W → 1**, **B**, then **C → 1**. The stockroom catches six House broth packs and the cart takes them to Foundry gate. In 30 seconds it brings back **36 coins**. The same load would sell for 18 at wholesale. The line keeps cooking during the trip.

| Line command | Load from the bins | Round trip | Route fee | Total at starting prices |
| --- | --- | ---: | ---: | ---: |
| `cart gate` | 6 house | 30s | 18 coins | 36 coins |
| `cart steps` | 6 house + 12 scallion | 90s | 72 coins | 114 coins |
| `cart quay` | 12 house + 18 scallion + 24 sesame | 180s | 240 coins | 432 coins |

The single cart needs its whole load before it can leave. Departure locks in the wholesale value plus the route fee. The till collects the full quote when the cart returns, including while you're away.

### Keep stock for the next run

Open **W** or type `stock`. Use **1** or `stock on` to fill a separate bin for each recipe. Each bin starts with room for 12 packs. New seals overflow to wholesale when their bin fills. Only those shipped fresh can fill standing orders and rush tickets.

Use **2** or `stock off` to send every new seal to wholesale again. Stored packs count toward lifetime shipments when they leave the bin. Keys **3–5**, or a command such as `sell scallion`, sell a whole bin at its recipe's current bench price. **6** or `stock expand` fits 24-pack bins for 180 coins, then 48-pack bins for another 600.

### Write a recipe rota

After 18 lifetime shipments, try **P → 1 → 2 → 4**. The line cooks House broth for one minute, then Scallion ribbons for one minute, and repeats. With storage on, the first cycle on starter machines stocks enough of both for the HKBU print crew at Studio steps.

In line mode enter `queue house`, `queue scallion`, then `rota start`. A rota has room for three slots and needs two different unlocked recipes. Repeating one gives it a second minute per cycle. A seal at changeover uses the outgoing recipe. Steam batches use the recipe on the dial and leave the timer alone.

**P → 5** or `rota stop` keeps cooking the current recipe. Starting again begins at slot one. **P → 6** or `rota clear` empties the list. Choosing a recipe manually or booking a rush also stops the rota and keeps the slots for later.

Round 1 and 2 slots migrate when opened. The ledger saves bin contents, the cart's return time and the rota's exact position. The rota advances for the credited part of an absence, up to eight hours in total. The return receipt lists stored packs and cart proceeds alongside wholesale sales and order bonuses.

Timed payouts now commit before the live floor announces them. The closing receipt also reports a pickup that fell due while the plain console waited for input. The tests cover recipe changeovers, simultaneous cart loads, interrupted save upgrades and a full overnight rota.
