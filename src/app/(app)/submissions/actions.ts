'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db';
import { requireUser, isFinance } from '@/lib/auth/dal';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';

const TRANSITIONS: Record<'submit' | 'approve' | 'return', { from: Status[]; to: Status; finance: boolean }> = {
  submit: { from: ['DRAFT', 'RETURNED'], to: 'SUBMITTED', finance: false },
  approve: { from: ['SUBMITTED'], to: 'APPROVED', finance: true },
  return: { from: ['SUBMITTED', 'APPROVED'], to: 'RETURNED', finance: true },
};

export async function transition(
  versionId: number,
  propertyId: number,
  action: keyof typeof TRANSITIONS,
  note: string | null,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = TRANSITIONS[action];
  if (!t) return { error: 'Unknown action' };
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, versionId));
  if (!version || version.status === 'LOCKED') return { error: 'Version is locked' };
  const [prop] = await db.select().from(schema.properties).where(eq(schema.properties.id, propertyId));
  if (!prop) return { error: 'Property not found' };
  if (user.role === 'FM') return { error: 'Facilities management submits the FM budget only' };
  if (t.finance && !isFinance(user)) return { error: 'Only Finance can do this' };
  if (!t.finance && !isFinance(user) && prop.coordinator !== user.coordinator) return { error: 'Not your property' };

  const where = and(eq(schema.submissions.versionId, versionId), eq(schema.submissions.propertyId, propertyId));
  const [sub] = await db.select().from(schema.submissions).where(where);
  const current: Status = sub?.status ?? 'DRAFT';
  if (!t.from.includes(current)) return { error: `Cannot ${action} a property that is ${current.toLowerCase()}` };

  await db
    .insert(schema.submissions)
    .values({ versionId, propertyId, status: t.to, note, updatedBy: user.id })
    .onConflictDoUpdate({
      target: [schema.submissions.versionId, schema.submissions.propertyId],
      set: { status: t.to, note, updatedAt: new Date(), updatedBy: user.id },
    });
  await db.insert(schema.auditLog).values({
    userId: user.id,
    versionId,
    propertyId,
    entity: 'submission',
    action,
    changes: { from: current, to: t.to, note },
  });
  revalidatePath('/submissions');
  revalidatePath('/');
  return {};
}
