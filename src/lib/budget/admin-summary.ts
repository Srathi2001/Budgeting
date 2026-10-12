// Admin overheads summary: the Admin overheads data and last year's budget split of ANPM's G&A for
// reference (2026: PayrollxCost "Budget Revenue" and "Total Admin Payroll Cost" rows: ANPM's net G&A
// shared over REHL, REHL-MJN without the mall and the PMC by their budget revenue). The figures are
// reference data (budget_reference, scripts/load-reference-budget.ts), not written into the code.
import 'server-only';
import type { schema } from '@/db';
import { loadAdminOverheads } from './admin';
import { referenceBudget } from './reference';
import type { AdminData, SplitEntity } from './admin-types';

export interface PastSplit {
  net: number;
  revenue: Record<SplitEntity, number>;
  allocated: Record<SplitEntity, number>;
}

export interface AdminSummary {
  data: AdminData;
  /** last budget's split, when it was made outside the tool */
  past: PastSplit | null;
  pastLabel: string;
}

export async function loadAdminSummary(version: schema.BudgetVersion): Promise<AdminSummary> {
  const Y = version.year - 1;
  const rows = await referenceBudget(Y, 'gasplit');
  const of = (scope: string): Record<SplitEntity, number> => ({
    '501': rows.find((r) => r.scope === scope && r.account === '501')?.amount ?? 0,
    '502': rows.find((r) => r.scope === scope && r.account === '502')?.amount ?? 0,
    '522': rows.find((r) => r.scope === scope && r.account === '522')?.amount ?? 0,
  });
  const net = rows.find((r) => r.scope === 'net')?.amount;
  return { data: await loadAdminOverheads(version), past: net === undefined ? null : { net, revenue: of('revenue'), allocated: of('allocated') }, pastLabel: `${Y}B` };
}
