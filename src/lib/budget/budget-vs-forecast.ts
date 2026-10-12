// Dashboard card: last year's budget (the prior budget version) against last year's forecast, the one
// current-year forecast of forecast.ts (the same figure as Revenue Analysis (Y-1)F): Oracle actuals to the
// cut-off month, then the leases and the property managers' inputs; properties without Oracle actuals
// (PMC) projected for the whole year.
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { StoredCalc } from './calc';
import { loadPriorForecast } from './forecast';

export interface BvfProperty {
  id: number;
  name: string;
  bu: string;
  budget: number;
  forecast: number;
  /** this version's budget (the year after) */
  next: number;
}

export interface BudgetVsForecast {
  /** the year compared (budget year − 1) */
  year: number;
  budgetName: string;
  /** last month of actuals (1–12): the version's actuals cut-off */
  lastActualMonth: number;
  budget: number;
  forecast: number;
  forecastActual: number;
  forecastProjected: number;
  /** this version's budget for the same properties */
  next: number;
  nextLabel: string;
  bus: { code: string; name: string; budget: number; forecast: number; next: number }[];
  properties: BvfProperty[];
  months: { budget: number[]; actual: (number | null)[]; projected: (number | null)[] };
  /** properties in view without Oracle actuals: projected for the whole year */
  projectedOnly: number;
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
  // the one current-year forecast: actuals to the cut-off month, then the leases and the PMs' inputs
  const pf = await loadPriorForecast(version, ids);
  const cutoff = pf.cutoff;

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

  // this version's own budget year, for "2026B → 2026F → 2027B"
  const next = new Map<number, number>();
  const lines = await db
    .select({ p: schema.leaseLines.propertyId, calc: schema.leaseLines.calc })
    .from(schema.leaseLines)
    .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids)));
  for (const l of lines) next.set(l.p, (next.get(l.p) ?? 0) + ((l.calc as StoredCalc | null)?.totals.revenue ?? 0));

  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const rows: (BvfProperty & { act: number[]; proj: number[]; bud: number[]; all: number[] })[] = properties
    .filter((p) => pf.properties.has(p.id) || budget.has(p.id))
    .map((p) => {
      const f = pf.properties.get(p.id);
      const bud = budget.get(p.id) ?? z12();
      const all = f?.months ?? z12();
      return { id: p.id, name: p.name, bu: p.buCode, budget: sum(bud), forecast: sum(all), next: next.get(p.id) ?? 0, act: f?.actual ?? z12(), proj: f?.projected ?? z12(), bud, all };
    });
  // the months to the cut-off are actual (projected for a property without Oracle actuals), the rest projected
  const months = {
    budget: z12().map((_, i) => sum(rows.map((r) => r.bud[i]))),
    actual: z12().map((_, i) => (i < cutoff ? sum(rows.map((r) => r.all[i])) : null)),
    projected: z12().map((_, i) => (i >= cutoff ? sum(rows.map((r) => r.all[i])) : null)),
  };
  const buNames = new Map(properties.map((p) => [p.buCode, p.buName]));
  const bus = [...new Set(rows.map((r) => r.bu))].sort().map((code) => {
    const rs = rows.filter((r) => r.bu === code);
    return { code, name: buNames.get(code) ?? code, budget: sum(rs.map((r) => r.budget)), forecast: sum(rs.map((r) => r.forecast)), next: sum(rs.map((r) => r.next)) };
  });
  const forecastActual = sum(rows.map((r) => sum(r.act)));
  const forecastProjected = sum(rows.map((r) => sum(r.proj)));
  return {
    year: Y,
    budgetName: prior.name,
    lastActualMonth: cutoff,
    budget: sum(months.budget),
    forecast: forecastActual + forecastProjected,
    forecastActual,
    forecastProjected,
    next: sum(rows.map((r) => r.next)),
    nextLabel: `${version.year}B`,
    bus,
    properties: rows.map(({ id, name, bu, budget: b, forecast: f, next: n }) => ({ id, name, bu, budget: b, forecast: f, next: n })),
    months,
    projectedOnly: rows.filter((r) => pf.properties.has(r.id) && !pf.properties.get(r.id)!.hasActuals).length,
  };
}
