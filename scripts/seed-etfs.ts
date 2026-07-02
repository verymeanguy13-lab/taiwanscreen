/**
 * scripts/seed-etfs.ts
 *
 * Seeds the top 50 Taiwan ETFs into the DB.
 * Run once with:  npx ts-node --skip-project scripts/seed-etfs.ts
 *
 * Data sources:
 *  - Static metadata (type, expense ratio, AUM, freq) — hardcoded from TWSE/Cnyes public data
 *  - Live price + yield — pulled from TWSE OpenAPI at runtime
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

// ── Static metadata ──────────────────────────────────────────────────────────
// AUM in NTD (bytes). Sourced from TWSE ETFortune / Cnyes as of 2026-06.
// etf_type: 'index' | 'dividend' | 'esg_dividend' | 'tech' | 'bond' | 'leverage' | 'international'
const ETF_META: Array<{
  symbol: string;
  name_zh: string;
  full_name: string;
  etf_type: string;
  expense_ratio: number;
  aum: number;             // NT$ (not 億)
  dividend_freq: string;   // 'monthly' | 'quarterly' | 'semi-annual' | 'annual'
  inception_date: string;
  sector: string;
}> = [
  // ── 市值型 ──────────────────────────────────────────────────────────────────
  { symbol: '0050',   name_zh: '元大台灣50',       full_name: '元大台灣卓越50基金',              etf_type: 'index',        expense_ratio: 0.0043, aum: 440_000_000_000, dividend_freq: 'annual',    inception_date: '2003-06-30', sector: '指數型ETF' },
  { symbol: '006208', name_zh: '富邦台50',          full_name: '富邦台灣采吉50基金',              etf_type: 'index',        expense_ratio: 0.0023, aum: 360_000_000_000, dividend_freq: 'annual',    inception_date: '2012-07-17', sector: '指數型ETF' },
  { symbol: '00922',  name_zh: '國泰台灣領袖50',    full_name: '國泰台灣領袖50ETF基金',           etf_type: 'index',        expense_ratio: 0.0040, aum: 55_000_000_000,  dividend_freq: 'quarterly', inception_date: '2022-10-20', sector: '指數型ETF' },
  { symbol: '00850',  name_zh: '元大台灣ESG永續',   full_name: '元大台灣ESG永續ETF基金',          etf_type: 'esg_dividend', expense_ratio: 0.0045, aum: 50_000_000_000,  dividend_freq: 'quarterly', inception_date: '2019-08-23', sector: 'ESG高息型ETF' },
  { symbol: '00923',  name_zh: '群益台ESG低碳50',   full_name: '群益台灣ESG低碳50ETF基金',        etf_type: 'esg_dividend', expense_ratio: 0.0045, aum: 38_000_000_000,  dividend_freq: 'quarterly', inception_date: '2022-10-28', sector: 'ESG高息型ETF' },

  // ── 高息型 ──────────────────────────────────────────────────────────────────
  { symbol: '0056',   name_zh: '元大高息',          full_name: '元大台灣高股息基金',              etf_type: 'dividend',     expense_ratio: 0.0065, aum: 390_000_000_000, dividend_freq: 'quarterly', inception_date: '2007-12-26', sector: '高息型ETF' },
  { symbol: '00878',  name_zh: '國泰永續高股息',     full_name: '國泰ESG永續高股息ETF基金',        etf_type: 'esg_dividend', expense_ratio: 0.0040, aum: 290_000_000_000, dividend_freq: 'quarterly', inception_date: '2020-10-20', sector: '高息型ETF' },
  { symbol: '00929',  name_zh: '復華台灣科技優息',   full_name: '復華台灣科技優息ETF基金',          etf_type: 'dividend',     expense_ratio: 0.0045, aum: 130_000_000_000, dividend_freq: 'monthly',   inception_date: '2023-06-14', sector: '高息型ETF' },
  { symbol: '00919',  name_zh: '群益台灣精選高息',   full_name: '群益台灣精選高息ETF基金',          etf_type: 'dividend',     expense_ratio: 0.0045, aum: 110_000_000_000, dividend_freq: 'monthly',   inception_date: '2023-01-17', sector: '高息型ETF' },
  { symbol: '00713',  name_zh: '元大台灣高息低波',   full_name: '元大台灣高股息低波動ETF基金',      etf_type: 'dividend',     expense_ratio: 0.0045, aum: 47_000_000_000,  dividend_freq: 'quarterly', inception_date: '2017-09-27', sector: '高息型ETF' },
  { symbol: '00940',  name_zh: '元大台灣價值高息',   full_name: '元大台灣價值高息ETF基金',          etf_type: 'dividend',     expense_ratio: 0.0060, aum: 80_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-03-28', sector: '高息型ETF' },
  { symbol: '00934',  name_zh: '中信成長高股息',     full_name: '中信台灣成長高股息ETF基金',        etf_type: 'dividend',     expense_ratio: 0.0060, aum: 65_000_000_000,  dividend_freq: 'monthly',   inception_date: '2023-11-30', sector: '高息型ETF' },
  { symbol: '00932',  name_zh: '兆豐永續高息',       full_name: '兆豐台灣永續高股息ETF基金',        etf_type: 'esg_dividend', expense_ratio: 0.0060, aum: 42_000_000_000,  dividend_freq: 'monthly',   inception_date: '2023-08-22', sector: '高息型ETF' },
  { symbol: '00915',  name_zh: '凱基優選高股息30',   full_name: '凱基台灣優選高股息30ETF基金',      etf_type: 'dividend',     expense_ratio: 0.0045, aum: 30_000_000_000,  dividend_freq: 'quarterly', inception_date: '2022-06-30', sector: '高息型ETF' },
  { symbol: '00900',  name_zh: '富邦特選高股息30',   full_name: '富邦台灣特選高股息30ETF基金',      etf_type: 'dividend',     expense_ratio: 0.0045, aum: 25_000_000_000,  dividend_freq: 'quarterly', inception_date: '2021-12-09', sector: '高息型ETF' },
  { symbol: '00907',  name_zh: '永豐優息存股',       full_name: '永豐台灣優息存股ETF基金',          etf_type: 'dividend',     expense_ratio: 0.0045, aum: 22_000_000_000,  dividend_freq: 'quarterly', inception_date: '2022-07-14', sector: '高息型ETF' },
  { symbol: '00936',  name_zh: '台新臺灣永續高息',   full_name: '台新台灣永續高息ETF基金',          etf_type: 'esg_dividend', expense_ratio: 0.0060, aum: 28_000_000_000,  dividend_freq: 'monthly',   inception_date: '2023-12-19', sector: '高息型ETF' },
  { symbol: '00938',  name_zh: '凱基優選30',         full_name: '凱基台灣優選30ETF基金',            etf_type: 'dividend',     expense_ratio: 0.0060, aum: 45_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-01-11', sector: '高息型ETF' },
  { symbol: '00943',  name_zh: '國泰台灣高息',       full_name: '國泰台灣高股息ETF基金',            etf_type: 'dividend',     expense_ratio: 0.0060, aum: 35_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-04-30', sector: '高息型ETF' },
  { symbol: '00944',  name_zh: '富邦台灣高息',       full_name: '富邦台灣高股息ETF基金',            etf_type: 'dividend',     expense_ratio: 0.0060, aum: 30_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-05-09', sector: '高息型ETF' },

  // ── 科技型 ──────────────────────────────────────────────────────────────────
  { symbol: '00881',  name_zh: '國泰台灣5G+',       full_name: '國泰台灣5G+ETF基金',              etf_type: 'tech',         expense_ratio: 0.0045, aum: 35_000_000_000,  dividend_freq: 'semi-annual', inception_date: '2021-01-19', sector: '科技型ETF' },
  { symbol: '0052',   name_zh: '富邦科技',           full_name: '富邦台灣科技指數基金',             etf_type: 'tech',         expense_ratio: 0.0040, aum: 30_000_000_000,  dividend_freq: 'annual',    inception_date: '2006-06-30', sector: '科技型ETF' },
  { symbol: '00892',  name_zh: '富邦台灣半導體',     full_name: '富邦台灣半導體ETF基金',            etf_type: 'tech',         expense_ratio: 0.0045, aum: 22_000_000_000,  dividend_freq: 'semi-annual', inception_date: '2021-07-01', sector: '科技型ETF' },
  { symbol: '00891',  name_zh: '中信關鍵半導體',     full_name: '中信關鍵半導體ETF基金',            etf_type: 'tech',         expense_ratio: 0.0045, aum: 20_000_000_000,  dividend_freq: 'quarterly', inception_date: '2021-07-08', sector: '科技型ETF' },
  { symbol: '00935',  name_zh: '野村臺灣新科技50',   full_name: '野村台灣新科技50ETF基金',          etf_type: 'tech',         expense_ratio: 0.0060, aum: 38_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-01-02', sector: '科技型ETF' },
  { symbol: '00912',  name_zh: '中信臺灣智慧50',     full_name: '中信台灣智慧50ETF基金',            etf_type: 'tech',         expense_ratio: 0.0045, aum: 18_000_000_000,  dividend_freq: 'quarterly', inception_date: '2022-04-19', sector: '科技型ETF' },
  { symbol: '00930',  name_zh: '永豐ESG低碳高息',    full_name: '永豐台灣ESG低碳高息ETF基金',       etf_type: 'esg_dividend', expense_ratio: 0.0060, aum: 15_000_000_000,  dividend_freq: 'monthly',   inception_date: '2023-06-22', sector: '科技型ETF' },

  // ── 國際型 ──────────────────────────────────────────────────────────────────
  { symbol: '00646',  name_zh: '元大S&P500',        full_name: '元大標普500ETF基金',              etf_type: 'international', expense_ratio: 0.0040, aum: 85_000_000_000, dividend_freq: 'annual',    inception_date: '2015-12-17', sector: '國際型ETF' },
  { symbol: '00757',  name_zh: '統一FANG+',          full_name: '統一FANG+ETF基金',                etf_type: 'international', expense_ratio: 0.0090, aum: 25_000_000_000, dividend_freq: 'annual',    inception_date: '2020-01-09', sector: '國際型ETF' },
  { symbol: '00662',  name_zh: '富邦NASDAQ',         full_name: '富邦NASDAQ100ETF基金',            etf_type: 'international', expense_ratio: 0.0060, aum: 20_000_000_000, dividend_freq: 'annual',    inception_date: '2016-11-01', sector: '國際型ETF' },
  { symbol: '00830',  name_zh: '國泰費城半導體',     full_name: '國泰費城半導體ETF基金',            etf_type: 'international', expense_ratio: 0.0060, aum: 18_000_000_000, dividend_freq: 'annual',    inception_date: '2020-01-21', sector: '國際型ETF' },
  { symbol: '00733',  name_zh: '富邦日本',           full_name: '富邦日本ETF基金',                 etf_type: 'international', expense_ratio: 0.0060, aum: 10_000_000_000, dividend_freq: 'annual',    inception_date: '2018-08-17', sector: '國際型ETF' },
  { symbol: '00885',  name_zh: '富邦印度',           full_name: '富邦印度ETF基金',                 etf_type: 'international', expense_ratio: 0.0099, aum: 12_000_000_000, dividend_freq: 'annual',    inception_date: '2021-03-23', sector: '國際型ETF' },

  // ── 槓桿/反向型 ─────────────────────────────────────────────────────────────
  { symbol: '00631L', name_zh: '元大台灣50正2',      full_name: '元大台灣50正向2倍ETF基金',         etf_type: 'leverage',     expense_ratio: 0.0100, aum: 95_000_000_000,  dividend_freq: 'annual',    inception_date: '2014-10-31', sector: '槓桿型ETF' },
  { symbol: '00632R', name_zh: '元大台灣50反1',      full_name: '元大台灣50反向1倍ETF基金',         etf_type: 'leverage',     expense_ratio: 0.0100, aum: 25_000_000_000,  dividend_freq: 'annual',    inception_date: '2014-10-31', sector: '槓桿型ETF' },
  { symbol: '00663L', name_zh: '國泰臺灣加權正2',    full_name: '國泰臺灣加權指數正向2倍ETF基金',   etf_type: 'leverage',     expense_ratio: 0.0100, aum: 15_000_000_000,  dividend_freq: 'annual',    inception_date: '2015-11-17', sector: '槓桿型ETF' },

  // ── 債券型 ──────────────────────────────────────────────────────────────────
  { symbol: '00679B', name_zh: '元大美債20年',       full_name: '元大美國政府20年期(以上)債券ETF',  etf_type: 'bond',         expense_ratio: 0.0060, aum: 70_000_000_000,  dividend_freq: 'monthly',   inception_date: '2017-01-11', sector: '債券型ETF' },
  { symbol: '00687B', name_zh: '國泰20年美債',       full_name: '國泰美國債券20年期ETF基金',        etf_type: 'bond',         expense_ratio: 0.0060, aum: 22_000_000_000,  dividend_freq: 'monthly',   inception_date: '2017-08-01', sector: '債券型ETF' },
  { symbol: '00696B', name_zh: '富邦美債20年',       full_name: '富邦美國政府20年期債券ETF基金',    etf_type: 'bond',         expense_ratio: 0.0060, aum: 18_000_000_000,  dividend_freq: 'monthly',   inception_date: '2017-11-14', sector: '債券型ETF' },
  { symbol: '00724B', name_zh: '群益25年美債',       full_name: '群益25年以上美國公債ETF基金',      etf_type: 'bond',         expense_ratio: 0.0060, aum: 12_000_000_000,  dividend_freq: 'monthly',   inception_date: '2018-09-14', sector: '債券型ETF' },
  { symbol: '00725B', name_zh: '國泰投資級公司債',   full_name: '國泰投資級公司債ETF基金',          etf_type: 'bond',         expense_ratio: 0.0060, aum: 135_000_000_000, dividend_freq: 'monthly',   inception_date: '2018-10-09', sector: '債券型ETF' },
  { symbol: '00720B', name_zh: '元大投資級公司債',   full_name: '元大10年以上BBB美元公司債ETF',     etf_type: 'bond',         expense_ratio: 0.0060, aum: 30_000_000_000,  dividend_freq: 'monthly',   inception_date: '2018-08-09', sector: '債券型ETF' },
  { symbol: '00726B', name_zh: '凱基AAA至A公司債',   full_name: '凱基AAA至A級公司債ETF基金',        etf_type: 'bond',         expense_ratio: 0.0060, aum: 20_000_000_000,  dividend_freq: 'monthly',   inception_date: '2018-10-16', sector: '債券型ETF' },
  { symbol: '00741B', name_zh: '台灣高息公司債',     full_name: '台灣中信高評等公司債ETF基金',      etf_type: 'bond',         expense_ratio: 0.0060, aum: 15_000_000_000,  dividend_freq: 'monthly',   inception_date: '2019-08-20', sector: '債券型ETF' },
  { symbol: '00945B', name_zh: '凱基非投等債',       full_name: '凱基美國非投資等級債ETF基金',      etf_type: 'bond',         expense_ratio: 0.0060, aum: 25_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-02-06', sector: '債券型ETF' },
  { symbol: '00937B', name_zh: '群益ESG投等債20+',   full_name: '群益ESG投資等級20+年美元公司債ETF', etf_type: 'bond',        expense_ratio: 0.0060, aum: 18_000_000_000,  dividend_freq: 'monthly',   inception_date: '2024-01-23', sector: '債券型ETF' },

  // ── 其他主題型 ──────────────────────────────────────────────────────────────
  { symbol: '00893',  name_zh: '國泰智能電動車',     full_name: '國泰智能電動車ETF基金',            etf_type: 'tech',         expense_ratio: 0.0060, aum: 10_000_000_000,  dividend_freq: 'semi-annual', inception_date: '2021-07-08', sector: '主題型ETF' },
  { symbol: '00891',  name_zh: '中信關鍵半導體',     full_name: '中信關鍵半導體ETF基金',            etf_type: 'tech',         expense_ratio: 0.0045, aum: 20_000_000_000,  dividend_freq: 'quarterly', inception_date: '2021-07-08', sector: '主題型ETF' },
];

// Deduplicate by symbol (the list above has 00891 twice)
const UNIQUE_ETFS = Array.from(
  new Map(ETF_META.map(e => [e.symbol, e])).values()
);

// ── Fetch live yield from TWSE ────────────────────────────────────────────────
async function fetchYields(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL', {
      headers: { 'User-Agent': 'taiwanscreen/1.0' },
    });
    if (!res.ok) {
      console.warn('⚠️  TWSE yield API returned', res.status);
      return map;
    }
    const data: Array<{ Code: string; DividendYield: string }> = await res.json();
    for (const row of data) {
      const y = parseFloat(row.DividendYield);
      if (!isNaN(y)) map.set(row.Code, y);
    }
    console.log(`✅ Fetched yield data for ${map.size} symbols`);
  } catch (err) {
    console.warn('⚠️  Failed to fetch yields:', err);
  }
  return map;
}

// ── Fetch today's price from TWSE ────────────────────────────────────────────
async function fetchPrices(): Promise<Map<string, { close: number; changePct: number }>> {
  const map = new Map<string, { close: number; changePct: number }>();
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL', {
      headers: { 'User-Agent': 'taiwanscreen/1.0' },
    });
    if (!res.ok) {
      console.warn('⚠️  TWSE price API returned', res.status);
      return map;
    }
    const data: Array<{ Code: string; ClosingPrice: string }> = await res.json();
    for (const row of data) {
      const p = parseFloat(row.ClosingPrice.replace(/,/g, ''));
      if (!isNaN(p)) map.set(row.Code, { close: p, changePct: 0 });
    }
    console.log(`✅ Fetched price data for ${map.size} symbols`);
  } catch (err) {
    console.warn('⚠️  Failed to fetch prices:', err);
  }
  return map;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Seeding ${UNIQUE_ETFS.length} ETFs...\n`);

  const [yields, prices] = await Promise.all([fetchYields(), fetchPrices()]);

  let inserted = 0;
  let errors   = 0;

  for (const etf of UNIQUE_ETFS) {
    try {
      // 1. Upsert into stocks table
      await sql`
        INSERT INTO stocks (symbol, name_zh, sector, market)
        VALUES (${etf.symbol}, ${etf.name_zh}, ${etf.sector}, 'TWSE')
        ON CONFLICT (symbol) DO UPDATE
          SET name_zh = EXCLUDED.name_zh,
              sector  = EXCLUDED.sector
      `;

      // 2. Upsert into etfs table
      await sql`
        INSERT INTO etfs
          (symbol, full_name, etf_type, expense_ratio, aum, dividend_freq, inception_date)
        VALUES (
          ${etf.symbol}, ${etf.full_name}, ${etf.etf_type},
          ${etf.expense_ratio}, ${etf.aum}, ${etf.dividend_freq},
          ${etf.inception_date}
        )
        ON CONFLICT (symbol) DO UPDATE
          SET full_name     = EXCLUDED.full_name,
              etf_type      = EXCLUDED.etf_type,
              expense_ratio = EXCLUDED.expense_ratio,
              aum           = EXCLUDED.aum,
              dividend_freq = EXCLUDED.dividend_freq,
              inception_date = EXCLUDED.inception_date
      `;

      // 3. Upsert today's price into daily_prices
      const priceData = prices.get(etf.symbol);
      if (priceData) {
        const today = new Date().toISOString().slice(0, 10);
        await sql`
          INSERT INTO daily_prices (symbol, date, close, open, high, low, volume, change_pct)
          VALUES (
            ${etf.symbol}, ${today},
            ${priceData.close}, ${priceData.close}, ${priceData.close}, ${priceData.close},
            0, ${priceData.changePct}
          )
          ON CONFLICT (symbol, date) DO UPDATE
            SET close      = EXCLUDED.close,
                change_pct = EXCLUDED.change_pct
        `;
      }

      // 4. Upsert yield into dividend_summary
      const yieldPct = yields.get(etf.symbol);
      if (yieldPct !== undefined) {
        await sql`
          INSERT INTO dividend_summary (symbol, latest_yield_pct, dividend_frequency)
          VALUES (${etf.symbol}, ${yieldPct}, ${etf.dividend_freq})
          ON CONFLICT (symbol) DO UPDATE
            SET latest_yield_pct   = EXCLUDED.latest_yield_pct,
                dividend_frequency = EXCLUDED.dividend_frequency
        `;
      }

      const priceStr  = priceData ? `NT$${priceData.close}` : '(no price)';
      const yieldStr  = yieldPct  !== undefined ? `${yieldPct}%` : '(no yield)';
      console.log(`  ✅ ${etf.symbol.padEnd(7)} ${etf.name_zh.padEnd(12)} ${priceStr.padEnd(12)} yield=${yieldStr}`);
      inserted++;

    } catch (err) {
      console.error(`  ❌ ${etf.symbol}: ${err}`);
      errors++;
    }
  }

  console.log(`\n✅ Done. Inserted/updated: ${inserted}  Errors: ${errors}\n`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});