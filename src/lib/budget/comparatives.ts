import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadPriorForecast } from './forecast';
import { frozen } from './snapshot-store';
import { priorVersion } from './prior-version';

/** First year the tool reports by default (Oracle's Revenue Recognition Summary and the GL imports start in Jan-2024): a mapping, Admin → Mappings (settings.ts) */
export const FIRST_REPORT_YEAR = 2024;

/**
 * Property-level comparatives a version reports against: current-year forecast and two years of
 * actuals; plus the prior-year budget when no prior budget version exists in the tool.
 */
export async function comparativeLabels(version: schema.BudgetVersion): Promise<string[]> {
  const y = version.year;
  const prior = await priorVersion(version);
  return [`${y - 1}F`, ...(prior ? [] : [`${y - 1}B`]), `${y - 2}A`, `${y - 3}A`];
}

/**
 * Where a comparative comes from: Oracle revenue actuals, actuals + Lease Budget projection, the Lease
 * Budget projection alone (a property without Oracle actuals), or typed in.
 */
export type CompSource = 'actual' | 'forecast' | 'projection' | 'manual';
export interface CompValue {
  amount: number | null;
  source: CompSource;
}

/**
 * Comparatives per property for an open version. 20xxA = the year's revenue recognised in Oracle
 * (Revenue Recognition Summary); other properties keep the values typed in (Admin → Comparatives).
 * (Y-1)F = the one current-year forecast (forecast.ts): actuals to the cut-off month, then the leases
 * as they run and the property managers' inputs; a property without Oracle actuals is projected for
 * the whole year. Locked versions keep the values typed in.
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
  if (version.status === 'LOCKED') {
    // the values the version was locked with (typed ones stay where nothing was frozen)
    const snap = await frozen<ComparativesSnapshot>(version, 'comparatives');
    if (!snap) return { values: out, lastActual: null };
    for (const id of ids) for (const l of labels) if (snap.values[id]?.[l]) out.get(id)![l] = snap.values[id][l];
    return { values: out, lastActual: snap.lastActual };
  }
  return live(version, labels, ids, propertyIds, out);
}

/** the comparatives as stored when a version is locked (version_snapshots) */
export interface ComparativesSnapshot {
  labels: string[];
  values: Record<number, Record<string, CompValue>>;
  lastActual: string | null;
}

async function live(version: schema.BudgetVersion, labels: string[], ids: number[], propertyIds: number[], out: Map<number, Record<string, CompValue>>) {

  const y = version.year;
  const actualYears = labels.filter((l) => /^\d{4}A$/.test(l)).map((l) => l.slice(0, 4));
  const forecastLabel = labels.find((l) => l === `${y - 1}F`);

  if (actualYears.length) {
    const actuals = await db
      .select()
      .from(schema.revenueActuals)
      .where(and(eq(schema.revenueActuals.kind, 'A'), inArray(schema.revenueActuals.propertyId, ids), inArray(schema.revenueActuals.month, actualYears.flatMap((yy) => monthsOf(yy)))));
    const sum = new Map<string, number>(); // `${propertyId}|${year}` → actual
    for (const a of actuals) {
      const k = `${a.propertyId}|${a.month.slice(0, 4)}`;
      sum.set(k, (sum.get(k) ?? 0) + a.amount);
    }
    for (const yy of actualYears) {
      for (const id of ids) {
        const v = sum.get(`${id}|${yy}`);
        if (v !== undefined) out.get(id)![`${yy}A`] = { amount: round(v), source: 'actual' };
      }
    }
  }

  let lastActual: string | null = null;
  if (forecastLabel) {
    const f = await loadPriorForecast(version, propertyIds);
    lastActual = `${f.year}-${String(f.cutoff).padStart(2, '0')}`;
    for (const id of ids) {
      const p = f.properties.get(id);
      if (!p) continue;
      out.get(id)![forecastLabel] = { amount: round(p.months.reduce((s, v) => s + v, 0)), source: p.hasActuals ? 'forecast' : 'projection' };
    }
  }
  return { values: out, lastActual };
}

const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const round = (n: number) => Math.round(n * 100) / 100;
