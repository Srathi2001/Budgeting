// Dashboard report cards, computed on the server for the page filters:
// - rent by year: Oracle's Revenue Recognition Summary (from FIRST_REPORT_YEAR), the prior budget
//   version, the forecast (actuals + Lease Budget) and the budget;
// - other income by GL account: the uploaded GL actuals only;
// - operating costs and building capex: FM GL actuals, the prior FM budget and this FM budget.
import 'server-only';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { db, schema } from '@/db';
import { isFinance, type CurrentUser } from '@/lib/auth/dal';
import type { Filters } from '@/lib/filters';
import { MONTHS, sum } from '@/lib/format';
import type { StoredCalc } from './calc';
import { categoryOf, type Category } from './category';
import { FIRST_REPORT_YEAR } from './comparatives';
import { propertyRollups } from './reports';
import { loadFmBudget } from './fm';
import { BUILDING_LINES, budgetedExpenseLines, propertyExpenseTotals } from './expenses';
import { FM_KIND_LABEL, STAFF_TEAMS, WORK_TYPES, type FmKind, type WorkType } from './fm-types';
import { OI_ACCOUNT, oiType } from './other-income-types';
import { OUTSIDE_BUS } from './group';
import { CAPEX_GROUPS, OI_TYPES, type CapexGroup, type DashboardReports } from './dashboard-reports-types';

const CAPEX_OF: Record<string, CapexGroup> = {
  ...Object.fromEntries(['12', '13', '14'].map((e) => [e, 'AC / HVAC'])),
  ...Object.fromEntries(['06', '17', '18'].map((e) => [e, 'Fire, security & FFE'])),
  ...Object.fromEntries(['01', '02', '03', '04', '21', '22', '27', '28', '29', '30'].map((e) => [e, 'Civil & structure'])),
  ...Object.fromEntries(['05', '24', '25', '31'].map((e) => [e, 'Finishes & refurbishment'])),
  ...Object.fromEntries(['07', '08', '09', '10', '11', '15', '16', '19', '20'].map((e) => [e, 'MEP & services'])),
};
const capexGroup = (element: string): CapexGroup => CAPEX_OF[element] ?? 'Other';
const CAPEX_TYPES = WORK_TYPES.filter((w) => w.line === 'capex').map((w) => w.code);
const isCapex = (workType: string) => CAPEX_TYPES.includes(workType as WorkType);


const z12 = () => Array.from({ length: 12 }, () => 0);
const monthsOf = (yy: number) => MONTHS.map((_, i) => `${yy}-${String(i + 1).padStart(2, '0')}`);
type Fm = Awaited<ReturnType<typeof loadFmBudget>>;

export async function loadDashboardReports(
  version: schema.BudgetVersion,
  user: CurrentUser,
  scope: { filters: Filters; propertyIds: number[]; categories: Category[] },
): Promise<DashboardReports> {
  const Y = version.year;
  const ids = scope.propertyIds.length ? scope.propertyIds : [-1];
  const inScope = new Set(ids);
  const f = scope.filters;
  // company-level rows (General other income, GL lines with no property): Finance, unfiltered but for BU
  const general = isFinance(user) && !f.pm.length && !f.cat.length && !f.prop.length;
  const generalBu = (bu: string) => general && (!f.bu.length || f.bu.includes(bu));

  const [prior] = await db
    .select()
    .from(schema.budgetVersions)
    .where(eq(schema.budgetVersions.year, Y - 1))
    .orderBy(desc(schema.budgetVersions.status), desc(schema.budgetVersions.id))
    .limit(1);

  const [rolls, priorRolls, bus] = await Promise.all([
    propertyRollups(version.id, scope.propertyIds, scope.categories),
    prior ? propertyRollups(prior.id, scope.propertyIds, scope.categories) : Promise.resolve([]),
    db.select().from(schema.businessUnits),
  ]);
  const propIds = rolls.map((r) => r.propertyId);

  // ---- rent by year ------------------------------------------------------------------------------
  const actualYears = Array.from({ length: Math.max(Y - 1 - FIRST_REPORT_YEAR, 0) }, (_, i) => FIRST_REPORT_YEAR + i); // full years before Y-1
  const actualRows = await db
    .select()
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), inArray(schema.revenueActuals.propertyId, ids), inArray(schema.revenueActuals.month, [...actualYears, Y - 1].flatMap(monthsOf))));
  const actual = new Map<string, number[]>(); // `${property}|${year}` → months
  for (const a of actualRows) {
    const k = `${a.propertyId}|${a.month.slice(0, 4)}`;
    const m = actual.get(k) ?? z12();
    m[Number(a.month.slice(5)) - 1] += a.amount;
    actual.set(k, m);
  }
  const [last] = await db
    .select({ m: schema.revenueActuals.month })
    .from(schema.revenueActuals)
    .where(and(eq(schema.revenueActuals.kind, 'A'), like(schema.revenueActuals.month, `${Y - 1}-%`)))
    .orderBy(desc(schema.revenueActuals.month))
    .limit(1);
  const cutoff = last?.m ? Number(last.m.slice(5)) : 0;
  // the forecast: actuals to the cut-off + the Lease Budget's projection (the same leases run through Y-1)
  const lineRows = await db
    .select({ propertyId: schema.leaseLines.propertyId, calc: schema.leaseLines.calc, kind: schema.properties.kind, pivotCategory: schema.units.pivotCategory, unitType: schema.units.unitType, rc: schema.units.rc })
    .from(schema.leaseLines)
    .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
    .innerJoin(schema.properties, eq(schema.properties.id, schema.leaseLines.propertyId))
    .where(and(eq(schema.leaseLines.versionId, version.id), inArray(schema.leaseLines.propertyId, ids)));
  const proj = new Map<number, number[]>();
  for (const l of lineRows) {
    if (scope.categories.length && !scope.categories.includes(categoryOf(l, l.kind))) continue;
    const pr = (l.calc as StoredCalc | null)?.priorRevenue;
    if (!pr) continue;
    const m = proj.get(l.propertyId) ?? z12();
    pr.forEach((v, i) => (m[i] += v));
    proj.set(l.propertyId, m);
  }
  const getA = (yy: number) => (id: number) => {
    const m = actual.get(`${id}|${yy}`);
    return m ? sum(m) : null;
  };
  const getF = (id: number) => {
    const p = proj.get(id) ?? z12();
    const a = actual.get(`${id}|${Y - 1}`);
    return a && cutoff ? sum(a.slice(0, cutoff)) + sum(p.slice(cutoff)) : sum(p);
  };
  const rentP = new Map(priorRolls.map((r) => [r.propertyId, sum(r.revenue)]));
  const rentB = new Map(rolls.map((r) => [r.propertyId, sum(r.revenue)]));
  const getP = (id: number) => rentP.get(id) ?? null;
  const getB = (id: number) => rentB.get(id) ?? null;
  const buCodes = [...new Set(rolls.map((r) => r.buCode))].sort();
  const buName = new Map(bus.map((b) => [b.code, b.name]));
  const year = (label: string, source: string, get: (id: number) => number | null, base: { label: string; get: (id: number) => number | null } | null) => {
    const byBu: Record<string, number | null> = {};
    let n = 0;
    for (const bu of buCodes) {
      const have = rolls.filter((r) => r.buCode === bu).map((r) => get(r.propertyId)).filter((v): v is number => v !== null);
      byBu[bu] = have.length ? sum(have) : null;
      n += have.filter((v) => Math.abs(v) >= 0.5).length;
    }
    let growth: number | null = null;
    if (base) {
      const both = propIds.filter((id) => get(id) !== null && base.get(id) !== null);
      const from = sum(both.map((id) => base.get(id)!));
      growth = from ? sum(both.map((id) => get(id)!)) / from - 1 : null;
    }
    return { label, source, byBu, properties: n, base: base?.label ?? null, growth };
  };
  const lastActual = actualYears.length ? { label: `${actualYears[actualYears.length - 1]}A`, get: getA(actualYears[actualYears.length - 1]) } : null;
  const fLabel = `${Y - 1}F`;
  const years = [
    ...actualYears.map((yy, i) => year(`${yy}A`, 'Oracle Revenue Recognition Summary', getA(yy), i ? { label: `${yy - 1}A`, get: getA(yy - 1) } : null)),
    ...(prior ? [year(`${Y - 1}B`, prior.name, getP, lastActual)] : []),
    year(fLabel, cutoff ? `Oracle actuals Jan–${MONTHS[cutoff - 1]} + Lease Budget` : 'Lease Budget', getF, lastActual),
    year(`${Y}B`, 'Lease Budget', getB, { label: fLabel, get: getF }),
  ];

  // ---- other income: uploaded GL actuals ----------------------------------------------------------
  const oiRows = (
    await db
      .select()
      .from(schema.otherIncome)
      .where(and(eq(schema.otherIncome.versionId, version.id), inArray(schema.otherIncome.period, ['A2', 'A1', 'YTD'])))
  ).filter((r) => (r.propertyId !== null ? inScope.has(r.propertyId) : generalBu(r.buCode)));
  const KEY = { A2: 'a2', A1: 'a1', YTD: 'ytd' } as const;
  const byAccount = new Map<string, { a2: number; a1: number; ytd: number }>();
  const outside = { a2: 0, a1: 0, ytd: 0 };
  for (const r of oiRows) {
    if (r.amount === null) continue;
    const k = KEY[r.period as keyof typeof KEY];
    if (OUTSIDE_BUS.includes(r.buCode)) {
      outside[k] += r.amount;
      continue;
    }
    const a = byAccount.get(r.account) ?? { a2: 0, a1: 0, ytd: 0 };
    a[k] += r.amount;
    byAccount.set(r.account, a);
  }
  const accounts = [...byAccount.entries()]
    .map(([code, v]) => ({ code, name: OI_ACCOUNT.get(code)?.name ?? code, type: oiType(code), ...v }))
    .filter((a) => Math.abs(a.a2) + Math.abs(a.a1) + Math.abs(a.ytd) >= 0.5)
    .sort((a, b) => OI_TYPES.indexOf(a.type) - OI_TYPES.indexOf(b.type) || b.a1 - a.a1);

  // ---- FM: works, staff, actuals ----------------------------------------------------------------------
  const [fmB, fmP] = await Promise.all([loadFmBudget(version.id), prior ? loadFmBudget(prior.id) : Promise.resolve(null)]);
  const inFm = (fm: Fm | null) => (fm ? [...fm.result.byProperty.entries()].filter(([id]) => inScope.has(id)).map(([, r]) => r) : []);
  const worksOf = (fm: Fm | null, w: WorkType) => sum(inFm(fm).map((r) => r.works[w]));
  // a version's FM budget not entered yet shows as not entered, never as 0
  const entered = (fm: Fm | null, v: number) => (fm?.budgeted ? v : null);
  const staffOf = (fm: Fm | null, team: string) => sum(inFm(fm).map((r) => r.staff[team as keyof typeof r.staff] ?? 0));

  const fmAct = (await db.select().from(schema.fmActuals).where(inArray(schema.fmActuals.month, [Y - 3, Y - 2, Y - 1].flatMap(monthsOf)))).filter((a) =>
    a.propertyId === null ? general : inScope.has(a.propertyId),
  );
  const fmLast = fmAct.filter((a) => a.month.startsWith(`${Y - 1}-`)).reduce((m, a) => (a.month > m ? a.month : m), '');
  const fmYtd = fmLast ? `${Y - 1} Jan–${MONTHS[Number(fmLast.slice(5)) - 1]}` : `${Y - 1} YTD`;
  const act = (yy: number, match: (a: (typeof fmAct)[number]) => boolean) => sum(fmAct.filter((a) => a.month.startsWith(`${yy}-`) && match(a)).map((a) => a.amount));

  // every expense line (FM budget and building overheads), as the Building P&L; null = not budgeted
  const expenseLines = async (v: schema.BudgetVersion | undefined) => {
    if (!v) return null;
    const [budgeted, totals] = await Promise.all([budgetedExpenseLines(v.id), propertyExpenseTotals(v.id, ids)]);
    return Object.fromEntries(BUILDING_LINES.map((l) => [l.key, budgeted.has(l.key) ? sum([...totals.values()].map((t) => t[l.key] ?? 0)) : null]));
  };
  const [linesB, linesP] = await Promise.all([expenseLines(version), expenseLines(prior)]);

  // capex lines by element, kind and building
  const capexRows = await db
    .select({ versionId: schema.fmLines.versionId, propertyId: schema.fmLines.propertyId, element: schema.fmLines.element, kind: schema.fmLines.kind, amount: schema.fmLines.amount })
    .from(schema.fmLines)
    .where(and(inArray(schema.fmLines.versionId, [version.id, prior?.id ?? -1]), inArray(schema.fmLines.workType, CAPEX_TYPES), inArray(schema.fmLines.propertyId, ids)));
  const capexBy = (key: (r: (typeof capexRows)[number]) => string) => {
    const m = new Map<string, { prior: number; budget: number }>();
    for (const r of capexRows) {
      const e = m.get(key(r)) ?? { prior: 0, budget: 0 };
      if (r.versionId === version.id) e.budget += r.amount;
      else e.prior += r.amount;
      m.set(key(r), e);
    }
    return m;
  };
  const byGroup = capexBy((r) => capexGroup(r.element));
  const capexAct = (yy: number, g: CapexGroup) => act(yy, (a) => isCapex(a.workType) && capexGroup(a.element) === g);
  const propName = new Map(rolls.map((r) => [String(r.propertyId), r.name]));

  return {
    labels: { B: `${Y}B`, P: `${Y - 1}B`, F: fLabel, A1: `${Y - 2}A`, A2: `${Y - 3}A`, fmYtd, oiYtd: `${Y - 1} Jan–Sep` },
    rentByYear: { bus: buCodes.map((code) => ({ code, name: buName.get(code) ?? code })), years },
    otherIncome: { general, accounts, outside },
    costs: {
      budgeted: fmB.budgeted,
      priorBudgeted: !!fmP?.budgeted,
      lines: BUILDING_LINES.map((l) => ({ key: l.key, label: l.label, section: l.section as 'opex' | 'belowGp' | 'cashOnly', prior: linesP?.[l.key] ?? null, budget: linesB?.[l.key] ?? null })),
      workTypes: WORK_TYPES.map((w) => ({
        code: w.code,
        label: w.label,
        line: w.line,
        a2: act(Y - 3, (a) => a.workType === w.code),
        a1: act(Y - 2, (a) => a.workType === w.code),
        ytd: act(Y - 1, (a) => a.workType === w.code),
        prior: entered(fmP, worksOf(fmP, w.code)),
        budget: entered(fmB, worksOf(fmB, w.code)),
      })),
      staff: STAFF_TEAMS.filter((t) => t.code !== 'GA').map((t) => ({ team: t.code, label: t.label, prior: entered(fmP, staffOf(fmP, t.code)), budget: entered(fmB, staffOf(fmB, t.code)) })),
    },
    capex: {
      groups: CAPEX_GROUPS.map((group) => ({ group, a1: capexAct(Y - 2, group), ytd: capexAct(Y - 1, group), prior: byGroup.get(group)?.prior ?? 0, budget: byGroup.get(group)?.budget ?? 0 })).filter(
        (g) => Math.abs(g.a1) + Math.abs(g.ytd) + g.prior + g.budget >= 0.5,
      ),
      kinds: [...capexBy((r) => r.kind).entries()].map(([kind, v]) => ({ kind, label: FM_KIND_LABEL[kind as FmKind] ?? kind, ...v })),
      buildings: [...capexBy((r) => String(r.propertyId)).entries()]
        .map(([id, v]) => ({ name: propName.get(id) ?? id, ...v }))
        .sort((a, b) => b.budget + b.prior - (a.budget + a.prior))
        .slice(0, 10),
    },
  };
}
