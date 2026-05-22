import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Format a number as NTD currency.
 * >= 1,000,000,000,000 → "NT$X.X兆"
 * >= 100,000,000       → "NT$X.X億"
 * otherwise            → "NT$X,XXX"
 */
export function formatNTD(n: number): string {
  if (n >= 1_000_000_000_000) {
    return `NT$${(n / 1_000_000_000_000).toFixed(1)}兆`;
  }
  if (n >= 100_000_000) {
    return `NT$${(n / 100_000_000).toFixed(1)}億`;
  }
  return `NT$${n.toLocaleString('en-US')}`;
}

/**
 * Format a number as a percentage with explicit sign.
 * e.g. 2.34 → "+2.34%", -1.2 → "-1.20%"
 */
export function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Format a volume number.
 * >= 10,000 → "X.X萬張"
 * otherwise → "X,XXX張"
 */
export function formatVolume(n: number): string {
  if (n >= 10_000) {
    return `${(n / 10_000).toFixed(1)}萬張`;
  }
  return `${n.toLocaleString('en-US')}張`;
}

/**
 * Format a change value as a percentage string with its associated CSS color.
 * positive → accent-green
 * negative → accent-red
 * zero     → text-secondary
 */
export function formatChange(n: number): { value: string; color: string } {
  if (n > 0) {
    return { value: formatPct(n), color: 'var(--accent-green)' };
  }
  if (n < 0) {
    return { value: formatPct(n), color: 'var(--accent-red)' };
  }
  return { value: formatPct(n), color: 'var(--text-secondary)' };
}

/**
 * Merge Tailwind class names safely using clsx + tailwind-merge.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}