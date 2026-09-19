# TX Post-Open Reaction Study

**Research question:** After the TX regular session opens at 08:45 Taipei
time, does TX itself move in the direction predicted by the completed
5-condition overnight Bull/Bear signal?

This is a diagnostic result only. No trading profits, leverage, position
sizing, stops, targets, or threshold optimization were calculated. No
claim of profitability is made.

## 1. Data source

- TX price data: merged 1-minute `TXFR1` dataset ??the validated free
  GitHub snapshot (2023-05-23 to 2026-09-04) plus the manually backfilled
  2026-09-07 through 2026-09-16 built directly from official TAIFEX
  per-trade data (see prior validation report). 809 trading days total.
- Signal classification: a new read-only endpoint
  (`app/api/admin/tx-post-open-signal-days`) that reuses the existing
  `sox-signal-check` signal logic verbatim (Yahoo Finance for Dow/S&P
  500/Nasdaq/SOX, FinMind `TaiwanFuturesDaily` for TX night session),
  returning full BULL/BEAR/NONE date lists instead of a 20-day sample.

## 2. Data construction

- 08:45 price = `open` of the 08:45 TXFR1 bar.
- Each later timestamp (09:02, 09:03, 09:05, 09:10, 09:15, 09:30) = `close`
  of that minute's TXFR1 bar.
- Return = `(later_close / open_0845 - 1) ? 100`.

## 3. Data validation

Already completed and reported separately (zero duplicates, zero OHLC
violations, 100% timestamp coverage, perfect minute continuity, rollover
isolated outside the window). Nothing new needed here beyond the date
reconciliation in Section 4.

## 4. Sample

- Signal endpoint's trading calendar: 816 dates (2023-05-23 to 2026-09-16)
- TX 1-minute dataset's trading calendar: 809 dates over the same range
- **6 signal-classified dates have no matching TX 08:45 bar and were
  excluded** ??a real gap in the underlying free TXFR1 source, not
  something fabricated or approximated:
  - BULL, excluded: `2026-07-10`
  - BEAR, excluded: `2023-08-03`, `2024-07-24`, `2024-07-25`,
    `2024-10-02`, `2024-10-31`

| | Count |
|---|---:|
| Total TX trading days in study | 809 |
| BULL days (matched) | 247 |
| BEAR days (matched) | 161 |
| NONE days | 401 |
| Excluded ??signal classified but no TX data | 6 (1 bull, 5 bear) |
| Excluded ??missing TX data for other reasons | 0 |
| Excluded ??signal-data problems | 0 |

247 + 161 + 401 = 809, reconciles exactly.

## 5. Main results

| Horizon | Bull N | Bull mean % | Bull hit | Bear N | Bear mean % | Bear hit | All N | All mean % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 08:45??9:02 | 247 | 0.0009 | 51.82% | 161 | 0.0624 | 44.10% | 809 | 0.0266 |
| 08:45??9:03 | 247 | 0.0062 | 54.25% | 161 | 0.0604 | 43.48% | 809 | 0.0291 |
| 08:45??9:05 | 247 | 0.0097 | 52.23% | 161 | 0.0415 | 42.24% | 809 | 0.0226 |
| 08:45??9:10 | 247 | 0.0064 | 48.58% | 161 | 0.0756 | 42.86% | 809 | 0.0320 |
| 08:45??9:15 | 247 | 0.0144 | 45.75% | 161 | 0.0896 | 40.99% | 809 | 0.0319 |
| 08:45??9:30 | 247 | -0.0005 | 44.94% | 161 | 0.0875 | 41.61% | 809 | 0.0261 |

Bull hit rate = % of BULL days where TX moved *up* by that horizon.
Bear hit rate = % of BEAR days where TX moved *down* by that horizon.

**Bull excess (bull mean ??all-day mean)** and **bear excess (bear mean ??
all-day mean):**

| Horizon | Bull excess | Bear excess |
|---|---:|---:|
| 08:45??9:02 | -0.0257 | +0.0358 |
| 08:45??9:03 | -0.0229 | +0.0313 |
| 08:45??9:05 | -0.0129 | +0.0188 |
| 08:45??9:10 | -0.0256 | +0.0437 |
| 08:45??9:15 | -0.0176 | +0.0577 |
| 08:45??9:30 | -0.0266 | +0.0614 |

Note the sign: bull excess is **negative at every horizon**, and bear
excess is **positive at every horizon** ??both opposite the direction the
signal predicts. Bull hit rates hover near/slightly above 50% and *decay*
toward 45% by 09:30. Bear hit rates sit *below* 50% at every horizon
(40??4%), meaning TX was less likely than a coin flip to move down on
BEAR-signal days in this sample.

## 6. Statistical tests (Welch's t-test, bull/bear vs. all-day baseline)

| Horizon | Bull excess | p (bull) | Bear excess | p (bear) |
|---|---:|---:|---:|---:|
| 08:45??9:02 | -0.0257 | 0.220 | +0.0358 | 0.292 |
| 08:45??9:03 | -0.0229 | 0.287 | +0.0313 | 0.382 |
| 08:45??9:05 | -0.0129 | 0.596 | +0.0188 | 0.617 |
| 08:45??9:10 | -0.0256 | 0.351 | +0.0437 | 0.281 |
| 08:45??9:15 | -0.0176 | 0.554 | +0.0577 | 0.190 |
| 08:45??9:30 | -0.0266 | 0.441 | +0.0875 (bear mean) / +0.0614 (excess) | 0.213 |

**None of the 12 tests (6 horizons ? bull/bear) reach conventional
significance** (all p > 0.19). This is well short of significance even
*before* correcting for multiple comparisons ??with 12 simultaneous
tests, a naive Bonferroni threshold would require p < 0.0042 for any
single test to be called significant at family-wise 帢=0.05. No horizon
gets remotely close, so the multiple-testing problem doesn't even become
the binding constraint here; the effect sizes themselves are small and
the signs run opposite to the hypothesis on both sides.

## 7. Outlier check (09:02, 09:03, 09:05)

| Horizon | | Mean (all) | Mean (excl. best day) | Mean (excl. worst day) |
|---|---|---:|---:|---:|
| 09:02 | BULL | 0.0009 | -0.0050 (excl. 2026-07-31, +1.47%) | 0.0042 (excl. 2026-05-11, -0.80%) |
| 09:02 | BEAR | 0.0624 | 0.0521 (excl. 2025-04-09, +1.70%) | 0.0762 (excl. 2024-08-05, -2.15%) |
| 09:03 | BULL | 0.0062 | 0.0006 (excl. 2026-07-31, +1.40%) | 0.0099 (excl. 2026-05-22, -0.91%) |
| 09:03 | BEAR | 0.0604 | 0.0506 (excl. 2025-04-09, +1.62%) | 0.0743 (excl. 2024-08-05, -2.16%) |
| 09:05 | BULL | 0.0097 | 0.0015 (excl. 2026-07-31, +2.04%) | 0.0135 (excl. 2026-05-22, -0.92%) |
| 09:05 | BEAR | 0.0415 | 0.0332 (excl. 2026-06-08, +1.37%) | 0.0590 (excl. 2024-08-05, -2.77%) |

Excluding the single best or worst day moves each mean by roughly
0.01??.02 percentage points ??a small fraction of the already-small
excess. **The null result is not being driven by one or two unusual
sessions.**

## 8. Interpretation

Factual only:

- On BULL-signal days, TX's average move from 08:45 to each of
  09:02/09:03/09:05/09:10/09:15/09:30 was **not larger, and at most
  horizons was smaller,** than TX's average move on all days regardless
  of signal.
- On BEAR-signal days, TX's average move over the same horizons was
  **positive** (i.e., up), not down ??the opposite of the direction the
  BEAR signal predicts ??though also not statistically distinguishable
  from the all-day baseline.
- Directional hit rates for both BULL and BEAR sit close to, or in the
  BEAR case below, 50%, and none of the bull/bear-vs-baseline differences
  are statistically significant.
- This is **not** "TX Bull days had a positive average return from 08:45
  to 09:03 [that beat baseline]" ??the data doesn't support that. It's
  closer to "TX Bull/Bear days did not show a directional reaction from
  08:45 onward that differs meaningfully from an ordinary day."
- This is **not** "the signal doesn't work" as a general claim either ??
  this only tests the specific 08:45??9:30 window on TX itself; it says
  nothing about 0050's earlier-observed reaction, other instruments, or
  other windows.

## 9. Research conclusion

> Is there evidence that TX itself moves directionally after 08:45 in the
> direction of the existing overnight Bull/Bear signal?

- **08:45??9:02: NO.** Bull excess is negative (-0.026pp, p=0.22); bear
  excess is positive/wrong-signed (+0.036pp, p=0.29). Neither
  significant.
- **08:45??9:03: NO.** Bull excess -0.023pp (p=0.29); bear excess
  +0.031pp (p=0.38), wrong-signed. Neither significant.
- **08:45??9:05: NO.** Bull excess -0.013pp (p=0.60); bear excess
  +0.019pp (p=0.62), wrong-signed. Neither significant.

Across all six tested horizons (through 09:30), the pattern is the same:
small, statistically insignificant effects, wrong-signed for BEAR at
every horizon and wrong- or null-signed for BULL at every horizon,
robust to removing the single best/worst day.

**What this means for the original goal** (whether someone who knows the
signal at ~05:00 could express it through TX futures): on this evidence,
**no** ??at least not via a simple long/short position taken at 08:45 and
held to any of these early-morning horizons. If there's a genuine
tradeable edge here, it isn't visible in the raw TX post-open reaction
over 08:45??9:30; it would need to come from somewhere else (a different
entry/exit structure, a different signal formulation, interaction with
0050 rather than TX itself, or a longer/different horizon) ??none of
which this step tested.

**Additional research that would be needed before considering execution**
(not undertaken here, per scope): whether the earlier 0050 effect and
this TX result are measuring genuinely different things or the same null
result in different instruments; whether a different entry time (not
08:45) or holding period shows anything; and ??separately ??the
still-unresolved question from the original data-source work of whether
this free TXFR1 dataset's numbers are independently verifiable against
official TAIFEX minute data (the 2023-05-23??026-09-04 portion), now that
the most recent 8 days are TAIFEX-sourced directly.
