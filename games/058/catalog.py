"""Prices, recipes and offers used by the factory and its desks."""

from dataclasses import dataclass


MINUTE = 60_000
OFFLINE_LIMIT = 8 * 60 * MINUTE
CHARGE_TIME = 30_000
MAX_CHARGES = 3
BATCH_TIME = 12_000
MAX_LEVEL = 10
DISPATCH_COST = 600
DISPATCH_UNLOCK = 3
ROTA_LEG_MS = MINUTE
ROTA_SLOTS = 3
# Each tier gives the capacity of every recipe bin and the price to fit it.
STOCK_TIERS = ((12, 0), (24, 180), (48, 600))


@dataclass(frozen=True)
class Station:
    key: str
    name: str
    initial: int
    increment: int
    base_cost: int

    def output(self, level: int) -> int:
        return self.initial + self.increment * (level - 1)

    def upgrade_cost(self, level: int) -> int:
        return self.base_cost * level * (level + 1) // 2


STATIONS = (
    Station("roller", "Dough roller", 30, 30, 30),
    Station("steamer", "Steam tunnel", 40, 30, 42),
    Station("sealer", "Bag sealer", 50, 30, 54),
    Station("spice", "Seasoning bench", 3, 1, 54),
)
STATION_BY_KEY = {station.key: station for station in STATIONS}


@dataclass(frozen=True)
class Order:
    key: str
    name: str
    target: int
    bonus: int
    unlock: int
    brief: str


ORDERS = (
    Order("counter", "Corner counter", 18, 30, 0,
          "A small top-up for the lunch rush."),
    Order("canteen", "Kowloon Tong canteen", 72, 150, 90,
          "HKBU's three-a-side finals need supper for the teams and crowd."),
    Order("freight", "Night ferry freight", 240, 600, 450,
          "The harbour depot has room for one more pallet."),
)
ORDER_BY_KEY = {order.key: order for order in ORDERS}


@dataclass(frozen=True)
class Recipe:
    key: str
    name: str
    speed_percent: int
    price_change: int
    unlock: int
    brief: str

    def rate_at(self, capacity: int) -> int:
        return capacity * self.speed_percent // 100

    def price_at(self, bench_price: int) -> int:
        return bench_price + self.price_change


RECIPES = (
    Recipe("house", "House broth", 100, 0, 0, "The full-width cut that opened the factory."),
    Recipe("scallion", "Scallion ribbons", 120, -1, 18, "Thin ribbons steam quickly for busy counters."),
    Recipe("sesame", "Roast sesame", 80, 2, 90, "A slower roast earns a premium on every pack."),
)
RECIPE_BY_KEY = {recipe.key: recipe for recipe in RECIPES}


@dataclass(frozen=True)
class Rush:
    key: str
    name: str
    recipe: str
    target: int
    window_ms: int
    bonus: int
    brief: str


RUSHES = (
    Rush("platform", "Platform supper", "house", 18, 24_000, 45,
         "Seal the last tray before the platform kiosk shuts."),
    Rush("relay", "Common room relay", "scallion", 48, 45_000, 120,
         "Eight HKBU trios ordered two packs per player for the round break."),
    Rush("tasting", "Harbour tasting", "sesame", 72, MINUTE, 240,
         "The night market wants the whole tasting flight in one pickup."),
)
RUSH_BY_KEY = {rush.key: rush for rush in RUSHES}


RANKS = (
    (0, "Pilot kitchen"),
    (ORDERS[1].unlock, "Canteen supplier"),
    (ORDERS[2].unlock, "District wholesaler"),
    (5_000, "Brass Ladle charter"),
)


@dataclass(frozen=True)
class Route:
    key: str
    name: str
    load: tuple[tuple[str, int], ...]
    travel_ms: int
    fee: int
    brief: str

    @property
    def packs(self) -> int:
        return sum(count for _, count in self.load)

    def payout(self, bench_price: int) -> int:
        wholesale = sum(count * RECIPE_BY_KEY[key].price_at(bench_price) for key, count in self.load)
        return wholesale + self.fee

    def shortages(self, bins: dict[str, int]) -> list[tuple[str, int]]:
        return [(key, count - bins[key]) for key, count in self.load if bins[key] < count]


ROUTES = (
    Route("gate", "Foundry gate", (("house", 6),), 30_000, 18,
          "Six bowls for the toolmakers changing shifts."),
    Route("steps", "Studio steps", (("house", 6), ("scallion", 12)), 90_000, 72,
          "An HKBU print crew has one drying rack and eighteen empty bowls."),
    Route("quay", "Lantern quay", (("house", 12), ("scallion", 18), ("sesame", 24)), 180_000, 240,
          "The boat crews pool their supper orders before the night crossing."),
)
ROUTE_BY_KEY = {route.key: route for route in ROUTES}
