// Monthly Summary statements (Income & expenses, Cash flow, Group P&L), built once for the page and
// its Excel export so both always show the same figures.
import 'server-only';
import { isFinance, type CurrentUser } from '@/lib/auth/dal';
import type { Filters } from '@/lib/filters';
import type { Category } from './category';
import { otherIncomeMonthly, type PropertyRollup } from './reports';
import { OI_ACCOUNTS } from './other-income-types';
import { BELOW_GP_LINES, CASH_ONLY_LINES, GA_CASH_LINES, GA_LINES, OPEX_LINES, budgetedExpenseLines, isPnlLine, propertyExpenses, type ExpenseLine } from './expenses';
import { ENTITIES, GROUP_NAME, type GroupClass } from './group';
import { PMA_EXPENSE, groupAtoms, sumAtoms, type Atom } from './group-report';
import { MONTHS, sum } from '@/lib/format';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { adminEntityCosts } from './admin';

/** a statement line; vals null = not budgeted */
export interface StatementLine {
  label: string;
  code?: string;
  vals: number[] | null;
  kind?: 'group' | 'item' | 'sub' | 'total' | 'muted';
  /** a running balance: no year total */
  noTotal?: boolean;
}

const z12 = () => Array.from({ length: 12 }, () => 0);
const addUp = (rows: (number[] | null)[]) => (rows.some(Boolean) ? MONTHS.map((_, i) => sum(rows.map((r) => r?.[i] ?? 0))) : null);
const neg = (v: number[] | null) => v && v.map((x) => -x);
const any = (v: number[]) => v.some((x) => Math.abs(x) >= 0.5);
const isOi = (a: Atom) => a.line.startsWith('oi:');
/** a P&L expense (capex items are in the cash flow only) */
const isExp = (a: Atom) => a.line.startsWith('exp:') && isPnlLine(a.line.slice(4));
const isOpex = (a: Atom) => isExp(a) && ![...BELOW_GP_LINES, ...GA_LINES].some((l) => a.line === `exp:${l.key}`);

/** Rent, other income (General rows: Finance only, and only the BU filter applies) and expenses of the selection. */
export async function summaryData(
  versionId: number,
  user: CurrentUser,
  scope: { filters: Filters; propertyIds: number[]; categories: Category[] },
  rolls: PropertyRollup[],
) {
  const f = scope.filters;
  const general = isFinance(user) && !f.pm.length && !f.cat.length && !f.prop.length;
  const oi = await otherIncomeMonthly(versionId, scope.propertyIds, scope.categories, (bu) => general && (!f.bu.length || f.bu.includes(bu)));
  const costs = await propertyExpenses(versionId, scope.propertyIds);
  // general & administration: company level, like the General rows (Finance, only the BU filter applies)
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const ga = general && version ? (await adminEntityCosts(version)).costs.filter((c) => !f.bu.length || f.bu.includes(c.entity === 'MALL' ? '502' : c.entity)) : [];
  return { atoms: groupAtoms(rolls, oi, costs, ga), expenses: await budgetedExpenseLines(versionId) };
}

/** the parts both monthly statements share (the group's: entities outside it are left out) */
function parts(all: Atom[], expenses: Set<string>) {
  const atoms = all.filter((a) => a.cls !== 'outside');
  const S = (match: (a: Atom) => boolean, cls?: GroupClass[]) => sumAtoms(atoms, (a) => match(a) && (!cls || cls.includes(a.cls)));
  const line = (l: string) => (a: Atom) => a.line === l;
  const oiLines: StatementLine[] = OI_ACCOUNTS.map((a) => ({ label: a.name, code: a.code, vals: S(line(`oi:${a.code}`)), kind: 'item' as const })).filter((l) => any(l.vals!));
  const pma = S(line(`exp:${PMA_EXPENSE.key}`));
  const of = (ls: ExpenseLine[], prefix = 'exp'): StatementLine[] =>
    ls.map((l) => ({ label: l.label, vals: expenses.has(l.key) ? S(line(`${prefix}:${l.key}`)) : null, kind: 'item' as const }));
  // operating costs (in gross profit), major repairs (below it), capex items (cash flow only)
  const opexLines: StatementLine[] = [...of(OPEX_LINES), ...(any(pma) ? [{ label: PMA_EXPENSE.label, vals: pma, kind: 'item' as const }] : [])];
  const belowGpLines = of(BELOW_GP_LINES);
  // general & administration, below major repairs (company level)
  const gaLines = of(GA_LINES);
  const cashOnlyLines = of([...CASH_ONLY_LINES, ...GA_CASH_LINES]);
  // what is paid, by month: every cost line from its cash months (premiums paid upfront differ from the expense)
  const pmaPaid = S(line(`cash:exp:${PMA_EXPENSE.key}`));
  const paidLines: StatementLine[] = [
    ...of([...OPEX_LINES, ...BELOW_GP_LINES, ...GA_LINES, ...CASH_ONLY_LINES, ...GA_CASH_LINES], 'cash:exp'),
    ...(any(pmaPaid) ? [{ label: PMA_EXPENSE.label, vals: pmaPaid, kind: 'item' as const }] : []),
  ];
  return {
    S,
    line,
    oiLines,
    oiTotal: addUp(oiLines.map((l) => l.vals)) ?? z12(),
    opexLines,
    opexTotal: addUp(opexLines.map((l) => l.vals)),
    belowGpLines,
    belowGpTotal: addUp(belowGpLines.map((l) => l.vals)),
    gaLines,
    gaTotal: addUp(gaLines.map((l) => l.vals)),
    cashOnlyLines,
    cashOnlyTotal: addUp(cashOnlyLines.map((l) => l.vals)),
    paidLines,
  };
}

export function incomeStatement(all: Atom[], expenses: Set<string>): StatementLine[] {
  const { S, line, oiLines, oiTotal, opexLines, opexTotal, belowGpLines, belowGpTotal, gaLines, gaTotal, cashOnlyLines } = parts(all, expenses);
  const rent = S(line('rent'));
  const income = MONTHS.map((_, i) => rent[i] + oiTotal[i]);
  const gross = MONTHS.map((_, i) => income[i] - (opexTotal?.[i] ?? 0));
  const net = MONTHS.map((_, i) => gross[i] - (belowGpTotal?.[i] ?? 0) - (gaTotal?.[i] ?? 0));
  // PMC buildings: their income less their costs is the owners'
  const ownersIncome = S((a) => a.line === 'rent' || isOi(a), ['owners']);
  const ownersCost = S(isExp, ['owners']);
  const owners = MONTHS.map((_, i) => ownersIncome[i] - ownersCost[i]);
  const elimIncome = S(isOi, ['intergroup']);
  const elimCost = S(isExp, ['intergroup']);
  const adjusted = any(owners) || any(elimIncome) || any(elimCost);
  return [
    { label: 'Income', vals: null, kind: 'group' },
    { label: 'Rental revenue', vals: rent, kind: 'item' },
    ...oiLines,
    { label: 'Total other income', vals: oiTotal, kind: 'sub' },
    { label: 'Total income', vals: income, kind: 'sub' },
    { label: 'Operating expenses', vals: null, kind: 'group' },
    ...opexLines,
    { label: 'Total operating expenses', vals: opexTotal, kind: 'sub' },
    { label: 'Gross profit', vals: gross, kind: 'sub' },
    ...belowGpLines,
    { label: 'General & administration', vals: null, kind: 'group' },
    ...gaLines,
    { label: 'Total general & administration', vals: gaTotal, kind: 'sub' },
    ...(adjusted
      ? [
          { label: 'Net income · standalone', vals: net, kind: 'sub' as const },
          { label: 'Group adjustments', vals: null, kind: 'group' as const },
          ...(any(owners) ? [{ label: "Owners' share · PMC properties", vals: neg(owners), kind: 'item' as const }] : []),
          ...(any(elimIncome) ? [{ label: 'Intergroup income eliminated · PMA fee', vals: neg(elimIncome), kind: 'item' as const }] : []),
          ...(any(elimCost) ? [{ label: 'Intergroup cost eliminated · PMA fee', vals: elimCost, kind: 'item' as const }] : []),
          { label: `Net income · ${GROUP_NAME}`, vals: MONTHS.map((_, i) => net[i] - owners[i] - elimIncome[i] + elimCost[i]), kind: 'total' as const },
        ]
      : [{ label: 'Net income', vals: net, kind: 'total' as const }]),
    // capex items are paid (Cash flow) but not expensed; shown for reference, standalone
    { label: 'Cash flow only', vals: null, kind: 'group' },
    ...cashOnlyLines.map((l) => ({ ...l, kind: 'muted' as const })),
  ];
}

export function cashStatement(all: Atom[], expenses: Set<string>): StatementLine[] {
  const p = parts(all, expenses);
  const { S, line } = p;
  // every cost is paid: operating costs, major repairs and capex items, in the month paid
  const expLines = p.paidLines;
  const cashIn: StatementLine[] = [
    { label: 'Rent cheques (ex VAT)', vals: S(line('cash:rent')), kind: 'item' },
    { label: 'VAT collected on rent', vals: S(line('cash:vat')), kind: 'item' },
    { label: 'Other income', vals: S(line('cash:oi')), kind: 'item' },
    { label: 'Security deposits received', vals: S(line('cash:depositIn')), kind: 'item' },
  ];
  const cashOut: StatementLine[] = [
    ...expLines.map((l) => ({ ...l, vals: neg(l.vals) })),
    { label: 'Security deposits refunded', vals: neg(S(line('cash:depositOut'))), kind: 'item' },
  ];
  const tin = addUp(cashIn.map((l) => l.vals)) ?? z12();
  const tout = addUp(cashOut.map((l) => l.vals)) ?? z12();
  const net = MONTHS.map((_, i) => tin[i] + tout[i]);
  const inLines = ['cash:rent', 'cash:vat', 'cash:oi', 'cash:depositIn'];
  const ownersIn = S((a) => inLines.includes(a.line), ['owners']);
  const ownersOut = S((a) => a.line === 'cash:depositOut' || a.line.startsWith('cash:exp:'), ['owners']);
  const owners = MONTHS.map((_, i) => ownersIn[i] - ownersOut[i]);
  const elimIn = S(line('cash:oi'), ['intergroup']);
  const elimOut = S((a) => a.line.startsWith('cash:exp:'), ['intergroup']);
  const adjusted = any(owners) || any(elimIn) || any(elimOut);
  const groupNet = MONTHS.map((_, i) => net[i] - owners[i] - elimIn[i] + elimOut[i]);
  const final = adjusted ? groupNet : net;
  return [
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
    { label: 'Cumulative net cash flow', vals: final.map((_, i) => sum(final.slice(0, i + 1))), kind: 'muted', noTotal: true },
  ];
}

export interface GroupPnl {
  /** entity columns inside the group, then the four consolidation columns, then entities outside */
  inside: { key: string; label: string }[];
  outside: { key: string; label: string }[];
  rows: { label: string; code?: string; kind: 'group' | 'item' | 'sub' | 'total'; vals: (number | null)[] }[];
}

/** The budget year by entity, as the budget's PnLxREHLxANPM: standalone, adjustments, the group, then entities outside it. */
export function groupPnl(atoms: Atom[], expenses: Set<string>): GroupPnl {
  const inside = ENTITIES.filter((e) => !e.outside);
  const outside = ENTITIES.filter((e) => e.outside && atoms.some((a) => a.entity === e.key && Math.abs(sum(a.months)) >= 0.5));
  const total = (match: (a: Atom) => boolean, ok: (a: Atom) => boolean) => sum(atoms.filter((a) => match(a) && ok(a)).map((a) => sum(a.months)));
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
  const income = cells((a) => isRent(a) || isOi(a));
  const opex = cells(isOpex);
  const cost = cells(isExp);
  const empty = Array.from({ length: n }, () => null);
  const expRow = (l: ExpenseLine) => ({ label: l.label, kind: 'item' as const, vals: expenses.has(l.key) ? cells((a) => a.line === `exp:${l.key}`) : empty });
  return {
    inside: inside.map(({ key, label }) => ({ key, label })),
    outside: outside.map(({ key, label }) => ({ key, label })),
    rows: [
      { label: 'Income', kind: 'group', vals: empty },
      { label: 'Rental revenue', kind: 'item', vals: cells(isRent) },
      ...oiAccounts.map((acc) => ({ label: acc.name, code: acc.code, kind: 'item' as const, vals: cells((a) => a.line === `oi:${acc.code}`) })),
      { label: 'Total other income', kind: 'sub', vals: cells(isOi) },
      { label: 'Total income', kind: 'sub', vals: income },
      { label: 'Operating expenses', kind: 'group', vals: empty },
      // lines not budgeted yet stay empty
      ...OPEX_LINES.map(expRow),
      ...(atoms.some((a) => a.line === `exp:${PMA_EXPENSE.key}`)
        ? [{ label: PMA_EXPENSE.label, kind: 'item' as const, vals: cells((a) => a.line === `exp:${PMA_EXPENSE.key}`) }]
        : []),
      { label: 'Total operating expenses', kind: 'sub', vals: opex },
      { label: 'Gross profit', kind: 'sub', vals: income.map((v, i) => v - opex[i]) },
      ...BELOW_GP_LINES.map(expRow),
      { label: 'General & administration', kind: 'group', vals: empty },
      ...GA_LINES.map(expRow),
      { label: 'Total general & administration', kind: 'sub', vals: cells((a) => GA_LINES.some((l) => a.line === `exp:${l.key}`)) },
      { label: 'Net income', kind: 'total', vals: income.map((v, i) => v - cost[i]) },
      // paid, not expensed: in the cash flow only
      { label: 'Cash flow only', kind: 'group', vals: empty },
      ...[...CASH_ONLY_LINES, ...GA_CASH_LINES].map(expRow),
    ],
  };
}

/** column headings of the Group P&L after the entity columns */
export const CONSOLIDATION_COLUMNS = ['Standalone', "Owners' share", 'Eliminations', GROUP_NAME];
