// Admin overheads summary: the Admin overheads data and the 2026 budget's split of ANPM's G&A for
// reference (PayrollxCost rows 11-25: ANPM's net G&A shared over REHL, REHL-MJN without the mall and the
// PMC by their budget revenue).
import 'server-only';
import type { schema } from '@/db';
import { loadAdminOverheads } from './admin';
import type { AdminData, SplitEntity } from './admin-types';

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
  /** last budget's split, when it was made outside the tool */
  past: (typeof PAST_SPLIT)[number] | null;
  pastLabel: string;
}

export async function loadAdminSummary(version: schema.BudgetVersion): Promise<AdminSummary> {
  return { data: await loadAdminOverheads(version), past: PAST_SPLIT[version.year - 1] ?? null, pastLabel: `${version.year - 1}B` };
}
