// =============================================================================
// db/seed-supply-chain.ts
// One-time seed script for supply chain relationships.
// Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.
//
// To run this script:
//   npx ts-node -r tsconfig-paths/register db/seed-supply-chain.ts
// =============================================================================

import { queryUnsafe } from '@/lib/db';

// -----------------------------------------------------------------------------
// Foreign / virtual stock entries (not listed on TWSE/TPEx)
// -----------------------------------------------------------------------------

const FOREIGN_STOCKS = [
  { symbol: 'AAPL',      name_zh: 'Apple Inc',    sector: '消費電子', market: 'FOREIGN' },
  { symbol: 'NVDA',      name_zh: 'NVIDIA Corp',  sector: '半導體',   market: 'FOREIGN' },
  { symbol: 'EV-SECTOR', name_zh: 'EV供應鏈',     sector: '電動車',   market: 'FOREIGN' },
];

// -----------------------------------------------------------------------------
// Supply chain relationships
// -----------------------------------------------------------------------------

interface Relationship {
  parent_symbol: string;
  child_symbol:  string;
  ecosystem:     string;
  relationship:  string;
  category:      string;
  tier:          number;
}

const TSMC_RELATIONSHIPS: Relationship[] = [
  // Tier 1 customers
  { parent_symbol: '2330', child_symbol: '2454', ecosystem: 'tsmc', relationship: 'customer',  category: '晶片設計客戶', tier: 1 },
  { parent_symbol: '2330', child_symbol: '2379', ecosystem: 'tsmc', relationship: 'customer',  category: '晶片設計客戶', tier: 1 },
  { parent_symbol: '2330', child_symbol: '3034', ecosystem: 'tsmc', relationship: 'customer',  category: '晶片設計客戶', tier: 1 },
  { parent_symbol: '2330', child_symbol: '6415', ecosystem: 'tsmc', relationship: 'customer',  category: '晶片設計客戶', tier: 1 },
  // Tier 1 packaging
  { parent_symbol: '2330', child_symbol: '3711', ecosystem: 'tsmc', relationship: 'packaging', category: '封裝測試',     tier: 1 },
  { parent_symbol: '2330', child_symbol: '2325', ecosystem: 'tsmc', relationship: 'packaging', category: '封裝測試',     tier: 1 },
  { parent_symbol: '2330', child_symbol: '2449', ecosystem: 'tsmc', relationship: 'packaging', category: '封裝測試',     tier: 1 },
  // Tier 1 materials
  { parent_symbol: '2330', child_symbol: '6488', ecosystem: 'tsmc', relationship: 'supplier',  category: '矽晶圓材料',   tier: 1 },
  { parent_symbol: '2330', child_symbol: '3532', ecosystem: 'tsmc', relationship: 'supplier',  category: '矽晶圓材料',   tier: 1 },
  // Tier 1 equipment
  { parent_symbol: '2330', child_symbol: '3658', ecosystem: 'tsmc', relationship: 'supplier',  category: '設備供應商',   tier: 1 },
  { parent_symbol: '2330', child_symbol: '3583', ecosystem: 'tsmc', relationship: 'supplier',  category: '設備供應商',   tier: 1 },
];

const APPLE_RELATIONSHIPS: Relationship[] = [
  // 組裝
  { parent_symbol: 'AAPL', child_symbol: '2317', ecosystem: 'apple', relationship: 'assembler', category: '組裝代工', tier: 1 },
  { parent_symbol: 'AAPL', child_symbol: '4938', ecosystem: 'apple', relationship: 'assembler', category: '組裝代工', tier: 1 },
  { parent_symbol: 'AAPL', child_symbol: '2382', ecosystem: 'apple', relationship: 'assembler', category: '組裝代工', tier: 1 },
  // 面板
  { parent_symbol: 'AAPL', child_symbol: '2409', ecosystem: 'apple', relationship: 'supplier',  category: '面板',     tier: 1 },
  { parent_symbol: 'AAPL', child_symbol: '3481', ecosystem: 'apple', relationship: 'supplier',  category: '面板',     tier: 1 },
  // 電池
  { parent_symbol: 'AAPL', child_symbol: '6121', ecosystem: 'apple', relationship: 'supplier',  category: '電池模組', tier: 1 },
  { parent_symbol: 'AAPL', child_symbol: '6243', ecosystem: 'apple', relationship: 'supplier',  category: '電池模組', tier: 1 },
  // 聲學
  { parent_symbol: 'AAPL', child_symbol: '2439', ecosystem: 'apple', relationship: 'supplier',  category: '聲學元件', tier: 1 },
  // 機殼
  { parent_symbol: 'AAPL', child_symbol: '2474', ecosystem: 'apple', relationship: 'supplier',  category: '金屬機殼', tier: 1 },
];

const NVIDIA_RELATIONSHIPS: Relationship[] = [
  // Server ODM
  { parent_symbol: 'NVDA', child_symbol: '2382', ecosystem: 'nvidia', relationship: 'odm',      category: 'AI伺服器ODM', tier: 1 },
  { parent_symbol: 'NVDA', child_symbol: '2356', ecosystem: 'nvidia', relationship: 'odm',      category: 'AI伺服器ODM', tier: 1 },
  { parent_symbol: 'NVDA', child_symbol: '3231', ecosystem: 'nvidia', relationship: 'odm',      category: 'AI伺服器ODM', tier: 1 },
  // 散熱
  { parent_symbol: 'NVDA', child_symbol: '3017', ecosystem: 'nvidia', relationship: 'supplier', category: '散熱解決方案', tier: 1 },
  { parent_symbol: 'NVDA', child_symbol: '6230', ecosystem: 'nvidia', relationship: 'supplier', category: '散熱解決方案', tier: 1 },
  { parent_symbol: 'NVDA', child_symbol: '3324', ecosystem: 'nvidia', relationship: 'supplier', category: '散熱解決方案', tier: 1 },
  // PCB
  { parent_symbol: 'NVDA', child_symbol: '4958', ecosystem: 'nvidia', relationship: 'supplier', category: '印刷電路板',   tier: 2 },
  { parent_symbol: 'NVDA', child_symbol: '2313', ecosystem: 'nvidia', relationship: 'supplier', category: '印刷電路板',   tier: 2 },
  { parent_symbol: 'NVDA', child_symbol: '3037', ecosystem: 'nvidia', relationship: 'supplier', category: '印刷電路板',   tier: 2 },
  // CoWoS封裝
  { parent_symbol: 'NVDA', child_symbol: '3711', ecosystem: 'nvidia', relationship: 'packaging', category: 'CoWoS先進封裝', tier: 1 },
  { parent_symbol: 'NVDA', child_symbol: '6239', ecosystem: 'nvidia', relationship: 'packaging', category: 'CoWoS先進封裝', tier: 1 },
];

const EV_RELATIONSHIPS: Relationship[] = [
  // 馬達控制
  { parent_symbol: 'EV-SECTOR', child_symbol: '2308', ecosystem: 'ev', relationship: 'supplier', category: '馬達控制器',   tier: 1 },
  { parent_symbol: 'EV-SECTOR', child_symbol: '1503', ecosystem: 'ev', relationship: 'supplier', category: '馬達控制器',   tier: 1 },
  // 電池材料
  { parent_symbol: 'EV-SECTOR', child_symbol: '4739', ecosystem: 'ev', relationship: 'supplier', category: '電池材料',     tier: 1 },
  // IGBT功率元件
  { parent_symbol: 'EV-SECTOR', child_symbol: '2481', ecosystem: 'ev', relationship: 'supplier', category: 'IGBT功率元件', tier: 1 },
  { parent_symbol: 'EV-SECTOR', child_symbol: '8261', ecosystem: 'ev', relationship: 'supplier', category: 'IGBT功率元件', tier: 1 },
  // 充電設備
  { parent_symbol: 'EV-SECTOR', child_symbol: '3665', ecosystem: 'ev', relationship: 'supplier', category: '充電連接器',   tier: 1 },
];

// -----------------------------------------------------------------------------
// Main seed function
// -----------------------------------------------------------------------------

async function seed() {
  console.log('=== 台股雷達 Supply Chain Seed ===\n');

  // ── Insert foreign / virtual stocks ─────────────────────────────────────
  console.log('[1/5] Inserting foreign/virtual stock entries…');
  for (const s of FOREIGN_STOCKS) {
    await queryUnsafe(
      `INSERT INTO stocks (symbol, name_zh, sector, market)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol) DO NOTHING`,
      [s.symbol, s.name_zh, s.sector, s.market],
    );
  }
  console.log(`      ✓ ${FOREIGN_STOCKS.length} entries done.\n`);

  // ── TSMC ecosystem ───────────────────────────────────────────────────────
  console.log('[2/5] Inserting TSMC ecosystem relationships…');
  for (const r of TSMC_RELATIONSHIPS) {
    await queryUnsafe(
      `INSERT INTO supply_chain (parent_symbol, child_symbol, ecosystem, relationship, category, tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (parent_symbol, child_symbol, ecosystem) DO NOTHING`,
      [r.parent_symbol, r.child_symbol, r.ecosystem, r.relationship, r.category, r.tier],
    );
  }
  console.log(`      ✓ ${TSMC_RELATIONSHIPS.length} relationships done.\n`);

  // ── Apple ecosystem ──────────────────────────────────────────────────────
  console.log('[3/5] Inserting Apple ecosystem relationships…');
  for (const r of APPLE_RELATIONSHIPS) {
    await queryUnsafe(
      `INSERT INTO supply_chain (parent_symbol, child_symbol, ecosystem, relationship, category, tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (parent_symbol, child_symbol, ecosystem) DO NOTHING`,
      [r.parent_symbol, r.child_symbol, r.ecosystem, r.relationship, r.category, r.tier],
    );
  }
  console.log(`      ✓ ${APPLE_RELATIONSHIPS.length} relationships done.\n`);

  // ── NVIDIA ecosystem ─────────────────────────────────────────────────────
  console.log('[4/5] Inserting NVIDIA ecosystem relationships…');
  for (const r of NVIDIA_RELATIONSHIPS) {
    await queryUnsafe(
      `INSERT INTO supply_chain (parent_symbol, child_symbol, ecosystem, relationship, category, tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (parent_symbol, child_symbol, ecosystem) DO NOTHING`,
      [r.parent_symbol, r.child_symbol, r.ecosystem, r.relationship, r.category, r.tier],
    );
  }
  console.log(`      ✓ ${NVIDIA_RELATIONSHIPS.length} relationships done.\n`);

  // ── EV ecosystem ─────────────────────────────────────────────────────────
  console.log('[5/5] Inserting EV ecosystem relationships…');
  for (const r of EV_RELATIONSHIPS) {
    await queryUnsafe(
      `INSERT INTO supply_chain (parent_symbol, child_symbol, ecosystem, relationship, category, tier)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (parent_symbol, child_symbol, ecosystem) DO NOTHING`,
      [r.parent_symbol, r.child_symbol, r.ecosystem, r.relationship, r.category, r.tier],
    );
  }
  console.log(`      ✓ ${EV_RELATIONSHIPS.length} relationships done.\n`);

  const total =
    TSMC_RELATIONSHIPS.length +
    APPLE_RELATIONSHIPS.length +
    NVIDIA_RELATIONSHIPS.length +
    EV_RELATIONSHIPS.length;

  console.log(`=== Seed complete. ${total} supply chain relationships inserted. ===`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});