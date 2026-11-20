# S&P 500 total return, log scale, with an OLS trend

Growth of $1 in the S&P 500 with dividends reinvested, from the end of 1925 to the latest close, on a log scale. The dashed line is an OLS regression of log(value) on time in years; the trend CAGR is exp(slope) − 1. Pan and zoom with the mouse or by pinching.

Live page: https://mindymallory.com/SP-Total-Return-LR/

## Data

- **1926–2025:** calendar-year total returns from the Ibbotson/SBBI large-company series, in `data/sbbi_annual_total_returns.csv`.
- **2026 on:** the S&P 500 Total Return index (`^SP500TR`) from Yahoo Finance. Each completed year is the ratio of year-end closes; the current year is the latest close over last year's close, placed at its actual date (a fractional year) so a partial year doesn't bias the slope.

The fetcher logs a splice check comparing `^SP500TR` annual returns with the SBBI series for every year both cover.

## How it updates

`.github/workflows/update.yml` runs `fetch/fetch_data.py` each weekday at 22:30 UTC, on every push to `main`, and on demand, writes `site/data/series.json`, and deploys `site/` to GitHub Pages. If the fetch fails, the deploy is skipped and the previous page stays up. Data is not committed.

## Run locally

```
pip install -r fetch/requirements.txt
python fetch/fetch_data.py
cd site && python -m http.server 8000
```

## Setup

Pages must use GitHub Actions as its source (Settings → Pages → Source). The site is served under the user site's custom domain at `/SP-Total-Return-LR/`.
