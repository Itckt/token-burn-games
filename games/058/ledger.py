"""A visit settles the clock and the player's action in one SQLite transaction."""

import json
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from catalog import (
    CHARGE_TIME, DISPATCH_UNLOCK, MAX_CHARGES, MAX_LEVEL, MINUTE, ORDER_BY_KEY,
    RECIPE_BY_KEY, ROTA_LEG_MS, ROTA_SLOTS, STATIONS, STATION_BY_KEY, STOCK_TIERS,
)
from factory import CartTrip, Earnings, Factory, Rota, RushTicket, Stockroom


SAVE_VERSION = 3
V1_FIELDS = {"last_ms", "coins", "shipped", "progress", "steam_ms", "roller",
             "steamer", "sealer", "spice", "active_order", "filled", "deliveries"}
V2_FIELDS = V1_FIELDS | {"recipe_key", "ticket", "rush_wins", "dispatch_mode"}
SAVE_FIELDS = {field.name for field in fields(Factory)}
VERSION_FIELDS = {1: V1_FIELDS, 2: V2_FIELDS, SAVE_VERSION: SAVE_FIELDS}


class SaveError(Exception):
    """A saved factory could not be read safely."""


def slot_name(value: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,23}", value):
        raise ValueError("Use 1-24 letters, digits, hyphens or underscores for the slot. "
                         "Start with a letter or digit.")
    return value.lower()


def _is_count(value) -> bool:
    return type(value) is int and value >= 0


def _in_range(value, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _validate_ticket(state: Factory) -> None:
    ticket = state.ticket
    if ticket is None:
        if state.rush_wins:
            raise ValueError
        return
    if not _is_count(ticket.deadline_ms) or not _is_count(ticket.filled):
        raise ValueError
    offer = ticket.offer
    started_ms = ticket.deadline_ms - offer.window_ms
    if not 0 <= started_ms <= state.last_ms or state.shipped < RECIPE_BY_KEY[offer.recipe].unlock:
        raise ValueError
    if ticket.filled > min(offer.target, state.shipped):
        raise ValueError
    if ticket.filled == offer.target and state.rush_wins == 0:
        raise ValueError


def _validate_stock(state: Factory) -> None:
    stock = state.stock
    if type(stock.reserving) is not bool or not _in_range(stock.tier, 1, len(STOCK_TIERS)):
        raise ValueError
    if not isinstance(stock.bins, dict) or stock.bins.keys() != RECIPE_BY_KEY.keys():
        raise ValueError
    for key, count in stock.bins.items():
        if not _in_range(count, 0, stock.capacity):
            raise ValueError
        if count and state.shipped < RECIPE_BY_KEY[key].unlock:
            raise ValueError


def _validate_cart(state: Factory) -> None:
    trip = state.cart
    if trip is None:
        return
    route = trip.route
    if not _is_count(trip.due_ms):
        raise ValueError
    departure = trip.due_ms - route.travel_ms
    if not 0 <= departure <= state.last_ms < trip.due_ms:
        raise ValueError
    if not _in_range(trip.bench_price, STATION_BY_KEY["spice"].initial, state.base_price):
        raise ValueError
    for key, count in route.load:
        if count > state.stock.capacity or state.shipped < RECIPE_BY_KEY[key].unlock + route.packs:
            raise ValueError


def _validate_rota(state: Factory) -> None:
    rota = state.rota
    if not isinstance(rota.slots, list) or len(rota.slots) > ROTA_SLOTS:
        raise ValueError
    if any(state.shipped < RECIPE_BY_KEY[key].unlock for key in rota.slots):
        raise ValueError
    if rota.running:
        if not _in_range(rota.phase_ms, 0, len(rota.slots) * ROTA_LEG_MS - 1):
            raise ValueError
        if len(set(rota.slots)) < 2 or state.recipe_key != rota.current:
            raise ValueError


def _validate(state: Factory) -> None:
    counts = (state.last_ms, state.coins, state.shipped, state.progress, state.steam_ms,
              state.filled, state.deliveries, state.rush_wins, state.cart_runs)
    if not all(_is_count(value) for value in counts):
        raise ValueError
    if state.progress >= MINUTE or state.steam_ms > MAX_CHARGES * CHARGE_TIME:
        raise ValueError
    for station in STATIONS:
        if not _in_range(getattr(state, station.key), 1, MAX_LEVEL):
            raise ValueError
    if state.active_order is None:
        if state.filled:
            raise ValueError
    else:
        order = ORDER_BY_KEY[state.active_order]
        if state.shipped < order.unlock or state.filled > min(order.target, state.shipped):
            raise ValueError
        if state.dispatch_mode == "running" and state.filled == order.target:
            raise ValueError
    if state.dispatch_mode not in ("unhired", "running", "paused"):
        raise ValueError
    if state.dispatch_mode != "unhired" and state.deliveries < DISPATCH_UNLOCK:
        raise ValueError
    if state.shipped < RECIPE_BY_KEY[state.recipe_key].unlock:
        raise ValueError
    _validate_ticket(state)
    _validate_stock(state)
    _validate_cart(state)
    _validate_rota(state)


def _unique_fields(pairs: list) -> dict:
    values = dict(pairs)
    if len(values) != len(pairs):
        raise ValueError("Duplicate field in save data")
    return values


def _read_record(kind, data: dict):
    if not isinstance(data, dict) or data.keys() != {field.name for field in fields(kind)}:
        raise ValueError
    return kind(**data)


def _decode(payload: str, version: int) -> Factory:
    try:
        data = json.loads(payload, object_pairs_hook=_unique_fields)
        if not isinstance(data, dict) or data.keys() != VERSION_FIELDS[version]:
            raise ValueError
        if version >= 2 and data["ticket"] is not None:
            data["ticket"] = _read_record(RushTicket, data["ticket"])
        if version >= 3:
            data["stock"] = _read_record(Stockroom, data["stock"])
            data["rota"] = _read_record(Rota, data["rota"])
            if data["cart"] is not None:
                data["cart"] = _read_record(CartTrip, data["cart"])
        state = Factory(**data)
        _validate(state)
        return state
    except (ValueError, TypeError, KeyError, RecursionError) as exc:
        raise SaveError("The slot contains invalid factory data.") from exc


@dataclass
class Visit:
    factory: Factory
    earnings: Earnings
    fresh: bool


class Ledger:
    def __init__(self, connection: sqlite3.Connection, slot: str):
        self.connection = connection
        self.slot = slot

    def checkpoint(self, now_ms: int) -> Visit:
        with self.visit(now_ms) as visit:
            return visit

    @contextmanager
    def visit(self, now_ms: int):
        db = self.connection
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute("SELECT version, payload FROM factories WHERE slot = ?",
                             (self.slot,)).fetchone()
            if row is None:
                factory = Factory(last_ms=max(0, now_ms))
            else:
                version, payload = row
                if version not in VERSION_FIELDS:
                    raise SaveError(f"Slot '{self.slot}' uses unsupported save version {version}.")
                factory = _decode(payload, version)
            yield Visit(factory, factory.advance(now_ms), row is None)
            db.execute("INSERT OR REPLACE INTO factories (slot, version, payload) VALUES (?, ?, ?)",
                       (self.slot, SAVE_VERSION, json.dumps(asdict(factory), separators=(",", ":"))))
            db.commit()
        except BaseException:
            db.rollback()
            raise


@contextmanager
def open_ledger(path: Path | str, slot: str = "main"):
    slot = slot_name(slot)
    connection = sqlite3.connect(path, isolation_level=None, timeout=5)
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS factories "
                           "(slot TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL)")
        yield Ledger(connection, slot)
    finally:
        connection.close()
