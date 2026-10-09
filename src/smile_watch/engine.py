"""Pure chain-to-series calculation. Values are annualized IV fractions."""

import numpy as np

from .interpolate import smile
from .models import TARGET_INDICES, Chain


def evaluate(
    chain: Chain, ivs: np.ndarray | None = None
) -> tuple[np.ndarray, list[str], np.ndarray, np.ndarray]:
    points = smile(chain, ivs)
    primary = [points[i] for i in TARGET_INDICES]
    v = np.array([p.value for p in primary])
    derived = np.array([v[2] - v[1], v[3] - v[0], v[0] - v[1], v[3] - v[2]])
    values = np.concatenate([v, derived])
    flags = [p.flag for p in primary] + ["ok" if np.isfinite(x) else "missing_leg" for x in derived]
    return values, flags, np.array([p.value for p in points]), np.array([p.strike for p in primary])
