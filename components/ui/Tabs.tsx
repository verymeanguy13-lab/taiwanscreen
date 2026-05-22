'use client';

interface Tab {
  label: string;
  value: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (value: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div
      className="flex items-end gap-0 overflow-x-auto"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {tabs.map(({ label, value }) => {
        const isActive = value === activeTab;
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className="relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors duration-150 focus:outline-none"
            style={{
              color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)',
              borderBottom: isActive
                ? '2px solid var(--accent-green)'
                : '2px solid transparent',
              marginBottom: '-1px',
            }}
            onMouseEnter={e => {
              if (!isActive)
                (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              if (!isActive)
                (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
