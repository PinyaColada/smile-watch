# SYNTHETIC DATA — smile-watch methodology

The dataset is a demonstration, not a recording of SPY. It measures unusual
levels relative to its own synthetic history. It has no demonstrated predictive value.

## Pricing and quote quality

European Black–Scholes uses spot delta, a continuously compounded 4% risk-free rate,
and a 1.2% dividend yield. Time is actual UTC seconds divided by 365 days. Put deltas
are negative; call deltas are positive. These European options are SPY-like, not a
model of SPY American exercise or dividend assignment risk.

The scalar IV solver is Brent with a [1e-8, 5] bracket. The batch solver bisects the
same bracket 37 times (absolute bracket width below 4e-11). Stable log-CDF differences
price the OTM leg; put-call parity supplies the ITM leg. Prices below floating-point
identifiability, expired options and prices outside the solver bracket are unavailable.

Quotes with missing sides, nonpositive bids, crossed markets, age above 90 seconds,
or excessive spreads are excluded. The spread limit is max($0.15, 40% of ask).
Deltas are computed from recovered midpoint IVs. A local, shape-preserving PCHIP
uses two bracketing strikes and up to two contiguous neighbors. It never extrapolates
or chooses the closest strike. A strike gap greater than $2, nonmonotonic deltas or
insufficient quotes produces an explicit flag. Target strikes shown in the interface
are linear interpolations of the two bracket strikes; IV uses PCHIP.

## Synthetic dynamics and deliberate event

SSVI total variance is w(k) = theta/2 × [1 + rho×phi×k + sqrt((phi×k+rho)^2 + 1-rho²)],
where k is log strike/forward, theta is ATM variance × time, and phi=eta/sqrt(theta).
The clean slices obey sufficient butterfly constraints from
[Gatheral and Jacquier](https://arxiv.org/abs/1204.0646).
This is not a claim that all noisy quotes or the cross-expiry surface are arbitrage-free.

Spot follows small seeded log-return shocks. Volatility level mean-reverts, responds
negatively to spot shocks, starts elevated, eases at midday and rises into the close.
Skew responds to spot drawdowns. Curvature evolves smoothly. Bid/ask spreads, small
put/call IV disagreement, missing data, crossed quotes and stale timestamps are added.

The final session deliberately injects a downside shock beginning at 14:00 NY: spot
drops, level rises and rho becomes more negative. The shape is
(1-exp(-elapsed/2)) × exp(-elapsed/45), with elapsed in minutes since 14:00. The level
coefficient is 0.046 and rho coefficient -0.42, each attenuated by 1/(1+DTE/12).
The event is disclosed in code, plots, README and replay. It is not a discovered anomaly.

## History and calendar

Thirty completed prior sessions precede the synthetic live session. The demo calendar
runs over a US DST transition and includes two fictitious 13:00 half-days. It is not
an authoritative exchange calendar. DTE means calendar days; synthetic weekend
expiries are allowed. Within a session each bucket refers to one fixed expiry.
Historical baselines compare the same DTE bucket, not the identical contract.

Observations are aligned by integer minutes since 09:30 America/New_York, independent
of UTC offset. Half-day afternoons are missing, not zero or carried forward. The last
N completed sessions form the window, excluding the current session; missing values
do not extend that window. Eight valid points are required. The standard deviation
uses ddof=1. Near-zero standard deviations and insufficient history yield no z-score.
Each derived series has its own baseline. A risk reversal is call IV minus put IV.
A negative RR z-score can therefore signal unusually expensive downside protection.

One-minute snapshots include the closing instant. At expiry itself, 0DTE IV is
unavailable. Thirty-second resampling carries forward the latest minute observation;
five-minute sampling selects observations at right-labelled endpoints, never using
a future observation. Baselines use exactly the same sampling times. No intraminute
observations are invented. Replay is an ex-post exploration: the full future surface
is faint but visible, while charts and alerts reveal only the elapsed portion.

## Persistence and browser export

SQLite records local session, aware UTC timestamp, actual expiry, DTE bucket,
minutes since open, series, value, flags and synthetic provenance. Missing values
are SQL NULL. Raw chains are reproducible on demand from the seed, rather than
committed as a large quote dump. Full-precision result arrays are kept locally.

Browser series and 17-point delta curves use signed int16 at 1/50,000 IV resolution
(maximum rounding error 0.001 volatility percentage points). Strikes and spot are
quantized to cents. Missingness and quality flags survive export. Replay statistics
are computed from these quantized values, so tiny differences from full-precision
Python z-scores are expected and tested within an explicit tolerance.

## IBKR limits

The IBKR adapter has NOT been tested against a live account.

It defaults to paper TWS on 127.0.0.1:7497 with a read-only API connection. It retrieves
current option snapshots through ib_async, not historical chain backfills. Delayed
market data are rejected. Snapshot timestamps may represent receipt time and do not
guarantee exchange quote freshness. Production use would require market data
subscriptions, pacing and retry policy, contract/calendar handling, robust quote
freshness and quality filters, and an American exercise/dividend methodology.
