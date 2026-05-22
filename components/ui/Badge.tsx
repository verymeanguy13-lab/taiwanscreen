import { cn } from '@/lib/utils';

type BadgeVariant = 'green' | 'red' | 'gold' | 'blue' | 'grey';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  green: { color: 'var(--accent-green)', backgroundColor: 'rgba(0,212,170,0.12)', border: '1px solid rgba(0,212,170,0.25)' },
  red:   { color: 'var(--accent-red)',   backgroundColor: 'rgba(255,77,109,0.12)', border: '1px solid rgba(255,77,109,0.25)' },
  gold:  { color: 'var(--accent-gold)',  backgroundColor: 'rgba(245,183,0,0.12)',  border: '1px solid rgba(245,183,0,0.25)' },
  blue:  { color: 'var(--accent-blue)',  backgroundColor: 'rgba(61,142,248,0.12)', border: '1px solid rgba(61,142,248,0.25)' },
  grey:  { color: 'var(--text-secondary)', backgroundColor: 'rgba(139,143,168,0.12)', border: '1px solid rgba(139,143,168,0.25)' },
};

export function Badge({ children, variant = 'grey', className }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={variantStyles[variant]}
    >
      {children}
    </span>
  );
}
