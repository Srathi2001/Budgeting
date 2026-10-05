import Link from 'next/link';
import { requireUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { propertyRollups, autoOtherTotal, cashFlow } from '@/lib/budget/reports';
import { fmt, MONTHS, sum } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';

export default async function Dashboard() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const props = await visibleProperties(user);
  const rolls = await propertyRollups(version!.id, props.map((p) => p.id));

  const revenue = MONTHS.map((_, i) => sum(rolls.map((r) => r.revenue[i])));
  const flows = rolls.map((r) => ({ id: r.propertyId, flow: cashFlow(r) }));
  const cash = MONTHS.map((_, i) => sum(flows.map((f) => f.flow[i])));
  const other = MONTHS.map((_, i) => sum(rolls.map((r) => autoOtherTotal(r)[i] + r.manualOther[i])));
  const max = Math.max(...revenue, ...cash, 1);

  const byBu = new Map<string, { name: string; revenue: number; cash: number; units: number }>();
  for (const r of rolls) {
    const b = byBu.get(r.buCode) ?? { name: r.buName, revenue: 0, cash: 0, units: 0 };
    b.revenue += sum(r.revenue);
    b.cash += sum(cashFlow(r));
    b.units += r.units;
    byBu.set(r.buCode, b);
  }

  const byPm = new Map<string, Record<string, number>>();
  for (const r of rolls) {
    const k = r.coordinator ?? '—';
    const m = byPm.get(k) ?? {};
    m[r.status] = (m[r.status] ?? 0) + 1;
    byPm.set(k, m);
  }

  const kpis = [
    { label: 'Rental revenue', value: fmt(sum(revenue)) },
    { label: 'Cash inflow (incl. VAT, deposits)', value: fmt(sum(cash)) },
    { label: 'Other income', value: fmt(sum(other)) },
    { label: 'Units', value: `${fmt(sum(rolls.map((r) => r.units)))} (${fmt(sum(rolls.map((r) => r.vacantUnits)))} vacant)` },
    { label: 'Vacancy loss (gap days)', value: fmt(sum(rolls.map((r) => r.vacancyLoss))) },
    { label: 'Rows with warnings', value: fmt(sum(rolls.map((r) => r.warnings))) },
  ];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">{version!.name}</h1>
        <p className="text-sm text-slate-500">
          {version!.status === 'LOCKED' ? 'Locked — read only' : 'Open for input'} · AED
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="card px-4 py-3">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Revenue vs cash by month</h2>
          <div className="flex gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600" /> Revenue
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Cash inflow
            </span>
          </div>
        </div>
        <div className="grid grid-cols-12 items-end gap-2" style={{ height: 180 }}>
          {MONTHS.map((m, i) => (
            <div key={m} className="flex h-full flex-col justify-end">
              <div className="flex h-full items-end gap-0.5">
                <div className="flex-1 rounded-t bg-sky-600" style={{ height: `${(revenue[i] / max) * 100}%` }} title={`Revenue ${fmt(revenue[i])}`} />
                <div className="flex-1 rounded-t bg-emerald-500" style={{ height: `${(cash[i] / max) * 100}%` }} title={`Cash ${fmt(cash[i])}`} />
              </div>
              <div className="mt-1 text-center text-[11px] text-slate-500">{m}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="frame">
          <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">By business unit</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>BU</th>
                <th className="num">Units</th>
                <th className="num">Revenue</th>
                <th className="num">Cash inflow</th>
              </tr>
            </thead>
            <tbody>
              {[...byBu.entries()].map(([code, b]) => (
                <tr key={code}>
                  <td>
                    {code} {b.name}
                  </td>
                  <td className="num">{fmt(b.units)}</td>
                  <td className="num">{fmt(b.revenue)}</td>
                  <td className="num">{fmt(b.cash)}</td>
                </tr>
              ))}
              <tr className="tbl-total">
                <td>Total</td>
                <td className="num">{fmt(sum([...byBu.values()].map((b) => b.units)))}</td>
                <td className="num">{fmt(sum(revenue))}</td>
                <td className="num">{fmt(sum(cash))}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="frame">
          <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold">Submission progress by property manager</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Coordinator</th>
                {(['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'] as const).map((s) => (
                  <th key={s} className="num">
                    <StatusBadge status={s} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byPm.entries()].map(([pm, m]) => (
                <tr key={pm}>
                  <td>{pm}</td>
                  {(['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'] as const).map((s) => (
                    <td key={s} className="num">
                      {m[s] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs">
            <Link href="/submissions" className="text-sky-700 hover:underline">
              Go to submissions →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
