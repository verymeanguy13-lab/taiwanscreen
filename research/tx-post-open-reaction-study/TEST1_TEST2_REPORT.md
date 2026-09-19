# Follow-up: When Is the Signal's TX Information Actually Realized?

Primary pre-specified tests: TEST 1, TEST 2. Diagnostic: 4-condition
robustness (pending). Not yet completed: TEST 3 (TX vs 0050 comparison)
??see blocker note at the end.

All effects estimated via `R_t = alpha + beta_bull*BULL_t + beta_bear*BEAR_t + error_t`
with HC3 heteroskedasticity-robust standard errors, NONE as the reference
group (never compared against ALL, which mixes signal and non-signal days).

## 1. Timeline table

| Period | N (N/B/B) | BULL?ONE | 95% CI | p | BEAR?ONE | 95% CI | p |
|---|---|---:|---|---:|---:|---|---:|
| Night session (15:00??4:59 close) | 399/247/161 | **+0.8694** | [+0.740, +0.999] | **<0.0001** | **-0.9740** | [-1.129, -0.819] | **<0.0001** |
| Pre-open gap (04:59??8:45 open) | 399/247/161 | -0.0208 | [-0.097, +0.056] | 0.594 | **-0.1591** | [-0.301, -0.018] | **0.028** |
| TX open (08:45??9:00) | 401/247/161 | -0.0244 | [-0.066, +0.017] | 0.244 | +0.0333 | [-0.029, +0.095] | 0.292 |
| Post cash-open (09:00??9:30) | 401/247/161 | +0.0063 | [-0.053, +0.066] | 0.835 | +0.0369 | [-0.047, +0.120] | 0.387 |
| Full 08:45??9:30 (prior result) | 401/247/161 | -0.0180 | [-0.092, +0.056] | 0.635 | +0.0701 | [-0.031, +0.171] | 0.175 |

**2 dates (2026-08-25, 2026-09-01) excluded from the night-session and
pre-open rows only** ??the free GitHub source has a genuine gap in the
midnight-to-05:00 stretch for these two nights (data stops cleanly at
23:59 both times, confirmed by checking for the gap directly, not
assumed). Both existing-classification (5-condition) and TX-open-onward
tests are unaffected since they don't depend on that stretch. Not
silently dropped ??every other test that doesn't need the night data uses
all available days.

## 2. Interpretation ??TEST 1's answer

**Yes, essentially all of the signal's TX-relevant information is already
realized in the night session, before 08:45.**

- Night session: BULL?ONE = **+0.87%**, BEAR?ONE = **??.97%**, both
  wildly significant (p<0.0001, tight CIs far from zero). This is
  expected by construction ??night-session direction is literally
  condition #5 of the signal ??but the *magnitude* is informative: it's
  roughly 10-15x larger than any post-open effect measured anywhere in
  this study.
- Pre-open gap (04:59 close ??08:45 open, the "dead zone" with no
  trading): BULL?ONE is essentially zero and insignificant. BEAR?ONE
  is small but *significant* (??.16%, p=0.028) ??on BEAR days, TX
  continues to gap slightly lower into the open beyond what a normal day
  does, a small residual echo of the bear move, asymmetric (bull side
  shows nothing comparable).
- Everything from 08:45 onward (TEST 2, and the original 09:30 result):
  small, insignificant, inconsistently signed.

The pattern across the four periods, read left to right, is a clean
decay: **huge and significant ??small but partly significant (bear only)
??essentially nothing ??essentially nothing.** That's exactly the
signature of information being priced in during the night session and
mostly exhausted by the time the regular session opens.

## 3. TEST 2's answer ??is there a distinct reaction right at 09:00 (cash open)?

No evidence of one. 08:45??9:00 and 09:00??9:30 look statistically
indistinguishable from each other and from noise ??neither period shows
a significant bull or bear effect, and there's no meaningful jump in
either direction right at the point Taiwan's cash market opens. If the
0050 effect exists and shows up specifically after 09:00 (untested here
??that's TEST 3), it isn't visibly bleeding into TX's own price during
the same window.

## 4. 4-condition diagnostic ??indices only, ignoring TX's own night direction

Rerun with a diagnostic classification that drops condition #5 entirely
(BULL/BEAR from the 4 macro indices alone). 295 BULL / 196 BEAR / 325
NONE, vs. 247/161/401 for the real 5-condition signal ??larger samples
since dropping the TX-night gate lets more days qualify.

| Period | BULL?ONE | p | BEAR?ONE | p |
|---|---:|---:|---:|---:|
| Night session | +0.6846 | <0.0001 | ??.7493 | <0.0001 |
| Pre-open gap | ??.0137 | 0.712 | ??.1583 | 0.020 |
| 08:45??9:00 | ??.0158 | 0.447 | +0.0370 | 0.213 |
| 09:00??9:30 | +0.0148 | 0.616 | +0.0170 | 0.680 |

**Same shape as the 5-condition version** ??night session huge and highly
significant, everything after 08:45 small and insignificant. Condition #5
(TX's own overnight direction) is not what's causing the post-open null
result. The macro indices' information alone is already reflected in
TX's night-session move; TX's own overnight direction, when added as a
5th filter, sharpens the classification (larger night-session effect per
day, +0.87% vs +0.68% for BULL) but doesn't change *where* the effect
lives ??still almost entirely in the night session, not after 08:45.

## Bottom-line conclusion

**1. Does the signal appear to have already been incorporated into TX
before 08:45?**
Yes, essentially all of it. Night-session BULL/BEAR effects are ~10-15x
larger than anything measured afterward and overwhelmingly significant
(p<0.0001, both the 5-condition and 4-condition versions). A small,
BEAR-only residual continues into the pre-open gap (??.16%, p??.02-0.03)
but there's nothing comparable on the BULL side.

**2. Is there evidence of a distinct TX reaction around/after the 09:00
cash-market open?**
No. 08:45??9:00 and 09:00??9:30 are statistically indistinguishable from
each other and from zero, in both the 5-condition and 4-condition
versions. Nothing detectable happens specifically at the point Taiwan's
cash market opens.

**3. Is the 0050 effect statistically distinguishable from the TX
effect?**
Not tested ??TEST 3 is blocked on a historical-intraday 0050 data source
(see below). Cannot answer directly yet.

**4. Does the evidence justify continuing TX-execution research?**
Not for the approach tested here (a position taken at the 08:45 open).
The signal's actual predictive content lives almost entirely in the
night session itself ??a different trading problem (trading TX *during*
the night session, not after it) that this study didn't test and that
would need its own execution-feasibility analysis (liquidity, spread,
whether the "prediction" is realized gradually enough over the night to
be tradeable in real time, vs. already reflected by the time a retail
participant could act on the 05:00 signal reading).

## Blocker: TEST 3 (TX vs 0050 direct comparison) ??unchanged

Still needs historical intraday 0050 prices at 09:00/09:30 across 809
dates, which the repo's Fugle integration doesn't support (current-day
only, no historical-by-date). Not attempted further pending a decision
on how to source that data.

