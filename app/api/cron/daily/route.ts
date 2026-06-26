// =============================================================================
// app/api/cron/daily/route.ts
// Triggered by Vercel Cron at 10:30 UTC = 6:30pm Taiwan time, weekdays.
// Stripped to prices + institutional + margin only to avoid timeout.
// Signal accuracy is updated separately via /api/admin/update-signals
//
// EOD prices now use MI_INDEX as the primary source (via fetchAllStockPrices
// in lib/twse.ts), which returns final verified closing prices for all stocks.
//
// Self-healing: if a recent business day's prices are missing, backfillPricesForDate
// fetches them using the same MI_INDEX endpoint for that specific date.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import {
  ingestStockList,
  ingestDailyPrices,
  ingestInstitutionalFlows,
  ingestMarginData,
} from '@/lib/ingest';

const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Get last N business days (not including today, in Taiwan time)
function pastBusinessDays(n: number): Date[] {
  const days: Date[] = [];
  const tw = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  while (days.length < n) {
    tw.setDate(tw.getDate() - 1);
    const dow = tw.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(tw));
  }
  return days.reverse();
}

// ---------------------------------------------------------------------------
// backfillPricesForDate — fetches final EOD prices for a specific past date
// using the same MI_INDEX endpoint (TWSE) used as the primary source.
// TPEx backfill uses the same aftertrading endpoint with the specific date.
// ---------------------------------------------------------------------------
async function backfillPricesForDate(twseDate: string, isoDate: string): Promise<number> {
  const clean = (s: string) => parseFloat(String(s).replace(/,/g, '').trim()) || 0;
  let count = 0;

  // ── TWSE MI_INDEX ──────────────────────────────────────────────────────────
  try {
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${twseDate}&type=ALLBUT0999`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[backfill] TWSE MI_INDEX HTTP ${res.status} for ${twseDate}`);
    } else {
      const json = await res.json();
      if (json?.stat === 'OK' && Array.isArray(json.tables)) {
        const tables = json.tables as Array<{ fields?: string[]; data?: string[][] }>;
        const priceTable = tables.find(t =>
          Array.isArray(t.fields) && t.fields.length >= 9 && t.fields[0]?.includes('證券代號')
        );

        if (priceTable?.data) {
          for (const row of priceTable.data) {
            if (row.length < 11) continue;
            const symbol = String(row[0]).trim();
            if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

            const volume     = Math.round(clean(row[2]) / 1000);
            const open       = clean(row[5]);
            const high       = clean(row[6]);
            const low        = clean(row[7]);
            const close      = clean(row[8]);
            if (!close || close <= 0) continue;

            // row[9] may be HTML like <p style= color:green>-</p>
            const direction  = String(row[9] ?? '').trim();
            const sign       = (direction.includes('-') && !direction.includes('+')) ? -1 : 1;
            const change_amt = sign * clean(row[10]);
            const prevClose  = close - change_amt;
            const change_pct = prevClose > 0
              ? Math.round((change_amt / prevClose) * 10000) / 100
              : 0;

            try {
              await sql`
                INSERT INTO daily_prices
                  (symbol, date, open, high, low, close, volume, change_amt, change_pct)
                VALUES (
                  ${symbol}, ${isoDate}, ${open}, ${high}, ${low},
                  ${close}, ${volume}, ${change_amt}, ${change_pct}
                )
                ON CONFLICT (symbol, date) DO UPDATE SET
                  open       = EXCLUDED.open,
                  high       = EXCLUDED.high,
                  low        = EXCLUDED.low,
                  close      = EXCLUDED.close,
                  volume     = EXCLUDED.volume,
                  change_amt = EXCLUDED.change_amt,
                  change_pct = EXCLUDED.change_pct
              `;
              count++;
            } catch { /* skip FK violations */ }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[backfill] TWSE MI_INDEX error for ${twseDate}:`, err);
  }

  // ── TPEx aftertrading ──────────────────────────────────────────────────────
  try {
    const tpexDate = `${twseDate.slice(0, 4)}/${twseDate.slice(4, 6)}/${twseDate.slice(6, 8)}`;
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?d=${encodeURIComponent(tpexDate)}&se=AL&s=0,asc&o=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[backfill] TPEx HTTP ${res.status} for ${tpexDate}`);
    } else {
      const json = await res.json();
      if (json && Array.isArray(json.aaData)) {
        for (const row of json.aaData as string[][]) {
          if (!row || row.length < 7) continue;
          const symbol = String(row[0]).trim();
          if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

          const close = clean(row[2]);
          if (!close || close <= 0) continue;

          const changeRaw  = String(row[3] ?? '').replace(/,/g, '').replace(/^\+/, '');
          const change_amt = changeRaw === '---' || changeRaw === '' ? 0 : parseFloat(changeRaw) || 0;
          const open       = clean(row[4]);
          const high       = clean(row[5]);
          const low        = clean(row[6]);
          const volume     = Math.round(clean(row[8]) / 1000);
          const prevClose  = close - change_amt;
          const change_pct = prevClose > 0
            ? Math.round((change_amt / prevClose) * 10000) / 100
            : 0;

          try {
            await sql`
              INSERT INTO daily_prices
                (symbol, date, open, high, low, close, volume, change_amt, change_pct)
              VALUES (
                ${symbol}, ${isoDate}, ${open}, ${high}, ${low},
                ${close}, ${volume}, ${change_amt}, ${change_pct}
              )
              ON CONFLICT (symbol, date) DO UPDATE SET
                open       = EXCLUDED.open,
                high       = EXCLUDED.high,
                low        = EXCLUDED.low,
                close      = EXCLUDED.close,
                volume     = EXCLUDED.volume,
                change_amt = EXCLUDED.change_amt,
                change_pct = EXCLUDED.change_pct
            `;
            count++;
          } catch { /* skip */ }
        }
      }
    }
  } catch (err) {
    console.error(`[backfill] TPEx error for ${twseDate}:`, err);
  }

  return count;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const taiwanMs  = now.getTime() + 8 * 60 * 60 * 1000;
  const taiwanDay = new Date(taiwanMs).getUTCDay();

  if (taiwanDay === 0 || taiwanDay === 6) {
    return NextResponse.json({ message: 'Market closed today' });
  }

  const taiwanDate = new Date(taiwanMs).toISOString().slice(0, 10);
  console.log(`[cron/daily] Running ingestion for ${taiwanDate}`);

  const allErrors: string[] = [];
  const backfillResults: Record<string, number> = {};

  // ── Self-healing: check for missing recent days and backfill ─────────────
  const recentDays = pastBusinessDays(3);
  const [latestPrice] = await sql`SELECT MAX(date) as d FROM daily_prices`;
  const latestPriceDate = latestPrice?.d ? String(latestPrice.d).slice(0, 10) : null;

  for (const day of recentDays) {
    const isoDate = toISO(day);
    if (latestPriceDate && isoDate <= latestPriceDate) continue;

    console.log(`[cron/daily] Missing prices for ${isoDate}, backfilling via MI_INDEX...`);
    const count = await backfillPricesForDate(toTWSEDate(day), isoDate);
    backfillResults[isoDate] = count;
    if (count === 0) {
      allErrors.push(`Backfill returned 0 rows for ${isoDate}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Main ingestion for today ───────────────────────────────────────────────
  const stocks = await (async () => {
    try { return await ingestStockList(); }
    catch (err) {
      const msg = `ingestStockList fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const prices = await (async () => {
    try { return await ingestDailyPrices(taiwanDate); }
    catch (err) {
      const msg = `ingestDailyPrices fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const institutional = await (async () => {
    try { return await ingestInstitutionalFlows(taiwanDate); }
    catch (err) {
      const msg = `ingestInstitutionalFlows fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const margin = await (async () => {
    try { return await ingestMarginData(taiwanDate); }
    catch (err) {
      const msg = `ingestMarginData fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  allErrors.push(...stocks.errors, ...prices.errors, ...institutional.errors, ...margin.errors);

  // ── Background tasks (non-blocking) ───────────────────────────────────────
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const cronHeader = { 'x-cron-secret': process.env.CRON_SECRET ?? '' };

  fetch(`${base}/api/admin/twse-fundamentals`, {
    headers: cronHeader,
  }).catch(err => console.error('[daily] twse-fundamentals error:', err));

  fetch(`${base}/api/cron/alerts`, {
    headers: cronHeader,
  }).catch(err => console.error('[daily] alerts cron error:', err));

  fetch(`${base}/api/admin/detect-signals?offset=0&limit=200`, {
    method: 'POST',
    headers: cronHeader,
  }).catch(err => console.error('[daily] detect-signals error:', err));

  fetch(`${base}/api/kline/afterhours?side=bull`, {
    headers: cronHeader,
  }).catch(err => console.error('[daily] afterhours bull error:', err));

  fetch(`${base}/api/kline/afterhours?side=bear`, {
    headers: cronHeader,
  }).catch(err => console.error('[daily] afterhours bear error:', err));

  console.log(`[cron/daily] Completed for ${taiwanDate}. Errors: ${allErrors.length}`);

  return NextResponse.json({
    success: true,
    date:    taiwanDate,
    results: {
      stocks:        { count: stocks.count },
      prices:        { count: prices.count },
      institutional: { count: institutional.count },
      margin:        { count: margin.count },
      backfill:      backfillResults,
    },
    errors: allErrors,
  });
}