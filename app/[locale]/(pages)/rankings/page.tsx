'use client';

import { useState } from 'react';
import { ScannerResultsTable } from '@/components/kline/ScannerResultsTable';

const BORDER = '#1E2235';

const TABS = [
  { label: '起漲訊號', value: 'scanner'    },
  { label: '盤後選股', value: 'afterhours' },
];

const AFTERHOURS_TABS = [
  { label: '技術面走強', value: 'bull' },
  { label: '技術面走弱', value: 'bear' },
];

export default function RankingsPage() {
  const [activeTab,        setActiveTab]        = useState('scanner');
  const [afterhoursSubTab, setAfterhoursSubTab] = useState<'bull' | 'bear'>('bull');

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
            ⚡ 起漲雷達
          </h1>
          <p style={{ fontSize: 12, color: '#8B8FA8' }}>
            系統自動掃描全市場，找出具有突破潛力的股票
          </p>
        </div>

        {/* Main tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 20 }}>
          {TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: activeTab === tab.value ? '#fff' : '#8B8FA8',
                borderBottom: activeTab === tab.value ? '2px solid var(--accent-green)' : '2px solid transparent',
                background: 'transparent', marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scanner tab */}
        {activeTab === 'scanner' && (
          <ScannerResultsTable mode="scanner" />
        )}

        {/* After-hours tab */}
        {activeTab === 'afterhours' && (
          <div>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              {AFTERHOURS_TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setAfterhoursSubTab(t.value as 'bull' | 'bear')}
                  style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    borderRadius: 6,
                    color: afterhoursSubTab === t.value
                      ? (t.value === 'bull' ? '#FF4D6D' : '#00D4AA')
                      : '#8B8FA8',
                    background: afterhoursSubTab === t.value
                      ? (t.value === 'bull' ? '#FF4D6D22' : '#00D4AA22')
                      : 'transparent',
                    border: `1px solid ${afterhoursSubTab === t.value
                      ? (t.value === 'bull' ? '#FF4D6D44' : '#00D4AA44')
                      : BORDER}`,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ScannerResultsTable mode="afterhours" side={afterhoursSubTab} />
          </div>
        )}

      </div>
    </div>
  );
}
