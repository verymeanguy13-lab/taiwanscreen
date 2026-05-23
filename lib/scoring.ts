// =============================================================================
// lib/scoring.ts — Stock health score computation
// =============================================================================

export interface HealthScoreInput {
  pe_ratio:                 number | null;
  pb_ratio:                 number | null;
  roe:                      number | null;
  gross_margin:             number | null;
  revenue_growth_yoy:       number | null;
  eps_growth_yoy:           number | null;
  debt_ratio:               number | null;
  foreign_consecutive_days: number | null;
  triple_buy:               boolean;
  latest_yield_pct:         number | null;
  consecutive_years:        number | null;
  stability_score:          number | null;
}

export interface HealthScoreBreakdown {
  profitability: number; // 0–25
  growth:        number; // 0–25
  safety:        number; // 0–25
  chips:         number; // 0–25
}

export interface HealthScoreResult {
  score:     number;
  grade:     'A' | 'B' | 'C' | 'D';
  breakdown: HealthScoreBreakdown;
  strengths: string[];
  warnings:  string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Main function ─────────────────────────────────────────────────────────────

export function computeHealthScore(data: HealthScoreInput): HealthScoreResult {
  // ── 1. Profitability (0–25) ──────────────────────────────────────────────
  let profitability = 0;

  // ROE
  if (data.roe != null) {
    if      (data.roe > 20) profitability += 10;
    else if (data.roe > 15) profitability += 7;
    else if (data.roe > 10) profitability += 4;
    else if (data.roe < 0)  profitability -= 5;
  }

  // Gross margin
  if (data.gross_margin != null) {
    if      (data.gross_margin > 40) profitability += 8;
    else if (data.gross_margin > 25) profitability += 5;
    else if (data.gross_margin > 15) profitability += 2;
  }

  // Revenue growth (bonus for profitability)
  if (data.revenue_growth_yoy != null) {
    if      (data.revenue_growth_yoy > 20) profitability += 7;
    else if (data.revenue_growth_yoy > 10) profitability += 4;
    else if (data.revenue_growth_yoy < 0)  profitability -= 3;
  }

  profitability = clamp(profitability, 0, 25);

  // ── 2. Growth (0–25) ────────────────────────────────────────────────────
  let growth = 0;

  // Revenue YoY
  if (data.revenue_growth_yoy != null) {
    if      (data.revenue_growth_yoy > 20) growth += 10;
    else if (data.revenue_growth_yoy > 10) growth += 6;
    else if (data.revenue_growth_yoy > 0)  growth += 3;
    else                                   growth -= 3;
  }

  // EPS growth
  if (data.eps_growth_yoy != null) {
    if      (data.eps_growth_yoy > 20) growth += 10;
    else if (data.eps_growth_yoy > 10) growth += 6;
    else if (data.eps_growth_yoy > 0)  growth += 3;
    else                               growth -= 3;
  }

  growth = clamp(growth, 0, 25);

  // ── 3. Safety (0–25) ────────────────────────────────────────────────────
  let safety = 0;

  // Debt ratio
  if (data.debt_ratio != null) {
    if      (data.debt_ratio < 30) safety += 10;
    else if (data.debt_ratio < 50) safety += 6;
    else if (data.debt_ratio > 70) safety -= 5;
  }

  // PE ratio
  if (data.pe_ratio != null) {
    if      (data.pe_ratio < 15) safety += 8;
    else if (data.pe_ratio < 25) safety += 5;
    else if (data.pe_ratio > 40) safety -= 3;
  }

  // PB ratio
  if (data.pb_ratio != null) {
    if      (data.pb_ratio < 1.5) safety += 7;
    else if (data.pb_ratio < 3)   safety += 4;
    else if (data.pb_ratio > 5)   safety -= 3;
  }

  safety = clamp(safety, 0, 25);

  // ── 4. Chips (0–25) ─────────────────────────────────────────────────────
  let chips = 0;

  // Foreign consecutive days
  if (data.foreign_consecutive_days != null) {
    if      (data.foreign_consecutive_days > 10)  chips += 10;
    else if (data.foreign_consecutive_days > 5)   chips += 7;
    else if (data.foreign_consecutive_days > 0)   chips += 4;
    else if (data.foreign_consecutive_days < -5)  chips -= 5;
  }

  // Triple buy
  if (data.triple_buy) chips += 8;

  // Dividend quality
  if (
    data.latest_yield_pct != null && data.latest_yield_pct > 4 &&
    data.consecutive_years != null && data.consecutive_years > 5
  ) {
    chips += 7;
  }

  chips = clamp(chips, 0, 25);

  // ── 5. Total score & grade ───────────────────────────────────────────────
  const score = profitability + growth + safety + chips;

  let grade: 'A' | 'B' | 'C' | 'D';
  if      (score >= 80) grade = 'A';
  else if (score >= 60) grade = 'B';
  else if (score >= 40) grade = 'C';
  else                  grade = 'D';

  // ── 6. Strengths & warnings ──────────────────────────────────────────────
  const strengths: string[] = [];
  const warnings:  string[] = [];

  // Profitability
  if (profitability > 18) strengths.push('高獲利能力');
  if (profitability < 8)  warnings.push('獲利能力偏弱');
  if (data.roe != null && data.roe > 20)          strengths.push('高ROE');
  if (data.gross_margin != null && data.gross_margin > 40) strengths.push('高毛利率');

  // Growth
  if (growth > 18) strengths.push('高成長性');
  if (growth < 8)  warnings.push('成長動能不足');
  if (data.revenue_growth_yoy != null && data.revenue_growth_yoy > 20) strengths.push('營收高速成長');
  if (data.eps_growth_yoy != null && data.eps_growth_yoy > 20)         strengths.push('EPS高速成長');
  if (data.revenue_growth_yoy != null && data.revenue_growth_yoy < 0)  warnings.push('營收年衰退');

  // Safety
  if (safety > 18) strengths.push('財務安全');
  if (safety < 8)  warnings.push('財務風險偏高');
  if (data.debt_ratio != null && data.debt_ratio < 30) strengths.push('低負債');
  if (data.debt_ratio != null && data.debt_ratio > 70) warnings.push('高負債比');
  if (data.pe_ratio != null && data.pe_ratio > 40)     warnings.push('本益比偏高');

  // Chips
  if (chips > 18) strengths.push('籌碼面強勁');
  if (chips < 8)  warnings.push('籌碼面偏弱');
  if (data.foreign_consecutive_days != null && data.foreign_consecutive_days > 5) strengths.push('外資連買');
  if (data.foreign_consecutive_days != null && data.foreign_consecutive_days < -5) warnings.push('外資連賣');
  if (data.triple_buy) strengths.push('三買訊號');

  return {
    score,
    grade,
    breakdown: { profitability, growth, safety, chips },
    strengths: [...new Set(strengths)],
    warnings:  [...new Set(warnings)],
  };
}