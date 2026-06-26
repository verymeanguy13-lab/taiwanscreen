import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date'); // YYYYMMDD
  if (!date || !/^\d{8}$/.test(date)) {
    return NextResponse.json({ error: 'Pass ?date=YYYYMMDD' }, { status: 400 });
  }

  const isoDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const clean = (s: string) => parseFloat(String(s).replace(/,/g, '').trim()) || 0;
  let count = 0;

  // TWSE MI_INDEX
  try {
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${date}&type=ALLBUT0999`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json?.stat === 'OK' && Array.isArray(json.tables)) {
      const priceTable = json.tables.find((t: any) =>
        Array.isArray(t.fields) && t.fields[0]?.includes('證券代號')
      );
      if (priceTable?.data) {
        for (const row of priceTable.data) {
          if (row.length < 11) continue;
          const symbol = String(row[0]).trim();
          if (!/^\d{4,6}$/.test(symbol)) continue;
          const close = clean(row[8]);
          if (!close || close <= 0) continue;
          // row[9] may be HTML like <p style= color:green>-</p>
          const direction = String(row[9] ?? '').trim();
          const sign = (direction.includes('-') && !direction.includes('+')) ? -1 : 1;
          const change_amt = sign * clean(row[10]);
          const prevClose = close - change_amt;
          try {
            await sql`
              INSERT INTO daily_prices (symbol, date, open, high, low, close, volume, change_amt, change_pct)
              VALUES (
                ${symbol}, ${isoDate},
                ${clean(row[5])}, ${clean(row[6])}, ${clean(row[7])}, ${close},
                ${Math.round(clean(row[2]) / 1000)}, ${change_amt},
                ${prevClose > 0 ? Math.round((change_amt / prevClose) * 10000) / 100 : 0}
              )
              ON CONFLICT (symbol, date) DO UPDATE SET
                open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                close = EXCLUDED.close, volume = EXCLUDED.volume,
                change_amt = EXCLUDED.change_amt, change_pct = EXCLUDED.change_pct
            `;
            count++;
          } catch { /* FK violation = symbol not in stocks table, skip */ }
        }
      }
    }
  } catch (err) {
    console.error('[backfill-date] TWSE error:', err);
  }

  // TPEx
  try {
    const tpexDate = `${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6,8)}`;
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?d=${encodeURIComponent(tpexDate)}&se=AL&s=0,asc&o=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json && Array.isArray(json.aaData)) {
      for (const row of json.aaData as string[][]) {
        if (!row || row.length < 7) continue;
        const symbol = String(row[0]).trim();
        if (!/^\d{4,6}$/.test(symbol)) continue;
        const close = clean(row[2]);
        if (!close || close <= 0) continue;
        const changeRaw = String(row[3] ?? '').replace(/,/g, '').replace(/^\+/, '');
        const change_amt = changeRaw === '---' || changeRaw === '' ? 0 : parseFloat(changeRaw) || 0;
        const prevClose = close - change_amt;
        try {
          await sql`
            INSERT INTO daily_prices (symbol, date, open, high, low, close, volume, change_amt, change_pct)
            VALUES (
              ${symbol}, ${isoDate},
              ${clean(row[4])}, ${clean(row[5])}, ${clean(row[6])}, ${close},
              ${Math.round(clean(row[8]) / 1000)}, ${change_amt},
              ${prevClose > 0 ? Math.round((change_amt / prevClose) * 10000) / 100 : 0}
            )
            ON CONFLICT (symbol, date) DO UPDATE SET
              open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, volume = EXCLUDED.volume,
              change_amt = EXCLUDED.change_amt, change_pct = EXCLUDED.change_pct
          `;
          count++;
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    console.error('[backfill-date] TPEx error:', err);
  }

  return NextResponse.json({ success: true, date: isoDate, upserted: count });
}