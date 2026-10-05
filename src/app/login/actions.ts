'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, schema } from '@/db';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth/session';

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
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: 'Email or password is incorrect' };
  }
  const token = await signSession({ uid: user.id, role: user.role, coordinator: user.coordinator, name: user.name });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
