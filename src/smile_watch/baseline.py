"""No-look-ahead session statistics. Index time by minutes since local open."""

from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

NY = ZoneInfo("America/New_York")


def minute_since_open(ts: datetime) -> int:
    if ts.tzinfo is None:
        raise ValueError("Timezone-aware timestamp required")
    local = ts.astimezone(NY)
    return local.hour * 60 + local.minute - 570


def baseline(
    values: np.ndarray, session: int, window: int = 20, minimum: int = 8
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """values axes: session, minute, ...; half-days are padded with NaN.

    The slice ends strictly before session. A window counts completed sessions,
    not valid observations, so half-days do not silently extend the window.
    Sample standard deviation (ddof=1); zero variance has no z-score.
    """
    if window < 1 or minimum < 2 or not 0 <= session < len(values):
        raise ValueError("Invalid history window, minimum, or session index")
    history = np.asarray(values)[max(0, session - window) : session]
    shape = np.shape(values)[1:]
    count = np.sum(np.isfinite(history), axis=0)
    total = np.nansum(history, axis=0)
    mean = np.divide(total, count, out=np.full(shape, np.nan), where=count > 0)
    variance = np.divide(
        np.nansum((history - mean) ** 2, axis=0),
        count - 1,
        out=np.full(shape, np.nan),
        where=count > 1,
    )
    std = np.sqrt(variance)
    valid = (count >= minimum) & (std > 1e-8)
    return np.where(valid, mean, np.nan), np.where(valid, std, np.nan), count


def zscore(
    values: np.ndarray, session: int, window: int = 20, minimum: int = 8
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mean, std, count = baseline(values, session, window, minimum)
    return (values[session] - mean) / std, mean, std, count


def resample(values: np.ndarray, seconds: int) -> tuple[np.ndarray, np.ndarray]:
    """Right-labelled last observation at 5m; carry-forward at 30s. No look-ahead."""
    if seconds not in (30, 60, 300):
        raise ValueError("Sampling frequency must be 30, 60 or 300 seconds")
    times = np.arange(0, (len(values) - 1) * 60 + 1, seconds)
    return times, np.asarray(values)[times // 60]
