// Permission rules, independent of the request (usable from server actions and scripts).
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export type Actor = Pick<schema.User, 'id' | 'name' | 'email' | 'role' | 'coordinator'>;

export function isFinance(user: Actor) {
  return user.role === 'ADMIN' || user.role === 'FINANCE';
}

/** Properties the user may see. PMs see their own (coordinator), finance sees all. */
export async function visibleProperties(user: Actor) {
  const p = schema.properties;
  const rows = await db.select().from(p).where(eq(p.active, true)).orderBy(p.buCode, p.code);
  return isFinance(user) ? rows : rows.filter((r) => r.coordinator === user.coordinator);
}

/** All property ids the user may edit in a version. */
export async function editablePropertyIds(user: Actor, version: schema.BudgetVersion): Promise<Set<number>> {
  if (version.status === 'LOCKED') return new Set();
  const visible = await visibleProperties(user);
  if (isFinance(user)) return new Set(visible.map((p) => p.id));
  const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.versionId, version.id));
  const locked = new Set(subs.filter((s) => s.status === 'SUBMITTED' || s.status === 'APPROVED').map((s) => s.propertyId));
  return new Set(visible.filter((p) => !locked.has(p.id)).map((p) => p.id));
}

export type EditCheck = { ok: true } | { ok: false; reason: string };

/** Can the user change budget inputs of this property in this version? */
export async function canEditProperty(user: Actor, versionId: number, propertyId: number): Promise<EditCheck> {
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version) return { ok: false, reason: 'Version not found' };
  if (version.status === 'LOCKED') return { ok: false, reason: 'This budget version is locked' };
  if (isFinance(user)) return { ok: true };
  const [prop] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!prop || prop.coordinator !== user.coordinator) return { ok: false, reason: 'Not your property' };
  const [sub] = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.versionId, versionId), eq(schema.submissions.propertyId, propertyId)));
  if (sub && (sub.status === 'SUBMITTED' || sub.status === 'APPROVED')) {
    return { ok: false, reason: `Property is ${sub.status.toLowerCase()}; ask Finance to return it for changes` };
  }
  return { ok: true };
}
