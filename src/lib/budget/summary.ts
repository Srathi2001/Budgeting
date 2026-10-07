// Monthly Summary statements (Income & expenses, Cash flow, Group P&L), built once for the page and
// its Excel export so both always show the same figures.
import 'server-only';
import { isFinance, type CurrentUser } from '@/lib/auth/dal';
import type { Filters } from '@/lib/filters';
import type { Category } from './category';
import { otherIncomeMonthly, type PropertyRollup } from './reports';
import { OI_ACCOUNTS } from './other-income-types';
import { EXPENSE_LINES, expenseMonthly } from './expenses';
import { ENTITIES, GROUP_NAME, type GroupClass } from './group';
import { PMA_EXPENSE, groupAtoms, sumAtoms, type Atom } from './group-report';
import { MONTHS, sum } from '@/lib/format';

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
const isExp = (a: Atom) => a.line.startsWith('exp:');

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
  return { atoms: groupAtoms(rolls, oi), expenses: await expenseMonthly() };
}

/** the parts both monthly statements share (the group's: entities outside it are left out) */
function parts(all: Atom[], expenses: Map<string, number[] | null>) {
  const atoms = all.filter((a) => a.cls !== 'outside');
  const S = (match: (a: Atom) => boolean, cls?: GroupClass[]) => sumAtoms(atoms, (a) => match(a) && (!cls || cls.includes(a.cls)));
  const line = (l: string) => (a: Atom) => a.line === l;
  const oiLines: StatementLine[] = OI_ACCOUNTS.map((a) => ({ label: a.name, code: a.code, vals: S(line(`oi:${a.code}`)), kind: 'item' as const })).filter((l) => any(l.vals!));
  const pma = S(line(`exp:${PMA_EXPENSE.key}`));
  const expLines: StatementLine[] = [
    ...EXPENSE_LINES.map((l) => ({ label: l.label, vals: expenses.get(l.key) ?? null, kind: 'item' as const })),
    ...(any(pma) ? [{ label: PMA_EXPENSE.label, vals: pma, kind: 'item' as const }] : []),
  ];
  return { S, line, oiLines, oiTotal: addUp(oiLines.map((l) => l.vals)) ?? z12(), expLines, expTotal: addUp(expLines.map((l) => l.vals)) };
}

export function incomeStatement(all: Atom[], expenses: Map<string, number[] | null>): StatementLine[] {
  const { S, line, oiLines, oiTotal, expLines, expTotal } = parts(all, expenses);
  const rent = S(line('rent'));
  const income = MONTHS.map((_, i) => rent[i] + oiTotal[i]);
  const net = MONTHS.map((_, i) => income[i] - (expTotal?.[i] ?? 0));
  const owners = S((a) => a.line === 'rent' || isOi(a), ['owners']);
  const elimIncome = S(isOi, ['intergroup']);
  const elimCost = S(isExp, ['intergroup']);
  const adjusted = any(owners) || any(elimIncome) || any(elimCost);
  return [
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
          { label: 'Group adjustments', vals: null, kind: 'group' as const },
          ...(any(owners) ? [{ label: "Owners' share · PMC properties", vals: neg(owners), kind: 'item' as const }] : []),
          ...(any(elimIncome) ? [{ label: 'Intergroup income eliminated · PMA fee', vals: neg(elimIncome), kind: 'item' as const }] : []),
          ...(any(elimCost) ? [{ label: 'Intergroup cost eliminated · PMA fee', vals: elimCost, kind: 'item' as const }] : []),
          { label: `Net income · ${GROUP_NAME}`, vals: MONTHS.map((_, i) => net[i] - owners[i] - elimIncome[i] + elimCost[i]), kind: 'total' as const },
        ]
      : [{ label: 'Net income', vals: net, kind: 'total' as const }]),
  ];
}

export function cashStatement(all: Atom[], expenses: Map<string, number[] | null>): StatementLine[] {
  const { S, line, expLines } = parts(all, expenses);
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
  const ownersOut = S(line('cash:depositOut'), ['owners']);
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
export function groupPnl(atoms: Atom[], expenses: Map<string, number[] | null>): GroupPnl {
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
  const placeholders = EXPENSE_LINES.map((l) => ({ l, v: expenses.get(l.key) ?? null }));
  const placeholderTotal = sum(placeholders.map((p) => (p.v ? sum(p.v) : 0)));
  const income = cells((a) => isRent(a) || isOi(a));
  const cost = cells(isExp, placeholderTotal);
  // a not-yet-split expense: only a standalone / group figure once budgeted
  const placeholderCells = (v: number[] | null): (number | null)[] =>
    v ? [...inside.map(() => null), sum(v), 0, 0, sum(v), ...outside.map(() => null)] : Array.from({ length: n }, () => null);
  const empty = Array.from({ length: n }, () => null);
  return {
    inside: inside.map(({ key, label }) => ({ key, label })),
    outside: outside.map(({ key, label }) => ({ key, label })),
    rows: [
      { label: 'Income', kind: 'group', vals: empty },
      { label: 'Rental revenue', kind: 'item', vals: cells(isRent) },
      ...oiAccounts.map((acc) => ({ label: acc.name, code: acc.code, kind: 'item' as const, vals: cells((a) => a.line === `oi:${acc.code}`) })),
      { label: 'Total other income', kind: 'sub', vals: cells(isOi) },
      { label: 'Total income', kind: 'sub', vals: income },
      { label: 'Expenses', kind: 'group', vals: empty },
      ...placeholders.map(({ l, v }) => ({ label: l.label, kind: 'item' as const, vals: placeholderCells(v) })),
      ...(atoms.some((a) => a.line === `exp:${PMA_EXPENSE.key}`)
        ? [{ label: PMA_EXPENSE.label, kind: 'item' as const, vals: cells((a) => a.line === `exp:${PMA_EXPENSE.key}`) }]
        : []),
      { label: 'Total expenses', kind: 'sub', vals: cost },
      { label: 'Net income', kind: 'total', vals: income.map((v, i) => v - cost[i]) },
    ],
  };
}

/** column headings of the Group P&L after the entity columns */
export const CONSOLIDATION_COLUMNS = ['Standalone', "Owners' share", 'Eliminations', GROUP_NAME];
