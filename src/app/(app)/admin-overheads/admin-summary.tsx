'use client';

// Admin overheads summary: the full picture of G&A for Finance to check once everything is in: payroll
// and overheads by department against last year's run-rate, what reaches the P&L, ANPM's G&A shared over
// the companies by revenue (2026 method), the management fees and the back-up schedules.

import { ChartCard, Columns, Legend, StatTile, compact } from '@/components/charts';
import { Card, CheckList, SummaryHead, SummaryTable, change, sum } from '@/components/summary-kit';
import { MONTHS, pct, pctSigned } from '@/lib/format';
import { MEASURE } from '@/lib/segments';
import { ADMIN_ACCOUNT, ADMIN_GROUPS, DEPTS, SPLIT_ENTITIES, FEES, FEE_ENTITIES, PAYERS, deptName, feeBase, feeRate, payrollSplit, type AdminRow } from '@/lib/budget/admin-types';
import { ITEM_KINDS, itemTotal } from '@/lib/budget/admin-items';
import type { AdminSummary as Data } from '@/lib/budget/admin-summary';

const GROUP_SHORT: Record<string, string> = { 'Staff costs': 'Staff', 'Office & admin': 'Office', Vehicles: 'Vehicles', 'IT & communication': 'IT', 'Professional fees': 'Prof. fees', Insurance: 'Insurance', Depreciation: 'Deprec.', 'Bank charges': 'Bank' };
const nullSum = (a: (number | null)[]) => (a.some((v) => v !== null) ? sum(a) : null);

export function AdminSummary({ data: s }: { data: Data }) {
  const d = s.data;
  const Y = d.year;
  const B = `${Y}B`;
  const F = `${Y - 1}F`;
  const P = s.pastLabel;
  const ytd = d.cutoff ? `${Y - 1} Jan–${MONTHS[d.cutoff - 1]}` : `${Y - 1} YTD`;
  const cell = (r: AdminRow, payer: string) => r.items[payer] ?? r.b[payer];
  const rowB = (r: AdminRow) => nullSum(PAYERS.map((p) => cell(r, p.code)));
  const own = DEPTS.filter((x) => !x.elsewhere);
  const ohRows = d.admin.filter((r) => !DEPTS.find((x) => x.code === r.dept)?.elsewhere);

  // payroll and its 2026 rules
  const splits = d.payroll.map((p) => ({ p, s: payrollSplit(p), entered: p.ctc !== null || p.newCtc !== null }));
  const pay = { b: sum(splits.map((x) => x.s.total)), f: sum(d.payroll.map((p) => p.f)), cap: sum(splits.map((x) => x.s.cap)), rech: sum(splits.map((x) => x.s.mjnh + x.s.asre)), net: sum(splits.map((x) => x.s.net)) };
  const hc = sum(d.payroll.map((p) => (p.headcount ?? 0) + (p.newHeadcount ?? 0)));
  const oh = { b: sum(ohRows.map(rowB)), f: sum(ohRows.map((r) => r.f)), anpm: sum(ohRows.map((r) => cell(r, '521'))) };
  const ama = sum(d.fees.filter((r) => r.fee === 'AMA').map((r) => r.amount));
  const pma = sum(d.fees.filter((r) => r.fee === 'PMA').map((r) => r.amount));
  const ga = pay.net + oh.b + ama;
  // ANPM's G&A shared by revenue (2026: PayrollxCost J25 → K25:M25)
  const net = pay.net + oh.anpm;
  const revTotal = sum(SPLIT_ENTITIES.map((e) => s.revenue[e.key]));
  const share = (k: (typeof SPLIT_ENTITIES)[number]['key']) => (revTotal ? s.revenue[k] / revTotal : 0);
  const pastNet = s.past?.net ?? null;

  const depts = own.map((x) => {
    const p = d.payroll.find((r) => r.dept === x.code);
    const sp = splits.find((r) => r.p.dept === x.code);
    const rows = ohRows.filter((r) => r.dept === x.code);
    const payB = sp?.entered ? sp.s.total : null;
    const ohB = nullSum(rows.map(rowB));
    return {
      code: x.code,
      name: x.name,
      hc: p ? (p.headcount ?? 0) + (p.newHeadcount ?? 0) : 0,
      payF: p?.f ?? null,
      payB,
      out: sp?.entered ? sp.s.cap + sp.s.mjnh + sp.s.asre : null,
      ohF: nullSum(rows.map((r) => r.f)),
      ohB,
      f: nullSum([p?.f ?? null, ...rows.map((r) => r.f)]),
      b: payB === null && ohB === null ? null : (payB ?? 0) + (ohB ?? 0),
    };
  });
  const groups = ADMIN_GROUPS.map((g) => {
    const rows = ohRows.filter((r) => ADMIN_ACCOUNT.get(r.account)?.group === g);
    return { g, f: sum(rows.map((r) => r.f)), b: sum(rows.map(rowB)) };
  }).filter((x) => x.f || x.b);
  const link = (dept: string) => `/admin-overheads#dept-${dept}`;
  const acct = (r: AdminRow) => `${r.dept} ${deptName(r.dept)} · ${r.account} ${ADMIN_ACCOUNT.get(r.account)?.name ?? ''}`;

  return (
    <div className="anh-main">
      <SummaryHead eyebrow="Admin Overheads · Summary" title={B} sub={`G&A of ANPM, REHL and REHL-MJN · ${F}: run-rate of ${ytd} actuals · AED`} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label={`Payroll ${B}`} value={compact(pay.b)} sub={`${hc.toLocaleString('en-US')} staff · ${F}: ${compact(pay.f)}`} {...(pay.f && pay.b ? { delta: pctSigned((pay.b - pay.f) / pay.f), deltaDir: pay.b >= pay.f ? ('up' as const) : ('down' as const) } : {})} />
        <StatTile label={`Admin overheads ${B}`} value={compact(oh.b)} sub={`${F}: ${compact(oh.f)}`} {...(oh.f && oh.b ? { delta: pctSigned((oh.b - oh.f) / oh.f), deltaDir: oh.b >= oh.f ? ('up' as const) : ('down' as const) } : {})} />
        <StatTile label={`G&A in the P&L ${B}`} value={compact(ga)} sub="Net of capitalised and recharged payroll, with the AMA fee" />
        <StatTile label="ANPM G&A to share" value={compact(net)} sub={pastNet ? `${P}: ${compact(pastNet)}` : 'Net payroll + ANPM overheads'} />
        <StatTile label="PMA fee income" value={compact(pma)} sub={net ? `${pct(pma / net)} of ANPM's G&A` : 'From the landlords'} />
        <StatTile label="AMA fee to MJNH" value={compact(ama)} sub="REHL, REHL-MJN, the mall" />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`By department · ${F} vs ${B}`}
          sub="Payroll and admin overheads, before capitalised and recharged payroll"
          legend={<Legend items={[{ label: F, color: MEASURE.prior }, { label: B, color: MEASURE.budget }]} />}
          table={{ head: ['Department', F, B, 'Change', 'Change %'], rows: depts.map((x) => [`${x.code} ${x.name}`, x.f ?? 0, x.b ?? 0, (x.b ?? 0) - (x.f ?? 0), change(x.b, x.f)]) }}
        >
          <Columns
            labels={depts.map((x) => x.code)}
            series={[
              { name: F, color: MEASURE.prior, values: depts.map((x) => x.f ?? 0) },
              { name: B, color: MEASURE.budget, values: depts.map((x) => x.b ?? 0) },
            ]}
            diffLabel="Change"
            height={240}
          />
        </ChartCard>

        <ChartCard
          title={`Admin overheads by kind · ${F} vs ${B}`}
          sub="GL account groups, all departments budgeted here"
          legend={<Legend items={[{ label: F, color: MEASURE.prior }, { label: B, color: MEASURE.budget }]} />}
          table={{ head: ['Group', F, B, 'Change %'], rows: groups.map((x) => [x.g, x.f, x.b, change(x.b, x.f)]) }}
        >
          <Columns
            labels={groups.map((x) => GROUP_SHORT[x.g] ?? x.g)}
            series={[
              { name: F, color: MEASURE.prior, values: groups.map((x) => x.f) },
              { name: B, color: MEASURE.budget, values: groups.map((x) => x.b) },
            ]}
            diffLabel="Change"
            height={240}
          />
        </ChartCard>
      </div>

      <Card title={`ANPM's G&A shared by revenue · ${B}`} sub={`As the ${P} budget: ANPM's payroll net of capitalised and recharged payroll, plus the overheads ANPM pays, shared over REHL, REHL-MJN (without the mall) and the PMC by budget revenue`}>
        <div className="grid gap-4 2xl:grid-cols-[2fr_3fr]">
          <SummaryTable
            className=""
            head={['ANPM G&A', B, ...(s.past ? [P] : [])]}
            rows={[
              { cells: ['Payroll', pay.b, ...(s.past ? [null] : [])] },
              { cells: ['Less capitalised to projects (PDD)', -pay.cap, ...(s.past ? [null] : [])] },
              { cells: ['Less recharged to MJNH / ASRE', -pay.rech, ...(s.past ? [null] : [])] },
              { cells: ['Admin overheads paid by ANPM', oh.anpm, ...(s.past ? [null] : [])] },
              { kind: 'total', cells: ['To share', net, ...(s.past ? [s.past.net] : [])] },
            ]}
          />
          <SummaryTable
            className=""
            head={['Company', `Revenue ${B}`, 'Share', `Allocated ${B}`, ...(s.past ? [`Allocated ${P}`, 'Change'] : [])]}
            rows={[
              ...SPLIT_ENTITIES.map((e) => ({
                cells: [e.name, s.revenue[e.key], pct(share(e.key)), net * share(e.key), ...(s.past ? [s.past.allocated[e.key], net ? change(net * share(e.key), s.past.allocated[e.key]) : '–'] : [])],
              })),
              { kind: 'total' as const, cells: ['Total', revTotal, revTotal ? '100.00%' : '–', net, ...(s.past ? [sum(Object.values(s.past.allocated)), net ? change(net, sum(Object.values(s.past.allocated))) : '–'] : [])] },
            ]}
          />
        </div>
        {s.past && <p className="mt-2 text-[12px]">{P}: the PMC&apos;s share also carried its FM staff (252,654.23), which the tool keeps in the FM budget.</p>}
      </Card>

      <Card title="By department" sub="Click a department to open it in the Overview · FM and security are budgeted in the FM budget and Building Overheads">
        <SummaryTable
          head={['Department', 'Staff', `Payroll ${F}`, `Payroll ${B}`, 'Capitalised / recharged', `Overheads ${F}`, `Overheads ${B}`, `Total ${F}`, `Total ${B}`, 'Change']}
          int={[1]}
          rows={[
            ...depts.map((x) => ({ href: link(x.code), cells: [`${x.code} ${x.name}`, x.hc, x.payF, x.payB, x.out === null ? null : -x.out, x.ohF, x.ohB, x.f, x.b, x.b ? change(x.b, x.f) : '–'] })),
            ...d.elsewhere.map((e) => ({ cells: [`${e.dept} ${deptName(e.dept)} (elsewhere)`, null, null, e.budget, null, null, null, null, e.budget, '–'] })),
            { kind: 'total' as const, cells: ['Total budgeted here', hc, pay.f, pay.b, -(pay.cap + pay.rech), oh.f, oh.b, pay.f + oh.f, pay.b + oh.b, pay.b + oh.b ? change(pay.b + oh.b, pay.f + oh.f) : '–'] },
          ]}
        />
      </Card>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card title={`Management fees · ${B}`} sub="Rate × base per landlord, as set in the Overview">
          <SummaryTable
            className=""
            head={['Fee', 'Landlord', 'Base', 'Rate', B, ...(d.feesPrior ? [d.feesPrior] : [])]}
            rows={FEES.flatMap((f) => [
              ...d.fees
                .filter((r) => r.fee === f.key)
                .map((r) => ({ cells: [f.name, FEE_ENTITIES.find((e) => e.key === r.entity)!.name, feeBase(r), pct(feeRate(r)), r.amount, ...(d.feesPrior ? [r.prior?.amount ?? null] : [])] })),
              { kind: 'subtotal' as const, cells: [`Total ${f.name}`, '', null, '', sum(d.fees.filter((r) => r.fee === f.key).map((r) => r.amount)), ...(d.feesPrior ? [sum(d.fees.filter((r) => r.fee === f.key).map((r) => r.prior?.amount))] : [])] },
            ])}
          />
        </Card>

        <Card title="Back-up schedules" sub="Items entered in each tab, and what they post">
          <SummaryTable
            className=""
            head={['Schedule', 'Items', B]}
            int={[1]}
            rows={[
              ...ITEM_KINDS.map((k) => {
                const its = d.items.filter((i) => i.kind === k.kind);
                return { href: `/admin-overheads?tab=${k.kind}`, cells: [k.label, its.length, sum(its.map(itemTotal))] };
              }),
              { kind: 'total' as const, cells: ['Total', d.items.length, sum(d.items.map(itemTotal))] },
            ]}
          />
        </Card>
      </div>

      <Card title="Check these" sub="Rules of thumb, not errors: each one is worth a look before the budget is approved">
        <CheckList
          groups={[
            { title: `Payroll not entered (${F} run-rate shown)`, items: d.payroll.filter((p) => p.ctc === null && p.newCtc === null && (p.f ?? 0) > 0).map((p) => ({ what: `${p.dept} ${deptName(p.dept)}`, why: compact(p.f!), href: link(p.dept) })) },
            {
              title: `Payroll up or down more than 15% on ${F}`,
              items: splits
                .filter((x) => x.entered && x.p.f && Math.abs(x.s.total - x.p.f) / x.p.f > 0.15)
                .map((x) => ({ what: `${x.p.dept} ${deptName(x.p.dept)}`, why: `${compact(x.p.f!)} → ${compact(x.s.total)} (${change(x.s.total, x.p.f)})`, href: link(x.p.dept) })),
            },
            { title: `Overheads with a ${F} but no ${B}`, items: ohRows.filter((r) => (r.f ?? 0) > 5_000 && rowB(r) === null).sort((a, b) => (b.f ?? 0) - (a.f ?? 0)).map((r) => ({ what: acct(r), why: `${F} ${compact(r.f!)}`, href: link(r.dept) })) },
            {
              title: `Overheads up or down more than 25% on ${F}`,
              items: ohRows
                .filter((r) => r.f && rowB(r) !== null && Math.abs(rowB(r)! - r.f) > 10_000 && Math.abs(rowB(r)! - r.f) / r.f > 0.25)
                .sort((a, b) => Math.abs(rowB(b)! - b.f!) - Math.abs(rowB(a)! - a.f!))
                .map((r) => ({ what: acct(r), why: `${compact(r.f!)} → ${compact(rowB(r)!)} (${change(rowB(r), r.f)})`, href: link(r.dept) })),
            },
            { title: `New in ${B} (no ${F})`, items: ohRows.filter((r) => !r.f && (rowB(r) ?? 0) > 10_000).map((r) => ({ what: acct(r), why: compact(rowB(r)!), href: link(r.dept) })) },
            { title: 'Budgeted elsewhere, not entered yet', items: d.elsewhere.filter((e) => e.budget === null).map((e) => ({ what: `${e.dept} ${deptName(e.dept)}`, why: DEPTS.find((x) => x.code === e.dept)?.elsewhere ?? '', href: e.dept === '209' ? '/fm?tab=labour' : '/building-overheads?tab=security-allocation' })) },
          ]}
        />
      </Card>
    </div>
  );
}
