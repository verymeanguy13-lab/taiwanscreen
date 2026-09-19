r"""
4-condition diagnostic: rerun TEST 1/2's period regressions using only
the 4 macro indices (Dow/S&P/Nasdaq/SOX), dropping condition #5 (TX's
own night-session direction) from the classification entirely.

Purpose: check whether condition #5 is what causes the null post-open
TX result. NOT a replacement for the real 5-condition signal used
elsewhere -- diagnostic only.

Requires:
  - period_rows.pkl (or equivalent) with ret_night/ret_preopen/
    ret_0845_0900/ret_0900_0930/ret_0845_0930 columns, built the same
    way as test1_test2_night_session.py
  - signal_days_4cond.json -- bull4Dates/bear4Dates from
    /api/admin/tx-post-open-signal-days (same endpoint, now returns
    these alongside the real bullDates/bearDates)
"""

import json
import statsmodels.api as sm


def classify_4cond(rows, signal4_json_path: str):
    sig4 = json.load(open(signal4_json_path))
    bull4, bear4 = set(sig4['bull4Dates']), set(sig4['bear4Dates'])
    rows = rows.reset_index()
    rows['signal4'] = rows['trading_date'].apply(
        lambda d: 'BULL' if d in bull4 else ('BEAR' if d in bear4 else 'NONE')
    )
    return rows.set_index('trading_date')


def run_regression(df, ret_col: str, sig_col: str, label: str) -> dict:
    d = df[[ret_col, sig_col]].dropna().copy()
    d['BULL'] = (d[sig_col] == 'BULL').astype(int)
    d['BEAR'] = (d[sig_col] == 'BEAR').astype(int)
    X = sm.add_constant(d[['BULL', 'BEAR']])
    model = sm.OLS(d[ret_col], X).fit(cov_type='HC3')
    ci = model.conf_int()
    n_none = int((d[sig_col] == 'NONE').sum())
    n_bull = int((d[sig_col] == 'BULL').sum())
    n_bear = int((d[sig_col] == 'BEAR').sum())
    print(f"{label}: N(N/B/B)={n_none}/{n_bull}/{n_bear}  "
          f"BULL-NONE={model.params['BULL']:+.4f} (p={model.pvalues['BULL']:.4f})  "
          f"BEAR-NONE={model.params['BEAR']:+.4f} (p={model.pvalues['BEAR']:.4f})")
    return dict(n_none=n_none, n_bull=n_bull, n_bear=n_bear,
                beta_bull=model.params['BULL'], p_bull=model.pvalues['BULL'], ci_bull=ci.loc['BULL'].tolist(),
                beta_bear=model.params['BEAR'], p_bear=model.pvalues['BEAR'], ci_bear=ci.loc['BEAR'].tolist())


if __name__ == "__main__":
    import pickle
    rows = pickle.load(open("period_rows.pkl", "rb"))
    rows = classify_4cond(rows, "signal_days_4cond.json")

    periods = [
        ('ret_night', 'Night session'),
        ('ret_preopen', 'Pre-open gap'),
        ('ret_0845_0900', '08:45->09:00'),
        ('ret_0900_0930', '09:00->09:30'),
        ('ret_0845_0930', '08:45->09:30'),
    ]
    print("=== 4-CONDITION diagnostic (indices only) ===")
    for col, label in periods:
        run_regression(rows, col, 'signal4', label)
