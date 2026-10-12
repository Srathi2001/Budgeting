// Sign-in limits read from the change history (audit_log keeps every failed sign-in with its email and
// address), so they hold across app restarts and app instances (Azure). The rules are throttle.ts's: 5
// failures of an account (since its last sign-in) or 50 from an address within 15 minutes hold it for 15
// minutes from the last failure.
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { ACCOUNT_RULE, ADDRESS_RULE, type ThrottleRule } from './throttle';

async function heldFor(field: 'email' | 'address', value: string, rule: ThrottleRule, since: Date | null, now: number): Promise<number> {
  const a = schema.auditLog;
  const from = new Date(Math.max(now - rule.windowMs, since?.getTime() ?? 0));
  const failures = await db
    .select({ at: a.at })
    .from(a)
    .where(and(eq(a.entity, 'session'), eq(a.action, 'sign_in_failed'), gte(a.at, from), sql`${a.changes}->>${field} = ${value}`))
    .orderBy(desc(a.at))
    .limit(rule.max);
  if (failures.length < rule.max) return 0;
  const until = failures[0].at.getTime() + rule.holdMs;
  return until > now ? until - now : 0;
}

/** ms the account or the address is still held for (0 = may sign in) */
export async function signInHeldFor(email: string, address: string, userId: number | null, now = Date.now()): Promise<number> {
  // an account's failures count from its last successful sign-in
  const [last] = userId
    ? await db
        .select({ at: schema.auditLog.at })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entity, 'session'), eq(schema.auditLog.action, 'sign_in'), eq(schema.auditLog.userId, userId)))
        .orderBy(desc(schema.auditLog.at))
        .limit(1)
    : [];
  const [account, from] = await Promise.all([heldFor('email', email, ACCOUNT_RULE, last?.at ?? null, now), heldFor('address', address, ADDRESS_RULE, null, now)]);
  return Math.max(account, from);
}

/**
 * The client's address. Behind Azure's front end the last X-Forwarded-For entry is the one it added (the
 * ones before it come from the browser and could be anything); a port is dropped.
 */
export function clientAddress(forwardedFor: string | null, realIp: string | null): string {
  const hops = (forwardedFor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = hops[hops.length - 1] ?? realIp ?? 'local';
  // "1.2.3.4:5678" → "1.2.3.4"; IPv6 "[::1]:5678" → "::1"
  return last.replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
}
