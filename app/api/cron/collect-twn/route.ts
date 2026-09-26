// =============================================================================
// app/api/cron/collect-twn/route.ts
//
// Called externally (GitHub Actions, not Vercel Cron -- Hobby plan can't run
// sub-daily cron) at each target Taipei time: 04:30/04:45/04:55/05:00/05:01/
// 05:02/05:05/05:10/05:15. Polls SGX's own public delayed-price API
// (api.sgx.com/derivatives/v1.0/contract-code/TWN -- the exact endpoint
// www.sgx.com's own price page calls, no auth, first-party) and stores the
// raw response immutably, plus a parsed row for the front-month contract.
//
// On the LAST slot of the day (05:15) it also fetches and stores that day's
// signal classification, reusing the existing tx-post-open-signal-days and
// overnight-components-raw endpoints -- does not recompute the signal itself.
//
// Auth: requires ?secret=... matching TWN_COLLECT_SECRET env var, so this
// isn't callable by anyone who finds the URL.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const SGX_URL_BASE = 'https://api.sgx.com/derivatives/v1.0/contract-code/TWN';

function nowTaipei() {
  // Taipei has no DST, fixed UTC+8
  const now = new Date();
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS twn_observations (
      id BIGSERIAL PRIMARY KEY,
      intended_slot TEXT NOT NULL,
      trading_date DATE NOT NULL,
      collected_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
      collected_at_taipei TIMESTAMPTZ NOT NULL,
      symbol TEXT,
      delivery_month TEXT,
      current_trading_session TEXT,
      last_traded_price NUMERIC,
      best_bid_price NUMERIC,
      best_ask_price NUMERIC,
      best_bid_qty NUMERIC,
      best_ask_qty NUMERIC,
      volume_trade NUMERIC,
      open_interest NUMERIC,
      sgx_record_update_time TEXT,
      sgx_last_update_time TEXT,
      has_real_data BOOLEAN NOT NULL,
      raw_response JSONB NOT NULL,
      collection_status TEXT NOT NULL,
      error_message TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS twn_signal_daily (
      trading_date DATE PRIMARY KEY,
      signal TEXT NOT NULL,
      dow_return NUMERIC,
      sp500_return NUMERIC,
      nasdaq_return NUMERIC,
      sox_return NUMERIC,
      tx_night_return NUMERIC,
      mean_component_return NUMERIC,
      mean_abs_component_return NUMERIC,
      collected_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS twn_collection_log (
      id BIGSERIAL PRIMARY KEY,
      intended_slot TEXT NOT NULL,
      trading_date DATE NOT NULL,
      attempt_at_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL,
      records_received INT,
      error TEXT
    )
  `;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const intendedSlot = searchParams.get('slot'); // e.g. "04:30", "05:00", "05:15"

  if (!process.env.TWN_COLLECT_SECRET || secret !== process.env.TWN_COLLECT_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!intendedSlot) {
    return NextResponse.json({ error: 'slot query param required, e.g. ?slot=04:30' }, { status: 400 });
  }

  await ensureSchema();

  const taipeiNow = nowTaipei();
  const tradingDate = taipeiNow.toISOString().slice(0, 10); // date as observed in Taipei

  const url = `${SGX_URL_BASE}?order=asc&orderby=delivery-month&category=futures&session=-1&t=${Date.now()}`;

  let status = 'ok';
  let errorMsg: string | null = null;
  let recordsReceived = 0;

  try {
    const res = await fetch(url, {
      headers: {
        'accept': '*/*',
        'origin': 'https://www.sgx.com',
        'referer': 'https://www.sgx.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`SGX API returned HTTP ${res.status}`);
    }

    const json = await res.json();
    const rows: any[] = json?.data ?? [];
    recordsReceived = rows.length;

    if (rows.length === 0) {
      throw new Error('SGX API returned zero rows');
    }

    // Front contract = earliest delivery-month among rows with a real (non-null)
    // last-traded-price OR real bid/ask -- i.e. actually trading, not just listed.
    // We do NOT assume the first row is front month; we verify.
    const realRows = rows.filter(r =>
      r['last-traded-price-adj'] != null || r['best-bid-price-adj'] != null || r['best-ask-price-adj'] != null
    );
    const source = realRows.length > 0 ? realRows : rows;
    const sorted = [...source].sort((a, b) => (a['delivery-month'] ?? '').localeCompare(b['delivery-month'] ?? ''));
    const frontMonth = sorted[0]?.['delivery-month'];
    const frontRows = rows.filter(r => r['delivery-month'] === frontMonth && !String(r.symbol).includes('_TAIC'));

    for (const row of frontRows) {
      const hasReal = row['last-traded-price-adj'] != null || row['best-bid-price-adj'] != null || row['best-ask-price-adj'] != null;
      await sql`
        INSERT INTO twn_observations (
          intended_slot, trading_date, collected_at_taipei, symbol, delivery_month,
          current_trading_session, last_traded_price, best_bid_price, best_ask_price,
          best_bid_qty, best_ask_qty, volume_trade, open_interest,
          sgx_record_update_time, sgx_last_update_time, has_real_data,
          raw_response, collection_status, error_message
        ) VALUES (
          ${intendedSlot}, ${tradingDate}, ${taipeiNow.toISOString()}, ${row.symbol}, ${row['delivery-month']},
          ${row['current-trading-session']}, ${row['last-traded-price-adj']}, ${row['best-bid-price-adj']}, ${row['best-ask-price-adj']},
          ${row['best-bid-quantity']}, ${row['best-ask-quantity']}, ${row['volume-trade']}, ${row['open-interest']},
          ${row['record-update-time']}, ${row['last-update-time']}, ${hasReal},
          ${JSON.stringify(row)}, 'ok', NULL
        )
      `;
    }
  } catch (err: unknown) {
    status = 'error';
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  await sql`
    INSERT INTO twn_collection_log (intended_slot, trading_date, status, records_received, error)
    VALUES (${intendedSlot}, ${tradingDate}, ${status}, ${recordsReceived}, ${errorMsg})
  `;

  // On the final slot of the day, also capture that day's signal classification
  // by calling the EXISTING signal endpoints -- not recomputing signal logic here.
  if (intendedSlot === '05:15' && status === 'ok') {
    try {
      const base = `https://${request.headers.get('host')}`;
      const [sigRes, compRes] = await Promise.all([
        fetch(`${base}/api/admin/tx-post-open-signal-days?start_date=${tradingDate}&end_date=${tradingDate}`),
        fetch(`${base}/api/admin/overnight-components-raw?start_date=${tradingDate}&end_date=${tradingDate}`),
      ]);
      const sigJson = await sigRes.json();
      const compJson = await compRes.json();
      const comp = compJson?.data?.[0];

      let signal = 'NONE';
      if (sigJson?.bullDates?.includes(tradingDate)) signal = 'BULL';
      else if (sigJson?.bearDates?.includes(tradingDate)) signal = 'BEAR';

      if (comp) {
        const vals = [comp.dow_return, comp.sp500_return, comp.nasdaq_return, comp.sox_return, comp.tx_night_return];
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const meanAbs = vals.reduce((a, b) => a + Math.abs(b), 0) / vals.length;

        await sql`
          INSERT INTO twn_signal_daily (
            trading_date, signal, dow_return, sp500_return, nasdaq_return, sox_return,
            tx_night_return, mean_component_return, mean_abs_component_return, source
          ) VALUES (
            ${tradingDate}, ${signal}, ${comp.dow_return}, ${comp.sp500_return}, ${comp.nasdaq_return},
            ${comp.sox_return}, ${comp.tx_night_return}, ${mean}, ${meanAbs}, 'tx-post-open-signal-days+overnight-components-raw'
          )
          ON CONFLICT (trading_date) DO UPDATE SET
            signal = EXCLUDED.signal, dow_return = EXCLUDED.dow_return, sp500_return = EXCLUDED.sp500_return,
            nasdaq_return = EXCLUDED.nasdaq_return, sox_return = EXCLUDED.sox_return,
            tx_night_return = EXCLUDED.tx_night_return, mean_component_return = EXCLUDED.mean_component_return,
            mean_abs_component_return = EXCLUDED.mean_abs_component_return, collected_at_utc = now()
        `;
      }
    } catch (err) {
      // Signal capture failing should not fail the TWN observation itself --
      // log and move on, the observation rows above are already saved.
      console.error('signal capture failed', err);
    }
  }

  return NextResponse.json({
    slot: intendedSlot,
    tradingDate,
    status,
    recordsReceived,
    error: errorMsg,
  });
}
