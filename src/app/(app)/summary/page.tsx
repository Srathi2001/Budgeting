import Link from 'next/link';
import { requireUser, requireVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow, type PropertyRollup } from '@/lib/budget/reports';
import { GROUP_NAME } from '@/lib/budget/group';
import { cashStatement, groupPnl, incomeStatement, summaryData } from '@/lib/budget/summary';
import { StatementTable, StatementHead, Basis } from '@/components/statement';
import { PageHeader } from '@/components/ui/page-header';
import { RoutedTabs } from '@/components/ui/tabs';
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
  summary: `Rent, other income and expenses by month, then the group adjustments to ${GROUP_NAME}`,
  flow: `Cash in and out by month, then the group adjustments to ${GROUP_NAME}`,
  group: `Budget year by entity: standalone, owners' share of the PMC properties, intergroup eliminations, ${GROUP_NAME}`,
  revenue: 'Rental revenue by property and month',
  cash: 'Cash inflow by property and month',
};
/** what the numbers are, under each view */
const BASIS: Record<View, string> = {
  summary: 'AED, ex VAT. Rent recognised by day over the lease; other income: maintenance fee in the contract month, the rest evenly over 12 months. Costs not budgeted yet show –.',
  flow: 'AED. Rent cheques in their cheque month, with VAT; other income as booked; security deposits received less refunded. Costs not budgeted yet show –.',
  group: 'AED, ex VAT, budget year totals. MJNH and MJN Private Office are outside the group.',
  revenue: 'AED, ex VAT. Rent recognised by day over the lease, from the Lease Budget.',
  cash: 'AED. Cash inflow = rent cheques + VAT + security deposits received − refunded.',
};

export default async function SummaryPage(props: PageProps<'/summary'>) {
  const user = await requireUser();
  const version = await requireVersion();
  const sp = await props.searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'summary') as View;
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version.id, scope.propertyIds, scope.categories);
  const yy = String(version.year).slice(2);

  let body: React.ReactNode;
  if (view === 'summary' || view === 'flow' || view === 'group') {
    const { atoms, expenses } = await summaryData(version.id, user, scope, rolls);
    body =
      view === 'group' ? (
        <>
          <GroupTable pnl={groupPnl(atoms, expenses)} year={version.year} />
          <Basis>{BASIS.group}</Basis>
        </>
      ) : view === 'summary' ? (
        <StatementTable period="month" yy={yy} head="Income & expenses" lines={incomeStatement(atoms, expenses)} basis={BASIS.summary} caption={`Income and expenses by month, ${version.name}`} />
      ) : (
        <StatementTable period="month" yy={yy} head="Cash flow" lines={cashStatement(atoms, expenses)} basis={BASIS.flow} caption={`Cash flow by month, ${version.name}`} />
      );
  } else {
    body = (
      <>
        <PropertyTable rolls={rolls} get={view === 'revenue' ? (r) => r.revenue : cashFlow} yy={yy} />
        <Basis>{BASIS[view]}</Basis>
      </>
    );
  }

  return (
    <div className="anh-main">
      <PageHeader
        eyebrow="Statements"
        title={`Monthly Summary · ${version.year}`}
        sub={`${version.name} · ${SUBTITLE[view]}`}
        actions={
          <a className="ui-btn ui-btn--secondary ui-btn--sm" href="/api/export/summary" title="Every view of the Monthly Summary, one sheet each, for the current filters">
            Export to Excel
          </a>
        }
        tabs={
          <RoutedTabs
            ariaLabel="Monthly Summary views"
            tabs={(Object.keys(VIEWS) as View[]).map((k) => ({ href: k === 'summary' ? '/summary' : `/summary?view=${k}`, label: VIEWS[k], param: { name: 'view', value: k === 'summary' ? null : k } }))}
          />
        }
      />
      {body}
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
        <StatementHead period="month" yy={yy} first="Property" firstWidth={300} />
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
