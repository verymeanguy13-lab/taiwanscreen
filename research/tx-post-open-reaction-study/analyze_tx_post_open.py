r"""
TX post-open reaction study.

Answers: after TX's 08:45 regular-session open, does TX move in the
direction predicted by the existing overnight Bull/Bear signal?

Inputs required:
  1. A DuckDB table `txfr1_full` with 1-minute TXFR1 OHLC bars
     (see research/tx-1min-validation/validate_tx_1min.py for how this
     table is built from the free GitHub dataset + TAIFEX backfill).
  2. signal_days.json ??the JSON returned by
     GET /api/admin/tx-post-open-signal-days?start_date=...&end_date=...
     (bullDates / bearDates arrays).

Does NOT calculate P&L, position sizing, or any trading strategy. Data
validation / diagnostic only.
"""

import json
import duckdb
import numpy as np
from scipy import stats as sps

HORIZONS = ['09:02', '09:03', '09:05', '09:10', '09:15', '09:30']
START, END = '2023-05-23', '2026-09-16'


def load_signal_days(path: str):
    sig = json.load(open(path))
    return set(sig['bullDates']), set(sig['bearDates'])


def load_returns(db_path: str):
    con = duckdb.connect(db_path)
    case_cols = ",\n  ".join(
        f"MAX(CASE WHEN CAST(datetime AS TIME)='{h}:00' THEN close END) as c{h.replace(':', '')}"
        for h in HORIZONS
    )
    df = con.execute(f"""
        SELECT trading_date,
          MAX(CASE WHEN CAST(datetime AS TIME)='08:45:00' THEN open END) as open0845,
          {case_cols}
        FROM txfr1_full
        WHERE trading_date BETWEEN '{START}' AND '{END}'
        GROUP BY trading_date
        ORDER BY trading_date
    """).fetchdf()
    con.close()
    df['trading_date'] = df['trading_date'].astype(str)
    for h in HORIZONS:
        col = f"c{h.replace(':', '')}"
        df[f'ret_{h}'] = (df[col] / df['open0845'] - 1) * 100
    return df.set_index('trading_date')


def summarize(x: np.ndarray) -> dict:
    return dict(N=len(x), mean=np.mean(x), median=np.median(x),
                std=np.std(x, ddof=1), p25=np.percentile(x, 25),
                p75=np.percentile(x, 75), max=np.max(x), min=np.min(x))


def run_study(rows, bull_dates, bear_dates):
    bull_df = rows.loc[rows.index.isin(bull_dates)]
    bear_df = rows.loc[rows.index.isin(bear_dates)]
    excluded_bull = sorted(bull_dates - set(rows.index))
    excluded_bear = sorted(bear_dates - set(rows.index))

    results = {}
    for h in HORIZONS:
        col = f'ret_{h}'
        a = rows[col].dropna().values
        b = bull_df[col].dropna().values
        r = bear_df[col].dropna().values

        all_s, bull_s, bear_s = summarize(a), summarize(b), summarize(r)
        t_bull, p_bull = sps.ttest_ind(b, a, equal_var=False)
        t_bear, p_bear = sps.ttest_ind(r, a, equal_var=False)

        results[h] = dict(
            all=all_s, bull=bull_s, bear=bear_s,
            bull_hit=np.mean(b > 0) * 100, bear_hit=np.mean(r < 0) * 100,
            bull_excess=bull_s['mean'] - all_s['mean'],
            bear_excess=bear_s['mean'] - all_s['mean'],
            p_bull=p_bull, p_bear=p_bear,
        )

    return dict(results=results, n_all=len(rows), n_bull=len(bull_df),
                n_bear=len(bear_df), n_none=len(rows) - len(bull_df) - len(bear_df),
                excluded_bull=excluded_bull, excluded_bear=excluded_bear)


if __name__ == "__main__":
    bull_dates, bear_dates = load_signal_days("signal_days.json")
    rows = load_returns("tx.duckdb")
    out = run_study(rows, bull_dates, bear_dates)
    print(json.dumps(out, indent=2, default=lambda o: round(float(o), 4)))
