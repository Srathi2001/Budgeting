// Expense lines of the budget (from the Buildingwise P&L sheet). Not budgeted in the tool yet: reports
// show the lines with no amounts until the cost budget is added; `expenseMonthly` is where it plugs in.

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

/** Budget-year expenses by line and month (expense = cash paid in the same month); null: not budgeted yet. */
export async function expenseMonthly(): Promise<Map<string, number[] | null>> {
  return new Map(EXPENSE_LINES.map((l) => [l.key, null]));
}
