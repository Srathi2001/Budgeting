'use client';

// FM Budget summary: the full picture of what facilities management entered, for Finance to check.
// Each facility opens in the FM Budget Template.

import { ChartCard, Columns, Legend, StatTile, compact } from '@/components/charts';
import { CheckList, SummaryHead, SummaryTable, Card, change, sum } from '@/components/summary-kit';
import { MONTHS, pct, pctSigned } from '@/lib/format';
import { MEASURE } from '@/lib/segments';
import type { FmSummary as Data } from '@/lib/budget/fm-summary';
import { STAFF_TEAMS } from '@/lib/budget/fm-types';

const STATUS: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', APPROVED: 'Approved', RETURNED: 'Returned' };
const PHASE = [
  { key: 'maintenance', label: 'Maintenance', color: 'var(--cat-materials)' },
  { key: 'repairs', label: 'Major repairs & refurbishment', color: 'var(--cat-overheads)' },
  { key: 'capexItems', label: 'Capex items', color: 'var(--cat-plant)' },
  { key: 'fmStaff', label: 'FM staff', color: 'var(--cat-labour)' },
] as const;

export function FmSummary({ data: d }: { data: Data }) {
  const B = `${d.year}B`;
  const P = d.priorLabel;
  const A = d.actualLabel;
  const fs = d.facilities;
  const works = sum(fs.map((f) => f.budget));
  const priorWorks = P ? sum(fs.map((f) => f.prior)) : null;
  const staff = sum(fs.map((f) => f.staffTotal));
  const priorStaff = P ? sum(fs.map((f) => f.priorStaffTotal)) : null;
  const total = works + staff;
  const priorTotal = priorWorks === null ? null : priorWorks + (priorStaff ?? 0);
  const entered = fs.filter((f) => f.lines > 0).length;
  const by = (s: string) => fs.filter((f) => f.status === s).length;
  const provisional = d.kinds.find((k) => k.label === 'Provisional')?.amount ?? 0;
  const delta = (b: number, p: number | null) => (p && b ? { delta: pctSigned((b - p) / p), deltaDir: b >= p ? ('up' as const) : ('down' as const) } : {});
  const link = (id: number) => `/fm?f=${id}`;
  const name = (f: Data['facilities'][number]) => `${f.code} ${f.name}`;

  return (
    <div className="anh-main">
      <SummaryHead
        eyebrow="FM Budget · Summary"
        title={d.versionName}
        sub={`${fs.length} facilities in view · ${P ? `${P} from the FMD budget file` : 'no budget for last year'} · actuals ${A} (GL 627xx / 117xx) · AED`}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label={`FM cost ${B}`} value={compact(total)} sub={priorTotal === null ? 'Works + FM staff' : `${P}: ${compact(priorTotal)}`} {...delta(total, priorTotal)} />
        <StatTile label={`Works ${B}`} value={compact(works)} sub={`${A}: ${compact(sum(fs.map((f) => f.actual)))}`} {...delta(works, priorWorks)} />
        <StatTile label={`FM staff ${B}`} value={compact(staff)} sub={d.unallocated ? `${compact(d.unallocated)} not allocated` : 'Allocated to the facilities'} {...delta(staff, priorStaff)} />
        <StatTile label="Facilities entered" value={`${entered} of ${fs.length}`} sub="With at least one cost line" />
        <StatTile label="Submitted" value={`${by('SUBMITTED') + by('APPROVED')} of ${fs.length}`} sub={`${by('APPROVED')} approved · ${by('RETURNED')} returned`} />
        <StatTile label="Provisional works" value={compact(provisional)} sub={works ? `${pct(provisional / works)} of the works` : 'Only if the need arises'} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Works by type · ${[P, A, B].filter(Boolean).join(', ')}`}
          sub="Maintenance (M) and renewal (R) work types, the facilities in view"
          legend={
            <Legend
              items={[
                ...(P ? [{ label: P, color: MEASURE.prior }] : []),
                { label: A, color: MEASURE.cash },
                { label: B, color: MEASURE.budget },
              ]}
            />
          }
          table={{
            head: ['Work type', ...(P ? [P] : []), A, B, `Change vs ${P ?? A}`],
            rows: [
              ...d.workTypes.map((w) => [`${w.code} ${w.label}`, ...(P ? [w.prior ?? 0] : []), w.actual, w.budget, works ? change(w.budget, w.prior ?? w.actual) : '–']),
              ['Total', ...(P ? [sum(d.workTypes.map((w) => w.prior))] : []), sum(d.workTypes.map((w) => w.actual)), works, works ? change(works, priorWorks) : '–'],
            ],
          }}
        >
          <Columns
            labels={d.workTypes.map((w) => w.code)}
            series={[
              ...(P ? [{ name: P, color: MEASURE.prior, values: d.workTypes.map((w) => w.prior ?? 0) }] : []),
              { name: A, color: MEASURE.cash, values: d.workTypes.map((w) => w.actual) },
              { name: B, color: MEASURE.budget, values: d.workTypes.map((w) => w.budget) },
            ]}
            height={240}
          />
        </ChartCard>

        <ChartCard
          title={`${B} by month`}
          sub="Maintenance and FM staff over the year; major repairs, refurbishment and capex items in the month planned"
          legend={<Legend items={PHASE.map((p) => ({ label: p.label, color: p.color }))} />}
          table={{
            head: ['Month', ...PHASE.map((p) => p.label), 'Total'],
            rows: MONTHS.map((m, i) => [m, ...PHASE.map((p) => d.months[p.key][i]), sum(PHASE.map((p) => d.months[p.key][i]))]),
          }}
        >
          <Columns stacked labels={MONTHS} series={PHASE.map((p) => ({ name: p.label, color: p.color, values: d.months[p.key] }))} height={240} />
        </ChartCard>

        <Card title={`Works by kind and business need · ${B}`} sub="Planned, provisional (only if the need arises) and open commitments; the need given on each line">
          <div className="grid gap-4 2xl:grid-cols-2">
            <SummaryTable
              className=""
              head={['Kind', 'Lines', B, 'Share']}
              int={[1]}
              rows={[...d.kinds.map((k) => ({ cells: [k.label, k.lines, k.amount, works ? pct(k.amount / works) : '–'] })), { cells: ['Total', sum(d.kinds.map((k) => k.lines)), works, '100.00%'], kind: 'total' as const }]}
            />
            <SummaryTable
              className=""
              head={['Business need', 'Lines', B, 'Share']}
              int={[1]}
              rows={[...d.needs.map((k) => ({ cells: [k.label, k.lines, k.amount, works ? pct(k.amount / works) : '–'] })), { cells: ['Total', sum(d.needs.map((k) => k.lines)), works, '100.00%'], kind: 'total' as const }]}
            />
          </div>
        </Card>

        <Card title={`FM staff by team · ${P ? `${P} vs ` : ''}${B}`} sub="Cost to company and overtime as entered in Labour allocation; with the G&A share spread over the teams">
          <SummaryTable
            className=""
            head={['Team', ...(P ? [P] : []), 'Cost to company', 'Overtime', 'With G&A share', 'Change']}
            rows={[
              ...d.staff.map((s) => ({
                // the G&A share row: as entered (it is spread over the teams above)
                cells: [STAFF_TEAMS.find((t) => t.code === s.team)?.label ?? s.team, ...(P ? [s.prior ? (s.team === 'GA' ? s.prior.ctc : s.prior.cost) : null] : []), s.ctc, s.team === 'GA' ? null : s.overtime, s.team === 'GA' ? null : s.cost, s.team === 'GA' || !s.cost ? '–' : change(s.cost, s.prior?.cost ?? null)],
              })),
              {
                cells: ['Total', ...(P ? [sum(d.staff.map((s) => s.prior?.cost))] : []), sum(d.staff.map((s) => s.ctc)), sum(d.staff.map((s) => s.overtime)), sum(d.staff.map((s) => s.cost)), staff ? change(sum(d.staff.map((s) => s.cost)), P ? sum(d.staff.map((s) => s.prior?.cost)) : null) : '–'],
                kind: 'total',
              },
            ]}
          />
        </Card>
      </div>

      <Card title="By facility" sub={`Click a facility to open it in the FM Budget Template · works ${P ? `${P}, ` : ''}${A} and ${B}, FM staff allocated`}>
        <SummaryTable
          head={['Facility', 'BU', 'Zone', 'Status', 'Lines', ...(P ? [`${P} works`] : []), A, `${B} works`, 'Change', `${B} FM staff`, `${B} total`]}
          int={[4]}
          rows={[
            ...fs.map((f) => ({
              href: link(f.id),
              cells: [name(f), f.bu, f.zone ?? '–', STATUS[f.status], f.lines, ...(P ? [f.prior] : []), f.actual, f.budget, f.lines ? change(f.budget, f.prior) : '–', f.staffTotal, f.budget + f.staffTotal],
            })),
            { kind: 'total', cells: ['Total', '', '', '', sum(fs.map((f) => f.lines)), ...(P ? [priorWorks] : []), sum(fs.map((f) => f.actual)), works, works ? change(works, priorWorks) : '–', staff, total] },
          ]}
        />
      </Card>

      <Card title={`Largest lines · ${B}`} sub="The 15 biggest cost lines in view">
        <SummaryTable
          className=""
          head={['Facility', 'Work type', 'Element', 'Description', 'Kind', 'Business need', B]}
          rows={d.largest.map((l) => ({ href: link(l.facilityId), cells: [l.facility, l.workType, l.element, l.description || '–', l.kind, l.need || '–', l.amount] }))}
        />
      </Card>

      <Card title="Check these" sub="Rules of thumb, not errors: each one is worth a look before the budget is approved">
        <CheckList
          groups={[
            { title: 'No cost lines entered', items: fs.filter((f) => !f.lines).map((f) => ({ what: name(f), why: P && f.prior ? `${P} ${compact(f.prior)}` : `${A} ${compact(f.actual)}`, href: link(f.id) })) },
            {
              title: `Works up or down more than 25% on ${P ?? A}`,
              items: fs
                .filter((f) => f.lines && Math.abs(f.budget - (f.prior ?? f.actual)) > 50_000 && (f.prior ?? f.actual) > 0 && Math.abs(f.budget - (f.prior ?? f.actual)) / (f.prior ?? f.actual) > 0.25)
                .sort((a, b) => Math.abs(b.budget - (b.prior ?? b.actual)) - Math.abs(a.budget - (a.prior ?? a.actual)))
                .map((f) => ({ what: name(f), why: `${compact(f.prior ?? f.actual)} → ${compact(f.budget)} (${change(f.budget, f.prior ?? f.actual)})`, href: link(f.id) })),
            },
            { title: `Works over twice ${A}`, items: fs.filter((f) => f.actual > 0 && f.budget > 2 * f.actual && f.budget - f.actual > 50_000).map((f) => ({ what: name(f), why: `${compact(f.actual)} → ${compact(f.budget)}`, href: link(f.id) })) },
            { title: 'Renewal works with no month (spread over the year)', items: d.noMonth.map((l) => ({ what: `${l.facility} · ${l.workType}`, why: compact(l.amount), href: link(l.facilityId) })) },
            { title: 'Entered, not submitted', items: fs.filter((f) => f.lines && (f.status === 'DRAFT' || f.status === 'RETURNED')).map((f) => ({ what: name(f), why: STATUS[f.status], href: link(f.id) })) },
            ...(d.unallocated ? [{ title: 'FM staff not allocated', items: [{ what: 'Teams with no facility to spread over', why: compact(d.unallocated), href: '/fm?tab=labour' }] }] : []),
          ]}
        />
      </Card>
    </div>
  );
}
