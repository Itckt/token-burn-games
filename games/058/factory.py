"""Production, dispatch and the factory clock. All accounting uses integers."""

from dataclasses import dataclass, field

from catalog import (
    BATCH_TIME, CHARGE_TIME, DISPATCH_COST, DISPATCH_UNLOCK, MAX_CHARGES, MAX_LEVEL, MINUTE,
    OFFLINE_LIMIT, ORDERS, ORDER_BY_KEY, RANKS, RECIPES, RECIPE_BY_KEY, ROTA_LEG_MS, ROTA_SLOTS,
    ROUTE_BY_KEY, RUSHES, RUSH_BY_KEY, STATIONS, STATION_BY_KEY, STOCK_TIERS, Order, Recipe,
    Route, Rush, Station,
)


@dataclass
class RushTicket:
    key: str
    deadline_ms: int
    filled: int = 0

    @property
    def offer(self) -> Rush:
        return RUSH_BY_KEY[self.key]

    def status(self, now_ms: int) -> str:
        if self.filled == self.offer.target:
            return "paid"
        return "expired" if now_ms >= self.deadline_ms else "running"


@dataclass
class Stockroom:
    bins: dict[str, int] = field(default_factory=lambda: {key: 0 for key in RECIPE_BY_KEY})
    reserving: bool = False
    tier: int = 1

    @property
    def capacity(self) -> int:
        return STOCK_TIERS[self.tier - 1][0]

    @property
    def next_upgrade(self) -> tuple[int, int] | None:
        return STOCK_TIERS[self.tier] if self.tier < len(STOCK_TIERS) else None

    def space_for(self, key: str) -> int:
        return self.capacity - self.bins[key] if self.reserving else 0


@dataclass(frozen=True)
class CartTrip:
    key: str
    due_ms: int
    bench_price: int

    @property
    def route(self) -> Route:
        return ROUTE_BY_KEY[self.key]

    @property
    def payout(self) -> int:
        return self.route.payout(self.bench_price)


@dataclass
class Rota:
    """The phase tracks cooking time within a repeating list of one-minute slots."""

    slots: list[str] = field(default_factory=list)
    phase_ms: int | None = None

    @property
    def running(self) -> bool:
        return self.phase_ms is not None

    @property
    def remaining_ms(self) -> int:
        if self.phase_ms is None:
            return 0
        return ROTA_LEG_MS - self.phase_ms % ROTA_LEG_MS

    @property
    def current(self) -> str | None:
        if self.phase_ms is None:
            return None
        return self.slots[self.phase_ms // ROTA_LEG_MS]

    def advance(self, milliseconds: int) -> str | None:
        if self.phase_ms is not None:
            self.phase_ms = (self.phase_ms + milliseconds) % (len(self.slots) * ROTA_LEG_MS)
        return self.current


@dataclass
class Bonuses:
    orders: int = 0
    dispatch_coins: int = 0
    rush_coins: int = 0

    def receipt(self) -> str:
        parts = []
        if self.orders:
            noun = "order" if self.orders == 1 else "orders"
            parts.append(f"Dispatcher sent {self.orders:,} {noun} for +{self.dispatch_coins:,} coins.")
        if self.rush_coins:
            parts.append(f"Rush paid +{self.rush_coins:,} coins.")
        return " ".join(parts)


@dataclass
class Earnings:
    """Packs and coins record fresh wholesale sales at each recipe's price."""

    elapsed_ms: int
    credited_ms: int
    packs: int = 0
    coins: int = 0
    bonuses: Bonuses = field(default_factory=Bonuses)
    rush_expired: bool = False
    stored: int = 0
    returned_cart: CartTrip | None = None

    @property
    def has_event(self) -> bool:
        return bool(self.bonuses.rush_coins or self.rush_expired or self.returned_cart)

    def notices(self) -> str:
        parts = [self.bonuses.receipt()]
        if self.rush_expired:
            parts.append("Rush ticket expired.")
        if self.stored:
            parts.append(f"Shelved {self.stored:,} packs.")
        if self.returned_cart:
            trip = self.returned_cart
            parts.append(f"Cart returned from {trip.route.name} with {trip.payout:,} coins.")
        return " ".join(part for part in parts if part)


@dataclass
class Factory:
    last_ms: int
    coins: int = 36
    shipped: int = 0
    progress: int = 0
    steam_ms: int = MAX_CHARGES * CHARGE_TIME
    roller: int = 1
    steamer: int = 1
    sealer: int = 1
    spice: int = 1
    active_order: str | None = None
    filled: int = 0
    deliveries: int = 0
    recipe_key: str = "house"
    ticket: RushTicket | None = None
    rush_wins: int = 0
    dispatch_mode: str = "unhired"
    stock: Stockroom = field(default_factory=Stockroom)
    cart: CartTrip | None = None
    cart_runs: int = 0
    rota: Rota = field(default_factory=Rota)

    @property
    def capacity(self) -> int:
        return min(s.output(getattr(self, s.key)) for s in STATIONS[:3])

    @property
    def base_price(self) -> int:
        return STATION_BY_KEY["spice"].output(self.spice)

    @property
    def recipe(self) -> Recipe:
        return RECIPE_BY_KEY[self.recipe_key]

    @property
    def rate(self) -> int:
        return self.recipe.rate_at(self.capacity)

    @property
    def price(self) -> int:
        return self.recipe.price_at(self.base_price)

    @property
    def charges(self) -> int:
        return self.steam_ms // CHARGE_TIME

    @property
    def next_charge_seconds(self) -> int:
        if self.charges == MAX_CHARGES:
            return 0
        return (CHARGE_TIME - self.steam_ms % CHARGE_TIME + 999) // 1_000

    @property
    def order(self) -> Order | None:
        return ORDER_BY_KEY.get(self.active_order)

    @property
    def rank_index(self) -> int:
        return max(i for i, (threshold, _) in enumerate(RANKS) if self.shipped >= threshold)

    @property
    def running_ticket(self) -> RushTicket | None:
        if self.ticket and self.ticket.status(self.last_ms) == "running":
            return self.ticket
        return None

    def packs_in(self, milliseconds: int) -> int:
        return (self.progress + milliseconds * self.rate) // MINUTE

    def _fill_order(self, packs: int) -> tuple[int, int]:
        order = self.order
        if order is None:
            return 0, 0
        total = self.filled + packs
        if self.dispatch_mode != "running":
            self.filled = min(order.target, total)
            return 0, 0
        count, self.filled = divmod(total, order.target)
        bonus = count * order.bonus
        self.deliveries += count
        self.coins += bonus
        return count, bonus

    def _fill_rush(self, milliseconds: int, bin_space: int, instant: bool) -> int:
        ticket = self.running_ticket
        if ticket is None or self.recipe_key != ticket.offer.recipe:
            return 0
        # A seal exactly at the deadline counts. A steam batch all lands at the current time.
        eligible = milliseconds if instant else min(milliseconds, ticket.deadline_ms - self.last_ms)
        wholesale = max(0, self.packs_in(eligible) - bin_space)
        ticket.filled = min(ticket.offer.target, ticket.filled + wholesale)
        if ticket.filled < ticket.offer.target:
            return 0
        self.rush_wins += 1
        return ticket.offer.bonus

    def _produce(self, milliseconds: int, receipt: Earnings, *, instant: bool = False) -> None:
        key = self.recipe_key
        space = self.stock.space_for(key)
        rush_bonus = self._fill_rush(milliseconds, space, instant)
        sealed, self.progress = divmod(self.progress + milliseconds * self.rate, MINUTE)
        stored = min(space, sealed)
        sold = sealed - stored
        wholesale = sold * self.price
        self.stock.bins[key] += stored
        self.shipped += sold
        self.coins += wholesale + rush_bonus
        count, dispatch_bonus = self._fill_order(sold)
        receipt.packs += sold
        receipt.coins += wholesale
        receipt.stored += stored
        receipt.bonuses.orders += count
        receipt.bonuses.dispatch_coins += dispatch_bonus
        receipt.bonuses.rush_coins += rush_bonus

    def advance(self, now_ms: int) -> Earnings:
        elapsed = max(0, now_ms - self.last_ms)
        credited = min(elapsed, OFFLINE_LIMIT)
        ticket = self.running_ticket
        receipt = Earnings(elapsed, credited)
        remaining = credited
        while remaining:
            # Settle each recipe at its own speed and price, including the seal at changeover.
            span = min(remaining, self.rota.remaining_ms) if self.rota.running else remaining
            self._produce(span, receipt)
            self.last_ms += span
            remaining -= span
            scheduled = self.rota.advance(span)
            if scheduled is not None:
                self.recipe_key = scheduled
        self.steam_ms = min(MAX_CHARGES * CHARGE_TIME, self.steam_ms + credited)
        self.last_ms += elapsed - credited
        receipt.rush_expired = ticket is not None and ticket.status(self.last_ms) == "expired"
        if self.cart and self.cart.due_ms <= self.last_ms:
            receipt.returned_cart = self.cart
            self.coins += self.cart.payout
            self.cart_runs += 1
            self.cart = None
        return receipt

    def buy(self, key: str) -> str:
        station = STATION_BY_KEY.get(key)
        if station is None:
            return "Choose roller, steamer, sealer, or spice."
        level = getattr(self, key)
        if level >= MAX_LEVEL:
            return f"{station.name} has reached its maximum level of {MAX_LEVEL}."
        cost = station.upgrade_cost(level)
        if self.coins < cost:
            return f"{station.name} costs {cost:,} coins. You need {cost - self.coins:,} more."
        self.coins -= cost
        setattr(self, key, level + 1)
        return f"Upgraded {station.name} to level {level + 1} for {cost:,} coins."

    def batch(self) -> str:
        if self.charges == 0:
            return f"Steam is rebuilding. Next batch in {self.next_charge_seconds}s."
        self.steam_ms -= CHARGE_TIME
        receipt = Earnings(0, 0)
        self._produce(BATCH_TIME, receipt, instant=True)
        if receipt.packs == 0 and receipt.stored:
            return f"Extra batch shelved {receipt.stored:,} {self.recipe_key} packs."
        sale = f"Extra batch shipped {receipt.packs:,} packs for {receipt.coins:,} coins."
        return " ".join(filter(None, (sale, receipt.notices())))

    def _cook_now(self, key: str) -> str:
        stopped = self.rota.running
        self.rota.phase_ms = None
        self.recipe_key = key
        return " Rota stopped." if stopped else ""

    def select_recipe(self, key: str) -> str:
        recipe = RECIPE_BY_KEY.get(key)
        if recipe is None:
            return "Choose house, scallion, or sesame from the recipe book."
        if self.shipped < recipe.unlock:
            return f"{recipe.name} opens at {recipe.unlock} lifetime packs."
        note = self._cook_now(key)
        return f"Cooking {recipe.name} at {self.rate}/min for {self.price} coins/pack.{note}"

    def start_rush(self, key: str) -> str:
        offer = RUSH_BY_KEY.get(key)
        if offer is None:
            return "Choose platform, relay, or tasting from the rush board."
        ticket = self.running_ticket
        if ticket:
            return f"{ticket.offer.name} is already on the clock."
        recipe = RECIPE_BY_KEY[offer.recipe]
        if self.shipped < recipe.unlock:
            return f"{offer.name} opens at {recipe.unlock} lifetime packs."
        note = self._cook_now(recipe.key)
        self.ticket = RushTicket(key, self.last_ms + offer.window_ms)
        return (f"Started {offer.name}. Seal {offer.target} {recipe.name} packs in "
                f"{offer.window_ms // 1_000}s for +{offer.bonus} coins.{note}")

    def book(self, key: str) -> str:
        order = ORDER_BY_KEY.get(key)
        if order is None:
            return "Choose counter, canteen, or freight from the order book."
        if self.order:
            if self.dispatch_mode == "running":
                return f"The dispatcher repeats {self.order.name}. Pause at [A], then deliver it."
            return f"{self.order.name} is on the books. Deliver it first."
        if self.shipped < order.unlock:
            return f"{order.name} opens at {order.unlock:,} lifetime packs."
        self.active_order = key
        self.filled = 0
        return f"Booked {order.name}. Ship {order.target} packs for a {order.bonus}-coin bonus."

    def deliver(self) -> str:
        order = self.order
        if order is None:
            return "Book an order first. Open the order book with O."
        if self.dispatch_mode == "running":
            return f"The dispatcher will deliver {order.name} at {order.target} packs."
        if self.filled < order.target:
            return f"{order.name} needs {order.target - self.filled} more packs."
        self.coins += order.bonus
        self.deliveries += 1
        self.active_order = None
        self.filled = 0
        return f"Delivered to {order.name}. Collected the {order.bonus}-coin bonus."

    def set_dispatch(self, enabled: bool) -> str:
        if not enabled:
            if self.dispatch_mode == "unhired":
                return "Dispatch is off. Hire a dispatcher at the dispatch desk [A]."
            self.dispatch_mode = "paused"
            return ("Dispatcher paused. Finish the current order with D." if self.order
                    else "Dispatcher paused.")
        if self.dispatch_mode == "running":
            return "Dispatcher is already on duty."
        if self.dispatch_mode == "unhired":
            if self.deliveries < DISPATCH_UNLOCK:
                return f"Hire after {DISPATCH_UNLOCK} deliveries ({self.deliveries} completed)."
            if self.coins < DISPATCH_COST:
                return f"Hiring costs {DISPATCH_COST} coins. You need {DISPATCH_COST - self.coins} more."
            self.coins -= DISPATCH_COST
            note = f"Hired the dispatcher for {DISPATCH_COST} coins."
        else:
            note = "Dispatcher back on duty."
        self.dispatch_mode = "running"
        if self.order is None:
            return note + " Book a standing order to repeat."
        count, bonus = self._fill_order(0)
        return f"{note} Repeating {self.order.name}. {Bonuses(count, bonus).receipt()}".rstrip()

    def set_stock(self, enabled: bool) -> str:
        self.stock.reserving = enabled
        if enabled:
            return f"Reserving up to {self.stock.capacity} packs per recipe. Overflow ships at wholesale."
        return "New seals go straight to wholesale. Stored packs stay in their bins."

    def expand_stock(self) -> str:
        upgrade = self.stock.next_upgrade
        if upgrade is None:
            return f"The bins are at maximum capacity ({self.stock.capacity} each)."
        capacity, cost = upgrade
        if self.coins < cost:
            return f"Larger bins cost {cost:,} coins. You need {cost - self.coins:,} more."
        self.coins -= cost
        self.stock.tier += 1
        return f"Expanded each recipe bin to {capacity} packs for {cost:,} coins."

    def sell_stock(self, key: str) -> str:
        recipe = RECIPE_BY_KEY.get(key)
        if recipe is None:
            return "Choose a recipe bin from the stockroom [W]."
        count = self.stock.bins[key]
        if count == 0:
            return f"The {recipe.name} bin is empty."
        coins = count * recipe.price_at(self.base_price)
        self.stock.bins[key] = 0
        self.shipped += count
        self.coins += coins
        return f"Sold {count} stored {key} packs for {coins:,} coins."

    def send_cart(self, key: str) -> str:
        route = ROUTE_BY_KEY.get(key)
        if route is None:
            return "Choose a route from the lunch cart [C]."
        if self.cart:
            return f"The cart is already out at {self.cart.route.name}."
        missing = route.shortages(self.stock.bins)
        if missing:
            needs = ", ".join(f"{count} {recipe}" for recipe, count in missing)
            return f"{route.name} needs {needs} more in stock. Fill the bins at [W]."
        for recipe, count in route.load:
            self.stock.bins[recipe] -= count
        self.shipped += route.packs
        self.cart = CartTrip(key, self.last_ms + route.travel_ms, self.base_price)
        return (f"Sent the cart to {route.name} with {route.packs} packs. "
                f"It returns in {route.travel_ms // 1_000}s with {self.cart.payout:,} coins.")

    def queue_recipe(self, key: str) -> str:
        recipe = RECIPE_BY_KEY.get(key)
        if recipe is None:
            return "Choose a recipe from the rota [P]."
        if self.rota.running:
            return "Stop the rota before changing its slots."
        if self.shipped < recipe.unlock:
            return f"{recipe.name} opens at {recipe.unlock} lifetime packs."
        if len(self.rota.slots) == ROTA_SLOTS:
            return "The rota is full. Clear the slots to write a new one."
        self.rota.slots.append(key)
        return f"Queued {recipe.name} in slot {len(self.rota.slots)}."

    def set_rota(self, action: str) -> str:
        if action == "clear":
            self.rota = Rota()
            return "Cleared the rota. The line keeps its current recipe."
        if action == "stop":
            self.rota.phase_ms = None
            return f"Rota stopped. The line stays on {self.recipe.name}."
        if action != "start":
            return "Use rota start, rota stop, or rota clear."
        if self.rota.running:
            return "The rota is already running."
        if len(set(self.rota.slots)) < 2:
            return "Queue at least two different recipes before starting the rota."
        self.rota.phase_ms = 0
        self.recipe_key = self.rota.slots[0]
        return f"Rota started on {self.recipe.name}. Each slot cooks for {ROTA_LEG_MS // 1_000}s."
