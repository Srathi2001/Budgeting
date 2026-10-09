'use client';

// Other income summary: the full picture of what property managers and Finance entered (and what is
// calculated: the maintenance service fee from the leases, the PMA fee), for Finance to check. Each
// property opens in the Other Income tab, filtered to it.

import { useMemo } from 'react';
import { ChartCard, Columns, HBars, Legend, StatTile, compact } from '@/components/charts';
import { Card, CheckList, SummaryHead, SummaryTable, change, sum } from '@/components/summary-kit';
import { useFilters } from '@/components/filter-bar';
import { propertyPasses } from '@/lib/filters';
import { pctSigned } from '@/lib/format';
import { MEASURE, OI_TYPE_COLOR } from '@/lib/segments';
import { GROUP_NAME, classifyOtherIncome, type GroupClass } from '@/lib/budget/group';
import { OI_ACCOUNT, OI_ACCOUNTS, OI_TYPES, oiCell, oiLabel, oiType, type OiBlock } from '@/lib/budget/other-income-types';

const GROUP_ORDER: GroupClass[] = ['group', 'owners', 'intergroup', 'outside'];
const CLASS_LABEL: Record<GroupClass, string> = { group: `${GROUP_NAME} income`, owners: "Owners' share (PMC)", intergroup: 'Intergroup (PMA fee)', outside: 'Outside the group' };

export function OiSummary({ blocks, versionName, year }: { blocks: OiBlock[]; versionName: string; year: number }) {
  const { filters, universe } = useFilters();
  const L = { A1: oiLabel('A1', year), YTD: oiLabel('YTD', year), F: oiLabel('F', year), B: oiLabel('B', year) };
  const link = (b: OiBlock) => (b.kind === 'P' ? `/other-income?p=${b.propertyId}` : '/other-income');
  const name = (b: OiBlock) => (b.kind === 'G' ? `General · ${b.buCode} ${b.buName}` : `${b.code} ${b.name}`);

  const view = useMemo(() => {
    const info = new Map(universe.map((p) => [p.id, p]));
    return blocks.filter((b) => {
      // company-level rows follow the business unit filter only, as on the input tab
      if (b.kind === 'G') return (!filters.bu.length || filters.bu.includes(b.buCode)) && !filters.pm.length && !filters.cat.length && !filters.prop.length;
      const p = info.get(b.propertyId!);
      return !!p && propertyPasses(p, filters);
    });
  }, [blocks, filters, universe]);

  const cells = useMemo(
    () =>
      view.flatMap((b) =>
        OI_ACCOUNTS.map((a) => ({ b, a, a1: oiCell(b, a.code, 'A1'), ytd: oiCell(b, a.code, 'YTD'), od: oiCell(b, a.code, 'OD'), f: oiCell(b, a.code, 'F'), bud: oiCell(b, a.code, 'B') })).filter(
          (x) => x.a1 !== null || x.f !== null || x.bud !== null,
        ),
      ),
    [view],
  );
  type C = (typeof cells)[number];
  const tot = (pick: (x: C) => number | null, match: (x: C) => boolean = () => true) => sum(cells.filter(match).map(pick));
  const B = tot((x) => x.bud);
  const F = tot((x) => x.f);
  const calcB = tot((x) => x.bud, (x) => x.a.calc === 'MF' || x.b.calcB?.[x.a.code] !== undefined);
  const byType = OI_TYPES.map((t) => ({ t, a1: tot((x) => x.a1, (x) => oiType(x.a.code) === t), f: tot((x) => x.f, (x) => oiType(x.a.code) === t), b: tot((x) => x.bud, (x) => oiType(x.a.code) === t) })).filter((r) => r.a1 || r.f || r.b);
  const bus = [...new Set(view.map((b) => b.buCode))].sort().map((bu) => ({ bu, f: tot((x) => x.f, (x) => x.b.buCode === bu), b: tot((x) => x.bud, (x) => x.b.buCode === bu) }));
  const groups = GROUP_ORDER.map((g) => ({ g, f: tot((x) => x.f, (x) => classifyOtherIncome(x.b.scope, x.b.buCode, x.a.code) === g), b: tot((x) => x.bud, (x) => classifyOtherIncome(x.b.scope, x.b.buCode, x.a.code) === g) })).filter((r) => r.f || r.b);
  const accounts = OI_ACCOUNTS.map((a) => ({ a, a1: tot((x) => x.a1, (x) => x.a.code === a.code), f: tot((x) => x.f, (x) => x.a.code === a.code), b: tot((x) => x.bud, (x) => x.a.code === a.code) })).filter((r) => r.a1 || r.f || r.b);
  const rows = view
    .map((b) => {
      const mine = cells.filter((x) => x.b === b);
      return {
        b,
        f: sum(mine.map((x) => x.f)),
        bud: sum(mine.map((x) => x.bud)),
        ytd: sum(mine.map((x) => x.ytd)),
        od: mine.some((x) => x.od !== null),
        typed: mine.filter((x) => x.b.values[x.a.code]?.B != null && x.a.calc !== 'MF').length,
      };
    })
    .filter((r) => r.f || r.bud || r.ytd);
  const movers = [...rows].sort((x, y) => Math.abs(y.bud - y.f) - Math.abs(x.bud - x.f)).slice(0, 12);
  const how = (code: string) => (OI_ACCOUNT.get(code)?.calc === 'MF' ? 'Leases (calculated)' : code === '52801' ? 'PMA fee (calculated)' : 'Typed');

  return (
    <div className="anh-main">
      <SummaryHead eyebrow="Other Income · Summary" title={versionName} sub={`${rows.length} properties and company rows with other income in view · ${L.F} = ${L.YTD} actuals + the Oct–Dec forecast · AED`} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label={`Other income ${L.B}`} value={compact(B)} sub={`${L.F}: ${compact(F)}`} {...(F && B ? { delta: pctSigned((B - F) / F), deltaDir: B >= F ? ('up' as const) : ('down' as const), adverse: B < F } : {})} />
        {byType.map((r) => (
          <StatTile key={r.t} label={r.t} value={compact(r.b)} sub={`${L.F}: ${compact(r.f)}`} />
        ))}
        <StatTile label="Calculated" value={compact(calcB)} sub="Maintenance service fee from the leases, PMA fee" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`By type · ${L.A1}, ${L.F}, ${L.B}`}
          sub="Landlord charges, ANPM's fees, the PMA fee and company income"
          legend={
            <Legend
              items={[
                { label: L.A1, color: MEASURE.cash },
                { label: L.F, color: MEASURE.prior },
                { label: L.B, color: MEASURE.budget },
              ]}
            />
          }
          table={{ head: ['Type', L.A1, L.F, L.B, 'Change'], rows: [...byType.map((r) => [r.t, r.a1, r.f, r.b, change(r.b, r.f)]), ['Total', tot((x) => x.a1), F, B, change(B, F)]] }}
        >
          <Columns
            labels={byType.map((r) => r.t.replace(' (PMA)', '').replace('Interest & company income', 'Company income'))}
            series={[
              { name: L.A1, color: MEASURE.cash, values: byType.map((r) => r.a1) },
              { name: L.F, color: MEASURE.prior, values: byType.map((r) => r.f) },
              { name: L.B, color: MEASURE.budget, values: byType.map((r) => r.b) },
            ]}
            height={240}
          />
        </ChartCard>

        <ChartCard
          title={`Biggest changes · ${L.B} vs ${L.F}`}
          sub="The 12 properties or company rows that move most"
          table={{ head: ['Row', L.F, L.B, 'Change', 'Change %'], rows: movers.map((r) => [name(r.b), r.f, r.bud, r.bud - r.f, change(r.bud, r.f)]) }}
        >
          <HBars diverging rows={movers.map((r) => ({ label: name(r.b), values: [r.bud - r.f] }))} series={[{ name: `Change vs ${L.F}`, color: MEASURE.budget }]} />
        </ChartCard>

        <Card title={`By business unit · ${L.F} vs ${L.B}`}>
          <SummaryTable className="" head={['Business unit', L.F, L.B, 'Change']} rows={[...bus.map((r) => ({ cells: [r.bu, r.f, r.b, r.b ? change(r.b, r.f) : '–'] })), { kind: 'total' as const, cells: ['Total', F, B, change(B, F)] }]} />
        </Card>

        <ChartCard
          title={`How it counts for the group · ${L.B}`}
          sub="The group's own income; the owners' share of PMC properties; the PMA fee, eliminated; MJNH and the Private Office, outside"
          legend={<Legend items={byType.map((r) => ({ label: r.t, color: OI_TYPE_COLOR[r.t] }))} />}
          table={{ head: ['Class', L.F, L.B, 'Change'], rows: groups.map((r) => [CLASS_LABEL[r.g], r.f, r.b, change(r.b, r.f)]) }}
        >
          <HBars
            labelWidth={150}
            rows={groups.map((r) => ({
              label: CLASS_LABEL[r.g],
              values: byType.map((t) => tot((x) => x.bud, (x) => oiType(x.a.code) === t.t && classifyOtherIncome(x.b.scope, x.b.buCode, x.a.code) === r.g)),
            }))}
            series={byType.map((r) => ({ name: r.t, color: OI_TYPE_COLOR[r.t] }))}
          />
        </ChartCard>
      </div>

      <Card title="By account" sub={`Every account with a figure · ${L.B} typed, or calculated`}>
        <SummaryTable
          head={['Account', 'Type', L.A1, L.F, L.B, 'Change', `${L.B} from`]}
          rows={[...accounts.map((r) => ({ cells: [`${r.a.code} ${r.a.name}`, oiType(r.a.code), r.a1, r.f, r.b, r.b ? change(r.b, r.f) : '–', how(r.a.code)] })), { kind: 'total' as const, cells: ['Total', '', tot((x) => x.a1), F, B, change(B, F), ''] }]}
        />
      </Card>

      <Card title="By property" sub="Click a property to open it in Other Income">
        <SummaryTable
          head={['Property', 'BU', 'PM', L.YTD, L.F, L.B, 'Change', 'Accounts typed', 'Oct–Dec entered']}
          int={[7]}
          rows={[
            ...rows.map((r) => ({ href: link(r.b), cells: [name(r.b), r.b.buCode, r.b.pm ?? '–', r.ytd, r.f, r.bud, r.bud ? change(r.bud, r.f) : '–', r.typed, r.od ? 'Yes' : 'No'] })),
            { kind: 'total' as const, cells: ['Total', '', '', sum(rows.map((r) => r.ytd)), F, B, change(B, F), sum(rows.map((r) => r.typed)), ''] },
          ]}
        />
      </Card>

      <Card title="Check these" sub="Rules of thumb, not errors: each one is worth a look before the budget is approved">
        <CheckList
          groups={[
            {
              title: `${L.F} but no ${L.B}`,
              items: cells
                .filter((x) => (x.f ?? 0) > 5_000 && x.bud === null)
                .sort((p, q) => (q.f ?? 0) - (p.f ?? 0))
                .map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: `${L.F} ${compact(x.f!)}`, href: link(x.b) })),
            },
            {
              title: `Up or down more than 25% on ${L.F}`,
              items: cells
                .filter((x) => x.f && Math.abs(x.f) > 5_000 && x.bud !== null && Math.abs(x.bud - x.f) > 10_000 && Math.abs(x.bud - x.f) / Math.abs(x.f) > 0.25)
                .sort((p, q) => Math.abs(q.bud! - q.f!) - Math.abs(p.bud! - p.f!))
                .map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: `${compact(x.f!)} → ${compact(x.bud!)} (${change(x.bud, x.f)})`, href: link(x.b) })),
            },
            { title: `New in ${L.B} (no ${L.F})`, items: cells.filter((x) => Math.abs(x.f ?? 0) <= 5_000 && (x.bud ?? 0) > 10_000).map((x) => ({ what: `${name(x.b)} · ${x.a.name}`, why: compact(x.bud!), href: link(x.b) })) },
            { title: 'Oct–Dec forecast not entered', items: rows.filter((r) => r.ytd > 0 && !r.od).map((r) => ({ what: name(r.b), why: `${L.YTD} ${compact(r.ytd)}`, href: link(r.b) })) },
          ]}
        />
      </Card>
    </div>
  );
}
