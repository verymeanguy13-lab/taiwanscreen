'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Zap, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

const NAV_LINKS = [
  { key: 'dazhang',      href: '/dazhang'      },
  { key: 'rankings',     href: '/rankings'     },
  { key: 'rankings',     href: '/rankings'     },
  { key: 'screener',     href: '/screener'     },
  { key: 'heatmap',      href: '/heatmap'      },
  { key: 'institutional',href: '/institutional' },
  { key: 'broker',       href: '/broker'        },
  { key: 'margin',       href: '/margin'        },
  { key: 'etf',          href: '/etf'           },
  { key: 'dividend',     href: '/dividend'      },
  { key: 'supplyChain',  href: '/supply-chain'  },
  { key: 'backtest',     href: '/backtest'      },
  { key: 'watchlist',    href: '/watchlist'     },
];

export default function Navbar() {
  const t        = useTranslations('nav');
  const pathname = usePathname();
  const router   = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentLocale = pathname.startsWith('/en') ? 'en' : 'zh';

  const handleLangToggle = () => {
    const nextLocale = currentLocale === 'zh' ? 'en' : 'zh';
    const newPath = pathname.replace(/^\/(zh|en)/, `/${nextLocale}`);
    router.push(newPath);
  };

  const isActive = (href: string) => {
    const stripped = pathname.replace(/^\/(zh|en)/, '');
    return stripped === href || stripped.startsWith(href + '/');
  };

  return (
    <header
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
      }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-4">

        {/* ── Logo ── */}
        <Link href={`/${currentLocale}`} className="flex shrink-0 items-center gap-2">
          <Zap size={20} strokeWidth={2.5} style={{ color: 'var(--accent-green)' }} />
          <span className="text-base font-bold tracking-wide" style={{ color: 'var(--text-primary)' }}>
            台股雷達
          </span>
        </Link>

        {/* ── Center nav (desktop) ── */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ key, href }) => (
            <Link
              key={href}
              href={`/${currentLocale}${href}`}
              className="rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150"
              style={{
                color: isActive(href) ? 'var(--accent-green)' : 'var(--text-secondary)',
              }}
              onMouseEnter={e => {
                if (!isActive(href))
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                if (!isActive(href))
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
              }}
            >
              {t(key)}
            </Link>
          ))}
        </nav>

        {/* ── Right side ── */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleLangToggle}
            className="hidden md:inline-flex h-8 w-10 items-center justify-center rounded text-xs font-semibold transition-colors duration-150"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
          >
            {currentLocale === 'zh' ? 'EN' : '中'}
          </button>

          <Link
            href={`/${currentLocale}/login`}
            className="hidden md:inline-flex h-8 items-center justify-center rounded px-3 text-sm font-medium transition-colors duration-150"
            style={{ color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'var(--accent-blue)';
              el.style.color = 'var(--bg-primary)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = 'transparent';
              el.style.color = 'var(--accent-blue)';
            }}
          >
            {t('login')}
          </Link>

          <button
            className="flex md:hidden items-center justify-center rounded p-1.5"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => setMobileOpen(prev => !prev)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* ── Mobile dropdown ── */}
      {mobileOpen && (
        <div
          className="md:hidden border-t px-4 pb-4 pt-2"
          style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border)' }}
        >
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map(({ key, href }) => (
              <Link
                key={href}
                href={`/${currentLocale}${href}`}
                onClick={() => setMobileOpen(false)}
                className="rounded px-3 py-2 text-sm font-medium transition-colors duration-150"
                style={{
                  color: isActive(href) ? 'var(--accent-green)' : 'var(--text-secondary)',
                }}
              >
                {t(key)}
              </Link>
            ))}
          </nav>

          <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => { handleLangToggle(); setMobileOpen(false); }}
              className="h-8 w-10 rounded text-xs font-semibold"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              {currentLocale === 'zh' ? 'EN' : '中'}
            </button>
            <Link
              href={`/${currentLocale}/login`}
              onClick={() => setMobileOpen(false)}
              className="h-8 rounded px-3 text-sm font-medium"
              style={{ color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' }}
            >
              {t('login')}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
