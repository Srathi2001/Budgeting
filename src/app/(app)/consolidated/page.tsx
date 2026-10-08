import { redirect } from 'next/navigation';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups } from '@/lib/budget/reports';
import { GROUP_NAME } from '@/lib/budget/group';
import { cashStatement, groupPnl, summaryData, type StatementLine } from '@/lib/budget/summary';
import { GroupTable } from '@/components/group-table';
import { Num } from '@/components/num';
import { sum } from '@/lib/format';

export const metadata = { title: 'Consolidated · Budget' };

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

/** The budget year's consolidated statements: income statement by entity and the cash flow by quarter. */
export default async function ConsolidatedPage() {
  const user = await requireUser();
  if (user.role === 'FM') redirect('/fm');
  const { version } = await getActiveVersion();
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version!.id, scope.propertyIds, scope.categories);
  const { atoms, expenses } = await summaryData(version!.id, user, scope, rolls);
  const year = version!.year;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="page-title">Consolidated · {year}B</h1>
        <p className="page-sub">
          Year totals of the budget, as the Monthly Summary · standalone entities, owners&apos; share of the PMC properties and intergroup eliminations give {GROUP_NAME}; MJNH
          and MJN Private Office are outside the group · costs not budgeted yet show – · AED
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-[15px] font-bold">Income statement by entity</h2>
        <GroupTable pnl={groupPnl(atoms, expenses)} year={year} />
      </section>
      <section className="space-y-2">
        <h2 className="text-[15px] font-bold">Cash flow</h2>
        <CashByQuarter lines={cashStatement(atoms, expenses)} yy={String(year).slice(2)} />
      </section>
    </div>
  );
}

function CashByQuarter({ lines, yy }: { lines: StatementLine[]; yy: string }) {
  const q = (v: number[], i: number) => sum(v.slice(i * 3, i * 3 + 3));
  return (
    <div className="frame">
      <table className="tbl">
        <thead>
          <tr>
            <th className="stick stick-edge w-[320px]">Cash flow</th>
            {QUARTERS.map((h, i) => (
              <th key={h} className={`num w-[110px] ${i === 0 ? 'sep' : ''}`}>
                {h}-{yy}
              </th>
            ))}
            <th className="num sep w-[120px]">Year</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) =>
            l.kind === 'group' ? (
              <tr key={l.label} className="tbl-group">
                <td className="stick stick-edge">{l.label}</td>
                <td colSpan={5} />
              </tr>
            ) : (
              <tr key={l.label} className={l.kind === 'sub' ? 'tbl-sub' : l.kind === 'total' ? 'tbl-total' : ''}>
                <td className={`stick stick-edge ${l.kind === 'item' ? 'pl-6' : ''}`}>{l.label}</td>
                {QUARTERS.map((_, i) => (
                  // a running balance shows its quarter-end value
                  <Num key={i} v={l.vals ? (l.noTotal ? l.vals[i * 3 + 2] : q(l.vals, i)) : null} className={i === 0 ? 'sep' : ''} title={l.vals ? undefined : 'Not budgeted yet'} />
                ))}
                {l.noTotal ? <td className="sep" /> : <Num v={l.vals ? sum(l.vals) : null} bold={l.kind !== 'item'} className="sep" title={l.vals ? undefined : 'Not budgeted yet'} />}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
