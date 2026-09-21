# Does the Signal's Effect Continue After the Cash Market Opens, or Reverse?

Answers: after the predicted Taiwan cash-market opening gap occurs, does
the market continue in the same direction, reverse, or go flat? Uses
TAIEX (the actual cash index), not TX futures or 0050, via FinMind's
free `TaiwanVariousIndicators5Seconds` dataset (confirmed free and
working ??the other candidate, `TaiwanStockEvery5SecondsIndex`, is
Sponsor-tier only).

**This section's instrument (TAIEX) is an index, not something directly
tradable.** Real execution would go through 0050, TAIEX futures, or a
basket ??each with its own cost/liquidity/tracking-error profile not
tested here. Per the brief's own instruction, and because no reliable
bid/ask/slippage data exists for the index itself: **these results
exclude spread/slippage and are not an executable backtest.**

## 0. Task 1 ??reconciling 403 vs 408

- **408** (TX Strategy A) = 247 BULL + 161 BEAR from the TX-side signal
  classification ??no dependency on 0050 data.
- **403** (0050 gap hit-rate test) = 244 BULL + 159 BEAR ??requires a
  valid 0050 `daily_prices` row for both the date *and* its prior
  trading day.
- Exact gap: 4 BULL + 7 BEAR dates present in the TX-side signal but
  missing usable 0050 data. 6 of those are the already-documented
  TX-data-missing dates. The remaining 5 all cluster right around
  0050's ~4:1 stock split (2025-06-18) ??looks like a real gap in the
  daily_prices ingestion pipeline during that transition, not
  coincidence.

## 1. Critical data-integrity finding (Section 21) ??read this before anything else

**The dataset's nominal `09:00:00` TAIEX print is not a real opening
price.** Checked across all 808 usable days: `09:00:00` is **exactly**
equal to the prior trading day's `13:30:00` close on every single day,
zero exceptions (mean absolute difference: 0.0). This is TAIEX's index
calculation publishing a stale reference/pre-auction value before
constituent stocks' opening call auctions clear ??not a bug in the data
pull, and not something to silently patch over.

**`09:00:05` (5 seconds later) shows real variation** ??mean absolute
move from prior close: 108.9 points, up to 1,677 points on the largest
day. This is used as the effective opening price (`trueOpen`) for every
calculation below. All "opening gap" and "post-open return" figures are
computed relative to this corrected reference, not the stale nominal
09:00:00 tick.

Other Section 21 checks: zero duplicate dates, chronological order
confirmed, all 809 days show 3,241 ticks (full 5-second coverage,
09:00:00-13:30:00), no missing horizon observations, timestamps
consistent with Taipei local time.

## 2. Reproducing the ~90% hit rate on TAIEX directly

| Group | N | Correct | Hit rate | 95% CI |
|---|---:|---:|---:|---|
| BULL | 247 | 228 | 92.31% | [88.25%, 95.31%] |
| BEAR | 161 | 140 | 86.96% | [80.76%, 91.74%] |
| Combined | 408 | 368 | 90.20% | [86.89%, 92.90%] |

**Confirms and closely matches** the earlier 0050-based result (89.6%).
The phenomenon survives switching instruments. One difference worth
noting: NONE-day positive-gap rate is 61.5% on TAIEX vs. 49.5% on 0050 ??
likely reflects TAIEX's broader up-drift over this mostly-bullish
2023-2026 window; not otherwise investigated.

## 3. Primary question ??continuation vs. reversal vs. absorption

### Continuation ratio (signed post-open return / |opening gap|)

| Horizon | BULL mean | BULL median | BEAR mean | BEAR median | Combined mean | Combined median |
|---|---:|---:|---:|---:|---:|---:|
| 5m | 2.04 | 0.81 | 1.59 | 0.67 | 1.87 | 0.79 |
| 10m | 2.00 | 0.75 | 1.54 | 0.71 | 1.82 | 0.75 |
| 15m | 2.05 | 0.68 | 1.86 | 0.48 | 1.97 | 0.64 |
| 30m | 1.72 | 0.74 | 1.22 | 0.57 | 1.52 | 0.67 |
| 60m | 1.77 | 0.75 | 1.23 | 0.72 | 1.56 | 0.74 |

Medians consistently positive and well above zero at every horizon for
both BULL and BEAR ??**this is continuation, not reversal.** (Means are
inflated by right-skew/outliers relative to medians, hence reporting
both.)

### Regression vs. NONE (signed post-open return, HC3 robust SEs), full horizon curve

| Horizon | BULL?ONE | p | BEAR?ONE | p |
|---|---:|---:|---:|---:|
| open??m | +0.4215% | <0.0001 | -0.5737% | <0.0001 |
| open??m | +0.4064% | <0.0001 | -0.5678% | <0.0001 |
| open??m | +0.4000% | <0.0001 | -0.5754% | <0.0001 |
| open??m | +0.4014% | <0.0001 | -0.5698% | <0.0001 |
| open??0m | +0.3939% | <0.0001 | -0.5345% | <0.0001 |
| open??5m | +0.3945% | <0.0001 | -0.4908% | <0.0001 |
| open??0m | +0.3826% | <0.0001 | -0.4869% | <0.0001 |
| open??0m | +0.3965% | <0.0001 | -0.4665% | <0.0001 |
| open??h | +0.4081% | <0.0001 | -0.5182% | <0.0001 |
| open??h | +0.4095% | <0.0001 | -0.5016% | <0.0001 |
| open?lose(13:30) | +0.4102% | <0.0001 | -0.5072% | <0.0001 |

**This is the headline finding.** Unlike TX's post-08:45 reaction
(which decayed to nothing within minutes), TAIEX shows a **highly
significant, remarkably stable effect from 1 minute all the way to
end-of-day close** ??magnitude barely moves (BULL: 0.40-0.42% across
the whole range; BEAR: -0.47% to -0.58%). The effect appears almost
entirely within the first minute and then **holds flat** for the rest
of the session ??it neither grows (no further drift) nor reverses (no
mean reversion). This reads as: most of what's captured here is the
opening auction finishing clearing (the true settle takes a little
longer than the nominal 09:00:00 print, but well under a minute), after
which the market is efficient for the rest of the day.

## 4. Continuation vs. fade (hypothetical, no costs, not executable)

| Horizon | Continuation mean | Median | Win rate | Cumulative | Max DD |
|---|---:|---:|---:|---:|---:|
| 5m | +0.492% | +0.339% | 84.1% | +635% | -0.9% |
| 10m | +0.472% | +0.319% | 80.1% | +576% | -1.3% |
| 15m | +0.452% | +0.308% | 79.7% | +524% | -1.2% |
| 30m | +0.440% | +0.281% | 74.3% | +492% | -1.8% |
| 60m | +0.440% | +0.298% | 71.6% | +492% | -2.8% |

Fade (opposite position) loses money and has low win rates at every
horizon, as expected given the above ??continuation dominates
throughout.

## 5. Robustness

**Outlier check (30m horizon):** top-5-day share of total continuation
gain = **11.3%** ??nothing like the 77-162% concentration that
invalidated the earlier TX Strategy A backtest. Excluding the single
largest-gap day barely moves the mean (0.440% ??0.430%). Trimmed mean
(10%) is 0.353%, still solidly positive. **This is a broad-based effect,
not a few extreme days.**

**Gap magnitude predicts continuation (Section 13):** positive, highly
significant slope at every horizon (帣 = 0.36-0.44, p < 0.002 throughout)
??larger opening gaps predict *more* continuation, not more reversion.
Confirmed in the pre-specified gap-size buckets too: mean/median 5m
continuation rises monotonically from the smallest bucket (<0.25%: mean
0.36%) to the largest (>1.50%: mean 1.17%).

**Chronological holdout (2026-01-01 to 2026-09-16, pre-specified):**

| Period | Gap hit rate | 5m mean/median | 30m mean/median | 60m mean/median |
|---|---:|---|---|---|
| Development (2023-05-23 to 2025-12-31) | 90.51% | +0.338%/+0.273% | +0.296%/+0.224% | +0.300%/+0.242% |
| Holdout (2026-01-01 to 2026-09-16) | 89.13% | +1.024%/+1.022% | +0.934%/+0.925% | +0.920%/+0.987% |

**This survives out-of-sample ??and the holdout is actually stronger
than development**, not weaker. This is the opposite pattern from the
TX Strategy A backtest, which fell apart out-of-sample. Both the hit
rate and the continuation effect hold up.

## 6. Sections not completed (data limitations, not skipped silently)

- **Section 15 (VWAP/average-price test):** requires either volume
  (not available in this dataset) or the full 5-second tick series per
  day. The data-collection endpoint only extracted specific horizon
  snapshots, not full intraday ticks, to keep the payload size
  manageable across ~809 single-day API calls. Would need a redesigned
  pull to compute.
- **Section 16 (continuous 5-variable score):** requires the numeric
  daily return magnitude for each of Dow/S&P/Nasdaq/SOX/TX-night, not
  just their binary up/down classification. Not currently stored
  anywhere in this project ??would need a new data pull.

## Answers to the final-report questions

**A. Does the signal predict only the opening gap, or does its effect
continue after 09:00?** It continues. The post-open regression is
significant at every single horizon tested, 1 minute through end-of-day,
with essentially no decay in magnitude.

**B. Does the gap subsequently mean-revert?** No evidence of reversion
anywhere. Continuation ratios are positive at every horizon for both
BULL and BEAR; the fade strategy loses money throughout.

**C. Is the effect different for BULL and BEAR?** Similar in shape, BEAR
is consistently somewhat larger in magnitude (e.g., 60m: BULL +0.40%
vs. BEAR -0.47%) ??a mild, persistent asymmetry, not dramatic.

**D. Does a larger gap imply more continuation or more reversion?** More
continuation ??positive, significant relationship at every horizon, and
monotonic across the pre-specified gap-size buckets.

**E. Does the continuous score contain more information than binary?**
Not tested (Section 16 ??needs data not currently on hand).

**F. Does this survive the 2026 holdout?** Yes, and more strongly than
in development, both for the gap hit rate and the continuation effect.

**G. Does this survive outlier analysis?** Yes ??only 11.3% of gain from
the top 5 days, versus 77%+ for the TX strategy that failed this same
check.

**H. Bottom line:** the evidence points toward **"strong overnight
forecasting power, with the bulk of the signal's information reflected
within the first minute of the cash session, followed by a real but
modest continuation that holds essentially flat (no further drift, no
reversal) for the rest of the day"** ??not "only the gap matters" and
not "the market keeps trending all session." This is a genuinely
different and more encouraging picture than what TX futures showed, but
it describes the **cash index**, not a tradable instrument, and every
number here excludes transaction costs, spread, and slippage by
necessity ??turning this into an actual strategy would need real 0050
or TAIEX-futures execution data, which is a separate, unstarted piece of
work.
