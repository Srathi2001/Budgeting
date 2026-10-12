// A past approved budget kept as read-only reference for the cost tabs (budget_reference: 2026B from the
// 2026 budget workbook, loaded by scripts/load-reference-budget.ts). Never typed, never in the statements.
import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export type ReferenceModule = 'boh' | 'oi' | 'admin' | 'payroll' | 'fees' | 'gasplit';

/** The reference rows of a year and module; with `propertyIds`, only those properties' rows. */
export async function referenceBudget(year: number, module: ReferenceModule, propertyIds?: number[]) {
  const t = schema.budgetReference;
  const rows = await db
    .select({ propertyId: t.propertyId, scope: t.scope, account: t.account, amount: t.amount, note: t.note, source: t.source })
    .from(t)
    .where(and(eq(t.year, year), eq(t.module, module)));
  if (!propertyIds) return rows;
  const ids = new Set(propertyIds);
  return rows.filter((r) => r.propertyId !== null && ids.has(r.propertyId));
}
