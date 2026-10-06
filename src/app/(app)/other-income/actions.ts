'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/dal';
import { saveOtherIncome } from '@/lib/budget/other-income';
import { OI_INPUT, type OiPeriod } from '@/lib/budget/other-income-types';

const Changes = z
  .array(
    z.object({
      scope: z.string().regex(/^(P:\d+|G:\w+)$/),
      account: z.string().regex(/^\d{5}$/),
      period: z.enum(OI_INPUT as [OiPeriod, ...OiPeriod[]]),
      amount: z.number().finite().nullable(),
    }),
  )
  .max(500);

export async function saveOtherIncomeCells(versionId: number, changes: unknown): Promise<{ saved: number; errors: string[] }> {
  const user = await requireUser();
  const parsed = Changes.safeParse(changes);
  if (!parsed.success) return { saved: 0, errors: [parsed.error.issues[0]?.message ?? 'Invalid input'] };
  const res = await saveOtherIncome(user, versionId, parsed.data);
  if (res.saved) revalidatePath('/other-income');
  return res;
}
