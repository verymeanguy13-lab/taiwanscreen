'use client';

import { useState } from 'react';

export default function UpdateSignalsButton() {
  const [status,  setStatus]  = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const secret = prompt('Enter cron secret:');
    if (!secret) return;
    setLoading(true);
    setStatus('Running...');
    try {
      const res = await fetch('/api/admin/update-signals', {
        method: 'POST',
        headers: { 'x-cron-secret': secret },
      });
      const data = await res.json();
      if (data.error) {
        setStatus(`Error: ${data.error}`);
      } else {
        setStatus(`Done — new: ${data.results.newSignals}, 5d: ${data.results.updated5d}, 10d: ${data.results.updated10d}, 20d: ${data.results.updated20d}`);
      }
    } catch (err) {
      setStatus(`Failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={run}
        disabled={loading}
        className="rounded px-4 py-2 text-xs font-medium"
        style={{
          backgroundColor: loading ? 'var(--bg-secondary)' : 'var(--accent-blue)',
          color: loading ? 'var(--text-muted)' : '#fff',
          border: '1px solid var(--border)',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? '更新中...' : '🔧 更新訊號準確率'}
      </button>
      {status && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{status}</p>
      )}
    </div>
  );
}