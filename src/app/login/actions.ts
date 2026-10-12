'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, schema } from '@/db';
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifySession } from '@/lib/auth/session';
import { loginThrottle, minutes } from '@/lib/auth/throttle';
import { clientAddress, signInHeldFor } from '@/lib/auth/sign-in-limits';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type LoginState = { error?: string } | undefined;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'Enter your email and password' };
  const { email, password, next } = parsed.data;
  // password guessing is slowed per account and per address; the message never says which. The limits
  // are read from the change history (they hold across restarts and app instances), and this process's
  // own counters as well
  const h = await headers();
  const address = clientAddress(h.get('x-forwarded-for'), h.get('x-real-ip'));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const held = Math.max(loginThrottle.account.heldFor(email), loginThrottle.address.heldFor(address), await signInHeldFor(email, address, user?.id ?? null).catch(() => 0));
  if (held) return { error: `Too many attempts. Try again in ${minutes(held)} minute${minutes(held) === 1 ? '' : 's'}` };
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    loginThrottle.account.fail(email);
    loginThrottle.address.fail(address);
    await db.insert(schema.auditLog).values({ userId: user?.id ?? null, entity: 'session', action: 'sign_in_failed', changes: { email, address } }).catch(() => undefined);
    return { error: 'Email or password is incorrect' };
  }
  loginThrottle.account.succeed(email);
  await db.insert(schema.auditLog).values({ userId: user.id, entity: 'session', action: 'sign_in', changes: { address } }).catch(() => undefined);
  const token = await signSession({ uid: user.id, role: user.role, coordinator: user.coordinator, name: user.name, sv: user.sessionVersion });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

/** Signs out: the session is revoked on the server (session_version), not only removed from the browser. */
export async function logout() {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (session) {
    await db
      .update(schema.users)
      .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, session.uid));
    await db.insert(schema.auditLog).values({ userId: session.uid, entity: 'session', action: 'sign_out', changes: null }).catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
