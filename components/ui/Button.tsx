import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'outline' | 'ghost';
type ButtonSize    = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7  px-3 text-xs',
  md: 'h-9  px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--accent-green)',
    color: 'var(--bg-primary)',
    border: 'none',
  },
  outline: {
    backgroundColor: 'transparent',
    color: 'var(--accent-green)',
    border: '1px solid var(--accent-green)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    border: 'none',
  },
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={variantStyles[variant]}
      className={cn(
        'inline-flex items-center justify-center rounded font-medium transition-opacity duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
