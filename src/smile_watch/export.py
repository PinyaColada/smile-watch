"""Compact, deterministic web export. NaNs have an explicit integer sentinel."""

import base64
import json
import zlib
from pathlib import Path

import numpy as np

from .models import GRID, SERIES, TENORS
from .synth import SEED, session_length, sessions


def export_data(
    out: Path,
    values: np.ndarray,
    curves: np.ndarray,
    strikes: np.ndarray,
    spots: np.ndarray,
    flags: np.ndarray,
    seed: int = SEED,
) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    fields = {}
    chunks = []
    offset = 0
    for name, arr, scale, dtype, missing in (
        ("values", values, 50000, "<i2", -32768),
        ("curves", curves, 50000, "<i2", -32768),
        ("strikes", strikes, 100, "<i4", -2147483648),
        ("spots", spots, 100, "<i4", -2147483648),
        ("flags", flags, 1, "u1", 255),
    ):
        valid = np.isfinite(arr)
        quantized = np.where(valid, np.rint(arr * scale), missing)
        limits = np.iinfo(np.dtype(dtype))
        if np.any(quantized < limits.min) or np.any(quantized > limits.max):
            raise ValueError(f"Quantization overflow in {name}")
        raw = quantized.astype(dtype).tobytes()
        fields[name] = dict(
            offset=offset,
            shape=list(arr.shape),
            scale=scale,
            dtype=dtype,
            missing=missing,
            bytes=len(raw),
        )
        chunks.append(raw)
        offset += len(raw)
    packed = zlib.compress(b"".join(chunks), 9)
    manifest = dict(
        schema=1,
        synthetic=True,
        seed=seed,
        timezone="America/New_York",
        sessions=[str(d) for d in sessions()],
        lengths=[session_length(i) for i in range(31)],
        tenors=TENORS,
        series=SERIES,
        grid=np.round(GRID, 2).tolist(),
        fields=fields,
        minimumHistory=8,
        eventMinute=270,
        injection="Deliberate downside-skew shock at 14:00 in the final session",
        flagCodes={
            "ok": 0,
            "unavailable": 1,
            "expired": 2,
            "insufficient_quotes": 3,
            "nonmonotone_delta": 4,
            "outside_delta_range": 5,
            "strike_gap": 6,
            "missing_leg": 7,
        },
    )
    (out / "replay.bin").write_bytes(packed)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    # Build tooling embeds this into index.html; it is not fetched by the browser.
    (out / "replay.json").write_text(
        json.dumps(
            dict(manifest=manifest, payload=base64.b64encode(packed).decode()),
            separators=(",", ":"),
        )
    )
    return manifest
