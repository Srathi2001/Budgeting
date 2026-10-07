'use client';

// Dashboard card: last year's budget against its forecast (Oracle actuals to the last closed month +
// Lease Budget projection), by building or by month. Figures come from the server, scoped to the
// page filters.

import { useState } from 'react';
import { BarList, Columns, Legend, compact } from '@/components/charts';
import type { BudgetVsForecast } from '@/lib/budget/budget-vs-forecast';
import { MONTHS } from '@/lib/format';
import { MEASURE } from '@/lib/segments';

type View = 'building' | 'month';
const VIEWS: { key: View; label: string }[] = [
  { key: 'building', label: 'By building' },
  { key: 'month', label: 'By month' },
];

const signed = (n: number) => `${n < 0 ? '−' : '+'}${compact(Math.abs(n))}`;
const pct = (f: number, b: number) => (b ? `${f - b < 0 ? '−' : '+'}${Math.abs(((f - b) / b) * 100).toFixed(1)}%` : '–');

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border border-[var(--line)] px-3 py-2">
      <div className="truncate text-[11px] font-bold text-[var(--ink)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      <div className="text-[11px] tabular-nums text-[var(--ink-muted)]">{sub}</div>
    </div>
  );
}

export function BudgetVsForecastCard({ data }: { data: BudgetVsForecast }) {
  const [view, setView] = useState<View>('building');
  const B = `${data.year}B`;
  const F = `${data.year}F`;
  const m = (i: number) => MONTHS[i - 1];
  const lastLabel = data.lastActualMonth >= 12 ? `actual Jan–Dec` : `actual Jan–${m(data.lastActualMonth)} + projected ${m(data.lastActualMonth + 1)}–Dec`;

  return (
    <section className="anh-card">
      <header className="anh-card__head flex-wrap gap-y-2">
        <div className="min-w-0">
          <h2 className="anh-card__title">
            {B} vs {F}
          </h2>
          <p className="anh-card__sub">
            Rental revenue: {data.budgetName} against {F} ({lastLabel} from the Lease Budget) · AED
          </p>
        </div>
        <div className="anh-seg shrink-0" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <div className="anh-card__body space-y-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          <Tile label={B} value={compact(data.budget)} sub={`${data.properties.length} properties`} />
          <Tile label={F} value={compact(data.forecast)} sub={`actual ${compact(data.forecastActual)} · projected ${compact(data.forecastProjected)}`} />
          <Tile label={`${F} − ${B}`} value={signed(data.forecast - data.budget)} sub={pct(data.forecast, data.budget)} />
          {data.bus.map((b) => (
            <Tile key={b.code} label={`${b.code} ${b.name}`} value={signed(b.forecast - b.budget)} sub={`${pct(b.forecast, b.budget)} · ${B} ${compact(b.budget)}`} />
          ))}
        </div>

        {view === 'building' &&
          data.bus.map((b) => {
            const rows = data.properties.filter((p) => p.bu === b.code).sort((x, y) => Math.abs(y.forecast - y.budget) - Math.abs(x.forecast - x.budget));
            return (
              <div key={b.code}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 className="text-[13px] font-bold text-[var(--ink)]">
                    {b.code} {b.name}
                  </h3>
                  <span className="text-[11px] text-[var(--ink-muted)]">
                    {rows.length} building{rows.length === 1 ? '' : 's'} · largest difference first
                  </span>
                </div>
                <BarList
                  diverging
                  limit={8}
                  color={MEASURE.budget}
                  valueFmt={signed}
                  rows={rows.map((p) => ({
                    key: String(p.id),
                    label: p.name,
                    value: p.forecast - p.budget,
                    note: pct(p.forecast, p.budget),
                    tip: `${B} ${compact(p.budget)} · ${F} ${compact(p.forecast)} · ${signed(p.forecast - p.budget)} (${pct(p.forecast, p.budget)})`,
                  }))}
                />
              </div>
            );
          })}

        {view === 'month' && (
          <div>
            <div className="mb-3">
              <Legend
                items={[
                  { label: B, color: MEASURE.prior },
                  { label: `${F} (actual to ${m(data.lastActualMonth)}, then projected)`, color: MEASURE.budget },
                ]}
              />
            </div>
            <Columns
              labels={MONTHS.map((x, i) => (i < data.lastActualMonth ? x.slice(0, 3) : `${x.slice(0, 3)}·p`))}
              series={[
                { name: B, color: MEASURE.prior, values: data.months.budget },
                { name: F, color: MEASURE.budget, values: data.months.actual.map((a, i) => a ?? data.months.projected[i] ?? 0) },
              ]}
              height={220}
            />
          </div>
        )}

        <p className="text-[11px] text-[var(--ink-muted)]">
          {F} is Oracle&apos;s recognised rent to the last closed month plus the Lease Budget for the rest (·p = projected month).
          {data.excluded > 0 && ` ${data.excluded} propert${data.excluded === 1 ? 'y' : 'ies'} without Oracle actuals (PMC) left out.`} Actuals are per property: the
          Category filter picks properties.
        </p>
      </div>
    </section>
  );
}
