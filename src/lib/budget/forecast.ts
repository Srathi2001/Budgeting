// The current-year rent forecast (2026F for the 2027 budget) read from the database: the one rule in
// forecast-rules.ts, used by Revenue Analysis, the Dashboard, the Lease Budget summary and the exports.
import 'server-only';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, schema } from '@/db';
import { withDefaults } from '@/lib/engine/assumptions';
import { perRequest } from '@/lib/request-memo';
import type { StoredCalc } from './calc';
import { buildForecast, type PropertyForecast } from './forecast-rules';
import { frozen } from './snapshot-store';

export interface PriorForecast {
  /** the forecast year (the budget year − 1) */
  year: number;
  /** e.g. 2026F */
  label: string;
  /** actuals to this month (1–12): the version's actuals cut-off */
  cutoff: number;
  properties: Map<number, PropertyForecast>;
  /** lease line → the forecast by month */
  lines: Map<number, number[]>;
}

const z12 = () => Array.from({ length: 12 }, () => 0);

/** the forecast as stored when a version is locked (version_snapshots) */
export interface ForecastSnapshot {
  year: number;
  label: string;
  cutoff: number;
  properties: PropertyForecast[];
  /** [line id, property id, months] */
  lines: [number, number, number[]][];
}

/** The current-year forecast of the properties (worked out once per request: request-memo.ts). */
export const loadPriorForecast = perRequest('forecast', (v: schema.BudgetVersion, ids: number[]) => `${v.id}|${v.status}|${ids.join(',')}`, priorForecastNow);

async function priorForecastNow(version: schema.BudgetVersion, propertyIds: number[]): Promise<PriorForecast> {
  // a locked version keeps the forecast it was approved with, whatever actuals arrive later
  const snap = await frozen<ForecastSnapshot>(version, 'forecast');
  if (snap) {
    const ids = new Set(propertyIds);
    return {
      year: snap.year,
      label: snap.label,
      cutoff: snap.cutoff,
      properties: new Map(snap.properties.filter((p) => ids.has(p.propertyId)).map((p) => [p.propertyId, p])),
      lines: new Map(snap.lines.filter(([, pid]) => ids.has(pid)).map(([id, , m]) => [id, m])),
    };
  }
  return liveForecast(version, propertyIds);
}

/** The forecast worked out from the actuals and the leases now (also what a snapshot stores). */
export async function liveForecast(version: schema.BudgetVersion, propertyIds: number[]): Promise<PriorForecast> {
  const year = version.year - 1;
  const cutoff = withDefaults(version.assumptions).actualsCutoffMonth;
  const ids = propertyIds.length ? propertyIds : [-1];
  const [rows, acts] = await Promise.all([
    db
      .select({ id: schema.leaseLines.id, unitId: schema.leaseLines.unitId, propertyId: schema.leaseLines.propertyId, calc: schema.leaseLines.calc })
      .from(schema.leaseLines)
      .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids))),
    db
      .select({ p: schema.revenueActuals.propertyId, m: schema.revenueActuals.month, a: schema.revenueActuals.amount })
      .from(schema.revenueActuals)
      // the year's months as a range (an index can serve it; LIKE 'YYYY-%' it can't)
      .where(and(eq(schema.revenueActuals.kind, 'A'), inArray(schema.revenueActuals.propertyId, ids), gte(schema.revenueActuals.month, `${year}-01`), lte(schema.revenueActuals.month, `${year}-12`))),
  ]);
  const actuals = new Map<number, Map<number, number>>();
  for (const x of acts) {
    const m = actuals.get(x.p) ?? new Map<number, number>();
    const mo = Number(x.m.slice(5));
    m.set(mo, (m.get(mo) ?? 0) + x.a);
    actuals.set(x.p, m);
  }
  const lines = rows.map((r) => ({ lineId: r.id, unitId: r.unitId, propertyId: r.propertyId, projection: (r.calc as StoredCalc | null)?.priorRevenue ?? z12() }));
  const { properties, lines: lineMonths } = buildForecast(lines, actuals, propertyIds, cutoff);
  return { year, label: `${year}F`, cutoff, properties, lines: lineMonths };
}
