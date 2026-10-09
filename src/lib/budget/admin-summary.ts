// Admin overheads summary: the Admin overheads data plus what the split of ANPM's G&A needs, as the
// 2026 budget did it (PayrollxCost rows 11-25): ANPM's net G&A shared over REHL, REHL-MJN (without the
// mall) and the PMC by their budget revenue.
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadAdminOverheads } from './admin';
import type { AdminData, SplitEntity } from './admin-types';
import { isMall } from './group';

/**
 * The 2026 budget's split (PayrollxCost K25:M25): ANPM's net G&A 14,439,059 by revenue; the PMC's share
 * also carries its FM staff (252,654), as the 2026 file booked it there.
 */
export const PAST_SPLIT: Record<number, { net: number; revenue: Record<SplitEntity, number>; allocated: Record<SplitEntity, number> }> = {
  2026: {
    net: 14439059.48,
    revenue: { '501': 67441486.09, '502': 132928026.75, '522': 4571947.24 },
    allocated: { '501': 4751559.93, '502': 9365385.04, '522': 574768.74 },
  },
};

export interface AdminSummary {
  data: AdminData;
  /** budget revenue (rent) of the version by entity: the split base */
  revenue: Record<SplitEntity, number>;
  /** last budget's split, when it was made outside the tool */
  past: (typeof PAST_SPLIT)[number] | null;
  pastLabel: string;
}

export async function loadAdminSummary(version: schema.BudgetVersion): Promise<AdminSummary> {
  const [data, rows] = await Promise.all([
    loadAdminOverheads(version),
    db
      .select({ code: schema.properties.code, bu: schema.properties.buCode, revenue: sql<number>`sum(${schema.lineMonthly.revenue})::float` })
      .from(schema.lineMonthly)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.lineMonthly.propertyId))
      .where(and(eq(schema.lineMonthly.versionId, version.id), inArray(schema.properties.buCode, ['501', '502', '522'])))
      .groupBy(schema.properties.code, schema.properties.buCode),
  ]);
  const revenue: Record<SplitEntity, number> = { '501': 0, '502': 0, '522': 0 };
  for (const r of rows) if (!isMall(r.code)) revenue[r.bu as SplitEntity] += r.revenue;
  return { data, revenue, past: PAST_SPLIT[version.year - 1] ?? null, pastLabel: `${version.year - 1}B` };
}
