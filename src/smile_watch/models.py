"""Shared immutable data-source contract. All timestamps must be timezone aware."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]
SERIES = ("P15", "P25", "C25", "C15", "RR25", "RR15", "put_wing", "call_wing")
TENORS = (0, 1, 7, 30)
GRID = np.arange(0.10, 0.901, 0.05)
TARGET_INDICES = (1, 3, 13, 15)


@dataclass(frozen=True)
class Chain:
    underlying: str
    expiry: datetime
    ts: datetime
    spot: float
    strikes: Array
    # First row puts, second row calls; prices in dollars, IV in fractions.
    bid: Array
    ask: Array
    age_seconds: Array
    rate: float = 0.04
    dividend: float = 0.012
    synthetic: bool = True

    @property
    def years(self) -> float:
        return max(0.0, (self.expiry - self.ts).total_seconds() / (365 * 86400))


class DataSource(Protocol):
    def get_chain(self, underlying: str, expiry: datetime, ts: datetime) -> Chain: ...


@dataclass(frozen=True)
class Point:
    value: float = float("nan")
    strike: float = float("nan")
    flag: str = "unavailable"
