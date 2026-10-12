// "Last year's budget", one rule for every screen (audit FIN-013, user decision 11-Oct-2026): the approved
// version of the year before, that is the locked one (only one version of a year can be locked at a
// time); the imported baseline counts as approved. No approved version: no prior budget.
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { perRequest } from '@/lib/request-memo';

/** (once per request: request-memo.ts) */
export const priorVersion = perRequest('priorVersion', (version: Pick<schema.BudgetVersion, 'year'>) => String(version.year), priorVersionNow);

async function priorVersionNow(version: Pick<schema.BudgetVersion, 'year'>): Promise<schema.BudgetVersion | null> {
  const rows = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.year, version.year - 1));
  return approvedOf(rows);
}

/** the approved version among a year's versions */
export function approvedOf<T extends Pick<schema.BudgetVersion, 'status' | 'isBaseline' | 'id'>>(rows: T[]): T | null {
  const locked = rows.filter((v) => v.status === 'LOCKED').sort((a, b) => b.id - a.id);
  return locked[0] ?? null;
}
