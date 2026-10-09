# smile-watch

Synthetic delta-based implied volatility monitor. Implementation in progress.

## Accepted design

Python 3.11, NumPy/SciPy pricing, SQLite storage and a static GitHub Pages replay.
Track P15, P25, C25 and C15 with PCHIP interpolation in spot-delta space.
Compare observations with the same minutes after the New York open in prior completed
sessions, never the current session. Default window: 20 sessions; minimum: eight points.

Generate 30 historical sessions and one synthetic live session with four expiry buckets.
A documented downside-skew event is injected at 14:00 in the final session.
All displayed market data must be labelled synthetic. No predictive claim is made.

Build order: engine and plain plots; 2D replay; Three.js scene; GitHub Pages deployment.
Commit and show artifacts at each milestone. Self-contained index.html must work offline.

The IBKR adapter has NOT been tested against a live account.
