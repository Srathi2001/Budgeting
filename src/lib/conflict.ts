// "Someone else changed it first" (user decision 12-Oct-2026: show who and when). A screen sends, with each
// change, the value the user saw when the page was loaded (`seen`); a save compares it with the value stored
// now, inside its transaction. When someone else changed that figure in between, the figure is not saved
// and the user is told who changed it, when, and to what. Without `seen` (older callers) a save works as
// before. Who and when come from the change history (audit_log), which records every field.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { fmt, fmtDate, fmtDateTime } from '@/lib/format';
import type { Exec } from '@/lib/write-guard';

/** the same value as far as a save is concerned: null and missing alike, a number stored as text equals the number */
export function sameValue(a: unknown, b: unknown): boolean {
  if ((a ?? null) === (b ?? null)) return true;
  if (typeof a === 'number' || typeof b === 'number') return a !== null && b !== null && a !== undefined && b !== undefined && Number(a) === Number(b);
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Is a change a conflict? The stored value differs from what the user saw, and from what the user typed
 * (someone else typing the same value is no conflict). No `seen`: never.
 */
export const conflicts = (hasSeen: boolean, seen: unknown, stored: unknown, mine: unknown) => hasSeen && !sameValue(stored, seen) && !sameValue(stored, mine);

/** a value as the message shows it */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'blank';
  if (typeof v === 'number') return fmt(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : v;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o) return showValue(o.amount);
    return Object.values(o).map(showValue).join(' / ');
  }
  return String(v);
}

export interface LastChange {
  userId: number | null;
  who: string | null;
  at: Date;
}

/**
 * The latest change of an entity in the change history (and of one field, for entities whose audit rows list
 * the fields changed: lease lines, FM lines, contracts, records).
 */
export async function lastChange(on: Exec, entity: string, entityId: string | null, field?: string, propertyId?: number): Promise<LastChange | null> {
  const a = schema.auditLog;
  const [r] = await on
    .select({ userId: a.userId, who: schema.users.name, at: a.at })
    .from(a)
    .leftJoin(schema.users, eq(schema.users.id, a.userId))
    .where(
      and(
        eq(a.entity, entity),
        entityId === null ? isNull(a.entityId) : eq(a.entityId, entityId),
        propertyId !== undefined ? eq(a.propertyId, propertyId) : undefined,
        field ? sql`(${a.changes} ? ${field} or ${a.changes} -> 'fields' ? ${field})` : undefined,
      ),
    )
    .orderBy(desc(a.id))
    .limit(1);
  return r ?? null;
}

/**
 * The message when a figure is a conflict (see conflicts), null when it isn't. A figure whose latest change
 * is the user's own (an earlier save from the same page) is no conflict.
 */
export async function clash(
  on: Exec,
  me: number,
  what: string,
  where: { entity: string; entityId: string | null; field?: string; propertyId?: number },
  seen: unknown,
  stored: unknown,
  mine: unknown,
  opts: { reload?: boolean; show?: [stored: unknown, mine: unknown] } = {},
): Promise<string | null> {
  if (!conflicts(true, seen, stored, mine)) return null;
  const change = await lastChange(on, where.entity, where.entityId, where.field, where.propertyId);
  if (change && change.userId === me) return null;
  const [s, m] = opts.show ?? [stored, mine];
  return conflictText(what, change, s, m, opts.reload ?? true);
}

/**
 * "Vacancy days was changed by Ahmed on 12-Oct-2026 10:42 to 90. Your value 60 was not saved." `reload`:
 * the screen keeps showing the old figure, so the user is told to reload it.
 */
export function conflictText(what: string, change: LastChange | null, stored: unknown, mine: unknown, reload = true): string {
  const by = change ? `${change.who ? ` by ${change.who}` : ''} on ${fmtDateTime(change.at)}` : ' by someone else';
  return `${what} was changed${by} to ${showValue(stored)}. Your value ${showValue(mine)} was not saved.${reload ? ' Reload to see the latest.' : ''}`;
}
