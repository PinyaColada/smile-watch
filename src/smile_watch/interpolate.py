"""Quality-controlled PCHIP in delta space, never nearest strike."""

import numpy as np
from scipy.interpolate import PchipInterpolator

from .bs import delta, implied_vol_array
from .models import GRID, Chain, Point


def quote_ivs(chain: Chain) -> np.ndarray:
    if chain.years <= 0:
        return np.full(chain.bid.shape, np.nan)
    valid = (
        np.isfinite(chain.bid)
        & np.isfinite(chain.ask)
        & (chain.bid > 0)
        & (chain.ask >= chain.bid)
        & (chain.age_seconds >= 0)
        & (chain.age_seconds <= 90)
        & ((chain.ask - chain.bid) <= np.maximum(0.15, 0.4 * chain.ask))
    )
    iv = implied_vol_array(
        (chain.bid + chain.ask) / 2,
        chain.spot,
        chain.strikes,
        chain.years,
        np.array([["P"], ["C"]]),
        chain.rate,
        chain.dividend,
    )
    return np.where(valid, iv, np.nan)


def interpolate_side(
    strikes: np.ndarray,
    ivs: np.ndarray,
    deltas: np.ndarray,
    target: float,
    max_strike_gap: float = 2.01,
) -> Point:
    """Use the contiguous monotonic quote segment containing the bracketing pair."""
    good = np.isfinite(ivs) & np.isfinite(deltas)
    k, v, d = strikes[good], ivs[good], deltas[good]
    order = np.argsort(k)
    k, v, d = k[order], v[order], d[order]
    if len(k) < 2:
        return Point(flag="insufficient_quotes")
    # Both call and signed put deltas must decrease as strike increases.
    if np.any(np.diff(d) >= -1e-10):
        return Point(flag="nonmonotone_delta")
    k, v, d = k[::-1], v[::-1], d[::-1]
    j = int(np.searchsorted(d, target))
    if j == 0 or j == len(d):
        return Point(flag="outside_delta_range")
    if abs(k[j] - k[j - 1]) > max_strike_gap:
        return Point(flag="strike_gap")
    # A local four-point PCHIP avoids unrelated distant quote defects/gaps.
    a, b = max(0, j - 2), min(len(d), j + 2)
    while a < j - 1 and abs(k[a + 1] - k[a]) > max_strike_gap:
        a += 1
    while b > j + 1 and abs(k[b - 1] - k[b - 2]) > max_strike_gap:
        b -= 1
    return Point(
        float(PchipInterpolator(d[a:b], v[a:b])(target)),
        float(np.interp(target, d[j - 1 : j + 1], k[j - 1 : j + 1])),
        "ok",
    )


def smile(chain: Chain, ivs: np.ndarray | None = None) -> list[Point]:
    if chain.years <= 0:
        return [Point(flag="expired") for _ in GRID]
    ivs = quote_ivs(chain) if ivs is None else ivs
    points = []
    for x in GRID:
        side = 0 if x < 0.5 - 1e-8 else 1
        target = -float(x) if side == 0 else float(1 - x)
        v = ivs[side]
        # Restrict to each smile half; tiny deep-ITM quotes are ill-conditioned.
        ds = delta(
            chain.spot,
            chain.strikes,
            chain.years,
            np.where(np.isfinite(v), v, 0.2),
            "P" if side == 0 else "C",
            chain.rate,
            chain.dividend,
        )
        mask = (np.abs(ds) >= 0.03) & (np.abs(ds) <= 0.65)
        points.append(interpolate_side(chain.strikes[mask], v[mask], ds[mask], target))
    return points
