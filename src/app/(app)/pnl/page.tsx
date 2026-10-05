import Link from 'next/link';
import { requireUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { propertyRollups, autoOtherTotal } from '@/lib/budget/reports';
import { fmt, pct, sum } from '@/lib/format';

export const metadata = { title: 'Building P&L · Budget' };

// Cost lines from the Buildingwise P&L sheet. Not budgeted in the tool yet.
const COST_COLUMNS = [
  'Maintenance (R03 + M01–M04)',
  'Capex / replacement (R01 + R02 + R04)',
  'FM staff cost',
  'Water & electricity',
  'Watchmen',
  'Insurance',
  'Cleaning & security AMC',
  'Misc other OH',
  'DREC / land fees',
];

export default async function PnlPage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const rolls = await propertyRollups(version!.id, (await visibleProperties(user)).map((p) => p.id));

  const lines = rolls.map((r) => {
    const rental = sum(r.revenue);
    const other = sum(autoOtherTotal(r)) + sum(r.manualOther);
    const cash = sum(r.cash);
    return { r, rental, other, total: rental + other, cash };
  });
  const T = {
    rental: sum(lines.map((l) => l.rental)),
    other: sum(lines.map((l) => l.other)),
    total: sum(lines.map((l) => l.total)),
    cash: sum(lines.map((l) => l.cash)),
  };

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold">Building-wise P&amp;L · {version!.year}</h1>
          <p className="text-sm text-slate-500">
            Revenue side only. Cost columns are placeholders until the cost budget is added. AED.
          </p>
        </div>
        <a className="btn ml-auto" href="/api/export/pnl">
          Export to Excel
        </a>
      </header>
      <div className="card overflow-auto">
        <table className="table-fin">
          <thead>
            <tr>
              <th className="num">S.N.</th>
              <th>BU</th>
              <th className="num">Units</th>
              <th>Code</th>
              <th>Property</th>
              <th className="num">Rental revenue</th>
              <th className="num">Other income</th>
              <th className="num">Total revenue</th>
              {COST_COLUMNS.map((c) => (
                <th key={c} className="num text-slate-400">
                  {c}
                </th>
              ))}
              <th className="num text-slate-400">Total expenses</th>
              <th className="num">Gross profit</th>
              <th className="num">GP %</th>
              <th className="num">Cash in (rent)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ r, rental, other, total, cash }, i) => (
              <tr key={r.propertyId}>
                <td className="num text-slate-500">{i + 1}</td>
                <td>{r.buName}</td>
                <td className="num">{r.kind === 'CAMP' ? 'Camps' : r.units}</td>
                <td className="text-slate-500">{r.code}</td>
                <td>
                  <Link href={`/master?p=${r.propertyId}`} className="hover:text-sky-700 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="num">{fmt(rental)}</td>
                <td className="num">{fmt(other)}</td>
                <td className="num font-semibold">{fmt(total)}</td>
                {COST_COLUMNS.map((c) => (
                  <td key={c} className="num text-slate-300">
                    —
                  </td>
                ))}
                <td className="num text-slate-300">—</td>
                <td className="num">{fmt(total)}</td>
                <td className="num">{total ? pct(1) : ''}</td>
                <td className="num">{fmt(cash)}</td>
              </tr>
            ))}
            <tr className="total">
              <td colSpan={5}>Total</td>
              <td className="num">{fmt(T.rental)}</td>
              <td className="num">{fmt(T.other)}</td>
              <td className="num">{fmt(T.total)}</td>
              {COST_COLUMNS.map((c) => (
                <td key={c} />
              ))}
              <td />
              <td className="num">{fmt(T.total)}</td>
              <td className="num">{pct(1)}</td>
              <td className="num">{fmt(T.cash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
