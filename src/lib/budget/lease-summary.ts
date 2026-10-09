// Lease Budget summary: what the property managers entered, by property, for Finance to check once it is
// in. Built on the Dashboard's units (budget, last year's forecast, leases falling due and what follows)
// and the submission status of each property.
import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Filters } from '@/lib/filters';
import { CATEGORIES, type Category } from './category';
import { loadDashboardData } from './dashboard';

export interface LeaseSummaryProperty {
  id: number;
  code: string;
  name: string;
  bu: string;
  pm: string;
  status: string;
  units: number;
  vacant: number;
  due: number;
  renew: number;
  newTenant: number;
  notRelet: number;
  rentLost: number;
  forecast: number;
  budget: number;
  vacancyLoss: number;
  issues: number;
}

export interface LeaseSummary {
  versionName: string;
  year: number;
  forecastName: string;
  forecastCutoff: number;
  properties: LeaseSummaryProperty[];
  byBu: { label: string; forecast: number; budget: number }[];
  byCategory: { label: Category; forecast: number; budget: number }[];
  months: { budget: number[]; forecast: number[] };
}

const sum = (a: number[] | null | undefined) => (a ? a.reduce((s, v) => s + v, 0) : 0);

export async function loadLeaseSummary(version: schema.BudgetVersion, propertyIds: number[], categories: Category[], filters: Filters): Promise<LeaseSummary> {
  const [d, subs] = await Promise.all([loadDashboardData(version, propertyIds, filters), db.select().from(schema.submissions).where(eq(schema.submissions.versionId, version.id))]);
  const units = d.units.filter((u) => !categories.length || categories.includes(u.category));
  const status = new Map(subs.map((s) => [s.propertyId, s.status]));
  const properties: LeaseSummaryProperty[] = d.properties
    .map((p) => {
      const us = units.filter((u) => u.propertyId === p.id);
      const due = us.flatMap((u) => u.due);
      const inBudget = us.filter((u) => u.revenue);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        bu: p.bu,
        pm: p.pm,
        status: status.get(p.id) ?? 'DRAFT',
        units: inBudget.length,
        vacant: inBudget.filter((u) => !u.leased).length,
        due: due.length,
        renew: due.filter((e) => e.outcome === 'Renew').length,
        newTenant: due.filter((e) => e.outcome === 'New tenant').length,
        notRelet: due.filter((e) => e.outcome === 'Not re-let').length,
        rentLost: sum(due.filter((e) => e.outcome === 'Not re-let').map((e) => e.rent)),
        forecast: sum(us.map((u) => sum(u.forecast))),
        budget: sum(us.map((u) => sum(u.revenue))),
        vacancyLoss: sum(us.map((u) => u.vacancyLoss)),
        issues: sum(us.map((u) => u.issues)),
      };
    })
    .filter((p) => p.units || p.forecast || p.budget);
  const group = <K extends string>(keys: K[], of: (u: (typeof units)[number]) => K) =>
    keys
      .map((k) => ({ label: k, forecast: sum(units.filter((u) => of(u) === k).map((u) => sum(u.forecast))), budget: sum(units.filter((u) => of(u) === k).map((u) => sum(u.revenue))) }))
      .filter((r) => r.forecast || r.budget);
  const months = { budget: Array.from({ length: 12 }, () => 0), forecast: Array.from({ length: 12 }, () => 0) };
  for (const u of units) {
    u.revenue?.forEach((v, i) => (months.budget[i] += v));
    u.forecast.forEach((v, i) => (months.forecast[i] += v));
  }
  return {
    versionName: d.versionName,
    year: d.year,
    forecastName: d.forecastName,
    forecastCutoff: d.forecastCutoff,
    properties,
    byBu: group(d.bus, (u) => u.bu),
    byCategory: group([...CATEGORIES], (u) => u.category),
    months,
  };
}
