// Small pieces shared by the Lease Budget grid and the row form.
import type { MasterRow } from '@/lib/budget/master-types';

export const OUTCOMES = ['Renew', 'New tenant', 'Not re-let'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** One decision per expiring lease, stored as the two engine flags. A vacant unit can't renew. */
export const outcomeOf = (r: Pick<MasterRow, 'renew1' | 'noRenewal' | 'currentEnd'>): Outcome =>
  r.noRenewal ? 'Not re-let' : r.renew1 && r.currentEnd ? 'Renew' : 'New tenant';
export const outcomePatch = (o: Outcome) => ({ renew1: o === 'Renew', noRenewal: o === 'Not re-let' });

/** A current lease going to a new tenant (not contracted, not owner): vacancy days are required. */
export const needsVacancyDays = (r: Pick<MasterRow, 'renew1' | 'noRenewal' | 'currentEnd' | 'contracted' | 'staffOwner'>) =>
  !!r.currentEnd && !r.contracted && r.staffOwner !== 'OWNER' && outcomeOf(r) === 'New tenant';

/** Current contract rent per year (a contract year can be longer or shorter than 12 months). */
export function annualRent(r: Pick<MasterRow, 'current'>): number | null {
  const c = r.current;
  if (!c?.start || !c.end) return null;
  const days = (Date.parse(c.end) - Date.parse(c.start)) / 86_400_000 + 1;
  return days > 0 ? (c.rent * 365) / days : null;
}

export const rentPsf = (r: Pick<MasterRow, 'current' | 'area'>) => {
  const a = annualRent(r);
  return a !== null && r.area ? a / r.area : null;
};

/** Where the lease stands against the budget year. */
export function leaseTiming(r: Pick<MasterRow, 'currentEnd'>, year: number, today = new Date().toISOString().slice(0, 10)) {
  const end = r.currentEnd;
  if (!end) return { kind: 'vacant' as const, decide: true };
  if (end > `${year}-12-31`) return { kind: 'beyond' as const, decide: false };
  if (end < today) return { kind: 'expired' as const, decide: true };
  return { kind: 'ends' as const, decide: true };
}

export const dmy = (v: string | null | undefined) => {
  if (!v) return '';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
