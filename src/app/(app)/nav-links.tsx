'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 16px line icons, 1.5px stroke (.anh-nav svg); navigation only
const ICON = {
  dashboard: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  lease: 'M2 3h12M2 8h12M2 13h12M5 1v14',
  summary: 'M2 3h12v11H2zM2 6h12M5 1v3M11 1v3',
  analysis: 'M2 14V8M6 14V4M10 14V9M14 14V2',
  income: 'M8 2v12M2 8h12',
  pnl: 'M3 14V2h7v12M10 6h3v8M1 14h14M5 5h2M5 8h2M5 11h2',
  submissions: 'M3 8l3 3 7-7',
  admin: 'M2 4h12M2 8h12M2 12h12M5 2.5v3M11 6.5v3M7 10.5v3',
};

// reports first, then the input sheets
const BUDGET = [
  { href: '/', label: 'Dashboard', icon: ICON.dashboard },
  { href: '/pnl', label: 'Building P&L', icon: ICON.pnl },
  { href: '/summary', label: 'Monthly Summary', icon: ICON.summary },
  { href: '/analysis', label: 'Revenue Analysis', icon: ICON.analysis },
  { href: '/master', label: 'Lease Budget', icon: ICON.lease },
  { href: '/other-income', label: 'Other Income', icon: ICON.income },
];
const GOVERNANCE = [{ href: '/submissions', label: 'Submissions', icon: ICON.submissions }];
const ADMIN = { href: '/admin', label: 'Admin', icon: ICON.admin };

const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href));

export function NavLinks({ finance }: { finance: boolean }) {
  const path = usePathname();
  const link = (l: (typeof BUDGET)[number]) => (
    <Link key={l.href} href={l.href} aria-current={isActive(l.href, path) ? 'page' : undefined}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={l.icon} />
      </svg>
      {l.label}
    </Link>
  );
  return (
    <nav className="anh-nav">
      {BUDGET.map(link)}
      <span className="anh-eyebrow">Governance</span>
      {(finance ? [...GOVERNANCE, ADMIN] : GOVERNANCE).map(link)}
    </nav>
  );
}

/** Last crumb in the top bar: the current page. */
export function PageCrumb() {
  const path = usePathname();
  const page = [...BUDGET, ...GOVERNANCE, ADMIN].find((l) => isActive(l.href, path));
  return page ? <b>{page.label}</b> : null;
}
