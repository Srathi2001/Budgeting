'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { DashboardData, DashUnit, ExpiryOutcome } from '@/lib/budget/dashboard';
import { CATEGORIES } from '@/lib/budget/category';
import { MONTHS } from '@/lib/format';
import { ChartCard, Columns, HBars, Legend, LineChart, StatTile, SERIES, MUTED_SERIES, compact } from '@/components/charts';
import { MultiSelect } from '@/components/multi-select';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const z12 = () => Array(12).fill(0) as number[];
const add12 = (acc: number[], v: number[] | null) => (v ? acc.map((x, i) => x + v[i]) : acc);
const pctTxt = (n: number | null, d = 1) => (n === null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(d)}%`);

// colour follows the entity, never its rank
const CAT_COLOR = Object.fromEntries(CATEGORIES.map((c, i) => [c, SERIES[i]]));
const OUTCOMES: ExpiryOutcome[] = ['Renew', 'New tenant', 'Not re-let'];
const OUTCOME_COLOR: Record<ExpiryOutcome, string> = { Renew: SERIES[0], 'New tenant': SERIES[1], 'Not re-let': SERIES[2] };

export function Dashboard({ data, locked }: { data: DashboardData; locked: boolean }) {
  // multi-select filters; an empty list means "All"
  const [bu, setBu] = useState<string[]>([]);
  const [pm, setPm] = useState<string[]>([]);
  const [cat, setCat] = useState<string[]>([]);
  const [prop, setProp] = useState<string[]>([]);
  const yy = String(data.year).slice(2);
  const B = `${data.year}B`;
  const P = `${data.year - 1}B`;
  const pass = (sel: string[], v: string) => sel.length === 0 || sel.includes(v);

  const propById = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);
  const propOptions = data.properties.filter((p) => pass(bu, p.bu) && pass(pm, p.pm)).sort((a, b) => a.name.localeCompare(b.name));

  const units = useMemo(
    () =>
      data.units.filter(
        (u) =>
          (bu.length === 0 || bu.includes(u.bu)) &&
          (pm.length === 0 || pm.includes(u.pm)) &&
          (cat.length === 0 || cat.includes(u.category)) &&
          (prop.length === 0 || prop.includes(String(u.propertyId))),
      ),
    [data.units, bu, pm, cat, prop],
  );
  // value counts shown next to each option, Excel-style
  const count = (key: (u: DashUnit) => string) => {
    const m = new Map<string, number>();
    for (const u of data.units) m.set(key(u), (m.get(key(u)) ?? 0) + 1);
    return m;
  };

  const m = useMemo(() => {
    const budget = units.reduce((a, u) => add12(a, u.revenue), z12());
    const prior = units.reduce((a, u) => add12(a, u.prior), z12());
    const cash = units.reduce((a, u) => add12(a, u.cashFlow), z12());
    const inBudget = units.filter((u) => u.revenue);
    // occupancy: share of budget units earning rent in the month
    const occ = MONTHS.map((_, i) => (inBudget.length ? inBudget.filter((u) => (u.revenue?.[i] ?? 0) > 0.5).length / inBudget.length : 0));
    const expiring = units.filter((u) => u.expiryMonth !== null);
    const byProp = new Map<number, { budget: number; prior: number }>();
    for (const u of units) {
      const r = byProp.get(u.propertyId) ?? { budget: 0, prior: 0 };
      r.budget += sum(u.revenue ?? []);
      r.prior += sum(u.prior ?? []);
      byProp.set(u.propertyId, r);
    }
    const props = [...byProp.entries()].map(([id, v]) => ({ id, name: propById.get(id)?.name ?? String(id), ...v, change: v.budget - v.prior }));
    const buCat = data.bus
      .filter((b) => bu.length === 0 || bu.includes(b))
      .map((b) => ({
        label: b,
        values: CATEGORIES.map((c) => sum(units.filter((u) => u.bu === b && u.category === c).flatMap((u) => u.revenue ?? []))),
      }))
      .filter((r) => sum(r.values) > 0);
    const expiry = OUTCOMES.map((o) => MONTHS.map((_, i) => sum(expiring.filter((u) => u.expiryOutcome === o && u.expiryMonth === i).map((u) => u.expiryRent))));
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
      expiringCount: expiring.length,
      expiringRent: sum(expiring.map((u) => u.expiryRent)),
      top: [...props].sort((a, b) => b.budget - a.budget).slice(0, 10),
      movers: [...props].filter((p) => Math.abs(p.change) > 0.5).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10).sort((a, b) => b.change - a.change),
      buCat,
      expiry,
    };
  }, [units, data.bus, bu, propById]);

  const change = m.priorTotal ? (m.total - m.priorTotal) / m.priorTotal : null;
  const noLeases = data.units.every((u: DashUnit) => !u.leased);
  const monthLabels = MONTHS.map((x) => x.slice(0, 3));
  const filtered = bu.length + pm.length + cat.length + prop.length > 0;
  const buN = count((u) => u.bu);
  const pmN = count((u) => u.pm);
  const catN = count((u) => u.category);
  const propN = count((u) => String(u.propertyId));

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="page-title">{data.versionName}</h1>
          <p className="page-sub">
            {locked ? 'Locked — read only' : 'Open for input'} · AED · compared with {data.priorName ?? 'no prior budget'}
          </p>
        </div>
      </header>

      {/* one filter row; it scopes every tile and chart below */}
      <div className="card flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
        <MultiSelect
          label="Business unit"
          value={bu}
          onChange={(v) => {
            setBu(v);
            setProp([]);
          }}
          options={data.bus.map((b) => ({ value: b, label: b, count: buN.get(b) }))}
        />
        <MultiSelect
          label="Property manager"
          value={pm}
          onChange={(v) => {
            setPm(v);
            setProp([]);
          }}
          options={data.pms.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase(), count: pmN.get(p) }))}
        />
        <MultiSelect label="Category" value={cat} onChange={setCat} options={CATEGORIES.map((c) => ({ value: c, label: c, count: catN.get(c) ?? 0 }))} />
        <MultiSelect
          label="Property"
          width="w-72"
          value={prop}
          onChange={setProp}
          options={propOptions.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.code}`, count: propN.get(String(p.id)) }))}
        />
        {filtered && (
          <button
            className="btn btn-xs"
            onClick={() => {
              setBu([]);
              setPm([]);
              setCat([]);
              setProp([]);
            }}
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">{m.units} units in view</span>
      </div>

      {noLeases && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-700">
          No current leases are entered for {data.versionName} yet, so the {B} figures are empty. Enter them in the{' '}
          <Link href="/master" className="font-semibold underline">
            Lease Budget
          </Link>{' '}
          or load the latest Fusion export in{' '}
          <Link href="/admin?tab=fusion" className="font-semibold underline">
            Admin → Fusion data
          </Link>
          .
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={`Revenue ${B}`}
          value={compact(m.total)}
          delta={change === null ? undefined : `${pctTxt(change)} vs ${P}`}
          deltaGood={change === null ? undefined : change >= 0}
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
        <StatTile label={`Leases expiring in ${data.year}`} value={String(m.expiringCount)} sub={`${compact(m.expiringRent)} of annual rent`} />
        <StatTile label="Open issues" value={String(m.issues)} sub={m.issues ? 'Rows to review in Lease Budget' : 'None'} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Revenue by month · ${B} vs ${P}`}
          sub="Budget revenue recognised each month"
          legend={<Legend shape="line" items={[{ label: B, color: SERIES[0] }, { label: P, color: MUTED_SERIES }]} />}
          table={{ head: ['Month', B, P, 'Change'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, Math.round(m.budget[i]), Math.round(m.prior[i]), Math.round(m.budget[i] - m.prior[i])]) }}
        >
          <LineChart
            labels={monthLabels}
            series={[
              { name: P, color: MUTED_SERIES, values: m.prior },
              { name: B, color: SERIES[0], values: m.budget },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={`Revenue vs cash inflow · ${data.year}`}
          sub="Cash follows the cheque schedules; it includes VAT and security deposits"
          legend={<Legend items={[{ label: 'Revenue', color: SERIES[0] }, { label: 'Cash inflow', color: SERIES[2] }]} />}
          table={{ head: ['Month', 'Revenue', 'Cash inflow', 'Cash − revenue'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, Math.round(m.budget[i]), Math.round(m.cash[i]), Math.round(m.cash[i] - m.budget[i])]) }}
        >
          <Columns
            labels={monthLabels}
            series={[
              { name: 'Revenue', color: SERIES[0], values: m.budget },
              { name: 'Cash inflow', color: SERIES[2], values: m.cash },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue mix · business unit by category"
          sub={`${B} revenue`}
          legend={<Legend items={CATEGORIES.filter((c) => m.buCat.some((r) => r.values[CATEGORIES.indexOf(c)] > 0)).map((c) => ({ label: c, color: CAT_COLOR[c] }))} />}
          table={{ head: ['Business unit', ...CATEGORIES, 'Total'], rows: m.buCat.map((r) => [r.label, ...r.values.map(Math.round), Math.round(sum(r.values))]) }}
        >
          <HBars labelWidth={80} rows={m.buCat} series={CATEGORIES.map((c) => ({ name: c, color: CAT_COLOR[c] }))} />
        </ChartCard>

        <ChartCard
          title={`Occupancy by month · ${data.year}`}
          sub="Share of units earning rent in the month"
          table={{ head: ['Month', 'Occupancy %'], rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, `${(m.occ[i] * 100).toFixed(1)}%`]) }}
        >
          <LineChart labels={monthLabels} series={[{ name: 'Occupancy', color: SERIES[0], values: m.occ.map((v) => v * 100) }]} fmt={(n) => `${Math.round(n)}%`} min={Math.max(0, Math.floor((Math.min(...m.occ) * 100 - 5) / 10) * 10)} />
        </ChartCard>

        <ChartCard
          title="Top 10 properties"
          sub={`${B} revenue, with change vs ${P}`}
          table={{ head: ['Property', B, P, 'Change'], rows: m.top.map((p) => [p.name, Math.round(p.budget), Math.round(p.prior), Math.round(p.change)]) }}
        >
          <HBars
            rows={m.top.map((p) => ({ label: p.name, values: [p.budget], note: p.prior ? pctTxt((p.budget - p.prior) / p.prior) : undefined }))}
            series={[{ name: B, color: SERIES[0] }]}
            note={(r) => r.note}
          />
        </ChartCard>

        <ChartCard
          title={`Biggest movers vs ${P}`}
          sub="Change in budget revenue by property"
          table={{ head: ['Property', B, P, 'Change'], rows: m.movers.map((p) => [p.name, Math.round(p.budget), Math.round(p.prior), Math.round(p.change)]) }}
        >
          <HBars diverging rows={m.movers.map((p) => ({ label: p.name, values: [p.change] }))} series={[{ name: 'Change', color: SERIES[0] }]} />
        </ChartCard>

        <ChartCard
          className="xl:col-span-2"
          title={`Lease expiry profile · ${data.year}`}
          sub="Annual rent of current leases ending each month, by budgeted outcome"
          legend={<Legend items={OUTCOMES.map((o) => ({ label: o, color: OUTCOME_COLOR[o] }))} />}
          table={{
            head: ['Month', ...OUTCOMES, 'Total'],
            rows: MONTHS.map((mo, i) => [`${mo}-${yy}`, ...m.expiry.map((s) => Math.round(s[i])), Math.round(sum(m.expiry.map((s) => s[i])))]),
          }}
        >
          <Columns stacked labels={monthLabels} series={OUTCOMES.map((o, k) => ({ name: o, color: OUTCOME_COLOR[o], values: m.expiry[k] }))} height={200} />
        </ChartCard>
      </div>
    </div>
  );
}
