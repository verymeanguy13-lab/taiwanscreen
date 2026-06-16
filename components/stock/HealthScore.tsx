'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface HealthScoreBreakdown {
  profitability: number;
  growth:        number;
  safety:        number;
  chips:         number;
}

interface HealthScoreData {
  score:     number;
  grade:     'A' | 'B' | 'C' | 'D';
  breakdown: HealthScoreBreakdown;
  strengths: string[];
  warnings:  string[];
}

// ── Grade config ──────────────────────────────────────────────────────────────
const GRADE_CONFIG = {
  A: { bg: 'var(--accent-green)', label: 'A' },
  B: { bg: 'var(--accent-blue)',  label: 'B' },
  C: { bg: 'var(--accent-gold)',  label: 'C' },
  D: { bg: 'var(--accent-red)',   label: 'D' },
};

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const capped = Math.min(value, max);
  const pct    = Math.round((capped / max) * 100);
  const color  = pct >= 72 ? 'var(--accent-green)' : pct >= 40 ? 'var(--accent-blue)' : 'var(--accent-red)';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="num font-semibold" style={{ color: 'var(--text-primary)' }}>
          {capped}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function HealthScore({ symbol }: { symbol: string }) {
  const { data, error } = useSWR<HealthScoreData>(
    `/api/stock/${symbol}/score`,
    fetcher,
    { shouldRetryOnError: false },
  );

  // Loading
  if (!data && !error) {
    return (
      <div
        className="flex h-32 w-full items-center justify-center rounded-lg"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>載入中…</span>
      </div>
    );
  }

  // Error or no data
  if (error || !data) return null;

  const { score, grade, breakdown, strengths, warnings } = data;
  const gradeConfig = GRADE_CONFIG[grade];

  return (
    <div
      className="flex flex-col gap-4 rounded-lg p-4"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      {/* ── Top row: grade circle + score ── */}
      <div className="flex items-center gap-4">
        {/* Grade circle */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold"
          style={{ backgroundColor: gradeConfig.bg, color: 'var(--bg-primary)' }}
        >
          {gradeConfig.label}
        </div>

        {/* Score + label */}
        <div className="flex flex-col">
          <span className="num text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {score}
            <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}> / 100</span>
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>個股健康評分</span>
        </div>
      </div>

      {/* ── Progress bars ── */}
      <div className="flex flex-col gap-2">
        <ProgressBar label="獲利能力" value={breakdown.profitability} />
        <ProgressBar label="成長性"   value={breakdown.growth}        />
        <ProgressBar label="安全性"   value={breakdown.safety}        />
        <ProgressBar label="籌碼面"   value={breakdown.chips}         />
      </div>

      {/* ── Strengths ── */}
      {strengths.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {strengths.map(s => (
            <span
              key={s}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)',
                color: 'var(--accent-green)',
                border: '1px solid color-mix(in srgb, var(--accent-green) 30%, transparent)',
              }}
            >
              ✓ {s}
            </span>
          ))}
        </div>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {warnings.map(w => (
            <span
              key={w}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-gold) 15%, transparent)',
                color: 'var(--accent-gold)',
                border: '1px solid color-mix(in srgb, var(--accent-gold) 30%, transparent)',
              }}
            >
              ⚠ {w}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
