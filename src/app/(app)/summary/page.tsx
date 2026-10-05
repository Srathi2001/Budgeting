import Link from 'next/link';
import { requireUser, getActiveVersion, visibleProperties } from '@/lib/auth/dal';
import { propertyRollups, autoOtherTotal, type PropertyRollup } from '@/lib/budget/reports';
import { fmt, MONTHS, sum } from '@/lib/format';

export const metadata = { title: 'Monthly Summary · Budget' };

const VIEWS = {
  revenue: { label: 'Rental revenue', get: (r: PropertyRollup) => r.revenue },
  cash: { label: 'Cash collections', get: (r: PropertyRollup) => r.cash },
  other: { label: 'Other income', get: (r: PropertyRollup) => autoOtherTotal(r).map((v, i) => v + r.manualOther[i]) },
} as const;

export default async function SummaryPage(props: PageProps<'/summary'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const sp = await props.searchParams;
  const view = (typeof sp.view === 'string' && sp.view in VIEWS ? sp.view : 'revenue') as keyof typeof VIEWS;
  const rolls = await propertyRollups(version!.id, (await visibleProperties(user)).map((p) => p.id));
  const get = VIEWS[view].get;

  const groups = new Map<string, PropertyRollup[]>();
  for (const r of rolls) groups.set(`${r.buCode} ${r.buName}`, [...(groups.get(`${r.buCode} ${r.buName}`) ?? []), r]);
  const colTotal = (rs: PropertyRollup[]) => MONTHS.map((_, i) => sum(rs.map((r) => get(r)[i])));

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Monthly summary · {version!.year}</h1>
        <div className="flex gap-1">
          {Object.entries(VIEWS).map(([k, v]) => (
            <Link key={k} href={`/summary?view=${k}`} className={k === view ? 'btn-primary' : 'btn'}>
              {v.label}
            </Link>
          ))}
        </div>
      </header>
      <div className="card overflow-auto">
        <table className="table-fin">
          <thead>
            <tr>
              <th>Property</th>
              <th>Code</th>
              {MONTHS.map((m) => (
                <th key={m} className="num">
                  {m}-{String(version!.year).slice(2)}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([bu, rs]) => (
              <BuBlock key={bu} bu={bu} rows={rs} get={get} total={colTotal(rs)} />
            ))}
            <tr className="total">
              <td colSpan={2}>Grand total</td>
              {colTotal(rolls).map((v, i) => (
                <td key={i} className="num">
                  {fmt(v)}
                </td>
              ))}
              <td className="num">{fmt(sum(colTotal(rolls)))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BuBlock({ bu, rows, get, total }: { bu: string; rows: PropertyRollup[]; get: (r: PropertyRollup) => number[]; total: number[] }) {
  return (
    <>
      <tr>
        <td colSpan={15} className="bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
          {bu}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.propertyId}>
          <td>
            <Link href={`/master?p=${r.propertyId}`} className="hover:text-sky-700 hover:underline">
              {r.name}
            </Link>
          </td>
          <td className="text-slate-500">{r.code}</td>
          {get(r).map((v, i) => (
            <td key={i} className="num">
              {fmt(v)}
            </td>
          ))}
          <td className="num font-medium">{fmt(sum(get(r)))}</td>
        </tr>
      ))}
      <tr className="font-medium">
        <td colSpan={2} className="text-slate-600">
          Subtotal
        </td>
        {total.map((v, i) => (
          <td key={i} className="num">
            {fmt(v)}
          </td>
        ))}
        <td className="num">{fmt(sum(total))}</td>
      </tr>
    </>
  );
}
