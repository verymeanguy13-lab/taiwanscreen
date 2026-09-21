r"""
TAIEX post-open continuation/reversal analysis.

Requires:
  - taiex_raw.json: output of the resumable fetch script hitting
    /api/admin/taiex-post-open-reaction (809 days, one row per day with
    prevClose, openPrice/09:00:00, and horizon snapshots through 13:30)
  - signal_days.json: bullDates/bearDates from
    /api/admin/tx-post-open-signal-days

CRITICAL DATA-INTEGRITY NOTE: this dataset's nominal 09:00:00 TAIEX
print is NOT a real opening price -- it is exactly equal to the prior
day's 13:30 close on every single day in the sample (a stale
reference/pre-auction value, not a bug in the fetch). 09:00:05 is used
as the effective opening price throughout this script instead.
"""

import json
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as sps

HORIZONS = ['09:01:00', '09:02:00', '09:03:00', '09:05:00', '09:10:00',
            '09:15:00', '09:30:00', '10:00:00', '11:00:00', '12:00:00', '13:30:00']


def load_and_fix(raw_path: str, signal_path: str) -> pd.DataFrame:
    d = json.load(open(raw_path, encoding='utf-8-sig'))
    df = pd.DataFrame(d).sort_values('date').reset_index(drop=True)

    # Verify + use the stale-09:00:00 workaround: prior day's 13:30 close
    # as the true reference, and 09:00:05 as the true opening price.
    df['prev_1330'] = df['13:30:00'].shift(1)
    stale_matches = (df['openPrice'] == df['prev_1330']).sum()
    print(f"Sanity check: 09:00:00 == prior 13:30 close on {stale_matches}/{len(df)-1} days (expect ~all)")

    df = df[df['prev_1330'].notna()].copy()  # drop first day, no prior close
    df['trueOpen'] = df['09:00:05']
    df['gapPct'] = (df['trueOpen'] / df['prev_1330'] - 1) * 100

    sig = json.load(open(signal_path))
    bull_all, bear_all = set(sig['bullDates']), set(sig['bearDates'])
    df['signal'] = df['date'].apply(lambda dt: 'BULL' if dt in bull_all else ('BEAR' if dt in bear_all else 'NONE'))

    for h in HORIZONS:
        df[f'ret_{h}'] = (df[h] / df['trueOpen'] - 1) * 100
        df[f'signed_{h}'] = np.where(df['signal'] == 'BULL', df[f'ret_{h}'],
                             np.where(df['signal'] == 'BEAR', -df[f'ret_{h}'], np.nan))

    df['abs_gap'] = df['gapPct'].abs()
    df['signed_gap'] = np.where(df['signal'] == 'BULL', df['gapPct'],
                        np.where(df['signal'] == 'BEAR', -df['gapPct'], np.nan))
    return df


def hit_rate_table(df: pd.DataFrame):
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


def horizon_regression_table(df: pd.DataFrame):
    for h in HORIZONS:
        d = df[[f'ret_{h}', 'signal']].dropna().copy()
        d['BULL'] = (d['signal'] == 'BULL').astype(int)
        d['BEAR'] = (d['signal'] == 'BEAR').astype(int)
        X = sm.add_constant(d[['BULL', 'BEAR']])
        model = sm.OLS(d[f'ret_{h}'], X).fit(cov_type='HC3')
        print(f"{h}: BULL-NONE={model.params['BULL']:+.4f}% (p={model.pvalues['BULL']:.4f})  "
              f"BEAR-NONE={model.params['BEAR']:+.4f}% (p={model.pvalues['BEAR']:.4f})  N={len(d)}")


if __name__ == "__main__":
    df = load_and_fix("taiex_raw.json", "signal_days.json")

    print("\n=== Hit rate ===")
    hit_rate_table(df)

    print("\n=== Horizon regression vs NONE ===")
    horizon_regression_table(df)

    print("\n=== Outlier check (30m) ===")
    d = df[df['signal'].isin(['BULL', 'BEAR'])]
    ret30 = d['signed_09:30:00']
    top5_share = ret30.sort_values(ascending=False).head(5).sum() / ret30.sum() * 100
    print(f"Top-5-day share of total gain: {top5_share:.1f}%")

    print("\n=== Chronological holdout ===")
    dev = d[d['date'] <= '2025-12-31']
    hold = d[d['date'] > '2025-12-31']
    for label, sub in [('Development', dev), ('Holdout', hold)]:
        s = sub['signed_09:30:00']
        print(f"{label}: N={len(s)} mean={s.mean():.4f}% median={s.median():.4f}% win={(s>0).mean()*100:.1f}%")
