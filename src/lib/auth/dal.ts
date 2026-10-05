import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { SESSION_COOKIE, verifySession } from './session';
import { isFinance, type Actor } from './permissions';

export { isFinance, visibleProperties, editablePropertyIds, canEditProperty, type EditCheck } from './permissions';

export const VERSION_COOKIE = 'vid';

export type CurrentUser = Actor;

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      coordinator: schema.users.coordinator,
      active: schema.users.active,
    })
    .from(schema.users)
    .where(eq(schema.users.id, session.uid));
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, coordinator: user.coordinator };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireFinance(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isFinance(user)) throw new Error('Finance access required');
  return user;
}

/** The version the user is working on: cookie choice, else the newest open version, else the newest. */
export const getActiveVersion = cache(async () => {
  const store = await cookies();
  const wanted = Number(store.get(VERSION_COOKIE)?.value);
  const all = await db.select().from(schema.budgetVersions).orderBy(desc(schema.budgetVersions.year), desc(schema.budgetVersions.id));
  const version = all.find((v) => v.id === wanted) ?? all.find((v) => v.status === 'OPEN') ?? all[0] ?? null;
  return { version, all };
});
