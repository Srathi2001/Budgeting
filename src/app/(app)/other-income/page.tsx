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
      <div className="frame frame-tall">
        <table className="tbl">
          <thead>
            <tr>
              <th className="stick stick-edge w-[300px]">Property</th>
              <th className="w-14">BU</th>
              {used.map((g) => (
                <th key={g.code} className="num sep w-28 normal-case" title={g.name}>
                  <div className="text-[11px] tracking-normal text-slate-500">{g.code}</div>
                  <div className="ml-auto max-w-28 truncate tracking-normal">{g.name.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</div>
                  {g.autoSource && <div className="font-normal tracking-normal text-sky-700">calculated</div>}
                </th>
              ))}
              <th className="num sep w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {rolls.map((r) => {
              const vals = used.map((g) => sum(lineFor(r, g)));
              return (
                <tr key={r.propertyId}>
                  <td className="stick stick-edge">
                    <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
                      <Link href={`/other-income?p=${r.propertyId}`} className="truncate hover:text-sky-700 hover:underline" title={r.name}>
                        {r.name}
                      </Link>
                      <span className="shrink-0 text-[11px] text-slate-400">{r.code}</span>
                    </div>
                  </td>
                  <td className="muted">{r.buCode}</td>
                  {vals.map((x, i) => (
                    <td key={used[i].code} className="num sep">
                      {fmt(x)}
                    </td>
                  ))}
                  <td className="num sep font-semibold">{fmt(sum(vals))}</td>
                </tr>
              );
            })}
            <tr className="tbl-total">
              <td className="stick stick-edge" colSpan={2}>
                Total
              </td>
              {used.map((g) => (
                <td key={g.code} className="num sep">
                  {fmt(sum(rolls.map((r) => sum(lineFor(r, g)))))}
                </td>
              ))}
              <td className="num sep">{fmt(sum(used.map((g) => sum(rolls.map((r) => sum(lineFor(r, g)))))))}</td>
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
      <h1 className="page-title">Other income</h1>
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
        Admin fee, agency commission, maintenance service fee (MF) and Ejari fee are calculated from the Lease Budget. Other
        lines are budgeted here by month.
      </p>
    </header>
  );
}
