import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireUser, getActiveVersion, visibleProperties, editablePropertyIds } from '@/lib/auth/dal';
import { propertyRollups, type PropertyRollup } from '@/lib/budget/reports';
import { fmt, sum } from '@/lib/format';
import { OtherIncomeEditor, type GlLine } from './editor';

export const metadata = { title: 'Other Income · Budget' };

const AUTO: Record<string, (r: PropertyRollup) => number[]> = {
  ADMIN: (r) => r.autoOther.adminFee,
  EJARI: (r) => r.autoOther.ejariFee,
  MF: (r) => r.autoOther.mfFee,
  AGENCY: (r) => r.autoOther.agencyFee,
};

export default async function OtherIncomePage(props: PageProps<'/other-income'>) {
  const user = await requireUser();
  const { version } = await getActiveVersion();
  const v = version!;
  const sp = await props.searchParams;
  const visible = await visibleProperties(user);
  const selected = typeof sp.p === 'string' ? visible.find((p) => p.id === Number(sp.p)) : undefined;
  const gls = await db.select().from(schema.glAccounts).orderBy(asc(schema.glAccounts.sort));
  const manual = await db.select().from(schema.otherIncome).where(eq(schema.otherIncome.versionId, v.id));
  const rolls = await propertyRollups(v.id, visible.map((p) => p.id));

  const lineFor = (r: PropertyRollup, gl: (typeof gls)[number]): number[] => {
    if (gl.autoSource && AUTO[gl.autoSource]) return AUTO[gl.autoSource](r);
    const m = manual.find((o) => o.propertyId === r.propertyId && o.glCode === gl.code);
    return m ? m.months.map(Number) : Array(12).fill(0);
  };

  if (selected) {
    const r = rolls.find((x) => x.propertyId === selected.id)!;
    const editable = (await editablePropertyIds(user, v)).has(selected.id);
    const lines: GlLine[] = gls.map((g) => ({
      code: g.code,
      name: g.name,
      owner: g.owner,
      auto: !!g.autoSource,
      months: lineFor(r, g),
    }));
    return (
      <div className="space-y-4 p-6">
        <Header properties={visible} selected={selected.id} />
        <OtherIncomeEditor versionId={v.id} propertyId={selected.id} year={v.year} lines={lines} editable={editable} />
      </div>
    );
  }

  const used = gls.filter((g) => rolls.some((r) => sum(lineFor(r, g)) !== 0));
  return (
    <div className="space-y-4 p-6">
      <Header properties={visible} selected={null} />
      <div className="card overflow-auto">
        <table className="table-fin">
          <thead>
            <tr>
              <th>Code</th>
              <th>Property</th>
              <th>BU</th>
              {used.map((g) => (
                <th key={g.code} className="num" title={g.name}>
                  {g.code}
                  <div className="max-w-32 truncate font-normal">{g.name}</div>
                  {g.autoSource && <div className="font-normal text-sky-700">calculated</div>}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rolls.map((r) => {
              const vals = used.map((g) => sum(lineFor(r, g)));
              return (
                <tr key={r.propertyId}>
                  <td className="text-slate-500">{r.code}</td>
                  <td>
                    <Link href={`/other-income?p=${r.propertyId}`} className="hover:text-sky-700 hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.buCode}</td>
                  {vals.map((x, i) => (
                    <td key={used[i].code} className="num">
                      {fmt(x)}
                    </td>
                  ))}
                  <td className="num font-semibold">{fmt(sum(vals))}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td colSpan={3}>Total</td>
              {used.map((g) => (
                <td key={g.code} className="num">
                  {fmt(sum(rolls.map((r) => sum(lineFor(r, g)))))}
                </td>
              ))}
              <td className="num">{fmt(sum(used.map((g) => sum(rolls.map((r) => sum(lineFor(r, g)))))))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header({ properties, selected }: { properties: { id: number; code: string; name: string }[]; selected: number | null }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold">Other income</h1>
      <nav className="flex flex-wrap gap-1 text-sm">
        <Link href="/other-income" className={selected === null ? 'btn-primary' : 'btn'}>
          All properties
        </Link>
      </nav>
      <form action="/other-income" className="flex items-center gap-2">
        <select name="p" defaultValue={selected ?? ''} className="input w-72">
          <option value="" disabled>
            Edit a property…
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button className="btn">Open</button>
      </form>
      <p className="w-full text-xs text-slate-500">
        Admin fee, agency commission, maintenance service fee (MF) and Ejari fee are calculated from the Revenue Master. Other
        lines are budgeted here by month.
      </p>
    </header>
  );
}
