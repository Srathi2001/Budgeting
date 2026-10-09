'use client';

// Building overheads summary: the full picture of what property managers and Finance entered (and what
// is calculated), for Finance to check. Each building opens in the Overview, filtered to it.

import { useMemo } from 'react';
import { ChartCard, Columns, HBars, Legend, StatTile, compact } from '@/components/charts';
import { Card, CheckList, SummaryHead, SummaryTable, change, sum, type CheckItem } from '@/components/summary-kit';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { MONTHS, pct, pctSigned } from '@/lib/format';
import { MEASURE } from '@/lib/segments';
import { BOH_ACCOUNT, BOH_ACCOUNTS, BOH_LINES, BOH_LINE_LABEL, type BohBlock, type BohRow } from '@/lib/budget/boh-types';

const CALC: Record<string, string> = { water: 'Water & electricity %', insurance: 'Insurance rates', watchmen: 'Security allocation', contracts: 'Contract schedule', forecast: 'Last year’s forecast' };
const LINE_SHORT: Record<string, string> = { utilities: 'Utilities', watchmen: 'Watchmen', insurance: 'Insurance', cleaning: 'Cleaning', overheads: 'Misc.', land: 'Land' };

export function BohSummary({ blocks, versionName, year, cutoff }: { blocks: BohBlock[]; versionName: string; year: number; cutoff: number }) {
  const { filters, universe } = useFilters();
  const B = `${year}B`;
  const F = `${year - 1}F`;
  const A1 = `${year - 2}A`;
  const YTD = cutoff ? `${year - 1} Jan–${MONTHS[cutoff - 1]}` : `${year - 1} YTD`;
  const link = (id: number) => `/building-overheads?p=${id}`;

  const view = useMemo(() => {
    const info = new Map(universe.map((p) => [p.id, p]));
    return blocks.filter((b) => {
      const p = info.get(b.propertyId);
      return !!p && propertyPasses(p, filters);
    });
  }, [blocks, filters, universe]);

  const s = useMemo(() => {
    const rows = view.flatMap((b) => b.rows.map((r) => ({ b, r, a: BOH_ACCOUNT.get(r.account)! })));
    const tot = (pick: (r: BohRow) => number | null, match: (x: (typeof rows)[number]) => boolean = () => true) => {
      const vs = rows.filter(match).map((x) => pick(x.r));
      return vs.some((v) => v !== null) ? sum(vs) : null;
    };
    const buildings = view
      .map((b) => {
        const f = sum(b.rows.map((r) => r.f));
        const bud = sum(b.rows.map((r) => r.b));
        return {
          b,
          f,
          bud,
          a1: sum(b.rows.map((r) => r.a1)),
          calc: sum(b.rows.filter((r) => r.calc).map((r) => r.b)),
          pm: sum(b.rows.filter((r) => BOH_ACCOUNT.get(r.account)?.owner === 'PM').map((r) => r.b)),
          gaps: b.rows.filter((r) => (r.f ?? 0) > 0 && !r.b).length,
        };
      })
      .filter((x) => x.f || x.bud || x.a1);
    return { rows, tot, buildings };
  }, [view]);

  const totB = s.tot((r) => r.b) ?? 0;
  const totF = s.tot((r) => r.f) ?? 0;
  const calc = s.tot((r) => (r.calc ? r.b : null)) ?? 0;
  const pmB = s.tot((r) => r.b, (x) => x.a.owner === 'PM') ?? 0;
  const pmF = s.tot((r) => r.f, (x) => x.a.owner === 'PM') ?? 0;
  const withBudget = s.buildings.filter((x) => x.bud).length;
  const pmEntered = s.buildings.filter((x) => x.b.rows.some((r) => BOH_ACCOUNT.get(r.account)?.owner === 'PM' && r.entered !== null)).length;
  const line = (k: string, pick: (r: BohRow) => number | null) => s.tot(pick, (x) => x.a.line === k) ?? 0;
  const accounts = BOH_ACCOUNTS.map((a) => ({ a, a1: s.tot((r) => r.a1, (x) => x.a.code === a.code), f: s.tot((r) => r.f, (x) => x.a.code === a.code), b: s.tot((r) => r.b, (x) => x.a.code === a.code), calc: s.rows.find((x) => x.a.code === a.code && x.r.calc)?.r.calc ?? null })).filter(
    (x) => x.a1 || x.f || x.b,
  );
  const movers = [...s.buildings].sort((x, y) => Math.abs(y.bud - y.f) - Math.abs(x.bud - x.f)).slice(0, 12);
  const name = (b: BohBlock) => `${b.code} ${b.name}`;
  const check = (title: string, items: CheckItem[]) => ({ title, items });

  return (
    <div className="anh-main">
      <SummaryHead
        eyebrow="Building Overheads · Summary"
        title={versionName}
        sub={`${s.buildings.length} buildings with overheads in view · ${F}: ${YTD} actuals + the rest of the year by how each line is paid · AED`}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label={`Building overheads ${B}`} value={compact(totB)} sub={`${F}: ${compact(totF)}`} {...(totF && totB ? { delta: pctSigned((totB - totF) / totF), deltaDir: totB >= totF ? ('up' as const) : ('down' as const) } : {})} />
        <StatTile label="Calculated" value={compact(calc)} sub={totB ? `${pct(calc / totB)} of ${B}: water, insurance, watchmen, contracts, municipal` : 'Water, insurance, watchmen, contracts, municipal'} />
        <StatTile label={`Property managers' lines ${B}`} value={compact(pmB)} sub={`${F}: ${compact(pmF)}`} />
        <StatTile label="Buildings budgeted" value={`${withBudget} of ${s.buildings.length}`} sub={`${pmEntered} with amounts typed by the PM`} />
        <StatTile label="Lines not budgeted" value={String(s.buildings.reduce((n, x) => n + x.gaps, 0))} sub={`With a ${F} but no ${B}`} />
        <StatTile label={`${A1} actual`} value={compact(s.tot((r) => r.a1) ?? 0)} sub="For reference" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`By Building P&L line · ${A1}, ${F}, ${B}`}
          sub="The lines the overheads feed in the Building P&L and the statements"
          legend={
            <Legend
              items={[
                { label: A1, color: MEASURE.cash },
                { label: F, color: MEASURE.prior },
                { label: B, color: MEASURE.budget },
              ]}
            />
          }
          table={{
            head: ['Line', A1, F, B, 'Change', 'Calculated'],
            rows: [
              ...BOH_LINES.map((l) => [l.label, line(l.key, (r) => r.a1), line(l.key, (r) => r.f), line(l.key, (r) => r.b), change(line(l.key, (r) => r.b), line(l.key, (r) => r.f)), line(l.key, (r) => (r.calc ? r.b : null))]),
              ['Total', s.tot((r) => r.a1) ?? 0, totF, totB, change(totB, totF), calc],
            ],
          }}
        >
          <Columns
            labels={BOH_LINES.map((l) => LINE_SHORT[l.key])}
            series={[
              { name: A1, color: MEASURE.cash, values: BOH_LINES.map((l) => line(l.key, (r) => r.a1)) },
              { name: F, color: MEASURE.prior, values: BOH_LINES.map((l) => line(l.key, (r) => r.f)) },
              { name: B, color: MEASURE.budget, values: BOH_LINES.map((l) => line(l.key, (r) => r.b)) },
            ]}
            height={240}
          />
        </ChartCard>

        <ChartCard
          title={`Biggest changes by building · ${B} vs ${F}`}
          sub="The 12 buildings that move most"
          table={{ head: ['Building', F, B, 'Change', 'Change %'], rows: movers.map((x) => [name(x.b), x.f, x.bud, x.bud - x.f, change(x.bud, x.f)]) }}
        >
          <HBars diverging rows={movers.map((x) => ({ label: name(x.b), values: [x.bud - x.f] }))} series={[{ name: `Change vs ${F}`, color: MEASURE.budget }]} />
        </ChartCard>
      </div>

      <Card title="By account" sub={`Every account with a figure · who enters it (PM: property manager, FIN: Finance) and how ${B} is set`}>
        <SummaryTable
          head={['Account', 'Line', 'Entered by', A1, F, B, 'Change', `${B} from`]}
          rows={[
            ...accounts.map((x) => ({ cells: [`${x.a.code} ${x.a.name}`, BOH_LINE_LABEL[x.a.line], x.a.owner, x.a1, x.f, x.b, change(x.b, x.f), x.calc ? CALC[x.calc] : x.b ? 'Typed' : '–'] })),
            { kind: 'total' as const, cells: ['Total', '', '', s.tot((r) => r.a1), totF, totB, change(totB, totF), ''] },
          ]}
        />
      </Card>

      <Card title="By building" sub="Click a building to open it in the Overview">
        <SummaryTable
          head={['Building', 'BU', 'PM', A1, F, B, 'Change', 'Calculated', 'PM lines', 'Not budgeted']}
          int={[9]}
          rows={[
            ...s.buildings.map((x) => ({ href: link(x.b.propertyId), cells: [name(x.b), x.b.buCode, x.b.pm ?? '–', x.a1, x.f, x.bud, change(x.bud, x.f), x.calc, x.pm, x.gaps] })),
            { kind: 'total' as const, cells: ['Total', '', '', sum(s.buildings.map((x) => x.a1)), totF, totB, change(totB, totF), calc, pmB, s.buildings.reduce((n, x) => n + x.gaps, 0)] },
          ]}
        />
      </Card>

      <Card title="Check these" sub="Rules of thumb, not errors: each one is worth a look before the budget is approved">
        <CheckList
          groups={[
            check(
              `${F} but no ${B}`,
              s.rows.filter((x) => (x.r.f ?? 0) > 1_000 && !x.r.b).sort((p, q) => (q.r.f ?? 0) - (p.r.f ?? 0)).map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: `${F} ${compact(x.r.f ?? 0)}`, href: link(x.b.propertyId) })),
            ),
            check(
              `Up or down more than 25% on ${F}`,
              s.rows
                .filter((x) => x.r.b && x.r.f && Math.abs(x.r.b - x.r.f) > 10_000 && Math.abs(x.r.b - x.r.f) / x.r.f > 0.25)
                .sort((p, q) => Math.abs(q.r.b! - q.r.f!) - Math.abs(p.r.b! - p.r.f!))
                .map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: `${compact(x.r.f!)} → ${compact(x.r.b!)} (${change(x.r.b, x.r.f)})`, href: link(x.b.propertyId) })),
            ),
            check(
              `New in ${B} (no ${F})`,
              s.rows.filter((x) => (x.r.b ?? 0) > 10_000 && !x.r.f).map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: compact(x.r.b!), href: link(x.b.propertyId) })),
            ),
            check(
              'Municipal charges still on last year’s forecast',
              s.rows.filter((x) => x.r.calc === 'forecast').map((x) => ({ what: name(x.b), why: compact(x.r.b ?? 0), href: link(x.b.propertyId) })),
            ),
          ]}
        />
      </Card>
    </div>
  );
}
