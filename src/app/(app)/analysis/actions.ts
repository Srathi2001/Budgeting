'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db, schema } from '@/db';
import { requireUser, requireFinance, canEditProperty, isFinance } from '@/lib/auth/dal';
import { eq } from 'drizzle-orm';

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
  // Comments may be added by finance even after a property is submitted, but never on a locked version
  if (!version || version.status === 'LOCKED') return { error: 'Version is locked' };
  if (!isFinance(user)) {
    const check = await canEditProperty(user, d.versionId, d.propertyId);
    if (!check.ok) return { error: check.reason };
  }
  await db
    .insert(schema.propertyNotes)
    .values({ ...d, updatedBy: user.id })
    .onConflictDoUpdate({
      target: [schema.propertyNotes.versionId, schema.propertyNotes.propertyId],
      set: { comment: d.comment, vacancyLossOverride: d.vacancyLossOverride, updatedAt: new Date(), updatedBy: user.id },
    });
  await db.insert(schema.auditLog).values({
    userId: user.id,
    versionId: d.versionId,
    propertyId: d.propertyId,
    entity: 'property_note',
    action: 'update',
    changes: { comment: d.comment, vacancyLossOverride: d.vacancyLossOverride },
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
  const user = await requireFinance();
  const d = CompSchema.parse(input);
  await db
    .insert(schema.comparatives)
    .values(d)
    .onConflictDoUpdate({
      target: [schema.comparatives.versionId, schema.comparatives.propertyId, schema.comparatives.label],
      set: { amount: d.amount },
    });
  await db.insert(schema.auditLog).values({
    userId: user.id,
    versionId: d.versionId,
    propertyId: d.propertyId,
    entity: 'comparative',
    entityId: d.label,
    action: 'update',
    changes: { amount: d.amount },
  });
  revalidatePath('/analysis');
  return {};
}
