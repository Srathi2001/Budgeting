'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 16px line icons, 1.5px stroke (.anh-nav svg); navigation only
const ICON = {
  dashboard: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  lease: 'M2 3h12M2 8h12M2 13h12M5 1v14',
  summary: 'M2 3h12v11H2zM2 6h12M5 1v3M11 1v3',
  consolidated: 'M2 2h12v12H2zM2 6h12M2 10h12M8 6v8',
  analysis: 'M2 14V8M6 14V4M10 14V9M14 14V2',
  income: 'M8 2v12M2 8h12',
  pnl: 'M3 14V2h7v12M10 6h3v8M1 14h14M5 5h2M5 8h2M5 11h2',
  fm: 'M10 2a4 4 0 0 0-3.8 5.2L2 11.4V14h2.6l4.2-4.2A4 4 0 1 0 10 2z',
  boh: 'M2 14V6l6-4 6 4v8H2zM6 14V9h4v5',
  adminOh: 'M2 5h12v9H2zM6 5V3h4v2M2 9h12',
  submissions: 'M3 8l3 3 7-7',
  admin: 'M2 4h12M2 8h12M2 12h12M5 2.5v3M11 6.5v3M7 10.5v3',
};

// reports first, then the input sheets
const BUDGET = [
  { href: '/', label: 'Dashboard', icon: ICON.dashboard },
  { href: '/pnl', label: 'Building P&L', icon: ICON.pnl },
  { href: '/summary', label: 'Monthly Summary', icon: ICON.summary },
  { href: '/consolidated', label: 'Consolidated', icon: ICON.consolidated },
  { href: '/analysis', label: 'Revenue Analysis', icon: ICON.analysis },
  { href: '/master', label: 'Lease Budget', icon: ICON.lease },
  { href: '/other-income', label: 'Other Income', icon: ICON.income },
];
const COSTS = [{ href: '/fm', label: 'FM Budget', icon: ICON.fm }];
// not for facilities management, who work in the FM budget only
const BOH = { href: '/building-overheads', label: 'Building Overheads', icon: ICON.boh };
// Finance only: it holds payroll
const ADMIN_OH = { href: '/admin-overheads', label: 'Admin Overheads', icon: ICON.adminOh };
const GOVERNANCE = [{ href: '/submissions', label: 'Submissions', icon: ICON.submissions }];
const ADMIN = { href: '/admin', label: 'Admin', icon: ICON.admin };

// a page and its sub-pages (/admin is not active on /admin-overheads)
const isActive = (href: string, path: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

export function NavLinks({ finance, fm }: { finance: boolean; fm: boolean }) {
  const path = usePathname();
  const link = (l: (typeof BUDGET)[number]) => (
    <Link key={l.href} href={l.href} aria-current={isActive(l.href, path) ? 'page' : undefined}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={l.icon} />
      </svg>
      {l.label}
    </Link>
  );
  // facilities management works in the FM budget only
  if (fm) return <nav className="anh-nav">{COSTS.map(link)}</nav>;
  return (
    <nav className="anh-nav">
      {BUDGET.map(link)}
      <span className="anh-eyebrow">Costs</span>
      {(finance ? [BOH, ADMIN_OH, ...COSTS] : [BOH, ...COSTS]).map(link)}
      <span className="anh-eyebrow">Governance</span>
      {(finance ? [...GOVERNANCE, ADMIN] : GOVERNANCE).map(link)}
    </nav>
  );
}

/** Last crumb in the top bar: the current page. */
export function PageCrumb() {
  const path = usePathname();
  const page = [...BUDGET, BOH, ADMIN_OH, ...COSTS, ...GOVERNANCE, ADMIN].find((l) => isActive(l.href, path));
  return page ? <b>{page.label}</b> : null;
}
