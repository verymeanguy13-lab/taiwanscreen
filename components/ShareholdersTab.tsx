'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface Director {
  name: string;
  type: string;
  shares: number;
  pct: number;
  change: number;
}

interface MajorShareholder {
  name: string;
  shares: number;
  pct: number;
}

interface ShareholdersData {
  directors: Director[];
  major: MajorShareholder[];
  period: string | null;
  prev_period: string | null;
}

export function ShareholdersTab({ symbol }: { symbol: string }) {
  const { data, error } = useSWR<ShareholdersData>(
    `/api/stock/${symbol}/shareholders`,
    fetcher,
    { shouldRetryOnError: false },
  );

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!data && !error) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        載入中…
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        資料載入失敗
      </div>
    );
  }

  const { directors = [], major = [], period, prev_period } = data!;

  return (
    <div className="flex flex-col gap-8">

      {/* ── Section 1: Director / Supervisor Holdings ─────────────────────── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          董監持股
          {period && (
            <span className="ml-2 font-normal" style={{ color: 'var(--text-secondary)' }}>
              {period}{prev_period ? ` vs ${prev_period}` : ''}
            </span>
          )}
        </h3>

        {directors.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>暫無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['姓名', '職稱', '持股張數', '持股%', '較上季變化'].map(h => (
                    <th key={h} className="pb-2 text-left font-semibold"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {directors.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-1.5" style={{ color: 'var(--text-primary)' }}>
                      {d.name}
                    </td>
                    <td className="py-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {d.type === 'supervisor' ? '監察人' : '董事'}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {d.shares.toLocaleString()}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {d.pct.toFixed(2)}%
                    </td>
                    <td
                      className="num py-1.5 text-right font-semibold"
                      style={{
                        color: d.change > 0
                          ? 'var(--accent-green)'
                          : d.change < 0
                          ? 'var(--accent-red)'
                          : 'var(--text-secondary)',
                      }}
                    >
                      {d.change > 0
                        ? `+${d.change.toLocaleString()}`
                        : d.change.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Positive signal note */}
        {directors.some(d => d.change > 0) && (
          <p className="mt-2 text-xs" style={{ color: 'var(--accent-green)' }}>
            ✓ 董事持股增加，內部人持股比例上升
          </p>
        )}
      </div>

      {/* ── Section 2: Major Shareholders >10% ───────────────────────────── */}
      {major.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            主要股東（持股 &gt;10%）
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 320 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['股東名稱', '持股張數', '持股%'].map(h => (
                    <th key={h} className="pb-2 text-left font-semibold"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {major.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-1.5" style={{ color: 'var(--text-primary)' }}>
                      {m.name}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {m.shares.toLocaleString()}
                    </td>
                    <td className="num py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                      {m.pct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Attribution ───────────────────────────────────────────────────── */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        資料來源：公開資訊觀測站 (MOPS)
      </p>

    </div>
  );
}
