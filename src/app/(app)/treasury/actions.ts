'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/dal';
import { deleteTreasury, saveTreasury } from '@/lib/budget/treasury';

type Kind = 'loan' | 'deposit' | 'contingency';

/** Saves a shareholder loan, fixed deposit or contingency (Finance; the checks are in saveTreasury). */
export async function saveTreasuryRecord(versionId: number, kind: Kind, input: unknown): Promise<{ id?: number; error?: string }> {
  const user = await requireUser();
  try {
    const r = await saveTreasury(user, versionId, kind, input);
    if (!r.error) revalidatePath('/treasury');
    return r;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteTreasuryRecord(versionId: number, kind: Kind, id: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const r = await deleteTreasury(user, versionId, kind, id);
  if (!r.error) revalidatePath('/treasury');
  return r;
}
