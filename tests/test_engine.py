from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import numpy as np
import pytest

from smile_watch.adapters.ibkr import IBKRSource
from smile_watch.baseline import baseline, minute_since_open, resample, zscore
from smile_watch.bs import delta, implied_vol, implied_vol_array, price
from smile_watch.engine import evaluate
from smile_watch.interpolate import interpolate_side, quote_ivs
from smile_watch.models import Chain
from smile_watch.storage import connect, write_rows
from smile_watch.synth import SyntheticSource, expiry_time, open_time, sessions, ssvi


@pytest.mark.parametrize("side", ["P", "C"])
@pytest.mark.parametrize("years", [1 / 365, 7 / 365, 30 / 365])
def test_bs_roundtrip_and_delta(side, years):
    for strike in np.arange(450.0, 711.0, 5):
        p = float(price(580, strike, years, 0.24, side))
        intrinsic = float(price(580, strike, years, 0, side))
        if p - intrinsic < 1e-9:
            continue  # IV not numerically identifiable at machine precision.
        v = implied_vol(p, 580, strike, years, side)
        assert v == pytest.approx(0.24, abs=1e-5)
        h = 0.001
        finite_difference = (
            price(580 + h, strike, years, 0.24, side) - price(580 - h, strike, years, 0.24, side)
        ) / (2 * h)
        assert delta(580, strike, years, 0.24, side) == pytest.approx(finite_difference, abs=1e-7)


def test_vector_solver_and_tiny_price():
    strikes = np.arange(550.0, 631.0)
    p = price(580, strikes, 7 / 365, 0.2)
    recovered = implied_vol_array(p, 580, strikes, 7 / 365)
    np.testing.assert_allclose(recovered, 0.2, atol=2e-8)
    assert 0 < price(580, 630, 7 / 365, 0.2) < 0.01
    assert np.isnan(implied_vol(0, 580, 600, 0.01))
    assert np.isnan(implied_vol(900, 580, 600, 0.01))
    assert np.isnan(implied_vol(1, 580, 600, 0))
    assert np.isnan(implied_vol(80, 580, 500, 1e-10))


def test_interpolation_analytic_smile():
    # An analytic IV(delta) quadratic, distinct from the production generator.
    d = np.linspace(0.45, 0.05, 30)
    iv = 0.2 + 0.12 * (d - 0.5) ** 2
    k = np.linspace(580, 640, len(d))
    for target in (0.15, 0.25, 0.333):
        result = interpolate_side(k, iv, d, target, max_strike_gap=3)
        assert result.flag == "ok"
        assert result.value == pytest.approx(0.2 + 0.12 * (target - 0.5) ** 2, abs=3e-6)
        assert result.strike not in k
    assert interpolate_side(k, iv, d, 0.6).flag == "outside_delta_range"
    assert interpolate_side(k[::3], iv[::3], d[::3], 0.25).flag == "strike_gap"
    assert interpolate_side(k, iv, d[::-1], 0.25).flag == "nonmonotone_delta"


def test_no_lookahead_and_zero_variance():
    rng = np.random.default_rng(31)
    values = rng.normal(size=(31, 391, 8))
    mean, std, count = baseline(values, 20)
    values[20:] = 100000
    mean2, std2, count2 = baseline(values, 20)
    np.testing.assert_array_equal(mean, mean2)
    np.testing.assert_array_equal(std, std2)
    np.testing.assert_array_equal(count, count2)
    np.testing.assert_allclose(mean, values[:20].mean(axis=0))
    np.testing.assert_allclose(std, values[:20].std(axis=0, ddof=1))
    assert np.isnan(zscore(np.ones((31, 2)), 30)[0]).all()
    assert np.isnan(zscore(values, 7)[0]).all()
    assert np.isfinite(zscore(values, 8)[0]).all()


def test_half_days_and_dst():
    values = np.arange(31.0, dtype=float)[:, None] * np.ones((31, 391))
    values[[8, 23], 211:] = np.nan
    _, _, count = baseline(values, 30, 30)
    assert count[100] == 30
    assert count[300] == 28
    days = sessions()
    before = open_time(days[20])
    after = open_time(days[-1])
    assert before.hour != after.hour
    assert minute_since_open(before + timedelta(minutes=277)) == 277
    assert minute_since_open(after + timedelta(minutes=277)) == 277
    with pytest.raises(ValueError):
        minute_since_open(datetime(2026, 3, 10))


def test_resampling_is_causal():
    values = np.arange(11)
    times, samples = resample(values, 30)
    assert list(samples[:5]) == [0, 0, 1, 1, 2]
    assert times[-1] == 600
    assert list(resample(values, 300)[1]) == [0, 5, 10]
    with pytest.raises(ValueError):
        resample(values, 10)


def test_source_contract_quality_and_seed():
    source = SyntheticSource()
    day = sessions()[-1]
    ts = open_time(day) + timedelta(minutes=277)
    exp = expiry_time(day, 7)
    chain = source.get_chain("SPY", exp, ts)
    other = SyntheticSource().get_chain("SPY", exp, ts)
    np.testing.assert_array_equal(chain.bid, other.bid)
    val, flags, _, strikes = evaluate(chain)
    assert np.isfinite(val).all(), flags
    assert strikes[0] < strikes[1] < chain.spot < strikes[2] < strikes[3]
    assert val[4] == pytest.approx(val[2] - val[1])
    # Crossed and stale quotes cannot enter interpolation.
    bad = Chain(
        "SPY", exp, ts, chain.spot, chain.strikes, chain.ask + 1, chain.bid, chain.age_seconds
    )
    assert np.isnan(quote_ivs(bad)).all()
    stale = Chain(
        "SPY",
        exp,
        ts,
        chain.spot,
        chain.strikes,
        chain.bid,
        chain.ask,
        np.full(chain.bid.shape, 200),
    )
    assert np.isnan(quote_ivs(stale)).all()
    close = expiry_time(day, 0)
    assert evaluate(source.get_chain("SPY", close, close))[1][:4] == ["expired"] * 4


def test_ssvi_clean_slice_butterfly():
    k = np.linspace(450, 730, 1001)
    t = 30 / 365
    theta = 0.23**2 * t
    iv = np.sqrt(ssvi(np.log(k / (580 * np.exp(0.028 * t))), theta, -0.75, 0.8) / t)
    p = price(580, k, t, iv)
    assert np.diff(p).max() < 0
    assert np.diff(p, 2).min() > -1e-10


def test_storage_null_and_flags(tmp_path):
    db = connect(tmp_path / "test.sqlite")
    row = (
        "2026-03-01",
        "2026-03-01T14:30:00+00:00",
        "2026-03-01T21:00:00+00:00",
        0,
        0,
        "P25",
        None,
        "strike_gap",
        1,
    )
    write_rows(db, [row])
    write_rows(db, [row])
    assert db.execute("SELECT value,flags,synthetic FROM observations").fetchall() == [
        (None, "strike_gap", 1)
    ]
    db.close()


def test_ibkr_mock_contract():
    from ib_async import Option, Stock

    now = datetime(2026, 3, 19, 18, 7, tzinfo=UTC)
    exp = expiry_time(now.date(), 7)
    ib = MagicMock()
    stock = Stock("SPY", "SMART", "USD", conId=123)
    ib.qualifyContracts.side_effect = (
        lambda *cs: [stock] if len(cs) == 1 and cs[0].secType == "STK" else list(cs)
    )
    underlying = MagicMock()
    underlying.marketPrice.return_value = 580
    chain = MagicMock(
        exchange="SMART",
        tradingClass="SPY",
        multiplier="100",
        expirations={exp.strftime("%Y%m%d")},
        strikes=[579.0, 580.0, 581.0],
    )
    ib.reqSecDefOptParams.return_value = [chain]

    def tickers(*contracts):
        if contracts[0].secType == "STK":
            return [underlying]
        return [
            MagicMock(contract=c, bid=1.0, ask=1.02, time=now, marketDataType=1) for c in contracts
        ]

    ib.reqTickers.side_effect = tickers
    source = IBKRSource(ib, clock=lambda: now)
    source.connect()
    ib.connect.assert_called_once_with("127.0.0.1", 7497, clientId=17, readonly=True)
    result = source.get_chain("SPY", exp, now)
    assert isinstance(result, Chain) and not result.synthetic
    assert result.bid.shape == (2, 3)
    assert np.all(result.age_seconds == 0)
    assert all(isinstance(c, Option) for c in ib.reqTickers.call_args.args)
    with pytest.raises(ValueError, match="historical"):
        source.get_chain("SPY", exp, now - timedelta(days=1))
    with pytest.raises(ValueError, match="Paper"):
        IBKRSource(ib, port=7496)


def test_export_precision_and_seed(tmp_path):
    import json
    import zlib

    from smile_watch.export import export_data

    values = np.array([[[[0.231234, -0.023456, np.nan]]]])
    manifest = export_data(tmp_path, values, values, values, values, np.array([0, 6, 2]), seed=17)
    raw = zlib.decompress((tmp_path / "replay.bin").read_bytes())
    packed = np.frombuffer(raw[: manifest["fields"]["values"]["bytes"]], dtype="<i2")
    assert packed[2] == -32768
    np.testing.assert_allclose(packed[:2] / 50000, values.flatten()[:2], atol=1e-5)
    assert json.loads((tmp_path / "manifest.json").read_text())["seed"] == 17


def test_full_chain_interpolation_flat_smile():
    # End-to-end recovered deltas/IV at targets between integer strikes.
    from smile_watch.interpolate import smile

    exp = datetime(2026, 4, 1, 20, tzinfo=UTC)
    ts = exp - timedelta(days=7)
    strikes = np.arange(520.0, 641.0)
    mids = price(580, strikes, 7 / 365, 0.23, np.array([["P"], ["C"]]))
    chain = Chain("SPY", exp, ts, 580, strikes, mids * 0.99, mids * 1.01, np.zeros_like(mids))
    result = smile(chain)
    for point in result:
        assert point.flag == "ok"
        assert point.value == pytest.approx(0.23, abs=1e-8)


def test_exported_default_event_if_built():
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "build/engine.npz"
    if not path.exists():
        pytest.skip("Run smile-watch build for full-dataset event regression")
    values = np.load(path)["values"]
    z, _, _, _ = zscore(values, 30)
    assert np.nanmax(z[2, 270:330, 1]) > 3
    assert np.isnan(values[8, :, 211:]).all()
    assert np.isnan(values[30, 0, 390]).all()


def test_tiny_otm_iv_and_price_parity():
    p = float(price(580, 700, 7 / 365, 0.2))
    assert 1e-12 < p < 1e-10
    assert implied_vol(p, 580, 700, 7 / 365) == pytest.approx(0.2, abs=1e-8)
    for strike in (450, 580, 710):
        call = price(580, strike, 0.1, 0.2, "C")
        put = price(580, strike, 0.1, 0.2, "P")
        assert call - put == pytest.approx(
            580 * np.exp(-0.012 * 0.1) - strike * np.exp(-0.04 * 0.1)
        )


def test_ibkr_delayed_quotes_and_missing_expiry():
    now = datetime(2026, 3, 19, 18, 7, tzinfo=UTC)
    exp = expiry_time(now.date(), 7)
    ib = MagicMock()
    ib.qualifyContracts.side_effect = lambda *contracts: contracts
    stock = MagicMock()
    stock.marketPrice.return_value = 580
    ib.reqSecDefOptParams.return_value = [
        MagicMock(
            exchange="SMART",
            tradingClass="SPY",
            multiplier="100",
            expirations={exp.strftime("%Y%m%d")},
            strikes=[580, 581],
        )
    ]

    def snapshots(*contracts):
        if contracts[0].secType == "STK":
            return [stock]
        return [
            MagicMock(contract=c, bid=1, ask=1.01, time=now, marketDataType=3) for c in contracts
        ]

    ib.reqTickers.side_effect = snapshots
    source = IBKRSource(ib, clock=lambda: now)
    assert (source.get_chain("SPY", exp, now).age_seconds > 90).all()
    with pytest.raises(ValueError, match="expiry"):
        source.get_chain("SPY", exp + timedelta(days=1), now)
