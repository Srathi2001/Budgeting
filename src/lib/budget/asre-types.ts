// ASRE (Arabian Spaces Real Estate): the mall operator, in the group as in the 2026 budget
// (ConsolidatedxRealEstate). It leases the Mall from REHL-MJN and lets it to the shop tenants; its
// budget comes from its own finance team and is entered in Admin → ASRE (blank until it arrives).
// Shared by the server and the Admin page.

export const ASRE = 'ASRE';

export interface AsreLine {
  key: string;
  label: string;
  /** where it shows in the statements: an atom line (rent, oi:<account>, exp:<expense line>) */
  atom: string;
  kind: 'income' | 'cost';
}

export const ASRE_LINES: AsreLine[] = [
  { key: 'revenue', label: 'Rent from the mall tenants', atom: 'rent', kind: 'income' },
  { key: 'otherIncome', label: 'Other income', atom: 'oi:52905', kind: 'income' },
  // eliminated against REHL-MJN's mall rent when both are in view (the 2026 consolidation did the same)
  { key: 'mallLease', label: 'Mall lease to REHL-MJN', atom: 'exp:mallLease', kind: 'cost' },
  { key: 'opex', label: 'Mall operating costs', atom: 'exp:asreOpex', kind: 'cost' },
  { key: 'ga', label: 'General & administration', atom: 'exp:adminOh', kind: 'cost' },
];
export const ASRE_LINE = new Map(ASRE_LINES.map((l) => [l.key, l]));
