r"""
Validation script for the free TX 1-minute OHLC dataset:
https://github.com/jason43314-crypto/taiwan-futures-1min-ohlc

Purpose: ONLY validates whether this dataset is reliable enough to support
the planned TX post-open reaction study (08:45 -> 09:02/09:03/09:05/09:10/09:15/09:30
on Bull/Bear overnight-signal days). Does NOT calculate signal returns,
does NOT touch the taiwanscreen production database, and does NOT write
anywhere outside a local scratch directory.

Usage:
  1. Shallow-clone the dataset repo (sparse/blob:none is fine for inspecting
     structure; a full clone is needed to read the data_*.sql files):
       git clone https://github.com/jason43314-crypto/taiwan-futures-1min-ohlc.git
  2. Extract only the TXFR1 year files you need (this project's research
     window is 2023-05-23 through the present) with the awk one-liner below,
     then load into DuckDB (or Postgres, using schema.sql from that repo)
     and run the checks in this script.

     for y in 2023 2024 2025 2026; do
       awk 'BEGIN{FS="\t"} /^COPY/{flag=1; next} /^\\\.$/{flag=0} flag{print}' \
         data_TXFR1_${y}.sql > txfr1_${y}.tsv
     done

This script assumes the rows are already loaded into a DuckDB table named
`txfr1` with columns matching the dataset's schema.sql:
  datetime, product_id, open, high, low, close, volume, trading_date, is_synthetic
"""

import duckdb

RESEARCH_START = "2023-05-23"
RESEARCH_END = "2026-09-05"  # dataset snapshot ceiling as of this validation
REQUIRED_TIMES = ["08:45:00", "09:02:00", "09:03:00", "09:05:00",
                  "09:10:00", "09:15:00", "09:30:00"]


def run_validation(db_path: str = "tx.duckdb") -> dict:
    con = duckdb.connect(db_path)
    results = {}

    # Sample size / coverage
    total_days = con.execute("""
        SELECT COUNT(DISTINCT trading_date) FROM txfr1
        WHERE trading_date BETWEEN ? AND ?
          AND CAST(datetime AS TIME) = '08:45:00'
    """, [RESEARCH_START, RESEARCH_END]).fetchone()[0]
    results["total_trading_days"] = total_days

    # Required-timestamp availability
    availability = {}
    for t in REQUIRED_TIMES:
        n = con.execute("""
            SELECT COUNT(DISTINCT trading_date) FROM txfr1
            WHERE trading_date BETWEEN ? AND ?
              AND CAST(datetime AS TIME) = ?
        """, [RESEARCH_START, RESEARCH_END, t]).fetchone()[0]
        availability[t] = {"present": n, "missing": total_days - n,
                            "pct": round(100 * n / total_days, 2) if total_days else None}
    results["required_timestamp_availability"] = availability

    # Synthetic rows inside 08:45-09:30
    results["synthetic_rows_in_window"] = con.execute("""
        SELECT COUNT(*) FROM txfr1
        WHERE trading_date BETWEEN ? AND ?
          AND CAST(datetime AS TIME) BETWEEN '08:45:00' AND '09:30:00'
          AND is_synthetic = true
    """, [RESEARCH_START, RESEARCH_END]).fetchone()[0]

    # Duplicates
    results["duplicate_datetime"] = con.execute(
        "SELECT COUNT(*) FROM (SELECT datetime, COUNT(*) c FROM txfr1 GROUP BY 1 HAVING COUNT(*)>1)"
    ).fetchone()[0]

    # OHLC validity within window
    results["ohlc_violations_in_window"] = con.execute("""
        SELECT COUNT(*) FROM txfr1
        WHERE trading_date BETWEEN ? AND ?
        AND (high < open OR high < close OR low > open OR low > close OR high < low OR volume < 0)
    """, [RESEARCH_START, RESEARCH_END]).fetchone()[0]

    # Minute continuity 08:45-09:30 (expect 46 bars/day)
    short_days = con.execute("""
        SELECT COUNT(*) FROM (
          SELECT trading_date, COUNT(*) as n
          FROM txfr1
          WHERE trading_date BETWEEN ? AND ?
            AND CAST(datetime AS TIME) BETWEEN '08:45:00' AND '09:30:00'
          GROUP BY 1
          HAVING COUNT(*) < 46
        )
    """, [RESEARCH_START, RESEARCH_END]).fetchone()[0]
    results["days_with_incomplete_0845_0930_window"] = short_days

    # Rollover: confirm the settlement-day jump sits at 13:30, outside the window
    results["rollover_jumps_over_50pt_at_1330"] = con.execute("""
        WITH t AS (
          SELECT trading_date, datetime, close,
                 LEAD(close) OVER (ORDER BY datetime) as next_close
          FROM txfr1
          WHERE CAST(datetime AS TIME) IN ('13:29:00','13:30:00')
        )
        SELECT COUNT(*) FROM t
        WHERE CAST(datetime AS TIME)='13:29:00'
          AND trading_date BETWEEN ? AND ?
          AND ABS(next_close-close) > 50
    """, [RESEARCH_START, RESEARCH_END]).fetchone()[0]

    con.close()
    return results


if __name__ == "__main__":
    import json
    print(json.dumps(run_validation(), indent=2, default=str))
