import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow } from '@/lib/budget/reports';
import { EXPENSE_LINES } from '@/lib/budget/expenses';
import { sum } from '@/lib/format';
import { Num, Pct } from '@/components/num';

export const metadata = { title: 'Building P&L · Budget' };

// Cost lines from the Buildingwise P&L sheet. Not budgeted in the tool yet.
const COST_COLUMNS = EXPENSE_LINES.map((l) => l.short);

export default async function PnlPage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version!.id, scope.propertyIds, scope.categories);

  const lines = rolls
    .map((r) => {
      const total = sum(r.revenue);
      return { r, total, cash: sum(cashFlow(r)) };
    })
    .sort((a, b) => a.r.buCode.localeCompare(b.r.buCode) || b.total - a.total);
  const T = {
    total: sum(lines.map((l) => l.total)),
    cash: sum(lines.map((l) => l.cash)),
  };

  return (
    <div className="space-y-3 p-6">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="page-title">Building-wise P&amp;L · {version!.year}</h1>
          <p className="page-sub">Revenue side only — cost columns are placeholders until the cost budget is added · AED</p>
        </div>
        <a className="btn ml-auto" href="/api/export/pnl">
          Export to Excel
        </a>
      </header>
      <div className="frame frame-tall">
        <table className="tbl">
          <thead>
            <tr className="tbl-band">
              <th className="stick" colSpan={3} />
              <th className="sep">Revenue</th>
              <th className="sep" colSpan={COST_COLUMNS.length + 1}>
                Costs (to be budgeted)
              </th>
              <th className="sep" colSpan={2}>
                Profit
              </th>
              <th className="sep">Cash</th>
            </tr>
            <tr>
              <th className="stick stick-edge w-[300px]">Property</th>
              <th className="w-16">BU</th>
              <th className="num w-14">Units</th>
              <th className="num sep w-28">Rental revenue</th>
              {COST_COLUMNS.map((c, i) => (
                <th key={c} className={`num w-24 text-slate-400 ${i === 0 ? 'sep' : ''}`}>
                  {c}
                </th>
              ))}
              <th className="num w-24 text-slate-400">Total exp.</th>
              <th className="num sep w-28">Gross profit</th>
              <th className="num w-16">GP %</th>
              <th className="num sep w-28">Cash inflow</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ r, total, cash }) => (
              <tr key={r.propertyId}>
                <td className="stick stick-edge">
                  <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
                    <Link href={`/master?p=${r.propertyId}`} className="truncate hover:text-sky-700 hover:underline" title={r.name}>
                      {r.name}
                    </Link>
                    <span className="shrink-0 text-[11px] text-slate-400">{r.code}</span>
                  </div>
                </td>
                <td className="muted">{r.buName}</td>
                <td className="num muted">{r.kind === 'CAMP' ? 'Camp' : r.units}</td>
                <Num v={total} bold className="sep" />
                {COST_COLUMNS.map((c, i) => (
                  <td key={c} className={`na ${i === 0 ? 'sep' : ''}`}>
                    ·
                  </td>
                ))}
                <td className="na">·</td>
                <Num v={total} className="sep" />
                <Pct v={total ? 1 : null} />
                <Num v={cash} className="sep" />
              </tr>
            ))}
            <tr className="tbl-total">
              <td className="stick stick-edge">Total</td>
              <td />
              <td className="num">{sum(lines.map((l) => l.r.units))}</td>
              <Num v={T.total} className="sep" />
              {COST_COLUMNS.map((c, i) => (
                <td key={c} className={i === 0 ? 'sep' : ''} />
              ))}
              <td />
              <Num v={T.total} className="sep" />
              <Pct v={T.total ? 1 : null} />
              <Num v={T.cash} className="sep" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
