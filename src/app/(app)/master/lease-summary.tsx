'use client';

// Lease Budget summary: the full picture of what the property managers entered, for Finance to check.
// Each property opens in the Lease Budget, filtered to it.

import { ChartCard, Columns, HBars, Legend, LineChart, StatTile, compact } from '@/components/charts';
import { Card, CheckList, SummaryHead, SummaryTable, change, sum } from '@/components/summary-kit';
import { MONTHS, pct, pctSigned } from '@/lib/format';
import { CATEGORY_COLOR, MEASURE, OUTCOME_COLOR } from '@/lib/segments';
import type { LeaseSummary as Data, LeaseSummaryProperty } from '@/lib/budget/lease-summary';

const STATUS: Record<string, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', APPROVED: 'Approved', RETURNED: 'Returned' };

export function LeaseSummary({ data: d }: { data: Data }) {
  const B = `${d.year}B`;
  const F = d.forecastName;
  const ps = d.properties;
  const tot = (k: keyof LeaseSummaryProperty) => sum(ps.map((p) => p[k] as number));
  const budget = tot('budget');
  const forecast = tot('forecast');
  const due = tot('due');
  const link = (id: number) => `/master?p=${id}`;
  const name = (p: LeaseSummaryProperty) => `${p.code} ${p.name}`;
  const submitted = ps.filter((p) => p.status === 'SUBMITTED' || p.status === 'APPROVED').length;
  const pms = [...new Set(ps.map((p) => p.pm))].sort().map((pm) => {
    const xs = ps.filter((p) => p.pm === pm);
    const t = (k: keyof LeaseSummaryProperty) => sum(xs.map((p) => p[k] as number));
    return { pm, n: xs.length, submitted: xs.filter((p) => p.status === 'SUBMITTED' || p.status === 'APPROVED').length, t };
  });
  const yy = String(d.year).slice(2);

  return (
    <div className="anh-main">
      <SummaryHead
        eyebrow="Lease Budget · Summary"
        title={d.versionName}
        sub={`${ps.length} properties in view · vs ${F} (actuals${d.forecastCutoff ? ` to ${MONTHS[d.forecastCutoff - 1]}` : ''} + Lease Budget projection) · AED`}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={`Revenue ${B}`}
          value={compact(budget)}
          sub={`${F}: ${compact(forecast)}`}
          {...(forecast && budget ? { delta: pctSigned((budget - forecast) / forecast), deltaDir: budget >= forecast ? ('up' as const) : ('down' as const), adverse: budget < forecast } : {})}
        />
        <StatTile label="Units in the budget" value={tot('units').toLocaleString('en-US')} sub={`${tot('vacant').toLocaleString('en-US')} vacant now`} />
        <StatTile label={`Leases due ${d.year}`} value={due.toLocaleString('en-US')} sub={`${due ? pct(tot('renew') / due) : '–'} renewing · ${tot('newTenant')} new tenants`} />
        <StatTile label="Not re-let" value={compact(tot('rentLost'))} sub={`${tot('notRelet')} leases · vacancy loss ${compact(tot('vacancyLoss'))}`} />
        <StatTile label="Open issues" value={tot('issues').toLocaleString('en-US')} sub="Rows to review in the Lease Budget" />
        <StatTile label="Submitted" value={`${submitted} of ${ps.length}`} sub={`${ps.filter((p) => p.status === 'APPROVED').length} approved · ${ps.filter((p) => p.status === 'RETURNED').length} returned`} />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Revenue by month · ${B} vs ${F}`}
          sub="Rent recognised each month"
          legend={<Legend shape="line" items={[{ label: B, color: MEASURE.budget }, { label: F, color: MEASURE.prior, dash: true }]} />}
          table={{ head: ['Month', B, F, 'Change'], rows: MONTHS.map((m, i) => [`${m}-${yy}`, d.months.budget[i], d.months.forecast[i], d.months.budget[i] - d.months.forecast[i]]) }}
        >
          <LineChart
            labels={MONTHS}
            series={[
              { name: F, color: MEASURE.prior, values: d.months.forecast, dash: true },
              { name: B, color: MEASURE.budget, values: d.months.budget },
            ]}
            diffLabel={`Change vs ${F}`}
          />
        </ChartCard>

        <ChartCard
          title={`Leases falling due by property manager · ${d.year}`}
          sub="What each manager's budget assumes when a lease ends"
          legend={<Legend items={(['Renew', 'New tenant', 'Not re-let'] as const).map((o) => ({ label: o, color: OUTCOME_COLOR[o] }))} />}
          table={{ head: ['Property manager', 'Leases due', 'Renew', 'New tenant', 'Not re-let', 'Rent lost'], rows: pms.map((x) => [x.pm, String(x.t('due')), String(x.t('renew')), String(x.t('newTenant')), String(x.t('notRelet')), x.t('rentLost')]) }}
        >
          <HBars
            labelWidth={120}
            fmt={(n) => String(Math.round(n))}
            tipFmt={(n) => `${Math.round(n)} leases`}
            rows={pms.filter((x) => x.t('due')).map((x) => ({ label: x.pm, values: [x.t('renew'), x.t('newTenant'), x.t('notRelet')] }))}
            series={(['Renew', 'New tenant', 'Not re-let'] as const).map((o) => ({ name: o, color: OUTCOME_COLOR[o] }))}
          />
        </ChartCard>

        <ChartCard
          title={`Revenue by business unit · ${F} vs ${B}`}
          sub="Budget revenue against last year's forecast"
          legend={<Legend items={[{ label: F, color: MEASURE.prior }, { label: B, color: MEASURE.budget }]} />}
          table={{ head: ['Business unit', F, B, 'Change', 'Change %'], rows: [...d.byBu.map((r) => [r.label, r.forecast, r.budget, r.budget - r.forecast, change(r.budget, r.forecast)]), ['Total', forecast, budget, budget - forecast, change(budget, forecast)]] }}
        >
          <Columns
            labels={d.byBu.map((r) => r.label)}
            series={[
              { name: F, color: MEASURE.prior, values: d.byBu.map((r) => r.forecast) },
              { name: B, color: MEASURE.budget, values: d.byBu.map((r) => r.budget) },
            ]}
            diffLabel="Change"
            height={220}
          />
        </ChartCard>

        <ChartCard
          title={`Revenue by category · ${B}`}
          sub={`Share of the budget, with the change vs ${F}`}
          legend={<Legend items={d.byCategory.map((c) => ({ label: c.label, color: CATEGORY_COLOR[c.label] }))} />}
          table={{ head: ['Category', F, B, 'Change %', 'Share'], rows: d.byCategory.map((c) => [c.label, c.forecast, c.budget, change(c.budget, c.forecast), budget ? pct(c.budget / budget) : '–']) }}
        >
          <HBars labelWidth={110} rows={d.byCategory.map((c) => ({ label: c.label, values: [c.budget], note: change(c.budget, c.forecast) }))} series={[{ name: B, color: MEASURE.budget }]} note={(r) => r.note} noteLabel={`vs ${F}`} />
        </ChartCard>
      </div>

      <Card title="By property manager" sub="Where each manager stands">
        <SummaryTable
          className=""
          head={['Property manager', 'Properties', 'Submitted', 'Units', 'Vacant', 'Leases due', 'Not re-let', 'Issues', F, B, 'Change']}
          int={[1, 2, 3, 4, 5, 6, 7]}
          rows={[
            ...pms.map((x) => ({ cells: [x.pm, x.n, x.submitted, x.t('units'), x.t('vacant'), x.t('due'), x.t('notRelet'), x.t('issues'), x.t('forecast'), x.t('budget'), change(x.t('budget'), x.t('forecast'))] })),
            { kind: 'total' as const, cells: ['Total', ps.length, submitted, tot('units'), tot('vacant'), due, tot('notRelet'), tot('issues'), forecast, budget, change(budget, forecast)] },
          ]}
        />
      </Card>

      <Card title="By property" sub="Click a property to open it in the Lease Budget">
        <SummaryTable
          head={['Property', 'BU', 'PM', 'Status', 'Units', 'Vacant', 'Due', 'Renew', 'New tenant', 'Not re-let', 'Issues', F, B, 'Change']}
          int={[4, 5, 6, 7, 8, 9, 10]}
          rows={[
            ...ps.map((p) => ({ href: link(p.id), cells: [name(p), p.bu, p.pm, STATUS[p.status] ?? p.status, p.units, p.vacant, p.due, p.renew, p.newTenant, p.notRelet, p.issues, p.forecast, p.budget, change(p.budget, p.forecast)] })),
            { kind: 'total' as const, cells: ['Total', '', '', '', tot('units'), tot('vacant'), due, tot('renew'), tot('newTenant'), tot('notRelet'), tot('issues'), forecast, budget, change(budget, forecast)] },
          ]}
        />
      </Card>

      <Card title="Check these" sub="Rules of thumb, not errors: each one is worth a look before the budget is approved">
        <CheckList
          groups={[
            {
              title: `Up or down more than 15% on ${F}`,
              items: ps
                .filter((p) => p.forecast > 0 && Math.abs(p.budget - p.forecast) > 100_000 && Math.abs(p.budget - p.forecast) / p.forecast > 0.15)
                .sort((a, b) => Math.abs(b.budget - b.forecast) - Math.abs(a.budget - a.forecast))
                .map((p) => ({ what: name(p), why: `${compact(p.forecast)} → ${compact(p.budget)} (${change(p.budget, p.forecast)})`, href: link(p.id) })),
            },
            { title: 'Open issues', items: ps.filter((p) => p.issues).sort((a, b) => b.issues - a.issues).map((p) => ({ what: name(p), why: `${p.issues} rows`, href: link(p.id) })) },
            { title: 'Leases not re-let', items: ps.filter((p) => p.notRelet).sort((a, b) => b.rentLost - a.rentLost).map((p) => ({ what: name(p), why: `${p.notRelet} · ${compact(p.rentLost)} rent`, href: link(p.id) })) },
            { title: 'A third or more of the units vacant now', items: ps.filter((p) => p.units >= 3 && p.vacant / p.units >= 1 / 3).map((p) => ({ what: name(p), why: `${p.vacant} of ${p.units}`, href: link(p.id) })) },
            { title: 'Not submitted', items: ps.filter((p) => p.status === 'DRAFT' || p.status === 'RETURNED').map((p) => ({ what: name(p), why: `${p.pm} · ${STATUS[p.status]}`, href: link(p.id) })) },
          ]}
        />
      </Card>
    </div>
  );
}
