"""European Black–Scholes with stable OTM prices and bracketed inversion.

ITM options whose time value is lost to floating-point precision are unavailable,
not assigned an arbitrary volatility. The vector solver is bracketed bisection.
"""

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import brentq
from scipy.special import log_ndtr, ndtr


def price(
    spot: ArrayLike,
    strike: ArrayLike,
    years: ArrayLike,
    vol: ArrayLike,
    right: ArrayLike = "C",
    rate: float = 0.04,
    dividend: float = 0.012,
) -> NDArray:
    s, k, t, v = np.broadcast_arrays(spot, strike, years, vol)
    if np.any(s <= 0) or np.any(k <= 0) or np.any(t < 0) or np.any(v < 0):
        raise ValueError("Positive spot/strike and nonnegative time/vol required")
    a, b = s * np.exp(-dividend * t), k * np.exp(-rate * t)
    w = np.maximum(v * np.sqrt(t), 1e-12)
    d1 = np.log(a / b) / w + w / 2
    d2 = d1 - w
    # Price the OTM side via a log-CDF difference, then apply put-call parity.
    call_otm = a <= b
    log_hi = np.where(call_otm, np.log(a) + log_ndtr(d1), np.log(b) + log_ndtr(-d2))
    log_lo = np.where(call_otm, np.log(b) + log_ndtr(d2), np.log(a) + log_ndtr(-d1))
    otm = np.exp(log_hi) * -np.expm1(np.minimum(log_lo - log_hi, 0))
    call = otm + np.maximum(a - b, 0)
    put = otm + np.maximum(b - a, 0)
    result = np.where(np.asarray(right) == "C", call, put)
    intrinsic = np.maximum(np.where(np.asarray(right) == "C", a - b, b - a), 0)
    return np.where((t == 0) | (v == 0), intrinsic, result)


def delta(
    spot: ArrayLike,
    strike: ArrayLike,
    years: ArrayLike,
    vol: ArrayLike,
    right: ArrayLike = "C",
    rate: float = 0.04,
    dividend: float = 0.012,
) -> NDArray:
    if np.any(np.asarray(years) <= 0) or np.any(np.asarray(vol) <= 0):
        raise ValueError("Delta requires positive time and volatility")
    d1 = (
        np.log(np.asarray(spot) / strike) + (rate - dividend + np.asarray(vol) ** 2 / 2) * years
    ) / (vol * np.sqrt(years))
    return np.exp(-dividend * years) * (ndtr(d1) - (np.asarray(right) == "P"))


def implied_vol(
    mid: float,
    spot: float,
    strike: float,
    years: float,
    right: str = "C",
    rate: float = 0.04,
    dividend: float = 0.012,
) -> float:
    """Scalar Brent reference solver; NaN for non-identifiable or invalid quotes."""
    if years <= 0 or not np.isfinite(mid) or mid <= 0:
        return float("nan")
    low = float(price(spot, strike, years, 0, right, rate, dividend))
    high = float(price(spot, strike, years, 5, right, rate, dividend))
    if mid <= low + np.spacing(max(low, 1.0)) * 4 or mid >= high:
        return float("nan")
    return brentq(
        lambda v: float(price(spot, strike, years, v, right, rate, dividend)) - mid,
        1e-8,
        5.0,
        xtol=1e-12,
    )


def implied_vol_array(
    mid: ArrayLike,
    spot: ArrayLike,
    strike: ArrayLike,
    years: ArrayLike,
    right: ArrayLike = "C",
    rate: float = 0.04,
    dividend: float = 0.012,
) -> NDArray:
    """Vectorized bracketed inversion. Absolute IV bracket error below 5e-11."""
    mid, s, k, t, side = np.broadcast_arrays(mid, spot, strike, years, right)
    low_price = price(s, k, t, 0, side, rate, dividend)
    high_price = price(s, k, t, 5, side, rate, dividend)
    valid = (
        np.isfinite(mid)
        & (t > 0)
        & (mid > low_price + 4 * np.spacing(np.maximum(low_price, 1)))
        & (mid < high_price)
    )
    lo, hi = np.full(mid.shape, 1e-8), np.full(mid.shape, 5.0)
    for _ in range(37):
        v = (lo + hi) / 2
        below = price(s, k, t, v, side, rate, dividend) < mid
        lo, hi = np.where(below, v, lo), np.where(below, hi, v)
    return np.where(valid, (lo + hi) / 2, np.nan)
