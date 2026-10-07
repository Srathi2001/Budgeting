// Unit-level data behind the dashboard. Filters (BU, PM, category, property) are applied in the
// browser, so every chart and tile re-renders against the same slice; the rent per sq ft card is
// computed here for the shared filters (the dashboard refreshes when they change).
import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { parseDay } from '@/lib/engine/dates';
import type { Contract } from '@/lib/engine/lease';
import type { Filters } from '@/lib/filters';
import type { StoredCalc } from './calc';
import { categoryOf, type Category } from './category';
import { locationOf } from './location';
import { buildRentPsf, type PsfLine, type RentPsf } from './rent-psf';

/** What follows a contract that falls due (a year already contracted in Oracle counts as Renew). */
export type ExpiryOutcome = 'Renew' | 'New tenant' | 'Not re-let';

/** A contract (current lease or a renewal) falling due: in the budget year, or already overdue. */
export interface DueEvent {
  /** month index 0–11 in the budget year; -1 = overdue (ended before today, no renewal on record) */
  month: number;
  outcome: ExpiryOutcome;
  /** annual rent of the contract falling due */
  rent: number;
  /** annual rent of the next contract (renewal or new tenant); null when not re-let */
  nextRent: number | null;
  /** new tenant: empty days between the lease ending and the new tenant */
  vacancyDays: number | null;
}

export interface DashUnit {
  unitId: number;
  propertyId: number;
  /** business unit name (labels) and code (filters) */
  bu: string;
  buCode: string;
  pm: string;
  category: Category;
  /** current-year budget revenue by month (null when not in this version) */
  revenue: number[] | null;
  /** prior-year budget revenue by month (null when not in the prior version) */
  prior: number[] | null;
  cashFlow: number[];
  leased: boolean;
  vacancyLoss: number;
  issues: number;
  /** contracts falling due in the budget year (and overdue ones) with what the budget assumes next */
  due: DueEvent[];
  /** new tenants moving in during the budget year after a lease: month index and annual rent */
  moveIns: { month: number; rent: number }[];
}

export interface DashProperty {
  id: number;
  code: string;
  name: string;
  bu: string;
  pm: string;
}

export interface DashboardData {
  year: number;
  versionName: string;
  priorName: string | null;
  units: DashUnit[];
  properties: DashProperty[];
  bus: string[];
  pms: string[];
  /** rent per sq ft card, for the shared page filters (computed here, not in the browser) */
  rentPsf: RentPsf;
}

const annual = (c: Contract) => (c.end >= c.start ? (c.rent * 365) / (c.end - c.start + 1) : 0);
const monthOf = (day: number) => new Date(day * 86_400_000);

/**
 * Contracts of a line that fall due in the budget year, or are already overdue, and what follows:
 * after the current lease, the PM's decision (renew / new tenant after the vacancy days / not re-let);
 * after a renewal, a further renewal unless marked No. A year already contracted in Oracle is a renewal.
 */
function dueEvents(d: DashUnit, l: schema.LeaseLine, contracts: Contract[], year: number, yearStart: number, today: number) {
  const order: Contract['kind'][] = ['CURRENT', 'RENEWAL1', 'RENEWAL2', 'RENEWAL3'];
  const byKind = new Map(contracts.map((k) => [k.kind, k]));
  order.forEach((kind, i) => {
    const c = byKind.get(kind);
    if (!c) return;
    const next = byKind.get(order[i + 1]);
    const endDate = monthOf(c.end);
    // overdue: the current lease has already ended and Oracle holds no renewal for it
    const overdue = kind === 'CURRENT' && c.end < today && c.end < yearStart && l.contracted === 0;
    const inYear = endDate.getUTCFullYear() === year;
    if (!inYear && !overdue) return;
    // from the decisions, not from whether the next contract falls inside the year (one ending on
    // 31 Dec renews into the next year)
    let outcome: ExpiryOutcome;
    if (i + 1 <= l.contracted) outcome = 'Renew';
    else if (kind === 'CURRENT') outcome = l.noRenewal ? 'Not re-let' : l.renew1 ? 'Renew' : 'New tenant';
    else outcome = (i === 1 ? l.r2Renew : i === 2 ? l.r3Renew : null) === false ? 'Not re-let' : 'Renew';
    d.due.push({
      month: inYear ? endDate.getUTCMonth() : -1,
      outcome,
      rent: annual(c),
      nextRent: next ? annual(next) : null,
      vacancyDays: outcome !== 'New tenant' ? null : next ? Math.max(next.start - c.end - 1, 0) : l.vacancyDays,
    });
  });
  // new tenants moving in this year after a lease (vacant units let for the first time are not counted)
  const cur = byKind.get('CURRENT');
  const r1 = byKind.get('RENEWAL1');
  if (cur && r1?.newTenant && monthOf(r1.start).getUTCFullYear() === year) d.moveIns.push({ month: monthOf(r1.start).getUTCMonth(), rent: annual(r1) });
}

export async function loadDashboardData(version: schema.BudgetVersion, propertyIds: number[], filters: Filters): Promise<DashboardData> {
  const ids = propertyIds.length ? propertyIds : [-1];
  const [prior] = await db
    .select()
    .from(schema.budgetVersions)
    .where(eq(schema.budgetVersions.year, version.year - 1))
    .orderBy(desc(schema.budgetVersions.status), desc(schema.budgetVersions.id))
    .limit(1);

  const props = await db
    .select({ p: schema.properties, bu: schema.businessUnits.name })
    .from(schema.properties)
    .innerJoin(schema.businessUnits, eq(schema.businessUnits.code, schema.properties.buCode))
    .where(inArray(schema.properties.id, ids));
  const propById = new Map(props.map((x) => [x.p.id, x]));

  const load = (versionId: number) =>
    db
      .select({ l: schema.leaseLines, u: schema.units })
      .from(schema.leaseLines)
      .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
      .where(and(eq(schema.leaseLines.versionId, versionId), inArray(schema.leaseLines.propertyId, ids)));

  const yearStart = parseDay(`${version.year}-01-01`)!;
  const today = parseDay(new Date().toISOString().slice(0, 10))!;
  const units = new Map<number, DashUnit>();
  const make = (u: schema.Unit, propertyId: number): DashUnit => {
    const pp = propById.get(propertyId)!;
    return {
      unitId: u.id,
      propertyId,
      bu: pp.bu,
      buCode: pp.p.buCode,
      pm: pp.p.coordinator ?? '—',
      category: categoryOf(u, pp.p.kind),
      revenue: null,
      prior: null,
      cashFlow: Array(12).fill(0),
      leased: false,
      vacancyLoss: 0,
      issues: 0,
      due: [],
      moveIns: [],
    };
  };

  const psfLines: PsfLine[] = [];
  for (const { l, u } of await load(version.id)) {
    const c = l.calc as StoredCalc | null;
    const d = make(u, l.propertyId);
    d.revenue = c?.revenue ?? Array(12).fill(0);
    d.cashFlow = c?.cashFlow ?? Array(12).fill(0);
    d.leased = !!l.currentEnd;
    d.vacancyLoss = c?.vacancyLoss ?? 0;
    d.issues = c?.warnings.length ?? 0;
    if (c && l.staffOwner !== 'OWNER') dueEvents(d, l, c.contracts, version.year, yearStart, today);
    units.set(u.id, d);
    // rent per sq ft: passing rent = the current contract, annualised (rent ÷ contract days × 365)
    const cur = c?.contracts.find((k) => k.kind === 'CURRENT');
    const pp = propById.get(l.propertyId)!;
    psfLines.push({
      propertyId: l.propertyId,
      propertyName: pp.p.name,
      buCode: pp.p.buCode,
      pm: d.pm,
      category: d.category,
      area: u.area && u.area > 0 ? u.area : 0,
      passing: l.vacant || !l.currentEnd || !cur ? 0 : annual(cur),
      leaseNumber: l.leaseNumber,
      unitType: (u.resiCommercial ?? u.unitType ?? '—').trim(),
      location: locationOf(pp.p),
    });
  }
  if (prior) {
    for (const { l, u } of await load(prior.id)) {
      const c = l.calc as StoredCalc | null;
      const d = units.get(u.id) ?? make(u, l.propertyId);
      d.prior = c?.revenue ?? Array(12).fill(0);
      units.set(u.id, d);
    }
  }

  const list = [...units.values()];
  return {
    year: version.year,
    versionName: version.name,
    priorName: prior?.name ?? null,
    units: list,
    properties: props.map(({ p, bu }) => ({ id: p.id, code: p.code, name: p.name, bu, pm: p.coordinator ?? '—' })),
    bus: [...new Set(props.map((x) => x.bu))].sort(),
    pms: [...new Set(props.map((x) => x.p.coordinator ?? '—'))].sort(),
    rentPsf: buildRentPsf(psfLines, filters),
  };
}
