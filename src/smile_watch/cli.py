"""Reproducible offline build: smile-watch build [--seed N]."""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from .baseline import zscore
from .bs import implied_vol_array
from .engine import evaluate
from .export import export_data
from .models import SERIES, TENORS, Chain
from .storage import connect, write_rows
from .synth import SEED, SyntheticSource


def build(root: Path, seed: int = SEED) -> None:
    source = SyntheticSource(seed)
    values = np.full((31, 4, 391, 8), np.nan)
    curves = np.full((31, 4, 391, 17), np.nan)
    strikes_out = np.full((31, 4, 391, 4), np.nan)
    spots = np.full((31, 391), np.nan)
    flags_out = np.ones(values.shape, dtype=np.uint8)
    flag_codes = {
        "ok": 0,
        "unavailable": 1,
        "expired": 2,
        "insufficient_quotes": 3,
        "nonmonotone_delta": 4,
        "outside_delta_range": 5,
        "strike_gap": 6,
        "missing_leg": 7,
    }
    db = connect(root / "build" / "smile-watch.sqlite")
    db.execute("DELETE FROM observations")
    started = time.monotonic()
    for session, day in enumerate(source.days):
        rows = []
        for e, tenor in enumerate(TENORS):
            ts, expiry, spot, strikes, bid, ask, age = source.block(session, tenor)
            years = np.array([max(0, (expiry - t).total_seconds()) / (365 * 86400) for t in ts])
            ivs = implied_vol_array(
                (bid + ask) / 2,
                spot[:, None, None],
                strikes[None, None, :],
                years[:, None, None],
                np.array(["P", "C"])[None, :, None],
            )
            valid = (
                np.isfinite(bid)
                & np.isfinite(ask)
                & (bid > 0)
                & (ask >= bid)
                & (age <= 90)
                & ((ask - bid) <= np.maximum(0.15, 0.4 * ask))
            )
            ivs[~valid] = np.nan
            for m, stamp in enumerate(ts):
                chain = Chain("SPY", expiry, stamp, float(spot[m]), strikes, bid[m], ask[m], age[m])
                val, flags, curve, target_k = evaluate(chain, ivs[m])
                values[session, e, m] = val
                curves[session, e, m] = curve
                strikes_out[session, e, m] = target_k
                flags_out[session, e, m] = [flag_codes[f] for f in flags]
                rows.extend(
                    (
                        str(day),
                        stamp.isoformat(),
                        expiry.isoformat(),
                        tenor,
                        m,
                        name,
                        float(v) if np.isfinite(v) else None,
                        flag,
                        1,
                    )
                    for name, v, flag in zip(SERIES, val, flags, strict=True)
                )
            spots[session, : len(spot)] = spot
        write_rows(db, rows)
        print(
            f"{session + 1:02}/31 {day}: {len(rows):,} observations "
            f"({time.monotonic() - started:.1f}s)",
            flush=True,
        )
    db.execute("INSERT OR REPLACE INTO metadata VALUES ('synthetic', 'true')")
    db.execute("INSERT OR REPLACE INTO metadata VALUES ('seed', ?)", (str(seed),))
    db.commit()
    db.close()
    (root / "build").mkdir(exist_ok=True)
    np.savez_compressed(
        root / "build" / "engine.npz",
        values=values,
        curves=curves,
        strikes=strikes_out,
        spots=spots,
        flags=flags_out,
    )
    export_data(root / "docs" / "data", values, curves, strikes_out, spots, flags_out, seed)
    z, _, _, _ = zscore(values, 30)
    finite = z[2, 270:330, 1]
    peak = float(np.nanmax(finite))
    report = dict(
        synthetic=True,
        seed=seed,
        seconds=round(time.monotonic() - started, 2),
        observations=int(np.prod(values.shape)),
        valid=int(np.isfinite(values).sum()),
        event_p25_7dte_peak_z=peak,
        event_p25_7dte_peak_minute=270 + int(np.nanargmax(finite)),
    )
    (root / "artifacts").mkdir(exist_ok=True)
    (root / "artifacts" / "engine-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if seed == SEED and peak <= 3:
        raise RuntimeError("Documented default event did not cross +3")


def main() -> None:
    parser = argparse.ArgumentParser(description="SYNTHETIC smile-watch dataset builder")
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("build")
    command.add_argument("--root", type=Path, default=Path.cwd())
    command.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    build(args.root.resolve(), args.seed)


if __name__ == "__main__":
    main()
