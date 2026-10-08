'use client';

// Dashboard report cards: rent by year, other income by GL account (uploaded actuals), operating costs
// and building capex. Figures come from the server, scoped to the page filters.

import { BarList, ChartCard, Columns, Legend, compact } from '@/components/charts';
import { OI_TYPES, type DashboardReports } from '@/lib/budget/dashboard-reports-types';
import { MEASURE, OI_TYPE_COLOR, buColor } from '@/lib/segments';
import { fmt, pct as pctOf, pctSigned } from '@/lib/format';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (n: number | null) => (n === null || !Number.isFinite(n) ? '–' : pctSigned(n));
const share = (part: number, whole: number) => (whole ? pctOf(part / whole) : '–');
const r0 = (n: number | null) => (n === null ? '–' : Math.round(n));

const OI_COLOR = OI_TYPE_COLOR;
const COST_COLOR = { maintenance: 'var(--cat-materials)', capex: 'var(--cat-plant)' };
/** axis labels of the element groups (full names in the legend-free table and tooltips) */
const CAPEX_SHORT: Record<string, string> = {
  'AC / HVAC': 'HVAC',
  'Fire, security & FFE': 'Fire & FFE',
  'Civil & structure': 'Civil',
  'Finishes & refurbishment': 'Finishes',
  'MEP & services': 'MEP',
  Other: 'Other',
};

/** a plain reporting table: first column text, the rest amounts (null = not budgeted / not available) */
function Grid({ head, rows, className = '' }: { head: string[]; rows: { cells: (string | number | null)[]; kind?: 'section' | 'subtotal' | 'total' }[]; className?: string }) {
  return (
    <div className={`anh-grid-wrap ${className}`}>
      <table className="anh-grid">
        <thead>
          <tr className="h1">
            {head.map((h, i) => (
              <th key={h + i} className={i ? 'anh-num' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.kind ?? ''}>
              {r.cells.map((c, j) => (
                <td key={j} className={j ? 'anh-num' : ''}>
                  {c === null ? '–' : typeof c === 'number' ? fmt(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`anh-card ${className}`}>
      <header className="anh-card__head">
        <div className="min-w-0">
          <h2 className="anh-card__title">{title}</h2>
          {sub && <p className="anh-card__sub">{sub}</p>}
        </div>
      </header>
      <div className="anh-card__body">{children}</div>
    </section>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 border-b border-[var(--line)] pb-1.5">
      <h2 className="text-[15px] font-bold text-[var(--ink)]">{title}</h2>
      {sub && <span className="text-[12px] text-[var(--ink-muted)]">{sub}</span>}
    </header>
  );
}

export function RentByYearCard({ data }: { data: DashboardReports }) {
  const { bus, years } = data.rentByYear;
  const totals = years.map((y) => sum(Object.values(y.byBu).map((v) => v ?? 0)));
  return (
    <ChartCard
      title={`Rent by year · ${years[0]?.label ?? ''} to ${data.labels.B}`}
      sub="Oracle recognised rent, the prior budget, the forecast and the budget, by business unit · growth like for like (properties with a figure in both years)"
      legend={<Legend items={bus.map((b) => ({ label: `${b.code} ${b.name}`, color: buColor(b.code) }))} />}
      table={{
        head: ['Year', ...bus.map((b) => `${b.code} ${b.name}`), 'Total', 'Properties', 'Growth', 'On', 'Source'],
        rows: years.map((y, i) => [y.label, ...bus.map((b) => r0(y.byBu[b.code])), Math.round(totals[i]), y.properties, pct(y.growth), y.base ?? '–', y.source]),
      }}
    >
      <Columns stacked labels={years.map((y) => y.label)} series={bus.map((b) => ({ name: `${b.code} ${b.name}`, color: buColor(b.code), values: years.map((y) => y.byBu[b.code] ?? 0) }))} height={240} />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-[var(--ink-muted)]">
        {years
          .filter((y) => y.base)
          .map((y) => (
            <li key={y.label}>
              {y.label} on {y.base} <b className="text-[var(--ink)]">{pct(y.growth)}</b>
            </li>
          ))}
        {years.some((y) => bus.some((b) => y.byBu[b.code] === null)) && <li>– business units with no figure for the year (PMC: not in the Revenue Recognition Summary)</li>}
      </ul>
    </ChartCard>
  );
}

export function OtherIncomeCard({ data }: { data: DashboardReports }) {
  const { A2, A1, oiYtd } = data.labels;
  const oi = data.otherIncome;
  const cols = [
    { label: A2, k: 'a2' as const },
    { label: A1, k: 'a1' as const },
    { label: oiYtd, k: 'ytd' as const },
  ];
  const typeTotal = (t: string, k: 'a2' | 'a1' | 'ytd') => sum(oi.accounts.filter((a) => a.type === t).map((a) => a[k]));
  const types = OI_TYPES.filter((t) => oi.accounts.some((a) => a.type === t));
  return (
    <ChartCard
      title="Other income by account"
      sub={`GL actuals as uploaded (Account Analysis Report) · ${oi.general ? 'property and company rows' : 'property rows only (company rows: Finance, without PM, category or property filters)'}`}
      legend={<Legend items={types.map((t) => ({ label: t, color: OI_COLOR[t] }))} />}
      table={{
        head: ['Account', ...cols.map((c) => c.label)],
        rows: [
          ...types.flatMap((t) => [
            [t, ...cols.map((c) => Math.round(typeTotal(t, c.k)))],
            ...oi.accounts.filter((a) => a.type === t).map((a) => [`   ${a.code} ${a.name}`, ...cols.map((c) => Math.round(a[c.k]))]),
          ]),
          ['Total', ...cols.map((c) => Math.round(sum(oi.accounts.map((a) => a[c.k]))))],
          ...(oi.outside.a2 || oi.outside.a1 || oi.outside.ytd ? [['Outside the group (MJNH, Private Office)', ...cols.map((c) => Math.round(oi.outside[c.k]))]] : []),
        ],
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Columns stacked labels={cols.map((c) => c.label)} series={types.map((t) => ({ name: t, color: OI_COLOR[t], values: cols.map((c) => typeTotal(t, c.k)) }))} height={260} />
        <Grid
          className="max-h-72"
          head={['Account', ...cols.map((c) => c.label)]}
          rows={[
            ...types.flatMap((t) => [
              { cells: [t, typeTotal(t, 'a2'), typeTotal(t, 'a1'), typeTotal(t, 'ytd')], kind: 'subtotal' as const },
              ...oi.accounts.filter((a) => a.type === t).map((a) => ({ cells: [`${a.code} ${a.name}`, a.a2, a.a1, a.ytd] })),
            ]),
            { cells: ['Total', ...cols.map((c) => sum(oi.accounts.map((a) => a[c.k])))], kind: 'total' },
            ...(oi.outside.a2 || oi.outside.a1 || oi.outside.ytd ? [{ cells: ['Outside the group (MJNH, Private Office)', oi.outside.a2, oi.outside.a1, oi.outside.ytd] }] : []),
          ]}
        />
      </div>
    </ChartCard>
  );
}

export function CostsSection({ data }: { data: DashboardReports }) {
  const { B, P, A1, A2, fmYtd } = data.labels;
  const c = data.costs;
  const wt = c.workTypes;
  type K = 'a2' | 'a1' | 'ytd' | 'prior' | 'budget';
  // a budget not entered stays null (shown as –), never 0
  const wtTot = (k: K, line?: string) => {
    const vs = wt.filter((w) => !line || w.line === line).map((w) => w[k]);
    return vs.every((v) => v === null) ? null : sum(vs.map((v) => v ?? 0));
  };
  const staffTot = (k: 'prior' | 'budget') => (c.staff.every((x) => x[k] === null) ? null : sum(c.staff.map((x) => x[k] ?? 0)));
  const staffP = staffTot('prior');
  const staffB = staffTot('budget');
  const diff = (b: number | null, p: number | null) => (b === null || p === null ? null : b - p);
  const cap = data.capex;
  const capP = sum(cap.groups.map((g) => g.prior));
  const capB = sum(cap.groups.map((g) => g.budget));
  const periods: { label: string; k: K }[] = [
    { label: A2, k: 'a2' },
    { label: A1, k: 'a1' },
    { label: fmYtd, k: 'ytd' },
    { label: P, k: 'prior' },
    { label: c.budgeted ? B : `${B} (not entered)`, k: 'budget' },
  ];
  // the Building P&L order: operating costs, gross profit line, below gross profit, cash only
  const sec = (s: 'opex' | 'belowGp' | 'cashOnly') => c.lines.filter((l) => l.section === s);
  // a subtotal shows once any of its lines is budgeted
  const subtotal = (ls: typeof c.lines, k: 'prior' | 'budget') => (ls.some((l) => l[k] !== null) ? sum(ls.map((l) => l[k] ?? 0)) : null);
  const pnlLines = [...sec('opex'), ...sec('belowGp')];

  return (
    <>
      <SectionHead title="Operating costs" sub={`FM budget and building overheads · FM GL actuals ${A2} to ${fmYtd}; ${P} from the FMD budget file; ${B} as entered${c.budgeted ? '' : ' (FM not entered yet)'}`} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Expense lines" sub={`As the Building P&L: major repairs below gross profit, capex items in cash only · ${P} and ${B} · – = not budgeted yet`}>
          <Grid
            head={['Line', P, B]}
            rows={[
              ...sec('opex').map((l) => ({ cells: [l.label, l.prior, l.budget] })),
              { cells: ['Total operating expenses', subtotal(sec('opex'), 'prior'), subtotal(sec('opex'), 'budget')], kind: 'subtotal' },
              ...sec('belowGp').map((l) => ({ cells: [`${l.label} (below gross profit)`, l.prior, l.budget] })),
              { cells: ['Total in the P&L', subtotal(pnlLines, 'prior'), subtotal(pnlLines, 'budget')], kind: 'total' },
              ...sec('cashOnly').map((l) => ({ cells: [`${l.label} (cash only)`, l.prior, l.budget] })),
            ]}
          />
        </Card>

        <ChartCard
          title="FM works by type"
          sub={`GL actuals ${A2}, ${A1}, ${fmYtd}; budgets ${P} and ${B}`}
          legend={<Legend items={[{ label: 'Maintenance', color: COST_COLOR.maintenance }, { label: 'Capex / replacements', color: COST_COLOR.capex }]} />}
          table={{
            head: ['Work type', ...periods.map((p) => p.label)],
            rows: [...wt.map((w) => [`${w.code} ${w.label}`, ...periods.map((p) => r0(w[p.k]))]), ['Total', ...periods.map((p) => r0(wtTot(p.k)))]],
          }}
        >
          <Columns
            stacked
            labels={periods.map((p) => p.label)}
            series={(['maintenance', 'capex'] as const).map((line) => ({
              name: line === 'maintenance' ? 'Maintenance' : 'Capex / replacements',
              color: COST_COLOR[line],
              values: periods.map((p) => wtTot(p.k, line) ?? 0),
            }))}
            height={240}
          />
        </ChartCard>

        <ChartCard
          className="xl:col-span-2"
          title={`FM staff cost · ${P} vs ${B}`}
          sub={`Cost to company + overtime + G&A share, allocated to the buildings in view · ${P} ${staffP === null ? 'not entered' : compact(staffP)} · ${B} ${staffB === null ? 'not entered yet' : compact(staffB)}`}
          legend={<Legend items={[{ label: P, color: MEASURE.prior }, { label: B, color: MEASURE.budget }]} />}
          table={{
            head: ['Team', P, B, 'Change'],
            rows: [...c.staff.map((x) => [x.label, r0(x.prior), r0(x.budget), r0(diff(x.budget, x.prior))]), ['Total', r0(staffP), r0(staffB), r0(diff(staffB, staffP))]],
          }}
        >
          <Columns
            labels={c.staff.map((x) => x.label.replace(' team', ''))}
            series={[
              { name: P, color: MEASURE.prior, values: c.staff.map((x) => x.prior ?? 0) },
              { name: B, color: MEASURE.budget, values: c.staff.map((x) => x.budget ?? 0) },
            ]}
            diffLabel={staffB === null || staffP === null ? undefined : 'Change'}
            height={220}
          />
        </ChartCard>
      </div>
      <SectionHead
        title="Building capex"
        sub={`FM renewal works (R01 major repairs, R02 refurbishment, R04 capex items) by building element · ${P} ${compact(capP)} · ${B} ${capB ? compact(capB) : 'not entered yet'}`}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Capex by element"
          sub={`GL actuals ${A1} and ${fmYtd}; budgets ${P} and ${B}`}
          legend={
            <Legend
              items={[
                { label: A1, color: MEASURE.cash },
                { label: P, color: MEASURE.prior },
                { label: B, color: MEASURE.budget },
              ]}
            />
          }
          table={{
            head: ['Element group', A1, fmYtd, P, B, `Share of ${P}`],
            rows: [
              ...cap.groups.map((g) => [g.group, Math.round(g.a1), Math.round(g.ytd), Math.round(g.prior), Math.round(g.budget), share(g.prior, capP)]),
              ['Total', Math.round(sum(cap.groups.map((g) => g.a1))), Math.round(sum(cap.groups.map((g) => g.ytd))), Math.round(capP), Math.round(capB), '100%'],
            ],
          }}
        >
          <Columns
            labels={cap.groups.map((g) => CAPEX_SHORT[g.group] ?? g.group)}
            series={[
              { name: A1, color: MEASURE.cash, values: cap.groups.map((g) => g.a1) },
              { name: P, color: MEASURE.prior, values: cap.groups.map((g) => g.prior) },
              { name: B, color: MEASURE.budget, values: cap.groups.map((g) => g.budget) },
            ]}
            height={240}
          />
          <p className="mt-2 text-[11px] tabular-nums text-[var(--ink-muted)]">
            Share of {P}: {cap.groups.map((g) => `${CAPEX_SHORT[g.group] ?? g.group} ${share(g.prior, capP)}`).join(' · ')}
          </p>
        </ChartCard>

        <Card title="Capex by building and commitment" sub="Largest first · planned, provisional (only if the need arises) and open commitments">
          <div className="mb-3 grid grid-cols-3 gap-2">
            {cap.kinds.map((k) => (
              <div key={k.kind} className="border border-[var(--line)] px-3 py-2">
                <div className="text-[11px] font-bold text-[var(--ink)]">{k.label}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--ink)]">{compact(k.budget || k.prior)}</div>
                <div className="text-[11px] tabular-nums text-[var(--ink-muted)]">{k.budget ? `${B} · ${P} ${compact(k.prior)}` : `${P} · ${B} not entered`}</div>
              </div>
            ))}
          </div>
          {cap.buildings.length ? (
            <BarList
              color={MEASURE.prior}
              valueFmt={compact}
              noteWidth="w-20"
              rows={cap.buildings.map((b) => ({
                key: b.name,
                label: b.name,
                value: b.budget || b.prior,
                note: b.budget ? B : P,
                tip: [
                  { label: P, value: fmt(b.prior) },
                  { label: B, value: b.budget ? fmt(b.budget) : 'not entered' },
                ],
              }))}
            />
          ) : (
            <div className="py-6 text-center text-xs text-slate-500">No capex for this selection</div>
          )}
        </Card>
      </div>
    </>
  );
}
