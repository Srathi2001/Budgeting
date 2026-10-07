// Dashboard card: last year's budget (the prior budget version) against last year's forecast —
// Oracle revenue actuals to the last closed month plus the Lease Budget projection of the rest
// (the same figure as Revenue Analysis (Y-1)F). Properties without Oracle actuals (PMC) are left out.
import 'server-only';
import { and, eq, inArray, like, max } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { StoredCalc } from './calc';

export interface BvfProperty {
  id: number;
  name: string;
  bu: string;
  budget: number;
  forecast: number;
}

export interface BudgetVsForecast {
  /** the year compared (budget year − 1) */
  year: number;
  budgetName: string;
  /** last month of actuals (1–12) */
  lastActualMonth: number;
  budget: number;
  forecast: number;
  forecastActual: number;
  forecastProjected: number;
  bus: { code: string; name: string; budget: number; forecast: number }[];
  properties: BvfProperty[];
  months: { budget: number[]; actual: (number | null)[]; projected: (number | null)[] };
  /** properties in view left out for want of Oracle actuals */
  excluded: number;
}

const z12 = () => Array.from({ length: 12 }, () => 0);

export async function loadBudgetVsForecast(
  version: schema.BudgetVersion,
  prior: schema.BudgetVersion | undefined,
  properties: { id: number; name: string; buCode: string; buName: string }[],
): Promise<BudgetVsForecast | null> {
  if (!prior || !properties.length) return null;
  const Y = version.year - 1;
  const ids = properties.map((p) => p.id);

  const [last] = await db
    .select({ m: max(schema.revenueActuals.month) })
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), like(schema.revenueActuals.month, `${Y}-%`)));
  const cutoff = last?.m ? Number(last.m.slice(5)) : 0;
  if (!cutoff) return null;

  // budget: the prior version, by property and month
  const budget = new Map<number, number[]>();
  const bm = await db
    .select({ p: schema.lineMonthly.propertyId, m: schema.lineMonthly.month, r: schema.lineMonthly.revenue })
    .from(schema.lineMonthly)
    .where(and(eq(schema.lineMonthly.versionId, prior.id), inArray(schema.lineMonthly.propertyId, ids)));
  for (const x of bm) {
    const a = budget.get(x.p) ?? z12();
    a[x.m - 1] += x.r;
    budget.set(x.p, a);
  }

  // actuals to the cut-off
  const actual = new Map<number, number[]>();
  const am = await db
    .select()
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), inArray(schema.revenueActuals.propertyId, ids), like(schema.revenueActuals.month, `${Y}-%`)));
  for (const x of am) {
    const a = actual.get(x.propertyId) ?? z12();
    a[Number(x.month.slice(5)) - 1] += x.amount;
    actual.set(x.propertyId, a);
  }

  // projection after the cut-off: the current version's leases run through year Y
  const projected = new Map<number, number[]>();
  const lines = await db
    .select({ p: schema.leaseLines.propertyId, calc: schema.leaseLines.calc })
    .from(schema.leaseLines)
    .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids)));
  for (const l of lines) {
    const pr = (l.calc as StoredCalc | null)?.priorRevenue;
    if (!pr) continue;
    const a = projected.get(l.p) ?? z12();
    for (let i = cutoff; i < 12; i++) a[i] += pr[i];
    projected.set(l.p, a);
  }

  const covered = properties.filter((p) => actual.has(p.id));
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const rows: (BvfProperty & { act: number[]; proj: number[]; bud: number[] })[] = covered.map((p) => {
    const bud = budget.get(p.id) ?? z12();
    const act = actual.get(p.id)!;
    const proj = projected.get(p.id) ?? z12();
    return { id: p.id, name: p.name, bu: p.buCode, budget: sum(bud), forecast: sum(act.slice(0, cutoff)) + sum(proj.slice(cutoff)), act, proj, bud };
  });
  const months = {
    budget: z12().map((_, i) => sum(rows.map((r) => r.bud[i]))),
    actual: z12().map((_, i) => (i < cutoff ? sum(rows.map((r) => r.act[i])) : null)),
    projected: z12().map((_, i) => (i >= cutoff ? sum(rows.map((r) => r.proj[i])) : null)),
  };
  const buNames = new Map(properties.map((p) => [p.buCode, p.buName]));
  const bus = [...new Set(rows.map((r) => r.bu))].sort().map((code) => {
    const rs = rows.filter((r) => r.bu === code);
    return { code, name: buNames.get(code) ?? code, budget: sum(rs.map((r) => r.budget)), forecast: sum(rs.map((r) => r.forecast)) };
  });
  const forecastActual = sum(months.actual.map((v) => v ?? 0));
  const forecastProjected = sum(months.projected.map((v) => v ?? 0));
  return {
    year: Y,
    budgetName: prior.name,
    lastActualMonth: cutoff,
    budget: sum(months.budget),
    forecast: forecastActual + forecastProjected,
    forecastActual,
    forecastProjected,
    bus,
    properties: rows.map(({ id, name, bu, budget: b, forecast: f }) => ({ id, name, bu, budget: b, forecast: f })),
    months,
    excluded: properties.length - covered.length,
  };
}
