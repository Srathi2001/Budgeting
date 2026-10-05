'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireUser, VERSION_COOKIE } from '@/lib/auth/dal';

export async function setActiveVersion(versionId: number) {
  await requireUser();
  (await cookies()).set(VERSION_COOKIE, String(versionId), { path: '/', sameSite: 'lax', httpOnly: true });
  revalidatePath('/', 'layout');
}
