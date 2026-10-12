'use server';

import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser, isAdmin, isFinance } from '@/lib/auth/dal';
import { contractYear, type ContractInput } from '@/lib/budget/boh-calc';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';

// the property manager submits; Admin approves or returns
const TRANSITIONS: Record<'submit' | 'approve' | 'return', { from: Status[]; to: Status; admin: boolean }> = {
  submit: { from: ['DRAFT', 'RETURNED'], to: 'SUBMITTED', admin: false },
  approve: { from: ['SUBMITTED'], to: 'APPROVED', admin: true },
  return: { from: ['SUBMITTED', 'APPROVED'], to: 'RETURNED', admin: true },
};

export async function transition(versionId: number, propertyId: number, action: keyof typeof TRANSITIONS, note: string | null): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = TRANSITIONS[action];
  if (!t) return { error: 'Unknown action' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'Version is locked' };
  const [prop] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!prop) return { error: 'Property not found' };
  if (t.admin && !isAdmin(user)) return { error: 'Only Admin approves or returns' };
  if (!t.admin && !isAdmin(user) && (user.role !== 'PM' || prop.coordinator !== user.coordinator)) return { error: 'The property manager submits the property' };
  if (action === 'return' && !note?.trim()) return { error: 'Give a reason for returning it' };
  if (action === 'submit') {
    // every renewal needs its RERA range (or an increase entered): none means a 0% increase (audit FIN-014)
    const missing = await db
      .select({ unit: schema.units.unitCode, bedroom: schema.units.bedroom })
      .from(schema.leaseLines)
      .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
      .where(and(eq(schema.leaseLines.versionId, versionId), eq(schema.leaseLines.propertyId, propertyId), sql`${schema.leaseLines.calc}->>'warnings' like '%No RERA index%'`));
    if (missing.length) {
      const codes = [...new Set(missing.map((m) => m.bedroom ?? '(no code)'))].join(', ');
      return { error: `${missing.length} renewal${missing.length === 1 ? ' has' : 's have'} no RERA range (${codes}): enter the ranges in the Lease Budget row form, or an increase for the unit, then submit` };
    }
    // a service contract ending before 31 December needs the property manager's decision (audit FIN-008)
    const contracts = await db.select().from(schema.bohContracts).where(and(eq(schema.bohContracts.versionId, versionId), eq(schema.bohContracts.propertyId, propertyId)));
    const open = contracts.filter((c) => contractYear(c as ContractInput, version.year).needsDecision);
    if (open.length)
      return { error: `${open.length} service contract${open.length === 1 ? ' ends' : 's end'} before 31-Dec-${version.year} without a decision (${open.map((c) => c.supplier ?? c.description ?? c.account).slice(0, 3).join(', ')}): say in Building Overheads whether each is renewed, then submit` };
  }

  const where = and(eq(schema.submissions.versionId, versionId), eq(schema.submissions.propertyId, propertyId));
  const [sub] = await db.select().from(schema.submissions).where(where);
  const current: Status = sub?.status ?? 'DRAFT';
  if (!t.from.includes(current)) return { error: `Cannot ${action} a property that is ${current.toLowerCase()}` };

  // the status and its audit row change together or not at all
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.submissions)
      .values({ versionId, propertyId, status: t.to, note, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [schema.submissions.versionId, schema.submissions.propertyId],
        set: { status: t.to, note, updatedAt: new Date(), updatedBy: user.id },
      });
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId,
      propertyId,
      entity: 'submission',
      action,
      changes: { from: current, to: t.to, note },
    });
  });
  revalidatePath('/submissions');
  revalidatePath('/');
  revalidatePath('/dashboard');
  return {};
}

export interface ActivityRow {
  id: number;
  at: string;
  who: string | null;
  entity: string;
  action: string;
  changes: unknown;
}

/** The change history of one property in a version (newest first), for the history sheet. */
export async function propertyActivity(versionId: number, propertyId: number): Promise<{ rows: ActivityRow[]; error?: string }> {
  const user = await requireUser();
  const [prop] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!prop) return { rows: [], error: 'Property not found' };
  if (!isFinance(user) && prop.coordinator !== user.coordinator) return { rows: [], error: 'Not your property' };
  const rows = await db
    .select({ a: schema.auditLog, who: schema.users.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .where(and(eq(schema.auditLog.versionId, versionId), eq(schema.auditLog.propertyId, propertyId)))
    .orderBy(desc(schema.auditLog.at))
    .limit(100);
  return { rows: rows.map(({ a, who }) => ({ id: a.id, at: a.at.toISOString(), who, entity: a.entity, action: a.action, changes: a.changes })) };
}
