import { and, eq, inArray, like, max } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { StoredCalc } from './calc';

/** First year the tool reports: Oracle's Revenue Recognition Summary and the GL imports start in Jan-2024. */
export const FIRST_REPORT_YEAR = 2024;

/**
 * Property-level comparatives a version reports against: current-year forecast and two years of
 * actuals; plus the prior-year budget when no prior budget version exists in the tool.
 */
export async function comparativeLabels(version: schema.BudgetVersion): Promise<string[]> {
  const y = version.year;
  const prior = await db.select({ id: schema.budgetVersions.id }).from(schema.budgetVersions).where(eq(schema.budgetVersions.year, y - 1));
  return [`${y - 1}F`, ...(prior.length ? [] : [`${y - 1}B`]), `${y - 2}A`, `${y - 3}A`];
}

/** Where a comparative comes from: Oracle revenue actuals, actuals + Lease Budget projection, or typed in. */
export type CompSource = 'actual' | 'forecast' | 'manual';
export interface CompValue {
  amount: number | null;
  source: CompSource;
}

/**
 * Comparatives per property for an open version. For properties in the Revenue Recognition Summary:
 * 20xxA = the year's recognised revenue; (Y-1)F = recognised revenue to the last actual month plus the
 * Lease Budget projection of the remaining months (the same leases and inputs as the budget, so it
 * moves with the property managers' decisions). Other properties, and locked versions, keep the
 * values typed in (Admin → Comparatives).
 */
export async function resolveComparatives(version: schema.BudgetVersion, labels: string[], propertyIds: number[]) {
  const ids = propertyIds.length ? propertyIds : [-1];
  const out = new Map<number, Record<string, CompValue>>();
  const stored = await db
    .select()
    .from(schema.comparatives)
    .where(and(eq(schema.comparatives.versionId, version.id), inArray(schema.comparatives.label, labels), inArray(schema.comparatives.propertyId, ids)));
  for (const id of ids) {
    const r: Record<string, CompValue> = {};
    for (const l of labels) r[l] = { amount: stored.find((c) => c.propertyId === id && c.label === l)?.amount ?? null, source: 'manual' };
    out.set(id, r);
  }
  if (version.status === 'LOCKED') return { values: out, lastActual: null };

  const y = version.year;
  const actualYears = labels.filter((l) => /^\d{4}A$/.test(l)).map((l) => l.slice(0, 4));
  const forecastLabel = labels.find((l) => l === `${y - 1}F`);
  const years = [...actualYears, ...(forecastLabel ? [String(y - 1)] : [])];
  if (!years.length) return { values: out, lastActual: null };

  const actuals = await db
    .select()
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), inArray(schema.revenueActuals.propertyId, ids), inArray(schema.revenueActuals.month, years.flatMap((yy) => monthsOf(yy)))));
  const [last] = await db
    .select({ m: max(schema.revenueActuals.month) })
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), like(schema.revenueActuals.month, `${y - 1}-%`)));
  const cutoff = last?.m ? Number(last.m.slice(5)) : 0; // last actual month of Y-1 (1–12), 0 = none

  const sum = new Map<string, number>(); // `${propertyId}|${year}` → actual
  const covered = new Map<string, boolean>();
  for (const a of actuals) {
    const k = `${a.propertyId}|${a.month.slice(0, 4)}`;
    sum.set(k, (sum.get(k) ?? 0) + a.amount);
    covered.set(k, true);
  }
  for (const yy of actualYears) {
    for (const id of ids) {
      if (covered.get(`${id}|${yy}`)) out.get(id)![`${yy}A`] = { amount: round(sum.get(`${id}|${yy}`) ?? 0), source: 'actual' };
    }
  }

  if (forecastLabel && cutoff > 0) {
    // projection of the months after the cut-off, from the Lease Budget lines of this version
    const lines = await db
      .select({ propertyId: schema.leaseLines.propertyId, calc: schema.leaseLines.calc })
      .from(schema.leaseLines)
      .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids)));
    const projected = new Map<number, number>();
    for (const l of lines) {
      const prior = (l.calc as StoredCalc | null)?.priorRevenue;
      if (!prior) continue;
      projected.set(l.propertyId, (projected.get(l.propertyId) ?? 0) + prior.slice(cutoff).reduce((s, v) => s + v, 0));
    }
    for (const id of ids) {
      if (!covered.get(`${id}|${y - 1}`)) continue;
      out.get(id)![forecastLabel] = { amount: round((sum.get(`${id}|${y - 1}`) ?? 0) + (projected.get(id) ?? 0)), source: 'forecast' };
    }
  }
  return { values: out, lastActual: last?.m ?? null };
}

const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const round = (n: number) => Math.round(n * 100) / 100;
