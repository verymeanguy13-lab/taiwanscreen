'use client';

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({ options, value, onChange, placeholder, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className}
      style={{
        backgroundColor: 'var(--bg-card)',
        color: value ? 'var(--text-primary)' : 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: '0.375rem',
        padding: '0.375rem 2rem 0.375rem 0.75rem',
        fontSize: '0.875rem',
        height: '2.25rem',
        width: '100%',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238B8FA8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.625rem center',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map(({ label, value: optVal }) => (
        <option
          key={optVal}
          value={optVal}
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
        >
          {label}
        </option>
      ))}
    </select>
  );
}
