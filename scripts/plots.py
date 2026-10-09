"""Plain diagnostic plots from full-precision engine results, before web rendering."""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from smile_watch.baseline import zscore
from smile_watch.models import SERIES

ROOT = Path(__file__).resolve().parents[1]
data = np.load(ROOT / "build/engine.npz")
values = data["values"]
z, mean, std, count = zscore(values, 30)
x = np.arange(391)
fig, axes = plt.subplots(3, 1, figsize=(12, 9), sharex=True, layout="constrained")
colors = ["#25358f", "#159a9c", "#9f68b6", "#826027"]
for i in range(4):
    axes[0].plot(x, values[30, 2, :, i] * 100, label=SERIES[i], color=colors[i], lw=1.4)
    axes[1].plot(x, values[30, 2, :, i + 4] * 100, label=SERIES[i + 4], color=colors[i], lw=1.4)
    axes[2].plot(x, z[2, :, i], label=SERIES[i], color=colors[i], lw=1.2)
axes[0].plot(x, mean[2, :, 1] * 100, "--", color="#555", label="P25 prior-session mean", lw=1)
axes[0].fill_between(
    x,
    (mean[2, :, 1] - std[2, :, 1]) * 100,
    (mean[2, :, 1] + std[2, :, 1]) * 100,
    color="#555",
    alpha=0.1,
)
for y in (-3, -2, 2, 3):
    axes[2].axhline(y, color="#b34532", ls="--", lw=0.8)
for ax in axes:
    ax.axvline(270, color="#b34532", ls=":", label="Injected event · 14:00")
    ax.grid(alpha=0.15)
    ax.legend(loc="upper left", ncol=3, fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
axes[0].set_ylabel("IV (%)")
axes[1].set_ylabel("Difference (vol points)")
axes[2].set_ylabel("z-score (sample σ)")
axes[2].set_xticks([0, 90, 180, 270, 390], ["09:30", "11:00", "12:30", "14:00", "16:00"])
axes[2].set_xlabel("America/New_York · minutes since open; 20 prior completed sessions")
fig.suptitle(
    "SYNTHETIC DATA · smile-watch engine diagnostics · 7DTE\n"
    "Deliberate downside-skew injection at 14:00; not recorded market data",
    fontsize=14,
)
fig.savefig(ROOT / "artifacts/engine-diagnostics.png", dpi=160)
plt.close(fig)
m = 277
report = dict(
    synthetic=True,
    session="2026-03-19",
    time="14:07 America/New_York",
    tenor="7DTE",
    window=20,
    series={
        name: dict(
            value=float(values[30, 2, m, i]),
            historical_mean=float(mean[2, m, i]),
            historical_std=float(std[2, m, i]),
            z=float(z[2, m, i]),
            count=int(count[2, m, i]),
        )
        for i, name in enumerate(SERIES)
    },
)
(ROOT / "artifacts/at-1407.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
