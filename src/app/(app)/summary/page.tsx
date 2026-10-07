import Link from 'next/link';
import { requireUser, getActiveVersion } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow, type PropertyRollup } from '@/lib/budget/reports';
import { MONTHS, sum } from '@/lib/format';
import { Num } from '@/components/num';

export const metadata = { title: 'Monthly Summary · Budget' };

const VIEWS = {
  revenue: { label: 'Rental revenue', get: (r: PropertyRollup) => r.revenue },
  cash: { label: 'Cash inflow', get: (r: PropertyRollup) => cashFlow(r) },
  flow: { label: 'Cash flow breakdown', get: (r: PropertyRollup) => cashFlow(r) },
} as const;

type View = keyof typeof VIEWS;

export default async function SummaryPage(props: PageProps<'/summary'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await props.searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'revenue') as View;
  // the shared page filters (BU, PM, category, property)
  const scope = await filteredScope(user);
  const rolls = await propertyRollups(version!.id, scope.propertyIds, scope.categories);
  const yy = String(version!.year).slice(2);

  return (
    <div className="space-y-3 p-6">
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="page-title">Monthly summary · {version!.year}</h1>
          <p className="page-sub">
            {view === 'cash' || view === 'flow'
              ? 'Cash inflow = rent cheques + VAT + security deposits received − refunded · AED'
              : 'By property and month · AED'}
          </p>
        </div>
        <nav className="seg ml-auto">
          {(Object.keys(VIEWS) as View[]).map((k) => (
            <Link key={k} href={`/summary?view=${k}`} className={k === view ? 'on' : ''}>
              {VIEWS[k].label}
            </Link>
          ))}
        </nav>
      </header>
      {view === 'flow' ? <CashFlowTable rolls={rolls} yy={yy} /> : <PropertyTable rolls={rolls} get={VIEWS[view].get} yy={yy} />}
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
          {[...groups.entries()].map(([bu, rs]) => {
            const t = col(rs);
            return (
              <BuRows key={bu} bu={bu} rows={rs} get={get} total={t} />
            );
          })}
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

function CashFlowTable({ rolls, yy }: { rolls: PropertyRollup[]; yy: string }) {
  const m = (f: (r: PropertyRollup, i: number) => number) => MONTHS.map((_, i) => sum(rolls.map((r) => f(r, i))));
  const lines: { label: string; vals: number[]; kind?: 'sub' | 'total' | 'neg' }[] = [
    { label: 'Rent cheques (ex VAT)', vals: m((r, i) => r.cash[i]) },
    { label: 'VAT collected on rent', vals: m((r, i) => r.vat[i]) },
  ];
  const operating = MONTHS.map((_, i) => sum(lines.map((l) => l.vals[i])));
  const depIn = m((r, i) => r.depositIn[i]);
  const depOut = m((r, i) => -r.depositOut[i]);
  const all = MONTHS.map((_, i) => operating[i] + depIn[i] + depOut[i]);
  const rows = [
    ...lines,
    { label: 'Rent collections incl. VAT', vals: operating, kind: 'sub' as const },
    { label: 'Security deposits received', vals: depIn },
    { label: 'Security deposits refunded', vals: depOut },
    { label: 'Total cash inflow', vals: all, kind: 'total' as const },
  ];
  return (
    <div className="frame">
      <table className="tbl">
        <MonthHead yy={yy} first={<th className="stick stick-edge w-[300px]">Portfolio</th>} />
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.kind === 'sub' ? 'tbl-sub' : r.kind === 'total' ? 'tbl-total' : ''}>
              <td className="stick stick-edge">{r.label}</td>
              {r.vals.map((v, i) => (
                <Num key={i} v={v} className={i === 0 ? 'sep' : ''} />
              ))}
              <Num v={sum(r.vals)} bold className="sep" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
