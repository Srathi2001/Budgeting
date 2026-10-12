// Monthly Summary statements (Income & expenses, Cash flow, Group P&L), built once for the page and
// its Excel export so both always show the same figures.
import 'server-only';
import { isFinance, type CurrentUser } from '@/lib/auth/dal';
import type { Filters } from '@/lib/filters';
import type { Category } from './category';
import { otherIncomeMonthly, type PropertyRollup } from './reports';
import { OI_ACCOUNTS } from './other-income-types';
import { BELOW_EBITDA_LINES, BELOW_GP_LINES, CASH_ONLY_LINES, GA_CASH_LINES, GA_LINES, NON_CASH_LINES, OPEX_LINES, TAX_LINES, budgetedExpenseLines, isPnlLine, propertyExpenses, type ExpenseLine, type PropertyExpense } from './expenses';
import { ENTITIES, GROUP_NAME, LANDLORDS, type EntityKey, type GroupClass } from './group';
import { PMA_EXPENSE, RECHARGED_LINES, RECHARGES, groupAtoms, sumAtoms, type Atom, type Intergroup } from './group-report';
import { MONTHS, sum } from '@/lib/format';
import { eq } from 'drizzle-orm';
import { getSettings } from '@/lib/settings';
import { asreAtoms } from './asre';
import { FD_INTEREST_ACCOUNT, treasuryForStatements } from './treasury';
import { db, schema } from '@/db';
import { adminEntityCosts, landlordRent, managementFees } from './admin';

/** income lines of the statements: the other income accounts, then ANPM's recharges */
const INCOME_LINES: { code: string; name: string; showCode: boolean }[] = [
  ...OI_ACCOUNTS.map((a) => ({ code: a.code, name: a.name, showCode: true })),
  ...RECHARGES.map((r) => ({ code: r.code, name: r.name, showCode: false })),
];

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
/** what the intergroup eliminations are */
const ELIM = 'PMA fee, recharges and the mall lease';
const addUp = (rows: (number[] | null)[]) => (rows.some(Boolean) ? MONTHS.map((_, i) => sum(rows.map((r) => r?.[i] ?? 0))) : null);
const neg = (v: number[] | null) => v && v.map((x) => -x);
const any = (v: number[]) => v.some((x) => Math.abs(x) >= 0.5);
const isOi = (a: Atom) => a.line.startsWith('oi:');
/** a P&L expense (capex items are in the cash flow only) */
const isExp = (a: Atom) => a.line.startsWith('exp:') && isPnlLine(a.line.slice(4));
const isOpex = (a: Atom) => isExp(a) && ![...BELOW_GP_LINES, ...GA_LINES, ...BELOW_EBITDA_LINES, ...TAX_LINES].some((l) => a.line === `exp:${l.key}`);

/**
 * Rent, other income (General rows: Finance only, and only the BU filter applies), expenses of the
 * selection, and the intergroup flows: the PMA fee as the landlords' cost on their rent in view (Finance),
 * and, when ANPM is in view, its PMA fee income and the FM staff and watchmen it recharges.
 */
export async function summaryData(
  versionId: number,
  user: CurrentUser,
  scope: { filters: Filters; propertyIds: number[]; categories: Category[] },
  rolls: PropertyRollup[],
) {
  await getSettings(); // the mappings (e.g. the Mall's codes) before any property is classified
  const f = scope.filters;
  const finance = isFinance(user);
  const general = finance && !f.pm.length && !f.cat.length && !f.prop.length;
  // a company-level entity (BU or MALL) is in view: Finance, no PM / category / property filter, the BU filter
  const entityInView = (e: string) => general && (!f.bu.length || f.bu.includes(e));
  // independent reads: sent at the same time
  const [oi, costs, [version]] = await Promise.all([
    otherIncomeMonthly(versionId, scope.propertyIds, scope.categories, entityInView),
    propertyExpenses(versionId, scope.propertyIds),
    db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId)),
  ]);
  // general & administration: company level, like the General rows
  const ga = general && version ? (await adminEntityCosts(version)).costs.filter((c) => entityInView(c.entity)) : [];
  // Finance's tabs: loan interest and contingencies (below EBITDA), deposit interest (other income 52201)
  if (general && version) {
    const tr = await treasuryForStatements(version);
    ga.push(...tr.costs.filter((c) => entityInView(c.entity)));
    for (const fd of tr.fdInterest)
      if (entityInView(fd.entity)) oi.push({ scope: `G:${fd.entity}`, buCode: fd.entity, propertyId: null, propertyCode: null, account: FD_INTEREST_ACCOUNT, months: fd.months, cash: fd.cash });
  }

  const anpm = entityInView('521');
  let ig: Intergroup = { anpm: false, pma: [], recharged: [] };
  if (finance && version) {
    const [fees, rent] = await Promise.all([managementFees(version), landlordRent(versionId)]);
    const pma = LANDLORDS.map((e) => ({ entity: e as EntityKey, months: fees.months.PMA[e], rent: sum(rent[e]) }));
    let recharged: PropertyExpense[] = [];
    if (anpm) {
      const all = (await db.select({ id: schema.properties.id }).from(schema.properties).where(eq(schema.properties.active, true))).map((p) => p.id);
      recharged = (await propertyExpenses(versionId, all)).filter((c) => RECHARGED_LINES.includes(c.line));
    }
    ig = { anpm, pma, recharged };
  }
  const atoms = groupAtoms(rolls, oi, costs, ga, ig);
  // ASRE, the mall operator (its own budget, Admin → ASRE): its mall lease eliminates against the Mall's rent in view
  if (entityInView('ASRE')) atoms.push(...(await asreAtoms(versionId, atoms, true)));
  return { atoms, expenses: await budgetedExpenseLines(versionId) };
}

/** the parts both monthly statements share (the group's: entities outside it are left out) */
function parts(all: Atom[], expenses: Set<string>) {
  const atoms = all.filter((a) => a.cls !== 'outside');
  const S = (match: (a: Atom) => boolean, cls?: GroupClass[]) => sumAtoms(atoms, (a) => match(a) && (!cls || cls.includes(a.cls)));
  const line = (l: string) => (a: Atom) => a.line === l;
  const oiLines: StatementLine[] = INCOME_LINES.map((a) => ({ label: a.name, code: a.showCode ? a.code : undefined, vals: S(line(`oi:${a.code}`)), kind: 'item' as const })).filter((l) => any(l.vals!));
  const pma = S(line(`exp:${PMA_EXPENSE.key}`));
  const of = (ls: ExpenseLine[], prefix = 'exp'): StatementLine[] =>
    ls.map((l) => ({ label: l.label, vals: expenses.has(l.key) ? S(line(`${prefix}:${l.key}`)) : null, kind: 'item' as const }));
  // operating costs (in gross profit), major repairs (below it), capex items (cash flow only)
  const opexLines: StatementLine[] = [...of(OPEX_LINES), ...(any(pma) ? [{ label: PMA_EXPENSE.label, vals: pma, kind: 'item' as const }] : [])];
  const belowGpLines = of(BELOW_GP_LINES);
  // general & administration, below major repairs (company level)
  const gaLines = of(GA_LINES);
  // below EBITDA (depreciation, loan interest, IFRS 16 lines, contingencies) and corporate tax, as the 2026 budget
  const belowEbitdaLines = of(BELOW_EBITDA_LINES);
  const taxLines = of(TAX_LINES);
  const cashOnlyLines = of([...CASH_ONLY_LINES, ...GA_CASH_LINES]);
  // what is paid, by month: every cost line from its cash months (premiums paid upfront differ from the expense)
  const pmaPaid = S(line(`cash:exp:${PMA_EXPENSE.key}`));
  const paidLines: StatementLine[] = [
    ...of([...OPEX_LINES, ...BELOW_GP_LINES, ...GA_LINES, ...BELOW_EBITDA_LINES, ...TAX_LINES, ...CASH_ONLY_LINES, ...GA_CASH_LINES], 'cash:exp').filter((l) => l.vals && any(l.vals)),
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
    belowEbitdaLines,
    belowEbitdaTotal: addUp(belowEbitdaLines.map((l) => l.vals)),
    taxLines,
    taxTotal: addUp(taxLines.map((l) => l.vals)),
    cashOnlyLines,
    cashOnlyTotal: addUp(cashOnlyLines.map((l) => l.vals)),
    paidLines,
  };
}

export function incomeStatement(all: Atom[], expenses: Set<string>): StatementLine[] {
  const { S, line, oiLines, oiTotal, opexLines, opexTotal, belowGpLines, belowGpTotal, gaLines, gaTotal, belowEbitdaLines, belowEbitdaTotal, taxLines, taxTotal, cashOnlyLines, cashOnlyTotal } = parts(all, expenses);
  const rent = S(line('rent'));
  const income = MONTHS.map((_, i) => rent[i] + oiTotal[i]);
  const gross = MONTHS.map((_, i) => income[i] - (opexTotal?.[i] ?? 0));
  // the 2026 budget's layout (ConsolidatedxRealEstate): EBITDA, then what is below it, PBT, tax, PAT
  const ebitda = MONTHS.map((_, i) => gross[i] - (belowGpTotal?.[i] ?? 0) - (gaTotal?.[i] ?? 0));
  const pbt = MONTHS.map((_, i) => ebitda[i] - (belowEbitdaTotal?.[i] ?? 0));
  const pat = MONTHS.map((_, i) => pbt[i] - (taxTotal?.[i] ?? 0));
  // PMC buildings: their income less their costs is the owners'
  const ownersIncome = S((a) => a.line === 'rent' || isOi(a), ['owners']);
  const ownersCost = S(isExp, ['owners']);
  const owners = MONTHS.map((_, i) => ownersIncome[i] - ownersCost[i]);
  // intergroup income: ANPM's fees and recharges, and the Mall's rent from ASRE (when ASRE is in view)
  const elimIncome = S((a) => isOi(a) || a.line === 'rent', ['intergroup']);
  const elimCost = S(isExp, ['intergroup']);
  const adjusted = any(owners) || any(elimIncome) || any(elimCost);
  const groupPat = MONTHS.map((_, i) => pat[i] - owners[i] - elimIncome[i] + elimCost[i]);
  const finalPat = adjusted ? groupPat : pat;
  // cash profit: PAT with the non-cash lines added back; capex; what is left for distribution (2026 rows 31-38)
  const nonCash = S((a) => NON_CASH_LINES.some((k) => a.line === `exp:${k}`), ['group', 'intergroup']);
  const cashProfit = MONTHS.map((_, i) => finalPat[i] + nonCash[i]);
  const capex = cashOnlyTotal ?? z12();
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
    { label: 'Operating profit (EBITDA)', vals: ebitda, kind: 'sub' },
    ...belowEbitdaLines.map((l) => (l.label.includes('RTU') && !l.vals ? { ...l, label: `${l.label} (IFRS 16: on hold)` } : l)),
    { label: 'Profit before tax (PBT)', vals: pbt, kind: 'sub' },
    ...taxLines.map((l) => (!l.vals ? { ...l, label: `${l.label} (rules to be agreed)` } : l)),
    ...(adjusted
      ? [
          { label: 'Profit after tax (PAT) · standalone', vals: pat, kind: 'sub' as const },
          { label: 'Group adjustments', vals: null, kind: 'group' as const },
          ...(any(owners) ? [{ label: "Owners' share · PMC properties", vals: neg(owners), kind: 'item' as const }] : []),
          ...(any(elimIncome) ? [{ label: `Intergroup income eliminated · ${ELIM}`, vals: neg(elimIncome), kind: 'item' as const }] : []),
          ...(any(elimCost) ? [{ label: `Intergroup cost eliminated · ${ELIM}`, vals: elimCost, kind: 'item' as const }] : []),
          { label: `Profit after tax (PAT) · ${GROUP_NAME}`, vals: groupPat, kind: 'total' as const },
        ]
      : [{ label: 'Profit after tax (PAT)', vals: pat, kind: 'total' as const }]),
    { label: 'Cash profit', vals: cashProfit, kind: 'sub' },
    { label: 'Capex (paid, not expensed)', vals: null, kind: 'group' },
    ...cashOnlyLines.map((l) => ({ ...l, kind: 'muted' as const })),
    { label: 'Total capex', vals: capex, kind: 'sub' },
    { label: 'Cash for distribution', vals: MONTHS.map((_, i) => cashProfit[i] - capex[i]), kind: 'total' },
  ];
}
export function cashStatement(all: Atom[], expenses: Set<string>): StatementLine[] {
  const p = parts(all, expenses);
  const { S, line } = p;
  // every cost is paid: operating costs, major repairs and capex items, in the month paid
  const expLines = p.paidLines;
  // VAT is left out: what is collected passes through to the FTA (as the 2026 budget)
  const cashIn: StatementLine[] = [
    { label: 'Rent cheques (ex VAT)', vals: S(line('cash:rent')), kind: 'item' },
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
  const inLines = ['cash:rent', 'cash:oi', 'cash:depositIn'];
  const ownersIn = S((a) => inLines.includes(a.line), ['owners']);
  const ownersOut = S((a) => a.line === 'cash:depositOut' || a.line.startsWith('cash:exp:'), ['owners']);
  const owners = MONTHS.map((_, i) => ownersIn[i] - ownersOut[i]);
  const elimIn = S((a) => a.line === 'cash:oi' || a.line === 'cash:rent', ['intergroup']);
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
          ...(any(elimIn) ? [{ label: `Intergroup receipts eliminated · ${ELIM}`, vals: neg(elimIn), kind: 'item' as const }] : []),
          ...(any(elimOut) ? [{ label: `Intergroup payments eliminated · ${ELIM}`, vals: elimOut, kind: 'item' as const }] : []),
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
  const oiAccounts = INCOME_LINES.filter((acc) => atoms.some((a) => a.line === `oi:${acc.code}` && Math.abs(sum(a.months)) >= 0.5));
  const income = cells((a) => isRent(a) || isOi(a));
  const opex = cells(isOpex);
  const cost = cells(isExp);
  const belowEbitda = cells((a) => BELOW_EBITDA_LINES.some((l) => a.line === `exp:${l.key}`));
  const tax = cells((a) => TAX_LINES.some((l) => a.line === `exp:${l.key}`));
  const empty = Array.from({ length: n }, () => null);
  const expRow = (l: ExpenseLine) => ({ label: l.label, kind: 'item' as const, vals: expenses.has(l.key) ? cells((a) => a.line === `exp:${l.key}`) : empty });
  return {
    inside: inside.map(({ key, label }) => ({ key, label })),
    outside: outside.map(({ key, label }) => ({ key, label })),
    rows: [
      { label: 'Income', kind: 'group', vals: empty },
      { label: 'Rental revenue', kind: 'item', vals: cells(isRent) },
      ...oiAccounts.map((acc) => ({ label: acc.name, code: acc.showCode ? acc.code : undefined, kind: 'item' as const, vals: cells((a) => a.line === `oi:${acc.code}`) })),
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
      { label: 'Operating profit (EBITDA)', kind: 'sub', vals: income.map((v, i) => v - cost[i] + belowEbitda[i] + tax[i]) },
      ...BELOW_EBITDA_LINES.map(expRow),
      { label: 'Profit before tax (PBT)', kind: 'sub', vals: income.map((v, i) => v - cost[i] + tax[i]) },
      ...TAX_LINES.map(expRow),
      { label: 'Profit after tax (PAT)', kind: 'total', vals: income.map((v, i) => v - cost[i]) },
      // paid, not expensed: in the cash flow only
      { label: 'Cash flow only', kind: 'group', vals: empty },
      ...[...CASH_ONLY_LINES, ...GA_CASH_LINES].map(expRow),
    ],
  };
}

/** column headings of the Group P&L after the entity columns */
export const CONSOLIDATION_COLUMNS = ['Standalone', "Owners' share", 'Eliminations', GROUP_NAME];
