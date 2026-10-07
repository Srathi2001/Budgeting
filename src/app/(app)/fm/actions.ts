'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/dal';
import { fmTransitionAs, saveFmLinesAs, saveFmStaffAs, type FmResult } from '@/lib/budget/fm-save';

const done = (r: FmResult) => {
  if (!r.error) revalidatePath('/fm');
  return r;
};

export async function saveFmLines(versionId: number, propertyId: number, input: unknown): Promise<FmResult> {
  return done(await saveFmLinesAs(await requireUser(), versionId, propertyId, input));
}

export async function saveFmStaff(versionId: number, input: unknown): Promise<FmResult> {
  return done(await saveFmStaffAs(await requireUser(), versionId, input));
}

export async function fmTransition(versionId: number, propertyId: number, action: 'submit' | 'approve' | 'return', note: string | null): Promise<FmResult> {
  return done(await fmTransitionAs(await requireUser(), versionId, propertyId, action, note));
}
