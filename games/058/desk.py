"""Shared controls and text views for the live floor and line-oriented console."""

from dataclasses import dataclass
from textwrap import wrap

from catalog import (
    BATCH_TIME, DISPATCH_COST, DISPATCH_UNLOCK, MAX_CHARGES, MAX_LEVEL, MINUTE, ORDERS,
    RANKS, RECIPES, RECIPE_BY_KEY, ROTA_LEG_MS, ROTA_SLOTS, ROUTES, RUSHES, STATIONS,
)
from factory import Factory
from ledger import Visit


@dataclass(frozen=True)
class Reply:
    page: str = "floor"
    note: str = ""
    finished: bool = False
    settlement: str = ""

    @property
    def message(self) -> str:
        return " ".join(filter(None, (self.settlement, self.note)))


NAVIGATION = {
    "x": "floor", "back": "floor", "floor": "floor", "status": "floor", "shop": "floor",
    "o": "orders", "orders": "orders", "r": "recipes", "recipes": "recipes",
    "t": "rushes", "rushes": "rushes", "a": "dispatch", "dispatch": "dispatch",
    "w": "stock", "stock": "stock", "c": "cart", "cart": "cart", "p": "rota", "rota": "rota",
    "?": "help", "h": "help", "help": "help",
}
NUMBER_KEYS = {
    page: {str(i): (verb, item.key) for i, item in enumerate(items, 1)}
    for page, verb, items in (("floor", "buy", STATIONS), ("orders", "order", ORDERS),
                              ("recipes", "recipe", RECIPES), ("rushes", "rush", RUSHES),
                              ("cart", "cart", ROUTES), ("rota", "queue", RECIPES))
}
NUMBER_KEYS["dispatch"] = {"1": ("dispatch", "on"), "2": ("dispatch", "off")}
NUMBER_KEYS["stock"] = {
    "1": ("stock", "on"), "2": ("stock", "off"), "6": ("stock", "expand"),
    **{str(i): ("sell", recipe.key) for i, recipe in enumerate(RECIPES, 3)},
}
NUMBER_KEYS["rota"].update({"4": ("rota", "start"), "5": ("rota", "stop"), "6": ("rota", "clear")})

TARGET_ACTIONS = {
    "buy": ("floor", Factory.buy), "rush": ("rushes", Factory.start_rush),
    "sell": ("stock", Factory.sell_stock), "cart": ("cart", Factory.send_cart),
    "queue": ("rota", Factory.queue_recipe), "rota": ("rota", Factory.set_rota),
}


def operate(factory: Factory, page: str, command: str) -> Reply:
    words = command.lower().split()
    if not words:
        return Reply(page)
    if len(words) == 1:
        key = words[0]
        if key in ("q", "quit", "exit"):
            return Reply(page, finished=True)
        if key in NAVIGATION:
            return Reply(NAVIGATION[key])
        if key in ("s", "save"):
            return Reply(page, "Shift saved.")
        if key in ("b", "batch"):
            return Reply("floor", factory.batch())
        if key in ("d", "deliver"):
            return Reply("floor", factory.deliver())
        words = NUMBER_KEYS.get(page, {}).get(key, words)
    if len(words) == 2:
        verb, target = words
        if verb in TARGET_ACTIONS:
            destination, action = TARGET_ACTIONS[verb]
            return Reply(destination, action(factory, target))
        if verb == "order":
            previous = factory.active_order
            message = factory.book(target)
            booked = previous is None and factory.active_order is not None
            return Reply("floor" if booked else "orders", message)
        if verb == "recipe":
            message = factory.select_recipe(target)
            return Reply("floor" if factory.recipe_key == target else "recipes", message)
        if verb == "dispatch" and target in ("on", "off"):
            return Reply("dispatch", factory.set_dispatch(target == "on"))
        if verb == "stock" and target in ("on", "off"):
            return Reply("stock", factory.set_stock(target == "on"))
        if verb == "stock" and target == "expand":
            return Reply("stock", factory.expand_stock())
    return Reply(page, "Unknown command. Use ? for the controls.")


def duration(ms: int) -> str:
    seconds = ms // 1_000
    if seconds >= 3_600:
        return f"{seconds // 3_600}h {(seconds % 3_600) // 60}m"
    if seconds >= 60:
        return f"{seconds // 60}m {seconds % 60}s"
    return f"{seconds}s"


def welcome(visit: Visit) -> str:
    if visit.fresh:
        return "Opening shift! Try O, then 1 to book the corner counter."
    earnings = visit.earnings
    cap = " (8h cap)" if earnings.credited_ms < earnings.elapsed_ms else ""
    ready = " Order ready to deliver [D]." if visit.factory.order and (
        visit.factory.filled == visit.factory.order.target) else ""
    verb = "Sold" if earnings.stored else "Packed"
    sales = (f"Away {duration(earnings.elapsed_ms)}. {verb} {earnings.packs:,} for "
             f"{earnings.coins:,} coins{cap}.{ready}")
    return " ".join(filter(None, (sales, earnings.notices())))


def totals(f: Factory) -> str:
    return f"Till {f.coins:,} coins   |   Shipped {f.shipped:,} packs   |   Line {f.rate}/min"


def _stations(f: Factory, compact: bool) -> list[str]:
    rows = [] if compact else ["    STATION           LV       BASE       NEXT     UPGRADE"]
    for i, s in enumerate(STATIONS, start=1):
        level = getattr(f, s.key)
        value = s.output(level)
        unit = "c/pk" if s.key == "spice" else "/min"
        cost = "MAX" if level == MAX_LEVEL else f"{s.upgrade_cost(level):,}c"
        limit = s.key != "spice" and value == f.capacity
        if compact:
            rows.append(f"[{i}] {s.key:<7} L{level:<2} {str(value) + unit:>7}  {cost:>6}"
                        + (" *" if limit else ""))
        else:
            after = "--" if level == MAX_LEVEL else f"{s.output(level + 1)}{unit}"
            rows.append(f"[{i}] {s.name:<16} {level:>2}   {str(value) + unit:>8}   "
                        f"{after:>8}    {cost:>6}" + ("  * LIMIT" if limit else ""))
    return rows


def _floor(f: Factory, compact: bool) -> list[str]:
    if compact:
        rows = [f"{f.coins:,} coins | {f.rate}/min | {f.price}c/pack",
                f"{f.shipped:,} shipped | {f.recipe.name}"]
    else:
        income = f"{f.rate * f.price:,} coins/min" + (" at wholesale" if f.stock.reserving else "")
        rows = [totals(f),
                f"{f.recipe.name}   |   {f.price} coins/pack   |   {income}"
                f"   |   {f.deliveries:,} deliveries", ""]
    rows.extend(_stations(f, compact))
    if not compact:
        rows.append("")
        segments = f.progress * 12 // MINUTE
        track = "=" * segments + ">" + "." * (11 - segments)
        seconds = (MINUTE - f.progress) / (f.rate * 1_000)
        rows.append(f"PACKING   [{track}]   next seal in {seconds:.1f}s")
    gauge = "|" * f.charges + "." * (MAX_CHARGES - f.charges)
    extra = f.packs_in(BATCH_TIME)
    recharge = f"   +1 in {f.next_charge_seconds}s" if f.next_charge_seconds else ""
    if compact:
        rows.append(f"Steam [{gauge}]  B +{extra} packs{recharge}")
    else:
        rows.append(f"BOILER    [{gauge}] {f.charges}/{MAX_CHARGES}   [B] +{extra} packs{recharge}")
    order = f.order
    if order is None:
        standby = "   (dispatcher on duty)" if f.dispatch_mode == "running" else ""
        rows.append("DISPATCH  [O] Book an order" + standby)
    elif f.filled == order.target:
        rows.append(f"DISPATCH  [D] Deliver +{order.bonus}c   {order.name}")
    else:
        mode = "AUTO" if f.dispatch_mode == "running" else "DISPATCH"
        rows.append(f"{mode:<10}{f.filled}/{order.target} packs   {order.name}")
    if f.ticket:
        rows.append("RUSH      " + _ticket_status(f))
    activity = []
    held = sum(f.stock.bins.values())
    if f.stock.reserving or held:
        activity.append(f"[W] {held} held" + (" (filling)" if f.stock.reserving else ""))
    if f.cart:
        activity.append(f"[C] Cart {_seconds_left(f.cart.due_ms - f.last_ms)}s")
    if f.rota.running:
        activity.append(f"[P] Rota {_seconds_left(f.rota.remaining_ms)}s")
    if activity:
        rows.append("   ".join(activity))
    rank = f.rank_index
    if rank == len(RANKS) - 1:
        rows.append("CHARTER   Brass Ladle earned!  Keep the line running.")
    else:
        target = RANKS[rank + 1][0]
        segments = min(10, 10 * f.shipped // target)
        bar = "[" + "#" * segments + "." * (10 - segments) + "]"
        if compact:
            rows.append(f"RANK      {f.shipped:,}/{target:,}   {RANKS[rank][1]}")
        else:
            rows.append(f"RANK      {RANKS[rank][1]}   {bar}   "
                        f"{f.shipped:,}/{target:,} to {RANKS[rank + 1][1]}")
    return rows


def _orders(f: Factory, compact: bool) -> list[str]:
    instruction = ("The dispatcher repeats your booked order until paused [A]."
                   if f.dispatch_mode == "running" else "Deliver a filled order to collect its bonus.")
    terms = ("With stock on, each bin fills before new wholesale packs count here."
             if f.stock.reserving else "Book one standing order. New packs earn their usual sale price.")
    rows = [terms, instruction, ""] if not compact else []
    for i, order in enumerate(ORDERS, start=1):
        if f.active_order == order.key:
            status = "ready to deliver" if f.filled == order.target else f"booked {f.filled}/{order.target}"
        elif f.shipped < order.unlock:
            status = f"locked {order.unlock}" if compact else f"opens at {order.unlock} shipped"
        else:
            status = "open"
        divider = " / " if compact else "   /   "
        rows.append(f"[{i}] {order.name}{divider}{status}")
        rows.append(f"    {order.target} packs   +{order.bonus} coins")
        if not compact:
            rows.extend([f"    {order.brief}", ""])
    return rows


def _recipes(f: Factory, compact: bool) -> list[str]:
    rows = [] if compact else ["Choose the next pack's recipe. Figures use your current machinery.", ""]
    for i, recipe in enumerate(RECIPES, 1):
        rate = recipe.rate_at(f.capacity)
        price = recipe.price_at(f.base_price)
        status = "cooking" if f.recipe == recipe else "available"
        if f.shipped < recipe.unlock:
            status = f"locked {recipe.unlock}" if compact else f"opens at {recipe.unlock} shipped"
        figures = f"    {rate}/min x {price}c = {rate * price:,} coins/min"
        rows.extend([f"[{i}] {recipe.name}   /   {status}",
                     figures if compact else f"{figures}   (recipe {recipe.key})"])
        if not compact:
            rows.extend([f"    {recipe.brief}", ""])
    return rows


def _ticket_status(f: Factory) -> str:
    ticket = f.ticket
    if ticket is None:
        return "No ticket on the clock."
    offer = ticket.offer
    status = ticket.status(f.last_ms)
    if status == "paid":
        return f"{offer.name} paid +{offer.bonus}c"
    if status == "expired":
        return f"{offer.name} expired at {ticket.filled}/{offer.target}"
    seconds = _seconds_left(ticket.deadline_ms - f.last_ms)
    return f"{ticket.filled}/{offer.target} {offer.recipe} packs | {seconds}s left"


def _seconds_left(milliseconds: int) -> int:
    return (milliseconds + 999) // 1_000


def _rushes(f: Factory, compact: bool) -> list[str]:
    rows = [f"Tickets won {f.rush_wins:,}", _ticket_status(f)]
    if not compact:
        terms = ("With stock on, only fresh wholesale packs of the ticket recipe count."
                 if f.stock.reserving else "Matching seals count here and on your standing order.")
        rows.extend(["Booking starts the clock and selects the required recipe.",
                     terms, ""])
    for i, offer in enumerate(RUSHES, 1):
        recipe = RECIPE_BY_KEY[offer.recipe]
        status = recipe.key if compact else recipe.name
        if f.shipped < recipe.unlock:
            status = f"locked {recipe.unlock}" if compact else f"opens at {recipe.unlock} shipped"
        terms = f"    {offer.target} packs in {offer.window_ms // 1_000}s   +{offer.bonus} coins"
        rows.extend([f"[{i}] {offer.name}   /   {status}",
                     terms if compact else f"{terms}   (rush {offer.key})"])
        if not compact:
            rows.extend([f"    {offer.brief}", ""])
    return rows


def _dispatch(f: Factory, compact: bool) -> list[str]:
    rows = [f"Till {f.coins:,} coins | {f.deliveries:,} deliveries"]
    if f.dispatch_mode == "unhired":
        rows += [f"[1] Hire for {DISPATCH_COST} coins",
                 f"    Requires {DISPATCH_UNLOCK} completed deliveries."]
    else:
        duty = "on duty" if f.dispatch_mode == "running" else "paused"
        rows += [f"Dispatcher {duty}", "[1] Resume service   [2] Pause"]
    if f.order:
        rows.append(f"{f.order.name}   {f.filled}/{f.order.target} packs")
    else:
        rows.append("[O] Book a standing order to repeat.")
    rows.extend(["Filled orders pay and rebook on duty.", "Partial orders carry over when paused."])
    if not compact:
        rows.extend(["", "The hire fee is paid once. Dispatch works during offline production.",
                     "To change customers, pause and deliver the current order with D."])
    return rows


def _stock(f: Factory, compact: bool) -> list[str]:
    mode = "Reserving new seals" if f.stock.reserving else "Selling new seals at wholesale"
    if compact:
        mode = "Filling bins" if f.stock.reserving else "Wholesale"
    rows = [f"{mode} | Till {f.coins:,}c", "[1] Fill bins   [2] Wholesale", ""]
    for i, recipe in enumerate(RECIPES, 3):
        count = f.stock.bins[recipe.key]
        value = count * recipe.price_at(f.base_price)
        label = f"{recipe.key:<8}" if compact else f"{recipe.name:<16}"
        rows.append(f"[{i}] {label} {count:>2}/{f.stock.capacity}   sell {value:,}c")
    upgrade = f.stock.next_upgrade
    if upgrade:
        capacity, cost = upgrade
        rows.append(f"[6] Expand to {capacity} per bin for {cost:,}c")
    else:
        rows.append(f"Bins at maximum ({f.stock.capacity} each).")
    if not compact:
        rows.extend(["", "Overflow sells immediately. Only fresh wholesale packs fill orders or rushes.",
                     "Sell a whole bin at the current bench price, or load a lunch cart [C].",
                     "Stored packs count as shipped when they leave the bin."])
    return rows


def _cart(f: Factory, compact: bool) -> list[str]:
    if f.cart:
        trip = f.cart
        seconds = _seconds_left(trip.due_ms - f.last_ms)
        cash = f"{trip.payout:,}c due" if compact else f"returning with {trip.payout:,}c"
        status = f"{trip.route.name} | {seconds}s left | {cash}"
    else:
        status = "Cart at the loading bay."
    rows = [status, f"Trips completed {f.cart_runs:,}"]
    if not compact:
        rows.extend(["Load from the stockroom [W]. The quoted price includes the route fee.", ""])
    for i, route in enumerate(ROUTES, 1):
        manifest = " + ".join(f"{count} {key}" for key, count in route.load)
        ready = "load ready" if not route.shortages(f.stock.bins) else "needs stock"
        if any(count > f.stock.capacity for _, count in route.load):
            ready = "expand bins"
        seconds = route.travel_ms // 1_000
        quote = route.payout(f.base_price)
        if compact:
            rows.extend([f"[{i}] {route.name} {seconds}s {quote:,}c / {ready}", f"    {manifest}"])
        else:
            rows.extend([f"[{i}] {route.name}   {seconds}s   {quote:,}c incl. {route.fee}c fee   (cart {route.key})",
                         f"    {manifest} / {ready}", f"    {route.brief}", ""])
    return rows


def _rota(f: Factory, compact: bool) -> list[str]:
    rota = f.rota
    slots = " > ".join(rota.slots) or "(empty)"
    rows = [f"Slots {len(rota.slots)}/{ROTA_SLOTS}   {slots}"]
    if rota.phase_ms is not None:
        rows.append(f"Slot {rota.phase_ms // ROTA_LEG_MS + 1} cooking {f.recipe_key} "
                    f"| {_seconds_left(rota.remaining_ms)}s left")
    else:
        rows.append("Stopped. Queue two different recipes." if len(set(rota.slots)) < 2 else "Stopped.")
    for i, recipe in enumerate(RECIPES, 1):
        lock = f" (opens at {recipe.unlock} shipped)" if f.shipped < recipe.unlock else ""
        rows.append(f"[{i}] Queue {recipe.name}{lock}")
    rows.append("[4] Start   [5] Stop   [6] Clear")
    if not compact:
        rows.extend(["", f"Each slot runs for {ROTA_LEG_MS // 1_000}s of production. The last loops back to the first.",
                     "Use a recipe twice to give it two turns. Steam batches leave the timer alone.",
                     "Choosing a recipe or booking a rush stops the rota and keeps the list."])
    return rows


def _help(_f: Factory, compact: bool) -> list[str]:
    rows = [
        "[1-4]   buy roller / steamer / sealer / spice",
        "[B]     batch       Trade one steam charge for 12s of extra packing.",
        "[O]     orders      Open the order book. Choose a number to book.",
        "        order NAME  Book counter, canteen, or freight by name.",
        "[D]     deliver     Collect a completed order's bonus.",
        "[R]     recipes     Compare packs/min and price. Use recipe NAME to switch.",
        "[T]     rushes      Choose a timed ticket with rush NAME or a number.",
        "[A]     dispatch    Hire or resume with dispatch on. Pause with dispatch off.",
        "[W]     stock       Use stock on/off, sell NAME, or stock expand.",
        "[C]     cart        Load a route with cart gate, cart steps, or cart quay.",
        "[P]     rota        Queue recipes with queue NAME. Use rota start/stop/clear.",
        "[X]     status      Return to the factory floor.",
        "[S]     save        Write the current shift to the ledger.",
        "[Q]     quit        Save and close the factory console.",
    ]
    if compact:
        return ["1-4  Upgrade station", "B  Extra batch    O  Order book",
                "R  Recipes        T  Rush tickets", "A  Auto dispatch  W  Stockroom",
                "C  Lunch cart     P  Recipe rota",
                "D  Deliver bonus  X  Factory floor", "S  Save           Q  Save and quit",
                "The * marks the slowest machine.",
                "Steam returns every 30s, up to 3."]
    return ["The slowest of the first three stations sets the line speed (* LIMIT).",
            "The seasoning bench raises the wholesale price of every pack.",
            "Steam refills every 30s and holds three charges. Away pay covers up to 8h.",
            "", *rows, "", "Earn the Brass Ladle charter at 5,000 lifetime packs."]


PAGES = {
    "floor": ("FACTORY FLOOR", _floor, ("[1-4] Buy  [B] Batch  [O] Orders  [D] Deliver",
                                      "[R] Recipes  [T] Rush tickets  [A] Dispatch",
                                      "[W] Stockroom  [C] Lunch cart  [P] Rota",
                                      "[?] Guide  [S] Save  [Q] Quit")),
    "orders": ("ORDER BOOK", _orders, ("[1-3] Book  [D] Deliver  [A] Dispatch  [X] Floor  [Q] Quit",)),
    "recipes": ("RECIPE BOOK", _recipes, ("[1-3] Cook  [T] Tickets  [X] Floor  [Q] Quit",)),
    "rushes": ("RUSH BOARD", _rushes, ("[1-3] Start  [B] Batch  [X] Floor  [Q] Quit",)),
    "dispatch": ("DISPATCH DESK", _dispatch, ("[O] Orders  [X] Floor  [Q] Quit",)),
    "stock": ("STOCKROOM", _stock, ("[3-5] Sell  [C] Cart  [X] Floor  [Q] Quit",)),
    "cart": ("LUNCH CART", _cart, ("[1-3] Send  [W] Stock  [X] Floor  [Q] Quit",)),
    "rota": ("RECIPE ROTA", _rota, ("[1-3] Queue  [W] Stock  [X] Floor  [Q] Quit",)),
    "help": ("SHIFT GUIDE", _help, ("[X] Floor  [O] Orders  [Q] Quit",)),
}


def page_lines(f: Factory, page: str, width: int = 80, compact: bool = False) -> list[str]:
    width = max(1, min(width, 86))
    compact = compact or width < 76
    section, render, controls = PAGES[page]
    title = "STEAMFOLD / NOODLE WORKS" if not compact else "STEAMFOLD"
    rows = [f"{title}  {section:>{max(0, width - len(title) - 2)}}", "-" * width]
    rows.extend(render(f, compact))
    rows.append("-" * width)
    for line in controls:
        if compact:
            line = line.replace("[", "").replace("]", "")
        rows.extend(wrap(line, width=width))
    return rows
