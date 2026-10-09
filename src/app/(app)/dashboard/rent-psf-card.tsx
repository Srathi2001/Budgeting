'use client';

// Dashboard card: rent per sq ft by use group, with three views (by building, unit type, location).
// The figures come from the server (lib/budget/rent-psf), already scoped to the page filters.

import { useState } from 'react';
import { BarList } from '@/components/charts';
import { count, fmt, short } from '@/lib/format';
import type { PsfStat, RentPsf } from '@/lib/budget/rent-psf';
import { MEASURE } from '@/lib/segments';

type View = 'building' | 'type' | 'location';
const VIEWS: { key: View; label: string }[] = [
  { key: 'building', label: 'By building' },
  { key: 'type', label: 'By unit type' },
  { key: 'location', label: 'By location' },
];

const psf1 = (n: number) => fmt(n);
/** let area: 79.7K, 3.37M */
const sqft = (n: number) => (n >= 1e3 ? short(n) : count(Math.round(n)));
const tipOf = (s: PsfStat) => [
  { label: 'Rent', value: `AED ${psf1(s.psf)} / sq ft` },
  { label: 'Let area', value: `${sqft(s.area)} sq ft` },
  { label: 'Units', value: String(s.units) },
];

function Tile({ label, stat, units }: { label: string; stat: PsfStat; units?: boolean }) {
  return (
    <div className="border border-[var(--line)] px-3 py-2">
      <div className="truncate text-[11px] font-bold text-[var(--ink)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--ink)]">
        AED {psf1(stat.psf)}
        <span className="ml-1 text-[11px] font-normal text-[var(--ink-muted)]">/ sq ft</span>
      </div>
      <div className="text-[11px] tabular-nums text-[var(--ink-muted)]">
        {short(stat.area)} sq ft{units ? ` · ${stat.units} units` : ''}
      </div>
    </div>
  );
}

export function RentPsfCard({ data }: { data: RentPsf }) {
  const [view, setView] = useState<View>('building');
  const rowsOf = (items: ({ key: string; label: string } & PsfStat)[]) =>
    items.map((s) => ({ key: s.key, label: s.label, value: s.psf, note: sqft(s.area), tip: tipOf(s) }));

  return (
    <section className="anh-card">
      <header className="anh-card__head flex-wrap gap-y-2">
        <div className="min-w-0">
          <h2 className="anh-card__title">Rent per sq ft</h2>
          <p className="anh-card__sub">Passing rent (current contract, annualised) ÷ let sq ft, area-weighted, AED per sq ft a year · camps excluded (priced per bed)</p>
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
        {!data.total ? (
          <div className="py-6 text-center text-xs text-slate-500">No leased units with an area for this selection</div>
        ) : (
          <>
            {/* summary strip: the portfolio and each use group in view */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              <Tile label="Portfolio" stat={data.total} />
              {data.groups.map((g) => (
                <Tile key={g.key} label={g.label} stat={g.stat} units />
              ))}
            </div>

            {view === 'building' &&
              data.groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <h3 className="text-[13px] font-bold text-[var(--ink)]">{g.label}</h3>
                    <span className="text-[11px] text-[var(--ink-muted)]">
                      {g.buildings.length} building{g.buildings.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <BarList limit={8} color={MEASURE.budget} rows={rowsOf(g.buildings.map((b) => ({ key: String(b.id), label: b.name, ...b })))} />
                </div>
              ))}
            {view === 'type' && <BarList color={MEASURE.budget} rows={rowsOf(data.unitTypes.map((t) => ({ key: t.label, ...t })))} />}
            {view === 'location' && <BarList color={MEASURE.budget} rows={rowsOf(data.locations.map((t) => ({ key: t.label, ...t })))} />}
          </>
        )}
        <p className="text-[11px] text-[var(--ink-muted)]">
          Leased units with an area only. Whole-building leases are single negotiated deals, shown on their own so they don&apos;t distort the use averages. Unit type is
          Oracle&apos;s.
        </p>
      </div>
    </section>
  );
}
