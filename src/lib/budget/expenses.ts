// Expense lines of the budget (from the Buildingwise P&L sheet). Maintenance, capex and FM staff come
// from the FM budget, per building; the other lines are not budgeted in the tool yet and show no amounts.
import 'server-only';
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadFmBudget } from './fm';

export interface ExpenseLine {
  key: string;
  label: string;
  /** narrow column heading */
  short: string;
}

export const EXPENSE_LINES: ExpenseLine[] = [
  { key: 'maintenance', label: 'Maintenance', short: 'Maintenance' },
  { key: 'capex', label: 'Capex / replacements', short: 'Capex / repl.' },
  { key: 'fmStaff', label: 'FM staff', short: 'FM staff' },
  { key: 'utilities', label: 'Water & electricity', short: 'Water & elec.' },
  { key: 'watchmen', label: 'Watchmen', short: 'Watchmen' },
  { key: 'insurance', label: 'Insurance', short: 'Insurance' },
  { key: 'cleaning', label: 'Cleaning & security', short: 'Cleaning & sec.' },
  { key: 'overheads', label: 'Miscellaneous overheads', short: 'Misc OH' },
  { key: 'land', label: 'DREC / land', short: 'DREC / land' },
];

/** lines that come from the FM budget */
export const FM_EXPENSE_KEYS = ['maintenance', 'capex', 'fmStaff'] as const;

export interface PropertyExpense {
  propertyId: number;
  code: string;
  buCode: string;
  /** an EXPENSE_LINES key */
  line: string;
  /** expense = cash paid in the same month */
  months: number[];
}

/** Budget-year expenses of the buildings, by line and month. Lines not budgeted yet are absent. */
export async function propertyExpenses(versionId: number, propertyIds: number[]): Promise<PropertyExpense[]> {
  if (!propertyIds.length) return [];
  const fm = await loadFmBudget(versionId);
  if (!fm.budgeted) return [];
  const props = await db.select({ id: schema.properties.id, code: schema.properties.code, buCode: schema.properties.buCode }).from(schema.properties).where(inArray(schema.properties.id, propertyIds));
  const out: PropertyExpense[] = [];
  for (const p of props) {
    const r = fm.result.byProperty.get(p.id);
    if (!r) continue;
    for (const line of FM_EXPENSE_KEYS) out.push({ propertyId: p.id, code: p.code, buCode: p.buCode, line, months: r.monthly[line] });
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

/** Lines budgeted in the tool for this version (the others show as not budgeted). */
export async function budgetedExpenseLines(versionId: number): Promise<Set<string>> {
  return new Set((await loadFmBudget(versionId)).budgeted ? FM_EXPENSE_KEYS : []);
}
