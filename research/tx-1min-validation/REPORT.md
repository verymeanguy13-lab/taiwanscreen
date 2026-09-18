# TX 1-Minute Dataset Validation Report

Validates https://github.com/jason43314-crypto/taiwan-futures-1min-ohlc
(`TXFR1`, continuous front-month) for the planned TX post-08:45 reaction
study. **Data validation only — no Bull/Bear returns were calculated.**

## 1. Source

- Repo: `github.com/jason43314-crypto/taiwan-futures-1min-ohlc`
- Files used: `data_TXFR1_2023.sql`, `data_TXFR1_2024.sql`,
  `data_TXFR1_2025.sql`, `data_TXFR1_2026.sql` (research window only;
  2001–2022 files were not downloaded since they're outside our range)
- `product_id = TXFR1` — the continuous near-month TX contract, distinct
  from `MXFR1`/`TMFR1`. The dataset's own README flags that `MXFR1` and
  `TMFR1` contain multi-year stretches of data copied from TXF (small-cap
  and micro-cap products backfilled with TX prices before those contracts
  existed) — **this does not affect TXFR1**, which is the real underlying
  series for both those copies and is itself genuine throughout.

## 2. Data construction

- Loaded the 4 year-files' `COPY ... FROM stdin` blocks directly into
  DuckDB (schema per the repo's `schema.sql`), filtered to
  `trading_date BETWEEN 2023-05-23 AND 2026-09-05`.
- 1,010,480 rows loaded; `datetime` confirmed as **bar start time** (the
  08:45 bar's `open` is the first traded price of the day session — spot
  checked against several sample dates).
- "08:45 open" = `open` of the row where `datetime` time = 08:45:00.
  "09:02" etc. = `close` of the row at that timestamp (each row is a
  1-minute bar; the close of the 09:02 bar is the standard way to read
  "the price at 09:02").

## 3. Data validation

| Check | Result |
|---|---|
| Timezone | Taipei/UTC+8 confirmed (session boundaries land exactly on 08:45, 13:30, 15:00, 05:00 as expected) |
| Required timestamps present (08:45, 09:02, 09:03, 09:05, 09:10, 09:15, 09:30) | **100% — 801/801 trading days, zero missing, for every one of the 7 timestamps** |
| Duplicate `datetime` rows | 0 |
| Duplicate `datetime`+`trading_date` | 0 |
| OHLC violations (`high<open/close`, `low>open/close`, `high<low`, `volume<0`) | 0, in the full research window |
| Minute continuity 08:45→09:30 (expect 46 consecutive bars/day) | **All 801 days have exactly 46/46 bars — zero gaps** |
| `is_synthetic=true` rows inside 08:45–09:30 | **0** (all synthetic rows are settlement-day 13:30–13:44 filler bars, outside our window) |
| Trading-date assignment at session boundaries (15:00, 23:59, 00:00, 04:59, 05:00, Friday night→Monday) | Verified correct on sample dates — night session rolls to the next trading day, Friday night rolls to Monday, matches the dataset's documented rule |
| Residual single-minute 05:00/13:45 bars | 2 and 3 respectively in-window (matches README's noted "few stray minutes," irrelevant to our 08:45–09:30 window) |
| Contract rollover jumps | 28 settlement-day jumps >50pt found at exactly 13:29→13:30 — **always after 09:30**, so they never fall inside the research window. Example: 2026-08-04, close jumped 43200→43329 at 13:30 while 08:45–08:50 that same morning was a normal, continuous sequence |

No problems found. Every check that matters for this specific study
(08:45→09:30 minute bars) came back clean.

## 4. Sample

- Total trading days in window (2023-05-23 to 2026-09-05): **801**
- Days excluded for missing TX data: **0**
- Days excluded for data-quality problems: **0**
- (Bull/Bear/NONE day counts were not computed — that requires joining the
  US-index signal data, which is out of scope for this validation-only step)

## 5. Official TAIFEX cross-check — NOT COMPLETED

I attempted this as instructed. TAIFEX's "前30個交易日期貨每筆成交資料"
(previous-30-day tick data) and its daily market-report page are both
JavaScript/form-driven — the actual data is loaded via a client-side
request after selecting a date from a calendar widget, not via a plain
URL. I tried:
- Fetching the download-list page directly → returns the page shell with
  empty download-link cells (links are populated by JS after form submit)
- Guessing common TAIFEX query-string patterns (`futDailyMarketDl`,
  `dlFutDataDown` with `queryStartDate`/`queryEndDate`/`commodity_id`
  params modeled on a documented options-data equivalcasen) → couldn't
  fetch, since my tools can only open URLs that already appeared in a
  search result, and I could not locate the exact working query for the
  *futures* daily-download endpoint (only the analogous *options* one)
- `taifex.com.tw` is also not on this environment's allowed outbound
  domain list for direct HTTP requests from code, which would otherwise
  let me try a few more parameter combinations quickly

**What I did confirm from TAIFEX's site instead:** the current front-month
contract code (202610 as of 2026-09-17/18) and that the day-session/night-session
timing (08:45–13:45 / 15:00–05:00) matches what the GitHub dataset assumes.
I was not able to pull actual tick-level or 1-minute TAIFEX prices to
diff against the GitHub bars.

Per the task's own instructions, I'm reporting this rather than
pretending it was done. Closing this gap would need either a browser
(to submit the TAIFEX date-picker form and download the resulting CSV)
or the exact working query-string for `futDailyMarketDl`/equivalent,
neither of which I have in this environment.

## 6. Data quality summary

- Duplicates: 0
- OHLC violations: 0
- Missing minutes in 08:45–09:30: 0
- Synthetic rows in window: 0
- Trading-date issues: none found
- Rollover issues: present but confirmed to land at 13:30, outside the window

## 7. Coverage limitation

**The dataset ends 2026-09-05.** Our prior 0050 research extends to
2026-09-16. This snapshot is therefore missing roughly the last 8
trading days (2026-09-08 through 2026-09-16) relative to the full window
used in earlier work. No data was fabricated to fill this gap.

## 8. Research suitability

> Can we reasonably use this FREE TX 1-minute dataset to test whether the
> existing overnight Bull/Bear signal predicts TX movement from 08:45 to
> 09:02/09:03/09:05?

**YES, WITH LIMITATIONS:**

1. Coverage ends 2026-09-05 — the most recent ~8 trading days
   (2026-09-08 to 2026-09-16) are not in this snapshot and would need to
   be backfilled separately (e.g. from a fresher pull of the same
   database, or from a paid source) before matching the exact window used
   in the earlier 0050 study.
2. The official-TAIFEX cross-check could not be completed with the tools
   available in this environment — the dataset's internal consistency is
   excellent (see Section 3), but it has not been independently verified
   against the exchange's own tick data. If this matters before trusting
   results built on it, that check should be done manually (download the
   TAIFEX CSV by hand via the date-picker form) before relying heavily on
   conclusions from this data.
3. This dataset is TXFR1 (continuous/near-month), not date-specific
   contract codes — fine for this research, since the signal doesn't care
   which specific contract month is front, only that TX itself moved.

Everything else — timestamp availability, duplicates, OHLC validity,
minute continuity, trading-date logic, and rollover timing — checked out
completely clean.
