// scripts/ingest-fundamentals.mjs
// Runs in GitHub Actions — fetches balance sheet + book value from MOPS,
// then upserts debt_ratio and pb_ratio directly into Neon DB.
// No Vercel timeout. Takes ~2-3 minutes for all ~1986 stocks.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// ── Helpers ──────────────────────────────────────────────────────────────────

function toROCYear(y) { return y - 1911; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function mopsFetch(path, body) {
  const url = `https://mops.twse.com.tw${path}`;
  const formBody = new URLSearchParams(body).toString();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://mops.twse.com.tw',
        },
        body: formBody,
        signal: AbortSignal.timeout(60000), // 60s per request
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn(`[mopsFetch] Attempt ${attempt + 1} failed for ${path}: ${err.message}`);
      if (attempt < 2) await sleep(3000);
    }
  }
  return null;
}

function parseHTMLTable(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(cleaned)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(
        cellMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .trim()
      );
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function extractHTML(raw) {
  try {
    const json = JSON.parse(raw);
    const html = json?.html ?? json?.data ?? json?.table ?? json?.trs ?? '';
    if (html) return html;
  } catch {}
  return raw;
}

function getLatestCompletedSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 11) return { year, season: 3 };
  if (month >= 8)  return { year, season: 2 };
  if (month >= 5)  return { year, season: 1 };
  return { year: year - 1, season: 4 };
}

// ── MOPS Fetchers ─────────────────────────────────────────────────────────────

async function fetchBalanceSheet(year, season) {
  console.log(`[fetchBalanceSheet] Fetching ${year}Q${season}...`);
  const raw = await mopsFetch('/mops/web/ajax_t164sb03', {
    encodeURIComponent: '1', step: '1', firstin: '1', off: '1',
    keyword4: '', code1: '', TYPEK: 'sii', isnew: 'false',
    year: String(toROCYear(year)), season: String(season),
  });
  if (!raw) return [];

  const rows = parseHTMLTable(extractHTML(raw));
  const results = [];
  for (const row of rows) {
    const symbol = row[0]?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;
    const totalAssets      = parseFloat((row[2] ?? '0').replace(/,/g, '')) || 0;
    const totalLiabilities = parseFloat((row[3] ?? '0').replace(/,/g, '')) || 0;
    if (totalAssets <= 0) continue;
    results.push({
      symbol,
      debtRatio: parseFloat(((totalLiabilities / totalAssets) * 100).toFixed(2)),
    });
  }
  console.log(`[fetchBalanceSheet] ${results.length} stocks`);
  return results;
}

async function fetchBookValue(year, season) {
  console.log(`[fetchBookValue] Fetching ${year}Q${season}...`);
  const raw = await mopsFetch('/mops/web/ajax_t05st22', {
    encodeURIComponent: '1', step: '1', firstin: '1', off: '1',
    keyword4: '', code1: '', TYPEK: 'sii', isnew: 'false',
    year: String(toROCYear(year)), season: String(season),
  });
  if (!raw) return [];

  const rows = parseHTMLTable(extractHTML(raw));
  const results = [];
  for (const row of rows) {
    const symbol = row[0]?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;
    const bookValue = parseFloat((row[4] ?? '0').replace(/,/g, '')) || 0;
    if (bookValue <= 0) continue;
    results.push({ symbol, bookValuePerShare: bookValue });
  }
  console.log(`[fetchBookValue] ${results.length} stocks`);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Determine year/season
  let year, season;
  if (process.env.INPUT_YEAR && process.env.INPUT_SEASON) {
    year   = parseInt(process.env.INPUT_YEAR);
    season = parseInt(process.env.INPUT_SEASON);
  } else {
    ({ year, season } = getLatestCompletedSeason());
  }
  const period = `${year}Q${season}`;
  console.log(`\n=== Ingesting fundamentals for ${period} ===\n`);

  // Fetch from MOPS (these can take 20-40s each — fine in GitHub Actions)
  const [balanceSheets, bookValues] = await Promise.all([
    fetchBalanceSheet(year, season),
    fetchBookValue(year, season),
  ]);

  if (balanceSheets.length === 0 && bookValues.length === 0) {
    console.error('Both MOPS fetches returned 0 rows. Aborting.');
    process.exit(1);
  }

  // Build lookup maps
  const debtMap = new Map(balanceSheets.map(r => [r.symbol, r.debtRatio]));
  const bookMap = new Map(bookValues.map(r => [r.symbol, r.bookValuePerShare]));
  const allSymbols = [...new Set([...debtMap.keys(), ...bookMap.keys()])];

  // Fetch latest prices for pb_ratio
  console.log(`\nFetching latest prices for pb_ratio...`);
  const priceRows = await sql`
    SELECT DISTINCT ON (symbol) symbol, close
    FROM daily_prices
    WHERE close IS NOT NULL AND close > 0
    ORDER BY symbol, date DESC
  `;
  const latestPrices = new Map(priceRows.map(r => [r.symbol, Number(r.close)]));
  console.log(`${priceRows.length} price records loaded`);

  // Upsert into fundamentals
  console.log(`\nUpserting ${allSymbols.length} stocks into fundamentals...`);
  let count = 0;
  let errors = 0;

  for (const symbol of allSymbols) {
    const debtRatio   = debtMap.get(symbol) ?? null;
    const bookValue   = bookMap.get(symbol) ?? null;
    const latestClose = latestPrices.get(symbol) ?? null;
    const pbRatio     = bookValue && latestClose && bookValue > 0
      ? parseFloat((latestClose / bookValue).toFixed(2))
      : null;

    try {
      await sql`
        INSERT INTO fundamentals (symbol, period, debt_ratio, pb_ratio)
        VALUES (${symbol}, ${period}, ${debtRatio}, ${pbRatio})
        ON CONFLICT (symbol, period) DO UPDATE
          SET debt_ratio = COALESCE(${debtRatio}, fundamentals.debt_ratio),
              pb_ratio   = COALESCE(${pbRatio},   fundamentals.pb_ratio)
      `;
      count++;
    } catch (err) {
      console.error(`Failed ${symbol}: ${err.message}`);
      errors++;
    }

    if (count % 200 === 0) console.log(`  Progress: ${count}/${allSymbols.length}`);
  }

  console.log(`\n✅ Done: ${count} upserted, ${errors} errors`);
  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
