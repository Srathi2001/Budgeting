// The navigation, in one place: groups → pages, who sees each, and the breadcrumb for a path.
// The rail, the drawer, the command palette and the top-bar breadcrumb all read this.

export type NavIcon = 'home' | 'dashboard' | 'lease' | 'income' | 'analysis' | 'fm' | 'boh' | 'adminOh' | 'summary' | 'pnl' | 'consolidated' | 'submissions' | 'imports' | 'admin';

export interface NavPage {
  href: string;
  label: string;
  icon: NavIcon;
  /** one line for the command palette and the Home page */
  hint: string;
  /** Finance (ADMIN / FINANCE) only */
  finance?: boolean;
  /** facilities management sees only pages marked fm */
  fm?: boolean;
}

export interface NavGroup {
  label: string;
  pages: NavPage[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    pages: [
      { href: '/', label: 'Home', icon: 'home', hint: 'What needs your attention in this version', fm: true },
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', hint: 'Revenue, occupancy, expiries and costs at a glance' },
    ],
  },
  {
    label: 'Revenue',
    pages: [
      { href: '/master', label: 'Lease Budget', icon: 'lease', hint: 'Unit-by-unit rent, renewals and cheques' },
      { href: '/other-income', label: 'Other Income', icon: 'income', hint: 'Parking, signage, penalties and the rest' },
      { href: '/analysis', label: 'Revenue Analysis', icon: 'analysis', hint: 'Budget against prior years by property and category' },
    ],
  },
  {
    label: 'Costs',
    pages: [
      { href: '/fm', label: 'FM Budget', icon: 'fm', hint: 'Maintenance and renewal works by facility', fm: true },
      { href: '/building-overheads', label: 'Building Overheads', icon: 'boh', hint: 'Utilities, insurance, service contracts per building' },
      { href: '/admin-overheads', label: 'Admin Overheads', icon: 'adminOh', hint: 'Head office cost and payroll (Finance)', finance: true },
    ],
  },
  {
    label: 'Statements',
    pages: [
      { href: '/summary', label: 'Monthly Summary', icon: 'summary', hint: 'Revenue and cash by month' },
      { href: '/pnl', label: 'Building P&L', icon: 'pnl', hint: 'Income less costs, building by building' },
      { href: '/consolidated', label: 'Consolidated', icon: 'consolidated', hint: 'Group view by entity' },
    ],
  },
  {
    label: 'Workflow',
    pages: [
      { href: '/submissions', label: 'Submissions', icon: 'submissions', hint: 'Submit, approve and return properties' },
      { href: '/imports', label: 'Imports', icon: 'imports', hint: 'Oracle extracts, GL actuals and templates (Finance)', finance: true },
    ],
  },
  {
    label: 'Admin',
    pages: [{ href: '/admin', label: 'Admin', icon: 'admin', hint: 'Versions, users, properties (Finance)', finance: true }],
  },
];

export interface NavViewer {
  finance: boolean;
  fm: boolean;
}

/** The groups a viewer sees, with pages they may open. FM sees Home and the FM budget only. */
export function navFor(v: NavViewer): NavGroup[] {
  return NAV.map((g) => ({ ...g, pages: g.pages.filter((p) => (v.fm ? p.fm : !p.finance || v.finance)) })).filter((g) => g.pages.length);
}

export const isActivePath = (href: string, path: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

/** Breadcrumb for a path: the group and the page, or null off the map. */
export function crumbFor(path: string): { group: string; page: NavPage } | null {
  for (const g of NAV) for (const p of g.pages) if (isActivePath(p.href, path)) return { group: g.label, page: p };
  if (path.startsWith('/design')) return { group: 'Admin', page: { href: '/design', label: 'Design preview', icon: 'admin', hint: 'Every shared component in both themes', finance: true } };
  return null;
}
