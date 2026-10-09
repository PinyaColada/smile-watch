"""Seeded SYNTHETIC European option chains; not recorded SPY market data.

The live-session event is deliberately injected: at minute 270 (14:00 NY),
level rises and SSVI rho becomes more negative, with a 4-minute ramp and
45-minute decay. It exists to make downside dislocation visible in a demo.

SSVI: w(k) = theta/2 * (1 + rho*phi*k + sqrt((phi*k+rho)^2+1-rho^2)).
phi = eta/sqrt(theta), eta <= 0.85, |rho| <= .88. Each clean slice satisfies
sufficient butterfly bounds theta*phi*(1+|rho|)<4 and
 theta*phi^2*(1+|rho|)<=4. Quote perturbations need not be arbitrage-free.
This is slice-aware, not a proof of calendar arbitrage absence for the
independently evolving expiry buckets or noisy quotes.
"""

from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache

import numpy as np

from .baseline import NY
from .bs import price
from .models import TENORS, Chain

SEED = 20260319


def sessions() -> list[date]:
    # Deterministic demo calendar spanning US DST on March 8, 2026.
    # Two explicitly synthetic half-days, not a claim about exchange holidays.
    start = date(2026, 2, 5)
    days = []
    while len(days) < 31:
        if start.weekday() < 5:
            days.append(start)
        start += timedelta(days=1)
    return days


def session_length(index: int) -> int:
    return 211 if index in (8, 23) else 391


def open_time(day: date) -> datetime:
    return datetime.combine(day, time(9, 30), NY).astimezone(UTC)


def expiry_time(day: date, tenor: int, half_day=False) -> datetime:
    # DTE buckets are calendar days; fictitious weekend expiries are allowed.
    expiry_day = day + timedelta(days=tenor)
    hour = 13 if half_day and tenor == 0 else 16
    return datetime.combine(expiry_day, time(hour), NY).astimezone(UTC)


def ssvi(log_moneyness, theta, rho, eta):
    phi = eta / np.sqrt(np.maximum(theta, 1e-12))
    x = phi * log_moneyness
    return theta / 2 * (1 + rho * x + np.sqrt((x + rho) ** 2 + 1 - rho**2))


class SyntheticSource:
    def __init__(self, seed: int = SEED):
        self.seed = seed
        self.days = sessions()
        self.block = lru_cache(maxsize=4)(self._block)

    def _block(self, session: int, tenor: int):
        rng = np.random.default_rng(np.random.SeedSequence([self.seed, session]))
        n = session_length(session)
        m = np.arange(n)
        shocks = rng.normal(size=n)
        returns = 0.00018 * shocks
        spot = 580 * np.exp(rng.normal(0, 0.005) + np.cumsum(returns))
        level = np.empty(n)
        level[0] = rng.normal(0, 0.009)
        for i in range(1, n):
            level[i] = 0.985 * level[i - 1] - 0.0005 * shocks[i] + rng.normal(0, 0.0006)
        shape = 0.027 * np.exp(-m / 38) + 0.014 * (m / max(n - 1, 1)) ** 6
        daily = rng.normal(0, 0.008)
        event = np.zeros(n)
        if session == 30:
            elapsed = np.maximum(m - 270, 0)
            event = (1 - np.exp(-elapsed / 2.0)) * np.exp(-elapsed / 45)
            spot *= np.exp(-0.008 * (1 - np.exp(-elapsed / 3)))
        term = 1 / (1 + tenor / 12)
        atm = np.maximum(0.10, 0.19 + daily + shape * term + level + 0.046 * event * term)
        rho = np.clip(
            -0.37 + rng.normal(0, 0.025) + 10 * np.log(spot / spot[0]) - 0.42 * event * term,
            -0.88,
            -0.15,
        )
        eta = np.clip(0.63 + 0.04 * np.sin(m / 105) + 0.12 * event * term, 0.45, 0.85)
        ts = [open_time(self.days[session]) + timedelta(minutes=int(i)) for i in m]
        expiry = expiry_time(self.days[session], tenor, n == 211)
        years = np.array([max(0, (expiry - t).total_seconds()) / (365 * 86400) for t in ts])
        # Fixed $1 strikes in a session, sufficiently wide for 30DTE delta wings.
        strikes = np.arange(np.floor(spot.min()) - 85, np.ceil(spot.max()) + 86)
        forward = spot[:, None] * np.exp((0.04 - 0.012) * years[:, None])
        theta = atm**2 * np.maximum(years, 1e-12)
        total = ssvi(np.log(strikes[None, :] / forward), theta[:, None], rho[:, None], eta[:, None])
        vol = np.sqrt(total / np.maximum(years[:, None], 1e-12))
        quote_rng = np.random.default_rng(np.random.SeedSequence([self.seed, session, tenor, 9]))
        # Small, smooth put/call disagreement avoids making the clean smile a lookup oracle.
        perturbation = quote_rng.normal(0, 0.00012, (n, 2, len(strikes)))
        side_bias = np.array([0.0002, -0.0002])[None, :, None]
        vols = np.maximum(0.01, vol[:, None, :] + perturbation + side_bias)
        mids = price(
            spot[:, None, None],
            strikes[None, None, :],
            years[:, None, None],
            vols,
            np.array(["P", "C"])[None, :, None],
        )
        spread = np.minimum(mids * 0.08, 0.012 + mids * 0.006)
        bid, ask = mids - spread / 2, mids + spread / 2
        age = np.zeros_like(mids)
        defects = quote_rng.random(mids.shape)
        bid[defects < 0.001] = np.nan
        ask[(defects >= 0.001) & (defects < 0.0015)] = np.nan
        age[(defects >= 0.0015) & (defects < 0.0025)] = 180
        crossed = (defects >= 0.0025) & (defects < 0.0027)
        bid[crossed] = ask[crossed] + 0.01
        return ts, expiry, spot, strikes, bid, ask, age

    def get_chain(self, underlying: str, expiry: datetime, ts: datetime) -> Chain:
        if underlying != "SPY" or ts.tzinfo is None or expiry.tzinfo is None:
            raise ValueError("Use SPY and timezone-aware times")
        day = ts.astimezone(NY).date()
        session = self.days.index(day)
        for tenor in TENORS:
            block = self.block(session, tenor)
            if block[1] == expiry:
                minute = int((ts - block[0][0]).total_seconds() / 60)
                if not 0 <= minute < len(block[0]) or ts != block[0][minute]:
                    raise ValueError("Synthetic source contains minute snapshots only")
                return Chain(
                    underlying,
                    expiry,
                    ts,
                    float(block[2][minute]),
                    block[3],
                    block[4][minute],
                    block[5][minute],
                    block[6][minute],
                )
        raise ValueError("Unknown expiry")
