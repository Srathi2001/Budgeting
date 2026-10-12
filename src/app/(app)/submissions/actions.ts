'use server';

import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser, isAdmin, isFinance } from '@/lib/auth/dal';
import { contractYear, type ContractInput } from '@/lib/budget/boh-calc';
import { fmtDateTime } from '@/lib/format';
import { writeGuard } from '@/lib/write-guard';

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

  // the status and its audit row change together or not at all. The transition waits for the saves running
  // on the property (its lease lines included) and holds new ones until it commits; the checks below read
  // the property as it is at that moment
  const refused = await db.transaction(async (tx): Promise<string | null> => {
    const cur = await writeGuard(tx, versionId, { leases: true, properties: [propertyId], propertyMode: 'exclusive' });
    if (!cur || cur.status === 'LOCKED') return 'Version is locked';
    if (action === 'submit') {
      // every renewal needs its RERA range (or an increase entered): none means a 0% increase (audit FIN-014)
      const missing = await tx
        .select({ unit: schema.units.unitCode, bedroom: schema.units.bedroom })
        .from(schema.leaseLines)
        .innerJoin(schema.units, eq(schema.units.id, schema.leaseLines.unitId))
        .where(and(eq(schema.leaseLines.versionId, versionId), eq(schema.leaseLines.propertyId, propertyId), sql`${schema.leaseLines.calc}->>'warnings' like '%No RERA index%'`));
      if (missing.length) {
        const codes = [...new Set(missing.map((m) => m.bedroom ?? '(no code)'))].join(', ');
        return `${missing.length} renewal${missing.length === 1 ? ' has' : 's have'} no RERA range (${codes}): enter the ranges in the Lease Budget row form, or an increase for the unit, then submit`;
      }
      // a service contract ending before 31 December needs the property manager's decision (audit FIN-008)
      const contracts = await tx.select().from(schema.bohContracts).where(and(eq(schema.bohContracts.versionId, versionId), eq(schema.bohContracts.propertyId, propertyId)));
      const open = contracts.filter((c) => contractYear(c as ContractInput, cur.year).needsDecision);
      if (open.length)
        return `${open.length} service contract${open.length === 1 ? ' ends' : 's end'} before 31-Dec-${cur.year} without a decision (${open.map((c) => c.supplier ?? c.description ?? c.account).slice(0, 3).join(', ')}): say in Building Overheads whether each is renewed, then submit`;
    }

    const where = and(eq(schema.submissions.versionId, versionId), eq(schema.submissions.propertyId, propertyId));
    const [sub] = await tx.select({ s: schema.submissions, who: schema.users.name }).from(schema.submissions).leftJoin(schema.users, eq(schema.users.id, schema.submissions.updatedBy)).where(where);
    const current: Status = sub?.s.status ?? 'DRAFT';
    if (!t.from.includes(current)) {
      // someone else got there first: say who and when
      const by = sub?.who && sub.s.updatedBy !== user.id ? ` (${current.toLowerCase()} by ${sub.who} on ${fmtDateTime(sub.s.updatedAt)})` : '';
      return `Cannot ${action} a property that is ${current.toLowerCase()}${by}`;
    }
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
    return null;
  });
  if (refused) return { error: refused };
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
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(100);
  return { rows: rows.map(({ a, who }) => ({ id: a.id, at: a.at.toISOString(), who, entity: a.entity, action: a.action, changes: a.changes })) };
}
