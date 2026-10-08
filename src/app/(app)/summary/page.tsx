import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow, type PropertyRollup } from '@/lib/budget/reports';
import { GROUP_NAME } from '@/lib/budget/group';
import { cashStatement, groupPnl, incomeStatement, summaryData, type StatementLine } from '@/lib/budget/summary';
import { GroupTable } from '@/components/group-table';
import { MONTHS, sum } from '@/lib/format';
import { Num } from '@/components/num';

export const metadata = { title: 'Monthly Summary · Budget' };

const VIEWS = {
  summary: 'Income & expenses',
  flow: 'Cash flow',
  group: 'Group P&L',
  revenue: 'Rent by property',
  cash: 'Rent cash by property',
} as const;

type View = keyof typeof VIEWS;

const SUBTITLE: Record<View, string> = {
  summary: `Rent, other income and expenses by month, then the group adjustments to ${GROUP_NAME} · other income: maintenance fee in the contract month, the rest evenly over 12 months · AED`,
  flow: `Cash in and out by month, then the group adjustments to ${GROUP_NAME} · rent cheques with VAT, other income as booked, security deposits · AED`,
  group: `Budget year by entity: standalone, owners' share of the PMC properties, intergroup eliminations, ${GROUP_NAME} · MJNH and MJN Private Office are outside the group · AED`,
  revenue: 'Rental revenue by property and month · AED',
  cash: 'Cash inflow = rent cheques + VAT + security deposits received − refunded · AED',
};

export default async function SummaryPage(props: PageProps<'/summary'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await props.searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'summary') as View;
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version!.id, scope.propertyIds, scope.categories);
  const yy = String(version!.year).slice(2);

  let body: React.ReactNode;
  if (view === 'summary' || view === 'flow' || view === 'group') {
    const { atoms, expenses } = await summaryData(version!.id, user, scope, rolls);
    body =
      view === 'group' ? (
        <GroupTable pnl={groupPnl(atoms, expenses)} year={version!.year} />
      ) : view === 'summary' ? (
        <Statement yy={yy} head="Income & expenses" lines={incomeStatement(atoms, expenses)} />
      ) : (
        <Statement yy={yy} head="Cash flow" lines={cashStatement(atoms, expenses)} />
      );
  } else {
    body = <PropertyTable rolls={rolls} get={view === 'revenue' ? (r) => r.revenue : cashFlow} yy={yy} />;
  }

  return (
    <div className="space-y-3 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="page-title">Monthly summary · {version!.year}</h1>
          <p className="page-sub">{SUBTITLE[view]}</p>
        </div>
        <nav className="seg ml-auto">
          {(Object.keys(VIEWS) as View[]).map((k) => (
            <Link key={k} href={`/summary?view=${k}`} className={k === view ? 'on' : ''}>
              {VIEWS[k]}
            </Link>
          ))}
        </nav>
        <a className="btn" href="/api/export/summary" title="Every view of the Monthly Summary, one sheet each, for the current filters">
          Export to Excel
        </a>
      </header>
      {body}
    </div>
  );
}

function MonthHead({ yy, first }: { yy: string; first: React.ReactNode }) {
  return (
    <thead>
      <tr>
        {first}
        {MONTHS.map((m, i) => (
          <th key={m} className={`num w-[92px] ${i === 0 ? 'sep' : ''}`}>
            {m}-{yy}
          </th>
        ))}
        <th className="num sep w-[110px]">Total</th>
      </tr>
    </thead>
  );
}

/** A monthly statement: group headings, items, subtotals and a total. */
function Statement({ yy, head, lines }: { yy: string; head: string; lines: StatementLine[] }) {
  return (
    <div className="frame">
      <table className="tbl">
        <MonthHead yy={yy} first={<th className="stick stick-edge w-[320px]">{head}</th>} />
        <tbody>
          {lines.map((l) =>
            l.kind === 'group' ? (
              <tr key={l.label} className="tbl-group">
                <td className="stick stick-edge">{l.label}</td>
                <td colSpan={13} />
              </tr>
            ) : (
              <tr key={l.label} className={l.kind === 'sub' ? 'tbl-sub' : l.kind === 'total' ? 'tbl-total' : ''}>
                <td className={`stick stick-edge ${l.kind === 'muted' ? 'text-slate-500' : ''}`}>
                  <div className="flex w-[300px] items-baseline gap-2 overflow-hidden">
                    <span className={`truncate ${l.kind === 'item' ? 'pl-3' : ''}`} title={l.label}>
                      {l.label}
                    </span>
                    {l.code && <span className="shrink-0 text-[11px] text-slate-400">{l.code}</span>}
                  </div>
                </td>
                {MONTHS.map((_, i) => (
                  <Num key={i} v={l.vals ? l.vals[i] : null} className={i === 0 ? 'sep' : ''} title={l.vals ? undefined : 'Not budgeted yet'} />
                ))}
                {l.noTotal ? (
                  <td className="sep" />
                ) : (
                  <Num v={l.vals ? sum(l.vals) : null} bold={l.kind !== 'item'} className="sep" title={l.vals ? undefined : 'Not budgeted yet'} />
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function PropertyTable({ rolls, get, yy }: { rolls: PropertyRollup[]; get: (r: PropertyRollup) => number[]; yy: string }) {
  const groups = new Map<string, PropertyRollup[]>();
  for (const r of rolls) groups.set(`${r.buCode} · ${r.buName}`, [...(groups.get(`${r.buCode} · ${r.buName}`) ?? []), r]);
  const col = (rs: PropertyRollup[]) => MONTHS.map((_, i) => sum(rs.map((r) => get(r)[i])));
  const grand = col(rolls);
  return (
    <div className="frame frame-tall">
      <table className="tbl">
        <MonthHead yy={yy} first={<th className="stick stick-edge w-[300px]">Property</th>} />
        <tbody>
          {[...groups.entries()].map(([bu, rs]) => (
            <BuRows key={bu} bu={bu} rows={rs} get={get} total={col(rs)} />
          ))}
          <tr className="tbl-total">
            <td className="stick stick-edge">Total</td>
            {grand.map((v, i) => (
              <Num key={i} v={v} className={i === 0 ? 'sep' : ''} />
            ))}
            <Num v={sum(grand)} className="sep" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BuRows({ bu, rows, get, total }: { bu: string; rows: PropertyRollup[]; get: (r: PropertyRollup) => number[]; total: number[] }) {
  return (
    <>
      <tr className="tbl-group">
        <td className="stick stick-edge" colSpan={1}>
          {bu}
        </td>
        <td colSpan={13} />
      </tr>
      {rows.map((r) => (
        <tr key={r.propertyId}>
          <td className="stick stick-edge">
            <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
              <Link href={`/master?p=${r.propertyId}`} className="truncate hover:text-sky-700 hover:underline" title={r.name}>
                {r.name}
              </Link>
              <span className="shrink-0 text-[11px] text-slate-400">{r.code}</span>
            </div>
          </td>
          {get(r).map((v, i) => (
            <Num key={i} v={v} className={i === 0 ? 'sep' : ''} />
          ))}
          <Num v={sum(get(r))} bold className="sep" />
        </tr>
      ))}
      <tr className="tbl-sub">
        <td className="stick stick-edge text-slate-600">Subtotal</td>
        {total.map((v, i) => (
          <Num key={i} v={v} className={i === 0 ? 'sep' : ''} />
        ))}
        <Num v={sum(total)} className="sep" />
      </tr>
    </>
  );
}
