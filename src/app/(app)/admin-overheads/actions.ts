'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireFinance } from '@/lib/auth/dal';
import { deleteAdminItem, saveAdminItem, saveAdminOverheads } from '@/lib/budget/admin';

const value = z.number().finite().nullable();
const Changes = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('payroll'),
        dept: z.string().regex(/^\d{3}$/),
        field: z.enum(['headcount', 'ctc', 'newHeadcount', 'newCtc', 'capPct', 'mjnhPct', 'asrePct', 'seniorCtc']),
        value,
      }),
      z.object({ kind: z.literal('admin'), dept: z.string().regex(/^\d{3}$/), account: z.string().regex(/^\d{5}$/), entity: z.enum(['521', '501', '502']), value }),
      z.object({ kind: z.literal('fee'), fee: z.enum(['PMA', 'AMA']), entity: z.enum(['501', '502', 'MALL']), field: z.enum(['rate', 'base']), value }),
    ]),
  )
  .max(500);

export async function saveAdminCells(versionId: number, changes: unknown): Promise<{ saved: number; errors: string[] }> {
  const user = await requireFinance();
  const parsed = Changes.safeParse(changes);
  if (!parsed.success) return { saved: 0, errors: [parsed.error.issues[0]?.message ?? 'Invalid input'] };
  const res = await saveAdminOverheads(user, versionId, parsed.data);
  if (res.saved) revalidatePath('/admin-overheads');
  return res;
}

const Item = z.object({
  id: z.number().int().positive().nullable(),
  kind: z.string().max(20),
  dept: z.string().regex(/^\d{3}$/),
  payer: z.enum(['521', '501', '502']),
  data: z.record(z.string(), z.union([z.string().max(300), z.number().finite(), z.null(), z.record(z.string(), z.number().finite())])),
});

/** Adds or changes a back-up schedule item (vehicle, telephone, training, event, IT, capex, other). */
export async function saveAdminItemAction(versionId: number, item: unknown): Promise<{ id?: number; error?: string }> {
  const user = await requireFinance();
  const parsed = Item.safeParse(item);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const res = await saveAdminItem(user, versionId, parsed.data);
  if (res.id) revalidatePath('/admin-overheads');
  return res;
}

export async function deleteAdminItemAction(versionId: number, id: number): Promise<{ error?: string }> {
  const user = await requireFinance();
  const res = await deleteAdminItem(user, versionId, id);
  if (!res.error) revalidatePath('/admin-overheads');
  return res;
}