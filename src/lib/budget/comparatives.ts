import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * Property-level comparatives a version reports against: current-year forecast and two years of
 * actuals; plus the prior-year budget when no prior budget version exists in the tool.
 */
export async function comparativeLabels(version: schema.BudgetVersion): Promise<string[]> {
  const y = version.year;
  const prior = await db.select({ id: schema.budgetVersions.id }).from(schema.budgetVersions).where(eq(schema.budgetVersions.year, y - 1));
  return [`${y - 1}F`, ...(prior.length ? [] : [`${y - 1}B`]), `${y - 2}A`, `${y - 3}A`];
}
