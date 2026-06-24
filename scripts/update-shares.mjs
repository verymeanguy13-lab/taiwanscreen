// scripts/update-shares.mjs
// Fetches shares_outstanding from TWSE t187ap03_L and updates the stocks table.
// Run once: node scripts/update-shares.mjs

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

console.log('Fetching stock list from TWSE...');
const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', {
  headers: { 'Accept': 'application/json' },
});
const data = await res.json();
console.log(`Fetched ${data.length} stocks`);

let count = 0;
let errors = 0;

for (const row of data) {
  const symbol = row['公司代號']?.trim();
  const sharesStr = row['已發行普通股數或TDR原股發行股數']?.replace(/,/g, '') ?? '0';
  const shares = parseInt(sharesStr, 10) || null;

  if (!symbol || !shares) continue;

  try {
    await sql`
      UPDATE stocks
      SET shares_outstanding = ${shares}
      WHERE symbol = ${symbol}
    `;
    count++;
  } catch (err) {
    console.error(`Failed ${symbol}:`, err.message);
    errors++;
  }
}

console.log(`Done. Updated ${count} stocks, ${errors} errors.`);

// Verify
const result = await sql`SELECT COUNT(*) as n FROM stocks WHERE shares_outstanding IS NOT NULL`;
console.log(`stocks with shares_outstanding: ${result[0].n}`);
