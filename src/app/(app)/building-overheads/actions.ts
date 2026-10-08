'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser, requireFinance } from '@/lib/auth/dal';
import { saveBuildingOverheads } from '@/lib/budget/boh';
import { saveBohAssumptionsAs, saveContractsAs, saveInsuranceAs, saveWatchmenAs, type Result } from '@/lib/budget/boh-schedules';
import { isContractKind } from '@/lib/budget/boh-types';

const Changes = z
  .array(
    z.object({
      propertyId: z.number().int().positive(),
      account: z.string().regex(/^\d{5}$/),
      amount: z.number().finite().nullable(),
      dueMonth: z.number().int().min(1).max(12).nullable(),
    }),
  )
  .max(500);

const done = <T extends { error?: string; errors?: string[] }>(r: T) => {
  if (!r.error) revalidatePath('/building-overheads');
  return r;
};

export async function saveBuildingOverheadCells(versionId: number, changes: unknown): Promise<{ saved: number; errors: string[] }> {
  const user = await requireUser();
  const parsed = Changes.safeParse(changes);
  if (!parsed.success) return { saved: 0, errors: [parsed.error.issues[0]?.message ?? 'Invalid input'] };
  const res = await saveBuildingOverheads(user, versionId, parsed.data);
  if (res.saved) revalidatePath('/building-overheads');
  return res;
}

export async function saveBohAssumptions(versionId: number, input: unknown): Promise<Result> {
  return done(await saveBohAssumptionsAs(await requireUser(), versionId, input));
}

export async function saveInsurance(versionId: number, input: unknown): Promise<Result> {
  return done(await saveInsuranceAs(await requireUser(), versionId, input));
}

export async function saveWatchmen(versionId: number, input: unknown): Promise<Result> {
  return done(await saveWatchmenAs(await requireUser(), versionId, input));
}

export async function saveContracts(versionId: number, kind: string, input: unknown): Promise<{ saved: number; errors: string[] }> {
  if (!isContractKind(kind)) return { saved: 0, errors: ['Unknown schedule'] };
  return done(await saveContractsAs(await requireUser(), versionId, kind, input));
}

/** Loads the contracts of the year's purchase orders from Oracle into the schedules (Finance). */
export async function syncPurchaseOrders(versionId: number): Promise<Result> {
  const user = await requireFinance();
  try {
    const { db, schema } = await import('@/db');
    const { eq } = await import('drizzle-orm');
    const [v] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
    if (!v || v.status === 'LOCKED') return { error: 'This budget version is locked' };
    const { applyPurchaseOrders, readPurchaseOrders } = await import('@/lib/import/fusion-po');
    const read = await readPurchaseOrders(`${v.year - 1}-01-01`);
    const r = await applyPurchaseOrders(versionId, read, user.id);
    revalidatePath('/building-overheads');
    return {
      ok: `${r.pos} purchase orders read: ${r.added} new contract lines, ${r.refreshed} refreshed${r.skippedOneOff ? `, ${r.skippedOneOff} one-off lines left out` : ''}${r.unmatched.length ? `; buildings not in the budget: ${r.unmatched.join(', ')}` : ''}`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
