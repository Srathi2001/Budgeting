// Expense lines of the budget (from the Buildingwise P&L sheet). Maintenance, major repairs, capex items
// and FM staff come from the FM budget, per building; water & electricity, watchmen, insurance, cleaning
// & security, miscellaneous overheads and DREC / land from the building overheads. A line shows no
// amounts until it is budgeted. As in the 2026 budget, major repairs sit below gross profit and capex
// items are in the cash flow only.
import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadFmBudget } from './fm';
import { bohMonthly } from './boh';
import { adminEntityCosts } from './admin';

export interface ExpenseLine {
  key: string;
  label: string;
  /** narrow column heading */
  short: string;
  /**
   * Where the line sits, as the 2026 budget: operating cost (in gross profit), below gross profit
   * (major repairs), or the cash flow only (capex items, not in the P&L)
   */
  section: 'opex' | 'belowGp' | 'ga' | 'cashOnly' | 'gaCash';
}

export const EXPENSE_LINES: ExpenseLine[] = [
  { key: 'maintenance', label: 'Maintenance', short: 'Maintenance', section: 'opex' },
  { key: 'fmStaff', label: 'FM staff', short: 'FM staff', section: 'opex' },
  { key: 'utilities', label: 'Water & electricity', short: 'Water & elec.', section: 'opex' },
  { key: 'watchmen', label: 'Watchmen', short: 'Watchmen', section: 'opex' },
  { key: 'insurance', label: 'Insurance', short: 'Insurance', section: 'opex' },
  { key: 'cleaning', label: 'Cleaning & security', short: 'Cleaning & sec.', section: 'opex' },
  { key: 'overheads', label: 'Miscellaneous overheads', short: 'Misc OH', section: 'opex' },
  { key: 'land', label: 'DREC / land', short: 'DREC / land', section: 'opex' },
  { key: 'repairs', label: 'Major repairs & refurbishment', short: 'Major repairs', section: 'belowGp' },
  // general & administration: entity level (ANPM's payroll and the companies' admin overheads), not by building
  { key: 'payroll', label: 'Payroll & staff costs', short: 'Payroll', section: 'ga' },
  { key: 'payrollCap', label: 'Capitalised to projects (PDD)', short: 'Capitalised', section: 'ga' },
  { key: 'payrollRecharge', label: 'Recharged to MJNH / ASRE', short: 'Recharged', section: 'ga' },
  { key: 'adminOh', label: 'Admin overheads', short: 'Admin OH', section: 'ga' },
  { key: 'ama', label: 'AMA fee to MJNH', short: 'AMA fee', section: 'ga' },
  { key: 'capexItems', label: 'Capex items', short: 'Capex items', section: 'cashOnly' },
  // office & IT capex of the departments: paid, not expensed
  { key: 'gaCapex', label: 'Office & IT capex', short: 'Office capex', section: 'gaCash' },
];
export const OPEX_LINES = EXPENSE_LINES.filter((l) => l.section === 'opex');
export const BELOW_GP_LINES = EXPENSE_LINES.filter((l) => l.section === 'belowGp');
export const GA_LINES = EXPENSE_LINES.filter((l) => l.section === 'ga');
export const GA_CASH_LINES = EXPENSE_LINES.filter((l) => l.section === 'gaCash');
/** the lines of a building (everything but general & administration) */
export const BUILDING_LINES = EXPENSE_LINES.filter((l) => l.section !== 'ga' && l.section !== 'gaCash');
export const CASH_ONLY_LINES = EXPENSE_LINES.filter((l) => l.section === 'cashOnly');
/** expense lines that are in the P&L (everything but capex items) */
export const isPnlLine = (key: string) => !['cashOnly', 'gaCash'].includes(EXPENSE_LINES.find((l) => l.key === key)?.section ?? '');

/** lines that come from the FM budget (FM works: maintenance, R01/R02 repairs, R04 capex items; FM staff) */
export const FM_EXPENSE_KEYS = ['maintenance', 'fmStaff', 'repairs', 'capexItems'] as const;

export interface PropertyExpense {
  propertyId: number;
  code: string;
  buCode: string;
  /** an EXPENSE_LINES key */
  line: string;
  /** expense by month */
  months: number[];
  /** cash paid by month, when it differs from the expense (insurance premiums paid upfront) */
  cash?: number[];
}

/** Budget-year expenses of the buildings, by line and month: the FM budget and the building overheads. Lines not budgeted yet are absent. */
export async function propertyExpenses(versionId: number, propertyIds: number[]): Promise<PropertyExpense[]> {
  if (!propertyIds.length) return [];
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return [];
  const [fm, boh] = await Promise.all([loadFmBudget(versionId), bohMonthly(version, propertyIds)]);
  if (!fm.budgeted && !boh.lines.size) return [];
  const props = await db.select({ id: schema.properties.id, code: schema.properties.code, buCode: schema.properties.buCode }).from(schema.properties).where(inArray(schema.properties.id, propertyIds));
  const out: PropertyExpense[] = [];
  for (const p of props) {
    const r = fm.budgeted ? fm.result.byProperty.get(p.id) : undefined;
    if (r) for (const line of FM_EXPENSE_KEYS) out.push({ propertyId: p.id, code: p.code, buCode: p.buCode, line, months: r.monthly[line] });
    const o = boh.byProperty.get(p.id);
    if (o) for (const [line, v] of Object.entries(o)) out.push({ propertyId: p.id, code: p.code, buCode: p.buCode, line, months: v!.months, cash: v!.cash });
  }
  return out;
}

/** Year totals per building and line (Building P&L). */
export async function propertyExpenseTotals(versionId: number, propertyIds: number[]): Promise<Map<number, Record<string, number>>> {
  const out = new Map<number, Record<string, number>>();
  for (const e of await propertyExpenses(versionId, propertyIds)) {
    const r = out.get(e.propertyId) ?? {};
    r[e.line] = (r[e.line] ?? 0) + e.months.reduce((s, v) => s + v, 0);
    out.set(e.propertyId, r);
  }
  return out;
}

/**
 * Lines budgeted in the tool for this version (the others show as not budgeted): the FM lines once the
 * FM budget has an entry, a building overhead line once any amount is entered for it.
 */
export async function budgetedExpenseLines(versionId: number): Promise<Set<string>> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  const out = new Set<string>((await loadFmBudget(versionId)).budgeted ? FM_EXPENSE_KEYS : []);
  if (version) for (const l of (await bohMonthly(version)).lines) out.add(l);
  if (version) for (const l of (await adminEntityCosts(version)).lines) out.add(l);
  return out;
}