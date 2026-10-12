// Budget-year amounts by entity and group class, for the group statements (Monthly Summary, Consolidated).
// Each amount is an "atom": a statement line, the entity it belongs to, how it counts for the group, and
// 12 monthly values (positive; the line says whether it is income, cost, cash in or cash out).
//
// Intergroup flows, as the 2026 budget (PnLxREHLxANPM):
// - ANPM's PMA fee: a cost of each landlord (REHL, REHL-MJN, the Mall) on its rent, and ANPM's income.
// - ANPM's recharges: the FM staff and the watchmen are ANPM's staff; the buildings carry their cost, ANPM
//   shows the recharge as income and the staff cost as its own.
// Both sides are eliminated when both are in view (ANPM and the paying landlord); a side alone stays a plain
// income or cost of its entity. What the PMC owners pay ANPM is ANPM's income from outside the group.
// VAT is not in the cash flow: it passes through to the FTA (as the 2026 budget).
import 'server-only';
import type { PropertyRollup, OiMonthly } from './reports';
import type { PropertyExpense } from './expenses';
import type { EntityCost } from './admin';
import { LANDLORDS, PMA_FEE, quarterlyCash, classifyOtherIncome, classifyRent, entityOf, type EntityKey, type GroupClass } from './group';

export interface Atom {
  /** rent | oi:<account> | exp:<expense line> | cash:rent | cash:depositIn | cash:depositOut | cash:oi | cash:exp:<expense line> */
  line: string;
  entity: EntityKey;
  cls: GroupClass;
  months: number[];
}

/** the mirrored intergroup cost: an expense line of the payers */
export const PMA_EXPENSE = { key: 'pma', label: 'PMA fee to ANPM' };

/** ANPM's staff recharged to the buildings at cost (2026 budget rows 10–11), as other income lines of ANPM */
export const RECHARGES = [
  { code: 'RCH-FM', line: 'fmStaff', name: 'FM staff recharge' },
  { code: 'RCH-WM', line: 'watchmen', name: 'Watchman recharge' },
] as const;
export const RECHARGED_LINES: string[] = RECHARGES.map((r) => r.line);

/** what the intergroup flows need, whatever the page selection */
export interface Intergroup {
  /** ANPM (521) is in view: its PMA fee income and the recharges show */
  anpm: boolean;
  /** the PMA fee charged to each landlord, by month, and that landlord's rent for the year (the fee follows the rent) */
  pma: { entity: EntityKey; months: number[]; rent: number }[];
  /** FM staff and watchmen cost of every building (all of them, not only those in view): what ANPM recharges */
  recharged: PropertyExpense[];
}

const z12 = () => Array.from({ length: 12 }, () => 0);
const isLandlord = (e: string) => (LANDLORDS as readonly string[]).includes(e);

export function groupAtoms(rolls: PropertyRollup[], oi: OiMonthly[], costs: PropertyExpense[] = [], entityCosts: EntityCost[] = [], ig: Intergroup = { anpm: false, pma: [], recharged: [] }): Atom[] {
  const atoms: Atom[] = [];
  const push = (line: string, entity: EntityKey, cls: GroupClass, months: number[], cash: number[] | null = months) => {
    if (!months.some((v) => v) && !cash?.some((v) => v)) return;
    atoms.push({ line, entity, cls, months });
    if (cash) atoms.push({ line: line.startsWith('oi:') ? 'cash:oi' : `cash:${line}`, entity, cls, months: cash });
  };

  // general & administration of the companies (ANPM payroll and admin overheads, the AMA fee)
  for (const c of entityCosts) push(`exp:${c.line}`, c.entity, classifyRent(c.entity === 'MALL' ? '502' : c.entity), c.months, c.cash ?? c.months);

  // building costs count for the group as the building's rent does (PMC buildings: the owners'); a
  // landlord's FM staff and watchmen are ANPM's recharge, intergroup when ANPM is in view
  const inView = new Set<string>();
  for (const c of costs) {
    const entity = entityOf(c.buCode, c.code) as EntityKey;
    let cls = classifyRent(c.buCode);
    if (ig.anpm && RECHARGED_LINES.includes(c.line) && cls === 'group' && isLandlord(entity)) cls = 'intergroup';
    if (RECHARGED_LINES.includes(c.line)) inView.add(`${c.propertyId}|${c.line}`);
    // the cash flow takes the cash months where they differ (premiums paid upfront)
    push(`exp:${c.line}`, entity, cls, c.months, c.cash ?? c.months);
  }

  // rent: the property's entity; the PMA fee on it, as the landlord's cost
  const pmaInView = new Map<EntityKey, number[]>();
  for (const r of rolls) {
    const entity = entityOf(r.buCode, r.code) as EntityKey;
    const cls = classifyRent(r.buCode);
    push('rent', entity, cls, r.revenue, null);
    atoms.push(
      { line: 'cash:rent', entity, cls, months: r.cash },
      { line: 'cash:depositIn', entity, cls, months: r.depositIn },
      { line: 'cash:depositOut', entity, cls, months: r.depositOut },
    );
    const fee = ig.pma.find((p) => p.entity === entity);
    if (!fee || fee.rent <= 0 || cls !== 'group') continue;
    const total = fee.months.reduce((s, v) => s + v, 0);
    const share = r.revenue.map((v) => (total * v) / fee.rent);
    // paid quarterly in advance (Jan, Apr, Jul, Oct), as the 2026 budget; the expense stays monthly
    push(`exp:${PMA_EXPENSE.key}`, entity, ig.anpm ? 'intergroup' : 'group', share, quarterlyCash(share, 'advance'));
    const acc = pmaInView.get(entity) ?? z12();
    share.forEach((v, i) => (acc[i] += v));
    pmaInView.set(entity, acc);
  }

  // other income (the PMA fee row is built below, from the landlords)
  for (const o of oi) {
    if (o.scope === PMA_FEE.scope && o.account === PMA_FEE.account) continue;
    push(`oi:${o.account}`, entityOf(o.buCode, o.propertyCode) as EntityKey, classifyOtherIncome(o.scope, o.buCode, o.account), o.months, o.cash ?? o.months);
  }

  if (ig.anpm) {
    // ANPM's PMA fee income: what the landlords in view pay is intergroup, the rest is ANPM's plain income
    for (const fee of ig.pma) {
      const seen = pmaInView.get(fee.entity) ?? z12();
      // received when the landlords pay it (quarterly in advance), so the two sides net to nil in the group
      push(`oi:${PMA_FEE.account}`, '521', 'intergroup', seen, quarterlyCash(seen, 'advance'));
      const rest = fee.months.map((v, i) => v - seen[i]);
      push(`oi:${PMA_FEE.account}`, '521', 'group', rest, quarterlyCash(rest, 'advance'));
    }
    // ANPM's recharges: income from each building, and the staff cost ANPM carries
    for (const rc of RECHARGES) {
      const staff = z12();
      const byCls = new Map<GroupClass, number[]>();
      for (const c of ig.recharged) {
        if (c.line !== rc.line) continue;
        c.months.forEach((v, i) => (staff[i] += v));
        const payer = entityOf(c.buCode, c.code);
        const cls: GroupClass = classifyRent(c.buCode) === 'group' && isLandlord(payer) && inView.has(`${c.propertyId}|${c.line}`) ? 'intergroup' : 'group';
        const acc = byCls.get(cls) ?? z12();
        c.months.forEach((v, i) => (acc[i] += v));
        byCls.set(cls, acc);
      }
      for (const [cls, months] of byCls) push(`oi:${rc.code}`, '521', cls, months);
      push(`exp:${rc.line}`, '521', 'group', staff);
    }
  }
  return atoms;
}

/** Sum of the atoms that match, by month. */
export function sumAtoms(atoms: Atom[], match: (a: Atom) => boolean): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  for (const a of atoms) if (match(a)) for (let i = 0; i < 12; i++) out[i] += a.months[i];
  return out;
}
