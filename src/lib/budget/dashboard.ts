// Unit-level data behind the dashboard. Filters (BU, PM, category, property) are applied in the
// browser, so every chart and tile re-renders against the same slice.
import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { parseDay } from '@/lib/engine/dates';
import type { StoredCalc } from './calc';
import { categoryOf, type Category } from './category';

export type ExpiryOutcome = 'Renew' | 'New tenant' | 'Not re-let';

export interface DashUnit {
  unitId: number;
  propertyId: number;
  bu: string;
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
  /** month index (0-11) of the current lease expiry when it falls in the budget year */
  expiryMonth: number | null;
  expiryRent: number;
  expiryOutcome: ExpiryOutcome | null;
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
}

export async function loadDashboardData(version: schema.BudgetVersion, propertyIds: number[]): Promise<DashboardData> {
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
  const units = new Map<number, DashUnit>();
  const make = (u: schema.Unit, propertyId: number): DashUnit => {
    const pp = propById.get(propertyId)!;
    return {
      unitId: u.id,
      propertyId,
      bu: pp.bu,
      pm: pp.p.coordinator ?? '—',
      category: categoryOf(u, pp.p.kind),
      revenue: null,
      prior: null,
      cashFlow: Array(12).fill(0),
      leased: false,
      vacancyLoss: 0,
      issues: 0,
      expiryMonth: null,
      expiryRent: 0,
      expiryOutcome: null,
    };
  };

  for (const { l, u } of await load(version.id)) {
    const c = l.calc as StoredCalc | null;
    const d = make(u, l.propertyId);
    d.revenue = c?.revenue ?? Array(12).fill(0);
    d.cashFlow = c?.cashFlow ?? Array(12).fill(0);
    d.leased = !!l.currentEnd;
    d.vacancyLoss = c?.vacancyLoss ?? 0;
    d.issues = c?.warnings.length ?? 0;
    const end = parseDay(l.currentEnd);
    if (end !== null && end >= yearStart) {
      const m = new Date(end * 86_400_000).getUTCMonth();
      const y = new Date(end * 86_400_000).getUTCFullYear();
      if (y === version.year) {
        d.expiryMonth = m;
        d.expiryRent = l.currentRent ?? 0;
        d.expiryOutcome = l.noRenewal ? 'Not re-let' : l.renew1 ? 'Renew' : 'New tenant';
      }
    }
    units.set(u.id, d);
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
  };
}
