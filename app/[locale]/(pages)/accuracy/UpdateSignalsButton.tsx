'use client';

import { useState, useEffect } from 'react';

export default function UpdateSignalsButton() {
  const [status,  setStatus]  = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setStatus('更新中...');
    try {
      const res = await fetch('/api/admin/update-signals', {
        method: 'POST',
      });
      const data = await res.json();
      if (data.error) {
        setStatus(`錯誤: ${data.error}`);
      } else {
        setStatus(`完成 — 新訊號: ${data.results.newSignals}, 5日: ${data.results.updated5d}, 10日: ${data.results.updated10d}, 20日: ${data.results.updated20d}`);
      }
    } catch (err) {
      setStatus(`失敗: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []);

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
        {loading ? '更新中...' : '🔧 重新更新訊號準確率'}
      </button>
      {status && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{status}</p>
      )}
    </div>
  );
}