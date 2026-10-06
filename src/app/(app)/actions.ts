'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireUser, VERSION_COOKIE } from '@/lib/auth/dal';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

export async function setActiveVersion(versionId: number) {
  await requireUser();
  (await cookies()).set(VERSION_COOKIE, String(versionId), { path: '/', sameSite: 'lax', httpOnly: true });
  revalidatePath('/', 'layout');
}

export async function setTheme(theme: Theme) {
  await requireUser();
  (await cookies()).set(THEME_COOKIE, theme === 'dark' ? 'dark' : 'light', { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
}
