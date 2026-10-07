// Budget-year amounts by entity and group class, for the group statements (Monthly Summary). Each
// amount is an "atom": a statement line, the entity it belongs to, how it counts for the group, and
// 12 monthly values (positive; the line says whether it is income, cost, cash in or cash out).
import 'server-only';
import type { PropertyRollup, OiMonthly } from './reports';
import type { PropertyExpense } from './expenses';
import { INTERGROUP, classifyOtherIncome, classifyRent, isMall, type EntityKey, type GroupClass } from './group';

export interface Atom {
  /** rent | oi:<account> | exp:<expense line> | cash:rent | cash:vat | cash:depositIn | cash:depositOut | cash:oi | cash:exp:<expense line> */
  line: string;
  entity: EntityKey;
  cls: GroupClass;
  months: number[];
}

/** the mirrored intergroup cost: an expense line of the payers */
export const PMA_EXPENSE = { key: 'pma', label: 'PMA fee to ANPM' };

const entityOf = (buCode: string, propertyCode: string | null): EntityKey => (isMall(propertyCode) ? 'MALL' : (buCode as EntityKey));

export function groupAtoms(rolls: PropertyRollup[], oi: OiMonthly[], costs: PropertyExpense[] = []): Atom[] {
  const atoms: Atom[] = [];
  // building costs count for the group as the building's rent does (PMC buildings: the owners')
  for (const c of costs) {
    const entity = entityOf(c.buCode, c.code);
    const cls = classifyRent(c.buCode);
    atoms.push({ line: `exp:${c.line}`, entity, cls, months: c.months }, { line: `cash:exp:${c.line}`, entity, cls, months: c.months });
  }
  for (const r of rolls) {
    const entity = entityOf(r.buCode, r.code);
    const cls = classifyRent(r.buCode);
    atoms.push(
      { line: 'rent', entity, cls, months: r.revenue },
      { line: 'cash:rent', entity, cls, months: r.cash },
      { line: 'cash:vat', entity, cls, months: r.vat },
      { line: 'cash:depositIn', entity, cls, months: r.depositIn },
      { line: 'cash:depositOut', entity, cls, months: r.depositOut },
    );
  }
  for (const o of oi) {
    const entity = entityOf(o.buCode, o.propertyCode);
    const cls = classifyOtherIncome(o.scope, o.buCode, o.account);
    atoms.push({ line: `oi:${o.account}`, entity, cls, months: o.months }, { line: 'cash:oi', entity, cls, months: o.months });
  }

  // intergroup income: its payers carry the same amount as a cost, split by their group rent
  for (const rule of INTERGROUP) {
    const income = oi.filter((o) => o.scope === rule.scope && o.account === rule.account);
    if (!income.length) continue;
    const months = Array.from({ length: 12 }, (_, i) => income.reduce((s, o) => s + o.months[i], 0));
    const rentBy = new Map<EntityKey, number>();
    for (const a of atoms)
      if (a.line === 'rent' && a.cls === 'group' && rule.payers.includes(a.entity === 'MALL' ? '502' : a.entity))
        rentBy.set(a.entity, (rentBy.get(a.entity) ?? 0) + a.months.reduce((s, v) => s + v, 0));
    const total = [...rentBy.values()].reduce((s, v) => s + v, 0);
    const payers = total > 0 ? [...rentBy.entries()] : rule.payers.map((p) => [p as EntityKey, 1] as const);
    const base = total > 0 ? total : payers.length;
    for (const [entity, w] of payers) {
      const share = months.map((v) => (v * w) / base);
      atoms.push({ line: `exp:${PMA_EXPENSE.key}`, entity, cls: 'intergroup', months: share }, { line: `cash:exp:${PMA_EXPENSE.key}`, entity, cls: 'intergroup', months: share });
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
