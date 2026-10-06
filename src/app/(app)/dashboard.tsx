'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { DashboardData, DashUnit, ExpiryOutcome } from '@/lib/budget/dashboard';
import { CATEGORIES } from '@/lib/budget/category';
import { MONTHS } from '@/lib/format';
import { ChartCard, Columns, HBars, Legend, LineChart, StatTile, compact } from '@/components/charts';
import { CATEGORY_COLOR, MEASURE, OUTCOME_COLOR } from '@/lib/segments';
import { MultiSelect } from '@/components/multi-select';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const z12 = () => Array(12).fill(0) as number[];
const add12 = (acc: number[], v: number[] | null) => (v ? acc.map((x, i) => x + v[i]) : acc);
const pctTxt = (n: number | null, d = 1) => (n === null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(d)}%`);

// ---- rent per sq ft: area-weighted (total annual rent ÷ total let sq ft); camps are priced per bed, so left out
const SIZE_BANDS: [number, number, string][] = [
  [0, 500, '< 500'],
  [500, 1000, '500–1k'],
  [1000, 2000, '1k–2k'],
  [2000, 5000, '2k–5k'],
  [5000, 10000, '5k–10k'],
  [10000, 50000, '10k–50k'],
  [50000, Infinity, '50k +'],
];
const psf1 = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const aedPsf = (n: number) => `AED ${psf1(n)}`;
type PsfAgg = { units: number; area: number; letArea: number; rent: number };
function psfBy(units: DashUnit[], key: (u: DashUnit) => string) {
  const m = new Map<string, PsfAgg>();
  for (const u of units) {
    const a = m.get(key(u)) ?? { units: 0, area: 0, letArea: 0, rent: 0 };
    a.units++;
    a.area += u.area!;
    if (u.passing > 0) {
      a.letArea += u.area!;
      a.rent += u.passing;
    }
    m.set(key(u), a);
  }
  return [...m].map(([label, a]) => ({ label, ...a, psf: a.letArea > 0 ? a.rent / a.letArea : NaN })).filter((r) => r.letArea > 0);
}
const OUTCOMES: ExpiryOutcome[] = ['Renew', 'New tenant', 'Not re-let'];

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
    // rent per sq ft (current budget units with a known area, camps excluded)
    const sq = units.filter((u) => u.revenue && u.area && u.category !== 'Camps');
    const psfAll = psfBy(sq, () => 'all')[0];
    const psfProp = psfBy(sq, (u) => propById.get(u.propertyId)?.name ?? String(u.propertyId)).sort((a, b) => b.psf - a.psf);
    const psfLoc = psfBy(sq, (u) => u.location).sort((a, b) => b.psf - a.psf);
    const psfType = psfBy(sq, (u) => u.type).sort((a, b) => b.letArea - a.letArea).slice(0, 15).sort((a, b) => b.psf - a.psf);
    const psfCats = CATEGORIES.filter((c) => c !== 'Camps' && sq.some((u) => u.category === c && u.passing > 0));
    const psfBands = SIZE_BANDS.map(([lo, hi, label]) => {
      const inBand = sq.filter((u) => u.area! >= lo && u.area! < hi);
      const byCat = new Map(psfBy(inBand, (u) => u.category).map((r) => [r.label, r]));
      return { label, byCat, all: psfBy(inBand, () => 'all')[0] };
    }).filter((b) => b.all);
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
      psfAll,
      psfProp,
      psfLoc,
      psfType,
      psfCats,
      psfBands,
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
    <div className="anh-main">
      <header className="anh-pagehead">
        <div>
          <span className="anh-eyebrow">Dashboard</span>
          <h1>{data.versionName}</h1>
          <p className="page-sub mt-1">
            {locked ? 'Locked, read only' : 'Open for input'} · AED · vs {data.priorName ?? 'no prior budget'}
          </p>
        </div>
      </header>

      {/* one filter row; it scopes every tile and chart below */}
      <div className="anh-filterbar text-[13px]">
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
          or import the Tenant and Lease Details Report in{' '}
          <Link href="/admin?tab=fusion" className="font-semibold underline">
            Admin → Lease data
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
        <StatTile label={`Leases expiring in ${data.year}`} value={String(m.expiringCount)} sub={`${compact(m.expiringRent)} of annual rent`} />
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

      <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
        <h2 className="text-base font-semibold text-slate-900">Rent per sq ft</h2>
        <span className="text-xs text-slate-500">
          Passing rent (current contract, annualised) ÷ let sq ft, area-weighted · camps excluded (priced per bed)
          {m.psfAll && <> · portfolio in view: <b className="text-slate-700">{aedPsf(m.psfAll.psf)}</b> on {compact(m.psfAll.letArea)} sq ft let</>}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="By building"
          sub="AED per sq ft per year, highest first · label: let area"
          table={{ head: ['Property', 'AED / sq ft', 'Let sq ft', 'Total sq ft', 'Units'], rows: m.psfProp.map((r) => [r.label, psf1(r.psf), Math.round(r.letArea), Math.round(r.area), r.units]) }}
        >
          <HBars
            labelWidth={190}
            rows={m.psfProp.map((r) => ({ label: r.label, values: [r.psf], note: `${compact(r.letArea)} sq ft` }))}
            series={[{ name: 'AED / sq ft', color: MEASURE.budget }]}
            fmt={psf1}
            tipFmt={aedPsf}
            note={(r) => r.note}
          />
        </ChartCard>

        <div className="space-y-4">
          <ChartCard
            title="By location"
            sub="AED per sq ft per year by community (Admin → Properties sets the location)"
            table={{ head: ['Location', 'AED / sq ft', 'Let sq ft', 'Total sq ft', 'Units'], rows: m.psfLoc.map((r) => [r.label, psf1(r.psf), Math.round(r.letArea), Math.round(r.area), r.units]) }}
          >
            <HBars
              labelWidth={150}
              rows={m.psfLoc.map((r) => ({ label: r.label, values: [r.psf], note: `${compact(r.letArea)} sq ft` }))}
              series={[{ name: 'AED / sq ft', color: MEASURE.budget }]}
              fmt={psf1}
              tipFmt={aedPsf}
              note={(r) => r.note}
            />
          </ChartCard>

          <ChartCard
            title="By unit type"
            sub="Oracle unit type · the 15 types with the most let area"
            table={{ head: ['Unit type', 'AED / sq ft', 'Let sq ft', 'Total sq ft', 'Units'], rows: m.psfType.map((r) => [r.label, psf1(r.psf), Math.round(r.letArea), Math.round(r.area), r.units]) }}
          >
            <HBars
              labelWidth={170}
              rows={m.psfType.map((r) => ({ label: r.label, values: [r.psf], note: `${r.units} units` }))}
              series={[{ name: 'AED / sq ft', color: MEASURE.budget }]}
              fmt={psf1}
              tipFmt={aedPsf}
              note={(r) => r.note}
            />
          </ChartCard>

          <ChartCard
            title="By unit size and category"
            sub="AED per sq ft per year for each size band (sq ft)"
            legend={<Legend items={m.psfCats.map((c) => ({ label: c, color: CATEGORY_COLOR[c] }))} />}
            table={{
              head: ['Size (sq ft)', ...m.psfCats, 'All', 'Let sq ft'],
              rows: m.psfBands.map((b) => [b.label, ...m.psfCats.map((c) => psf1(b.byCat.get(c)?.psf ?? NaN)), psf1(b.all.psf), Math.round(b.all.letArea)]),
            }}
          >
            <Columns
              labels={m.psfBands.map((b) => b.label)}
              series={m.psfCats.map((c) => ({ name: c, color: CATEGORY_COLOR[c], values: m.psfBands.map((b) => b.byCat.get(c)?.psf ?? 0) }))}
              fmt={(n) => String(Math.round(n))}
              tipFmt={aedPsf}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
