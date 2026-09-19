r"""
Opening-gap monetization research: reproduces the ~90% directional hit
rate, gap magnitude/distribution statistics, TX 05:00->08:45 conditional
return, and a transaction-cost-aware backtest with outlier and
out-of-sample checks.

Requires:
  - cash_gap_raw.json: output of GET /api/admin/cash-gap-data
  - signal_days.json: bullDates/bearDates from
    /api/admin/tx-post-open-signal-days
  - period_rows.pkl: TX period-return dataframe built by
    test1_test2_night_session.py (needs ret_preopen, night_close, signal)

Known data caveat: 0050 had a ~4:1 stock split around 2025-06-18 in the
raw daily_prices data; that date is excluded from all gap statistics
below (not a real market gap).

TX does not trade 05:00-08:45 (confirmed: zero 1-minute bars across all
809 days) -- this script only computes what's actually measurable given
that structural fact (TX's last night price and its 08:45 open are the
only two real reference points in that window).
"""

import json
import pickle
import numpy as np
import pandas as pd
from scipy import stats as sps

SPLIT_DATE = '2025-06-18'


def load_gap_data(path: str, signal_path: str) -> pd.DataFrame:
    gap_raw = json.load(open(path))['data']
    sig = json.load(open(signal_path))
    bull_all, bear_all = set(sig['bullDates']), set(sig['bearDates'])

    df = pd.DataFrame(gap_raw)
    df = df[df['date'] != SPLIT_DATE].copy()
    df['signal'] = df['date'].apply(
        lambda d: 'BULL' if d in bull_all else ('BEAR' if d in bear_all else 'NONE')
    )
    return df


def test2_hit_rate(df: pd.DataFrame):
    def hit(row):
        if row['signal'] == 'BULL':
            return row['gapPct'] > 0
        if row['signal'] == 'BEAR':
            return row['gapPct'] < 0
        return None
    df = df.copy()
    df['correct'] = df.apply(hit, axis=1)
    for grp in ['BULL', 'BEAR']:
        sub = df[df['signal'] == grp]
        n, k = len(sub), int(sub['correct'].sum())
        ci = sps.binomtest(k, n).proportion_ci(confidence_level=0.95)
        print(f"{grp}: N={n} correct={k} rate={k/n*100:.2f}% 95%CI=[{ci.low*100:.2f}%,{ci.high*100:.2f}%]")
    comb = df[df['signal'].isin(['BULL', 'BEAR'])]
    n, k = len(comb), int(comb['correct'].sum())
    ci = sps.binomtest(k, n).proportion_ci(confidence_level=0.95)
    print(f"COMBINED: N={n} correct={k} rate={k/n*100:.2f}% 95%CI=[{ci.low*100:.2f}%,{ci.high*100:.2f}%]")


def strategy_a_backtest(period_rows_path: str, cost_multiplier: float = 1.0) -> pd.DataFrame:
    rows = pickle.load(open(period_rows_path, 'rb'))
    d = rows[['ret_preopen', 'signal', 'night_close']].dropna().copy()
    d = d[d['signal'].isin(['BULL', 'BEAR'])].copy()
    d['trade_ret'] = np.where(d['signal'] == 'BULL', d['ret_preopen'], -d['ret_preopen'])
    d['notional'] = d['night_close'] * 200  # NT$200/point, large TX
    # realistic round-trip: 2 sides x (NT$50 commission + 0.00002 tax x notional)
    d['cost_pct'] = (2 * 50 + 2 * (0.00002 * d['notional'])) / d['notional'] * 100 * cost_multiplier
    d['net_ret'] = d['trade_ret'] - d['cost_pct']
    return d


def outlier_and_oos_check(d: pd.DataFrame, dev_end: str = '2025-12-31'):
    net = d['net_ret']
    top5_share = net.sort_values(ascending=False).head(5).sum() / net.sum() * 100
    print(f"Top-5-day share of total gain: {top5_share:.1f}%")

    d = d.reset_index()
    dev = d[d['trading_date'] <= dev_end]
    hold = d[d['trading_date'] > dev_end]
    for label, sub in [('Development', dev), ('Holdout', hold)]:
        n = len(sub)
        total = sub['net_ret'].sum()
        top5 = sub['net_ret'].sort_values(ascending=False).head(5).sum()
        print(f"{label}: N={n} mean={sub['net_ret'].mean():.4f}% median={sub['net_ret'].median():.4f}% "
              f"cumulative={((1+sub['net_ret']/100).prod()-1)*100:.2f}% "
              f"top5_share={top5/total*100 if total else float('nan'):.1f}%")


if __name__ == "__main__":
    df = load_gap_data("cash_gap_raw.json", "signal_days.json")
    print("=== TEST 2: hit rate ===")
    test2_hit_rate(df)

    print("\n=== TEST 9/13 Strategy A backtest (realistic cost) ===")
    d = strategy_a_backtest("period_rows.pkl", cost_multiplier=1.0)
    print(f"N={len(d)} mean={d['net_ret'].mean():.4f}% median={d['net_ret'].median():.4f}% "
          f"cumulative={((1+d['net_ret']/100).prod()-1)*100:.2f}%")

    print("\n=== Outlier / out-of-sample check ===")
    outlier_and_oos_check(d)
