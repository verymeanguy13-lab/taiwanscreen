// =============================================================================
// 台股雷達 — TypeScript Interfaces
// Mirrors db/schema.sql exactly. All fields optional unless PK or NOT NULL.
// =============================================================================

// -----------------------------------------------------------------------------
// Database table interfaces
// -----------------------------------------------------------------------------

export interface Stock {
  symbol: string;                // PK
  name_zh: string;               // NOT NULL
  name_en?: string;
  sector?: string;
  market: string;                // NOT NULL — 'TWSE' | 'TPEx'
  listed_date?: string;          // DATE as ISO string
  description_zh?: string;
  description_en?: string;
  updated_at?: string;
  shares_outstanding?: number;   // 已發行普通股數
}

export interface DailyPrice {
  symbol: string;                // PK (composite)
  date: string;                  // PK (composite) — DATE as ISO string
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;               // in lots (張)
  change_amt?: number;
  change_pct?: number;
}

export interface Fundamentals {
  symbol: string;                // PK (composite)
  period: string;                // PK (composite) — e.g. '2024Q3'
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  roe?: number;
  roa?: number;
  revenue?: number;
  net_income?: number;
  gross_margin?: number;
  net_margin?: number;
  revenue_growth_yoy?: number;
  eps_growth_yoy?: number;
  debt_ratio?: number;
  market_cap?: number;
}

export interface InstitutionalFlow {
  symbol: string;                // PK (composite)
  date: string;                  // PK (composite) — DATE as ISO string
  foreign_buy?: number;
  foreign_sell?: number;
  foreign_net?: number;
  trust_buy?: number;
  trust_sell?: number;
  trust_net?: number;
  dealer_buy?: number;
  dealer_sell?: number;
  dealer_net?: number;
  total_net?: number;
  foreign_consecutive_days?: number;
  trust_consecutive_days?: number;
  triple_buy?: boolean;
}

export interface BrokerBranch {
  broker_id: string;             // PK
  broker_name: string;           // NOT NULL
  city?: string;
}

export interface BrokerFlow {
  symbol: string;                // PK (composite)
  date: string;                  // PK (composite) — DATE as ISO string
  broker_id: string;             // PK (composite)
  buy_volume?: number;
  sell_volume?: number;
  net_volume?: number;
}

export interface MarginData {
  symbol: string;                // PK (composite)
  date: string;                  // PK (composite) — DATE as ISO string
  margin_balance?: number;
  margin_change?: number;
  short_balance?: number;
  short_change?: number;
  margin_ratio?: number;
}

export interface Dividend {
  symbol: string;                // PK (composite)
  year: number;                  // PK (composite)
  period: string;                // PK (composite)
  cash_dividend?: number;
  stock_dividend?: number;
  yield_pct?: number;
  ex_dividend_date?: string;     // DATE as ISO string
  payment_date?: string;         // DATE as ISO string
}

export interface DividendSummary {
  symbol: string;                // PK
  latest_yield_pct?: number;
  consecutive_years?: number;
  dividend_frequency?: string;
  stability_score?: number;
  next_ex_date?: string;         // DATE as ISO string
  last_cash_dividend?: number;
}

export interface ETF {
  symbol: string;                // PK
  full_name?: string;
  etf_type?: string;
  expense_ratio?: number;
  aum?: number;
  dividend_freq?: string;
  inception_date?: string;       // DATE as ISO string
  description_zh?: string;
}

export interface SupplyChain {
  id: number;                    // PK (SERIAL)
  parent_symbol?: string;
  child_symbol?: string;
  ecosystem?: string;            // 'tsmc' | 'apple' | 'nvidia' | 'ev'
  relationship?: string;
  category?: string;
  tier?: number;
}

export interface Strategy {
  id: number;                    // PK (SERIAL)
  name_zh?: string;
  name_en?: string;
  description_zh?: string;
  filters?: Record<string, unknown>; // JSONB
  is_preset?: boolean;
}

export interface User {
  id: number;                    // PK (SERIAL)
  email: string;                 // NOT NULL UNIQUE
  name?: string;
  plan?: string;                 // 'free' | 'pro' | etc.
  lang_pref?: string;            // 'zh' | 'en'
  created_at?: string;
}

export interface Alert {
  id: number;                    // PK (SERIAL)
  user_id?: number;
  symbol?: string;
  alert_type?: string;
  threshold?: number;
  is_active?: boolean;
  last_triggered?: string;
  created_at?: string;
}

export interface PTTMention {
  symbol: string;                // PK (composite)
  date: string;                  // PK (composite) — DATE as ISO string
  mention_count?: number;
  sentiment_score?: number;
}

// -----------------------------------------------------------------------------
// Combined / computed types
// -----------------------------------------------------------------------------

/**
 * One row in the screener results table.
 * Joins Stock + latest DailyPrice + Fundamentals + InstitutionalFlow +
 * MarginData + DividendSummary into a flat shape for efficient rendering.
 */
export interface ScreenerRow {
  // Stock
  symbol: string;
  name_zh: string;
  name_en?: string;
  sector?: string;
  market: string;

  // DailyPrice (latest)
  close?: number;
  change_amt?: number;
  change_pct?: number;
  volume?: number;
  date?: string;

  // Fundamentals (latest period)
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  roe?: number;
  roa?: number;
  gross_margin?: number;
  net_margin?: number;
  revenue_growth_yoy?: number;
  eps_growth_yoy?: number;
  debt_ratio?: number;
  market_cap?: number;

  // InstitutionalFlow (latest)
  foreign_net?: number;
  trust_net?: number;
  dealer_net?: number;
  total_net?: number;
  foreign_consecutive_days?: number;
  trust_consecutive_days?: number;
  triple_buy?: boolean;

  // MarginData (latest)
  margin_balance?: number;
  margin_change?: number;
  short_balance?: number;
  margin_ratio?: number;

  // DividendSummary
  latest_yield_pct?: number;
  consecutive_years?: number;
  dividend_frequency?: string;
  stability_score?: number;
  next_ex_date?: string;
}

/**
 * Everything needed to render a single stock's detail page.
 */
export interface StockDetailPayload {
  info: Stock;
  quote: DailyPrice;
  fundamentals: Fundamentals[];
  priceHistory: DailyPrice[];
  dividendHistory: Dividend[];
  dividendSummary?: DividendSummary;
  supplyChain: {
    as_parent: SupplyChain[];    // stocks this stock supplies to
    as_child: SupplyChain[];     // stocks that supply to this stock
  };
}

// -----------------------------------------------------------------------------
// Screener filter parameters
// -----------------------------------------------------------------------------

export interface ScreenerFilter {
  // Valuation
  pe_min?: number;
  pe_max?: number;
  pb_min?: number;
  pb_max?: number;

  // Growth
  eps_growth_min?: number;
  revenue_growth_min?: number;

  // Profitability
  roe_min?: number;
  gross_margin_min?: number;
  debt_ratio_max?: number;

  // Market cap & price
  market_cap_min?: number;
  market_cap_max?: number;
  price_min?: number;
  price_max?: number;

  // Price action
  change_pct_min?: number;
  change_pct_max?: number;
  volume_min?: number;

  // Institutional flows
  foreign_net_min?: number;
  trust_net_min?: number;
  foreign_consecutive_min?: number;
  trust_consecutive_min?: number;
  triple_buy?: boolean;

  // Margin
  margin_trend?: 'increasing' | 'decreasing' | 'any';

  // Dividends
  yield_min?: number;
  yield_max?: number;
  consecutive_years_min?: number;
  dividend_freq?: string;
  stability_score_min?: number;

  // Categorical
  sector?: string[];
  market?: 'TWSE' | 'TPEx' | 'all';

  // Pagination & sorting
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
}

// -----------------------------------------------------------------------------
// API response wrappers
// -----------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface Candle {
  open:    number;
  high:    number;
  low:     number;
  close:   number;
  volume?: number;
  date?:   string;
}

export type { RealtimeQuote } from '@/lib/fugle';
export type { IntradayTick }  from '@/lib/fugle';