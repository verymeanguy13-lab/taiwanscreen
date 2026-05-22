'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import useSWR, { mutate } from 'swr';
import { Card }    from '@/components/ui/Card';
import { Button }  from '@/components/ui/Button';
import { Badge }   from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface Alert {
  id:             number;
  symbol:         string;
  name_zh:        string;
  alert_type:     string;
  threshold:      number | null;
  created_at:     string;
  last_triggered: string | null;
}

// ── Alert type display ────────────────────────────────────────────────────────
const ALERT_TYPES = [
  { value: 'price_above',     label: '股價高於',        needsThreshold: true  },
  { value: 'price_below',     label: '股價低於',        needsThreshold: true  },
  { value: 'foreign_consec',  label: '外資連買超過N日',  needsThreshold: true  },
  { value: 'triple_buy',      label: '三買訊號出現',     needsThreshold: false },
];

function alertDescription(alert: Alert): string {
  const type = ALERT_TYPES.find(t => t.value === alert.alert_type);
  const label = type?.label ?? alert.alert_type;
  if (alert.alert_type === 'price_above' || alert.alert_type === 'price_below') {
    return `${label} NT$${alert.threshold?.toLocaleString('en-US') ?? '—'}`;
  }
  if (alert.alert_type === 'foreign_consec') {
    return `${label} ${alert.threshold ?? '—'} 日`;
  }
  return label;
}

// ── Login prompt ──────────────────────────────────────────────────────────────
function LoginPrompt() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <div className="text-4xl mb-3">🔔</div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          登入以使用價格警示
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          免費帳戶可設定最多 3 個警示條件
        </p>
      </div>
      <button
        onClick={() => signIn('google')}
        className="flex items-center gap-3 rounded-xl px-6 py-3 text-sm font-semibold shadow-lg transition-transform hover:scale-105"
        style={{
          backgroundColor: 'white',
          color: '#1f2937',
          border: '1px solid #e5e7eb',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        使用 Google 帳號登入
      </button>
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({ alert, onDelete }: { alert: Alert; onDelete: (id: number) => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/alerts/${alert.id}`, { method: 'DELETE' });
      onDelete(alert.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-xl px-4 py-3 gap-3"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="num font-bold text-sm" style={{ color: 'var(--accent-blue)' }}>
            {alert.symbol}
          </span>
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {alert.name_zh}
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {alertDescription(alert)}
        </span>
        {alert.last_triggered && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            上次觸發：{String(alert.last_triggered).slice(0, 10)}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={deleting}
        onClick={handleDelete}
      >
        <span style={{ color: 'var(--accent-red)' }}>{deleting ? '…' : '刪除'}</span>
      </Button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const { data: session, status } = useSession();

  // Form state
  const [symbol,     setSymbol]     = useState('');
  const [alertType,  setAlertType]  = useState('price_below');
  const [threshold,  setThreshold]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError,  setFormError]  = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const { data: res, isLoading } = useSWR(
    session ? '/api/alerts' : null,
    fetcher,
  );

  const alerts: Alert[] = res?.data ?? [];
  const atLimit         = alerts.length >= 3;
  const selectedType    = ALERT_TYPES.find(t => t.value === alertType);

  const handleDelete = async (id: number) => {
    await mutate('/api/alerts');
  };

  const handleSubmit = async () => {
    setFormError('');
    setFormSuccess('');

    if (!symbol.trim()) { setFormError('請輸入股票代號'); return; }
    if (!alertType)      { setFormError('請選擇警示類型'); return; }
    if (selectedType?.needsThreshold && !threshold) {
      setFormError('請輸入門檻數值'); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol:     symbol.trim().toUpperCase(),
          alert_type: alertType,
          threshold:  threshold ? parseFloat(threshold) : null,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setFormError(json.error ?? '新增失敗');
      } else {
        setFormSuccess('警示已新增！');
        setSymbol('');
        setThreshold('');
        mutate('/api/alerts');
        setTimeout(() => setFormSuccess(''), 3000);
      }
    } catch {
      setFormError('網路錯誤，請重試');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading auth ───────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!session) return <LoginPrompt />;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              價格警示
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {session.user?.email}
            </p>
          </div>
          <Badge variant={atLimit ? 'red' : 'green'}>
            {alerts.length} / 3 個警示
          </Badge>
        </div>

        {/* ── Active alerts ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            目前警示
          </h2>
          {isLoading && <Skeleton className="h-20 w-full" />}
          {!isLoading && alerts.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
              尚未設定任何警示
            </p>
          )}
          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onDelete={handleDelete} />
          ))}
        </div>

        {/* ── New alert form ─────────────────────────────────────────────── */}
        <Card>
          <h2 className="mb-4 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            新增警示
          </h2>

          {atLimit ? (
            <div className="rounded-lg px-4 py-3 text-xs text-center"
              style={{ backgroundColor: 'rgba(245,183,0,0.08)', border: '1px solid rgba(245,183,0,0.25)', color: 'var(--accent-gold)' }}>
              ⭐ 已達免費方案上限（3 個）。<br />升級後可設定更多警示。
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Step 1: Symbol */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  第一步：輸入股票代號
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value.toUpperCase())}
                  placeholder="例：2330"
                  maxLength={10}
                  className="w-36 rounded-lg px-3 py-2 text-sm num"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              {/* Step 2: Alert type */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  第二步：選擇警示類型
                </label>
                {ALERT_TYPES.map(type => (
                  <label key={type.value} className="flex items-center gap-2 cursor-pointer text-sm"
                    style={{ color: alertType === type.value ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    <input
                      type="radio"
                      name="alert_type"
                      value={type.value}
                      checked={alertType === type.value}
                      onChange={() => { setAlertType(type.value); setThreshold(''); }}
                      style={{ accentColor: 'var(--accent-green)' }}
                    />
                    {type.label}
                  </label>
                ))}
              </div>

              {/* Step 3: Threshold (conditional) */}
              {selectedType?.needsThreshold && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    第三步：設定門檻
                    {alertType === 'price_above' || alertType === 'price_below'
                      ? '（NT$）'
                      : '（天數）'
                    }
                  </label>
                  <input
                    type="number"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    placeholder={alertType.includes('price') ? '例：850' : '例：5'}
                    className="w-36 rounded-lg px-3 py-2 text-sm num"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              )}

              {/* Errors / success */}
              {formError && (
                <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{formError}</p>
              )}
              {formSuccess && (
                <p className="text-xs" style={{ color: 'var(--accent-green)' }}>{formSuccess}</p>
              )}

              <Button
                variant="primary"
                size="md"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting ? '新增中…' : '送出'}
              </Button>
            </div>
          )}
        </Card>

        {/* ── Info note ──────────────────────────────────────────────────── */}
        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          警示觸發後將寄送 Email 通知至 {session.user?.email}
        </p>
      </div>
    </div>
  );
}
