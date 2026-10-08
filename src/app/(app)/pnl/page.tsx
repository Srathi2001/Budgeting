import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow } from '@/lib/budget/reports';
import { BELOW_GP_LINES, CASH_ONLY_LINES, OPEX_LINES, budgetedExpenseLines, propertyExpenseTotals, type ExpenseLine } from '@/lib/budget/expenses';
import { sum } from '@/lib/format';
import { Num, Pct } from '@/components/num';

export const metadata = { title: 'Building P&L · Budget' };

export default async function PnlPage() {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version!.id, scope.propertyIds, scope.categories);
  // cost lines of the Buildingwise P&L sheet: FM costs from the FM budget, the others not budgeted yet
  const budgeted = await budgetedExpenseLines(version!.id);
  const costs = await propertyExpenseTotals(version!.id, scope.propertyIds);

  // as the 2026 Buildingwise P&L: gross profit after operating costs; major repairs below it; capex
  // items are paid (cash) but not expensed
  const lineSum = (c: Record<string, number>, ls: ExpenseLine[]) => sum(ls.map((l) => c[l.key] ?? 0));
  const lines = rolls
    .map((r) => {
      const total = sum(r.revenue);
      const c = costs.get(r.propertyId) ?? {};
      const opex = lineSum(c, OPEX_LINES);
      const gp = total - opex;
      return { r, total, c, opex, gp, net: gp - lineSum(c, BELOW_GP_LINES), cash: sum(cashFlow(r)) };
    })
    .sort((a, b) => a.r.buCode.localeCompare(b.r.buCode) || b.total - a.total);
  const T = {
    total: sum(lines.map((l) => l.total)),
    opex: sum(lines.map((l) => l.opex)),
    gp: sum(lines.map((l) => l.gp)),
    net: sum(lines.map((l) => l.net)),
    cash: sum(lines.map((l) => l.cash)),
    line: (k: string) => sum(lines.map((l) => l.c[k] ?? 0)),
  };
  const anyCost = budgeted.size > 0;
  const cell = (l: ExpenseLine, v: number, sep: boolean) =>
    budgeted.has(l.key) ? (
      <Num key={l.key} v={v} className={sep ? 'sep' : ''} />
    ) : (
      <td key={l.key} className={`na ${sep ? 'sep' : ''}`} title="Not budgeted yet">
        ·
      </td>
    );

  return (
    <div className="space-y-3 p-6">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="page-title">Building-wise P&amp;L · {version!.year}</h1>
          <p className="page-sub">
            {anyCost ? 'Maintenance, FM staff, major repairs and capex items from the FM budget; other costs not budgeted yet' : 'Costs not budgeted yet'} · major repairs below
            gross profit, capex items in cash only (as the 2026 budget) · AED
          </p>
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
              <th className="sep" colSpan={OPEX_LINES.length + 1}>
                Operating costs
              </th>
              <th className="sep" colSpan={2 + BELOW_GP_LINES.length + 1}>
                Profit
              </th>
              <th className="sep" colSpan={CASH_ONLY_LINES.length + 1}>
                Cash
              </th>
            </tr>
            <tr>
              <th className="stick stick-edge w-[300px]">Property</th>
              <th className="w-16">BU</th>
              <th className="num w-14">Units</th>
              <th className="num sep w-28">Rental revenue</th>
              {OPEX_LINES.map((l, i) => (
                <th key={l.key} className={`num w-24 ${i === 0 ? 'sep' : ''}`} title={budgeted.has(l.key) ? undefined : 'Not budgeted yet'}>
                  {l.short}
                </th>
              ))}
              <th className="num w-24">Total opex</th>
              <th className="num sep w-28">Gross profit</th>
              <th className="num w-16">GP %</th>
              {BELOW_GP_LINES.map((l) => (
                <th key={l.key} className="num w-24" title={budgeted.has(l.key) ? 'Below gross profit' : 'Not budgeted yet'}>
                  {l.short}
                </th>
              ))}
              <th className="num w-28">Net profit</th>
              {CASH_ONLY_LINES.map((l, i) => (
                <th key={l.key} className={`num w-24 ${i === 0 ? 'sep' : ''}`} title={budgeted.has(l.key) ? 'Paid, not expensed' : 'Not budgeted yet'}>
                  {l.short}
                </th>
              ))}
              <th className="num w-28">Cash inflow</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ r, total, c, opex, gp, net, cash }) => (
              <tr key={r.propertyId}>
                <td className="stick stick-edge">
                  <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
                    <Link href={`/master?p=${r.propertyId}`} className="truncate hover:text-sky-700 hover:underline" title={r.name}>
                      {r.name}
                    </Link>
                    <span className="shrink-0 text-[11px]">{r.code}</span>
                  </div>
                </td>
                <td>{r.buName}</td>
                <td className="num">{r.kind === 'CAMP' ? 'Camp' : r.units}</td>
                <Num v={total} bold className="sep" />
                {OPEX_LINES.map((l, i) => cell(l, c[l.key] ?? 0, i === 0))}
                <Num v={opex} />
                <Num v={gp} className="sep" />
                <Pct v={total ? gp / total : null} />
                {BELOW_GP_LINES.map((l) => cell(l, c[l.key] ?? 0, false))}
                <Num v={net} bold />
                {CASH_ONLY_LINES.map((l, i) => cell(l, c[l.key] ?? 0, i === 0))}
                <Num v={cash} />
              </tr>
            ))}
            <tr className="tbl-total">
              <td className="stick stick-edge">Total</td>
              <td />
              <td className="num">{sum(lines.map((l) => l.r.units))}</td>
              <Num v={T.total} className="sep" />
              {OPEX_LINES.map((l, i) => (budgeted.has(l.key) ? <Num key={l.key} v={T.line(l.key)} className={i === 0 ? 'sep' : ''} /> : <td key={l.key} className={i === 0 ? 'sep' : ''} />))}
              <Num v={T.opex} />
              <Num v={T.gp} className="sep" />
              <Pct v={T.total ? T.gp / T.total : null} />
              {BELOW_GP_LINES.map((l) => (budgeted.has(l.key) ? <Num key={l.key} v={T.line(l.key)} /> : <td key={l.key} />))}
              <Num v={T.net} />
              {CASH_ONLY_LINES.map((l, i) => (budgeted.has(l.key) ? <Num key={l.key} v={T.line(l.key)} className={i === 0 ? 'sep' : ''} /> : <td key={l.key} className={i === 0 ? 'sep' : ''} />))}
              <Num v={T.cash} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
