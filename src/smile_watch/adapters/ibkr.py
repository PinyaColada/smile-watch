"""Read-only ib_async snapshot adapter. NOT tested against a live account.

A current snapshot interface, not historical option-chain backfill. IBKR quote
permissions, pacing, exchange calendars and American exercise require additional
production work. No order methods are used. Delayed snapshots are unavailable.
"""

from datetime import UTC, datetime

import numpy as np

from ..models import Chain


class IBKRSource:
    def __init__(
        self,
        ib=None,
        *,
        host="127.0.0.1",
        port=7497,
        client_id=17,
        paper=True,
        rate=0.04,
        dividend=0.012,
        clock=None,
    ):
        from ib_async import IB

        if paper and port not in (7497, 4002):
            raise ValueError("Paper mode requires port 7497 or 4002")
        self.ib = ib if ib is not None else IB()
        self.host, self.port, self.client_id = host, port, client_id
        self.rate, self.dividend = rate, dividend
        self.clock = clock or (lambda: datetime.now(UTC))

    def connect(self) -> None:
        self.ib.connect(self.host, self.port, clientId=self.client_id, readonly=True)
        self.ib.reqMarketDataType(1)

    def get_chain(self, underlying: str, expiry: datetime, ts: datetime) -> Chain:
        from ib_async import Option, Stock

        if ts.tzinfo is None or expiry.tzinfo is None:
            raise ValueError("Timezone-aware timestamps required")
        now = self.clock()
        if abs((now - ts).total_seconds()) > 90:
            raise ValueError("IBKR adapter supports current snapshots, not historical replay")
        (stock,) = self.ib.qualifyContracts(Stock(underlying, "SMART", "USD"))
        (ticker,) = self.ib.reqTickers(stock)
        spot = float(ticker.marketPrice())
        if not np.isfinite(spot) or spot <= 0:
            raise ValueError("Underlying price unavailable")
        chains = self.ib.reqSecDefOptParams(underlying, "", "STK", stock.conId)
        from ..baseline import NY

        day = expiry.astimezone(NY).strftime("%Y%m%d")
        matching = [
            c
            for c in chains
            if c.exchange == "SMART"
            and day in c.expirations
            and c.tradingClass == underlying
            and c.multiplier == "100"
        ]
        if not matching:
            raise ValueError("Requested expiry unavailable")
        strikes = np.array(sorted(k for k in matching[0].strikes if abs(k - spot) <= 85))
        if len(strikes) < 2:
            raise ValueError("Insufficient strikes")
        contracts = [
            Option(
                underlying, day, float(k), side, "SMART", currency="USD", tradingClass=underlying
            )
            for side in ("P", "C")
            for k in strikes
        ]
        qualified = []
        for i in range(0, len(contracts), 40):
            qualified.extend(self.ib.qualifyContracts(*contracts[i : i + 40]))
        bid, ask, age = (np.full((2, len(strikes)), np.nan) for _ in range(3))
        for i in range(0, len(qualified), 40):
            for quote in self.ib.reqTickers(*qualified[i : i + 40]):
                c = quote.contract
                side = 0 if c.right == "P" else 1
                j = int(np.searchsorted(strikes, c.strike))
                bid[side, j], ask[side, j] = quote.bid, quote.ask
                stamp = quote.time
                # IB timestamps reflect snapshot receipt, not guaranteed exchange freshness.
                age[side, j] = (
                    (ts - stamp).total_seconds()
                    if stamp and stamp.tzinfo and quote.marketDataType == 1
                    else 1e9
                )
                # A snapshot arriving just after the requested instant is age zero.
                if -90 <= age[side, j] < 0:
                    age[side, j] = 0
        return Chain(
            underlying,
            expiry,
            ts,
            spot,
            strikes,
            bid,
            ask,
            age,
            self.rate,
            self.dividend,
            synthetic=False,
        )
