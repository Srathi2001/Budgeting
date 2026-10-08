'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/dal';
import { saveBuildingOverheads } from '@/lib/budget/boh';

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

export async function saveBuildingOverheadCells(versionId: number, changes: unknown): Promise<{ saved: number; errors: string[] }> {
  const user = await requireUser();
  const parsed = Changes.safeParse(changes);
  if (!parsed.success) return { saved: 0, errors: [parsed.error.issues[0]?.message ?? 'Invalid input'] };
  const res = await saveBuildingOverheads(user, versionId, parsed.data);
  if (res.saved) revalidatePath('/building-overheads');
  return res;
}
