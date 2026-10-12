'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser, requireAdmin, canEditProperty, isAdmin, isFinance } from '@/lib/auth/dal';
import { and, eq } from 'drizzle-orm';
import { changedFields } from '@/lib/audit-diff';

const NoteSchema = z.object({
  versionId: z.number().int(),
  propertyId: z.number().int(),
  comment: z.string().max(4000).nullable(),
  vacancyLossOverride: z.number().finite().nullable(),
});

export async function saveNote(input: z.infer<typeof NoteSchema>): Promise<{ error?: string }> {
  const user = await requireUser();
  const d = NoteSchema.parse(input);
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, d.versionId));
  // Finance and Admin may comment even after a property is submitted, but never on a locked version;
  // the property manager while the property is open to them
  if (!version || version.status === 'LOCKED') return { error: 'Version is locked' };
  if (!isFinance(user)) {
    const check = await canEditProperty(user, d.versionId, d.propertyId, 'PM');
    if (!check.ok) return { error: check.reason };
  }
  // the vacancy loss override changes a reported figure: Admin only
  const [before] = await db
    .select()
    .from(schema.propertyNotes)
    .where(and(eq(schema.propertyNotes.versionId, d.versionId), eq(schema.propertyNotes.propertyId, d.propertyId)));
  if ((before?.vacancyLossOverride ?? null) !== d.vacancyLossOverride && !isAdmin(user)) return { error: 'Only Admin changes the vacancy loss override' };
  // the note and its audit row (before and after) land together
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.propertyNotes)
      .values({ ...d, updatedBy: user.id })
      .onConflictDoUpdate({
        target: [schema.propertyNotes.versionId, schema.propertyNotes.propertyId],
        set: { comment: d.comment, vacancyLossOverride: d.vacancyLossOverride, updatedAt: new Date(), updatedBy: user.id },
      });
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId: d.versionId,
      propertyId: d.propertyId,
      entity: 'property_note',
      action: 'update',
      changes: changedFields({ comment: before?.comment ?? null, vacancyLossOverride: before?.vacancyLossOverride ?? null }, { comment: d.comment, vacancyLossOverride: d.vacancyLossOverride }),
    });
  });
  revalidatePath('/analysis');
  return {};
}

const CompSchema = z.object({
  versionId: z.number().int(),
  propertyId: z.number().int(),
  label: z.string().trim().min(2).max(20),
  amount: z.number().finite().nullable(),
});

export async function saveComparative(input: z.infer<typeof CompSchema>): Promise<{ error?: string }> {
  const user = await requireAdmin();
  const d = CompSchema.parse(input);
  const [version] = await db.select().from(schema.budgetVersions).where(eq(schema.budgetVersions.id, d.versionId));
  if (!version || version.status === 'LOCKED') return { error: 'Version is locked' };
  await db.transaction(async (tx) => {
    const where = and(eq(schema.comparatives.versionId, d.versionId), eq(schema.comparatives.propertyId, d.propertyId), eq(schema.comparatives.label, d.label));
    const [before] = await tx.select().from(schema.comparatives).where(where);
    await tx
      .insert(schema.comparatives)
      .values(d)
      .onConflictDoUpdate({
        target: [schema.comparatives.versionId, schema.comparatives.propertyId, schema.comparatives.label],
        set: { amount: d.amount },
      });
    await tx.insert(schema.auditLog).values({
      userId: user.id,
      versionId: d.versionId,
      propertyId: d.propertyId,
      entity: 'comparative',
      entityId: d.label,
      action: 'update',
      changes: { from: before?.amount ?? null, to: d.amount },
    });
  });
  revalidatePath('/analysis');
  return {};
}
