"""Build site/data/series.json: growth of $1 in the S&P 500 total return since 1926.

History (calendar years 1926-2025) comes from data/sbbi_annual_total_returns.csv,
the Ibbotson/SBBI large-company total-return series. Every year after that, and the
current year-to-date return, comes from the S&P 500 Total Return index (^SP500TR,
dividends reinvested) on Yahoo Finance, so the chart extends itself without edits.

The OLS fit regresses log(wealth) on time in years; CAGR = exp(slope) - 1.
If the index can't be fetched the script exits with an error, so the workflow skips
the deploy and the last good version of the page stays live.
"""

import csv
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf
from scipy import stats

ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / "data" / "sbbi_annual_total_returns.csv"
OUT = ROOT / "site" / "data" / "series.json"
TICKER = "^SP500TR"


def load_history():
    with open(HISTORY) as f:
        return [(int(r["year"]), float(r["total_return_pct"]) / 100) for r in csv.DictReader(f)]


def fetch_index():
    df = yf.download(TICKER, start="1987-12-01", interval="1d", auto_adjust=False,
                     progress=False, threads=False)
    if df is None or df.empty:
        raise RuntimeError(f"no data returned for {TICKER}")
    close = df["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close = close.dropna()
    close.index = pd.to_datetime(close.index).tz_localize(None)
    return close


def year_fraction(d):
    start = date(d.year, 1, 1)
    days = (date(d.year + 1, 1, 1) - start).days
    return d.year + ((d - start).days + 1) / days


def ols(t, y):
    n = len(t)
    tb, yb = sum(t) / n, sum(y) / n
    stt = sum((a - tb) ** 2 for a in t)
    sty = sum((a - tb) * (b - yb) for a, b in zip(t, y))
    syy = sum((b - yb) ** 2 for b in y)
    beta = sty / stt
    alpha = yb - beta * tb
    sse = sum((b - alpha - beta * a) ** 2 for a, b in zip(t, y))
    s = math.sqrt(sse / (n - 2))
    return alpha, beta, 1 - sse / syy, s, n, tb, stt


BANDS = (0.50, 0.95)


def main():
    history = load_history()
    last_hist_year = history[-1][0]
    close = fetch_index()

    year_end = close.groupby(close.index.year).last()
    last_date = close.index[-1].date()

    # Check the splice: index annual returns vs the SBBI series where both exist.
    diffs = []
    for y, r in history:
        if y - 1 in year_end.index and y in year_end.index and y < last_date.year:
            diffs.append(abs(year_end[y] / year_end[y - 1] - 1 - r) * 100)
    if diffs:
        print(f"Splice check: {len(diffs)} overlapping years, max abs diff "
              f"{max(diffs):.2f} pp, mean {sum(diffs) / len(diffs):.3f} pp")

    # Points are at true calendar time: the end of year Y sits at t = Y + 1.
    points = [{"t": 1926.0, "label": "End of 1925", "value": 1.0, "ret": None}]
    v = 1.0
    for y, r in history:
        v *= 1 + r
        points.append({"t": y + 1.0, "label": f"End of {y}", "value": v, "ret": r})

    if last_hist_year not in year_end.index:
        raise RuntimeError(f"index has no close for the end of {last_hist_year}")

    prev = year_end[last_hist_year]
    for y in range(last_hist_year + 1, last_date.year + 1):
        if y < last_date.year:  # completed calendar year
            r = year_end[y] / prev - 1
            v *= 1 + r
            points.append({"t": y + 1.0, "label": f"End of {y}", "value": v, "ret": r})
            prev = year_end[y]
        else:  # current year to date
            r = close.iloc[-1] / prev - 1
            v *= 1 + r
            points.append({"t": year_fraction(last_date),
                           "label": last_date.strftime("%b %-d, %Y"),
                           "value": v, "ret": r, "partial": True})

    t = [p["t"] for p in points]
    logy = [math.log(p["value"]) for p in points]
    alpha, beta, r2, s, n, tb, stt = ols(t, logy)
    # OLS prediction intervals in log space: fit +/- t_q * s * sqrt(1 + 1/n + (t - tbar)^2 / Stt).
    q = {lvl: stats.t.ppf(0.5 + lvl / 2, n - 2) for lvl in BANDS}
    for p in points:
        f = alpha + beta * p["t"]
        se = s * math.sqrt(1 + 1 / n + (p["t"] - tb) ** 2 / stt)
        p["fit"] = math.exp(f)
        for lvl in BANDS:
            k = int(lvl * 100)
            p[f"lo{k}"] = math.exp(f - q[lvl] * se)
            p[f"hi{k}"] = math.exp(f + q[lvl] * se)
    se_beta = s / math.sqrt(stt)
    q95 = stats.t.ppf(0.975, n - 2)

    years = t[-1] - t[0]
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "as_of": last_date.isoformat(),
        "as_of_label": last_date.strftime("%B %-d, %Y"),
        "ols_cagr": math.exp(beta) - 1,
        "geometric_cagr": points[-1]["value"] ** (1 / years) - 1,
        "r2": r2,
        "resid_sd": s,
        "cagr_ci95_naive": [math.exp(beta - q95 * se_beta) - 1, math.exp(beta + q95 * se_beta) - 1],
        "alpha": alpha,
        "beta": beta,
        "ytd": points[-1]["ret"] if points[-1].get("partial") else None,
        "ytd_year": last_date.year,
        "final_value": points[-1]["value"],
        "splice_year": last_hist_year + 1,
        "points": points,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"As of {last_date}: $1 -> ${points[-1]['value']:,.0f}; "
          f"OLS CAGR {out['ols_cagr'] * 100:.2f}%, geometric {out['geometric_cagr'] * 100:.2f}%, "
          f"R2 {r2:.4f}, YTD {(out['ytd'] or 0) * 100:.2f}%")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"Fetch failed: {e}", file=sys.stderr)
        sys.exit(1)
