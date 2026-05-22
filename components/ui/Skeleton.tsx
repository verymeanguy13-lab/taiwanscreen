import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded', className)}
      style={{ backgroundColor: 'var(--border)' }}
    />
  );
}

interface SkeletonTableProps {
  rows: number;
  cols: number;
}

export function SkeletonTable({ rows, cols }: SkeletonTableProps) {
  return (
    <div className="w-full overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
      {/* Header row */}
      <div
        className="grid gap-3 px-4 py-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          backgroundColor: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-3/4" />
        ))}
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="grid gap-3 px-4 py-3"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            backgroundColor: rowIdx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
            borderBottom: rowIdx < rows - 1 ? '1px solid var(--border)' : 'none',
          }}
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton
              key={colIdx}
              className="h-3"
              style={{ width: colIdx === 0 ? '60%' : `${60 + Math.random() * 30}%` } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
