# Opening-Gap Monetization Research

Answers the question: if the 5-condition signal predicts the Taiwan
cash-market opening gap direction with ~90% accuracy, when/where is that
information incorporated, and is there a tradable expression before the
cash market opens?

**Data note:** TX literally does not trade 05:00-08:45 (confirmed:
zero bars across all 809 days, every date, no exceptions) ??this is a
structural fact about the TAIFEX schedule, not a data gap. TX has
exactly two real reference prices in that stretch: its last night-session
trade (~04:59) and its 08:45 open. TEST 3/5/6/13(B-D), which called for
TX prices at 06:00/07:00/08:00/08:30, are not computable as specified ??
there is no price there to sample. This report answers what's actually
testable given that constraint.

**0050 daily-price data note:** 0050 underwent a ~4:1 stock split around
2025-06-18 (prior close 188.65 ??open 47.50 in the raw data ??not a real
market move). This one date is excluded from all gap statistics below.

## TEST 2 ??Reproducing the ~90% figure

| Group | N | Correct | Hit rate | 95% CI |
|---|---:|---:|---:|---|
| BULL | 244 | 222 | 90.98% | [86.67%, 94.26%] |
| BEAR | 159 | 139 | 87.42% | [81.24%, 92.14%] |
| Combined | 403 | 361 | 89.58% | [86.17%, 92.39%] |

**Confirmed** ??reproduces almost exactly. For comparison, the
unconditional probability of a positive gap on NONE days is 49.5% (vs.
53.8% across all days) ??essentially a coin flip, as expected. The signal
is adding real information, not just riding an underlying up-drift.

## TEST 1 / 7 / 8 ??Gap magnitude and distribution

| Group | N | Mean | Median | Std | p5 | p25 | p75 | p95 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BULL | 244 | +0.958% | +0.716% | 1.114% | -0.050% | +0.314% | +1.384% | +2.655% | -1.324% | +9.986% |
| BEAR | 159 | -0.970% | -0.634% | 1.273% | -3.129% | -1.347% | -0.192% | +0.098% | -10.00% | +0.610% |
| NONE | 400 | +0.055% | 0.000% | 0.922% | -1.223% | -0.242% | +0.428% | +1.414% | -4.545% | +5.386% |

**This is not a trivial effect.** Mean normalized gap (signed so + =
correct direction) is +0.96% for BULL and +0.97% for BEAR ??roughly
comparable to a full standard deviation of NONE-day gap noise (0.92%).
Medians (+0.72%, +0.63%) are still solidly positive, so this isn't just
a few huge days inflating the mean at the *gap* level (unlike the
backtest below, where concentration reappears).

**Tail probabilities** (normalized gap exceeding threshold, correct
direction):

| Threshold | BULL | BEAR |
|---|---:|---:|
| >0.10% | 86.5% | 83.6% |
| >0.25% | 76.6% | 69.8% |
| >0.50% | 62.7% | 56.0% |
| >0.75% | 49.2% | 44.7% |
| >1.00% | 37.3% | 34.6% |

For comparison, NONE days exceed |0.5%| only 37.5% of the time (any
direction). BULL/BEAR days are both more frequent *and* larger movers
than NONE days.

## TEST 4 ??Is there still a predictable TX move 05:00??8:45, once the signal is known?

(This is the same "pre-open gap" period already computed in the prior
research phase ??TX's last night trade at ~04:59 through its 08:45 open,
the only two real prices available in this window.)

| | BULL?ONE | p | BEAR?ONE | p |
|---|---:|---:|---:|---:|
| TX 04:59??8:45 | -0.0208% | 0.594 | **-0.1591%** | **0.028** |

BULL: no detectable residual (statistically indistinguishable from
zero). BEAR: small but significant residual continuation (-0.16pp) ??TX
itself drifts slightly further down into the open on BEAR days, beyond
what a NONE day does. This is the one place condition #5's information
appears to leak slightly past 05:00, and only on the bear side.

## TEST 9 / 13 Strategy A ??Can TX actually monetize this?

Position: long TX at ~04:59 (last night price) on BULL, short on BEAR,
exit at 08:45. TX round-trip cost computed from real fee/tax figures
(?T$50/side commission + 0.00002 exchange tax/side, both applied to
actual daily notional) ??averages **0.0062% of contract value**,
roughly 30x cheaper than 0050's typical 0.2% round-trip cost, since
futures skip the stock transaction tax entirely.

| Cost scenario | N | Win rate | Mean | Median | Cumulative | Max DD | Ann. Sharpe-like |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 bps | 408 | 50.2% | +0.0646% | +0.0045% | +29.0% | -4.85% | 1.58 |
| Realistic cost | 408 | 49.5% | +0.0584% | -0.0018% | +25.8% | -4.98% | 1.43 |
| 2x realistic | 408 | 48.3% | +0.0522% | -0.0080% | +22.7% | -5.10% | 1.28 |

At face value this looks like a real, cheap-to-trade edge. **It is not,
once you look at concentration.**

### Outlier check ??this "edge" is almost entirely a few days

- **77% of the entire cumulative gain comes from just the top 5 trades
  out of 408.**
- Excluding the single best day (2025-04-07, +8.1%) cuts the mean
  return by a third (0.058% ??0.039%).
- Trimming the top-5 *and* bottom-5 days (398 remaining) drops
  cumulative return from +25.8% to +13.8% ??roughly half.

### TEST 14 ??Out-of-sample split (chronological, pre-specified: dev
2023-05-23 to 2025-12-31, holdout 2026-01-01 to 2026-09-16)

| Period | N | Win rate | Mean | Median | Cumulative | Top-5-day share of gain |
|---|---:|---:|---:|---:|---:|---:|
| Development | 316 | 50.0% | +0.057% | +0.0008% | +19.0% | 94.4% |
| Holdout | 92 | 47.8% | +0.064% | **-0.0069%** | +5.7% | **162.1%** |

**In the holdout period, the top 5 days alone account for more than the
entire cumulative gain (162%) ??the other 87 days collectively lose
money.** The median trade is negative in holdout. This is not a
systematic per-day edge; it's exposure to rare, large macro-driven
sessions (the +8.1% day, 2025-04-07, was in development ??during the
April 2025 tariff-shock period ??and holdout has its own smaller version
of the same pattern).

## Multiple-testing context

This is now the third phase of related testing on this signal (original
post-open study, information-timing study, this gap-monetization study).
The one nominally "significant" new result here (BEAR pre-open residual,
p=0.028) is consistent with the earlier finding and has a 95% CI that
excludes zero but is still fairly wide ([-0.30%, -0.02%]) ??treat as a
replication-worthy hypothesis, not a settled fact, especially given nine
total signal/period combinations have now been tested across this research
program.

## Bottom-line synthesis

**1. Does the ~90% figure reproduce?** Yes ??89.6% combined (95% CI
86.2-92.4%), consistent across BULL (91.0%) and BEAR (87.4%) separately.

**2. How economically large are the predicted gaps?** Substantial, not
trivial ??mean ~0.96-0.97% normalized, comparable to a full standard
deviation of ordinary daily gap noise. Medians confirm this isn't driven
by a few huge days at the gap-measurement level.

**3. How much is incorporated into TX by each checkpoint?** Essentially
all of it by the night session's own close (this was the prior phase's
finding ??night session effect ~10-15x the size of anything after). By
04:59??8:45, only a small, BEAR-only residual remains. The 06:00-08:30
checkpoints don't exist as tradable prices ??TX isn't trading then.

**4. Is there still a meaningful TX return 05:00??8:45?** Statistically
yes on the BEAR side only (-0.16pp, p=0.028), economically small, and not
present on the BULL side at all.

**5. Is there a specific pre-open interval to capture the remaining
gap?** No ??the only two real TX prices in this window are its endpoints;
there's no interior interval to isolate.

**6/7. Value of condition #5 vs. the 4 macro indices alone:** covered in
the prior research phase ??condition #5 sharpens classification (larger,
cleaner night-session effect) but doesn't relocate where the effect lives.
Not re-tested here against gap-specific outcomes; would need the same
4-condition dates run through this gap analysis if useful later.

**8. After realistic costs, is there an executable strategy?** The
gross/net numbers look attractive (Sharpe-like ~1.4, cheap TX costs), but
this is **not evidence of a real strategy** ??77-162% of the gain comes
from a handful of extreme days across both the full sample and the
holdout specifically, and the median trade is at or below zero. Costs
are not the binding constraint here (they're tiny); the concentration is.

**9. Which findings are robust vs. exploratory vs. weak?**
- **Robust:** the ~90% directional hit rate itself, the gap magnitude
  distributions, the finding that information is overwhelmingly
  incorporated by the night session's own close.
- **Weak / requires replication:** the BEAR pre-open residual (p=0.028,
  one test among many run across this research program).
- **Not supported:** any claim that Strategy A represents a monetizable
  edge ??it fails its own out-of-sample discipline test.

## What we now know

- The signal's ~90% directional hit rate for the cash opening gap is
  real and reproduces cleanly, with gap magnitudes that are economically
  meaningful (not just barely-positive noise).
- Virtually all of that predictive information is already reflected in
  TX's price by the end of the night session ??there's essentially
  nothing left to trade by the time the regular session opens, except a
  small, one-sided (BEAR-only) residual.
- TX transaction costs are not a meaningful constraint (??.006% round
  trip vs. 0050's ??.2%) ??if an edge existed, cost wouldn't be what
  kills it.

## What is still uncertain

- Whether the small BEAR-side pre-open residual (-0.16pp) is a real,
  persistent phenomenon or one significant result among many related
  tests run across this research program.
- Whether a genuinely different execution approach (trading *during* the
  night session, rather than at its endpoints) could capture more of the
  ~0.96% average gap before it's priced in ??untested here.
- Whether condition #5 changes any of these gap-specific conclusions
  (only tested for the earlier post-open study, not this one).

## Potentially monetizable expressions

**None identified that survive scrutiny.** Strategy A (TX position at
~05:00, exit 08:45) looks profitable gross and net of realistic costs,
but that result is concentrated in a handful of extreme days and fails
out-of-sample (holdout's top-5 days exceed 100% of total gain). Do not
treat this as a validated strategy.

## Recommended next research step

**Investigate whether the ~0.96-0.97% average gap can be captured by
trading TX *during* the night session itself**, rather than at its
09:00-ish endpoints ??since that's the only place in this entire research
program where the signal's information has repeatedly shown up as large
and highly significant (from the earlier information-timing study). This
is a genuinely different, untested execution problem (liquidity and
timing within the night session, not the post-open or pre-open window),
and it's the one place the evidence consistently points toward something
real rather than noise.
