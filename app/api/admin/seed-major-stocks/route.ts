// =============================================================================
// app/api/admin/seed-major-stocks/route.ts
// POST /api/admin/seed-major-stocks
// One-time fix: inserts major TWSE stocks that are missing from the stocks table.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const MAJOR_STOCKS = [
  { symbol: '2330', name_zh: '台積電',   sector: '半導體業' },
  { symbol: '2317', name_zh: '鴻海',     sector: '電子零組件業' },
  { symbol: '2454', name_zh: '聯發科',   sector: '半導體業' },
  { symbol: '2412', name_zh: '中華電',   sector: '通信網路業' },
  { symbol: '2308', name_zh: '台達電',   sector: '電子零組件業' },
  { symbol: '2382', name_zh: '廣達',     sector: '電腦及周邊設備業' },
  { symbol: '2303', name_zh: '聯電',     sector: '半導體業' },
  { symbol: '2881', name_zh: '富邦金',   sector: '金融保險業' },
  { symbol: '2882', name_zh: '國泰金',   sector: '金融保險業' },
  { symbol: '2886', name_zh: '兆豐金',   sector: '金融保險業' },
  { symbol: '2891', name_zh: '中信金',   sector: '金融保險業' },
  { symbol: '2884', name_zh: '玉山金',   sector: '金融保險業' },
  { symbol: '2885', name_zh: '元大金',   sector: '金融保險業' },
  { symbol: '2892', name_zh: '第一金',   sector: '金融保險業' },
  { symbol: '2880', name_zh: '華南金',   sector: '金融保險業' },
  { symbol: '2883', name_zh: '開發金',   sector: '金融保險業' },
  { symbol: '2890', name_zh: '永豐金',   sector: '金融保險業' },
  { symbol: '1301', name_zh: '台塑',     sector: '塑膠工業' },
  { symbol: '1303', name_zh: '南亞',     sector: '塑膠工業' },
  { symbol: '1326', name_zh: '台化',     sector: '塑膠工業' },
  { symbol: '2002', name_zh: '中鋼',     sector: '鋼鐵工業' },
  { symbol: '3711', name_zh: '日月光投控', sector: '半導體業' },
  { symbol: '2379', name_zh: '瑞昱',     sector: '半導體業' },
  { symbol: '2395', name_zh: '研華',     sector: '電腦及周邊設備業' },
  { symbol: '3034', name_zh: '聯詠',     sector: '半導體業' },
  { symbol: '2357', name_zh: '華碩',     sector: '電腦及周邊設備業' },
  { symbol: '2353', name_zh: '宏碁',     sector: '電腦及周邊設備業' },
  { symbol: '2301', name_zh: '光寶科',   sector: '電子零組件業' },
  { symbol: '2474', name_zh: '可成',     sector: '電子零組件業' },
  { symbol: '6505', name_zh: '台塑化',   sector: '油電燃氣業' },
  { symbol: '2337', name_zh: '旺宏',     sector: '半導體業' },
  { symbol: '2345', name_zh: '智邦',     sector: '通信網路業' },
  { symbol: '3008', name_zh: '大立光',   sector: '光電業' },
  { symbol: '2207', name_zh: '和泰車',   sector: '汽車工業' },
  { symbol: '2105', name_zh: '正新',     sector: '橡膠工業' },
  { symbol: '1216', name_zh: '統一',     sector: '食品工業' },
  { symbol: '2912', name_zh: '統一超',   sector: '貿易百貨業' },
  { symbol: '2408', name_zh: '南亞科',   sector: '半導體業' },
  { symbol: '2376', name_zh: '技嘉',     sector: '電腦及周邊設備業' },
  { symbol: '2377', name_zh: '微星',     sector: '電腦及周邊設備業' },
];

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let inserted = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const stock of MAJOR_STOCKS) {
    try {
      await queryUnsafe(
        `INSERT INTO stocks (symbol, name_zh, sector, market)
         VALUES ($1, $2, $3, 'TWSE')
         ON CONFLICT (symbol) DO UPDATE
           SET name_zh = EXCLUDED.name_zh,
               sector  = EXCLUDED.sector`,
        [stock.symbol, stock.name_zh, stock.sector],
      );
      inserted++;
    } catch (err) {
      errors.push(`${stock.symbol}: ${err}`);
    }
  }

  return NextResponse.json({ ok: true, inserted, skipped, errors });
}