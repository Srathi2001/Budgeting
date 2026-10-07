'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { DashboardData, DashUnit, DueEvent, ExpiryOutcome } from '@/lib/budget/dashboard';
import { CATEGORIES } from '@/lib/budget/category';
import { MONTHS } from '@/lib/format';
import { ChartCard, Columns, HBars, Legend, LineChart, StatTile, compact } from '@/components/charts';
import { CATEGORY_COLOR, MEASURE, MOVE_IN_COLOR, OUTCOME_COLOR } from '@/lib/segments';
import { useFilters } from '@/components/filter-bar';
import { unitPasses } from '@/lib/filters';
import { RentPsfCard } from './rent-psf-card';
import { BudgetVsForecastCard } from './budget-vs-forecast-card';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const z12 = () => Array(12).fill(0) as number[];
const add12 = (acc: number[], v: number[] | null) => (v ? acc.map((x, i) => x + v[i]) : acc);
const pctTxt = (n: number | null, d = 1) => (n === null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(d)}%`);

// stack order (registry order); multi-year leases already contracted in Oracle count as Renew
const OUTCOMES: ExpiryOutcome[] = ['Renew', 'New tenant', 'Not re-let'];
const OUTCOME_LABEL: Record<ExpiryOutcome, string> = { Renew: 'Renew', 'New tenant': 'New tenant', 'Not re-let': 'Not re-let' };

export function Dashboard({ data, locked }: { data: DashboardData; locked: boolean }) {
  // the shared page filters (Business unit, Property manager, Category, Property)
  const { filters } = useFilters();
  const yy = String(data.year).slice(2);
  const B = `${data.year}B`;
  const P = `${data.year - 1}B`;

  const propById = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);

  const units = useMemo(() => data.units.filter((u) => unitPasses({ ...u, bu: u.buCode }, filters)), [data.units, filters]);

  const m = useMemo(() => {
    const budget = units.reduce((a, u) => add12(a, u.revenue), z12());
    const prior = units.reduce((a, u) => add12(a, u.prior), z12());
    const cash = units.reduce((a, u) => add12(a, u.cashFlow), z12());
    const inBudget = units.filter((u) => u.revenue);
    // occupancy: share of budget units earning rent in the month
    const occ = MONTHS.map((_, i) => (inBudget.length ? inBudget.filter((u) => (u.revenue?.[i] ?? 0) > 0.5).length / inBudget.length : 0));
    // renewal profile: contracts falling due (overdue first, then each month) and what follows
    const due: DueEvent[] = units.flatMap((u) => u.due);
    const slots = [-1, ...MONTHS.map((_, i) => i)];
    const dueBy = (o: ExpiryOutcome) => slots.map((s) => sum(due.filter((e) => e.outcome === o && e.month === s).map((e) => e.rent)));
    const moveIns = slots.map((s) => (s < 0 ? null : sum(units.flatMap((u) => u.moveIns).filter((x) => x.month === s).map((x) => x.rent))));
    const dueTable = slots.map((s) => {
      const at = due.filter((e) => e.month === s);
      const of = (o: ExpiryOutcome) => at.filter((e) => e.outcome === o);
      const nt = of('New tenant');
      const vac = nt.map((e) => e.vacancyDays).filter((v): v is number => v !== null);
      return {
        label: s < 0 ? 'Overdue' : `${MONTHS[s]}-${yy}`,
        n: at.length,
        rent: sum(at.map((e) => e.rent)),
        renew: { n: of('Renew').length, rent: sum(of('Renew').map((e) => e.rent)), next: sum(of('Renew').map((e) => e.nextRent ?? 0)) },
        newT: { n: nt.length, vac: vac.length ? sum(vac) / vac.length : null, next: sum(nt.map((e) => e.nextRent ?? 0)) },
        lost: { n: of('Not re-let').length, rent: sum(of('Not re-let').map((e) => e.rent)) },
      };
    });
    const vacAll = due.map((e) => e.vacancyDays).filter((v): v is number => v !== null);
    const byProp = new Map<number, { budget: number; prior: number }>();
    for (const u of units) {
      const r = byProp.get(u.propertyId) ?? { budget: 0, prior: 0 };
      r.budget += sum(u.revenue ?? []);
      r.prior += sum(u.prior ?? []);
      byProp.set(u.propertyId, r);
    }
    const props = [...byProp.entries()].map(([id, v]) => ({ id, name: propById.get(id)?.name ?? String(id), ...v, change: v.budget - v.prior }));
    const buCat = data.bus
      .filter((b) => units.some((u) => u.bu === b))
      .map((b) => ({
        label: b,
        values: CATEGORIES.map((c) => sum(units.filter((u) => u.bu === b && u.category === c).flatMap((u) => u.revenue ?? []))),
      }))
      .filter((r) => sum(r.values) > 0);
    const expiry = OUTCOMES.map(dueBy);
    return {
      budget,
      prior,
      cash,
      occ,
      total: sum(budget),
      priorTotal: sum(prior),
      cashTotal: sum(cash),
      units: inBudget.length,
      leased: inBudget.filter((u) => u.leased).length,
      vacancyLoss: sum(units.map((u) => u.vacancyLoss)),
      issues: sum(units.map((u) => u.issues)),
      dueCount: due.length,
      dueRent: sum(due.map((e) => e.rent)),
      // share of the leases falling due that renew
      renewalRate: due.length ? due.filter((e) => e.outcome === 'Renew').length / due.length : null,
      avgVacancy: vacAll.length ? sum(vacAll) / vacAll.length : null,
      rentLost: sum(due.filter((e) => e.outcome === 'Not re-let').map((e) => e.rent)),
      dueTable,
      moveIns,
      top: [...props].sort((a, b) => b.budget - a.budget).slice(0, 10),
      movers: [...props].filter((p) => Math.abs(p.change) > 0.5).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10).sort((a, b) => b.change - a.change),
      buCat,
      expiry,
    };
  }, [units, data.bus, propById, yy]);

  const change = m.priorTotal ? (m.total - m.priorTotal) / m.priorTotal : null;
  const noLeases = data.units.every((u: DashUnit) => !u.leased);
  const monthLabels = MONTHS.map((x) => x.slice(0, 3));

  return (
    <div className="anh-main">
      <header className="anh-pagehead">
        <div>
          <span className="anh-eyebrow">Dashboard</span>
          <h1>{data.versionName}</h1>
          <p className="page-sub mt-1">
            {locked ? 'Locked, read only' : 'Open for input'} · AED · vs {data.priorName ?? 'no prior budget'} · {m.units} units in view
          </p>
        </div>
      </header>

      {noLeases && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-700">
          No current leases are entered for {data.versionName} yet, so the {B} figures are empty. Enter them in the{' '}
          <Link href="/master" className="font-semibold underline">
            Lease Budget
          </Link>{' '}
          or import the Tenant and Lease Details Report in{' '}
          <Link href="/admin?tab=imports" className="font-semibold underline">
            Admin → Imports
          </Link>
          .
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={`Revenue ${B}`}
          value={compact(m.total)}
          delta={change === null ? undefined : `${pctTxt(change)} vs ${P}`}
          deltaDir={change === null ? undefined : change >= 0 ? 'up' : 'down'}
          adverse={change !== null && change < 0}
          sub={`${P}: ${compact(m.priorTotal)}`}
          spark={m.budget}
        />
        <StatTile label="Cash inflow" value={compact(m.cashTotal)} sub="Rent + VAT + deposits" spark={m.cash} />
        <StatTile
          label="Occupancy (avg)"
          value={pctTxt(sum(m.occ) / 12, 0)}
          sub={`${m.leased} of ${m.units} units leased now`}
          spark={m.occ}
        />
        <StatTile label="Vacancy loss" value={compact(m.vacancyLoss)} sub={`${pctTxt(m.total ? m.vacancyLoss / m.total : null)} of ${B}`} />
        <StatTile
          label={`Leases due ${data.year}`}
          value={compact(m.dueRent)}
          sub={`${m.dueCount} leases · ${pctTxt(m.renewalRate, 0)} renewing${m.avgVacancy === null ? '' : ` · new tenants after ${Math.round(m.avgVacancy)} days`}`}
        />
        <StatTile label="Open issues" value={String(m.issues)} sub={m.issues ? 'Rows to review in Lease Budget' : 'None'} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Revenue by month · ${B} vs ${P}`}
          sub="Budget revenue recognised each month"
          legend={<Legend shape="line" items={[{ label: B, color: MEASURE.budget }, { label: P, color: MEASURE.prior, dash: true }]} />}
          table={{ head: ['Month', B, P, 'Change'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, Math.round(m.budget[i]), Math.round(m.prior[i]), Math.round(m.budget[i] - m.prior[i])]) }}
        >
          <LineChart
            labels={monthLabels}
            series={[
              { name: P, color: MEASURE.prior, values: m.prior, dash: true },
              { name: B, color: MEASURE.budget, values: m.budget },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={`Revenue vs cash inflow · ${data.year}`}
          sub="Cash follows the cheque schedules; it includes VAT and security deposits"
          legend={<Legend items={[{ label: 'Revenue', color: MEASURE.budget }, { label: 'Cash inflow', color: MEASURE.cash }]} />}
          table={{ head: ['Month', 'Revenue', 'Cash inflow', 'Cash − revenue'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, Math.round(m.budget[i]), Math.round(m.cash[i]), Math.round(m.cash[i] - m.budget[i])]) }}
        >
          <Columns
            labels={monthLabels}
            series={[
              { name: 'Revenue', color: MEASURE.budget, values: m.budget },
              { name: 'Cash inflow', color: MEASURE.cash, values: m.cash },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue mix · business unit by category"
          sub={`${B} revenue`}
          legend={<Legend items={CATEGORIES.filter((c) => m.buCat.some((r) => r.values[CATEGORIES.indexOf(c)] > 0)).map((c) => ({ label: c, color: CATEGORY_COLOR[c] }))} />}
          table={{ head: ['Business unit', ...CATEGORIES, 'Total'], rows: m.buCat.map((r) => [r.label, ...r.values.map(Math.round), Math.round(sum(r.values))]) }}
        >
          <HBars labelWidth={80} rows={m.buCat} series={CATEGORIES.map((c) => ({ name: c, color: CATEGORY_COLOR[c] }))} />
        </ChartCard>

        <ChartCard
          title={`Occupancy by month · ${data.year}`}
          sub="Share of units earning rent in the month"
          table={{ head: ['Month', 'Occupancy %'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, `${(m.occ[i] * 100).toFixed(1)}%`]) }}
        >
          <LineChart labels={monthLabels} series={[{ name: 'Occupancy', color: MEASURE.budget, values: m.occ.map((v) => v * 100) }]} fmt={(n) => `${Math.round(n)}%`} min={Math.max(0, Math.floor((Math.min(...m.occ) * 100 - 5) / 10) * 10)} />
        </ChartCard>

        <ChartCard
          title="Top 10 properties"
          sub={`${B} revenue, with change vs ${P}`}
          table={{ head: ['Property', B, P, 'Change'], rows: m.top.map((p) => [p.name, Math.round(p.budget), Math.round(p.prior), Math.round(p.change)]) }}
        >
          <HBars
            rows={m.top.map((p) => ({ label: p.name, values: [p.budget], note: p.prior ? pctTxt((p.budget - p.prior) / p.prior) : undefined }))}
            series={[{ name: B, color: MEASURE.budget }]}
            note={(r) => r.note}
          />
        </ChartCard>

        <ChartCard
          title={`Biggest movers vs ${P}`}
          sub="Change in budget revenue by property"
          table={{ head: ['Property', B, P, 'Change'], rows: m.movers.map((p) => [p.name, Math.round(p.budget), Math.round(p.prior), Math.round(p.change)]) }}
        >
          <HBars diverging rows={m.movers.map((p) => ({ label: p.name, values: [p.change] }))} series={[{ name: 'Change', color: MEASURE.budget }]} />
        </ChartCard>

        <ChartCard
          className="xl:col-span-2"
          title={`Leases due for renewal · ${data.year}`}
          sub={`Annual rent of leases falling due each month (renewals signed this year that fall due again included) and what the budget assumes next · line: new tenants moving in · Not re-let: ${compact(m.rentLost)} of rent lost`}
          legend={
            <Legend
              items={[
                ...OUTCOMES.map((o) => ({ label: OUTCOME_LABEL[o], color: OUTCOME_COLOR[o] })),
                { label: 'New tenants moving in', color: MOVE_IN_COLOR },
              ]}
            />
          }
          table={{
            head: ['Month', 'Leases due', 'Rent due', 'Renew', 'Renew: new rent', 'New tenant', 'Avg vacancy days', 'New tenant: rent', 'Not re-let', 'Rent lost', 'Moving in'],
            rows: m.dueTable.map((r, i) => [
              r.label,
              r.n,
              Math.round(r.rent),
              r.renew.n,
              Math.round(r.renew.next),
              r.newT.n,
              r.newT.vac === null ? '–' : Math.round(r.newT.vac),
              Math.round(r.newT.next),
              r.lost.n,
              Math.round(r.lost.rent),
              m.moveIns[i] === null ? '–' : Math.round(m.moveIns[i]!),
            ]),
          }}
        >
          <Columns
            stacked
            labels={['Overdue', ...monthLabels]}
            series={OUTCOMES.map((o, k) => ({ name: OUTCOME_LABEL[o], color: OUTCOME_COLOR[o], values: m.expiry[k] }))}
            lines={[{ name: 'New tenants moving in', color: MOVE_IN_COLOR, values: m.moveIns }]}
            height={220}
          />
        </ChartCard>
      </div>

      {data.budgetVsForecast && <BudgetVsForecastCard data={data.budgetVsForecast} />}
      <RentPsfCard data={data.rentPsf} />
    </div>
  );
}
