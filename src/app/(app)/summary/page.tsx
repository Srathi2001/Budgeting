import Link from 'next/link';
import { requireUser, getActiveVersion, isFinance } from '@/lib/auth/dal';
import { filteredScope } from '@/lib/filters-server';
import { propertyRollups, cashFlow, otherIncomeMonthly, type PropertyRollup } from '@/lib/budget/reports';
import { OI_ACCOUNTS } from '@/lib/budget/other-income-types';
import { EXPENSE_LINES, expenseMonthly } from '@/lib/budget/expenses';
import { ENTITIES, GROUP_NAME, type GroupClass } from '@/lib/budget/group';
import { PMA_EXPENSE, groupAtoms, sumAtoms, type Atom } from '@/lib/budget/group-report';
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

/** a statement line; vals null = not budgeted */
interface Line {
  label: string;
  code?: string;
  vals: number[] | null;
  kind?: 'group' | 'item' | 'sub' | 'total' | 'muted';
}

const z12 = () => Array.from({ length: 12 }, () => 0);
const addUp = (rows: (number[] | null)[]) => (rows.some(Boolean) ? MONTHS.map((_, i) => sum(rows.map((r) => r?.[i] ?? 0))) : null);
const neg = (v: number[] | null) => v && v.map((x) => -x);
const any = (v: number[]) => v.some((x) => Math.abs(x) >= 0.5);
const isOi = (a: Atom) => a.line.startsWith('oi:');
const isExp = (a: Atom) => a.line.startsWith('exp:');

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
    // company-level (General) other income: Finance only, and only the business unit filter applies to it
    const f = scope.filters;
    const general = isFinance(user) && !f.pm.length && !f.cat.length && !f.prop.length;
    const oi = await otherIncomeMonthly(version!.id, scope.propertyIds, scope.categories, (bu) => general && (!f.bu.length || f.bu.includes(bu)));
    const expenses = await expenseMonthly();
    const all = groupAtoms(rolls, oi);
    if (view === 'group') {
      body = <GroupTable atoms={all} expenses={expenses} year={version!.year} />;
    } else {
      // the monthly statements are the group's: entities outside it are left out
      const atoms = all.filter((a) => a.cls !== 'outside');
      const S = (match: (a: Atom) => boolean, cls?: GroupClass[]) => sumAtoms(atoms, (a) => match(a) && (!cls || cls.includes(a.cls)));
      const line = (l: string) => (a: Atom) => a.line === l;
      const oiLines: Line[] = OI_ACCOUNTS.map((a) => ({ label: a.name, code: a.code, vals: S(line(`oi:${a.code}`)), kind: 'item' as const })).filter((l) => any(l.vals));
      const oiTotal = addUp(oiLines.map((l) => l.vals)) ?? z12();
      const pma = S(line(`exp:${PMA_EXPENSE.key}`));
      const expLines: Line[] = [
        ...EXPENSE_LINES.map((l) => ({ label: l.label, vals: expenses.get(l.key) ?? null, kind: 'item' as const })),
        ...(any(pma) ? [{ label: PMA_EXPENSE.label, vals: pma, kind: 'item' as const }] : []),
      ];
      const expTotal = addUp(expLines.map((l) => l.vals));

      if (view === 'summary') {
        const rent = S(line('rent'));
        const income = MONTHS.map((_, i) => rent[i] + oiTotal[i]);
        const net = MONTHS.map((_, i) => income[i] - (expTotal?.[i] ?? 0));
        const owners = S((a) => a.line === 'rent' || isOi(a), ['owners']);
        const elimIncome = S(isOi, ['intergroup']);
        const elimCost = S(isExp, ['intergroup']);
        const adjusted = any(owners) || any(elimIncome) || any(elimCost);
        body = (
          <Statement
            yy={yy}
            head="Income & expenses"
            lines={[
              { label: 'Income', vals: null, kind: 'group' },
              { label: 'Rental revenue', vals: rent, kind: 'item' },
              ...oiLines,
              { label: 'Total other income', vals: oiTotal, kind: 'sub' },
              { label: 'Total income', vals: income, kind: 'sub' },
              { label: 'Expenses', vals: null, kind: 'group' },
              ...expLines,
              { label: 'Total expenses', vals: expTotal, kind: 'sub' },
              ...(adjusted
                ? [
                    { label: 'Net income · standalone', vals: net, kind: 'sub' as const },
                    { label: `Group adjustments`, vals: null, kind: 'group' as const },
                    ...(any(owners) ? [{ label: "Owners' share · PMC properties", vals: neg(owners), kind: 'item' as const }] : []),
                    ...(any(elimIncome) ? [{ label: 'Intergroup income eliminated · PMA fee', vals: neg(elimIncome), kind: 'item' as const }] : []),
                    ...(any(elimCost) ? [{ label: 'Intergroup cost eliminated · PMA fee', vals: elimCost, kind: 'item' as const }] : []),
                    { label: `Net income · ${GROUP_NAME}`, vals: MONTHS.map((_, i) => net[i] - owners[i] - elimIncome[i] + elimCost[i]), kind: 'total' as const },
                  ]
                : [{ label: 'Net income', vals: net, kind: 'total' as const }]),
            ]}
          />
        );
      } else {
        const cashIn: Line[] = [
          { label: 'Rent cheques (ex VAT)', vals: S(line('cash:rent')), kind: 'item' },
          { label: 'VAT collected on rent', vals: S(line('cash:vat')), kind: 'item' },
          { label: 'Other income', vals: S(line('cash:oi')), kind: 'item' },
          { label: 'Security deposits received', vals: S(line('cash:depositIn')), kind: 'item' },
        ];
        const cashOut: Line[] = [
          ...expLines.map((l) => ({ ...l, vals: neg(l.vals) })),
          { label: 'Security deposits refunded', vals: neg(S(line('cash:depositOut'))), kind: 'item' },
        ];
        const tin = addUp(cashIn.map((l) => l.vals)) ?? z12();
        const tout = addUp(cashOut.map((l) => l.vals)) ?? z12();
        const net = MONTHS.map((_, i) => tin[i] + tout[i]);
        const inLines = ['cash:rent', 'cash:vat', 'cash:oi', 'cash:depositIn'];
        const ownersIn = S((a) => inLines.includes(a.line), ['owners']);
        const ownersOut = S(line('cash:depositOut'), ['owners']);
        const owners = MONTHS.map((_, i) => ownersIn[i] - ownersOut[i]);
        const elimIn = S(line('cash:oi'), ['intergroup']);
        const elimOut = S((a) => a.line.startsWith('cash:exp:'), ['intergroup']);
        const adjusted = any(owners) || any(elimIn) || any(elimOut);
        const groupNet = MONTHS.map((_, i) => net[i] - owners[i] - elimIn[i] + elimOut[i]);
        const final = adjusted ? groupNet : net;
        const cumulative = final.map((_, i) => sum(final.slice(0, i + 1)));
        body = (
          <Statement
            yy={yy}
            head="Cash flow"
            lines={[
              { label: 'Cash in', vals: null, kind: 'group' },
              ...cashIn,
              { label: 'Total cash in', vals: tin, kind: 'sub' },
              { label: 'Cash out', vals: null, kind: 'group' },
              ...cashOut,
              { label: 'Total cash out', vals: tout, kind: 'sub' },
              ...(adjusted
                ? [
                    { label: 'Net cash flow · standalone', vals: net, kind: 'sub' as const },
                    { label: 'Group adjustments', vals: null, kind: 'group' as const },
                    ...(any(owners) ? [{ label: "Owners' collections · PMC properties", vals: neg(owners), kind: 'item' as const }] : []),
                    ...(any(elimIn) ? [{ label: 'Intergroup receipts eliminated · PMA fee', vals: neg(elimIn), kind: 'item' as const }] : []),
                    ...(any(elimOut) ? [{ label: 'Intergroup payments eliminated · PMA fee', vals: elimOut, kind: 'item' as const }] : []),
                    { label: `Net cash flow · ${GROUP_NAME}`, vals: groupNet, kind: 'total' as const },
                  ]
                : [{ label: 'Net cash flow', vals: net, kind: 'total' as const }]),
              { label: 'Cumulative net cash flow', vals: cumulative, kind: 'muted' },
            ]}
            noTotal={['Cumulative net cash flow']}
          />
        );
      }
    }
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
function Statement({ yy, head, lines, noTotal = [] }: { yy: string; head: string; lines: Line[]; noTotal?: string[] }) {
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
                {noTotal.includes(l.label) ? (
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

/** The budget year by entity, as the budget's PnLxREHLxANPM: standalone, adjustments, the group, then entities outside it. */
function GroupTable({ atoms, expenses, year }: { atoms: Atom[]; expenses: Map<string, number[] | null>; year: number }) {
  const inside = ENTITIES.filter((e) => !e.outside);
  const outside = ENTITIES.filter((e) => e.outside && atoms.some((a) => a.entity === e.key && Math.abs(sum(a.months)) >= 0.5));
  const total = (match: (a: Atom) => boolean, ok: (a: Atom) => boolean) => sum(atoms.filter((a) => match(a) && ok(a)).map((a) => sum(a.months)));
  /** entity columns, standalone, owners' share, eliminations, group, outside columns */
  const cells = (match: (a: Atom) => boolean, extra = 0): number[] => {
    const ent = inside.map((e) => total(match, (a) => a.entity === e.key));
    const standalone = sum(ent) + extra;
    const owners = -total(match, (a) => a.cls === 'owners');
    const elim = -total(match, (a) => a.cls === 'intergroup');
    return [...ent, standalone, owners, elim, standalone + owners + elim, ...outside.map((e) => total(match, (a) => a.entity === e.key))];
  };
  const n = inside.length + 4 + outside.length;
  const isRent = (a: Atom) => a.line === 'rent';
  const oiAccounts = OI_ACCOUNTS.filter((acc) => atoms.some((a) => a.line === `oi:${acc.code}` && Math.abs(sum(a.months)) >= 0.5));
  const placeholders = EXPENSE_LINES.map((l) => ({ l, v: expenses.get(l.key) ?? null }));
  const placeholderTotal = sum(placeholders.map((p) => (p.v ? sum(p.v) : 0)));
  const hasPma = atoms.some((a) => a.line === `exp:${PMA_EXPENSE.key}`);
  const income = cells((a) => isRent(a) || isOi(a));
  const cost = cells(isExp, placeholderTotal);
  const net = income.map((v, i) => v - cost[i]);
  // a placeholder expense: only a standalone / group figure once budgeted
  const placeholderCells = (v: number[] | null): (number | null)[] =>
    v ? [...inside.map(() => null), sum(v), 0, 0, sum(v), ...outside.map(() => null)] : Array.from({ length: n }, () => null);
  const sepAt = new Set([0, inside.length, inside.length + 4]);

  const rowProps = { sepAt, groupCol: inside.length + 3 };

  return (
    <div className="frame">
      <table className="tbl">
        <thead>
          <tr className="tbl-band">
            <th className="stick" />
            <th className="sep" colSpan={inside.length}>
              Entities · {year}B
            </th>
            <th className="sep" colSpan={4}>
              Consolidation
            </th>
            {outside.length > 0 && (
              <th className="sep" colSpan={outside.length}>
                Outside the group
              </th>
            )}
          </tr>
          <tr>
            <th className="stick stick-edge w-[300px]">Line</th>
            {inside.map((e, i) => (
              <th key={e.key} className={`num w-[104px] ${i === 0 ? 'sep' : ''}`}>
                {e.label}
              </th>
            ))}
            <th className="num sep w-[110px]">Standalone</th>
            <th className="num w-[104px]">Owners&apos; share</th>
            <th className="num w-[104px]">Eliminations</th>
            <th className="num w-[116px]">{GROUP_NAME}</th>
            {outside.map((e, i) => (
              <th key={e.key} className={`num w-[104px] ${i === 0 ? 'sep' : ''}`}>
                {e.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <GroupHead label="Income" span={n} />
          <GroupRow {...rowProps} label="Rental revenue" vals={cells(isRent)} kind="item" />
          {oiAccounts.map((acc) => (
            <GroupRow key={acc.code} {...rowProps} label={acc.name} code={acc.code} vals={cells((a) => a.line === `oi:${acc.code}`)} kind="item" />
          ))}
          <GroupRow {...rowProps} label="Total other income" vals={cells(isOi)} kind="sub" />
          <GroupRow {...rowProps} label="Total income" vals={income} kind="sub" />
          <GroupHead label="Expenses" span={n} />
          {placeholders.map(({ l, v }) => (
            <GroupRow key={l.key} {...rowProps} label={l.label} vals={placeholderCells(v)} kind="item" />
          ))}
          {hasPma && <GroupRow {...rowProps} label={PMA_EXPENSE.label} vals={cells((a) => a.line === `exp:${PMA_EXPENSE.key}`)} kind="item" />}
          <GroupRow {...rowProps} label="Total expenses" vals={cost} kind="sub" />
          <GroupRow {...rowProps} label="Net income" vals={net} kind="total" />
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({ label, code, vals, kind, sepAt, groupCol }: { label: string; code?: string; vals: (number | null)[]; kind?: 'item' | 'sub' | 'total'; sepAt: Set<number>; groupCol: number }) {
  return (
    <tr className={kind === 'sub' ? 'tbl-sub' : kind === 'total' ? 'tbl-total' : ''}>
      <td className="stick stick-edge">
        <div className="flex w-[280px] items-baseline gap-2 overflow-hidden">
          <span className={`truncate ${kind === 'item' ? 'pl-3' : ''}`} title={label}>
            {label}
          </span>
          {code && <span className="shrink-0 text-[11px] text-slate-400">{code}</span>}
        </div>
      </td>
      {vals.map((v, i) => (
        <Num key={i} v={v} bold={kind !== 'item' && i === groupCol} className={sepAt.has(i) ? 'sep' : ''} title={v === null ? 'Not budgeted yet' : undefined} />
      ))}
    </tr>
  );
}

function GroupHead({ label, span }: { label: string; span: number }) {
  return (
    <tr className="tbl-group">
      <td className="stick stick-edge">{label}</td>
      <td colSpan={span} />
    </tr>
  );
}
