"""Shared input checks for single-shoe sessions and opening-hand studies."""

from fractions import Fraction
from secrets import randbits


def bankroll_amount(value: int | float | Fraction | None, *, opening: bool = False) -> Fraction | None:
    if value is None:
        return None
    message = "bankroll must be a nonnegative amount in whole or half units"
    if isinstance(value, bool) or not isinstance(value, (int, float, Fraction)):
        raise ValueError(message)
    try:
        amount = Fraction(value)
    except (ValueError, OverflowError):
        raise ValueError(message) from None
    if amount < 0 or amount.denominator > 2:
        raise ValueError(message)
    if opening and amount < 1:
        raise ValueError("an opening decision requires a bankroll of at least one unit")
    return amount


def resolve_seed(seed: int | None) -> int:
    if seed is None:
        return randbits(64)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    return seed


def require_positive_count(count: int, name: str) -> None:
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ValueError(f"{name} must be a positive integer")
