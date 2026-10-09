// Tabs: routed page tabs (links, aria-current) and the in-card segmented toggle (buttons, aria-pressed).
'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

export interface RoutedTab {
  href: string;
  label: ReactNode;
  /** when set, the tab is current if this query param equals `value`; else by pathname */
  param?: { name: string; value: string | null };
}

export function RoutedTabs({ tabs, ariaLabel, className = '' }: { tabs: RoutedTab[]; ariaLabel: string; className?: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const current = (t: RoutedTab) => {
    if (t.param) return (sp.get(t.param.name) ?? null) === t.param.value;
    return path === t.href;
  };
  return (
    <nav className={`ui-tabs ${className}`} aria-label={ariaLabel}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(t) ? 'page' : undefined} className={current(t) ? 'is-current' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function SegmentToggle<T extends string>({ options, value, onChange, ariaLabel, size = 'md', className = '' }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={`ui-seg ui-seg--${size} ${className}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
